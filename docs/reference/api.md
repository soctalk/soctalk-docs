# REST API

The SocTalk API is a FastAPI app. Its full surface is documented via OpenAPI at runtime:

- **OpenAPI JSON**: `https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI**: `https://mssp.your-mssp.example/api/docs`
- **ReDoc**: `https://mssp.your-mssp.example/api/redoc`

(Served under `/api/` — the ingress routes `/api/*` to the API and everything
else to the web console, so the schema and docs live alongside the other
`/api/*` routes rather than at the bare host root.)

The OpenAPI surface is the source of truth. This page is the catalog you read first to know where to look.

## Catalog

| Prefix | Purpose | Auth |
|---|---|---|
| `/api/auth/*` | Sessions, password change, OIDC trusted proxy | session cookie or none |
| `/api/mssp/tenants/*` | Tenant onboarding/lifecycle/audit (proposals subroute exposes IR review) | `mssp_admin` or `platform_admin` |
| `/api/mssp/users/{id}/password/reset` | Admin-forced password reset (only user-management endpoint in this release) | `mssp_admin` |
| `/api/investigations/*` | Investigations CRUD, timeline, lifecycle | session-scoped |
| `/api/review/*` | Human-in-the-loop review endpoints + decision capture | `mssp_admin` / `analyst` |
| `/api/audit/*` | Audit log queries + stats. Top-level (not under `/api/mssp/`) | `mssp_admin` |
| `/api/events/stream` | Event streaming (Server-Sent Events) — long-poll endpoint | session-scoped |
| `/api/analytics/*` | Executive KPIs, AI behaviour, human-review stats, outcome metrics | `mssp_admin` |
| `/api/metrics/*` | Per-tenant metric snapshots (in-product; separate from Prometheus `/metrics`) | session-scoped |
| `GET /api/settings` | Returns **hard-coded stub values** from `core/api/legacy_stubs.py` — does NOT reflect the install's actual env-derived configuration. Read-only. There is **no `PUT /api/settings`** to mutate. Per-tenant LLM updates go through `/api/mssp/tenants/{id}/llm` and `/api/tenant/llm/api-key` | `mssp_admin` |
| `/api/internal/*` | Adapter heartbeats, runs-worker claim/complete | service JWT (adapter, worker) |
| `/api/public/tenant-by-slug/{slug}` | Public branding lookup for customer-portal URL resolution | none |
| `/health/live` | Liveness probe (200 if process is running) | none |
| `/health/ready` | Readiness probe (200 if DB reachable; 503 otherwise) | none |
| `/metrics` | Prometheus scrape target | none (NetworkPolicy / Ingress for auth) |

See [`src/soctalk/api/routes/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/api/routes) for source.

## Auth scheme

Browsers use a session cookie set by `POST /api/auth/login`. Programmatic clients can either:

1. Drive the login flow (preferred for short-lived scripts):
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. Issue a long-lived API token (planned; not yet exposed in the UI). Today, service-to-service callers use short-lived JWTs minted by the API itself (`/api/internal/*` flows).

In `SOCTALK_AUTH_MODE=proxy`, the API trusts upstream `X-Forwarded-User` / `X-Forwarded-Email` / `X-Forwarded-Groups` headers. The session cookie routers (`/api/auth/login`, `/api/auth/password/change`) are not mounted — clients get a 404 (not 405). Your IdP owns the identity surface.

## CSRF

State-changing endpoints under `/api/mssp/*` and `/api/review/*` (and the dedicated tenant-LLM PATCH route) enforce CSRF via **Origin / Referer header validation** on session-cookie requests (not a double-submit cookie token — that pattern was described in earlier drafts but the runtime uses header validation). The accepted Origins are derived from `ingress.hostnames` in the chart values. Browsers send `Origin` automatically; non-browser clients can either:

- Match `Origin` to one of the accepted hostnames, or
- Set `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>` regardless of actual TCP target (the [`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) onboarding step uses this trick).

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

`profile` is validated server-side against `^(poc|persistent|provided)$`. See [tenant lifecycle / profiles](/tenant-lifecycle#profiles) for the semantics of each value. For `provided` (BYO-Wazuh), the payload additionally requires an `external_siem` object (indexer URL, Manager API URL, basic-auth creds) plus a per-tenant `llm_api_key`; the server returns 422 with field-level errors if any are missing.

Returns 202 with the new tenant ID. Watch `GET /api/mssp/tenants/{id}` for state transitions, or poll `GET /api/mssp/tenants/{id}/events` for the lifecycle event list. (`/api/events/stream` exists but emits keep-alive pings only in this release.)

### Get the audit log

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed'
```

Note: the audit router is top-level (`/api/audit`), not under `/api/mssp/`. Query parameters are `start_date` / `end_date` (ISO 8601 datetimes) and `event_type`. There is no cursor / `Link`-header pagination in this release; use date ranges to chunk large queries.

### Submit a human-review decision

The review router exposes one endpoint per decision (no single `/decision` path). Pick the matching one:

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

For IR proposals (the case-management surface), the equivalent endpoints are under `/api/mssp/proposals/{id}/approve` and `/api/mssp/proposals/{id}/reject`.

### Stream events

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events. **In this release the stream emits keep-alive pings only** — broadcasting domain events (investigation updates, tenant lifecycle, etc.) is on the roadmap. Treat the endpoint as a wire-level connectivity test today.

## Internal endpoints (`/api/internal/*`)

Used by the per-tenant adapter and runs-worker. Not for human consumption — listed here so MSSPs can see what those pods are doing.

| Endpoint | Caller | Purpose |
|---|---|---|
| `POST /api/internal/adapter/heartbeat` | tenant adapter | Liveness ping only |
| `POST /api/internal/adapter/events` | tenant adapter | Alert batch upload |
| `GET  /api/internal/adapter/config` | tenant adapter | Fetch tenant's adapter config |
| `POST /api/internal/worker/runs/claim` | runs-worker | Pull the next run assigned to this tenant |
| `POST /api/internal/worker/runs/{run_id}/heartbeat` | runs-worker | Keep-alive during long graph executions |
| `POST /api/internal/worker/runs/{run_id}/complete` | runs-worker | Final state + disposition |

Each call carries a short-lived (1 h) JWT minted by the API. Tokens are tenant-scoped — an adapter can only POST against its own tenant's URLs.

## Rate limits

The API itself does not impose per-route rate limits in this release. Use the ingress layer for global rate limiting (Traefik middleware, ingress-nginx annotations) if you need it.

## Versioning

The OpenAPI document carries the chart's appVersion. We aim for additive changes within a minor; breaking changes only on a major bump. The [release notes](https://github.com/soctalk/soctalk/releases) call out every API-affecting change.

## Source pointers

| Concept | File |
|---|---|
| Per-route routers | [`src/soctalk/api/routes/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/api/routes) (audit, events, settings, review, investigations, …) |
| Auth router + middleware | [`src/soctalk/core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py) and [`src/soctalk/core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| MSSP tenant routes | [`src/soctalk/core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| Worker (internal) routes | [`src/soctalk/core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Adapter (internal) routes | [`src/soctalk/core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| Per-tenant LLM config | [`src/soctalk/core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
