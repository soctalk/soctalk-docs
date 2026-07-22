# Security Model

Principal catalog, actor×resource matrix, RLS policy matrix, Postgres role model, endpoint classification, token claim schemas, audit requirements, secret placement.

> **V1 deployment note.** The endpoint examples below (e.g. `/api/mssp/impersonate/:tenant_id`, `/api/mssp/users` POST/list, `/api/mssp/fleet/summary`) and several principal entries (Cloud license issuer; the impersonation actor) describe the **target security surface**. The mounted MSSP endpoints include: tenant CRUD, audit (`/api/audit`), staff user management (`/api/mssp/users` create/list/patch/deactivate and `/{id}/password/reset`), and `/api/auth/assume-tenant` for session-tenant scoping (not user impersonation). Tenant self-service user management lives under `/api/tenant/users`. Use the matrices below as the design intent; consult [REST API](/reference/api) for what's actually live.

## Principal catalog

Eight principals.

| # | Principal | Category | Scope | Authenticates via |
|---|---|---|---|---|
| 1 | **User** (role ∈ {platform_admin, mssp_admin, mssp_manager, analyst, tenant_admin, tenant_manager, tenant_analyst, customer_viewer}) | Human | Role-derived | Ingress OIDC → SocTalk JWT |
| 2 | **Worker** | SocTalk service (background) | One tenant per job | Service JWT, short-lived, issued by SocTalk API at dispatch |
| 3 | **System** | SocTalk service (cross-tenant ops) | Install-wide, RLS-bypass | Code-path gated; no JWT |
| 4 | **SocTalk K8s ServiceAccount** | SocTalk service (K8s identity) | Cluster, name-convention-scoped to `tenant-*` | K8s projected token |
| 5 | **Tenant adapter** | Data plane sidecar | Single tenant, calls SocTalk API only | Adapter JWT, tenant-scoped, short-lived |
| 6 | **Wazuh agent** | External endpoint agent | Single tenant's Wazuh manager | Wazuh `authd` enrollment → per-agent mTLS |
| 7 | **MSSP cluster admin** | Human, out-of-band | Entire cluster (unbounded) | `kubectl` credentials |
| 8 | **Cloud license issuer** | Trust anchor | Offline signing authority | Ed25519 key in HSM/KMS (future release) |

### User roles

Roles are capability bundles organised into three tiers per audience (operate ⊆ authorize-risk ⊆ configure); the tenant side adds a read-only stakeholder below operate. See [Users and roles](/users-and-roles) for the capability model.

MSSP-side (`tenant_id` NULL):

| Role | Tier | Typical function |
|---|---|---|
| `platform_admin` | configure (super) | Every MSSP capability, install-wide. |
| `mssp_admin` | configure | Configure the system, manage staff users, plus everything below. |
| `mssp_manager` | authorize-risk | Declare engagements, curate authorization facts, sign off high-blast actions, plus operate. |
| `analyst` | operate | Triage, review verdicts, decide, chat; works a tenant via an Open-SOC pin. |

Tenant-side (`tenant_id` set):

| Role | Tier | Typical function |
|---|---|---|
| `tenant_admin` | configure | Manage own-org users and LLM settings, plus everything below. |
| `tenant_manager` | authorize-risk | Declare own engagements, assert authorization facts (MSSP-reviewed), plus operate. |
| `tenant_analyst` | operate | Work its own tenant's SOC: triage, review verdicts, decide, chat. |
| `customer_viewer` | view only | Read-only dashboards and investigations; cannot act or open the review queue. |

Scope derivation: `role ∈ {platform_admin, mssp_admin, mssp_manager, analyst}` ⇒ `tenant_id` NULL in DB, cross-tenant access via elevated Postgres role or session-tenant scoping (`/api/auth/assume-tenant`). `role ∈ {tenant_admin, tenant_manager, tenant_analyst, customer_viewer}` ⇒ `tenant_id` required in user row and JWT. MSSP capabilities and tenant capabilities never overlap; the guard on each route checks capability and audience together.

### Worker principal discipline

Every background job must carry `tenant_id` in its payload. Worker entrypoints are decorated with `@tenant_scoped_worker` which sets `app.current_tenant_id` before any DB access. Workers connect as `soctalk_app` Postgres role and are RLS-subject: forgetting to set context yields zero rows, not cross-tenant leakage.

### System principal discipline

Cross-tenant operations (MSSP rollups, migrations, admin tooling) use the `System` principal via a `system_context()` Python context manager. Entry emits an audit row. The context manager is the single gate. `import-linter` prevents its import outside designated system modules. System principal connects as `soctalk_mssp` Postgres role which has `BYPASSRLS`.

## Resource catalog

### Database resources (tenant-scoped)

All have `tenant_id` FK and are subject to RLS:

- `Event` — event store, append-only
- `InvestigationReadModel` — projected investigation state
- `MetricsHourly`, `IOCStats`, `RuleStats`, `AnalyzerStats` — per-tenant projections
- `PendingReview` — HIL queue
- `IntegrationConfig` — per-tenant integration URLs, endpoints, thresholds
- `BrandingConfig` — per-tenant app name, logo, colors
- `TenantSecret` — references (ns + name + version) to K8s Secrets; no raw material
- `TenantLifecycleEvent` — append-only log of tenant state transitions, config revisions
- `AuditLog` — append-only log of mutation actions, with `mssp_user_id` when performed via impersonation

### Database resources (install-scoped)

No `tenant_id`; Organization-scoped or global:

- `Organization` — install-wide (mssp_id, mssp_name, install_id, install_label, reserved license_jwt)
- `User` — both MSSP-side users (nullable tenant_id) and customer users (tenant_id required)
- MSSP-user / Tenant-user semantics derived from role + tenant_id presence; single table
- `Release` — SocTalk version metadata (install-wide)
- Install settings (feature flags, system-wide toggles)

### Kubernetes resources

| Resource | Scope | Managed by |
|---|---|---|
| Namespace `soctalk-system` | Install-level | MSSP cluster admin (created by Helm) |
| Namespace `tenant-<slug>` | Per tenant | SocTalk K8s ServiceAccount (cluster verbs) |
| `Deployment`, `Service`, `PVC`, `Secret`, `ConfigMap`, `NetworkPolicy`, `ResourceQuota`, `LimitRange`, `ServiceAccount`, `Role`, `RoleBinding` in `tenant-*` | Per tenant | SocTalk K8s ServiceAccount |

## Actor × resource matrix

`R` = read, `W` = write, `-` = deny.

| Resource group | `platform_admin` | `mssp_admin` | `analyst` | `customer_viewer` | `Worker` | `System` | `SocTalk K8s SA` | `Tenant adapter` |
|---|---|---|---|---|---|---|---|---|
| Tenant-scoped DB (own tenant) | RW (any) | RW (any) | RW (any) | R (own) | RW (job's tenant) | RW (any via bypass) | - | - |
| Install-scoped DB | RW | R (minus license) | R | - | R | RW | - | - |
| User management (MSSP-side) | RW | RW | - | - | - | RW | - | - |
| User management (tenant-side, own tenant) | - | - | - | - | - | - | - | - |
| Audit log (own tenant) | R all | R all | R all | R own | W | W | - | W (via bootstrap) |
| K8s namespaces `tenant-*` | (via API only) | (via API only) | (via API only) | - | - | - | CRUD | - |
| K8s resources within `tenant-*` | (via API only) | (via API only) | (via API only) | - | - | - | CRUD | R self |
| Per-tenant LLM Secret | - | - | - | - | R (own tenant) | - | mount | - |
| Per-tenant integration Secrets | - | - | - | - | R (own tenant) | - | mount | - |

Notes:
- The columns show a representative subset of roles. `mssp_manager` sits between `mssp_admin` and `analyst` (authorize-risk tier); `tenant_manager` and `tenant_analyst` sit above `customer_viewer` on the tenant side. Each holds every capability of the tier below it.
- User management is capability-walled by audience, a **separation of duties**. MSSP staff users are managed only by `mssp_admin`/`platform_admin` via `/api/mssp/users`; tenant users are managed only by that tenant's own `tenant_admin` via `/api/tenant/users`. An MSSP admin does not manage tenant users, and vice versa. Assigning `platform_admin`, and mutating an existing `platform_admin`, require a `platform_admin`.
- "via API only" means the human principal triggers K8s operations by calling SocTalk API endpoints, not directly. API handlers use the SocTalk K8s ServiceAccount.
- `analyst` acting on a tenant writes audit rows with both `user_id` and the tenant's `tenant_id`; the customer-side audit view shows these as impersonation entries.

## RLS policy matrix

See [Postgres RLS](/reference/postgres-rls) for SQL. Summary:

| Table | Policy | `USING` | `WITH CHECK` |
|---|---|---|---|
| All tenant-scoped tables | `tenant_isolation` | `tenant_id = current_setting('app.current_tenant_id')::uuid` | same |
| `User` (where `tenant_id IS NOT NULL`) | same | same | same |
| `AuditLog` | `audit_read` | same for read; writes allowed from Worker + System | same |
| Install-scoped tables | no RLS | — | — |

All tenant-scoped tables have `FORCE ROW LEVEL SECURITY` so the table owner (`soctalk_admin`) is also RLS-subject. System principal uses the `soctalk_mssp` role (`BYPASSRLS`) to intentionally cross-tenant.

## API endpoint classification

Three categories. Never one endpoint that serves two categories.

### `/api/mssp/*`: MSSP-side (requires an MSSP role; the specific capability varies by route)

Cross-tenant capable. When a handler needs cross-tenant visibility (rollups, fleet views), it uses the `System` principal through `system_context()`. When a handler acts on a specific tenant (impersonation), it sets `app.current_tenant_id` and stays RLS-subject.

Examples (this release): `POST /api/mssp/tenants/onboard`, `GET /api/mssp/tenants`, `POST /api/mssp/tenants/{id}:retry`, `POST /api/mssp/tenants/{id}:suspend|:resume|:decommission`, `GET /api/audit`, MSSP staff user management under `/api/mssp/users`. (Impersonation and fleet rollups are roadmap.)

### `/api/tenant/*`: Tenant-side (requires a tenant role; the specific capability varies by route)

Hard-scoped. Tenant context from JWT; no impersonation entry. All queries RLS-enforced via `soctalk_app`. Includes operate surfaces for `tenant_analyst`+ (triage, review, chat) and self-service for engagements, authorization facts, and users.

Examples: `GET /api/tenant/overview`, `GET /api/tenant/incidents`, `GET /api/tenant/reports`, `GET /api/tenant/audit`, `GET /api/tenant/branding`.

### `/api/internal/*` — Service-to-service (Worker JWT or Adapter JWT)

Not user-facing. Short-lived service JWTs with explicit tenant context. Examples: `POST /api/internal/adapter/health`, `POST /api/internal/adapter/bootstrap`, `GET /api/internal/adapter/config`.

No endpoint accepts both `/api/mssp/*` and `/api/tenant/*` semantics. If a capability is needed on both sides, it is implemented as two endpoints with different authz and different context flows.

## Token claim schemas

### MSSP-side User JWT

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

When an `mssp_admin` or `analyst` enters tenant context, a new short-lived token is minted with `current_tenant: "<tenant_uuid>"`. Impersonation tokens have max 30-minute TTL and are logged at mint time.

### Tenant-side User JWT

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "user_type": "tenant",
  "role": "tenant_admin | tenant_manager | tenant_analyst | customer_viewer",
  "tenant_id": "<tenant_uuid>"
}
```

### Worker service JWT

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

### Adapter JWT

```json
{
  "iss": "soctalk",
  "sub": "adapter",
  "user_type": "adapter",
  "tenant_id": "<tenant_uuid>",
  "scope": "adapter"
}
```

Adapter JWTs are refreshed weekly; rotation is a SocTalk-controller-side secret rewrite in the tenant namespace.

## Audit requirements

Every mutation writes an `AuditLog` row with:

- `id` (uuid), `timestamp`, `tenant_id` (nullable for install-scoped events)
- `actor_principal` (User | Worker | System | Adapter)
- `actor_id` (user_id | `worker:<job_id>` | `system:<reason>` | adapter's tenant_id)
- `action` (enum: `tenant.create`, `tenant.suspend`, `investigation.approve`, `settings.update`, `user.impersonate`, …)
- `resource_type`, `resource_id`
- `before`, `after` (JSON snapshots for state-changing actions)
- `acting_as` (nullable; set when `mssp_admin` or `analyst` is impersonating a tenant)
- `request_id` (correlates with log lines)

Retention is 90 days; configurable per-install in a future release. Customers can view audit rows where `tenant_id = own`, including entries with `acting_as` populated (transparency into MSSP actions). The MSSP cross-tenant audit view runs under the `System` principal.

## Known architectural limits

- **MSSP cluster admin trust.** Principal #7 has unbounded K8s access. SocTalk's isolation model presumes this principal is trusted. Customers requiring defense against insider threat at the MSSP level need dedicated-node or dedicated-VM tiering (future release).
- **Admission boundary scope.** `ValidatingAdmissionPolicy` constrains the SocTalk controller ServiceAccount for tenant namespaces and namespaced resource mutations, but MSSP cluster-admin users remain trusted break-glass operators. Kyverno is an optional future hardening path.
- **No license enforcement currently.** License JWT and feature gates deferred to a future release. Pilot MSSPs operate on honor.
- **LLM response cache.** Keyed on `(tenant_id, prompt_hash)` from day 1. If ever relaxed, cross-tenant content leak risk; the test suite asserts the key composition.
- **SSE subscriptions.** Tenant-scoped at subscription time. Connection-persistence bugs could deliver cross-tenant events on a stale subscription; explicit SSE isolation test in implementation gate.
- **Worker context leakage.** Every worker entrypoint must set `app.current_tenant_id`. Defensive default is zero rows under RLS, not cross-tenant leakage, but the test suite asserts the defense.

## Test requirements

1. **Cross-tenant API probe.** For every `/api/tenant/*` and `/api/mssp/*` endpoint that accesses tenant-scoped data, craft requests as tenant A that attempt reads or writes of tenant B resources. Assert 0 rows or 403.
2. **Raw-SQL RLS probe.** Connect as `soctalk_app`, set `app.current_tenant_id = A`, execute `SELECT * FROM events` (unfiltered); assert only tenant A rows returned.
3. **Worker context default.** Dispatch a worker job without setting tenant context; assert queries return 0 rows (defensive-zero behavior).
4. **SSE isolation.** Subscribe as tenant A to the events SSE; mutate in tenant B; assert no event delivered on A's stream.
5. **LLM cache isolation.** Trigger identical prompts from tenant A and tenant B; assert cache misses on the second call for B (different key) and hits on the third call for A (same key).
6. **Impersonation audit.** As `mssp_admin`, impersonate tenant A, perform a mutation; assert an `AuditLog` row exists with `acting_as=<mssp_admin_id>` and `tenant_id=A`; assert the customer user in A can read the row.
7. **System context audit.** Trigger an `/api/mssp/fleet/summary` call; assert an audit row for system-context entry with reason.
