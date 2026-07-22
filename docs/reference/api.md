# REST API

The SocTalk API is a FastAPI app. Its full surface is generated from the code as
an OpenAPI schema and served **under `/api/`** (the ingress routes `/api/*` to
the API and everything else to the web console):

- **OpenAPI JSON**: `https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI**: `https://mssp.your-mssp.example/api/docs`
- **ReDoc**: `https://mssp.your-mssp.example/api/redoc`

The OpenAPI surface is the source of truth. A snapshot of it ships with these
docs at [`/openapi.json`](/openapi.json), and the catalog below is **generated
from that schema** — it cannot drift from the code.

::: tip Regenerating the catalog
The endpoint catalog is produced by `npm run gen:api`, which reads
`docs/public/openapi.json`. Refresh the schema from the API code first:

```bash
# in the soctalk repo
python scripts/dump_openapi.py <soctalk-docs>/docs/public/openapi.json
# in soctalk-docs
npm run gen:api
```

Everything between the `GENERATED` markers is overwritten; the prose around it
is curated by hand.
:::

## Endpoint catalog

The **Auth** column is derived from each route's `require_role` /
`require_tenant_role` guard. A label of `session cookie` means *any*
authenticated session is accepted at the handler — but tenant-scoped roles are
still confined to their own data by row-level security, so a `tenant_admin`
sees only their tenant's rows even on an ungated MSSP-style route.

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

## Auth scheme

Browsers use a session cookie set by `POST /api/auth/login`. Programmatic
clients can either:

1. Drive the login flow (preferred for short-lived scripts):
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. Issue a long-lived API token (planned; not yet exposed in the UI). Today, the
   only non-cookie callers are the per-tenant **adapter** and **runs-worker**
   pods, which authenticate to `/api/internal/*` with tenant-scoped tokens the
   API mints and rotates (see [Internal endpoints](#internal-endpoints)).

In `SOCTALK_AUTH_MODE=proxy`, the API trusts upstream `X-Forwarded-User` /
`X-Forwarded-Email` / `X-Forwarded-Groups` headers and the **entire** session
auth surface is unmounted — `/api/auth/*` (`login`, `logout`, `me`,
`assume-tenant`, `password/change`) **and** `/api/mssp/users/{id}/password/reset`
return 404 (not 405). Your IdP owns the identity surface.

## CSRF

CSRF is enforced **globally**, not per-prefix: `internal_session_middleware`
validates the `Origin` / `Referer` header on **every** state-changing request
(`POST` / `PUT` / `PATCH` / `DELETE`) that carries the session cookie. It is
**header validation**, not a double-submit cookie token (that pattern appeared
in earlier drafts but the runtime uses header validation). The accepted origins
come from `SOCTALK_PUBLIC_ORIGIN` (and `SOCTALK_PUBLIC_ORIGIN_BASE` for
slug-wildcard customer hosts), which the chart derives from `ingress.hostnames`.
Requests that carry **no** session cookie (e.g. the adapter/worker bearer-token
calls, or the login request itself) are exempt. Browsers send `Origin`
automatically; non-browser clients can either:

- Match `Origin` to one of the accepted hostnames, or
- Set `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>`
  regardless of actual TCP target (the [`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) onboarding step uses this trick).

## Common flows

### Onboard a tenant

```bash
curl -b jar -X POST https://mssp.../api/mssp/tenants/onboard \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme-corp",
    "display_name": "Acme Corp",
    "profile": "persistent"
  }'
```

`profile` is validated server-side against `^(poc|persistent|provided)$`. See
[tenant lifecycle / profiles](/tenant-lifecycle#profiles) for the semantics of
each value. For `provided` (BYO-Wazuh), the payload additionally requires an
`external_siem` object (indexer URL, Manager API URL, basic-auth creds) plus a
per-tenant `llm_api_key`; the server returns 422 with field-level errors if any
are missing.

Returns 202 with the new tenant ID. Watch `GET /api/mssp/tenants/{id}` for state
transitions, or poll `GET /api/mssp/tenants/{id}/events` for the lifecycle event
list. (`/api/events/stream` exists but emits keep-alive pings only in this
release.)

### Get the audit log

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed&page=1&page_size=50'
```

The audit router is top-level (`/api/audit`), not under `/api/mssp/`. Filters:
`start_date` / `end_date` (ISO 8601), `event_type`, `aggregate_type`, and
`investigation_id`. Results are offset-paginated with `page` / `page_size`.

### Submit a human-review decision

The review router exposes one endpoint per decision (no single `/decision`
path). Pick the matching one:

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

All four return 409 if the review is no longer `pending`.

For IR proposals (the case-management surface), the equivalent endpoints are
under `/api/mssp/proposals/{id}/approve` and `/api/mssp/proposals/{id}/reject`.

### Stream events

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events. **In this release the stream emits keep-alive pings only**
(a `ping` roughly every 25 s) — broadcasting domain events (investigation
updates, tenant lifecycle, etc.) is on the roadmap. Treat the endpoint as a
wire-level connectivity test today.

## Generate a Python client

The schema generates cleanly, so the fastest way to call the API from Python is
to generate a typed client with
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
rather than hand-rolling requests. Here it is end-to-end, reading investigations.

### 1. Generate + install the client

```bash
pip install openapi-python-client
openapi-python-client generate \
  --url https://mssp.your-mssp.example/api/openapi.json --meta setup
pip install ./soc-talk-v1-client   # package name derives from the schema title
```

### 2. Consume investigations

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

The endpoint functions are named after the operationId FastAPI derives from the
route (`list_investigations_api_investigations_get`) — alias them on import, as
above, for readability. `sync()` returns the deserialized model
(`InvestigationList`, whose `.items` are `Investigation`); `sync_detailed()`
returns the raw `Response` with the status code if you need it.

A runnable version — generate, log in, list + read — ships as the codegen smoke
test [`tests/e2e/smoke_openapi_client.py`](https://github.com/soctalk/soctalk/blob/main/tests/e2e/smoke_openapi_client.py),
which the deploy pipeline runs against the live API so a schema that stops
generating a working client fails the build.

## Internal endpoints (`/api/internal/*`)

Used by the per-tenant adapter and runs-worker (see the `internal-adapter` and
`internal-worker` groups in the catalog above). Not for human consumption —
listed so MSSPs can see what those pods are doing.

Each call carries a tenant-scoped token the API mints at provision and
**auto-renews** before it expires (adapter tokens live 7 days, worker tokens 30
days; the control plane re-mints them well inside that window). Tokens are
tenant-bound — an adapter can only act on its own tenant's URLs.

## Rate limits

The API itself does not impose per-route rate limits in this release. Use the
ingress layer for global rate limiting (Traefik middleware, ingress-nginx
annotations) if you need it.

## Versioning

The OpenAPI document carries the app version. We aim for additive changes within
a minor; breaking changes only on a major bump. The [release notes](https://github.com/soctalk/soctalk/releases)
call out every API-affecting change.

## Source pointers

All routers live under `src/soctalk/core/api/`.

| Concept | File |
|---|---|
| Auth router + session middleware | [`core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py), [`core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| MSSP tenant lifecycle | [`core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| Per-tenant LLM config | [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
| Investigations / IR / proposals | [`core/api/investigations_bridge.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/investigations_bridge.py), [`core/api/ir.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/ir.py) |
| Audit / review / analytics / settings / events (stubs) | [`core/api/legacy_stubs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/legacy_stubs.py) |
| Chat | [`core/api/chat.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/chat.py) |
| Worker (internal) routes | [`core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Adapter (internal) routes | [`core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| OpenAPI generator | [`scripts/dump_openapi.py`](https://github.com/soctalk/soctalk/blob/main/scripts/dump_openapi.py) |
