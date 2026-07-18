# Postgres RLS

三角色 Postgres 模型、RLS 策略模板、`FORCE ROW LEVEL SECURITY` 纪律，以及 SocTalk 在 CI 中运行的隔离测试。

> **V1 部署说明。** 下文将"API pod"和"orchestrator pod"称为独立的工作负载——角色模型和访问规则依然正确。在 V1 chart 中，它们**共置于单个 `soctalk-system-api` Deployment** 中，因此本版本中所有对"orchestrator pod"的引用均映射到这一组 pod。

## 角色

三个 Postgres 角色。任何应用程序都不会以 `postgres` 超级用户身份连接。

| 角色 | 用途 | 使用方 | DDL？ | BYPASSRLS？ |
|---|---|---|---|---|
| `soctalk_admin` | 表所有者；仅在迁移时由 Alembic 使用 | Alembic（在部署时通过专用的 Kubernetes Job 运行） | 是 | 否 |
| `soctalk_app` | 运行时应用角色 | SocTalk API pod、orchestrator pod、worker job——所有"常规"流量 | 否 | 否 |
| `soctalk_mssp` | 跨租户提权角色 | 仅通过 `system_context()` 的 `System` 主体使用 | 否 | **是** |

采用三个角色而非两个的理由：`soctalk_admin` 既不能在应用运行时使用（权限过大），也不会无意中绕过 RLS。`soctalk_app` 受 RLS 约束，因此应用程序缺陷无法造成跨租户泄漏。`soctalk_mssp` 有意支持跨租户，但被隔离到仅限受审计的代码路径中。

## 角色 DDL

在初始迁移中创建：

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

为应用角色引入可变表的迁移会显式授予额外的权限，例如：

```sql
GRANT UPDATE, DELETE ON cases, proposals, notes TO soctalk_app;
```

仅追加（append-only）表绝不会出现在此类授权中。§9 中的测试断言：即便设置了租户上下文，`soctalk_app` 也不能 UPDATE 或 DELETE `audit_log` 或 `execution_log`。

凭据存储在 `soctalk-system` 下的 K8s Secret 中：

- `soctalk-postgres-admin-creds` — 仅挂载到 Alembic Job
- `soctalk-postgres-app-creds` — 挂载到 SocTalk API + orchestrator pod
- `soctalk-postgres-mssp-creds` — 仅挂载到 SocTalk API pod（由 `system_context()` 工厂读取）

## 为何采用 `FORCE ROW LEVEL SECURITY`

Postgres 的默认行为：表所有者和超级用户会自动绕过 RLS。如果没有 `FORCE ROW LEVEL SECURITY`，`soctalk_admin`（所有者）将不受策略约束，但 `soctalk_admin` 负责运行迁移，而一个读取租户范围数据以进行转换的迁移可能会意外跨越租户。

应用 `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` 会使所有者也受 RLS 约束。有意需要跨租户访问的迁移必须满足以下之一：

1. 临时为自己授予 `BYPASSRLS`（特权，受审计），或
2. 在每次访问前显式设置 `app.current_tenant_id`（对于按租户的数据转换，推荐此方式）。

## 会话变量

SocTalk 按事务设置 `app.current_tenant_id`（一个自定义 GUC）。策略通过 `current_setting('app.current_tenant_id', true)` 引用它。第二个参数 `true` 在未设置时返回 NULL（而非报错），从而使隔离测试保持整洁。

中间件：

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

`set_config(..., true)` 是事务范围的；请求之间不会发生连接污染。

## 策略模板

对于每一张租户范围的表，迁移都会应用：

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

租户范围的表（每张均应用该策略）：

- `investigations`
- `events`
- `metrics_hourly`
- `ioc_stats`、`rule_stats`、`analyzer_stats`
- `pending_reviews`
- `integration_configs`
- `branding_configs`
- `tenant_secrets`
- `tenant_lifecycle_events`
- `audit_log`
- `users`（条件策略见下文）

### `users` 表策略

users 表同时保存 MSSP 侧用户（`tenant_id IS NULL`）和租户侧用户（已设置 `tenant_id`）。针对 `soctalk_app` 的策略是**严格的租户范围限定**：`tenant_id IS NULL` 的行不可见。

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

MSSP 侧用户的访问（对 `tenant_id IS NULL` 行的 CRUD）只能在 `soctalk_mssp` 角色下实现，该角色具有 `BYPASSRLS`，并且仅通过 MSSP-API 处理程序中的 `System` 上下文管理器进入。在此策略下，租户范围的 `soctalk_app` 会话——即便运行的是一个过滤宽松的 users 查询——也无法看到或修改 MSSP 用户行。

其重要性在于：该策略的早期草案曾在 `USING`/`WITH CHECK` 中允许 `tenant_id IS NULL`，"以便 MSSP 联接能够工作"。这是不安全的；`soctalk_mssp` 无需 RLS 即可看到 MSSP 行（它绕过 RLS），而将同样的窗口授予 `soctalk_app` 会为租户端点打开一条通过过滤不足的查询泄漏 MSSP 用户数据的路径。

## 安装范围的表（无 RLS）

这些表没有 `tenant_id`，也没有 RLS：

- `organizations`
- `releases`
- `install_settings`
- （可选）`feature_flags`

向 `soctalk_app` 授予 `GRANT SELECT`；对于大多数表，`INSERT/UPDATE/DELETE` 仅限于 `soctalk_mssp`（MSSP 管理员通过 API 在 `System` 上下文下进行修改）。

## 幂等键范围限定

事件存储的幂等键是复合键：

```sql
ALTER TABLE events DROP CONSTRAINT events_idempotency_key_unique;
ALTER TABLE events ADD CONSTRAINT events_tenant_idempotency_unique
  UNIQUE (tenant_id, idempotency_key);
```

原因：若没有这一点，两个租户之间的外部告警 ID 冲突将导致跨租户的事件拒绝/重复。使用复合键后，每个租户拥有各自的幂等命名空间。

## 隔离测试

### 测试 1 — 应用端点探测

对于 `/api/tenant/*` 和 `/api/mssp/*` 中的每一个端点：

```python
async def test_no_cross_tenant_access(client, seed_two_tenants):
    tenant_a, tenant_b = seed_two_tenants
    resp = await client.get("/api/tenant/investigations",
                            headers={"Authorization": f"Bearer {tenant_a.token}"})
    data = resp.json()
    assert all(item["tenant_id"] == str(tenant_a.id) for item in data["items"])
    assert not any(item["tenant_id"] == str(tenant_b.id) for item in data["items"])
```

### 测试 2 — `soctalk_app` 下的原始 SQL

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

### 测试 3 — Worker 上下文默认值

```python
async def test_worker_without_context_sees_nothing():
    @tenant_scoped_worker
    async def hostile_worker(state):
        result = await db.execute(select(Event))
        return result.all()
    with pytest.raises(MissingTenantContext):
        await hostile_worker({})
```

### 测试 4 — FORCE RLS 拦截所有者

```python
async def test_admin_role_is_rls_subject():
    async with admin_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0  # admin is NOT bypassing
```

### 测试 5 — MSSP 角色可有意绕过

```python
async def test_mssp_role_bypasses_for_rollup():
    async with mssp_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == total_events_across_tenants
```

### 测试 6 — SSE 流隔离

```python
async def test_sse_no_cross_tenant_delivery(ws_client):
    sub_a = await ws_client.subscribe("/api/tenant/events/stream",
                                      token=tenant_a.token)
    await inject_event(tenant_b, "test.event")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sub_a.receive(), timeout=2.0)
```

### 测试 7 — 幂等性隔离

```python
async def test_idempotency_key_per_tenant():
    await insert_event(tenant_a, idempotency_key="ext-123")
    await insert_event(tenant_b, idempotency_key="ext-123")
    with pytest.raises(IntegrityError):
        await insert_event(tenant_a, idempotency_key="ext-123")
```

全部七项测试都必须在 CI 中通过。无一可选。

## 运维说明

- **连接池。** 每个角色独立连接池。SocTalk API 有两个连接池（`soctalk_app` 和 `soctalk_mssp`）；worker pod 只有一个（`soctalk_app`）。Alembic Job 以 `soctalk_admin` 身份使用一次性连接。
- **日志。** 每个连接都会在 `pg_stat_activity.usename` 中记录其角色。运维人员可以审计哪个角色在运行哪个查询。
- **超级用户访问。** Postgres 超级用户存在，但仅用于紧急破窗（break-glass）调试，任何应用代码都不会使用。凭据单独存储，并在使用后轮换。
