# Postgres RLS

Il modello Postgres a tre ruoli, i template delle policy RLS, la disciplina `FORCE ROW LEVEL SECURITY` e i test di isolamento che SocTalk esegue in CI.

> **Nota sul deployment V1.** Il testo che segue fa riferimento a "pod API" e "pod orchestrator" come workload separati, il modello dei ruoli e le regole di accesso restano corretti. Nel chart V1 sono **co-locati in un unico Deployment `soctalk-system-api`**, quindi in questa release ogni riferimento a "pod orchestrator" corrisponde a quell'unico set di pod.

## Ruoli

Tre ruoli Postgres. Nessuna applicazione si connette mai come superuser `postgres`.

| Ruolo | Scopo | Usato da | DDL? | BYPASSRLS? |
|---|---|---|---|---|
| `soctalk_admin` | Proprietario delle tabelle; usato solo da Alembic al momento della migrazione | Alembic (eseguito tramite un Kubernetes Job dedicato al deploy) | Sì | No |
| `soctalk_app` | Ruolo applicativo a runtime | Pod API SocTalk, pod orchestrator, worker job, tutto il traffico "normale" | No | No |
| `soctalk_mssp` | Ruolo elevato cross-tenant | Principal `System` esclusivamente tramite `system_context()` | No | **Sì** |

Motivazione per tre ruoli e non due: `soctalk_admin` non può né essere eseguito al tempo dell'applicazione (troppi privilegi) né bypassare RLS involontariamente. `soctalk_app` è soggetto a RLS, quindi i bug applicativi non possono causare fughe cross-tenant. `soctalk_mssp` è intenzionalmente cross-tenant ma segregato ai soli percorsi di codice sottoposti ad audit.

## DDL dei ruoli

Creati nella migrazione iniziale:

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

Le migrazioni che introducono una tabella mutabile per il ruolo applicativo concedono esplicitamente i privilegi aggiuntivi, per esempio:

```sql
GRANT UPDATE, DELETE ON cases, proposals, notes TO soctalk_app;
```

Le tabelle append-only non compaiono mai in tali grant. I test nel §9 verificano che `soctalk_app` non possa eseguire UPDATE o DELETE su `audit_log` o `execution_log` nemmeno con un contesto tenant impostato.

Credenziali memorizzate nei K8s Secret sotto `soctalk-system`:

- `soctalk-postgres-admin-creds`: montato solo sul Job Alembic
- `soctalk-postgres-app-creds`: montato sui pod API SocTalk + orchestrator
- `soctalk-postgres-mssp-creds`: montato solo sul pod API SocTalk (letto dalla factory `system_context()`)

## Perché `FORCE ROW LEVEL SECURITY`

Comportamento predefinito di Postgres: i proprietari delle tabelle e i superuser bypassano automaticamente RLS. Senza `FORCE ROW LEVEL SECURITY`, `soctalk_admin` (il proprietario) non sarebbe soggetto alle policy, ma `soctalk_admin` esegue le migrazioni, e una migrazione che legge dati con ambito tenant per trasformarli potrebbe attraversare accidentalmente i confini tra tenant.

Applicare `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` rende soggetto a RLS anche il proprietario. Le migrazioni che necessitano intenzionalmente di accesso cross-tenant devono:

1. Concedersi temporaneamente `BYPASSRLS` (privilegiato, sottoposto ad audit), oppure
2. Impostare `app.current_tenant_id` esplicitamente prima di ogni accesso (preferito per le trasformazioni di dati per singolo tenant).

## Variabili di sessione

SocTalk imposta `app.current_tenant_id` (una GUC personalizzata) per transazione. Le policy vi fanno riferimento tramite `current_setting('app.current_tenant_id', true)`. Il secondo argomento `true` restituisce NULL se non impostato (invece di generare un errore), il che mantiene puliti i test di isolamento.

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

`set_config(..., true)` ha ambito di transazione; non c'è inquinamento delle connessioni tra le richieste.

## Template della policy

Per ogni tabella con ambito tenant, la migrazione applica:

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

Tabelle con ambito tenant (policy applicata a ciascuna):

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
- `users` (policy condizionale sotto)

### Policy della tabella `users`

La tabella users contiene sia utenti lato MSSP (`tenant_id IS NULL`) sia utenti lato tenant (`tenant_id` impostato). La policy per `soctalk_app` è **ambito tenant rigoroso**: le righe con `tenant_id IS NULL` non sono visibili.

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

L'accesso agli utenti lato MSSP (CRUD sulle righe dove `tenant_id IS NULL`) è raggiungibile solo sotto il ruolo `soctalk_mssp`, che dispone di `BYPASSRLS` e vi si accede esclusivamente tramite il context manager `System` negli handler dell'MSSP-API. Una sessione `soctalk_app` con ambito tenant, anche una che esegue una query users con filtri laschi, non può vedere né modificare le righe utente MSSP sotto questa policy.

Perché è importante: una bozza precedente della policy ammetteva `tenant_id IS NULL` in `USING`/`WITH CHECK` "affinché le join MSSP funzionassero". Questo era pericoloso; `soctalk_mssp` non ha bisogno di RLS per vedere le righe MSSP (bypassa RLS), e concedere la stessa finestra a `soctalk_app` apre un percorso attraverso cui gli endpoint tenant possono far trapelare dati utente MSSP tramite una query con filtri insufficienti.

## Tabelle con ambito installazione (nessuna RLS)

Queste non hanno `tenant_id` né RLS:

- `organizations`
- `releases`
- `install_settings`
- (opzionale) `feature_flags`

`GRANT SELECT` a `soctalk_app`; `INSERT/UPDATE/DELETE` limitati a `soctalk_mssp` per la maggior parte (gli admin MSSP modificano tramite API sotto il contesto `System`).

## Ambito delle chiavi di idempotenza

La chiave di idempotenza dell'event store è composita:

```sql
ALTER TABLE events DROP CONSTRAINT events_idempotency_key_unique;
ALTER TABLE events ADD CONSTRAINT events_tenant_idempotency_unique
  UNIQUE (tenant_id, idempotency_key);
```

Motivo: in assenza di ciò, una collisione di ID alert esterni tra due tenant causerebbe un reject/duplicato di evento cross-tenant. Con la chiave composita, ogni tenant ha il proprio namespace di idempotenza.

## Test di isolamento

### Test 1, Sonda sugli endpoint applicativi

Per ogni endpoint in `/api/tenant/*` e `/api/mssp/*`:

```python
async def test_no_cross_tenant_access(client, seed_two_tenants):
    tenant_a, tenant_b = seed_two_tenants
    resp = await client.get("/api/tenant/investigations",
                            headers={"Authorization": f"Bearer {tenant_a.token}"})
    data = resp.json()
    assert all(item["tenant_id"] == str(tenant_a.id) for item in data["items"])
    assert not any(item["tenant_id"] == str(tenant_b.id) for item in data["items"])
```

### Test 2, SQL grezzo sotto `soctalk_app`

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

### Test 3, Contesto predefinito del worker

```python
async def test_worker_without_context_sees_nothing():
    @tenant_scoped_worker
    async def hostile_worker(state):
        result = await db.execute(select(Event))
        return result.all()
    with pytest.raises(MissingTenantContext):
        await hostile_worker({})
```

### Test 4, FORCE RLS intercetta il proprietario

```python
async def test_admin_role_is_rls_subject():
    async with admin_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0  # admin is NOT bypassing
```

### Test 5, Il ruolo MSSP può bypassare intenzionalmente

```python
async def test_mssp_role_bypasses_for_rollup():
    async with mssp_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == total_events_across_tenants
```

### Test 6, Isolamento dello stream SSE

```python
async def test_sse_no_cross_tenant_delivery(ws_client):
    sub_a = await ws_client.subscribe("/api/tenant/events/stream",
                                      token=tenant_a.token)
    await inject_event(tenant_b, "test.event")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sub_a.receive(), timeout=2.0)
```

### Test 7, Isolamento dell'idempotenza

```python
async def test_idempotency_key_per_tenant():
    await insert_event(tenant_a, idempotency_key="ext-123")
    await insert_event(tenant_b, idempotency_key="ext-123")
    with pytest.raises(IntegrityError):
        await insert_event(tenant_a, idempotency_key="ext-123")
```

Tutti e sette i test devono passare in CI. Nessuno è opzionale.

## Note operative

- **Pool di connessioni.** Pool separato per ruolo. L'API SocTalk ha due pool (`soctalk_app` e `soctalk_mssp`); i pod worker ne hanno uno (`soctalk_app`). Il Job Alembic usa una connessione usa e getta come `soctalk_admin`.
- **Logging.** Ogni connessione registra il proprio ruolo in `pg_stat_activity.usename`. Gli operatori possono verificare quale ruolo sta eseguendo quale query.
- **Accesso superuser.** Il superuser Postgres esiste ma è usato solo per il debug break-glass, non da alcun codice applicativo. Le credenziali sono memorizzate separatamente e ruotate dopo l'uso.
