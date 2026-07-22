# RLS Postgres

Le modèle Postgres à trois rôles, les modèles de politiques RLS, la discipline `FORCE ROW LEVEL SECURITY` et les tests d'isolation que SocTalk exécute en CI.

> **Note de déploiement V1.** Le texte ci-dessous fait référence aux « pods API » et aux « pods orchestrateur » en tant que charges de travail distinctes, le modèle de rôles et les règles d'accès restent corrects. Dans le chart V1, ils sont **co-localisés dans un unique Deployment `soctalk-system-api`**, de sorte que chaque référence à un « pod orchestrateur » correspond à cet unique jeu de pods dans cette version.

## Rôles

Trois rôles Postgres. Aucune application ne se connecte jamais en tant que superutilisateur `postgres`.

| Rôle | Objectif | Utilisé par | DDL ? | BYPASSRLS ? |
|---|---|---|---|---|
| `soctalk_admin` | Propriétaire des tables ; utilisé uniquement par Alembic au moment des migrations | Alembic (exécuté via un Job Kubernetes dédié au déploiement) | Oui | Non |
| `soctalk_app` | Rôle applicatif d'exécution | Pods API SocTalk, pods orchestrateur, jobs worker, tout le trafic « normal » | Non | Non |
| `soctalk_mssp` | Rôle élevé inter-tenant | Principal `System` via `system_context()` uniquement | Non | **Oui** |

Justification de trois rôles plutôt que deux : `soctalk_admin` ne peut ni s'exécuter au moment de l'application (trop de privilèges) ni contourner involontairement la RLS. `soctalk_app` est soumis à la RLS afin que les bugs applicatifs ne puissent pas fuiter entre tenants. `soctalk_mssp` est intentionnellement inter-tenant mais cantonné à des chemins de code audités uniquement.

## DDL des rôles

Créés dans la migration initiale :

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

Les migrations qui introduisent une table mutable pour le rôle applicatif accordent explicitement les privilèges supplémentaires, par exemple :

```sql
GRANT UPDATE, DELETE ON cases, proposals, notes TO soctalk_app;
```

Les tables en ajout seul (append-only) n'apparaissent jamais dans de tels grants. Les tests du §9 vérifient que `soctalk_app` ne peut ni UPDATE ni DELETE `audit_log` ou `execution_log`, même avec un contexte tenant défini.

Identifiants stockés dans des Secrets K8s sous `soctalk-system` :

- `soctalk-postgres-admin-creds`: monté uniquement sur le Job Alembic
- `soctalk-postgres-app-creds`: monté sur les pods API SocTalk + orchestrateur
- `soctalk-postgres-mssp-creds`: monté uniquement sur le pod API SocTalk (lu par la fabrique `system_context()`)

## Pourquoi `FORCE ROW LEVEL SECURITY`

Comportement Postgres par défaut : les propriétaires de tables et les superutilisateurs contournent automatiquement la RLS. Sans `FORCE ROW LEVEL SECURITY`, `soctalk_admin` (le propriétaire) ne serait pas soumis aux politiques, or `soctalk_admin` exécute les migrations, et une migration qui lit des données à portée tenant pour les transformer pourrait accidentellement franchir la frontière entre tenants.

Appliquer `ALTER TABLE <t> FORCE ROW LEVEL SECURITY` rend même le propriétaire soumis à la RLS. Les migrations qui ont intentionnellement besoin d'un accès inter-tenant doivent soit :

1. S'octroyer temporairement `BYPASSRLS` (privilégié, audité), soit
2. Définir explicitement `app.current_tenant_id` avant chaque accès (préféré pour les transformations de données par tenant).

## Variables de session

SocTalk définit `app.current_tenant_id` (un GUC personnalisé) par transaction. Les politiques y font référence via `current_setting('app.current_tenant_id', true)`. Le second argument `true` renvoie NULL si la variable n'est pas définie (plutôt que de générer une erreur), ce qui garde les tests d'isolation propres.

Middleware :

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

`set_config(..., true)` est à portée de transaction ; il n'y a aucune pollution de connexion entre les requêtes.

## Modèle de politique

Pour chaque table à portée tenant, la migration applique :

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

Tables à portée tenant (politique appliquée à chacune) :

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
- `users` (politique conditionnelle ci-dessous)

### Politique de la table `users`

La table users contient à la fois les utilisateurs côté MSSP (`tenant_id IS NULL`) et les utilisateurs côté tenant (`tenant_id` défini). La politique pour `soctalk_app` est une **portée tenant stricte** : les lignes où `tenant_id IS NULL` ne sont pas visibles.

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

L'accès aux utilisateurs côté MSSP (CRUD sur les lignes où `tenant_id IS NULL`) n'est atteint que sous le rôle `soctalk_mssp`, qui possède `BYPASSRLS` et n'est emprunté qu'exclusivement via le gestionnaire de contexte `System` dans les handlers de la MSSP-API. Une session `soctalk_app` à portée tenant, même une exécutant une requête users faiblement filtrée, ne peut ni voir ni modifier les lignes d'utilisateurs MSSP sous cette politique.

Pourquoi c'est important : une version antérieure de la politique admettait `tenant_id IS NULL` dans `USING`/`WITH CHECK` « pour que les jointures MSSP fonctionnent ». C'était dangereux ; `soctalk_mssp` n'a pas besoin de la RLS pour voir les lignes MSSP (il contourne la RLS), et accorder la même fenêtre à `soctalk_app` ouvre une voie pour que les endpoints tenant fuitent des données d'utilisateurs MSSP via une requête insuffisamment filtrée.

## Tables à portée d'installation (sans RLS)

Celles-ci n'ont ni `tenant_id` ni RLS :

- `organizations`
- `releases`
- `install_settings`
- (optionnel) `feature_flags`

`GRANT SELECT` pour `soctalk_app` ; `INSERT/UPDATE/DELETE` limité à `soctalk_mssp` pour la plupart (les administrateurs MSSP modifient via l'API sous le contexte `System`).

## Portée des clés d'idempotence

La clé d'idempotence du magasin d'événements est composite :

```sql
ALTER TABLE events DROP CONSTRAINT events_idempotency_key_unique;
ALTER TABLE events ADD CONSTRAINT events_tenant_idempotency_unique
  UNIQUE (tenant_id, idempotency_key);
```

Raison : en son absence, une collision d'ID d'alerte externe entre deux tenants provoquerait un rejet/doublon d'événement inter-tenant. Avec la clé composite, chaque tenant dispose de son propre espace de noms d'idempotence.

## Tests d'isolation

### Test 1, Sonde d'endpoint applicatif

Pour chaque endpoint de `/api/tenant/*` et `/api/mssp/*` :

```python
async def test_no_cross_tenant_access(client, seed_two_tenants):
    tenant_a, tenant_b = seed_two_tenants
    resp = await client.get("/api/tenant/investigations",
                            headers={"Authorization": f"Bearer {tenant_a.token}"})
    data = resp.json()
    assert all(item["tenant_id"] == str(tenant_a.id) for item in data["items"])
    assert not any(item["tenant_id"] == str(tenant_b.id) for item in data["items"])
```

### Test 2, SQL brut sous `soctalk_app`

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

### Test 3, Contexte worker par défaut

```python
async def test_worker_without_context_sees_nothing():
    @tenant_scoped_worker
    async def hostile_worker(state):
        result = await db.execute(select(Event))
        return result.all()
    with pytest.raises(MissingTenantContext):
        await hostile_worker({})
```

### Test 4, FORCE RLS attrape le propriétaire

```python
async def test_admin_role_is_rls_subject():
    async with admin_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == 0  # admin is NOT bypassing
```

### Test 5, Le rôle MSSP peut contourner intentionnellement

```python
async def test_mssp_role_bypasses_for_rollup():
    async with mssp_connection() as conn:
        result = await conn.execute(text("SELECT count(*) FROM events"))
        assert result.scalar() == total_events_across_tenants
```

### Test 6, Isolation du flux SSE

```python
async def test_sse_no_cross_tenant_delivery(ws_client):
    sub_a = await ws_client.subscribe("/api/tenant/events/stream",
                                      token=tenant_a.token)
    await inject_event(tenant_b, "test.event")
    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(sub_a.receive(), timeout=2.0)
```

### Test 7, Isolation de l'idempotence

```python
async def test_idempotency_key_per_tenant():
    await insert_event(tenant_a, idempotency_key="ext-123")
    await insert_event(tenant_b, idempotency_key="ext-123")
    with pytest.raises(IntegrityError):
        await insert_event(tenant_a, idempotency_key="ext-123")
```

Les sept tests doivent obligatoirement réussir en CI. Aucun n'est optionnel.

## Notes opérationnelles

- **Pools de connexions.** Un pool distinct par rôle. L'API SocTalk possède deux pools (`soctalk_app` et `soctalk_mssp`) ; les pods worker en ont un seul (`soctalk_app`). Le Job Alembic utilise une connexion jetable en tant que `soctalk_admin`.
- **Journalisation.** Chaque connexion journalise son rôle dans `pg_stat_activity.usename`. Les opérateurs peuvent auditer quel rôle exécute quelle requête.
- **Accès superutilisateur.** Le superutilisateur Postgres existe mais n'est utilisé que pour le débogage en bris de glace, jamais par du code applicatif. Les identifiants sont stockés séparément et rotés après usage.
