# REST API

L'API SocTalk est une application FastAPI. Sa surface complète est générée depuis
le code sous forme de schéma OpenAPI et servie **sous `/api/`** (l'ingress route
`/api/*` vers l'API et tout le reste vers la console web) :

- **OpenAPI JSON** : `https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI** : `https://mssp.your-mssp.example/api/docs`
- **ReDoc** : `https://mssp.your-mssp.example/api/redoc`

La surface OpenAPI fait foi. Un instantané de celle-ci est livré avec cette
documentation à l'adresse [`/openapi.json`](/openapi.json), et le catalogue
ci-dessous est **généré à partir de ce schéma** — il ne peut pas diverger du code.

::: tip Régénérer le catalogue
Le catalogue des endpoints est produit par `npm run gen:api`, qui lit
`docs/public/openapi.json`. Rafraîchissez d'abord le schéma depuis le code de
l'API :

```bash
# dans le dépôt soctalk
python scripts/dump_openapi.py <soctalk-docs>/docs/public/openapi.json
# dans soctalk-docs
npm run gen:api
```

Tout ce qui se trouve entre les marqueurs `GENERATED` est écrasé ; la prose qui
l'entoure est rédigée à la main.
:::

## Catalogue des endpoints

La colonne **Auth** est dérivée du garde `require_role` /
`require_tenant_role` de chaque route. Une étiquette `session cookie` signifie
que *toute* session authentifiée est acceptée au niveau du handler — mais les
rôles à portée tenant restent confinés à leurs propres données par la sécurité
au niveau des lignes (RLS), de sorte qu'un `tenant_admin` ne voit que les lignes
de son tenant, même sur une route non gardée de type MSSP.

<!-- BEGIN GENERATED:endpoints (do not edit — npm run gen:api) -->

_146 operations across 33 groups, generated from the OpenAPI schema (API version `0.2.0`). Auth is derived from the route's `require_role` / `require_tenant_role` guards._

### `auth`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `POST` | `/api/auth/assume-tenant` | Assume Tenant | session cookie (login) / none |
| `POST` | `/api/auth/login` | Login | session cookie (login) / none |
| `POST` | `/api/auth/logout` | Logout | session cookie (login) / none |
| `GET` | `/api/auth/me` | Me | session cookie (login) / none |
| `POST` | `/api/auth/password/change` | Password Change | session cookie (login) / none |

### `auth-admin`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `POST` | `/api/mssp/users/{user_id}/password/reset` | Admin Reset | session cookie |

### `authz-facts-mssp`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `POST` | `/api/mssp/tenants/{tenant_id}/authorization/answer` | Mssp Answer Authorization | session cookie |
| `GET` | `/api/mssp/tenants/{tenant_id}/authorization/facts` | Mssp List Facts | session cookie |
| `POST` | `/api/mssp/tenants/{tenant_id}/authorization/facts` | Mssp Create Fact | session cookie |
| `POST` | `/api/mssp/tenants/{tenant_id}/authorization/facts/{fact_id}/review` | Mssp Review Fact | session cookie |
| `POST` | `/api/mssp/tenants/{tenant_id}/authorization/facts/{fact_id}/revoke` | Mssp Revoke Fact | session cookie |

### `chat`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/chat/conversations` | List Conversations | session cookie |
| `POST` | `/api/chat/conversations` | Create Conversation | session cookie |
| `GET` | `/api/chat/conversations/{conv_id}` | Get Conversation | session cookie |
| `DELETE` | `/api/chat/conversations/{conv_id}` | Delete Conversation | session cookie |
| `POST` | `/api/chat/conversations/{conv_id}/messages` | Post Message | session cookie |
| `POST` | `/api/chat/conversations/{conv_id}/messages/{msg_id}/confirm` | Confirm Action | session cookie |
| `POST` | `/api/chat/conversations/{conv_id}/stop` | Stop Conversation | session cookie |

### `health`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/health/live` | Live | none (public) |
| `GET` | `/health/ready` | Ready | none (public) |

### `internal-adapter`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/internal/adapter/checkpoint` | Get Checkpoint | service JWT (adapter token) |
| `PUT` | `/api/internal/adapter/checkpoint` | Put Checkpoint | service JWT (adapter token) |
| `GET` | `/api/internal/adapter/config` | Fetch Config | service JWT (adapter token) |
| `POST` | `/api/internal/adapter/events` | Ingest Events | service JWT (adapter token) |
| `POST` | `/api/internal/adapter/heartbeat` | Heartbeat | service JWT (adapter token) |

### `internal-authorization`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/internal/authorization/facts` | List Facts | session cookie |
| `POST` | `/api/internal/authorization/facts` | Submit Facts | session cookie |
| `POST` | `/api/internal/authorization/facts/{fact_id}/revoke` | Revoke | session cookie |

### `internal-worker`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `POST` | `/api/internal/worker/runs/{run_id}/complete` | Complete Run | service JWT (worker token) |
| `POST` | `/api/internal/worker/runs/{run_id}/heartbeat` | Heartbeat Run | service JWT (worker token) |
| `POST` | `/api/internal/worker/runs/claim` | Claim Run | service JWT (worker token) |

### `investigations-bridge`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/investigations` | List Investigations | session cookie |
| `GET` | `/api/investigations/{investigation_id}` | Get Investigation | session cookie |
| `POST` | `/api/investigations/{investigation_id}/cancel` | Post Cancel Investigation | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/investigations/{investigation_id}/events` | Get Events | session cookie |

### `ir-alerts`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/alerts` | List Alerts | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |

### `ir-engagements`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/engagements` | List Engagements Route | session cookie |
| `POST` | `/api/mssp/tenants/{tenant_id}/engagements` | Declare Engagement Route | session cookie |
| `POST` | `/api/mssp/tenants/{tenant_id}/engagements/{engagement_id}/revoke` | Revoke Engagement Route | session cookie |

### `ir-integrations`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/integrations` | Get Integrations | session — roles: mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/integrations` | Patch Integrations | session — roles: mssp_admin / platform_admin |

### `ir-mssp`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/investigations` | List Cases Mssp | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}` | Get Case Mssp | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}/events` | List Case Events Mssp | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `PATCH` | `/api/mssp/investigations/{investigation_id}/facts` | Patch Case Facts | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `POST` | `/api/mssp/investigations/{investigation_id}/messages` | Post Analyst Message | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |

### `ir-playbooks`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/playbooks` | List Triage Policies Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/playbooks` | List Authored Triage Policies Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/playbooks` | Create Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `PUT` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}` | Update Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}` | Retire Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}/activate` | Activate Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}/deactivate` | Deactivate Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}/export` | Export Authored Triage Policy Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/triage-policies` | List Authored Triage Policies Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/triage-policies` | Create Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `PUT` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}` | Update Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}` | Retire Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}/activate` | Activate Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}/deactivate` | Deactivate Authored Triage Policy Route | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}/export` | Export Authored Triage Policy Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |

### `ir-proposals`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/proposals` | List Pending Proposals | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `POST` | `/api/mssp/proposals/{proposal_id}/approve` | Approve Proposal Route | session cookie |
| `POST` | `/api/mssp/proposals/{proposal_id}/reject` | Reject Proposal Route | session cookie |

### `ir-response-playbooks`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/response-playbooks` | List Authored Response Playbooks Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/response-playbooks` | Create Authored Response Playbook Route | session — roles: mssp_admin / platform_admin |
| `PUT` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}` | Update Authored Response Playbook Route | session — roles: mssp_admin / platform_admin |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}` | Retire Authored Response Playbook Route | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}/activate` | Activate Authored Response Playbook Route | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}/deactivate` | Deactivate Authored Response Playbook Route | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}/export` | Export Authored Response Playbook Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |

### `ir-tenant`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/investigations` | List Cases Tenant | tenant session (customer_viewer / tenant_admin / tenant_analyst / tenant_manager) |
| `GET` | `/api/tenant/investigations/{investigation_id}` | Get Case Tenant | tenant session (customer_viewer / tenant_admin / tenant_analyst / tenant_manager) |
| `PATCH` | `/api/tenant/investigations/{investigation_id}/facts` | Tenant Patch Case Facts | tenant session |
| `POST` | `/api/tenant/investigations/{investigation_id}/messages` | Tenant Post Analyst Message | tenant session |

### `ir-triage-policies`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/triage-policies` | List Triage Policies Route | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |

### `l2-agent`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `POST` | `/api/agent/heartbeat` | Heartbeat | L2 agent install token (bearer) |
| `POST` | `/api/agent/jobs:claim` | Claim Job | L2 agent install token (bearer) |
| `POST` | `/api/agent/jobs/{job_id}/complete` | Complete Job | L2 agent install token (bearer) |
| `POST` | `/api/agent/jobs/{job_id}/events` | Post Event | L2 agent install token (bearer) |
| `POST` | `/api/agent/register` | Register | L2 agent install token (bearer) |

### `legacy-stubs`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/analytics/ai-behavior` | Analytics Ai Behavior | session cookie |
| `GET` | `/api/analytics/human-review` | Analytics Human Review | session cookie |
| `GET` | `/api/analytics/kpis` | Analytics Kpis | session cookie |
| `GET` | `/api/analytics/outcomes` | Analytics Outcomes | session cookie |
| `GET` | `/api/analytics/summary` | Analytics Summary | session cookie |
| `GET` | `/api/audit` | Audit List | session cookie |
| `GET` | `/api/audit/event-types` | Audit Event Types | session cookie |
| `GET` | `/api/audit/investigation/{investigation_id}` | Audit Investigation | session cookie |
| `GET` | `/api/audit/stats` | Audit Stats | session cookie |
| `GET` | `/api/events/stream` | Events Stream | session cookie |
| `GET` | `/api/review/{review_id}` | Review Detail | session cookie |
| `POST` | `/api/review/{review_id}/approve` | Review Approve | session cookie |
| `POST` | `/api/review/{review_id}/expire` | Review Expire | session cookie |
| `POST` | `/api/review/{review_id}/reject` | Review Reject | session cookie |
| `POST` | `/api/review/{review_id}/request-info` | Review Request Info | session cookie |
| `GET` | `/api/review/pending` | Review Pending | session cookie |
| `GET` | `/api/settings` | Settings Get | session cookie |

### `metrics-bridge`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/metrics/hourly` | Hourly | session cookie |
| `GET` | `/api/metrics/overview` | Overview | session cookie |

### `mssp-analytics`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/analytics/heatmap` | Heatmap | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/analytics/ranking` | Ranking | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/analytics/trends` | Trends | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |

### `mssp-dashboard`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/dashboard/open-by-tenant` | Open By Tenant | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/dashboard/pending-reviews` | Pending Reviews | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/dashboard/repeated-iocs` | Repeated Iocs | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/dashboard/stuck-investigations` | Stuck Investigations | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/dashboard/tenant-health` | Tenant Health | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |

### `mssp-tenant-branding`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `PATCH` | `/api/mssp/tenants/{tenant_id}/branding` | Update Tenant Branding | session — roles: mssp_admin / platform_admin |

### `mssp-tenant-llm`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/llm` | Get Tenant Llm | session — roles: mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/llm` | Update Tenant Llm | session — roles: mssp_admin / platform_admin |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/llm/api-key` | Clear Tenant Llm Api Key | session — roles: mssp_admin / platform_admin |

### `mssp-tenants`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants` | List Tenants | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `POST` | `/api/mssp/tenants` | Create Tenant | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}` | Get Tenant | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:decommission` | Decommission Tenant | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:issue-agent` | Issue Agent | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:resume` | Resume Tenant | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry` | Retry Provisioning | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry-install` | Retry Install | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:suspend` | Suspend Tenant | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/adapter-status` | Get Tenant Adapter Status | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/events` | List Events | session — roles: analyst / mssp_admin / mssp_manager / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/external-siem` | Get Tenant External Siem | session — roles: mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/external-siem` | Update Tenant External Siem | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/onboard` | Onboard Tenant | session — roles: mssp_admin / platform_admin |

### `mssp-users`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/users` | List Mssp Users | session cookie |
| `POST` | `/api/mssp/users` | Create Mssp User | session cookie |
| `PATCH` | `/api/mssp/users/{user_id}` | Update Mssp User | session cookie |
| `POST` | `/api/mssp/users/{user_id}/deactivate` | Deactivate Mssp User | session cookie |

### `public-tenant`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/public/mssp-by-slug/{slug}` | Mssp By Slug | none (public) |
| `GET` | `/api/public/scope-by-slug/{slug}` | Scope By Slug | none (public) |
| `GET` | `/api/public/tenant-by-slug/{slug}` | Tenant By Slug | none (public) |

### `tenant-authz-facts`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/authorization/facts` | Tenant List Own Facts | tenant session |
| `POST` | `/api/tenant/authorization/facts` | Tenant Assert Fact | tenant session |

### `tenant-branding`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/branding` | Get Own Branding | tenant session (customer_viewer / tenant_admin / tenant_analyst / tenant_manager) |

### `tenant-engagements`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/engagements` | Tenant List Engagements Route | tenant session |
| `POST` | `/api/tenant/engagements` | Tenant Declare Engagement Route | tenant session |
| `POST` | `/api/tenant/engagements/{engagement_id}/revoke` | Tenant Revoke Engagement Route | tenant session |

### `tenant-llm`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/llm` | Tenant Get Llm | tenant session (tenant_admin) |
| `PUT` | `/api/tenant/llm/api-key` | Tenant Put Llm Key | tenant session (tenant_admin) |
| `DELETE` | `/api/tenant/llm/api-key` | Tenant Clear Llm Key | tenant session (tenant_admin) |

### `tenant-users`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/users` | List Tenant Users | tenant session |
| `POST` | `/api/tenant/users` | Create Tenant User | tenant session |
| `PATCH` | `/api/tenant/users/{user_id}` | Update Tenant User | tenant session |
| `POST` | `/api/tenant/users/{user_id}/deactivate` | Deactivate Tenant User | tenant session |

<!-- END GENERATED:endpoints -->

## Schéma d'authentification

Les navigateurs utilisent un cookie de session défini par `POST /api/auth/login`.
Les clients programmatiques peuvent au choix :

1. Piloter le flux de connexion (préférable pour les scripts éphémères) :
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. Émettre un token API à longue durée de vie (prévu ; pas encore exposé dans
   l'UI). Aujourd'hui, les seuls appelants sans cookie sont les pods **adapter**
   et **runs-worker** propres à chaque tenant, qui s'authentifient auprès de
   `/api/internal/*` avec des tokens à portée tenant que l'API émet et fait
   tourner (voir [Endpoints internes](#internal-endpoints)).

En mode `SOCTALK_AUTH_MODE=proxy`, l'API fait confiance aux en-têtes amont
`X-Forwarded-User` / `X-Forwarded-Email` / `X-Forwarded-Groups` et **toute** la
surface d'authentification par session est démontée — `/api/auth/*` (`login`,
`logout`, `me`, `assume-tenant`, `password/change`) **et**
`/api/mssp/users/{id}/password/reset` renvoient 404 (et non 405). Votre IdP est
propriétaire de la surface d'identité.

## CSRF

La protection CSRF est appliquée **globalement**, pas par préfixe :
`internal_session_middleware` valide l'en-tête `Origin` / `Referer` sur **chaque**
requête modifiant l'état (`POST` / `PUT` / `PATCH` / `DELETE`) qui porte le
cookie de session. Il s'agit d'une **validation d'en-tête**, et non d'un token de
cookie en double soumission (ce motif figurait dans des versions antérieures,
mais le runtime utilise la validation d'en-tête). Les origines acceptées
proviennent de `SOCTALK_PUBLIC_ORIGIN` (et de `SOCTALK_PUBLIC_ORIGIN_BASE` pour
les hôtes clients à slug générique), que le chart dérive de `ingress.hostnames`.
Les requêtes qui ne portent **aucun** cookie de session (par exemple les appels
par token bearer de l'adapter/worker, ou la requête de connexion elle-même) sont
exemptées. Les navigateurs envoient `Origin` automatiquement ; les clients non
navigateurs peuvent au choix :

- Faire correspondre `Origin` à l'un des noms d'hôtes acceptés, ou
- Définir `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>`
  indépendamment de la cible TCP réelle (l'étape d'onboarding
  [`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) utilise cette astuce).

## Flux courants

### Intégrer un tenant

```bash
curl -b jar -X POST https://mssp.../api/mssp/tenants/onboard \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme-corp",
    "display_name": "Acme Corp",
    "profile": "persistent"
  }'
```

`profile` est validé côté serveur contre `^(poc|persistent|provided)$`. Voir
[cycle de vie / profils du tenant](/fr-fr/tenant-lifecycle#profiles) pour la
sémantique de chaque valeur. Pour `provided` (BYO-Wazuh), la charge utile
nécessite en plus un objet `external_siem` (URL de l'indexer, URL de l'API
Manager, identifiants basic-auth) ainsi qu'une `llm_api_key` propre au tenant ;
le serveur renvoie 422 avec des erreurs au niveau des champs si l'un d'eux
manque.

Renvoie 202 avec l'ID du nouveau tenant. Surveillez
`GET /api/mssp/tenants/{id}` pour les transitions d'état, ou interrogez
`GET /api/mssp/tenants/{id}/events` pour la liste des événements du cycle de vie.
(`/api/events/stream` existe mais n'émet que des pings de maintien de connexion
dans cette version.)

### Obtenir le journal d'audit

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed&page=1&page_size=50'
```

Le routeur d'audit est au niveau supérieur (`/api/audit`), pas sous `/api/mssp/`.
Filtres : `start_date` / `end_date` (ISO 8601), `event_type`, `aggregate_type`
et `investigation_id`. Les résultats sont paginés par décalage avec `page` /
`page_size`.

### Soumettre une décision de revue humaine

Le routeur de revue expose un endpoint par décision (pas de chemin `/decision`
unique). Choisissez celui qui correspond :

```bash
# Approuver — le champ de la charge utile est `feedback` (texte libre), pas `rationale`
curl -b jar -X POST https://mssp.../api/review/<review-id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"feedback":"Confirmed brute-force pattern."}'

# Rejeter — clôture le cas en auto_closed_fp ; `feedback` est optionnel
curl -b jar -X POST https://mssp.../api/review/<review-id>/reject \
  -d '{"feedback":"Looks like a known scanner; benign."}'

# Besoin de plus d'informations — la charge utile est `questions: list[str]` (chacune s'affiche en puce)
curl -b jar -X POST https://mssp.../api/review/<review-id>/request-info \
  -d '{"questions":["What is the source IP geo?","Any prior alerts on this user?"]}'

# Expirer — retire une revue en attente sans verdict (motif optionnel)
curl -b jar -X POST https://mssp.../api/review/<review-id>/expire \
  -d '{"reason":"superseded by newer investigation"}'
```

Les quatre renvoient 409 si la revue n'est plus `pending`.

Pour les propositions IR (la surface de gestion des cas), les endpoints
équivalents sont sous `/api/mssp/proposals/{id}/approve` et
`/api/mssp/proposals/{id}/reject`.

### Diffuser les événements

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events. **Dans cette version, le flux n'émet que des pings de
maintien de connexion** (un `ping` environ toutes les 25 s) — la diffusion des
événements de domaine (mises à jour d'enquêtes, cycle de vie des tenants, etc.)
figure sur la feuille de route. Considérez cet endpoint comme un test de
connectivité au niveau du fil aujourd'hui.

## Générer un client Python

Le schéma se génère proprement, donc le moyen le plus rapide d'appeler l'API
depuis Python est de générer un client typé avec
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
plutôt que d'écrire des requêtes à la main. Voici le processus de bout en bout,
qui lit les enquêtes.

### 1. Générer + installer le client

```bash
pip install openapi-python-client
openapi-python-client generate \
  --url https://mssp.your-mssp.example/api/openapi.json --meta setup
pip install ./soc-talk-v1-client   # package name derives from the schema title
```

### 2. Consommer les enquêtes

```python
import httpx
from soc_talk_v1_client import Client
from soc_talk_v1_client.api.investigations_bridge import (
    list_investigations_api_investigations_get as list_investigations,
    get_investigation_api_investigations_investigation_id_get as get_investigation,
)

BASE = "https://mssp.your-mssp.example"

# 1. Log in for a session cookie (the investigations routes take a session).
with httpx.Client(base_url=BASE) as h:
    h.post("/api/auth/login",
           json={"email": "admin@example", "password": "..."}).raise_for_status()
    session = h.cookies["soctalk_session"]

# 2. Drive the generated, typed client with that cookie.
client = Client(base_url=BASE, cookies={"soctalk_session": session})

page = list_investigations.sync(client=client, page=1, page_size=5)  # -> InvestigationList
print(f"{page.total} investigations")
for inv in page.items:                                               # -> Investigation
    print(inv.id, inv.status, inv.max_severity, inv.title)

detail = get_investigation.sync(client=client, investigation_id=str(page.items[0].id))
print(detail.phase, detail.alert_count, detail.verdict_decision)
```

Les fonctions d'endpoint sont nommées d'après l'operationId que FastAPI dérive de
la route (`list_investigations_api_investigations_get`) — donnez-leur un alias à
l'import, comme ci-dessus, pour plus de lisibilité. `sync()` renvoie le modèle
désérialisé (`InvestigationList`, dont les `.items` sont des `Investigation`) ;
`sync_detailed()` renvoie la `Response` brute avec le code de statut si vous en
avez besoin.

Une version exécutable — générer, se connecter, lister + lire — est livrée en
tant que test de fumée du codegen
[`tests/e2e/smoke_openapi_client.py`](https://github.com/soctalk/soctalk/blob/main/tests/e2e/smoke_openapi_client.py),
que le pipeline de déploiement exécute contre l'API en direct, de sorte qu'un
schéma qui cesse de générer un client fonctionnel fait échouer le build.

## Endpoints internes (`/api/internal/*`)

Utilisés par l'adapter et le runs-worker propres à chaque tenant (voir les
groupes `internal-adapter` et `internal-worker` dans le catalogue ci-dessus). Pas
destinés à une consommation humaine — listés pour que les MSSP puissent voir ce
que font ces pods.

Chaque appel porte un token à portée tenant que l'API émet au provisionnement et
**renouvelle automatiquement** avant son expiration (les tokens de l'adapter
vivent 7 jours, ceux du worker 30 jours ; le plan de contrôle les ré-émet bien
avant cette échéance). Les tokens sont liés au tenant — un adapter ne peut agir
que sur les URLs de son propre tenant.

## Limites de débit

L'API elle-même n'impose pas de limites de débit par route dans cette version.
Utilisez la couche ingress pour une limitation de débit globale (middleware
Traefik, annotations ingress-nginx) si vous en avez besoin.

## Gestion des versions

Le document OpenAPI porte la version de l'application. Nous visons des
changements additifs au sein d'une version mineure ; les changements incompatibles
n'ont lieu que lors d'un bump majeur. Les [notes de version](https://github.com/soctalk/soctalk/releases)
signalent chaque changement affectant l'API.

## Points d'entrée dans le code source

Tous les routeurs se trouvent sous `src/soctalk/core/api/`.

| Concept | Fichier |
|---|---|
| Routeur d'authentification + middleware de session | [`core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py), [`core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| Cycle de vie des tenants MSSP | [`core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| Configuration LLM par tenant | [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
| Enquêtes / IR / propositions | [`core/api/investigations_bridge.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/investigations_bridge.py), [`core/api/ir.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/ir.py) |
| Audit / revue / analytics / paramètres / événements (stubs) | [`core/api/legacy_stubs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/legacy_stubs.py) |
| Chat | [`core/api/chat.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/chat.py) |
| Routes worker (internes) | [`core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Routes adapter (internes) | [`core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| Générateur OpenAPI | [`scripts/dump_openapi.py`](https://github.com/soctalk/soctalk/blob/main/scripts/dump_openapi.py) |
