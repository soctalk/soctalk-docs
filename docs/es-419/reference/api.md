# REST API

La API de SocTalk es una app FastAPI. Toda su superficie se genera desde el
código como un esquema OpenAPI y se sirve **bajo `/api/`** (el ingress enruta
`/api/*` a la API y todo lo demás a la consola web):

- **OpenAPI JSON**: `https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI**: `https://mssp.your-mssp.example/api/docs`
- **ReDoc**: `https://mssp.your-mssp.example/api/redoc`

La superficie OpenAPI es la fuente de verdad. Con estos docs se distribuye una
instantánea en [`/openapi.json`](/openapi.json), y el catálogo de abajo se
**genera a partir de ese esquema** — no puede desviarse del código.

::: tip Regenerar el catálogo
El catálogo de endpoints lo produce `npm run gen:api`, que lee
`docs/public/openapi.json`. Actualiza primero el esquema desde el código de la
API:

```bash
# en el repo soctalk
python scripts/dump_openapi.py <soctalk-docs>/docs/public/openapi.json
# en soctalk-docs
npm run gen:api
```

Todo lo que está entre los marcadores `GENERATED` se sobrescribe; la prosa a su
alrededor se cura a mano.
:::

## Catálogo de endpoints

La columna **Auth** se deriva del guard `require_role` /
`require_tenant_role` de cada ruta. Una etiqueta de `session cookie` significa
que se acepta *cualquier* sesión autenticada en el handler — pero los roles con
alcance de tenant siguen confinados a sus propios datos por row-level security,
así que un `tenant_admin` solo ve las filas de su tenant incluso en una ruta
estilo MSSP sin control de acceso.

<!-- BEGIN GENERATED:endpoints (do not edit — npm run gen:api) -->

_97 operaciones en 23 grupos, generadas a partir del esquema OpenAPI (versión de API `0.2.0`). Auth se deriva de los guards `require_role` / `require_tenant_role` de la ruta._

### `auth`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `POST` | `/api/auth/assume-tenant` | Assume Tenant | session cookie (login) / none |
| `POST` | `/api/auth/login` | Login | session cookie (login) / none |
| `POST` | `/api/auth/logout` | Logout | session cookie (login) / none |
| `GET` | `/api/auth/me` | Me | session cookie (login) / none |
| `POST` | `/api/auth/password/change` | Password Change | session cookie (login) / none |

### `auth-admin`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `POST` | `/api/mssp/users/{user_id}/password/reset` | Admin Reset | session — roles: mssp_admin / platform_admin |

### `chat`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/chat/conversations` | List Conversations | session cookie |
| `POST` | `/api/chat/conversations` | Create Conversation | session cookie |
| `GET` | `/api/chat/conversations/{conv_id}` | Get Conversation | session cookie |
| `DELETE` | `/api/chat/conversations/{conv_id}` | Delete Conversation | session cookie |
| `POST` | `/api/chat/conversations/{conv_id}/messages` | Post Message | session cookie |
| `POST` | `/api/chat/conversations/{conv_id}/messages/{msg_id}/confirm` | Confirm Action | session cookie |
| `POST` | `/api/chat/conversations/{conv_id}/stop` | Stop Conversation | session cookie |

### `health`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/health/live` | Live | none (public) |
| `GET` | `/health/ready` | Ready | none (public) |

### `internal-adapter`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/internal/adapter/checkpoint` | Get Checkpoint | service JWT (adapter token) |
| `PUT` | `/api/internal/adapter/checkpoint` | Put Checkpoint | service JWT (adapter token) |
| `GET` | `/api/internal/adapter/config` | Fetch Config | service JWT (adapter token) |
| `POST` | `/api/internal/adapter/events` | Ingest Events | service JWT (adapter token) |
| `POST` | `/api/internal/adapter/heartbeat` | Heartbeat | service JWT (adapter token) |

### `internal-worker`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `POST` | `/api/internal/worker/runs/{run_id}/complete` | Complete Run | service JWT (worker token) |
| `POST` | `/api/internal/worker/runs/{run_id}/heartbeat` | Heartbeat Run | service JWT (worker token) |
| `POST` | `/api/internal/worker/runs/claim` | Claim Run | service JWT (worker token) |

### `investigations-bridge`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/investigations` | List Investigations | session cookie |
| `GET` | `/api/investigations/{investigation_id}` | Get Investigation | session cookie |
| `POST` | `/api/investigations/{investigation_id}/cancel` | Post Cancel Investigation | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/investigations/{investigation_id}/events` | Get Events | session cookie |

### `ir-alerts`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/alerts` | List Alerts | session — roles: analyst / mssp_admin / platform_admin |

### `ir-integrations`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/integrations` | Get Integrations | session — roles: mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/integrations` | Patch Integrations | session — roles: mssp_admin / platform_admin |

### `ir-mssp`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/investigations` | List Cases Mssp | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}` | Get Case Mssp | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}/events` | List Case Events Mssp | session — roles: analyst / mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/investigations/{investigation_id}/facts` | Patch Case Facts | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/investigations/{investigation_id}/messages` | Post Analyst Message | session — roles: analyst / mssp_admin / platform_admin |

### `ir-proposals`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/proposals` | List Pending Proposals | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/proposals/{proposal_id}/approve` | Approve Proposal Route | session — roles: analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/proposals/{proposal_id}/reject` | Reject Proposal Route | session — roles: analyst / mssp_admin / platform_admin |

### `ir-tenant`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/investigations` | List Cases Tenant | tenant session (customer_viewer / tenant_admin) |
| `GET` | `/api/tenant/investigations/{investigation_id}` | Get Case Tenant | tenant session (customer_viewer / tenant_admin) |

### `l2-agent`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `POST` | `/api/agent/heartbeat` | Heartbeat | L2 agent install token (bearer) |
| `POST` | `/api/agent/jobs:claim` | Claim Job | L2 agent install token (bearer) |
| `POST` | `/api/agent/jobs/{job_id}/complete` | Complete Job | L2 agent install token (bearer) |
| `POST` | `/api/agent/jobs/{job_id}/events` | Post Event | L2 agent install token (bearer) |
| `POST` | `/api/agent/register` | Register | L2 agent install token (bearer) |

### `legacy-stubs`

| Método | Ruta | Resumen | Auth |
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

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/metrics/hourly` | Hourly | session cookie |
| `GET` | `/api/metrics/overview` | Overview | session cookie |

### `mssp-analytics`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/analytics/heatmap` | Heatmap | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/analytics/ranking` | Ranking | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/analytics/trends` | Trends | session — roles: analyst / mssp_admin / platform_admin |

### `mssp-dashboard`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/dashboard/open-by-tenant` | Open By Tenant | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/pending-reviews` | Pending Reviews | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/repeated-iocs` | Repeated Iocs | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/stuck-investigations` | Stuck Investigations | session — roles: analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/tenant-health` | Tenant Health | session — roles: analyst / mssp_admin / platform_admin |

### `mssp-tenant-branding`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `PATCH` | `/api/mssp/tenants/{tenant_id}/branding` | Update Tenant Branding | session — roles: mssp_admin / platform_admin |

### `mssp-tenant-llm`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/llm` | Get Tenant Llm | session — roles: mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/llm` | Update Tenant Llm | session — roles: mssp_admin / platform_admin |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/llm/api-key` | Clear Tenant Llm Api Key | session — roles: mssp_admin / platform_admin |

### `mssp-tenants`

| Método | Ruta | Resumen | Auth |
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

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/public/mssp-by-slug/{slug}` | Mssp By Slug | none (public) |
| `GET` | `/api/public/scope-by-slug/{slug}` | Scope By Slug | none (public) |
| `GET` | `/api/public/tenant-by-slug/{slug}` | Tenant By Slug | none (public) |

### `tenant-branding`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/branding` | Get Own Branding | tenant session (customer_viewer / tenant_admin) |

### `tenant-llm`

| Método | Ruta | Resumen | Auth |
|---|---|---|---|
| `GET` | `/api/tenant/llm` | Tenant Get Llm | tenant session (tenant_admin) |
| `PUT` | `/api/tenant/llm/api-key` | Tenant Put Llm Key | tenant session (tenant_admin) |
| `DELETE` | `/api/tenant/llm/api-key` | Tenant Clear Llm Key | tenant session (tenant_admin) |

<!-- END GENERATED:endpoints -->

## Esquema de autenticación

Los navegadores usan una session cookie establecida por `POST /api/auth/login`.
Los clientes programáticos pueden:

1. Ejecutar el flujo de login (preferido para scripts de vida corta):
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. Emitir un token de API de larga vida (planificado; aún no expuesto en la UI).
   Hoy, los únicos llamadores sin cookie son los pods **adapter** y
   **runs-worker** por tenant, que se autentican en `/api/internal/*` con tokens
   con alcance de tenant que la API acuña y rota (ver
   [Endpoints internos](#endpoints-internos)).

En `SOCTALK_AUTH_MODE=proxy`, la API confía en los headers upstream
`X-Forwarded-User` / `X-Forwarded-Email` / `X-Forwarded-Groups` y **toda** la
superficie de autenticación de sesión se desmonta — `/api/auth/*` (`login`,
`logout`, `me`, `assume-tenant`, `password/change`) **y**
`/api/mssp/users/{id}/password/reset` devuelven 404 (no 405). Tu IdP es dueño de
la superficie de identidad.

## CSRF

El CSRF se aplica de forma **global**, no por prefijo:
`internal_session_middleware` valida el header `Origin` / `Referer` en **cada**
solicitud que modifica estado (`POST` / `PUT` / `PATCH` / `DELETE`) que lleva la
session cookie. Es **validación de header**, no un token de cookie de doble
envío (ese patrón apareció en borradores anteriores, pero el runtime usa
validación de header). Los orígenes aceptados provienen de
`SOCTALK_PUBLIC_ORIGIN` (y `SOCTALK_PUBLIC_ORIGIN_BASE` para hosts de cliente
con comodín de slug), que el chart deriva de `ingress.hostnames`. Las
solicitudes que **no** llevan session cookie (p. ej. las llamadas con token
bearer del adapter/worker, o la propia solicitud de login) están exentas. Los
navegadores envían `Origin` automáticamente; los clientes que no son
navegadores pueden:

- Hacer coincidir `Origin` con uno de los hostnames aceptados, o
- Establecer `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>`
  independientemente del destino TCP real (el paso de onboarding de
  [`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) usa este truco).

## Flujos comunes

### Dar de alta un tenant

```bash
curl -b jar -X POST https://mssp.../api/mssp/tenants/onboard \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme-corp",
    "display_name": "Acme Corp",
    "profile": "persistent"
  }'
```

`profile` se valida en el servidor contra `^(poc|persistent|provided)$`. Ver
[ciclo de vida del tenant / perfiles](/es-419/tenant-lifecycle#profiles) para la
semántica de cada valor. Para `provided` (BYO-Wazuh), el payload requiere
adicionalmente un objeto `external_siem` (URL del indexer, URL de la API del
Manager, credenciales de basic-auth) más un `llm_api_key` por tenant; el
servidor devuelve 422 con errores a nivel de campo si falta alguno.

Devuelve 202 con el ID del nuevo tenant. Observa
`GET /api/mssp/tenants/{id}` para ver las transiciones de estado, o consulta
`GET /api/mssp/tenants/{id}/events` para la lista de eventos del ciclo de vida.
(`/api/events/stream` existe pero en esta versión solo emite pings de
keep-alive.)

### Obtener el log de auditoría

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed&page=1&page_size=50'
```

El router de auditoría es de nivel superior (`/api/audit`), no está bajo
`/api/mssp/`. Filtros: `start_date` / `end_date` (ISO 8601), `event_type`,
`aggregate_type` e `investigation_id`. Los resultados se paginan por offset con
`page` / `page_size`.

### Enviar una decisión de revisión humana

El router de revisión expone un endpoint por decisión (no hay una única ruta
`/decision`). Elige el que corresponda:

```bash
# Aprobar — el campo del payload es `feedback` (texto libre), no `rationale`
curl -b jar -X POST https://mssp.../api/review/<review-id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"feedback":"Confirmed brute-force pattern."}'

# Rechazar — cierra el caso como auto_closed_fp; `feedback` es opcional
curl -b jar -X POST https://mssp.../api/review/<review-id>/reject \
  -d '{"feedback":"Looks like a known scanner; benign."}'

# Se necesita más información — el payload es `questions: list[str]` (cada uno se renderiza como una viñeta)
curl -b jar -X POST https://mssp.../api/review/<review-id>/request-info \
  -d '{"questions":["What is the source IP geo?","Any prior alerts on this user?"]}'

# Expirar — retira una revisión pendiente sin veredicto (razón opcional)
curl -b jar -X POST https://mssp.../api/review/<review-id>/expire \
  -d '{"reason":"superseded by newer investigation"}'
```

Las cuatro devuelven 409 si la revisión ya no está `pending`.

Para las propuestas de IR (la superficie de gestión de casos), los endpoints
equivalentes están bajo `/api/mssp/proposals/{id}/approve` y
`/api/mssp/proposals/{id}/reject`.

### Transmitir eventos

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events. **En esta versión el stream solo emite pings de keep-alive**
(un `ping` aproximadamente cada 25 s) — la difusión de eventos de dominio
(actualizaciones de investigaciones, ciclo de vida de tenants, etc.) está en el
roadmap. Trata el endpoint como una prueba de conectividad a nivel de cable por
ahora.

## Generar un cliente de Python

El esquema se genera limpiamente, así que la forma más rápida de llamar a la API
desde Python es generar un cliente tipado con
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
en lugar de armar solicitudes a mano. Aquí está de principio a fin, leyendo
investigaciones.

### 1. Generar + instalar el cliente

```bash
pip install openapi-python-client
openapi-python-client generate \
  --url https://mssp.your-mssp.example/api/openapi.json --meta setup
pip install ./soc-talk-v1-client   # el nombre del paquete deriva del título del esquema
```

### 2. Consumir investigaciones

```python
import httpx
from soc_talk_v1_client import Client
from soc_talk_v1_client.api.investigations_bridge import (
    list_investigations_api_investigations_get as list_investigations,
    get_investigation_api_investigations_investigation_id_get as get_investigation,
)

BASE = "https://mssp.your-mssp.example"

# 1. Inicia sesión para obtener una session cookie (las rutas de investigaciones usan una sesión).
with httpx.Client(base_url=BASE) as h:
    h.post("/api/auth/login",
           json={"email": "admin@example", "password": "..."}).raise_for_status()
    session = h.cookies["soctalk_session"]

# 2. Maneja el cliente tipado generado con esa cookie.
client = Client(base_url=BASE, cookies={"soctalk_session": session})

page = list_investigations.sync(client=client, page=1, page_size=5)  # -> InvestigationList
print(f"{page.total} investigations")
for inv in page.items:                                               # -> Investigation
    print(inv.id, inv.status, inv.max_severity, inv.title)

detail = get_investigation.sync(client=client, investigation_id=str(page.items[0].id))
print(detail.phase, detail.alert_count, detail.verdict_decision)
```

Las funciones de endpoint se nombran según el operationId que FastAPI deriva de
la ruta (`list_investigations_api_investigations_get`) — asígnales un alias al
importarlas, como arriba, para mayor legibilidad. `sync()` devuelve el modelo
deserializado (`InvestigationList`, cuyos `.items` son `Investigation`);
`sync_detailed()` devuelve el `Response` en bruto con el código de estado si lo
necesitas.

Una versión ejecutable — generar, iniciar sesión, listar + leer — se distribuye
como la prueba de humo de codegen
[`tests/e2e/smoke_openapi_client.py`](https://github.com/soctalk/soctalk/blob/main/tests/e2e/smoke_openapi_client.py),
que el pipeline de despliegue ejecuta contra la API en vivo, de modo que un
esquema que deja de generar un cliente funcional hace fallar la build.

## Endpoints internos (`/api/internal/*`)

Usados por el adapter y el runs-worker por tenant (ver los grupos
`internal-adapter` e `internal-worker` en el catálogo de arriba). No son para
consumo humano — se listan para que los MSSP puedan ver qué hacen esos pods.

Cada llamada lleva un token con alcance de tenant que la API acuña en el
aprovisionamiento y **auto-renueva** antes de que expire (los tokens de adapter
viven 7 días, los de worker 30 días; el plano de control los vuelve a acuñar
bien dentro de esa ventana). Los tokens están vinculados al tenant — un adapter
solo puede actuar sobre las URLs de su propio tenant.

## Límites de tasa

La API en sí no impone límites de tasa por ruta en esta versión. Usa la capa de
ingress para el rate limiting global (middleware de Traefik, anotaciones de
ingress-nginx) si lo necesitas.

## Versionado

El documento OpenAPI lleva la versión de la app. Apuntamos a cambios aditivos
dentro de una minor; cambios que rompen compatibilidad solo en un salto de
major. Las [notas de la versión](https://github.com/soctalk/soctalk/releases)
señalan cada cambio que afecta a la API.

## Punteros al código fuente

Todos los routers viven bajo `src/soctalk/core/api/`.

| Concepto | Archivo |
|---|---|
| Router de auth + middleware de sesión | [`core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py), [`core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| Ciclo de vida del tenant MSSP | [`core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| Configuración de LLM por tenant | [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
| Investigaciones / IR / propuestas | [`core/api/investigations_bridge.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/investigations_bridge.py), [`core/api/ir.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/ir.py) |
| Auditoría / revisión / analítica / configuración / eventos (stubs) | [`core/api/legacy_stubs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/legacy_stubs.py) |
| Chat | [`core/api/chat.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/chat.py) |
| Rutas de worker (internas) | [`core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Rutas de adapter (internas) | [`core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| Generador de OpenAPI | [`scripts/dump_openapi.py`](https://github.com/soctalk/soctalk/blob/main/scripts/dump_openapi.py) |
