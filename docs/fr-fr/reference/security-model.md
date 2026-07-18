# Modèle de sécurité

Catalogue des principaux, matrice acteur×ressource, matrice de politiques RLS, modèle de rôles Postgres, classification des endpoints, schémas de claims de token, exigences d'audit, emplacement des secrets.

> **Note de déploiement V1.** Les exemples d'endpoints ci-dessous (par ex. `/api/mssp/impersonate/:tenant_id`, `/api/mssp/users` POST/list, `/api/mssp/fleet/summary`) et plusieurs entrées de principaux (émetteur de licence Cloud ; l'acteur d'usurpation d'identité) décrivent la **surface de sécurité cible**. Les endpoints MSSP montés incluent : CRUD de Tenant, audit (`/api/audit`), gestion des utilisateurs du personnel (`/api/mssp/users` create/list/patch/deactivate et `/{id}/password/reset`), et `/api/auth/assume-tenant` pour le cadrage de session-tenant (pas l'usurpation d'identité d'utilisateur). La gestion en libre-service des utilisateurs par le Tenant réside sous `/api/tenant/users`. Utilisez les matrices ci-dessous comme intention de conception ; consultez [REST API](/fr-fr/reference/api) pour ce qui est réellement en service.

## Catalogue des principaux

Huit principaux.

| # | Principal | Catégorie | Portée | S'authentifie via |
|---|---|---|---|---|
| 1 | **User** (rôle ∈ {platform_admin, mssp_admin, mssp_manager, analyst, tenant_admin, tenant_manager, tenant_analyst, customer_viewer}) | Humain | Dérivée du rôle | OIDC en entrée → JWT SocTalk |
| 2 | **Worker** | Service SocTalk (arrière-plan) | Un Tenant par job | JWT de service, à courte durée de vie, émis par l'API SocTalk au dispatch |
| 3 | **System** | Service SocTalk (opérations inter-Tenant) | À l'échelle de l'installation, contournement RLS | Contrôlé par chemin de code ; pas de JWT |
| 4 | **SocTalk K8s ServiceAccount** | Service SocTalk (identité K8s) | Cluster, cadré par convention de nommage sur `tenant-*` | Token projeté K8s |
| 5 | **Tenant adapter** | Sidecar du plan de données | Tenant unique, appelle uniquement l'API SocTalk | JWT d'adapter, cadré par Tenant, à courte durée de vie |
| 6 | **Wazuh agent** | Agent d'endpoint externe | Le Wazuh manager d'un seul Tenant | Enrôlement Wazuh `authd` → mTLS par agent |
| 7 | **MSSP cluster admin** | Humain, hors bande | Cluster entier (illimité) | Identifiants `kubectl` |
| 8 | **Cloud license issuer** | Ancre de confiance | Autorité de signature hors ligne | Clé Ed25519 dans HSM/KMS (version future) |

### Rôles utilisateur

Les rôles sont des ensembles de capacités organisés en trois niveaux par audience (operate ⊆ authorize-risk ⊆ configure) ; le côté Tenant ajoute un intervenant en lecture seule sous operate. Voir [Utilisateurs et rôles](/fr-fr/users-and-roles) pour le modèle de capacités.

Côté MSSP (`tenant_id` NULL) :

| Rôle | Niveau | Fonction typique |
|---|---|---|
| `platform_admin` | configure (super) | Toutes les capacités MSSP, à l'échelle de l'installation. |
| `mssp_admin` | configure | Configurer le système, gérer les utilisateurs du personnel, plus tout ce qui suit. |
| `mssp_manager` | authorize-risk | Déclarer des engagements, curer les faits d'autorisation, approuver les actions à fort impact, plus operate. |
| `analyst` | operate | Trier, examiner les verdicts, décider, discuter ; travaille un Tenant via un pin Open-SOC. |

Côté Tenant (`tenant_id` défini) :

| Rôle | Niveau | Fonction typique |
|---|---|---|
| `tenant_admin` | configure | Gérer les utilisateurs de sa propre organisation et les paramètres LLM, plus tout ce qui suit. |
| `tenant_manager` | authorize-risk | Déclarer ses propres engagements, affirmer des faits d'autorisation (examinés par le MSSP), plus operate. |
| `tenant_analyst` | operate | Travailler le SOC de son propre Tenant : trier, examiner les verdicts, décider, discuter. |
| `customer_viewer` | vue seule | Tableaux de bord et enquêtes en lecture seule ; ne peut pas agir ni ouvrir la file de revue. |

Dérivation de la portée : `role ∈ {platform_admin, mssp_admin, mssp_manager, analyst}` ⇒ `tenant_id` NULL en base, accès inter-Tenant via un rôle Postgres élevé ou le cadrage de session-tenant (`/api/auth/assume-tenant`). `role ∈ {tenant_admin, tenant_manager, tenant_analyst, customer_viewer}` ⇒ `tenant_id` requis dans la ligne utilisateur et le JWT. Les capacités MSSP et les capacités Tenant ne se recoupent jamais ; le garde-fou sur chaque route vérifie ensemble la capacité et l'audience.

### Discipline du principal Worker

Chaque job d'arrière-plan doit porter `tenant_id` dans sa payload. Les points d'entrée des Workers sont décorés avec `@tenant_scoped_worker` qui définit `app.current_tenant_id` avant tout accès à la base. Les Workers se connectent avec le rôle Postgres `soctalk_app` et sont soumis à la RLS : oublier de définir le contexte donne zéro ligne, pas une fuite inter-Tenant.

### Discipline du principal System

Les opérations inter-Tenant (regroupements MSSP, migrations, outillage d'administration) utilisent le principal `System` via un gestionnaire de contexte Python `system_context()`. L'entrée émet une ligne d'audit. Le gestionnaire de contexte est l'unique porte. `import-linter` empêche son import en dehors des modules système désignés. Le principal System se connecte avec le rôle Postgres `soctalk_mssp` qui possède `BYPASSRLS`.

## Catalogue des ressources

### Ressources de base de données (cadrées par Tenant)

Toutes ont une FK `tenant_id` et sont soumises à la RLS :

- `Event` — magasin d'événements, en ajout seul
- `InvestigationReadModel` — état d'enquête projeté
- `MetricsHourly`, `IOCStats`, `RuleStats`, `AnalyzerStats` — projections par Tenant
- `PendingReview` — file HIL
- `IntegrationConfig` — URLs, endpoints et seuils d'intégration par Tenant
- `BrandingConfig` — nom de l'application, logo et couleurs par Tenant
- `TenantSecret` — références (ns + name + version) vers des Secrets K8s ; pas de matériel brut
- `TenantLifecycleEvent` — journal en ajout seul des transitions d'état du Tenant, révisions de configuration
- `AuditLog` — journal en ajout seul des actions de mutation, avec `mssp_user_id` lorsqu'effectuées via usurpation d'identité

### Ressources de base de données (cadrées par installation)

Pas de `tenant_id` ; cadrées par Organization ou globales :

- `Organization` — à l'échelle de l'installation (mssp_id, mssp_name, install_id, install_label, license_jwt réservé)
- `User` — à la fois les utilisateurs côté MSSP (tenant_id nullable) et les utilisateurs client (tenant_id requis)
- La sémantique utilisateur MSSP / utilisateur Tenant est dérivée du rôle + de la présence de tenant_id ; table unique
- `Release` — métadonnées de version SocTalk (à l'échelle de l'installation)
- Paramètres d'installation (feature flags, bascules à l'échelle du système)

### Ressources Kubernetes

| Ressource | Portée | Gérée par |
|---|---|---|
| Namespace `soctalk-system` | Niveau installation | MSSP cluster admin (créé par Helm) |
| Namespace `tenant-<slug>` | Par Tenant | SocTalk K8s ServiceAccount (verbes cluster) |
| `Deployment`, `Service`, `PVC`, `Secret`, `ConfigMap`, `NetworkPolicy`, `ResourceQuota`, `LimitRange`, `ServiceAccount`, `Role`, `RoleBinding` dans `tenant-*` | Par Tenant | SocTalk K8s ServiceAccount |

## Matrice acteur × ressource

`R` = lecture, `W` = écriture, `-` = refus.

| Groupe de ressources | `platform_admin` | `mssp_admin` | `analyst` | `customer_viewer` | `Worker` | `System` | `SocTalk K8s SA` | `Tenant adapter` |
|---|---|---|---|---|---|---|---|---|
| DB cadrée par Tenant (propre Tenant) | RW (tout) | RW (tout) | RW (tout) | R (propre) | RW (Tenant du job) | RW (tout via contournement) | - | - |
| DB cadrée par installation | RW | R (hors licence) | R | - | R | RW | - | - |
| Gestion des utilisateurs (côté MSSP) | RW | RW | - | - | - | RW | - | - |
| Gestion des utilisateurs (côté Tenant, propre Tenant) | - | - | - | - | - | - | - | - |
| Journal d'audit (propre Tenant) | R tout | R tout | R tout | R propre | W | W | - | W (via bootstrap) |
| Namespaces K8s `tenant-*` | (via API uniquement) | (via API uniquement) | (via API uniquement) | - | - | - | CRUD | - |
| Ressources K8s au sein de `tenant-*` | (via API uniquement) | (via API uniquement) | (via API uniquement) | - | - | - | CRUD | R propre |
| Secret LLM par Tenant | - | - | - | - | R (propre Tenant) | - | montage | - |
| Secrets d'intégration par Tenant | - | - | - | - | R (propre Tenant) | - | montage | - |

Notes :
- Les colonnes montrent un sous-ensemble représentatif de rôles. `mssp_manager` se situe entre `mssp_admin` et `analyst` (niveau authorize-risk) ; `tenant_manager` et `tenant_analyst` se situent au-dessus de `customer_viewer` côté Tenant. Chacun détient toutes les capacités du niveau inférieur.
- La gestion des utilisateurs est cloisonnée par capacité selon l'audience. Les utilisateurs du personnel MSSP sont gérés uniquement par `mssp_admin`/`platform_admin` via `/api/mssp/users` ; les utilisateurs Tenant sont gérés uniquement par le `tenant_admin` de ce Tenant via `/api/tenant/users`. Un administrateur MSSP ne gère pas les utilisateurs Tenant, et réciproquement. Attribuer `platform_admin`, et modifier un `platform_admin` existant, requiert un `platform_admin`.
- « via API uniquement » signifie que le principal humain déclenche les opérations K8s en appelant les endpoints de l'API SocTalk, non directement. Les handlers d'API utilisent le SocTalk K8s ServiceAccount.
- `analyst` agissant sur un Tenant écrit des lignes d'audit avec à la fois `user_id` et le `tenant_id` du Tenant ; la vue d'audit côté client les affiche comme entrées d'usurpation d'identité.

## Matrice de politiques RLS

Voir [RLS Postgres](/fr-fr/reference/postgres-rls) pour le SQL. Résumé :

| Table | Politique | `USING` | `WITH CHECK` |
|---|---|---|---|
| Toutes les tables cadrées par Tenant | `tenant_isolation` | `tenant_id = current_setting('app.current_tenant_id')::uuid` | identique |
| `User` (où `tenant_id IS NOT NULL`) | identique | identique | identique |
| `AuditLog` | `audit_read` | identique en lecture ; écritures autorisées depuis Worker + System | identique |
| Tables cadrées par installation | pas de RLS | — | — |

Toutes les tables cadrées par Tenant ont `FORCE ROW LEVEL SECURITY` de sorte que le propriétaire de la table (`soctalk_admin`) est également soumis à la RLS. Le principal System utilise le rôle `soctalk_mssp` (`BYPASSRLS`) pour traverser intentionnellement les Tenants.

## Classification des endpoints d'API

Trois catégories. Jamais un seul endpoint qui sert deux catégories.

### `/api/mssp/*` : côté MSSP (requiert un rôle MSSP ; la capacité spécifique varie selon la route)

Capable d'agir en inter-Tenant. Lorsqu'un handler nécessite une visibilité inter-Tenant (regroupements, vues de flotte), il utilise le principal `System` via `system_context()`. Lorsqu'un handler agit sur un Tenant spécifique (usurpation d'identité), il définit `app.current_tenant_id` et reste soumis à la RLS.

Exemples (cette version) : `POST /api/mssp/tenants/onboard`, `GET /api/mssp/tenants`, `POST /api/mssp/tenants/{id}:retry`, `POST /api/mssp/tenants/{id}:suspend|:resume|:decommission`, `GET /api/audit`, gestion des utilisateurs du personnel MSSP sous `/api/mssp/users`. (L'usurpation d'identité et les regroupements de flotte sont sur la feuille de route.)

### `/api/tenant/*` : côté Tenant (requiert un rôle Tenant ; la capacité spécifique varie selon la route)

Fortement cadré. Contexte de Tenant issu du JWT ; pas d'entrée d'usurpation d'identité. Toutes les requêtes sont soumises à la RLS via `soctalk_app`. Inclut les surfaces operate pour `tenant_analyst`+ (triage, revue, chat) et le libre-service pour les engagements, les faits d'autorisation et les utilisateurs.

Exemples : `GET /api/tenant/overview`, `GET /api/tenant/incidents`, `GET /api/tenant/reports`, `GET /api/tenant/audit`, `GET /api/tenant/branding`.

### `/api/internal/*` — Service à service (Worker JWT ou Adapter JWT)

Non exposé à l'utilisateur. JWT de service à courte durée de vie avec contexte de Tenant explicite. Exemples : `POST /api/internal/adapter/health`, `POST /api/internal/adapter/bootstrap`, `GET /api/internal/adapter/config`.

Aucun endpoint n'accepte à la fois la sémantique `/api/mssp/*` et `/api/tenant/*`. Si une capacité est nécessaire des deux côtés, elle est implémentée comme deux endpoints avec des autorisations différentes et des flux de contexte différents.

## Schémas de claims de token

### JWT utilisateur côté MSSP

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "iat": 1713475200,
  "exp": 1713478800,
  "jti": "<uuid>",
  "user_type": "mssp",
  "role": "platform_admin | mssp_admin | mssp_manager | analyst",
  "current_tenant": null
}
```

Lorsqu'un `mssp_admin` ou un `analyst` entre dans le contexte d'un Tenant, un nouveau token à courte durée de vie est émis avec `current_tenant: "<tenant_uuid>"`. Les tokens d'usurpation d'identité ont une TTL maximale de 30 minutes et sont journalisés au moment de l'émission.

### JWT utilisateur côté Tenant

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "user_type": "tenant",
  "role": "tenant_admin | tenant_manager | tenant_analyst | customer_viewer",
  "tenant_id": "<tenant_uuid>"
}
```

### JWT de service Worker

```json
{
  "iss": "soctalk",
  "sub": "worker",
  "user_type": "worker",
  "tenant_id": "<tenant_uuid>",
  "job_id": "<uuid>",
  "job_type": "triage | enrich | decide | ..."
}
```

### JWT d'Adapter

```json
{
  "iss": "soctalk",
  "sub": "adapter",
  "user_type": "adapter",
  "tenant_id": "<tenant_uuid>",
  "scope": "adapter"
}
```

Les JWT d'Adapter sont rafraîchis chaque semaine ; la rotation est une réécriture de secret côté contrôleur SocTalk dans le namespace du Tenant.

## Exigences d'audit

Chaque mutation écrit une ligne `AuditLog` avec :

- `id` (uuid), `timestamp`, `tenant_id` (nullable pour les événements cadrés par installation)
- `actor_principal` (User | Worker | System | Adapter)
- `actor_id` (user_id | `worker:<job_id>` | `system:<reason>` | tenant_id de l'adapter)
- `action` (enum : `tenant.create`, `tenant.suspend`, `investigation.approve`, `settings.update`, `user.impersonate`, …)
- `resource_type`, `resource_id`
- `before`, `after` (instantanés JSON pour les actions modifiant l'état)
- `acting_as` (nullable ; défini lorsqu'un `mssp_admin` ou un `analyst` usurpe l'identité d'un Tenant)
- `request_id` (corrèle avec les lignes de log)

La rétention est de 90 jours ; configurable par installation dans une version future. Les clients peuvent consulter les lignes d'audit où `tenant_id = own`, y compris les entrées avec `acting_as` renseigné (transparence sur les actions MSSP). La vue d'audit inter-Tenant du MSSP s'exécute sous le principal `System`.

## Limites architecturales connues

- **Confiance envers le MSSP cluster admin.** Le principal #7 possède un accès K8s illimité. Le modèle d'isolation de SocTalk présume que ce principal est de confiance. Les clients exigeant une défense contre les menaces internes au niveau MSSP ont besoin d'un cloisonnement par nœud dédié ou par VM dédiée (version future).
- **Portée de la frontière d'admission.** `ValidatingAdmissionPolicy` contraint le ServiceAccount du contrôleur SocTalk pour les namespaces de Tenant et les mutations de ressources cadrées par namespace, mais les utilisateurs MSSP cluster-admin restent des opérateurs break-glass de confiance. Kyverno est un chemin de durcissement futur optionnel.
- **Aucune application des licences actuellement.** Le JWT de licence et les feature gates sont reportés à une version future. Les MSSP pilotes fonctionnent sur l'honneur.
- **Cache de réponses LLM.** Clé sur `(tenant_id, prompt_hash)` dès le premier jour. En cas d'assouplissement, risque de fuite de contenu inter-Tenant ; la suite de tests vérifie la composition de la clé.
- **Abonnements SSE.** Cadrés par Tenant au moment de l'abonnement. Des bugs de persistance de connexion pourraient délivrer des événements inter-Tenant sur un abonnement obsolète ; test explicite d'isolation SSE dans la barrière d'implémentation.
- **Fuite de contexte Worker.** Chaque point d'entrée de Worker doit définir `app.current_tenant_id`. Le comportement défensif par défaut est zéro ligne sous RLS, pas une fuite inter-Tenant, mais la suite de tests vérifie la défense.

## Exigences de test

1. **Sonde d'API inter-Tenant.** Pour chaque endpoint `/api/tenant/*` et `/api/mssp/*` qui accède à des données cadrées par Tenant, élaborez des requêtes en tant que Tenant A qui tentent des lectures ou écritures de ressources du Tenant B. Vérifiez 0 ligne ou 403.
2. **Sonde RLS SQL brut.** Connectez-vous en tant que `soctalk_app`, définissez `app.current_tenant_id = A`, exécutez `SELECT * FROM events` (non filtré) ; vérifiez que seules les lignes du Tenant A sont retournées.
3. **Défaut de contexte Worker.** Dispatchez un job de Worker sans définir le contexte de Tenant ; vérifiez que les requêtes retournent 0 ligne (comportement de zéro défensif).
4. **Isolation SSE.** Abonnez-vous en tant que Tenant A au flux SSE des événements ; effectuez une mutation dans le Tenant B ; vérifiez qu'aucun événement n'est délivré sur le flux de A.
5. **Isolation du cache LLM.** Déclenchez des prompts identiques depuis le Tenant A et le Tenant B ; vérifiez les échecs de cache au second appel pour B (clé différente) et les succès au troisième appel pour A (même clé).
6. **Audit d'usurpation d'identité.** En tant que `mssp_admin`, usurpez l'identité du Tenant A, effectuez une mutation ; vérifiez qu'une ligne `AuditLog` existe avec `acting_as=<mssp_admin_id>` et `tenant_id=A` ; vérifiez que l'utilisateur client dans A peut lire la ligne.
7. **Audit de contexte System.** Déclenchez un appel `/api/mssp/fleet/summary` ; vérifiez une ligne d'audit pour l'entrée en contexte system avec motif.
