# Postgres RLS

O modelo de três papéis do Postgres, os templates de política RLS, a disciplina `FORCE ROW LEVEL SECURITY` e os testes de isolamento que o SocTalk executa em CI.

> **Nota de implantação V1.** O texto abaixo refere-se a "pods de API" e "pods de orquestrador" como cargas de trabalho separadas — o modelo de papéis e as regras de acesso permanecem corretos. No chart V1 eles estão **co-localizados em um único Deployment `soctalk-system-api`**, portanto toda referência a "pod de orquestrador" mapeia para esse mesmo conjunto de pods nesta versão.

## Papéis

Três papéis do Postgres. Nenhuma aplicação jamais se conecta como o superusuário `postgres`.

| Papel | Finalidade | Usado por | DDL? | BYPASSRLS? |
|---|---|---|---|---|
| `soctalk_admin` | Proprietário das tabelas; usado apenas pelo Alembic no momento da migração | Alembic (executado via um Kubernetes Job dedicado no deploy) | Sim | Não |
| `soctalk_app` | Papel de aplicação em runtime | Pods de API do SocTalk, pods de orquestrador, jobs de worker — todo o tráfego "normal" | Não | Não |
| `soctalk_mssp` | Papel elevado entre tenants | Principal `System` via `system_context()` apenas | Não | **Sim** |

Justificativa para três papéis, e não dois: `soctalk_admin` não pode executar em tempo de aplicação (privilégio excessivo) nem contornar o RLS de forma não intencional. `soctalk_app` está sujeito ao RLS, de modo que bugs da aplicação não podem vazar entre tenants. `soctalk_mssp` é intencionalmente entre tenants, mas segregado exclusivamente a caminhos de código auditados.

## DDL dos papéis

Criados na migração inicial:

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

Migrações que introduzem uma tabela mutável para o papel da aplicação concedem os privilégios adicionais explicitamente, por exemplo:

```sql
GRANT UPDATE, DELETE ON cases, proposals, notes TO soctalk_app;
```

Tabelas append-only nunca aparecem em tais concessões. Os testes em §9 asseguram que `soctalk_app` não pode executar UPDATE ou DELETE em `audit_log` ou `execution_log`, mesmo com um contexto de tenant definido.

Credenciais armazenadas em K8s Secrets sob `soctalk-system`:

- `soctalk-postgres-admin-creds` — montado apenas no Alembic Job
- `soctalk-postgres-app-creds` — montado nos pods de API + orquestrador do SocTalk
- `soctalk-postgres-mssp-creds` — montado apenas no pod de API do SocTalk (lido pela factory `system_context()`)

## Por que `FORCE ROW LEVEL SECURITY`

Comportamento padrão do Postgres: proprietários de tabelas e superusuários contornam o RLS automaticamente. Sem `FORCE ROW LEVEL SECURITY`, `soctalk_admin` (o proprietário) não estaria sujeito às políticas, mas `soctalk_admin` executa migrações, e uma migração que lê dados com escopo de tenant para transformá-los poderia acidentalmente cruzar tenants.

Aplicar `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` torna até mesmo o proprietário sujeito ao RLS. Migrações que intencionalmente precisam de acesso entre tenants devem:

1. Conceder temporariamente a si mesmas `BYPASSRLS` (privilegiado, auditado), ou
2. Definir `app.current_tenant_id` explicitamente antes de cada acesso (preferível para transformações de dados por tenant).

## Variáveis de sessão

O SocTalk define `app.current_tenant_id` (um GUC customizado) por transação. As políticas o referenciam via `current_setting('app.current_tenant_id', true)`. O segundo argumento `true` retorna NULL se não estiver definido (em vez de gerar erro), o que mantém os testes de isolamento limpos.

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

`set_config(..., true)` tem escopo de transação; não há poluição de conexão entre requisições.

## Template de política

Para cada tabela com escopo de tenant, a migração aplica:

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

Tabelas com escopo de tenant (política aplicada a cada uma):

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
- `users` (política condicional abaixo)

### Política da tabela `users`

A tabela users contém tanto usuários do lado MSSP (`tenant_id IS NULL`) quanto usuários do lado do tenant (`tenant_id` definido). A política para `soctalk_app` é **escopo estrito de tenant**: linhas com `tenant_id IS NULL` não são visíveis.

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

O acesso a usuários do lado MSSP (CRUD em linhas onde `tenant_id IS NULL`) é alcançado somente sob o papel `soctalk_mssp`, que possui `BYPASSRLS` e é acessado exclusivamente através do gerenciador de contexto `System` nos handlers da MSSP-API. Uma sessão `soctalk_app` com escopo de tenant — mesmo uma executando uma consulta de users com filtro frouxo — não pode ver nem modificar linhas de usuários MSSP sob esta política.

Por que isso importa: um rascunho anterior da política admitia `tenant_id IS NULL` em `USING`/`WITH CHECK` "para que os joins de MSSP funcionassem". Isso era inseguro; `soctalk_mssp` não precisa de RLS para ver linhas de MSSP (ele contorna o RLS), e conceder a mesma janela a `soctalk_app` abre um caminho para que endpoints de tenant vazem dados de usuários MSSP por meio de uma consulta com filtro insuficiente.

## Tabelas com escopo de instalação (sem RLS)

Estas não têm `tenant_id` nem RLS:

- `organizations`
- `releases`
- `install_settings`
- (opcional) `feature_flags`

`GRANT SELECT` para `soctalk_app`; `INSERT/UPDATE/DELETE` limitado a `soctalk_mssp` na maioria dos casos (administradores MSSP modificam via API sob o contexto `System`).

## Escopo da chave de idempotência

A chave de idempotência do event store é composta:

```sql
ALTER TABLE events DROP CONSTRAINT events_idempotency_key_unique;
ALTER TABLE events ADD CONSTRAINT events_tenant_idempotency_unique
  UNIQUE (tenant_id, idempotency_key);
```

Razão: sem isso, uma colisão de ID de alerta externo entre dois tenants causaria uma rejeição/duplicação de evento entre tenants. Com a chave composta, cada tenant tem seu próprio namespace de idempotência.

## Testes de isolamento

### Teste 1 — Sondagem de endpoint da aplicação

Para cada endpoint em `/api/tenant/*` e `/api/mssp/*`:

```python
async def test_no_cross_tenant_access(client, seed_two_tenants):
    tenant_a, tenant_b = seed_two_tenants
    resp = await client.get("/api/tenant/investigations",
                            headers={"Authorization": f"Bearer {tenant_a.token}"})
    data = resp.json()
    assert all(item["tenant_id"] == str(tenant_a.id) for item in data["items"])
    assert not any(item["tenant_id"] == str(tenant_b.id) for item in data["items"])
```

### Teste 2 — SQL bruto sob `soctalk_app`

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

### Teste 3 — Contexto padrão do worker

```python
async def test_worker_without_context_sees_nothing():
    @tenant_scoped_worker
    async def hostile_worker(state):
        result = await db.execute(select(Event))
        return result.all()
    with pytest.raises(MissingTenantContext):
        await hostile_worker({})
```

### Teste 4 — FORCE RLS captura o proprietário

```python
async def test_admin_role_is_rls_subject():
    async with admin_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0  # admin is NOT bypassing
```

### Teste 5 — Papel MSSP pode contornar intencionalmente

```python
async def test_mssp_role_bypasses_for_rollup():
    async with mssp_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == total_events_across_tenants
```

### Teste 6 — Isolamento de stream SSE

```python
async def test_sse_no_cross_tenant_delivery(ws_client):
    sub_a = await ws_client.subscribe("/api/tenant/events/stream",
                                      token=tenant_a.token)
    await inject_event(tenant_b, "test.event")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sub_a.receive(), timeout=2.0)
```

### Teste 7 — Isolamento de idempotência

```python
async def test_idempotency_key_per_tenant():
    await insert_event(tenant_a, idempotency_key="ext-123")
    await insert_event(tenant_b, idempotency_key="ext-123")
    with pytest.raises(IntegrityError):
        await insert_event(tenant_a, idempotency_key="ext-123")
```

Todos os sete testes precisam passar em CI. Nenhum é opcional.

## Notas operacionais

- **Pools de conexão.** Um pool separado por papel. A API do SocTalk tem dois pools (`soctalk_app` e `soctalk_mssp`); os pods de worker têm um (`soctalk_app`). O Alembic Job usa uma conexão descartável como `soctalk_admin`.
- **Logging.** Cada conexão registra seu papel em `pg_stat_activity.usename`. Os operadores podem auditar qual papel está executando qual consulta.
- **Acesso de superusuário.** O superusuário do Postgres existe, mas é usado apenas para depuração de emergência (break-glass), não por qualquer código de aplicação. As credenciais são armazenadas separadamente e rotacionadas após o uso.
