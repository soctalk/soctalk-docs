# Authentification interne

## 1. Portée

Ajoute un chemin de connexion autonome pour les interfaces natives de
SocTalk afin que les opérateurs puissent fonctionner sans proxy OIDC en
amont. L'autorisation existante (rôles, `tenant_id`, décorateurs à
`src/soctalk/core/tenancy/decorators.py:120`, RLS Postgres) reste
inchangée. Cette spécification n'ajoute qu'une nouvelle source
d'identité produisant la même structure `UserIdentity` déjà consommée
dans `src/soctalk/core/tenancy/auth.py:67`.

Deux modes, sélectionnés au démarrage du processus et exposés sur `/health/live` et `/health/ready` :

```
SOCTALK_AUTH_MODE = internal | proxy
```

- `internal` (par défaut pour les nouvelles installations) : SocTalk
  gère la connexion, les sessions, le stockage des mots de passe. Le
  middleware de relais d'ingress est désactivé.
- `proxy` : préserve le comportement de relais d'ingress existant. Les
  points de terminaison internes répondent par un 404.

Pas de mode hybride. La fédération (provisionnement JIT, SP OIDC, etc.)
fait l'objet d'une spécification distincte.

## 2. Modèle de données

Deux nouvelles tables. Tout le reste réutilise les modèles existants.

### `password_credentials`

| column               | type        | notes                                       |
| ---                  | ---         | ---                                         |
| user_id              | uuid PK, FK | référence `users.id`, suppression en cascade |
| password_hash        | text NOT NULL | argon2id, chaîne de hachage complète avec paramètres |
| must_change          | bool        | défini par la réinitialisation admin        |
| updated_at           | timestamptz |                                             |
| last_used_at         | timestamptz | dernière connexion réussie                  |
| consecutive_failures | int         | remis à zéro en cas de succès               |
| locked_until         | timestamptz | null sauf si le verrouillage est actif      |

### `sessions`

Sessions stockées en base de données. Le cookie porte un session_id
opaque ; la ligne en base fait foi.

| column          | type        | notes                                |
| ---             | ---         | ---                                  |
| id              | uuid PK     | également la valeur du cookie        |
| user_id         | uuid FK     |                                      |
| tenant_context  | uuid        | `current_tenant` capturé à la connexion |
| created_at      | timestamptz |                                      |
| last_seen_at    | timestamptz | mis à jour de façon throttlée (~60s) |
| absolute_expiry | timestamptz | plafond strict, 12h                  |
| idle_expiry     | timestamptz | glisse en cas d'activité, 30m        |
| revoked_at      | timestamptz | une valeur non nulle désactive la session |
| ip_created      | inet        | observabilité                        |
| user_agent      | text        | observabilité                        |

Index : `(user_id, revoked_at)`.

### Réutilisation

- `users` (`src/soctalk/core/tenancy/models.py:156`), inchangé.
- `audit_log` (`src/soctalk/core/tenancy/models.py:291`), reçoit les
  actions `auth.*` (voir §9).

Pas de nouvelle table d'audit. Pas de table de clés de signature (les
sessions sont des lignes opaques en base, pas des JWT ; la signature
HMAC existante à `src/soctalk/core/tenancy/auth.py:167` n'a aucun
rapport).

## 3. Points de terminaison

Tous sous `/api/auth/*`. JSON. Routes modifiant l'état protégées selon §6.

| method | path                                          | purpose                                |
| ---    | ---                                           | ---                                    |
| POST   | `/api/auth/login`                             | e-mail + mot de passe, définit le cookie de session |
| POST   | `/api/auth/logout`                            | révoque la session en cours            |
| GET    | `/api/auth/me`                                | charge utile d'identité en cours + `permissions[]` du rôle |
| POST   | `/api/auth/password/change`                   | ancien + nouveau, authentifié          |
| POST   | `/api/mssp/users/{id}/password/reset`         | réinitialisation forcée par l'admin, définit `must_change` |

`/api/auth/me` renvoie l'identité plus une liste `permissions[]` calculée, les capacités que détient le rôle connecté, dérivée de la source unique de vérité qu'est la table de correspondance rôle-vers-permission. Le frontend conditionne la navigation et les actions sur ces permissions plutôt que de les déduire de la chaîne du rôle.

Le point de terminaison de réinitialisation admin génère côté serveur
un mot de passe aléatoire robuste et le renvoie une seule fois dans le
corps de la réponse ; l'admin le transmet à l'utilisateur hors bande.
La réinitialisation en libre-service par e-mail est reportée (§12).

En `AUTH_MODE=proxy`, chaque point de terminaison de ce tableau répond
par un 404.

## 4. Cookie et session

### Cookie

Nom : `soctalk_session`.

Attributs :

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- `Domain` omis (hôte uniquement)
- `Max-Age` correspond à l'`absolute_expiry` de la session

Valeur : base64 url-safe de l'UUID de session. Aucune revendication
dans le cookie.

### Cycle de vie

- `absolute_expiry = created_at + 12h`. Plafond strict.
- `idle_expiry = last_seen_at + 30m`. Glisse vers l'avant en cas
  d'activité.
- Au changement de mot de passe : toutes les autres sessions de
  l'utilisateur sont révoquées ; la session qui a effectué le
  changement est préservée pour que l'utilisateur reste connecté sur
  son appareil actuel.
- `/api/auth/logout` révoque uniquement la session en cours.
- La réinitialisation admin révoque toutes les sessions de
  l'utilisateur cible.

## 5. Politique de mot de passe

- argon2id via `argon2-cffi`.
- Paramètres : `time_cost=3`, `memory_cost=65536` (64 MiB),
  `parallelism=4`, `hash_len=32`, `salt_len=16`.
- La chaîne de hachage stockée contient ses paramètres ;
  vérification-et-rehachage de façon transparente lorsque les
  paramètres évoluent.
- Longueur minimale : 12. Pas de règles de composition.
- Verrouillage : 10 échecs consécutifs en moins de 15 min définissent
  `locked_until = now() + 15m`. Le compteur est remis à zéro à la
  connexion réussie.
- `must_change` : défini par la réinitialisation admin. Force
  l'utilisateur à suivre le flux de changement de mot de passe avant
  tout autre point de terminaison.

## 6. CSRF

`SameSite=Lax` sur le cookie de session bloque déjà les POST
inter-sites. Pour les méthodes modifiant l'état (`POST`, `PATCH`,
`DELETE`, `PUT`), le middleware applique en plus :

- Si `Origin` est présent, il doit correspondre à l'une des origines
  natives configurées. La configuration est une liste/un motif, pas une
  valeur unique, car les installations desservent à la fois l'hôte MSSP
  (`mssp.example.com`) et un hôte client par tenant avec joker
  (`*.customers.example.com`). L'épinglage à une origine unique
  renverrait un 403 pour chaque POST provenant de l'interface qui n'est
  pas celle épinglée.
- Sinon, si `Referer` est présent, sa composante d'origine doit
  correspondre à la même liste d'autorisation.
- Sinon, rejeter avec un 403.

La liste d'autorisation dérive des noms d'hôtes d'interface configurés
dans les valeurs du chart (`ingress.hostnames.mssp`,
`ingress.hostnames.customer`) afin que les opérateurs ne la
maintiennent pas séparément.

## 7. Middleware

Un nouveau middleware `internal_session_middleware` remplace
`ingress_handoff_middleware` lorsque `SOCTALK_AUTH_MODE=internal`.

Par requête :

1. Lire le cookie `soctalk_session`.
2. Rechercher la ligne de session. Rejeter si absente, révoquée,
   au-delà de `absolute_expiry` ou au-delà d'`idle_expiry`.
3. Mettre à jour `last_seen_at` (throttlé, écriture au plus toutes les
   60s).
4. Charger l'utilisateur et construire la même structure `UserIdentity`
   produite par le chemin. Définir `request.state.user_identity`
   exactement comme aujourd'hui, afin que les décorateurs et les
   helpers de contexte RLS restent intacts.

Limitation de débit : tentatives de connexion par IP et par e-mail
toutes les 15 minutes, appliquées avant la recherche en base. Compteur
en cours de processus pour la bêta ; à remplacer par Redis quand nous
aurons besoin d'une mise à l'échelle horizontale.

## 8. UI/UX

Deux interfaces natives gagnent des fonctionnalités d'authentification :
la console MSSP (`frontend/mssp`) et le portail client
(`frontend/customer`). Les deux sont des applications SvelteKit
dialoguant avec la même API.

### Page de connexion

Les deux applications gagnent `/login` :

- Carte centrée. Deux champs (E-mail, Mot de passe). Un seul bouton
  principal libellé « Se connecter ».
- Le portail client lit le nom de l'application et le logo depuis la
  `BrandingConfig` du tenant afin que la page paraisse native à la
  marque du MSSP. La console MSSP utilise l'habillage par défaut au
  niveau de l'installation.
- Focus initial sur E-mail. Entrée valide. Noms de champs standard afin
  que les gestionnaires de mots de passe des navigateurs remplissent
  proprement.
- États d'erreur (pas d'énumération d'utilisateurs) :
  - Identifiants invalides → « E-mail ou mot de passe incorrect. »
  - Compte verrouillé → « Ce compte est temporairement verrouillé.
    Réessayez à {unlock_time}. »
  - Erreur serveur → « Une erreur est survenue. Réessayez. »
- Petite ligne utilitaire en dessous : « Contactez votre administrateur
  si vous avez perdu l'accès. » Pas de lien de réinitialisation en
  libre-service dans cette spécification.

### Changement forcé (`must_change`)

Lorsque la connexion réussit avec un identifiant portant
`must_change=true`, la réponse du serveur signale le changement comme
étape suivante. L'interface navigue directement vers
`/account/password`: sans affichage furtif du tableau de bord.

Tant que `must_change` est défini, toute route autre que
`/account/password` et `POST /api/auth/logout` redirige vers
`/account/password`. Une petite bannière ambre indique « Votre
administrateur exige que vous définissiez un nouveau mot de passe avant
de continuer. »

### Page de changement de mot de passe

`/account/password` :

- Trois champs : Mot de passe actuel, Nouveau mot de passe, Confirmer
  le nouveau mot de passe.
- Validateur en ligne pour la seule règle de longueur ≥12. Pas
  d'indicateur de composition.
- En cas de succès, afficher une confirmation et la note « Les autres
  appareils ont été déconnectés. Vous restez connecté ici. »
- Accessible depuis le menu du compte, et obligatoire pendant
  `must_change`.

### Menu du compte

Dans l'en-tête des deux applications, visible une fois authentifié :

- E-mail de l'utilisateur.
- Libellé du rôle (« MSSP admin », « Analyste », « Lecteur client »,
  etc.).
- Lien vers « Changer le mot de passe ».
- « Se déconnecter », `POST /api/auth/logout`, puis navigation vers
  `/login` avec un message flash « Vous avez été déconnecté. »

### Réinitialisation admin (console MSSP)

Sur la page de détail de l'utilisateur dans la console MSSP :

- Bouton « Réinitialiser le mot de passe », restreint par permission à
  `platform_admin` et `mssp_admin`.
- La fenêtre modale de confirmation explique : « Génère un mot de passe
  à usage unique, révoque toutes les sessions actives de cet
  utilisateur et le force à le changer à la prochaine connexion. »
- À la confirmation, le serveur renvoie une fois le mot de passe
  généré. L'interface l'affiche dans un champ copier-vers-le-presse-papiers
  avec « Copier et fermer ». Après la fermeture de la fenêtre modale, le
  mot de passe n'est plus récupérable, l'admin le partage hors bande.

### Expiration de session

- Pour tout 401 renvoyé à une session authentifiée, la SPA navigue vers
  `/login?expired=1&next=<current-url>`.
- La page de connexion lit `expired=1` et affiche « Votre session a
  expiré. Veuillez vous reconnecter. » L'expiration absolue ou par
  inactivité n'est pas distinguée dans l'interface.
- Après une connexion réussie, la SPA navigue vers `next` s'il est
  présent et de même origine ; sinon vers la route d'atterrissage par
  défaut de cette interface.

### États vides et d'erreur

- Premier chargement sans session → redirection vers `/login` (sans
  flash).
- Page de connexion alors que déjà authentifié → redirection vers la
  route d'atterrissage par défaut (ne pas bloquer l'utilisateur sur un
  formulaire dont il n'a pas besoin).
- Erreurs réseau pendant la connexion → conserver le formulaire,
  afficher en ligne « Impossible de joindre le serveur. Vérifiez votre
  connexion et réessayez. »

### Accessibilité

- Toutes les entrées ont des éléments `<label>` associés. Les erreurs
  utilisent `role="alert"` afin que les lecteurs d'écran les annoncent.
- L'ordre de focus est naturel (e-mail → mot de passe → soumettre).
- Pas de CAPTCHA. Le verrouillage combiné à la limitation de débit par
  IP/e-mail couvre les abus à l'échelle d'un MSSP ; le CAPTCHA casse le
  flux des lecteurs d'écran et ajoute une charge opérationnelle.
- Cible tactile minimale de 44×44px pour l'action principale sur mobile.

## 9. Audit

Émettre les valeurs `action` suivantes dans l'`audit_log` existant :

- `auth.login.success`
- `auth.login.failure` (`details.reason` parmi `{bad_password, unknown_email, locked}`)
- `auth.logout`
- `auth.password.changed`
- `auth.password.reset.admin` (réinitialisation d'un autre utilisateur déclenchée par l'admin)
- `auth.lockout.triggered`

`actor_id` est l'id de l'utilisateur agissant, ou `system:auth` pour
les déclenchements de verrouillage. `tenant_id` est copié depuis
l'utilisateur agissant.

## 10. Migration de `proxy` vers `internal`

1. Appliquer la migration qui crée §2.1 et §2.2. Les lignes `users`
   existantes ne sont pas affectées.
2. Déployer la nouvelle version de l'application.
   `SOCTALK_AUTH_MODE=proxy` préserve le comportement existant.
3. Pour chaque utilisateur censé utiliser la connexion interne,
   l'opérateur exécute `soctalk auth set-password <email>` (nouvelle
   CLI ; écrit une ligne `password_credentials` et émet
   `auth.password.reset.admin`).
4. L'opérateur bascule `SOCTALK_AUTH_MODE=internal` et redémarre. Le
   middleware de relais d'ingress est retiré du pipeline.

Retour arrière : rebasculer le drapeau et redémarrer.

## 11. Tests

Suite backend obligatoire (style postgres-rls §9) :

1. Le chemin nominal de connexion crée une ligne de session avec le bon
   `tenant_context` et définit le cookie.
2. Un mauvais mot de passe incrémente `consecutive_failures` ; dix
   consécutifs déclenchent `locked_until` ; les tentatives suivantes
   sont rejetées même avec le bon mot de passe.
3. `must_change` bloque tout point de terminaison hors mot de passe
   jusqu'à un changement réussi.
4. Le changement de mot de passe révoque toutes les autres sessions de
   l'utilisateur mais préserve la session en cours.
5. La déconnexion révoque uniquement la session en cours.
6. La réinitialisation admin révoque toutes les sessions de
   l'utilisateur cible et force `must_change`.
7. `AUTH_MODE=proxy` : `/api/auth/*` et le point de terminaison de
   réinitialisation admin renvoient un 404. Le chemin de relais
   d'ingress fonctionne toujours.
8. CSRF : une requête modifiant l'état avec une `Origin` étrangère est
   rejetée avec un 403.
9. Une session au-delà d'`absolute_expiry` ou d'`idle_expiry` est
   rejetée ; la ligne n'est pas supprimée automatiquement (conservée
   pour l'audit).

Suite de tests de fumée Playwright pour chaque interface :

1. La connexion avec des identifiants valides atterrit sur la route par
   défaut et affiche le menu du compte.
2. La connexion avec de mauvais identifiants affiche l'erreur générique
   sans énumérer.
3. `must_change` à la connexion atterrit sur la page de changement et ne
   peut naviguer ailleurs.
4. Le changement de mot de passe réussit et la connexion persiste.
5. La fenêtre modale de réinitialisation admin fait apparaître une fois
   le mot de passe généré ; sa fermeture le masque.
6. Une session expirée sur une route protégée route vers
   `/login?expired=1` avec le flash et préserve `next`.

## 12. Reporté

Ne fait pas partie de cette spécification. Ordonné par probabilité de
réintégration :

1. `password_reset_tokens`: réinitialisation de mot de passe en
   libre-service par e-mail.
2. MFA (TOTP + codes de récupération), avec les étapes d'interface
   correspondantes dans les flux de connexion et de compte.
3. Inventaire des sessions (`GET /api/auth/sessions`, révocation
   spécifique, déconnexion globale) avec un panneau « Appareils » dans
   la page du compte.
4. Usurpation d'identité (sessions mssp_admin → utilisateur du tenant),
   avec une bannière claire dans l'interface pendant l'usurpation.
5. SP OIDC / fédération (spécification distincte).
6. Émetteur OIDC (spécification distincte ; uniquement si un
   consommateur concret apparaît).
7. Rotation des clés de signature + JWKS (nécessaire uniquement lorsque
   nous émettrons des jetons sans état en externe).
