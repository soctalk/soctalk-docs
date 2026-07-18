# 安全模型

主体目录、参与者×资源矩阵、RLS 策略矩阵、Postgres 角色模型、端点分类、令牌声明架构、审计要求、密钥放置。

> **V1 部署说明。** 下文中的端点示例（例如 `/api/mssp/impersonate/:tenant_id`、`/api/mssp/users` POST/列表、`/api/mssp/fleet/summary`）以及若干主体条目（Cloud license issuer；模拟身份参与者）描述的是**目标安全界面**。已挂载的 MSSP 端点包括：租户 CRUD、审计（`/api/audit`）、员工用户管理（`/api/mssp/users` 的创建/列表/patch/停用以及 `/{id}/password/reset`），以及用于会话租户作用域限定的 `/api/auth/assume-tenant`（并非用户模拟身份）。租户自助的用户管理位于 `/api/tenant/users`。请将下方矩阵作为设计意图使用；关于当前实际上线的内容，请查阅 [REST API](/zh-cn/reference/api)。

## 主体目录

八个主体。

| # | 主体 | 类别 | 作用域 | 认证方式 |
|---|---|---|---|---|
| 1 | **User**（角色 ∈ {platform_admin, mssp_admin, mssp_manager, analyst, tenant_admin, tenant_manager, tenant_analyst, customer_viewer}） | 人类 | 由角色派生 | Ingress OIDC → SocTalk JWT |
| 2 | **Worker** | SocTalk 服务（后台） | 每个作业一个租户 | 服务 JWT，短期有效，由 SocTalk API 在派发时签发 |
| 3 | **System** | SocTalk 服务（跨租户操作） | 覆盖整个安装，绕过 RLS | 由代码路径把关；无 JWT |
| 4 | **SocTalk K8s ServiceAccount** | SocTalk 服务（K8s 身份） | 集群，按命名约定限定到 `tenant-*` | K8s 投射令牌 |
| 5 | **Tenant adapter** | 数据平面 sidecar | 单个租户，仅调用 SocTalk API | Adapter JWT，租户作用域，短期有效 |
| 6 | **Wazuh agent** | 外部端点代理 | 单个租户的 Wazuh manager | Wazuh `authd` 注册 → 每个代理的 mTLS |
| 7 | **MSSP cluster admin** | 人类，带外 | 整个集群（无边界） | `kubectl` 凭据 |
| 8 | **Cloud license issuer** | 信任锚 | 离线签名机构 | HSM/KMS 中的 Ed25519 密钥（未来版本） |

### 用户角色

角色是能力集合，按受众组织为三个层级（operate ⊆ authorize-risk ⊆ configure）；租户侧在 operate 之下额外增加一个只读利益相关方。有关能力模型，请参阅 [用户与角色](/zh-cn/users-and-roles)。

MSSP 侧（`tenant_id` 为 NULL）：

| 角色 | 层级 | 典型职能 |
|---|---|---|
| `platform_admin` | configure（超级） | 覆盖整个安装的每一项 MSSP 能力。 |
| `mssp_admin` | configure | 配置系统、管理员工用户，外加以下所有能力。 |
| `mssp_manager` | authorize-risk | 声明约定、整理授权事实、对高影响面动作签核，外加 operate。 |
| `analyst` | operate | 分诊、审查裁决、决策、聊天；通过 Open-SOC 固定入口处理某个租户。 |

租户侧（已设置 `tenant_id`）：

| 角色 | 层级 | 典型职能 |
|---|---|---|
| `tenant_admin` | configure | 管理本组织用户与 LLM 设置，外加以下所有能力。 |
| `tenant_manager` | authorize-risk | 声明本方约定、断言授权事实（经 MSSP 审查），外加 operate。 |
| `tenant_analyst` | operate | 处理自己租户的 SOC：分诊、审查裁决、决策、聊天。 |
| `customer_viewer` | 仅查看 | 只读仪表盘与调查；无法执行动作或打开审查队列。 |

作用域派生：`role ∈ {platform_admin, mssp_admin, mssp_manager, analyst}` ⇒ 数据库中 `tenant_id` 为 NULL，通过提升的 Postgres 角色或会话租户作用域限定（`/api/auth/assume-tenant`）实现跨租户访问。`role ∈ {tenant_admin, tenant_manager, tenant_analyst, customer_viewer}` ⇒ 用户行与 JWT 中都必须设置 `tenant_id`。MSSP 能力与租户能力从不重叠；每条路由上的护栏会同时检查能力与受众。

### Worker 主体纪律

每个后台作业都必须在其载荷中携带 `tenant_id`。Worker 入口点由 `@tenant_scoped_worker` 装饰，它会在任何数据库访问之前设置 `app.current_tenant_id`。Worker 以 `soctalk_app` Postgres 角色连接，受 RLS 约束：忘记设置上下文会返回零行，而非跨租户泄露。

### System 主体纪律

跨租户操作（MSSP 汇总、迁移、管理工具）通过 `system_context()` Python 上下文管理器使用 `System` 主体。进入时会发出一条审计行。该上下文管理器是唯一入口。`import-linter` 防止其在指定的系统模块之外被导入。System 主体以具有 `BYPASSRLS` 的 `soctalk_mssp` Postgres 角色连接。

## 资源目录

### 数据库资源（租户作用域）

全部带有 `tenant_id` 外键并受 RLS 约束：

- `Event` — 事件存储，仅追加
- `InvestigationReadModel` — 投影出的调查状态
- `MetricsHourly`、`IOCStats`、`RuleStats`、`AnalyzerStats` — 每租户投影
- `PendingReview` — HIL 队列
- `IntegrationConfig` — 每租户的集成 URL、端点、阈值
- `BrandingConfig` — 每租户的应用名称、徽标、配色
- `TenantSecret` — 对 K8s Secret 的引用（ns + name + version）；不含原始材料
- `TenantLifecycleEvent` — 租户状态转换、配置修订的仅追加日志
- `AuditLog` — 变更动作的仅追加日志，当通过模拟身份执行时带有 `mssp_user_id`

### 数据库资源（安装作用域）

无 `tenant_id`；Organization 作用域或全局：

- `Organization` — 覆盖整个安装（mssp_id、mssp_name、install_id、install_label、预留的 license_jwt）
- `User` — 既包括 MSSP 侧用户（tenant_id 可为空），也包括客户用户（必须有 tenant_id）
- MSSP 用户 / 租户用户语义由角色 + 是否存在 tenant_id 派生；单一表
- `Release` — SocTalk 版本元数据（覆盖整个安装）
- 安装设置（功能开关、全系统切换项）

### Kubernetes 资源

| 资源 | 作用域 | 管理者 |
|---|---|---|
| Namespace `soctalk-system` | 安装级 | MSSP cluster admin（由 Helm 创建） |
| Namespace `tenant-<slug>` | 每租户 | SocTalk K8s ServiceAccount（集群级动作） |
| `tenant-*` 中的 `Deployment`、`Service`、`PVC`、`Secret`、`ConfigMap`、`NetworkPolicy`、`ResourceQuota`、`LimitRange`、`ServiceAccount`、`Role`、`RoleBinding` | 每租户 | SocTalk K8s ServiceAccount |

## 参与者 × 资源矩阵

`R` = 读，`W` = 写，`-` = 拒绝。

| 资源组 | `platform_admin` | `mssp_admin` | `analyst` | `customer_viewer` | `Worker` | `System` | `SocTalk K8s SA` | `Tenant adapter` |
|---|---|---|---|---|---|---|---|---|
| 租户作用域数据库（本租户） | RW（任意） | RW（任意） | RW（任意） | R（本方） | RW（作业所属租户） | RW（经绕过对任意） | - | - |
| 安装作用域数据库 | RW | R（不含 license） | R | - | R | RW | - | - |
| 用户管理（MSSP 侧） | RW | RW | - | - | - | RW | - | - |
| 用户管理（租户侧，本租户） | - | - | - | - | - | - | - | - |
| 审计日志（本租户） | R 全部 | R 全部 | R 全部 | R 本方 | W | W | - | W（经引导） |
| K8s 命名空间 `tenant-*` | （仅经 API） | （仅经 API） | （仅经 API） | - | - | - | CRUD | - |
| `tenant-*` 内的 K8s 资源 | （仅经 API） | （仅经 API） | （仅经 API） | - | - | - | CRUD | R 自身 |
| 每租户 LLM Secret | - | - | - | - | R（本租户） | - | 挂载 | - |
| 每租户集成 Secret | - | - | - | - | R（本租户） | - | 挂载 | - |

说明：
- 列中展示的是角色的代表性子集。`mssp_manager` 位于 `mssp_admin` 与 `analyst` 之间（authorize-risk 层级）；`tenant_manager` 与 `tenant_analyst` 在租户侧位于 `customer_viewer` 之上。每个角色都持有其下层级的全部能力。
- 用户管理按受众设有能力隔离墙。MSSP 员工用户仅由 `mssp_admin`/`platform_admin` 通过 `/api/mssp/users` 管理；租户用户仅由该租户自己的 `tenant_admin` 通过 `/api/tenant/users` 管理。MSSP 管理员不管理租户用户，反之亦然。分配 `platform_admin`，以及变更现有的 `platform_admin`，都需要一名 `platform_admin`。
- “仅经 API”意味着人类主体通过调用 SocTalk API 端点来触发 K8s 操作，而非直接操作。API 处理程序使用 SocTalk K8s ServiceAccount。
- `analyst` 对某个租户执行动作时，会写入同时包含 `user_id` 与该租户 `tenant_id` 的审计行；客户侧的审计视图将这些显示为模拟身份条目。

## RLS 策略矩阵

SQL 请参阅 [Postgres RLS](/zh-cn/reference/postgres-rls)。摘要：

| 表 | 策略 | `USING` | `WITH CHECK` |
|---|---|---|---|
| 所有租户作用域表 | `tenant_isolation` | `tenant_id = current_setting('app.current_tenant_id')::uuid` | 同上 |
| `User`（其中 `tenant_id IS NOT NULL`） | 同上 | 同上 | 同上 |
| `AuditLog` | `audit_read` | 读取时同上；允许来自 Worker + System 的写入 | 同上 |
| 安装作用域表 | 无 RLS | — | — |

所有租户作用域表都设置了 `FORCE ROW LEVEL SECURITY`，因此表所有者（`soctalk_admin`）同样受 RLS 约束。System 主体使用 `soctalk_mssp` 角色（`BYPASSRLS`）以有意进行跨租户访问。

## API 端点分类

三个类别。绝不会有一个端点同时服务于两个类别。

### `/api/mssp/*`：MSSP 侧（需要一个 MSSP 角色；具体能力因路由而异）

具备跨租户能力。当处理程序需要跨租户可见性（汇总、机队视图）时，它通过 `system_context()` 使用 `System` 主体。当处理程序作用于特定租户（模拟身份）时，它会设置 `app.current_tenant_id` 并保持受 RLS 约束。

示例（本版本）：`POST /api/mssp/tenants/onboard`、`GET /api/mssp/tenants`、`POST /api/mssp/tenants/{id}:retry`、`POST /api/mssp/tenants/{id}:suspend|:resume|:decommission`、`GET /api/audit`、位于 `/api/mssp/users` 下的 MSSP 员工用户管理。（模拟身份与机队汇总属于路线图项。）

### `/api/tenant/*`：租户侧（需要一个租户角色；具体能力因路由而异）

硬性作用域限定。租户上下文来自 JWT；无模拟身份条目。所有查询经 `soctalk_app` 强制 RLS。包含面向 `tenant_analyst`+ 的 operate 界面（分诊、审查、聊天），以及针对约定、授权事实和用户的自助功能。

示例：`GET /api/tenant/overview`、`GET /api/tenant/incidents`、`GET /api/tenant/reports`、`GET /api/tenant/audit`、`GET /api/tenant/branding`。

### `/api/internal/*` — 服务间（Worker JWT 或 Adapter JWT）

非面向用户。带有显式租户上下文的短期服务 JWT。示例：`POST /api/internal/adapter/health`、`POST /api/internal/adapter/bootstrap`、`GET /api/internal/adapter/config`。

没有任何端点同时接受 `/api/mssp/*` 与 `/api/tenant/*` 两种语义。如果某项能力在两侧都需要，则实现为两个具有不同授权与不同上下文流的端点。

## 令牌声明架构

### MSSP 侧 User JWT

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

当一名 `mssp_admin` 或 `analyst` 进入租户上下文时，会铸造一个带有 `current_tenant: "<tenant_uuid>"` 的新的短期令牌。模拟身份令牌的 TTL 最长为 30 分钟，并在铸造时记录日志。

### 租户侧 User JWT

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "user_type": "tenant",
  "role": "tenant_admin | tenant_manager | tenant_analyst | customer_viewer",
  "tenant_id": "<tenant_uuid>"
}
```

### Worker 服务 JWT

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

Adapter JWT 每周刷新；轮换是在租户命名空间中由 SocTalk 控制器侧改写密钥完成的。

## 审计要求

每次变更都会写入一条 `AuditLog` 行，包含：

- `id`（uuid）、`timestamp`、`tenant_id`（对安装作用域事件可为空）
- `actor_principal`（User | Worker | System | Adapter）
- `actor_id`（user_id | `worker:<job_id>` | `system:<reason>` | adapter 的 tenant_id）
- `action`（枚举：`tenant.create`、`tenant.suspend`、`investigation.approve`、`settings.update`、`user.impersonate`、……）
- `resource_type`、`resource_id`
- `before`、`after`（状态变更动作的 JSON 快照）
- `acting_as`（可为空；当 `mssp_admin` 或 `analyst` 正在模拟某个租户时设置）
- `request_id`（与日志行相关联）

保留期为 90 天；未来版本可按安装进行配置。客户可以查看 `tenant_id = 本方` 的审计行，包括填充了 `acting_as` 的条目（对 MSSP 动作的透明度）。MSSP 的跨租户审计视图在 `System` 主体下运行。

## 已知架构限制

- **MSSP cluster admin 信任。** 主体 #7 拥有无边界的 K8s 访问权限。SocTalk 的隔离模型假定该主体是受信任的。需要在 MSSP 层级防范内部威胁的客户，需要专用节点或专用 VM 分层（未来版本）。
- **准入边界范围。** `ValidatingAdmissionPolicy` 对 SocTalk 控制器 ServiceAccount 在租户命名空间及命名空间内资源变更方面加以约束，但 MSSP cluster-admin 用户仍是受信任的破窗（break-glass）操作者。Kyverno 是可选的未来加固路径。
- **当前无 license 强制。** License JWT 与功能门禁推迟到未来版本。试点 MSSP 以诚信方式运营。
- **LLM 响应缓存。** 从第一天起即以 `(tenant_id, prompt_hash)` 为键。若曾放宽，则存在跨租户内容泄露风险；测试套件会断言键的组成。
- **SSE 订阅。** 在订阅时进行租户作用域限定。连接持久化缺陷可能在陈旧订阅上投递跨租户事件；实现门禁中有显式的 SSE 隔离测试。
- **Worker 上下文泄漏。** 每个 worker 入口点都必须设置 `app.current_tenant_id`。防御性默认行为是在 RLS 下返回零行，而非跨租户泄露，但测试套件会断言该防御。

## 测试要求

1. **跨租户 API 探测。** 对每个访问租户作用域数据的 `/api/tenant/*` 与 `/api/mssp/*` 端点，以租户 A 的身份构造尝试读取或写入租户 B 资源的请求。断言返回 0 行或 403。
2. **原始 SQL RLS 探测。** 以 `soctalk_app` 连接，设置 `app.current_tenant_id = A`，执行 `SELECT * FROM events`（不加过滤）；断言仅返回租户 A 的行。
3. **Worker 上下文默认值。** 派发一个未设置租户上下文的 worker 作业；断言查询返回 0 行（防御性零行为）。
4. **SSE 隔离。** 以租户 A 订阅事件 SSE；在租户 B 中进行变更；断言 A 的流上没有投递任何事件。
5. **LLM 缓存隔离。** 从租户 A 与租户 B 触发相同的提示词；断言 B 的第二次调用未命中缓存（键不同），A 的第三次调用命中缓存（键相同）。
6. **模拟身份审计。** 以 `mssp_admin` 身份模拟租户 A，执行一次变更；断言存在一条带有 `acting_as=<mssp_admin_id>` 与 `tenant_id=A` 的 `AuditLog` 行；断言 A 中的客户用户可以读取该行。
7. **System 上下文审计。** 触发一次 `/api/mssp/fleet/summary` 调用；断言存在一条带有原因的 system-context 进入审计行。
