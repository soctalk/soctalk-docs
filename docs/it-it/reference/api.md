# REST API

L'API di SocTalk è un'app FastAPI. La sua superficie completa è generata dal
codice come schema OpenAPI ed è servita **sotto `/api/`** (l'ingress instrada
`/api/*` verso l'API e tutto il resto verso la console web):

- **OpenAPI JSON**: `https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI**: `https://mssp.your-mssp.example/api/docs`
- **ReDoc**: `https://mssp.your-mssp.example/api/redoc`

La superficie OpenAPI è la fonte di verità. Uno snapshot di essa è distribuito con
questa documentazione all'indirizzo [`/openapi.json`](/openapi.json), e il
catalogo sottostante è **generato da quello schema** — non può divergere dal
codice.

::: tip Rigenerare il catalogo
Il catalogo degli endpoint è prodotto da `npm run gen:api`, che legge
`docs/public/openapi.json`. Aggiorna prima lo schema dal codice dell'API:

```bash
# in the soctalk repo
python scripts/dump_openapi.py <soctalk-docs>/docs/public/openapi.json
# in soctalk-docs
npm run gen:api
```

Tutto ciò che si trova tra i marcatori `GENERATED` viene sovrascritto; la prosa
attorno ad esso è curata manualmente.
:::

## Catalogo degli endpoint

La colonna **Auth** è derivata dal guard `require_role` /
`require_tenant_role` di ciascuna route. Un'etichetta `session cookie` significa
che al handler è accettata *qualsiasi* sessione autenticata — ma i ruoli con
ambito tenant sono comunque confinati ai propri dati tramite row-level security,
quindi un `tenant_admin` vede solo le righe del proprio tenant anche su una route
di tipo MSSP senza gating.

<!-- BEGIN GENERATED:endpoints (do not edit — npm run gen:api) -->

_97 operations across 23 groups, generated from the OpenAPI schema (API version `0.2.0`). Auth is derived from the route's `require_role` / `require_tenant_role` guards._

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
| `POST` | `/api/mssp/users/{user_id}/password/reset` | Admin Reset | session — roles: mssp_admin / platform_admin |

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
| `POST` | `/api/investigations/{investigation_id}/cancel` | Post Cancel Investigation | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/investigations/{investigation_id}/events` | Get Events | session cookie |

### `ir-alerts`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/alerts` | List Alerts | session — roles: analyst / mssp_admin / platform_admin |

### `ir-integrations`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/integrations` | Get Integrations | session — roles: mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/integrations` | Patch Integrations | session — roles: mssp_admin / platform_admin |

### `ir-mssp`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/investigations` | List Cases Mssp | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}` | Get Case Mssp | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}/events` | List Case Events Mssp | session — roles: analyst / mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/investigations/{investigation_id}/facts` | Patch Case Facts | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/investigations/{investigation_id}/messages` | Post Analyst Message | session — roles: analyst / mssp_admin / platform_admin |

### `ir-proposals`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/proposals` | List Pending Proposals | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/proposals/{proposal_id}/approve` | Approve Proposal Route | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/proposals/{proposal_id}/reject` | Reject Proposal Route | session — roles: analyst / mssp_admin / platform_admin |

### `ir-tenant`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/investigations` | List Cases Tenant | tenant session (customer_viewer / tenant_admin) |
| `GET` | `/api/tenant/investigations/{investigation_id}` | Get Case Tenant | tenant session (customer_viewer / tenant_admin) |

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
| `GET` | `/api/mssp/analytics/heatmap` | Heatmap | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/analytics/ranking` | Ranking | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/analytics/trends` | Trends | session — roles: analyst / mssp_admin / platform_admin |

### `mssp-dashboard`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/dashboard/open-by-tenant` | Open By Tenant | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/pending-reviews` | Pending Reviews | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/repeated-iocs` | Repeated Iocs | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/stuck-investigations` | Stuck Investigations | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/tenant-health` | Tenant Health | session — roles: analyst / mssp_admin / platform_admin |

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
| `GET` | `/api/mssp/tenants` | List Tenants | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants` | Create Tenant | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}` | Get Tenant | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:decommission` | Decommission Tenant | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:issue-agent` | Issue Agent | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:resume` | Resume Tenant | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry` | Retry Provisioning | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry-install` | Retry Install | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:suspend` | Suspend Tenant | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/adapter-status` | Get Tenant Adapter Status | session — roles: mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/events` | List Events | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/external-siem` | Get Tenant External Siem | session — roles: mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/external-siem` | Update Tenant External Siem | session — roles: mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/onboard` | Onboard Tenant | session — roles: mssp_admin / platform_admin |

### `public-tenant`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/public/mssp-by-slug/{slug}` | Mssp By Slug | none (public) |
| `GET` | `/api/public/scope-by-slug/{slug}` | Scope By Slug | none (public) |
| `GET` | `/api/public/tenant-by-slug/{slug}` | Tenant By Slug | none (public) |

### `tenant-branding`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/branding` | Get Own Branding | tenant session (customer_viewer / tenant_admin) |

### `tenant-llm`

| Method | Path | Summary | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/llm` | Tenant Get Llm | tenant session (tenant_admin) |
| `PUT` | `/api/tenant/llm/api-key` | Tenant Put Llm Key | tenant session (tenant_admin) |
| `DELETE` | `/api/tenant/llm/api-key` | Tenant Clear Llm Key | tenant session (tenant_admin) |

<!-- END GENERATED:endpoints -->

## Schema di autenticazione

I browser usano un session cookie impostato da `POST /api/auth/login`. I client
programmatici possono, in alternativa:

1. Guidare il flusso di login (preferito per script di breve durata):
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. Emettere un token API a lunga durata (pianificato; non ancora esposto nella
   UI). Oggi gli unici chiamanti non basati su cookie sono i pod **adapter** e
   **runs-worker** per tenant, che si autenticano su `/api/internal/*` con token
   con ambito tenant che l'API conia e ruota (vedi [Endpoint interni](#internal-endpoints)).

In `SOCTALK_AUTH_MODE=proxy`, l'API si fida degli header upstream
`X-Forwarded-User` / `X-Forwarded-Email` / `X-Forwarded-Groups` e l'**intera**
superficie di autenticazione della sessione viene smontata — `/api/auth/*`
(`login`, `logout`, `me`, `assume-tenant`, `password/change`) **e**
`/api/mssp/users/{id}/password/reset` restituiscono 404 (non 405). Il tuo IdP
possiede la superficie dell'identità.

## CSRF

Il CSRF è applicato **globalmente**, non per prefisso:
`internal_session_middleware` valida l'header `Origin` / `Referer` su **ogni**
richiesta che modifica lo stato (`POST` / `PUT` / `PATCH` / `DELETE`) che porta
con sé il session cookie. Si tratta di **validazione dell'header**, non di un
token cookie double-submit (quel pattern è comparso in bozze precedenti, ma il
runtime usa la validazione dell'header). Le origini accettate provengono da
`SOCTALK_PUBLIC_ORIGIN` (e `SOCTALK_PUBLIC_ORIGIN_BASE` per gli host cliente con
wildcard sullo slug), che il chart deriva da `ingress.hostnames`. Le richieste
che **non** portano alcun session cookie (ad esempio le chiamate bearer-token di
adapter/worker, o la richiesta di login stessa) sono esenti. I browser inviano
`Origin` automaticamente; i client non browser possono, in alternativa:

- Far corrispondere `Origin` a uno degli hostname accettati, oppure
- Impostare `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>`
  indipendentemente dall'effettivo target TCP (lo step di onboarding
  [`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) usa questo trucco).

## Flussi comuni

### Onboarding di un tenant

```bash
curl -b jar -X POST https://mssp.../api/mssp/tenants/onboard \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme-corp",
    "display_name": "Acme Corp",
    "profile": "persistent"
  }'
```

`profile` è validato lato server rispetto a `^(poc|persistent|provided)$`. Vedi
[ciclo di vita del tenant / profili](/it-it/tenant-lifecycle#profiles) per la
semantica di ciascun valore. Per `provided` (BYO-Wazuh), il payload richiede in
aggiunta un oggetto `external_siem` (URL dell'indexer, URL dell'API del Manager,
credenziali basic-auth) più un `llm_api_key` per tenant; il server restituisce
422 con errori a livello di campo se qualcuno di questi manca.

Restituisce 202 con l'ID del nuovo tenant. Osserva
`GET /api/mssp/tenants/{id}` per le transizioni di stato, oppure interroga
`GET /api/mssp/tenants/{id}/events` per l'elenco degli eventi del ciclo di vita.
(`/api/events/stream` esiste ma in questa release emette solo ping keep-alive.)

### Ottenere il log di audit

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed&page=1&page_size=50'
```

Il router di audit è di livello superiore (`/api/audit`), non sotto `/api/mssp/`.
Filtri: `start_date` / `end_date` (ISO 8601), `event_type`, `aggregate_type` e
`investigation_id`. I risultati sono paginati per offset con `page` / `page_size`.

### Inviare una decisione di revisione umana

Il router di revisione espone un endpoint per ciascuna decisione (nessun singolo
percorso `/decision`). Scegli quello corrispondente:

```bash
# Approve — payload field is `feedback` (free-text), not `rationale`
curl -b jar -X POST https://mssp.../api/review/<review-id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"feedback":"Confirmed brute-force pattern."}'

# Reject — closes the case as auto_closed_fp; `feedback` is optional
curl -b jar -X POST https://mssp.../api/review/<review-id>/reject \
  -d '{"feedback":"Looks like a known scanner; benign."}'

# Need more info — payload is `questions: list[str]` (each renders as a bullet)
curl -b jar -X POST https://mssp.../api/review/<review-id>/request-info \
  -d '{"questions":["What is the source IP geo?","Any prior alerts on this user?"]}'

# Expire — retire a pending review without a verdict (optional reason)
curl -b jar -X POST https://mssp.../api/review/<review-id>/expire \
  -d '{"reason":"superseded by newer investigation"}'
```

Tutti e quattro restituiscono 409 se la Revisione non è più `pending`.

Per le proposte IR (la superficie di gestione dei casi), gli endpoint equivalenti
sono sotto `/api/mssp/proposals/{id}/approve` e
`/api/mssp/proposals/{id}/reject`.

### Streaming degli eventi

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events. **In questa release lo stream emette solo ping keep-alive**
(un `ping` all'incirca ogni 25 s) — il broadcast di eventi di dominio
(aggiornamenti delle indagini, ciclo di vita del tenant, ecc.) è in roadmap. Oggi
tratta l'endpoint come un test di connettività a livello di rete.

## Generare un client Python

Lo schema si genera in modo pulito, quindi il modo più rapido per chiamare l'API
da Python è generare un client tipizzato con
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
invece di scrivere richieste a mano. Eccolo end-to-end, leggendo le indagini.

### 1. Generare + installare il client

```bash
pip install openapi-python-client
openapi-python-client generate \
  --url https://mssp.your-mssp.example/api/openapi.json --meta setup
pip install ./soc-talk-v1-client   # package name derives from the schema title
```

### 2. Consumare le indagini

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

Le funzioni degli endpoint prendono il nome dall'operationId che FastAPI deriva
dalla route (`list_investigations_api_investigations_get`) — assegna loro un alias
all'import, come sopra, per leggibilità. `sync()` restituisce il modello
deserializzato (`InvestigationList`, i cui `.items` sono `Investigation`);
`sync_detailed()` restituisce la `Response` grezza con il codice di stato se ti
serve.

Una versione eseguibile — genera, effettua il login, elenca + legge — è
distribuita come smoke test di codegen
[`tests/e2e/smoke_openapi_client.py`](https://github.com/soctalk/soctalk/blob/main/tests/e2e/smoke_openapi_client.py),
che la pipeline di deploy esegue contro l'API live, così uno schema che smette di
generare un client funzionante fa fallire la build.

## Endpoint interni (`/api/internal/*`)

Usati dall'adapter e dal runs-worker per tenant (vedi i gruppi
`internal-adapter` e `internal-worker` nel catalogo qui sopra). Non destinati al
consumo umano — elencati affinché gli MSSP possano vedere cosa fanno quei pod.

Ogni chiamata porta con sé un token con ambito tenant che l'API conia al
provisioning e **rinnova automaticamente** prima della scadenza (i token
dell'adapter durano 7 giorni, i token del worker 30 giorni; il control plane li
riconia ben dentro quella finestra). I token sono vincolati al tenant — un
adapter può agire solo sugli URL del proprio tenant.

## Limiti di velocità

L'API di per sé non impone limiti di velocità per route in questa release. Usa il
livello di ingress per il rate limiting globale (middleware Traefik, annotazioni
ingress-nginx) se ti serve.

## Versionamento

Il documento OpenAPI riporta la versione dell'app. Puntiamo a modifiche additive
all'interno di una minor; le modifiche che rompono la compatibilità solo con un
salto di major. Le [note di rilascio](https://github.com/soctalk/soctalk/releases)
segnalano ogni modifica che riguarda l'API.

## Riferimenti al codice sorgente

Tutti i router si trovano sotto `src/soctalk/core/api/`.

| Concetto | File |
|---|---|
| Router di autenticazione + middleware di sessione | [`core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py), [`core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| Ciclo di vita del tenant MSSP | [`core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| Configurazione LLM per tenant | [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
| Indagini / IR / proposte | [`core/api/investigations_bridge.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/investigations_bridge.py), [`core/api/ir.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/ir.py) |
| Audit / revisione / analytics / impostazioni / eventi (stub) | [`core/api/legacy_stubs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/legacy_stubs.py) |
| Chat | [`core/api/chat.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/chat.py) |
| Route del worker (interne) | [`core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Route dell'adapter (interne) | [`core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| Generatore OpenAPI | [`scripts/dump_openapi.py`](https://github.com/soctalk/soctalk/blob/main/scripts/dump_openapi.py) |
