# 密钥放置策略

> **V1 部署说明。** 下文若干条目将“编排器 pod”作为独立工作负载引用——在 V1 chart 中，编排器与 `soctalk-system-api` Deployment 同处一处，因此本版本中提及的“编排器 pod”即指“API pod”。具体的 K8s Secret 名称也可能与 chart 渲染出的名称略有出入（真实来源以 [`charts/soctalk-system/templates/60-secrets.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/60-secrets.yaml) 为准）。

## 不变式（理想目标）

**目标：** SocTalk 数据库中不存放任何原始密钥材料。追踪密钥的 Postgres 表仅存储引用：`(namespace, name, version_label)`。材料本身位于 Kubernetes `Secret` 对象中，并挂载到需要它的 pod。

**当前（V1）：** 存在**一处已记录的例外**——数据库中的 `IntegrationConfig.llm_api_key_plain` 以明文存储各租户的 LLM API 密钥。这是必需的，因为 runs-worker 在调查拾取时会从其租户上下文中读取该密钥，而 V1 chart 尚未通过 pod spec 打通各租户的 LLM Secret。请将 Postgres 凭据视为保护这些密钥的屏障，并在数据库凭据轮换时，按这些密钥已泄露来处理，一并轮换 LLM 提供商密钥。

其他密钥类别——JWT 签名、Postgres 角色、集成凭据、Wazuh authd——均存放在 K8s Secret 中，并由数据库按名称引用，而非内联存储。下方的架构目标描述了所有密钥类别的目标状态：

- 限制 SocTalk 数据库遭入侵时的爆炸半径（不泄露任何材料）。
- 使 K8s 原生轮换机制得以生效（Secret 更新 → pod 在重新挂载或下次读取 Secret 时获取新值）。
- 与未来版本中的 External Secrets Operator 集成路径保持一致。

## V1 密钥清单（chart 当前实际渲染的内容）

| Secret | 材料 | 位置 | 访问方 | 轮换 |
|---|---|---|---|---|
| `soctalk-system-postgres-admin-creds` | 用户名/密码 | `soctalk-system` ns | 仅 API pod 的 `db-init` 容器（迁移 + 引导） | 手动 |
| `soctalk-system-postgres-app-creds` | 用户名/密码 | `soctalk-system` ns | API pod（运行时，受 RLS 约束） | 手动 |
| `soctalk-system-postgres-mssp-creds` | 用户名/密码 | `soctalk-system` ns | API pod（`system_context()` 跨租户查询） | 手动 |
| `soctalk-system-jwt-signing-key` | HMAC 密钥 | `soctalk-system` ns | API pod | 手动 |
| `soctalk-system-adapter-signing-key` | HMAC 密钥 | `soctalk-system` ns | API pod（铸造各租户的适配器令牌） | 手动 |
| `soctalk-system-bootstrap-admin` | 邮箱 + 密码 | `soctalk-system` ns | 仅 API pod 的 `db-init` 容器 | 手动 |
| `soctalk-system-llm-api-key` | 提供商 API 密钥（anthropic-api-key + openai-api-key） | `soctalk-system` ns | API pod（全安装范围的默认值） | 手动 |
| `adapter-token` | bearer 令牌 | `tenant-<slug>` ns | 租户适配器 pod | 于置备时铸造；通过重新置备轮换 |
| `runs-worker-token` | bearer 令牌 | `tenant-<slug>` ns | 租户 runs-worker pod（调用 `/api/internal/worker/runs/*`） | 同上 |
| `tenant-llm-key` | LLM API 密钥 | `tenant-<slug>` ns | 租户 runs-worker pod（通过 `secretKeyRef` 挂载） | 由 MSSP 通过 `PATCH /api/mssp/tenants/{id}/llm` 发起；控制器从 `IntegrationConfig.llm_api_key_plain` 物化并重启 runs-worker |
| `tenant-<id>-llm` | LLM API 密钥（遗留 / 审计副本） | `soctalk-system` ns | 任何 V1 pod 均不挂载 | 同上；此副本为审计而写入，但**并非** runs-worker 读取的权威来源 |
| `wazuh-authd-secret` | 共享密钥 | `tenant-<slug>` ns | Wazuh manager（注册） | 重新生成以强制所有 agent 重新注册 |
| `wazuh-<slug>-wazuh-creds` | 用户名/密码 | `tenant-<slug>` ns | Wazuh manager + linux-ep pod（agent 注册） | 于置备时生成 |

**分诊在每个 `tenant-<slug>` 命名空间的 `soctalk-runs-worker` 中执行**（而非在中央 API pod 中）。这正是各租户密钥挂载到租户命名空间、而非 `soctalk-system` 的原因。

LLM API 密钥**同时以明文存储在 Postgres 的 `IntegrationConfig.llm_api_key_plain` 中**——参见上文的不变式免责声明。K8s Secret 在置备 / 轮换时从数据库值物化而来。

早期草稿中现已移除的过时条目：`tenant-<id>-wazuh`、`tenant-<id>-thehive`、`tenant-<id>-cortex`、`wazuh-bootstrap`、`thehive-bootstrap`、`cortex-bootstrap`、`cassandra-creds`、`soctalk-license`。`soctalk-system` 中的 `tenant-<id>-llm` 在 V1 中仍作为遗留 / 审计副本存在，但它**并非** runs-worker 所读取的内容。下方的架构章节描述了设计原理；仅上方清单为当前有效内容。

## 各租户 LLM 密钥放置

分诊在各租户的 `soctalk-runs-worker` pod（位于 `tenant-<slug>` 命名空间）中执行，**而非**在中央 API pod 中。这正是各租户 LLM 密钥存放于租户命名空间的原因：

- **权威存储：** Postgres 中的 `IntegrationConfig.llm_api_key_plain`。
- **挂载来源：** `tenant-<slug>` 中的 `Secret/tenant-llm-key`，由控制器从数据库值物化而来。
- **轮换时（`PATCH /api/mssp/tenants/{id}/llm`）：** 控制器改写租户命名空间的 Secret 并重启 `Deployment/soctalk-runs-worker`，使新密钥在下次调查认领时生效。

`soctalk-system` 命名空间中的 `Secret/tenant-<id>-llm` 也作为早期设计迭代遗留下来的遗留 / 审计副本存在，但**不会**被任何 V1 pod 挂载。V1 中不存在跨命名空间的 Secret 挂载。

替代方案（为每个租户的 LLM 密钥使用各租户命名空间）将在未来版本中结合 External Secrets Operator 重新评估，届时 ESO 可将存储在外部 vault 中的密钥同步到任何需要它的命名空间。

## 数据平面引导密钥

Wazuh/TheHive/Cortex 管理员凭据存放于各自的租户命名空间，原因如下：

- 这些 pod 在启动时（init 容器、首次运行设置）需要它们。
- 如上所述，跨命名空间挂载存在复杂性。
- 命名空间遭入侵的爆炸半径本已暴露这些 pod 本身；将引导密钥放在同一命名空间不会增加风险。

引导密钥由 SocTalk 控制器在租户置备时生成：
1. 控制器生成随机值（例如 `openssl rand -hex 32`）。
2. 控制器在目标 `tenant-<slug>` ns 中创建 `Secret`。
3. 控制器在 `TenantSecret` 表中记录引用 `(tenant-<slug>, wazuh-bootstrap, v1)`。
4. 控制器渲染按名称引用该 Secret 的租户 chart 值。
5. `helm install` 继续执行；数据平面 pod 在启动时读取凭据。

若材料丢失（例如 Secret 被删除），重新置备将重新生成新凭据。数据平面 pod 重启；任何依赖服务重新初始化。客户端点 agent（依赖 Wazuh 注册密钥）在该特定密钥轮换时需要重新注册：已记录于运维 runbook 中。

## 密钥生成约定

在租户置备时，SocTalk 控制器生成：

```python
import secrets

# Administrative passwords: 32-char high-entropy
wazuh_admin_pw = secrets.token_urlsafe(32)
thehive_admin_pw = secrets.token_urlsafe(32)
cortex_admin_pw = secrets.token_urlsafe(32)

# Enrollment shared secret: 48-char
wazuh_authd = secrets.token_urlsafe(48)

# API tokens (for SocTalk → data plane): 48-char
thehive_api_token = secrets.token_urlsafe(48)
cortex_api_key = secrets.token_urlsafe(48)

# Cassandra: 32-char
cassandra_pw = secrets.token_urlsafe(32)
```

SocTalk 存储引用和版本标签；除置备调用期间外，它不会在内存中保留材料。

## 轮换（V1 现状）

1. **各租户 LLM 密钥轮换**（由 MSSP 通过 `PATCH /api/mssp/tenants/{id}/llm` 发起）：
   - 权威存储在 Postgres 中更新（`IntegrationConfig.llm_api_key_plain`）。
   - 控制器改写 `tenant-<slug>` 中的 `Secret/tenant-llm-key`（而非系统命名空间）。
   - 控制器重启租户命名空间中的 `Deployment/soctalk-runs-worker`，使新密钥在下次认领时生效。**必须重启 pod**——V1 不会在运行时重新加载密钥。

2. **Wazuh / TheHive / Cortex 管理员凭据轮换**（手动，runbook）：
   - `kubectl patch secret <name> -n tenant-<slug> ...` 以改写凭据。
   - `kubectl rollout restart` 受影响的工作负载，使其重新读取。
   - 早期草稿中记录了执行此操作的封装 CLI（`soctalk-cli rotate-admin`），但在 V1 中**未实现**。

3. **Postgres 凭据轮换**（手动，runbook）：
   - 在 Postgres 中执行 `ALTER ROLE soctalk_app WITH PASSWORD ...`。
   - `kubectl patch secret soctalk-system-postgres-app-creds ...`（注意 chart 渲染出的名称）。
   - `kubectl rollout restart deploy soctalk-system-api`——V1 中不存在独立的编排器 pod（编排器与 API pod 同处一处）。

4. **JWT 签名密钥轮换**（未来版本）：零停机轮换要求在过渡期支持两个有效密钥。本版本推迟实现；手动轮换会强制出现一个所有用户需重新认证的窗口。

## 访问控制

Kubernetes RBAC 限制哪些 ServiceAccount 可以读取哪些 Secret：

- `soctalk-system` 中的 `soctalk-system-api` SA：可读取 `soctalk-system` 中的 Secret（Postgres 凭据、JWT/适配器签名密钥）。同时被授予在 `tenant-*` 命名空间中写入 Secret 的权限（用于创建/轮换租户引导密钥）——V1 chart 将 API + 控制器角色合并到此 SA。
- `tenant-<slug>` 中的各租户 `ServiceAccount`：仅可读取自身命名空间中的密钥。它可读取自身的 `adapter-token` / `runs-worker-token` / `tenant-llm-key`，但永远无法读取系统签名密钥。
- 早期草稿中的 `soctalk-orchestrator-sa` 在 V1 中不存在——编排器在 API SA 下的 API pod 内运行。

`Role`/`RoleBinding` 模板是 `soctalk-system` chart（用于 SocTalk SA）和 `soctalk-tenant` chart（用于各租户 SA）的一部分。

## 明确拒绝的反模式

- **从 `.env` 文件注入环境变量密钥**（当前 V0 模式）：适用于单组织，不适用于多租户。所有密钥迁移至 K8s Secret。
- **将密钥放入 Helm values.yaml**：绝不：values 文件最终会进入 Git、CI 日志、Helm 历史记录。SocTalk 控制器单独渲染 Secret 对象，并在模板中使用 `valueFrom.secretKeyRef`。
- **所有租户共用单个 LLM 密钥**：对 BYO LLM 而言明确超出范围。始终使用各租户密钥。
- **将密钥放入 ConfigMap**：禁止。ConfigMap 用于非敏感配置；Secret 用于敏感内容。

## External Secrets Operator（未来版本路径）

未来版本将引入 External Secrets Operator 集成：

- MSSP 提供一个密钥后端（HashiCorp Vault、AWS Secrets Manager、Azure Key Vault、GCP Secret Manager）。
- `ExternalSecret` 资源引用后端路径；ESO 将其同步到 K8s Secret。
- 各租户 LLM 密钥存储在后端中，路径形如 `secret/mssp-abc/tenants/acme/llm`。
- 轮换在后端完成；ESO 在刷新间隔内传播。

该结构（Postgres 中的引用 → K8s Secret → 挂载）是兼容的：仅 Secret 来源发生变化（ESO 管理 vs SocTalk 控制器写入）。
