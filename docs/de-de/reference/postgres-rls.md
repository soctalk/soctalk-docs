# Postgres RLS

Das Drei-Rollen-Modell von Postgres, RLS-Policy-Vorlagen, die Disziplin `FORCE ROW LEVEL SECURITY` und die Isolationstests, die SocTalk in CI ausführt.

> **Hinweis zum V1-Deployment.** Der folgende Text bezieht sich auf „API-Pods“ und „Orchestrator-Pods“ als separate Workloads — das Rollenmodell und die Zugriffsregeln bleiben korrekt. Im V1-Chart sind sie **in einem einzigen `soctalk-system-api`-Deployment zusammengelegt**, sodass in diesem Release jede Erwähnung eines „Orchestrator-Pods“ auf diese eine Pod-Gruppe abbildet.

## Rollen

Drei Postgres-Rollen. Keine Anwendung verbindet sich jemals als Superuser `postgres`.

| Rolle | Zweck | Verwendet von | DDL? | BYPASSRLS? |
|---|---|---|---|---|
| `soctalk_admin` | Tabelleneigentümer; ausschließlich von Alembic zur Migrationszeit verwendet | Alembic (ausgeführt über einen dedizierten Kubernetes-Job beim Deploy) | Ja | Nein |
| `soctalk_app` | Laufzeit-Anwendungsrolle | SocTalk API-Pods, Orchestrator-Pods, Worker-Jobs — der gesamte „normale“ Verkehr | Nein | Nein |
| `soctalk_mssp` | Mandantenübergreifende, erhöhte Rolle | `System`-Principal ausschließlich über `system_context()` | Nein | **Ja** |

Begründung für drei statt zwei Rollen: `soctalk_admin` kann weder zur App-Laufzeit ausgeführt werden (zu viele Privilegien) noch unbeabsichtigt RLS umgehen. `soctalk_app` unterliegt RLS, sodass Anwendungsfehler nicht mandantenübergreifend leaken können. `soctalk_mssp` ist absichtlich mandantenübergreifend, aber ausschließlich auf auditierte Codepfade beschränkt.

## Rollen-DDL

In der initialen Migration angelegt:

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

Migrationen, die eine veränderbare Tabelle für die App-Rolle einführen, gewähren die zusätzlichen Privilegien explizit, zum Beispiel:

```sql
GRANT UPDATE, DELETE ON cases, proposals, notes TO soctalk_app;
```

Append-only-Tabellen tauchen in solchen Grants niemals auf. Die Tests in §9 stellen sicher, dass `soctalk_app` `audit_log` oder `execution_log` selbst mit gesetztem Mandantenkontext nicht per UPDATE oder DELETE verändern kann.

In K8s-Secrets unter `soctalk-system` gespeicherte Anmeldedaten:

- `soctalk-postgres-admin-creds` — ausschließlich in den Alembic-Job eingehängt
- `soctalk-postgres-app-creds` — in SocTalk API- + Orchestrator-Pods eingehängt
- `soctalk-postgres-mssp-creds` — ausschließlich in den SocTalk API-Pod eingehängt (gelesen von der `system_context()`-Factory)

## Warum `FORCE ROW LEVEL SECURITY`

Standardverhalten von Postgres: Tabelleneigentümer und Superuser umgehen RLS automatisch. Ohne `FORCE ROW LEVEL SECURITY` würde `soctalk_admin` (der Eigentümer) nicht den Policies unterliegen, aber `soctalk_admin` führt Migrationen aus, und eine Migration, die mandantenbezogene Daten liest, um sie zu transformieren, könnte versehentlich Mandantengrenzen überschreiten.

Das Anwenden von `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` macht selbst den Eigentümer RLS-unterworfen. Migrationen, die absichtlich mandantenübergreifenden Zugriff benötigen, müssen entweder:

1. sich vorübergehend selbst `BYPASSRLS` gewähren (privilegiert, auditiert), oder
2. `app.current_tenant_id` vor jedem Zugriff explizit setzen (bevorzugt für mandantenweise Datentransformationen).

## Sitzungsvariablen

SocTalk setzt `app.current_tenant_id` (ein benutzerdefiniertes GUC) pro Transaktion. Policies referenzieren es über `current_setting('app.current_tenant_id', true)`. Das zweite Argument `true` gibt NULL zurück, wenn nicht gesetzt (statt einen Fehler zu werfen), was die Isolationstests sauber hält.

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

`set_config(..., true)` ist transaktionsbezogen; es gibt keine Verbindungsverunreinigung über Requests hinweg.

## Policy-Vorlage

Für jede mandantenbezogene Tabelle wendet die Migration Folgendes an:

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

Mandantenbezogene Tabellen (Policy auf jede angewendet):

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
- `users` (bedingte Policy unten)

### Policy der `users`-Tabelle

Die users-Tabelle enthält sowohl MSSP-seitige Benutzer (`tenant_id IS NULL`) als auch mandantenseitige Benutzer (`tenant_id` gesetzt). Die Policy für `soctalk_app` ist **strikte Mandantenbindung**: Zeilen mit `tenant_id IS NULL` sind nicht sichtbar.

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

Der Zugriff auf MSSP-seitige Benutzer (CRUD auf Zeilen mit `tenant_id IS NULL`) ist ausschließlich unter der Rolle `soctalk_mssp` erreichbar, die `BYPASSRLS` besitzt und ausschließlich über den `System`-Kontextmanager in MSSP-API-Handlern betreten wird. Eine mandantengebundene `soctalk_app`-Sitzung — selbst eine, die eine lose gefilterte users-Query ausführt — kann MSSP-Benutzerzeilen unter dieser Policy weder sehen noch verändern.

Warum das wichtig ist: Ein früherer Entwurf der Policy ließ `tenant_id IS NULL` in `USING`/`WITH CHECK` zu, „damit MSSP-Joins funktionieren“. Das war unsicher; `soctalk_mssp` benötigt kein RLS, um MSSP-Zeilen zu sehen (es umgeht RLS), und dasselbe Fenster auch `soctalk_app` zu gewähren, öffnet einen Pfad, über den Mandanten-Endpunkte MSSP-Benutzerdaten via einer unzureichend gefilterten Query leaken könnten.

## Installationsbezogene Tabellen (kein RLS)

Diese haben keine `tenant_id` und kein RLS:

- `organizations`
- `releases`
- `install_settings`
- (optional) `feature_flags`

`GRANT SELECT` an `soctalk_app`; `INSERT/UPDATE/DELETE` für die meisten auf `soctalk_mssp` beschränkt (MSSP-Admins ändern via API unter `System`-Kontext).

## Scoping des Idempotenzschlüssels

Der Idempotenzschlüssel des Event Stores ist zusammengesetzt:

```sql
ALTER TABLE events DROP CONSTRAINT events_idempotency_key_unique;
ALTER TABLE events ADD CONSTRAINT events_tenant_idempotency_unique
  UNIQUE (tenant_id, idempotency_key);
```

Grund: Ohne dies würde eine Kollision externer Alert-IDs zwischen zwei Mandanten ein mandantenübergreifendes Event-Reject/-Duplikat verursachen. Mit dem zusammengesetzten Schlüssel besitzt jeder Mandant seinen eigenen Idempotenz-Namensraum.

## Isolationstests

### Test 1 — Sondierung des Anwendungs-Endpunkts

Für jeden Endpunkt in `/api/tenant/*` und `/api/mssp/*`:

```python
async def test_no_cross_tenant_access(client, seed_two_tenants):
    tenant_a, tenant_b = seed_two_tenants
    resp = await client.get("/api/tenant/investigations",
                            headers={"Authorization": f"Bearer {tenant_a.token}"})
    data = resp.json()
    assert all(item["tenant_id"] == str(tenant_a.id) for item in data["items"])
    assert not any(item["tenant_id"] == str(tenant_b.id) for item in data["items"])
```

### Test 2 — Rohes SQL unter `soctalk_app`

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

### Test 3 — Standard-Worker-Kontext

```python
async def test_worker_without_context_sees_nothing():
    @tenant_scoped_worker
    async def hostile_worker(state):
        result = await db.execute(select(Event))
        return result.all()
    with pytest.raises(MissingTenantContext):
        await hostile_worker({})
```

### Test 4 — FORCE RLS erfasst den Eigentümer

```python
async def test_admin_role_is_rls_subject():
    async with admin_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0  # admin is NOT bypassing
```

### Test 5 — MSSP-Rolle kann absichtlich umgehen

```python
async def test_mssp_role_bypasses_for_rollup():
    async with mssp_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == total_events_across_tenants
```

### Test 6 — Isolation des SSE-Streams

```python
async def test_sse_no_cross_tenant_delivery(ws_client):
    sub_a = await ws_client.subscribe("/api/tenant/events/stream",
                                      token=tenant_a.token)
    await inject_event(tenant_b, "test.event")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sub_a.receive(), timeout=2.0)
```

### Test 7 — Isolation der Idempotenz

```python
async def test_idempotency_key_per_tenant():
    await insert_event(tenant_a, idempotency_key="ext-123")
    await insert_event(tenant_b, idempotency_key="ext-123")
    with pytest.raises(IntegrityError):
        await insert_event(tenant_a, idempotency_key="ext-123")
```

Alle sieben Tests müssen in CI bestehen. Keiner ist optional.

## Betriebshinweise

- **Verbindungspools.** Separater Pool pro Rolle. Die SocTalk API hat zwei Pools (`soctalk_app` und `soctalk_mssp`); Worker-Pods haben einen (`soctalk_app`). Der Alembic-Job verwendet eine Wegwerf-Verbindung als `soctalk_admin`.
- **Logging.** Jede Verbindung protokolliert ihre Rolle in `pg_stat_activity.usename`. Betreiber können auditieren, welche Rolle welche Query ausführt.
- **Superuser-Zugriff.** Der Postgres-Superuser existiert, wird aber nur für Break-Glass-Debugging verwendet, nicht durch Anwendungscode. Anmeldedaten werden separat gespeichert und nach Verwendung rotiert.
