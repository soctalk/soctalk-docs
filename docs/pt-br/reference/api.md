# REST API

A API do SocTalk é uma aplicação FastAPI. Toda a sua superfície é gerada a partir
do código como um schema OpenAPI e servida **em `/api/`** (o ingress roteia
`/api/*` para a API e todo o resto para o console web):

- **OpenAPI JSON**: `https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI**: `https://mssp.your-mssp.example/api/docs`
- **ReDoc**: `https://mssp.your-mssp.example/api/redoc`

A superfície OpenAPI é a fonte da verdade. Um snapshot dela é distribuído junto
com esta documentação em [`/openapi.json`](/openapi.json), e o catálogo abaixo é
**gerado a partir desse schema** — ele não pode divergir do código.

::: tip Regenerando o catálogo
O catálogo de endpoints é produzido por `npm run gen:api`, que lê
`docs/public/openapi.json`. Atualize o schema a partir do código da API primeiro:

```bash
# in the soctalk repo
python scripts/dump_openapi.py <soctalk-docs>/docs/public/openapi.json
# in soctalk-docs
npm run gen:api
```

Tudo entre os marcadores `GENERATED` é sobrescrito; a prosa ao redor é curada
manualmente.
:::

## Catálogo de endpoints

A coluna **Auth** é derivada do guard `require_role` / `require_tenant_role` de
cada rota. Um rótulo `session cookie` significa que *qualquer* sessão autenticada
é aceita no handler — mas os perfis com escopo de tenant permanecem confinados
aos seus próprios dados por row-level security, de modo que um `tenant_admin` vê
apenas as linhas do seu tenant, mesmo em uma rota sem proteção no estilo MSSP.

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

## Esquema de autenticação

Navegadores usam um cookie de sessão definido por `POST /api/auth/login`.
Clientes programáticos podem:

1. Conduzir o fluxo de login (preferível para scripts de vida curta):
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. Emitir um token de API de vida longa (planejado; ainda não exposto na UI).
   Hoje, os únicos chamadores sem cookie são os pods **adapter** e **runs-worker**
   por tenant, que se autenticam em `/api/internal/*` com tokens com escopo de
   tenant que a API gera e rotaciona (veja [Endpoints internos](#endpoints-internos-apiinternal)).

Com `SOCTALK_AUTH_MODE=proxy`, a API confia nos cabeçalhos upstream
`X-Forwarded-User` / `X-Forwarded-Email` / `X-Forwarded-Groups` e **toda** a
superfície de autenticação por sessão é desmontada — `/api/auth/*` (`login`,
`logout`, `me`, `assume-tenant`, `password/change`) **e**
`/api/mssp/users/{id}/password/reset` retornam 404 (não 405). Seu IdP é dono da
superfície de identidade.

## CSRF

O CSRF é aplicado **globalmente**, não por prefixo: o
`internal_session_middleware` valida o cabeçalho `Origin` / `Referer` em **toda**
requisição que altera estado (`POST` / `PUT` / `PATCH` / `DELETE`) que carrega o
cookie de sessão. É **validação de cabeçalho**, não um token de cookie
double-submit (esse padrão apareceu em rascunhos anteriores, mas o runtime usa
validação de cabeçalho). As origens aceitas vêm de `SOCTALK_PUBLIC_ORIGIN` (e
`SOCTALK_PUBLIC_ORIGIN_BASE` para hosts de clientes com curinga de slug), que o
chart deriva de `ingress.hostnames`. Requisições que **não** carregam cookie de
sessão (por exemplo, as chamadas com token bearer do adapter/worker, ou a própria
requisição de login) são isentas. Navegadores enviam `Origin` automaticamente;
clientes que não são navegadores podem:

- Igualar o `Origin` a um dos hostnames aceitos, ou
- Definir `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>`
  independentemente do alvo TCP real (o passo de onboarding do [`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) usa esse truque).

## Fluxos comuns

### Onboarding de um tenant

```bash
curl -b jar -X POST https://mssp.../api/mssp/tenants/onboard \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme-corp",
    "display_name": "Acme Corp",
    "profile": "persistent"
  }'
```

`profile` é validado no servidor contra `^(poc|persistent|provided)$`. Veja
[ciclo de vida / profiles do tenant](/pt-br/tenant-lifecycle#profiles) para a
semântica de cada valor. Para `provided` (BYO-Wazuh), o payload exige
adicionalmente um objeto `external_siem` (URL do indexer, URL da Manager API,
credenciais basic-auth) mais um `llm_api_key` por tenant; o servidor retorna 422
com erros por campo se algum estiver faltando.

Retorna 202 com o ID do novo tenant. Acompanhe `GET /api/mssp/tenants/{id}` para
as transições de estado, ou faça polling em `GET /api/mssp/tenants/{id}/events`
para a lista de eventos do ciclo de vida. (`/api/events/stream` existe, mas emite
apenas pings de keep-alive nesta versão.)

### Obter o log de auditoria

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed&page=1&page_size=50'
```

O router de auditoria é de nível superior (`/api/audit`), não fica sob
`/api/mssp/`. Filtros: `start_date` / `end_date` (ISO 8601), `event_type`,
`aggregate_type` e `investigation_id`. Os resultados são paginados por offset com
`page` / `page_size`.

### Enviar uma decisão de revisão humana

O router de revisão expõe um endpoint por decisão (não há um único caminho
`/decision`). Escolha o correspondente:

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

Todos os quatro retornam 409 se a revisão não estiver mais `pending`.

Para propostas de IR (a superfície de gestão de casos), os endpoints equivalentes
ficam em `/api/mssp/proposals/{id}/approve` e `/api/mssp/proposals/{id}/reject`.

### Transmitir eventos

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events. **Nesta versão o stream emite apenas pings de keep-alive**
(um `ping` aproximadamente a cada 25 s) — a transmissão de eventos de domínio
(atualizações de investigação, ciclo de vida do tenant, etc.) está no roadmap.
Trate o endpoint hoje como um teste de conectividade de baixo nível.

## Gerar um cliente Python

O schema é gerado de forma limpa, então a maneira mais rápida de chamar a API a
partir do Python é gerar um cliente tipado com
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
em vez de escrever requisições à mão. Aqui está o fluxo completo, lendo
investigações.

### 1. Gerar + instalar o cliente

```bash
pip install openapi-python-client
openapi-python-client generate \
  --url https://mssp.your-mssp.example/api/openapi.json --meta setup
pip install ./soc-talk-v1-client   # package name derives from the schema title
```

### 2. Consumir investigações

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

As funções de endpoint recebem o nome do operationId que o FastAPI deriva da rota
(`list_investigations_api_investigations_get`) — crie apelidos (alias) para elas
no import, como acima, para melhor legibilidade. `sync()` retorna o modelo
desserializado (`InvestigationList`, cujos `.items` são `Investigation`);
`sync_detailed()` retorna o `Response` bruto com o código de status, se você
precisar.

Uma versão executável — gerar, fazer login, listar + ler — é distribuída como o
smoke test de codegen [`tests/e2e/smoke_openapi_client.py`](https://github.com/soctalk/soctalk/blob/main/tests/e2e/smoke_openapi_client.py),
que o pipeline de deploy executa contra a API ativa, de modo que um schema que
deixe de gerar um cliente funcional quebra o build.

## Endpoints internos (`/api/internal/*`)

Usados pelo adapter e pelo runs-worker por tenant (veja os grupos
`internal-adapter` e `internal-worker` no catálogo acima). Não se destinam a
consumo humano — estão listados para que MSSPs possam ver o que esses pods estão
fazendo.

Cada chamada carrega um token com escopo de tenant que a API gera no
provisionamento e **renova automaticamente** antes de expirar (tokens de adapter
duram 7 dias, tokens de worker 30 dias; o control plane os regenera bem dentro
dessa janela). Os tokens são vinculados ao tenant — um adapter só pode atuar nas
URLs do seu próprio tenant.

## Limites de taxa

A API em si não impõe limites de taxa por rota nesta versão. Use a camada de
ingress para limitação de taxa global (middleware do Traefik, anotações do
ingress-nginx) se precisar.

## Versionamento

O documento OpenAPI carrega a versão do aplicativo. Buscamos mudanças aditivas
dentro de uma minor; mudanças incompatíveis apenas em um incremento major. As
[notas de versão](https://github.com/soctalk/soctalk/releases) destacam toda
alteração que afeta a API.

## Ponteiros para o código-fonte

Todos os routers ficam sob `src/soctalk/core/api/`.

| Conceito | Arquivo |
|---|---|
| Router de auth + middleware de sessão | [`core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py), [`core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| Ciclo de vida do tenant MSSP | [`core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| Configuração de LLM por tenant | [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
| Investigações / IR / propostas | [`core/api/investigations_bridge.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/investigations_bridge.py), [`core/api/ir.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/ir.py) |
| Auditoria / revisão / analytics / configurações / eventos (stubs) | [`core/api/legacy_stubs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/legacy_stubs.py) |
| Chat | [`core/api/chat.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/chat.py) |
| Rotas do worker (internas) | [`core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Rotas do adapter (internas) | [`core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| Gerador de OpenAPI | [`scripts/dump_openapi.py`](https://github.com/soctalk/soctalk/blob/main/scripts/dump_openapi.py) |
