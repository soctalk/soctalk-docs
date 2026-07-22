# REST API

Die SocTalk-API ist eine FastAPI-Anwendung. Ihre vollständige Oberfläche wird aus
dem Code als OpenAPI-Schema generiert und **unter `/api/`** bereitgestellt (der
Ingress leitet `/api/*` an die API und alles Übrige an die Web-Konsole):

- **OpenAPI JSON**: `https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI**: `https://mssp.your-mssp.example/api/docs`
- **ReDoc**: `https://mssp.your-mssp.example/api/redoc`

Die OpenAPI-Oberfläche ist die maßgebliche Quelle. Ein Snapshot davon wird mit
dieser Dokumentation unter [`/openapi.json`](/openapi.json) ausgeliefert, und der
Katalog unten wird **aus diesem Schema generiert**: er kann nicht vom Code
abweichen.

::: tip Den Katalog neu generieren
Der Endpunkt-Katalog wird von `npm run gen:api` erzeugt, das
`docs/public/openapi.json` liest. Aktualisiere das Schema zuerst aus dem
API-Code:

```bash
# im soctalk-Repo
python scripts/dump_openapi.py <soctalk-docs>/docs/public/openapi.json
# in soctalk-docs
npm run gen:api
```

Alles zwischen den `GENERATED`-Markern wird überschrieben; die Prosa drumherum
wird von Hand gepflegt.
:::

## Endpunkt-Katalog

Die Spalte **Auth** leitet sich aus dem `require_role`- /
`require_tenant_role`-Guard jeder Route ab. Die Kennzeichnung `session cookie`
bedeutet, dass am Handler *jede* authentifizierte Session akzeptiert wird, aber
mandantengebundene Rollen bleiben durch Row-Level Security auf ihre eigenen Daten
beschränkt, sodass ein `tenant_admin` selbst auf einer ungeschützten
MSSP-artigen Route nur die Zeilen seines Mandanten sieht.

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
| `POST` | `/api/investigations/{investigation_id}/cancel` | Post Cancel Investigation | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/investigations/{investigation_id}/events` | Get Events | session cookie |

### `ir-alerts`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/alerts` | List Alerts | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |

### `ir-engagements`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/engagements` | List Engagements Route | session cookie |
| `POST` | `/api/mssp/tenants/{tenant_id}/engagements` | Declare Engagement Route | session cookie |
| `POST` | `/api/mssp/tenants/{tenant_id}/engagements/{engagement_id}/revoke` | Revoke Engagement Route | session cookie |

### `ir-integrations`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/integrations` | Get Integrations | session (roles: mssp_admin / platform_admin) |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/integrations` | Patch Integrations | session (roles: mssp_admin / platform_admin) |

### `ir-mssp`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/investigations` | List Cases Mssp | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/investigations/{investigation_id}` | Get Case Mssp | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/investigations/{investigation_id}/events` | List Case Events Mssp | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `PATCH` | `/api/mssp/investigations/{investigation_id}/facts` | Patch Case Facts | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `POST` | `/api/mssp/investigations/{investigation_id}/messages` | Post Analyst Message | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |

### `ir-playbooks`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/playbooks` | List Triage Policies Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/playbooks` | List Authored Triage Policies Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/playbooks` | Create Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `PUT` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}` | Update Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}` | Retire Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}/activate` | Activate Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}/deactivate` | Deactivate Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/playbooks/{triage_policy_id}/export` | Export Authored Triage Policy Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/triage-policies` | List Authored Triage Policies Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/triage-policies` | Create Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `PUT` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}` | Update Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}` | Retire Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}/activate` | Activate Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}/deactivate` | Deactivate Authored Triage Policy Route | session (roles: mssp_admin / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/triage-policies/{triage_policy_id}/export` | Export Authored Triage Policy Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |

### `ir-proposals`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/proposals` | List Pending Proposals | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `POST` | `/api/mssp/proposals/{proposal_id}/approve` | Approve Proposal Route | session cookie |
| `POST` | `/api/mssp/proposals/{proposal_id}/reject` | Reject Proposal Route | session cookie |

### `ir-response-playbooks`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/response-playbooks` | List Authored Response Playbooks Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/response-playbooks` | Create Authored Response Playbook Route | session (roles: mssp_admin / platform_admin) |
| `PUT` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}` | Update Authored Response Playbook Route | session (roles: mssp_admin / platform_admin) |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}` | Retire Authored Response Playbook Route | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}/activate` | Activate Authored Response Playbook Route | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}/deactivate` | Deactivate Authored Response Playbook Route | session (roles: mssp_admin / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/response-playbooks/{response_playbook_id}/export` | Export Authored Response Playbook Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |

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
| `GET` | `/api/mssp/triage-policies` | List Triage Policies Route | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |

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
| `GET` | `/api/mssp/analytics/heatmap` | Heatmap | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/analytics/ranking` | Ranking | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/analytics/trends` | Trends | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |

### `mssp-dashboard`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/dashboard/open-by-tenant` | Open By Tenant | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/dashboard/pending-reviews` | Pending Reviews | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/dashboard/repeated-iocs` | Repeated Iocs | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/dashboard/stuck-investigations` | Stuck Investigations | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/dashboard/tenant-health` | Tenant Health | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |

### `mssp-tenant-branding`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `PATCH` | `/api/mssp/tenants/{tenant_id}/branding` | Update Tenant Branding | session (roles: mssp_admin / platform_admin) |

### `mssp-tenant-llm`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/llm` | Get Tenant Llm | session (roles: mssp_admin / platform_admin) |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/llm` | Update Tenant Llm | session (roles: mssp_admin / platform_admin) |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/llm/api-key` | Clear Tenant Llm Api Key | session (roles: mssp_admin / platform_admin) |

### `mssp-tenants`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants` | List Tenants | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `POST` | `/api/mssp/tenants` | Create Tenant | session (roles: mssp_admin / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}` | Get Tenant | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}:decommission` | Decommission Tenant | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}:issue-agent` | Issue Agent | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}:resume` | Resume Tenant | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry` | Retry Provisioning | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry-install` | Retry Install | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/{tenant_id}:suspend` | Suspend Tenant | session (roles: mssp_admin / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/adapter-status` | Get Tenant Adapter Status | session (roles: mssp_admin / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/events` | List Events | session (roles: analyst / mssp_admin / mssp_manager / platform_admin) |
| `GET` | `/api/mssp/tenants/{tenant_id}/external-siem` | Get Tenant External Siem | session (roles: mssp_admin / platform_admin) |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/external-siem` | Update Tenant External Siem | session (roles: mssp_admin / platform_admin) |
| `POST` | `/api/mssp/tenants/onboard` | Onboard Tenant | session (roles: mssp_admin / platform_admin) |

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

## Auth-Schema

Browser verwenden ein Session-Cookie, das von `POST /api/auth/login` gesetzt
wird. Programmatische Clients können entweder:

1. Den Login-Flow durchlaufen (bevorzugt für kurzlebige Skripte):
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. Ein langlebiges API-Token ausstellen (geplant; in der UI noch nicht
   verfügbar). Heute sind die einzigen Nicht-Cookie-Aufrufer die
   mandantenspezifischen **Adapter**- und **runs-worker**-Pods, die sich mit
   mandantengebundenen Tokens, die die API ausstellt und rotiert, gegenüber
   `/api/internal/*` authentifizieren (siehe [Interne Endpunkte](#internal-endpoints)).

Im Modus `SOCTALK_AUTH_MODE=proxy` vertraut die API den vorgelagerten Headern
`X-Forwarded-User` / `X-Forwarded-Email` / `X-Forwarded-Groups`, und die
**gesamte** Session-Auth-Oberfläche wird ausgehängt, `/api/auth/*` (`login`,
`logout`, `me`, `assume-tenant`, `password/change`) **und**
`/api/mssp/users/{id}/password/reset` liefern 404 (nicht 405). Deine IdP besitzt
die Identitätsoberfläche.

## CSRF

CSRF wird **global** durchgesetzt, nicht pro Präfix:
`internal_session_middleware` validiert den `Origin`- / `Referer`-Header bei
**jeder** zustandsändernden Anfrage (`POST` / `PUT` / `PATCH` / `DELETE`), die das
Session-Cookie trägt. Es handelt sich um **Header-Validierung**, nicht um ein
Double-Submit-Cookie-Token (dieses Muster tauchte in früheren Entwürfen auf, aber
die Laufzeit verwendet Header-Validierung). Die akzeptierten Origins stammen aus
`SOCTALK_PUBLIC_ORIGIN` (und `SOCTALK_PUBLIC_ORIGIN_BASE` für
Slug-Wildcard-Kundenhosts), die das Chart aus `ingress.hostnames` ableitet.
Anfragen, die **kein** Session-Cookie tragen (z. B. die
Bearer-Token-Aufrufe von Adapter/Worker oder die Login-Anfrage selbst), sind
ausgenommen. Browser senden `Origin` automatisch; Nicht-Browser-Clients können
entweder:

- `Origin` auf einen der akzeptierten Hostnamen abstimmen oder
- `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>`
  unabhängig vom tatsächlichen TCP-Ziel setzen (der Onboarding-Schritt
  [`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) nutzt diesen Trick).

## Übliche Abläufe

### Einen Mandanten onboarden

```bash
curl -b jar -X POST https://mssp.../api/mssp/tenants/onboard \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme-corp",
    "display_name": "Acme Corp",
    "profile": "persistent"
  }'
```

`profile` wird serverseitig gegen `^(poc|persistent|provided)$` validiert. Siehe
[Mandanten-Lebenszyklus / Profile](/de-de/tenant-lifecycle#profiles) für die
Semantik jedes Werts. Für `provided` (BYO-Wazuh) erfordert die Nutzlast
zusätzlich ein `external_siem`-Objekt (Indexer-URL, Manager-API-URL,
Basic-Auth-Zugangsdaten) sowie einen mandantenspezifischen `llm_api_key`; der
Server liefert 422 mit feldbezogenen Fehlern, falls etwas fehlt.

Liefert 202 mit der neuen Mandanten-ID zurück. Beobachte
`GET /api/mssp/tenants/{id}` für Zustandsübergänge oder pollten
`GET /api/mssp/tenants/{id}/events` für die Liste der Lebenszyklus-Ereignisse.
(`/api/events/stream` existiert, gibt in diesem Release aber nur
Keep-Alive-Pings aus.)

### Das Audit-Log abrufen

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed&page=1&page_size=50'
```

Der Audit-Router liegt auf oberster Ebene (`/api/audit`), nicht unter
`/api/mssp/`. Filter: `start_date` / `end_date` (ISO 8601), `event_type`,
`aggregate_type` und `investigation_id`. Ergebnisse werden per Offset mit
`page` / `page_size` paginiert.

### Eine Entscheidung zur menschlichen Prüfung übermitteln

Der Review-Router stellt einen Endpunkt pro Entscheidung bereit (keinen
einzelnen `/decision`-Pfad). Wähle den passenden:

```bash
# Approve — das Nutzlastfeld ist `feedback` (Freitext), nicht `rationale`
curl -b jar -X POST https://mssp.../api/review/<review-id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"feedback":"Confirmed brute-force pattern."}'

# Reject — schließt den Fall als auto_closed_fp; `feedback` ist optional
curl -b jar -X POST https://mssp.../api/review/<review-id>/reject \
  -d '{"feedback":"Looks like a known scanner; benign."}'

# Need more info — Nutzlast ist `questions: list[str]` (jede wird als Aufzählungspunkt gerendert)
curl -b jar -X POST https://mssp.../api/review/<review-id>/request-info \
  -d '{"questions":["What is the source IP geo?","Any prior alerts on this user?"]}'

# Expire — eine ausstehende Prüfung ohne Verdikt zurückziehen (optionaler Grund)
curl -b jar -X POST https://mssp.../api/review/<review-id>/expire \
  -d '{"reason":"superseded by newer investigation"}'
```

Alle vier liefern 409, wenn die Prüfung nicht mehr `pending` ist.

Für IR-Proposals (die Fallmanagement-Oberfläche) sind die entsprechenden
Endpunkte `/api/mssp/proposals/{id}/approve` und
`/api/mssp/proposals/{id}/reject`.

### Ereignisse streamen

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events. **In diesem Release gibt der Stream nur Keep-Alive-Pings aus**
(ein `ping` etwa alle 25 s), das Broadcasten von Domänenereignissen
(Untersuchungs-Updates, Mandanten-Lebenszyklus usw.) steht auf der Roadmap.
Behandle den Endpunkt heute als Konnektivitätstest auf Wire-Ebene.

## Einen Python-Client generieren

Das Schema generiert sauber, daher ist der schnellste Weg, die API aus Python
anzusprechen, einen typisierten Client mit
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
zu generieren, statt Requests von Hand zu bauen. Hier ist es durchgängig, beim
Lesen von Untersuchungen.

### 1. Den Client generieren + installieren

```bash
pip install openapi-python-client
openapi-python-client generate \
  --url https://mssp.your-mssp.example/api/openapi.json --meta setup
pip install ./soc-talk-v1-client   # package name derives from the schema title
```

### 2. Untersuchungen konsumieren

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

Die Endpunkt-Funktionen sind nach der operationId benannt, die FastAPI aus der
Route ableitet (`list_investigations_api_investigations_get`), versieh sie beim
Import mit Aliassen, wie oben, zur besseren Lesbarkeit. `sync()` liefert das
deserialisierte Modell (`InvestigationList`, dessen `.items` vom Typ
`Investigation` sind); `sync_detailed()` liefert die rohe `Response` mit dem
Statuscode, falls du ihn brauchst.

Eine lauffähige Version, generieren, einloggen, auflisten + lesen, wird als
Codegen-Smoke-Test
[`tests/e2e/smoke_openapi_client.py`](https://github.com/soctalk/soctalk/blob/main/tests/e2e/smoke_openapi_client.py)
ausgeliefert, den die Deploy-Pipeline gegen die Live-API ausführt, sodass ein
Schema, das keinen funktionierenden Client mehr generiert, den Build scheitern
lässt.

## Interne Endpunkte (`/api/internal/*`)

Werden vom mandantenspezifischen Adapter und runs-worker genutzt (siehe die
Gruppen `internal-adapter` und `internal-worker` im Katalog oben). Nicht für den
menschlichen Gebrauch, aufgeführt, damit MSSPs sehen können, was diese Pods tun.

Jeder Aufruf trägt ein mandantengebundenes Token, das die API beim Provisioning
ausstellt und **automatisch erneuert**, bevor es abläuft (Adapter-Tokens leben 7
Tage, Worker-Tokens 30 Tage; die Control Plane stellt sie deutlich innerhalb
dieses Fensters neu aus). Tokens sind mandantengebunden, ein Adapter kann nur
auf den URLs seines eigenen Mandanten agieren.

## Rate-Limits

Die API selbst erlegt in diesem Release keine Rate-Limits pro Route auf. Nutze
die Ingress-Ebene für globales Rate-Limiting (Traefik-Middleware,
ingress-nginx-Annotationen), falls du es brauchst.

## Versionierung

Das OpenAPI-Dokument trägt die App-Version. Wir streben additive Änderungen
innerhalb einer Minor-Version an; Breaking Changes nur bei einem Major-Sprung. Die
[Release Notes](https://github.com/soctalk/soctalk/releases) heben jede
API-relevante Änderung hervor.

## Quellverweise

Alle Router liegen unter `src/soctalk/core/api/`.

| Konzept | Datei |
|---|---|
| Auth-Router + Session-Middleware | [`core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py), [`core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| MSSP-Mandanten-Lebenszyklus | [`core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| Mandantenspezifische LLM-Konfiguration | [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
| Untersuchungen / IR / Proposals | [`core/api/investigations_bridge.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/investigations_bridge.py), [`core/api/ir.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/ir.py) |
| Audit / Review / Analytics / Settings / Events (Stubs) | [`core/api/legacy_stubs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/legacy_stubs.py) |
| Chat | [`core/api/chat.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/chat.py) |
| Worker-Routen (intern) | [`core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Adapter-Routen (intern) | [`core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| OpenAPI-Generator | [`scripts/dump_openapi.py`](https://github.com/soctalk/soctalk/blob/main/scripts/dump_openapi.py) |
