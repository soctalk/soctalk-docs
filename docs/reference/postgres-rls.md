# Postgres RLS

The three-role Postgres model, RLS policy templates, `FORCE ROW LEVEL SECURITY` discipline, and the isolation tests SocTalk runs in CI.

## Roles

Three Postgres roles. No application ever connects as `postgres` superuser.

| Role | Purpose | Used by | DDL? | BYPASSRLS? |
|---|---|---|---|---|
| `soctalk_admin` | Table owner; used only by Alembic at migration time | Alembic (run via a dedicated Kubernetes Job at deploy) | Yes | No |
| `soctalk_app` | Runtime application role | SocTalk API pods, orchestrator pods, worker jobs — all "normal" traffic | No | No |
| `soctalk_mssp` | Cross-tenant elevated role | `System` principal via `system_context()` only | No | **Yes** |

Rationale for three roles, not two: `soctalk_admin` can neither run at app time (too much privilege) nor bypass RLS unintentionally. `soctalk_app` is RLS-subject so application bugs can't leak cross-tenant. `soctalk_mssp` is intentionally cross-tenant but segregated to audited code paths only.

## Role DDL

Created in the initial migration:

```sql
-- roles
CREATE ROLE soctalk_admin LOGIN PASSWORD :'admin_pw';
CREATE ROLE soctalk_app   LOGIN PASSWORD :'app_pw';
CREATE ROLE soctalk_mssp  LOGIN PASSWORD :'mssp_pw' BYPASSRLS;

-- db ownership
ALTER DATABASE soctalk OWNER TO soctalk_admin;

-- Default privileges. soctalk_app gets a narrow grant by default
-- (SELECT + INSERT only); read-write tables that need UPDATE/DELETE
-- get those grants explicitly per-table in migrations. This keeps
-- append-only tables (audit_log, execution_log, case_events) safe
-- from app-role bugs by default.
ALTER DEFAULT PRIVILEGES FOR ROLE soctalk_admin
  IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO soctalk_app;

-- soctalk_mssp is the BYPASSRLS / System-context role and may need
-- the full surface; keep its default grant broad.
ALTER DEFAULT PRIVILEGES FOR ROLE soctalk_admin
  IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO soctalk_mssp;

ALTER DEFAULT PRIVILEGES FOR ROLE soctalk_admin
  IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO soctalk_app, soctalk_mssp;
```

Migrations that introduce a mutable table for the app role grant the additional privileges explicitly, for example:

```sql
GRANT UPDATE, DELETE ON cases, proposals, notes TO soctalk_app;
```

Append-only tables never appear in such grants. Tests in §9 assert that `soctalk_app` cannot UPDATE or DELETE `audit_log` or `execution_log` even with a tenant context set.

Credentials stored in K8s Secrets under `soctalk-system`:

- `soctalk-postgres-admin-creds` — mounted only to the Alembic Job
- `soctalk-postgres-app-creds` — mounted to SocTalk API + orchestrator pods
- `soctalk-postgres-mssp-creds` — mounted to SocTalk API pod only (read by the `system_context()` factory)

## Why `FORCE ROW LEVEL SECURITY`

Default Postgres behavior: table owners and superusers bypass RLS automatically. Without `FORCE ROW LEVEL SECURITY`, `soctalk_admin` (the owner) would not be subject to policies, but `soctalk_admin` runs migrations, and a migration that reads tenant-scoped data to transform it could accidentally cross tenants.

Applying `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` makes even the owner RLS-subject. Migrations that intentionally need cross-tenant access must either:

1. Temporarily grant themselves `BYPASSRLS` (privileged, audited), or
2. Set `app.current_tenant_id` explicitly before each access (preferred for per-tenant data transforms).

## Session variables

SocTalk sets `app.current_tenant_id` (a custom GUC) per transaction. Policies reference it via `current_setting('app.current_tenant_id', true)`. The `true` second argument returns NULL if unset (rather than erroring), which keeps isolation tests clean.

Middleware:

```python
async def tenant_context_middleware(request, call_next):
    tenant_id = resolve_tenant_from_request(request)  # from JWT
    async with db_session_factory() as session:
        if tenant_id is not None:
            # SET LOCAL does not accept bind parameters in PostgreSQL.
            # set_config(name, value, is_local) is the parameterisable
            # equivalent (is_local=true gives SET LOCAL semantics).
            await session.execute(
                text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                {"tid": str(tenant_id)},
            )
        request.state.db = session
        response = await call_next(request)
    return response
```

`set_config(..., true)` is transaction-scoped; there is no connection pollution across requests.

## Policy template

For every tenant-scoped table, the migration applies:

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

CREATE POLICY <table>_tenant_isolation ON <table>
  FOR ALL
  TO soctalk_app, soctalk_admin
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- soctalk_admin appears in the TO clause so per-tenant migrations can
--   read and update tenant rows after setting app.current_tenant_id.
--   Without it, FORCE RLS would lock the owner out even with context set.
-- soctalk_mssp: BYPASSRLS role-level; policies not consulted.
```

Tenant-scoped tables (policy applied to each):

- `investigations`
- `events`
- `metrics_hourly`
- `ioc_stats`, `rule_stats`, `analyzer_stats`
- `pending_reviews`
- `integration_configs`
- `branding_configs`
- `tenant_secrets`
- `tenant_lifecycle_events`
- `audit_log`
- `users` (conditional policy below)

### `users` table policy

The users table holds both MSSP-side users (`tenant_id IS NULL`) and tenant-side users (`tenant_id` set). The policy for `soctalk_app` is **strict tenant scoping**: rows with `tenant_id IS NULL` are not visible.

```sql
CREATE POLICY users_tenant_scoped ON users
  FOR ALL
  TO soctalk_app
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.current_tenant_id', true)::uuid
  );
```

MSSP-side user access (CRUD on rows where `tenant_id IS NULL`) is reached only under the `soctalk_mssp` role, which has `BYPASSRLS` and is entered exclusively through the `System` context manager in MSSP-API handlers. A tenant-scoped `soctalk_app` session — even one running a loosely-filtered users query — cannot see or modify MSSP user rows under this policy.

Why this matters: an earlier draft of the policy admitted `tenant_id IS NULL` in `USING`/`WITH CHECK` "so MSSP joins would work". That was unsafe; `soctalk_mssp` doesn't need RLS to see MSSP rows (it bypasses RLS), and granting the same window to `soctalk_app` opens a path for tenant endpoints to leak MSSP user data via an under-filtered query.

## Install-scoped tables (no RLS)

These have no `tenant_id` and no RLS:

- `organizations`
- `releases`
- `install_settings`
- (optional) `feature_flags`

`GRANT SELECT` to `soctalk_app`; `INSERT/UPDATE/DELETE` limited to `soctalk_mssp` for most (MSSP admins modify via API under `System` context).

## Idempotency key scoping

The event store's idempotency key is composite:

```sql
ALTER TABLE events DROP CONSTRAINT events_idempotency_key_unique;
ALTER TABLE events ADD CONSTRAINT events_tenant_idempotency_unique
  UNIQUE (tenant_id, idempotency_key);
```

Reason: absent this, an external alert ID collision between two tenants would cause a cross-tenant event reject/duplicate. With the composite key, each tenant has its own idempotency namespace.

## Isolation tests

### Test 1 — Application endpoint probe

For every endpoint in `/api/tenant/*` and `/api/mssp/*`:

```python
async def test_no_cross_tenant_access(client, seed_two_tenants):
    tenant_a, tenant_b = seed_two_tenants
    resp = await client.get("/api/tenant/investigations",
                            headers={"Authorization": f"Bearer {tenant_a.token}"})
    data = resp.json()
    assert all(item["tenant_id"] == str(tenant_a.id) for item in data["items"])
    assert not any(item["tenant_id"] == str(tenant_b.id) for item in data["items"])
```

### Test 2 — Raw SQL under `soctalk_app`

```python
async def test_raw_sql_respects_rls():
    async with app_connection() as conn:
        await conn.execute(
            text("SELECT set_config('app.current_tenant_id', :tid, true)"),
            {"tid": str(tenant_a.id)},
        )
        result = await conn.execute(text("SELECT tenant_id FROM events"))
        for row in result.fetchall():
            assert row.tenant_id == tenant_a.id
    # Also verify: unset context yields zero rows (defensive-zero)
    async with app_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0
```

### Test 3 — Worker context default

```python
async def test_worker_without_context_sees_nothing():
    @tenant_scoped_worker
    async def hostile_worker(state):
        result = await db.execute(select(Event))
        return result.all()
    with pytest.raises(MissingTenantContext):
        await hostile_worker({})
```

### Test 4 — FORCE RLS catches owner

```python
async def test_admin_role_is_rls_subject():
    async with admin_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0  # admin is NOT bypassing
```

### Test 5 — MSSP role can bypass intentionally

```python
async def test_mssp_role_bypasses_for_rollup():
    async with mssp_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == total_events_across_tenants
```

### Test 6 — SSE stream isolation

```python
async def test_sse_no_cross_tenant_delivery(ws_client):
    sub_a = await ws_client.subscribe("/api/tenant/events/stream",
                                      token=tenant_a.token)
    await inject_event(tenant_b, "test.event")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sub_a.receive(), timeout=2.0)
```

### Test 7 — Idempotency isolation

```python
async def test_idempotency_key_per_tenant():
    await insert_event(tenant_a, idempotency_key="ext-123")
    await insert_event(tenant_b, idempotency_key="ext-123")
    with pytest.raises(IntegrityError):
        await insert_event(tenant_a, idempotency_key="ext-123")
```

All seven tests are required to pass in CI. None optional.

## Operational notes

- **Connection pools.** Separate pool per role. SocTalk API has two pools (`soctalk_app` and `soctalk_mssp`); worker pods have one (`soctalk_app`). The Alembic Job uses a throwaway connection as `soctalk_admin`.
- **Logging.** Every connection logs its role in `pg_stat_activity.usename`. Operators can audit which role is running which query.
- **Superuser access.** Postgres superuser exists but is only used for break-glass debugging, not by any application code. Credentials stored separately and rotated after use.
