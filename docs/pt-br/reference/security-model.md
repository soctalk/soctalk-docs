# Modelo de segurança

Catálogo de principais, matriz ator×recurso, matriz de políticas RLS, modelo de papéis do Postgres, classificação de endpoints, esquemas de claims de token, requisitos de auditoria, posicionamento de segredos.

> **Nota sobre a implantação V1.** Os exemplos de endpoints abaixo (por exemplo, `/api/mssp/impersonate/:tenant_id`, `/api/mssp/users` POST/list, `/api/mssp/fleet/summary`) e diversas entradas de principais (emissor de licença Cloud; o ator de impersonation) descrevem a **superfície de segurança-alvo**. Os endpoints MSSP montados incluem: CRUD de tenant, auditoria (`/api/audit`), gerenciamento de usuários de staff (`/api/mssp/users` create/list/patch/deactivate e `/{id}/password/reset`) e `/api/auth/assume-tenant` para escopo de sessão-tenant (não impersonation de usuário). O gerenciamento self-service de usuários do tenant fica sob `/api/tenant/users`. Use as matrizes abaixo como a intenção de projeto; consulte [REST API](/pt-br/reference/api) para saber o que está de fato ativo.

## Catálogo de principais

Oito principais.

| # | Principal | Categoria | Escopo | Autentica via |
|---|---|---|---|---|
| 1 | **User** (role ∈ {platform_admin, mssp_admin, mssp_manager, analyst, tenant_admin, tenant_manager, tenant_analyst, customer_viewer}) | Humano | Derivado do papel | Ingress OIDC → SocTalk JWT |
| 2 | **Worker** | Serviço SocTalk (background) | Um tenant por job | Service JWT, de curta duração, emitido pela SocTalk API no dispatch |
| 3 | **System** | Serviço SocTalk (operações cross-tenant) | Abrangente à instalação, RLS-bypass | Restrito por code-path; sem JWT |
| 4 | **SocTalk K8s ServiceAccount** | Serviço SocTalk (identidade K8s) | Cluster, com escopo por convenção de nome em `tenant-*` | Token projetado do K8s |
| 5 | **Tenant adapter** | Sidecar do data plane | Tenant único, chama somente a SocTalk API | Adapter JWT, com escopo de tenant, de curta duração |
| 6 | **Wazuh agent** | Agente de endpoint externo | Wazuh manager de um único tenant | Enrollment via Wazuh `authd` → mTLS por agente |
| 7 | **MSSP cluster admin** | Humano, out-of-band | Cluster inteiro (ilimitado) | Credenciais `kubectl` |
| 8 | **Cloud license issuer** | Âncora de confiança | Autoridade de assinatura offline | Chave Ed25519 em HSM/KMS (release futuro) |

### Papéis de usuário

Papéis são pacotes de capacidades organizados em três camadas por audiência (operate ⊆ authorize-risk ⊆ configure); o lado tenant acrescenta um stakeholder somente-leitura abaixo de operate. Veja [Usuários e papéis](/pt-br/users-and-roles) para o modelo de capacidades.

Lado MSSP (`tenant_id` NULL):

| Papel | Camada | Função típica |
|---|---|---|
| `platform_admin` | configure (super) | Toda capacidade MSSP, abrangente à instalação. |
| `mssp_admin` | configure | Configurar o sistema, gerenciar usuários de staff, mais tudo abaixo. |
| `mssp_manager` | authorize-risk | Declarar engagements, curar fatos de autorização, aprovar ações de alto impacto, mais operate. |
| `analyst` | operate | Triagem, revisar vereditos, decidir, conversar; atua num tenant via um pin de Open-SOC. |

Lado tenant (`tenant_id` definido):

| Papel | Camada | Função típica |
|---|---|---|
| `tenant_admin` | configure | Gerenciar usuários da própria organização e configurações de LLM, mais tudo abaixo. |
| `tenant_manager` | authorize-risk | Declarar os próprios engagements, afirmar fatos de autorização (revisados pelo MSSP), mais operate. |
| `tenant_analyst` | operate | Trabalhar o SOC do próprio tenant: triagem, revisar vereditos, decidir, conversar. |
| `customer_viewer` | somente visualização | Dashboards e investigações somente-leitura; não pode agir nem abrir a fila de revisão. |

Derivação de escopo: `role ∈ {platform_admin, mssp_admin, mssp_manager, analyst}` ⇒ `tenant_id` NULL no banco, acesso cross-tenant via papel Postgres elevado ou escopo de sessão-tenant (`/api/auth/assume-tenant`). `role ∈ {tenant_admin, tenant_manager, tenant_analyst, customer_viewer}` ⇒ `tenant_id` obrigatório na linha do usuário e no JWT. Capacidades MSSP e capacidades de tenant nunca se sobrepõem; o guard em cada rota verifica capacidade e audiência em conjunto.

### Disciplina do principal Worker

Todo job de background deve carregar `tenant_id` em seu payload. Os entrypoints de worker são decorados com `@tenant_scoped_worker`, que define `app.current_tenant_id` antes de qualquer acesso ao banco. Workers conectam-se com o papel Postgres `soctalk_app` e são sujeitos a RLS: esquecer de definir o contexto resulta em zero linhas, não em vazamento cross-tenant.

### Disciplina do principal System

Operações cross-tenant (rollups do MSSP, migrações, ferramental de admin) usam o principal `System` via um context manager Python `system_context()`. A entrada emite uma linha de auditoria. O context manager é o único portão. O `import-linter` impede sua importação fora dos módulos de sistema designados. O principal System conecta-se com o papel Postgres `soctalk_mssp`, que tem `BYPASSRLS`.

## Catálogo de recursos

### Recursos de banco de dados (com escopo de tenant)

Todos têm FK `tenant_id` e são sujeitos a RLS:

- `Event` — event store, append-only
- `InvestigationReadModel` — estado projetado da investigação
- `MetricsHourly`, `IOCStats`, `RuleStats`, `AnalyzerStats` — projeções por tenant
- `PendingReview` — fila HIL
- `IntegrationConfig` — URLs de integração, endpoints e thresholds por tenant
- `BrandingConfig` — nome do app, logo e cores por tenant
- `TenantSecret` — referências (ns + name + version) a Secrets do K8s; sem material bruto
- `TenantLifecycleEvent` — log append-only de transições de estado do tenant, revisões de configuração
- `AuditLog` — log append-only de ações de mutação, com `mssp_user_id` quando executadas via impersonation

### Recursos de banco de dados (com escopo de instalação)

Sem `tenant_id`; com escopo de Organization ou global:

- `Organization` — abrangente à instalação (mssp_id, mssp_name, install_id, install_label, license_jwt reservado)
- `User` — tanto usuários do lado MSSP (tenant_id anulável) quanto usuários de cliente (tenant_id obrigatório)
- Semântica de usuário MSSP / usuário Tenant derivada de role + presença de tenant_id; tabela única
- `Release` — metadados de versão do SocTalk (abrangente à instalação)
- Configurações de instalação (feature flags, toggles de todo o sistema)

### Recursos do Kubernetes

| Recurso | Escopo | Gerenciado por |
|---|---|---|
| Namespace `soctalk-system` | Nível de instalação | MSSP cluster admin (criado pelo Helm) |
| Namespace `tenant-<slug>` | Por tenant | SocTalk K8s ServiceAccount (verbos de cluster) |
| `Deployment`, `Service`, `PVC`, `Secret`, `ConfigMap`, `NetworkPolicy`, `ResourceQuota`, `LimitRange`, `ServiceAccount`, `Role`, `RoleBinding` em `tenant-*` | Por tenant | SocTalk K8s ServiceAccount |

## Matriz ator × recurso

`R` = leitura, `W` = escrita, `-` = negado.

| Grupo de recursos | `platform_admin` | `mssp_admin` | `analyst` | `customer_viewer` | `Worker` | `System` | `SocTalk K8s SA` | `Tenant adapter` |
|---|---|---|---|---|---|---|---|---|
| DB com escopo de tenant (próprio tenant) | RW (qualquer) | RW (qualquer) | RW (qualquer) | R (próprio) | RW (tenant do job) | RW (qualquer via bypass) | - | - |
| DB com escopo de instalação | RW | R (menos licença) | R | - | R | RW | - | - |
| Gerenciamento de usuários (lado MSSP) | RW | RW | - | - | - | RW | - | - |
| Gerenciamento de usuários (lado tenant, próprio tenant) | - | - | - | - | - | - | - | - |
| Log de auditoria (próprio tenant) | R tudo | R tudo | R tudo | R próprio | W | W | - | W (via bootstrap) |
| Namespaces K8s `tenant-*` | (somente via API) | (somente via API) | (somente via API) | - | - | - | CRUD | - |
| Recursos K8s dentro de `tenant-*` | (somente via API) | (somente via API) | (somente via API) | - | - | - | CRUD | R próprio |
| Secret de LLM por tenant | - | - | - | - | R (próprio tenant) | - | mount | - |
| Secrets de integração por tenant | - | - | - | - | R (próprio tenant) | - | mount | - |

Notas:
- As colunas mostram um subconjunto representativo de papéis. `mssp_manager` fica entre `mssp_admin` e `analyst` (camada authorize-risk); `tenant_manager` e `tenant_analyst` ficam acima de `customer_viewer` no lado tenant. Cada um detém toda capacidade da camada abaixo dele.
- O gerenciamento de usuários é isolado por capacidade e por audiência, uma **separação de deveres**. Usuários de staff do MSSP são gerenciados somente por `mssp_admin`/`platform_admin` via `/api/mssp/users`; usuários de tenant são gerenciados somente pelo `tenant_admin` do próprio tenant via `/api/tenant/users`. Um admin MSSP não gerencia usuários de tenant, e vice-versa. Atribuir `platform_admin`, e alterar um `platform_admin` existente, exigem um `platform_admin`.
- "somente via API" significa que o principal humano dispara operações do K8s chamando endpoints da SocTalk API, não diretamente. Os handlers da API usam a SocTalk K8s ServiceAccount.
- `analyst` atuando num tenant escreve linhas de auditoria com `user_id` e o `tenant_id` do tenant; a visão de auditoria do lado do cliente exibe estas como entradas de impersonation.

## Matriz de políticas RLS

Veja [Postgres RLS](/pt-br/reference/postgres-rls) para o SQL. Resumo:

| Tabela | Política | `USING` | `WITH CHECK` |
|---|---|---|---|
| Todas as tabelas com escopo de tenant | `tenant_isolation` | `tenant_id = current_setting('app.current_tenant_id')::uuid` | idem |
| `User` (onde `tenant_id IS NOT NULL`) | idem | idem | idem |
| `AuditLog` | `audit_read` | idem para leitura; escritas permitidas a partir de Worker + System | idem |
| Tabelas com escopo de instalação | sem RLS | — | — |

Todas as tabelas com escopo de tenant têm `FORCE ROW LEVEL SECURITY`, de modo que o dono da tabela (`soctalk_admin`) também é sujeito a RLS. O principal System usa o papel `soctalk_mssp` (`BYPASSRLS`) para cruzar tenants intencionalmente.

## Classificação de endpoints da API

Três categorias. Nunca um único endpoint que sirva a duas categorias.

### `/api/mssp/*`: lado MSSP (requer um papel MSSP; a capacidade específica varia por rota)

Capaz de cross-tenant. Quando um handler precisa de visibilidade cross-tenant (rollups, visões de fleet), ele usa o principal `System` através de `system_context()`. Quando um handler atua sobre um tenant específico (impersonation), ele define `app.current_tenant_id` e permanece sujeito a RLS.

Exemplos (este release): `POST /api/mssp/tenants/onboard`, `GET /api/mssp/tenants`, `POST /api/mssp/tenants/{id}:retry`, `POST /api/mssp/tenants/{id}:suspend|:resume|:decommission`, `GET /api/audit`, gerenciamento de usuários de staff do MSSP sob `/api/mssp/users`. (Impersonation e rollups de fleet estão no roadmap.)

### `/api/tenant/*`: lado tenant (requer um papel de tenant; a capacidade específica varia por rota)

Escopo rígido. Contexto de tenant vindo do JWT; sem entrada de impersonation. Todas as consultas aplicam RLS via `soctalk_app`. Inclui superfícies de operate para `tenant_analyst`+ (triagem, revisão, chat) e self-service para engagements, fatos de autorização e usuários.

Exemplos: `GET /api/tenant/overview`, `GET /api/tenant/incidents`, `GET /api/tenant/reports`, `GET /api/tenant/audit`, `GET /api/tenant/branding`.

### `/api/internal/*` — serviço-a-serviço (Worker JWT ou Adapter JWT)

Não voltado ao usuário. Service JWTs de curta duração com contexto de tenant explícito. Exemplos: `POST /api/internal/adapter/health`, `POST /api/internal/adapter/bootstrap`, `GET /api/internal/adapter/config`.

Nenhum endpoint aceita semânticas de `/api/mssp/*` e `/api/tenant/*` ao mesmo tempo. Se uma capacidade for necessária em ambos os lados, ela é implementada como dois endpoints com autorização diferente e fluxos de contexto diferentes.

## Esquemas de claims de token

### JWT de User do lado MSSP

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

Quando um `mssp_admin` ou `analyst` entra no contexto de um tenant, um novo token de curta duração é cunhado com `current_tenant: "<tenant_uuid>"`. Tokens de impersonation têm TTL máximo de 30 minutos e são registrados no momento da cunhagem.

### JWT de User do lado tenant

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "user_type": "tenant",
  "role": "tenant_admin | tenant_manager | tenant_analyst | customer_viewer",
  "tenant_id": "<tenant_uuid>"
}
```

### Service JWT do Worker

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

Adapter JWTs são renovados semanalmente; a rotação é uma reescrita de segredo do lado do controller SocTalk no namespace do tenant.

## Requisitos de auditoria

Toda mutação escreve uma linha `AuditLog` com:

- `id` (uuid), `timestamp`, `tenant_id` (anulável para eventos com escopo de instalação)
- `actor_principal` (User | Worker | System | Adapter)
- `actor_id` (user_id | `worker:<job_id>` | `system:<reason>` | tenant_id do adapter)
- `action` (enum: `tenant.create`, `tenant.suspend`, `investigation.approve`, `settings.update`, `user.impersonate`, …)
- `resource_type`, `resource_id`
- `before`, `after` (snapshots JSON para ações que mudam estado)
- `acting_as` (anulável; definido quando um `mssp_admin` ou `analyst` está fazendo impersonation de um tenant)
- `request_id` (correlaciona com as linhas de log)

A retenção é de 90 dias; configurável por instalação num release futuro. Clientes podem visualizar linhas de auditoria onde `tenant_id = próprio`, incluindo entradas com `acting_as` preenchido (transparência sobre ações do MSSP). A visão de auditoria cross-tenant do MSSP roda sob o principal `System`.

## Limites arquiteturais conhecidos

- **Confiança no MSSP cluster admin.** O principal #7 tem acesso K8s ilimitado. O modelo de isolamento do SocTalk pressupõe que este principal é confiável. Clientes que exijam defesa contra ameaça interna no nível do MSSP precisam de camadas de nó dedicado ou VM dedicada (release futuro).
- **Escopo da fronteira de admissão.** A `ValidatingAdmissionPolicy` restringe a ServiceAccount do controller SocTalk para namespaces de tenant e mutações de recursos namespaced, mas usuários MSSP cluster-admin permanecem operadores break-glass confiáveis. O Kyverno é um caminho opcional de hardening futuro.
- **Sem enforcement de licença atualmente.** License JWT e feature gates adiados para um release futuro. MSSPs em piloto operam por honra.
- **Cache de respostas do LLM.** Chaveado em `(tenant_id, prompt_hash)` desde o dia 1. Se algum dia for relaxado, há risco de vazamento de conteúdo cross-tenant; a suíte de testes verifica a composição da chave.
- **Assinaturas SSE.** Com escopo de tenant no momento da assinatura. Bugs de persistência de conexão poderiam entregar eventos cross-tenant numa assinatura obsoleta; teste explícito de isolamento SSE no implementation gate.
- **Vazamento de contexto do Worker.** Todo entrypoint de worker deve definir `app.current_tenant_id`. O padrão defensivo é zero linhas sob RLS, não vazamento cross-tenant, mas a suíte de testes verifica a defesa.

## Requisitos de teste

1. **Sondagem cross-tenant da API.** Para cada endpoint `/api/tenant/*` e `/api/mssp/*` que acessa dados com escopo de tenant, elabore requisições como tenant A que tentem leituras ou escritas de recursos do tenant B. Verifique 0 linhas ou 403.
2. **Sondagem RLS via SQL bruto.** Conecte-se como `soctalk_app`, defina `app.current_tenant_id = A`, execute `SELECT * FROM events` (sem filtro); verifique que apenas linhas do tenant A são retornadas.
3. **Contexto padrão do Worker.** Dispare um job de worker sem definir o contexto de tenant; verifique que as consultas retornam 0 linhas (comportamento defensivo de zero).
4. **Isolamento SSE.** Assine como tenant A o SSE de eventos; faça uma mutação no tenant B; verifique que nenhum evento é entregue no stream de A.
5. **Isolamento do cache de LLM.** Dispare prompts idênticos a partir do tenant A e do tenant B; verifique cache miss na segunda chamada para B (chave diferente) e cache hit na terceira chamada para A (mesma chave).
6. **Auditoria de impersonation.** Como `mssp_admin`, faça impersonation do tenant A, realize uma mutação; verifique que existe uma linha `AuditLog` com `acting_as=<mssp_admin_id>` e `tenant_id=A`; verifique que o usuário de cliente em A consegue ler a linha.
7. **Auditoria de contexto System.** Dispare uma chamada `/api/mssp/fleet/summary`; verifique uma linha de auditoria para a entrada de contexto de sistema com motivo.
