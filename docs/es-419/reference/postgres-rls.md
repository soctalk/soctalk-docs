# Postgres RLS

El modelo de tres roles de Postgres, las plantillas de políticas RLS, la disciplina de `FORCE ROW LEVEL SECURITY` y las pruebas de aislamiento que SocTalk ejecuta en CI.

> **Nota sobre el despliegue V1.** El texto siguiente se refiere a los "pods de API" y a los "pods de orquestador" como cargas de trabajo separadas, el modelo de roles y las reglas de acceso siguen siendo correctos. En el chart V1 están **co-ubicados en un único Deployment `soctalk-system-api`**, por lo que cada referencia a un "pod de orquestador" corresponde a ese único conjunto de pods en esta versión.

## Roles

Tres roles de Postgres. Ninguna aplicación se conecta jamás como el superusuario `postgres`.

| Rol | Propósito | Usado por | ¿DDL? | ¿BYPASSRLS? |
|---|---|---|---|---|
| `soctalk_admin` | Propietario de las tablas; usado únicamente por Alembic en tiempo de migración | Alembic (ejecutado mediante un Job dedicado de Kubernetes en el despliegue) | Sí | No |
| `soctalk_app` | Rol de aplicación en tiempo de ejecución | Pods de API de SocTalk, pods de orquestador, jobs de worker, todo el tráfico "normal" | No | No |
| `soctalk_mssp` | Rol elevado entre tenants | Principal `System` solo mediante `system_context()` | No | **Sí** |

Justificación de tres roles, no dos: `soctalk_admin` no puede ejecutarse en tiempo de aplicación (demasiado privilegio) ni omitir RLS de forma no intencionada. `soctalk_app` está sujeto a RLS, de modo que los errores de la aplicación no puedan filtrar datos entre tenants. `soctalk_mssp` es intencionalmente entre tenants, pero está segregado únicamente a rutas de código auditadas.

## DDL de los roles

Creado en la migración inicial:

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

Las migraciones que introducen una tabla mutable para el rol de aplicación otorgan los privilegios adicionales de forma explícita, por ejemplo:

```sql
GRANT UPDATE, DELETE ON cases, proposals, notes TO soctalk_app;
```

Las tablas de solo anexado (append-only) nunca aparecen en tales grants. Las pruebas de la §9 verifican que `soctalk_app` no puede hacer UPDATE ni DELETE sobre `audit_log` ni `execution_log`, incluso con un contexto de tenant establecido.

Credenciales almacenadas en Secrets de K8s bajo `soctalk-system`:

- `soctalk-postgres-admin-creds`: montado únicamente en el Job de Alembic
- `soctalk-postgres-app-creds`: montado en los pods de API + orquestador de SocTalk
- `soctalk-postgres-mssp-creds`: montado únicamente en el pod de API de SocTalk (leído por la factory `system_context()`)

## Por qué `FORCE ROW LEVEL SECURITY`

Comportamiento por defecto de Postgres: los propietarios de tablas y los superusuarios omiten RLS automáticamente. Sin `FORCE ROW LEVEL SECURITY`, `soctalk_admin` (el propietario) no estaría sujeto a las políticas, pero `soctalk_admin` ejecuta las migraciones, y una migración que lea datos delimitados por tenant para transformarlos podría cruzar tenants accidentalmente.

Aplicar `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` hace que incluso el propietario quede sujeto a RLS. Las migraciones que necesitan intencionalmente acceso entre tenants deben:

1. Otorgarse temporalmente `BYPASSRLS` (privilegiado, auditado), o
2. Establecer `app.current_tenant_id` de forma explícita antes de cada acceso (preferido para transformaciones de datos por tenant).

## Variables de sesión

SocTalk establece `app.current_tenant_id` (un GUC personalizado) por transacción. Las políticas lo referencian mediante `current_setting('app.current_tenant_id', true)`. El segundo argumento `true` devuelve NULL si no está establecido (en lugar de arrojar un error), lo que mantiene limpias las pruebas de aislamiento.

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

`set_config(..., true)` tiene alcance de transacción; no hay contaminación de la conexión entre solicitudes.

## Plantilla de política

Para cada tabla delimitada por tenant, la migración aplica:

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

Tablas delimitadas por tenant (política aplicada a cada una):

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
- `users` (política condicional a continuación)

### Política de la tabla `users`

La tabla users contiene tanto usuarios del lado MSSP (`tenant_id IS NULL`) como usuarios del lado del tenant (`tenant_id` establecido). La política para `soctalk_app` es de **delimitación estricta por tenant**: las filas con `tenant_id IS NULL` no son visibles.

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

El acceso a los usuarios del lado MSSP (CRUD sobre las filas donde `tenant_id IS NULL`) se alcanza únicamente bajo el rol `soctalk_mssp`, que tiene `BYPASSRLS` y al que se ingresa exclusivamente a través del gestor de contexto `System` en los handlers de la MSSP-API. Una sesión `soctalk_app` delimitada por tenant, incluso una que ejecute una consulta de users con filtrado laxo, no puede ver ni modificar filas de usuarios MSSP bajo esta política.

Por qué esto importa: un borrador anterior de la política admitía `tenant_id IS NULL` en `USING`/`WITH CHECK` "para que los joins de MSSP funcionaran". Eso era inseguro; `soctalk_mssp` no necesita RLS para ver filas de MSSP (las omite), y otorgar la misma ventana a `soctalk_app` abre una vía para que los endpoints de tenant filtren datos de usuarios MSSP mediante una consulta insuficientemente filtrada.

## Tablas delimitadas por instalación (sin RLS)

Estas no tienen `tenant_id` ni RLS:

- `organizations`
- `releases`
- `install_settings`
- (opcional) `feature_flags`

`GRANT SELECT` para `soctalk_app`; `INSERT/UPDATE/DELETE` limitado a `soctalk_mssp` en la mayoría (los administradores de MSSP modifican vía API bajo el contexto `System`).

## Delimitación de la clave de idempotencia

La clave de idempotencia del almacén de eventos es compuesta:

```sql
ALTER TABLE events DROP CONSTRAINT events_idempotency_key_unique;
ALTER TABLE events ADD CONSTRAINT events_tenant_idempotency_unique
  UNIQUE (tenant_id, idempotency_key);
```

Razón: sin esto, una colisión de ID de alerta externa entre dos tenants provocaría un rechazo/duplicado de evento entre tenants. Con la clave compuesta, cada tenant tiene su propio espacio de nombres de idempotencia.

## Pruebas de aislamiento

### Prueba 1, Sondeo de endpoint de aplicación

Para cada endpoint en `/api/tenant/*` y `/api/mssp/*`:

```python
async def test_no_cross_tenant_access(client, seed_two_tenants):
    tenant_a, tenant_b = seed_two_tenants
    resp = await client.get("/api/tenant/investigations",
                            headers={"Authorization": f"Bearer {tenant_a.token}"})
    data = resp.json()
    assert all(item["tenant_id"] == str(tenant_a.id) for item in data["items"])
    assert not any(item["tenant_id"] == str(tenant_b.id) for item in data["items"])
```

### Prueba 2, SQL directo bajo `soctalk_app`

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

### Prueba 3, Contexto por defecto del worker

```python
async def test_worker_without_context_sees_nothing():
    @tenant_scoped_worker
    async def hostile_worker(state):
        result = await db.execute(select(Event))
        return result.all()
    with pytest.raises(MissingTenantContext):
        await hostile_worker({})
```

### Prueba 4, FORCE RLS atrapa al propietario

```python
async def test_admin_role_is_rls_subject():
    async with admin_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0  # admin is NOT bypassing
```

### Prueba 5, El rol MSSP puede omitir intencionalmente

```python
async def test_mssp_role_bypasses_for_rollup():
    async with mssp_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == total_events_across_tenants
```

### Prueba 6, Aislamiento del stream SSE

```python
async def test_sse_no_cross_tenant_delivery(ws_client):
    sub_a = await ws_client.subscribe("/api/tenant/events/stream",
                                      token=tenant_a.token)
    await inject_event(tenant_b, "test.event")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sub_a.receive(), timeout=2.0)
```

### Prueba 7, Aislamiento de idempotencia

```python
async def test_idempotency_key_per_tenant():
    await insert_event(tenant_a, idempotency_key="ext-123")
    await insert_event(tenant_b, idempotency_key="ext-123")
    with pytest.raises(IntegrityError):
        await insert_event(tenant_a, idempotency_key="ext-123")
```

Las siete pruebas deben pasar en CI. Ninguna es opcional.

## Notas operativas

- **Pools de conexiones.** Un pool separado por rol. La API de SocTalk tiene dos pools (`soctalk_app` y `soctalk_mssp`); los pods de worker tienen uno (`soctalk_app`). El Job de Alembic usa una conexión desechable como `soctalk_admin`.
- **Registro (logging).** Cada conexión registra su rol en `pg_stat_activity.usename`. Los operadores pueden auditar qué rol está ejecutando qué consulta.
- **Acceso de superusuario.** El superusuario de Postgres existe pero se usa únicamente para depuración de emergencia (break-glass), no por ningún código de aplicación. Las credenciales se almacenan por separado y se rotan después de su uso.
