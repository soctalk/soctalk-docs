# Utilisateurs et rôles

Comment fonctionnent les rôles, qui peut faire quoi, et comment les administrateurs créent des utilisateurs, donnent accès au portail client et changent les mots de passe. Pour un parcours pas à pas du provisionnement et du cycle de vie des utilisateurs avec captures d'écran, consultez [Gérer les utilisateurs : un guide pratique](/fr-fr/manage-users). Consultez [Authentification interne](/fr-fr/reference/internal-auth) pour la référence au niveau du protocole et [Modèle de sécurité](/fr-fr/reference/security-model) pour la matrice rôle par ressource.

## Comment l'accès est décidé

L'accès évolue vers un modèle de capacités. Chaque rôle est un ensemble nommé de capacités, et les surfaces conçues ou retravaillées pour ce modèle (le flux operate et review, le chat, le libre-service tenant pour les engagements, les faits d'autorisation et les utilisateurs) demandent la capacité dont elles ont besoin plutôt qu'un rôle spécifique. Sur ces routes, ajouter un rôle revient à définir son ensemble de capacités ; les points d'appel ne changent pas. D'autres routes filtrent encore directement sur le rôle ou l'audience, notamment la gestion des tenants MSSP, la configuration du LLM et du branding, la réinitialisation de mot de passe par l'administrateur, ainsi que plusieurs routes de tableau de bord, d'analytique et d'enquête. Celles-ci sont mises à jour manuellement lorsque les rôles changent. Considérez l'accès basé sur les capacités comme la direction visée, non comme une généralité actuelle.

Les rôles sont organisés en paliers, et les mêmes paliers opérationnels existent des deux côtés de l'activité :

- **operate** : traiter la file. Consulter et trier les enquêtes, examiner les verdicts de l'IA, décider, approuver les propositions à portée standard, utiliser le chat.
- **authorize risk** : tout ce que peut faire operate, plus déclarer des engagements de pentest, curer les faits d'autorisation et valider les actions à forte portée qui écrivent dans un système externe.
- **configure** : tout ce que peut faire le manager, plus les réglages que ce rôle contrôle et la gestion des utilisateurs.

Un palier supérieur détient toutes les capacités du palier inférieur. Le côté tenant ajoute un palier de plus sous operate, un intervenant en lecture seule (`customer_viewer`) qui peut voir mais pas agir ; le côté MSSP n'a pas d'équivalent, car son rôle le plus bas (`analyst`) opère déjà.

L'audience est un mur distinct par-dessus les paliers. Les rôles MSSP ne détiennent que des capacités MSSP et les rôles tenant ne détiennent que des capacités tenant ; les deux ensembles ne se recoupent jamais. Un garde-fou de capacité vérifie ensemble la capacité et l'audience, de sorte qu'une capacité MSSP ne peut jamais satisfaire une route tenant et inversement. C'est pourquoi `platform_admin`, par exemple, détient toutes les capacités MSSP mais aucune des capacités tenant.

## Catalogue des rôles

**Côté MSSP** (personnel du fournisseur ; `tenant_id` est null) :

| Rôle | Palier | Peut faire |
|---|---|---|
| `platform_admin` | configure (super) | Toutes les capacités MSSP, à l'échelle de l'installation. |
| `mssp_admin` | configure | Configurer le système, gérer les utilisateurs, plus tout ce qui est en dessous. |
| `mssp_manager` | authorize risk | Déclarer des engagements, curer les faits d'autorisation, valider les actions à forte portée, plus operate. |
| `analyst` | operate | Trier les enquêtes, examiner les verdicts, décider, chatter. Travaille sur un client à la fois en épinglant un tenant (voir Usurpation ci-dessous) ; lecture seule sur les réglages. |

**Côté tenant** (personnel d'un client ; `tenant_id` défini ; limité à ce seul tenant) :

| Rôle | Palier | Peut faire |
|---|---|---|
| `tenant_admin` | configure | Gérer les utilisateurs de sa propre organisation et ses propres réglages LLM, plus tout ce qui est en dessous. Provisionné automatiquement lors de l'onboarding du tenant par le flux `_mint_tenant_admin_user` du runtime. |
| `tenant_manager` | authorize risk | Déclarer ses propres engagements de pentest, affirmer des faits d'autorisation (qui passent en examen MSSP avant de prendre effet), valider les actions à forte portée, plus operate. |
| `tenant_analyst` | operate | Travailler le SOC de son propre tenant : trier, examiner les verdicts, décider, approuver les propositions à portée standard, chatter. C'est le rôle de SOC co-géré, le miroir côté tenant de `analyst`. |
| `customer_viewer` | view only | Intervenant en lecture seule. Voit le tableau de bord SOC et les enquêtes de son propre client, mais ne peut pas agir dessus ni ouvrir la file d'examen. |

Le palier « configure » de `tenant_admin` est étroit : par rapport au manager, il ajoute la configuration LLM de sa propre organisation et la gestion des utilisateurs, et rien d'autre. Le branding et les intégrations restent du côté MSSP.

L'administrateur initial est créé en ligne par la commande d'init du pod API (pilotée par `install.bootstrapAdmin.email` et `install.bootstrapAdmin.password` dans les valeurs du chart) en tant que `mssp_admin` avec `must_change=false`. L'[assistant de configuration](/fr-fr/setup-wizard) renseigne ces valeurs au premier démarrage.

## La distinction customer-viewer et tenant-analyst

`customer_viewer` et `tenant_analyst` sont tous deux côté tenant, mais ce sont des métiers différents. `customer_viewer` observe : tableaux de bord et statut des enquêtes, rien de plus. Il ne peut pas décider des examens, utiliser le chat ni lister la file d'examen en attente. `tenant_analyst` opère : il fait tourner le SOC du client sur les alertes de son propre tenant. Donnez le rôle de viewer aux personnes qui ont besoin de visibilité et le rôle d'analyst à celles qui font le travail.

La file d'examen en attente est filtrée en conséquence. Lister ou ouvrir un examen requiert l'autorité d'examen, détenue par l'`analyst` MSSP et au-dessus, et par `tenant_analyst` et au-dessus. Un opérateur tenant ne voit que la file de son propre tenant. Les lectures d'examen inter-tenants sont limitées à `platform_admin`, `mssp_admin` et `mssp_manager` ; un `analyst` MSSP lit la file d'un tenant une fois épinglé à celui-ci.

## Créer des utilisateurs tenant

Un `tenant_admin` provisionne les identifiants de sa propre organisation. C'est ce qui rend les rôles tenant utilisables ; sans cela, un tenant n'aurait que l'unique administrateur créé à l'onboarding.

Dans l'interface client, ouvrez **Users** dans la barre latérale (visible uniquement par `tenant_admin`), puis **Add user** : saisissez un e-mail, choisissez un rôle et soumettez. Le panneau renvoie un mot de passe temporaire à usage unique. Copiez-le et remettez-le à l'utilisateur hors bande ; il n'est affiché qu'une fois et n'est jamais récupérable en clair. Il est demandé à l'utilisateur de le changer à sa première connexion.

La même chose est disponible via l'API :

```bash
curl -X POST 'https://<customer-host>/api/tenant/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@customer.example","role":"tenant_analyst"}'
```

Remarques :

- Les rôles assignables sont `customer_viewer`, `tenant_analyst`, `tenant_manager` et `tenant_admin`. Un rôle MSSP ne peut pas être assigné ici ; la requête est rejetée. C'est le mur d'audience.
- Le nouvel utilisateur est toujours placé dans le tenant de l'appelant. Le tenant est pris dans la session de l'appelant, jamais dans le corps de la requête, et la base de données l'impose, de sorte qu'un administrateur de tenant ne peut jamais créer d'utilisateurs que dans son propre tenant.
- Un e-mail en double est rejeté. Les e-mails sont uniques sur l'ensemble de l'installation.
- `GET /api/tenant/users` liste les utilisateurs du tenant lui-même. Les deux points de terminaison requièrent la capacité `tenant_manage_users`, que seul `tenant_admin` détient.

Le portail du client est accessible sur un hôte propre à chaque tenant. Le nom d'hôte fixe provient de `ingress.hostnames.customer` dans les valeurs du chart, et les hôtes par tenant pilotés par slug proviennent de `ingress.tenantWildcard`. Consultez la [documentation d'installation](/fr-fr/install) pour la disposition des noms d'hôte.

## Créer des utilisateurs du personnel MSSP

Un `mssp_admin` ou un `platform_admin` provisionne les identifiants du personnel MSSP depuis le panneau **Staff Users** dans l'[interface MSSP](/fr-fr/mssp-ui), ou via l'API. La forme reflète le côté tenant.

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@your-mssp.example","role":"analyst"}'
```

Remarques :

- Les rôles assignables sont `analyst`, `mssp_manager`, `mssp_admin` et `platform_admin`. Un rôle tenant ne peut pas être assigné ici (le mur d'audience). L'assignation de `platform_admin` n'est autorisée que si l'appelant est déjà un `platform_admin`.
- Le nouvel utilisateur est côté MSSP (`tenant_id` est null). Ces points de terminaison n'opèrent jamais que sur les lignes du personnel MSSP, de sorte qu'un utilisateur tenant ne peut jamais être atteint par leur intermédiaire.
- La réponse contient un mot de passe temporaire à usage unique ; l'utilisateur le change à sa première connexion. Un e-mail en double est rejeté.
- `GET /api/mssp/users` liste le personnel. Tous ces éléments requièrent la capacité `manage_users`, détenue uniquement par `mssp_admin` et `platform_admin`.

`soctalk-auth set-password` (la CLI) existe toujours pour les cas de bootstrap et hors ligne : elle définit un mot de passe pour un utilisateur existant, efface `must_change` et audite le changement, mais ne crée pas la ligne utilisateur et ne révoque pas les sessions.

## Changer un rôle, désactiver, réactiver

Les deux côtés exposent le même cycle de vie. Côté tenant, un `tenant_admin` gère sa propre organisation ; côté MSSP, un `mssp_admin`/`platform_admin` gère le personnel.

- **Changer un rôle** : choisissez un nouveau rôle dans le sélecteur de la ligne, ou `PATCH /api/tenant/users/{id}` (ou `/api/mssp/users/{id}`) avec `{"role": "..."}`. Un changement de rôle révoque les sessions actives de l'utilisateur pour que le nouveau rôle prenne effet immédiatement.
- **Désactiver** : le bouton Deactivate de la ligne, ou `POST .../{id}/deactivate`. L'utilisateur est mis en inactif et chaque session active est révoquée d'un coup, de sorte qu'un utilisateur déjà connecté est coupé plutôt que de subsister jusqu'à expiration. Le middleware de session refuse également un utilisateur inactif, ce qui ferme la course avec une connexion concurrente.
- **Réactiver** : le bouton Reactivate de la ligne, ou `PATCH .../{id}` avec `{"active": true}`.

Deux garde-fous s'appliquent à chaque changement :

- Vous ne pouvez pas modifier votre propre compte (pas d'auto-rétrogradation ni d'auto-verrouillage).
- Vous ne pouvez pas retirer le dernier administrateur actif : le changement qui laisserait un tenant sans `tenant_admin` actif, ou l'installation sans `mssp_admin`/`platform_admin` actif (ou sans `platform_admin` actif lorsqu'il en existe un), est refusé. La vérification verrouille les lignes candidates, de sorte que des rétrogradations concurrentes ne peuvent pas toutes deux passer.

Un compte `platform_admin` existant ne peut être modifié, désactivé ou réinitialisé en mot de passe que par un autre `platform_admin`.

## Réinitialisation de mot de passe

**Libre-service** : non implémenté dans cette version. Il n'y a pas de flux de mot de passe oublié ni d'envoi d'e-mail sur la page de connexion. Les utilisateurs demandent à un administrateur de réinitialiser.

**Forcé par l'administrateur** : un `mssp_admin` ou un `platform_admin` réinitialise le mot de passe de n'importe quel utilisateur par id :

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

La cible peut être un utilisateur MSSP ou un utilisateur tenant ; l'acteur doit être `mssp_admin` ou `platform_admin`. La réponse contient un nouveau `temporary_password` marqué `must_change=true`, et la réinitialisation révoque toutes les sessions existantes de cet utilisateur. Partagez le mot de passe ; l'utilisateur en choisit un nouveau à sa première connexion.

Il n'y a pas d'action de réinitialisation côté tenant, de sorte qu'un `tenant_admin` ne peut pas réinitialiser le mot de passe de l'un de ses propres utilisateurs depuis l'interface. Tant que cela n'est pas livré, un administrateur MSSP le réinitialise avec le point de terminaison ci-dessus, ou un opérateur le réinitialise directement sur la ligne de la base de données.

## Usurpation et changement de contexte tenant

Les utilisateurs côté MSSP (`platform_admin`, `mssp_admin`, `mssp_manager`, `analyst`) peuvent limiter leur session à un tenant spécifique via `POST /api/auth/assume-tenant`. Les utilisateurs côté tenant ne le peuvent pas ; ils sont déjà fixés à leur propre tenant. L'interface expose cela sous la forme de la pastille **Tenant : \<name\>** en haut à droite de l'[interface MSSP](/fr-fr/mssp-ui) : cliquer sur un tenant épingle la session à la vue de ce client, et **Clear** revient à la portée inter-tenants. Les actions modifiant l'état effectuées pendant cette portée s'exécutent en tant qu'utilisateur d'origine avec la session liée à ce tenant.

Il ne s'agit pas d'une usurpation d'un autre utilisateur ; l'identité de la session reste la même. Une surface de type « prendre le contrôle de la session d'un utilisateur spécifique » est prévue.

## Sessions

| Stockage de session | Nom du cookie | Durée de vie |
|---|---|---|
| Session interface MSSP | `soctalk_session` | 12 h absolu + 30 min d'inactivité |
| Session portail client | `soctalk_session` | 12 h absolu + 30 min d'inactivité |
| Session assistant | `soctalk_session` | jusqu'à la sortie de l'assistant |

`POST /api/auth/logout` révoque uniquement la session courante. Désactiver un utilisateur tenant, et réinitialiser le mot de passe de n'importe quel utilisateur, révoquent toutes les sessions de cet utilisateur. Pour révoquer toutes les sessions d'un utilisateur MSSP sans réinitialisation de mot de passe, définissez `revoked_at` directement sur ses lignes `sessions` dans Postgres ; il n'y a pas encore d'API admin pour cela. La rotation de la clé de signature JWT ne révoque pas les sessions par cookie adossées à la base de données ; la recherche se fait sur la ligne en base, non sur la signature du JWT.

Un inventaire de session en lecture seule (`GET /api/auth/sessions`) est prévu.

## SSO / authentification par proxy

Le runtime prend en charge `SOCTALK_AUTH_MODE=proxy`, où SocTalk fait confiance à un proxy OIDC amont (OAuth2-Proxy, Keycloak, Dex) pour authentifier la requête. L'identité est résolue à partir de l'en-tête `X-Forwarded-Email`, mise en correspondance par e-mail avec une ligne utilisateur existante. Le mode d'authentification lui-même n'est pas exposé aujourd'hui comme un réglage des valeurs du chart ; définissez la variable d'environnement directement sur le Deployment `soctalk-system-api` après l'installation. Les CIDR de proxy de confiance sont adossés au chart via `oidc.trustedProxyCIDRs`.

En mode proxy, le routeur d'authentification par mot de passe n'est pas monté du tout, de sorte que `/api/auth/login`, `/api/auth/password/change`, la réinitialisation de mot de passe par l'administrateur, ainsi que `/api/auth/me`, `/api/auth/logout` et `/api/auth/assume-tenant` sont absents. L'init de bootstrap du chart amorce toujours la ligne Organization et, si `install.bootstrapAdmin.password` est défini, l'utilisateur `mssp_admin`. Continuez à définir `bootstrapAdmin` même en mode proxy : le provisionnement d'utilisateur à la volée à la première requête authentifiée n'est pas implémenté, de sorte que sans un utilisateur amorcé mis en correspondance par e-mail avec l'identité de votre IdP, aucune requête authentifiée par proxy ne peut être résolue vers une ligne utilisateur.

L'assignation de rôle en mode proxy se fait à la création de l'utilisateur dans la base de données. Le runtime fait confiance à l'e-mail transféré pour l'identité mais ne lit pas les en-têtes de groupe et ne promeut pas automatiquement en fonction de l'appartenance à un groupe. Une correspondance configurable entre groupe IdP et rôle SocTalk est prévue.

Détails complets : [Authentification interne](/fr-fr/reference/internal-auth).

## Audit

La création d'utilisateur, les changements de rôle/statut et la désactivation écrivent des lignes `user.create`, `user.update` et `user.delete` dans le journal d'audit (avec l'état de rôle et d'activité avant/après sur les mises à jour), et les réinitialisations de mot de passe sont également auditées. Notez que la vue `/api/audit` actuelle dans l'interface lit le flux d'événements d'enquête, non la table `audit_log`, de sorte que ces lignes de gestion des utilisateurs sont interrogeables directement dans `audit_log` mais n'apparaissent pas encore dans cet écran.
