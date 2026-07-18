# 双 Chart 契约

> **V1 状态。** 下文各节描述的是**目标契约**。具体到本次发行版：`chart_compatibility` 表、`compatibility.yaml` 制品、`controller.can_upgrade(system, tenant)` 校验，以及 MSSP-UI 的"系统 → 版本"界面**均未实现**。在这些能力交付之前，请将兼容性视为一份发行说明层面的契约（仅限已测试的组合）。下文的 schema 与矩阵仍可作为设计目标参考。

## Chart 类别

| | `soctalk-system` | `soctalk-tenant` |
|---|---|---|
| **作用域** | 每个 MSSP 安装一套 | 每个终端客户一套 |
| **目标命名空间** | `soctalk-system`（固定） | `tenant-<slug>`（安装时创建） |
| **安装者** | MSSP 集群管理员（`helm install soctalk-system …`） | SocTalk 控制器经由 Helm SDK（由 `POST /api/mssp/tenants` 触发） |
| **频率** | 每个集群生命周期一次；版本变更时执行 `helm upgrade` | 每次终端客户上线时；SOC 栈版本变更时执行 `helm upgrade` |
| **值的编写方** | 由 MSSP 管理员手工编写 | 由 SocTalk 根据租户配置渲染；从不手工编辑 |
| **校验方式** | `values.schema.json` | `values.schema.json`（SocTalk 还会在渲染前校验） |
| **版本权威来源** | Chart.yaml semver | Chart.yaml semver |

## 2. `soctalk-system` 值 schema（草案）

这是简化后的结构；完整的 JSON Schema 制品位于 `charts/soctalk-system/values.schema.json`。

```yaml
# Install identity
install:
  msspId: <uuid>              # written into Organization row
  msspName: "Example MSSP"
  installId: <uuid>           # written into Organization row; stable across upgrades
  installLabel: "pilot-prod"  # human-readable

# Image sources
image:
  registry: ghcr.io/soctalk
  tag: v1.0.0                 # or `latest`
  pullPolicy: IfNotPresent

# Postgres
postgres:
  enabled: true               # false = use external; then postgres.external.* required
  storage:
    size: 20Gi
    storageClassName: ""      # use cluster default
  external:
    host: ""
    port: 5432
    database: "soctalk"
    existingSecret: ""        # Secret must contain admin_user, admin_password, app_user, app_password, mssp_user, mssp_password

# Ingress (for MSSP UI + Customer UI)
ingress:
  enabled: true
  className: traefik          # or nginx, or anything the cluster provides
  tls:
    secretName: soctalk-tls
    issuerRef: letsencrypt-prod
  hostnames:
    mssp: mssp.example.com
    customer: "*.customers.example.com"  # per-tenant subdomain routing

# Authentication. Chart deploys `internal` mode (SocTalk-owned
# login/sessions/passwords). The runtime also supports `proxy` mode
# (OAuth2-Proxy / Keycloak / Dex forwards trusted identity headers),
# selectable via the `SOCTALK_AUTH_MODE` env var on the API
# Deployment — chart values do not yet expose this switch.
auth:
  cookieSecure: true            # production TLS: true; HTTP-only dev: false
  publicOriginOverride: ""      # set when browser origin includes a non-default port

# OIDC trusted-header config (consumed by the API only in proxy mode).
oidc:
  trustedHeaderUser: X-Forwarded-User
  trustedHeaderEmail: X-Forwarded-Email
  trustedHeaderGroups: X-Forwarded-Groups
  trustedProxyCIDRs:
    - 10.0.0.0/8                # ingress controller CIDR; SocTalk rejects OIDC headers from other sources

# LLM defaults (per-tenant overrides via tenant chart)
defaults:
  llm:
    provider: openai-compatible
    baseUrl: https://api.openai.com/v1
    model: gpt-4o

# Resource sizing for SocTalk control plane
resources:
  api:
    requests: { cpu: 500m, memory: 512Mi }
    limits:   { cpu: 2,    memory: 2Gi }
  orchestrator:
    requests: { cpu: 500m, memory: 1Gi }
    limits:   { cpu: 2,    memory: 4Gi }
  postgres:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { cpu: 2,    memory: 2Gi }

# Admission: native guard for SocTalk controller namespace operations.
admission:
  engine: vap    # vap | none

# Licensing: disabled in this release
licensing:
  enabled: false

# Telemetry: disabled in this release (no Cloud backend to send to)
telemetry:
  enabled: false
```

## 3. `soctalk-tenant` 值 schema（草案）

与 SocTalk 从数据库渲染出的租户配置模型一致。这是 SocTalk 控制器据以渲染的契约；`values.schema.json` 在两侧都会对其进行校验。

```yaml
# Tenant identity
tenant:
  id: <uuid>                  # tenant UUID
  slug: acme                  # DNS-safe, MSSP-unique
  msspId: <uuid>
  installId: <uuid>
  displayName: "Acme Corp"

# Branding (referenced by SocTalk UIs, not by data plane)
branding:
  appName: "Acme SOC"
  logoUrl: https://acme.example.com/logo.png
  primaryColor: "#1a73e8"
  secondaryColor: "#fbbc04"
  favicon: ""

# LLM config (per tenant; overrides install defaults)
llm:
  provider: openai-compatible
  baseUrl: https://api.openai.com/v1
  model: gpt-4o
  apiKeyRef:
    # V1: provisioning renders this as a secretKeyRef to a Secret in the
    # tenant's OWN namespace, not the system namespace.
    name: tenant-llm-key        # in tenant-<slug> namespace
    key: api_key

# Integration endpoints (tenant's external systems, if any)
integrations:
  # These are mostly informational in MVP;
  # real integration endpoints are tenant data plane (Wazuh/TheHive/Cortex in-ns).
  externalCortexUrl: ""        # if tenant wants to use an external Cortex instead of the in-ns one

# Data plane component sizing
components:
  wazuh:
    manager:
      resources:
        requests: { cpu: 200m, memory: 512Mi }
        limits:   { cpu: 500m, memory: 1Gi }
      persistence:
        size: 20Gi
    indexer:
      resources:
        requests: { cpu: 500m, memory: 2Gi }
        limits:   { cpu: 2,    memory: 4Gi }
      persistence:
        size: 50Gi
      jvm:
        heap: 1g
    dashboard:
      enabled: true
      resources:
        requests: { cpu: 100m, memory: 512Mi }
        limits:   { cpu: 500m, memory: 1Gi }
  thehive:
    resources:
      requests: { cpu: 300m, memory: 1Gi }
      limits:   { cpu: 1,    memory: 2Gi }
    cassandra:
      resources:
        requests: { cpu: 500m, memory: 2Gi }
        limits:   { cpu: 1.5,  memory: 4Gi }
      persistence:
        size: 30Gi
  cortex:
    resources:
      requests: { cpu: 200m, memory: 768Mi }
      limits:   { cpu: 800m, memory: 1.5Gi }
    elasticsearch:
      resources:
        requests: { cpu: 300m, memory: 1Gi }
        limits:   { cpu: 1,    memory: 2Gi }
      persistence:
        size: 20Gi
    analyzers: []              # allowlist; empty = safe defaults
  misp:
    enabled: false             # a future release

# Tenant namespace policies
networkPolicies:
  enabled: true
  # LLM endpoint allowlist (mirrors llm.baseUrl hostname for Cilium FQDN policy)
  allowedLlmHosts:
    - api.openai.com

# Resource quota & limits (from sizing)
resourceQuota:
  requests:
    cpu: "3"
    memory: 8Gi
  limits:
    cpu: "7"
    memory: 16Gi
  persistentVolumeClaims: "10"
  pods: "50"

# Wazuh agent ingress
wazuhIngress:
  # mode selects the Service variant the chart renders for 1514/1515:
  #   loadbalancer = type: LoadBalancer (per-tenant LB IP via cloud LB
  #                  controller or MetalLB; the default and recommended)
  #   edge-haproxy = type: ClusterIP; an in-cluster HAProxy Deployment
  #                  in soctalk-system fronts every tenant on a single
  #                  edge IP with per-tenant (1514, 1515) port pairs
  mode: loadbalancer            # loadbalancer | edge-haproxy
  hostname: acme.soc.mssp.example.com
  # Only consulted in edge-haproxy mode; SocTalk picks the pair and
  # writes it back to the tenant lifecycle record.
  edgePorts: { events: 15140, enrollment: 15141 }
  tls:
    issuerRef: letsencrypt-prod  # cert-manager (for the 1515 channel)
    secretName: wazuh-tls

# Adapter
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    tag: v1.0.0
  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits:   { cpu: 200m, memory: 256Mi }
  tokenSecretRef:
    name: adapter-token
    key: token

# Labels applied to the tenant namespace
namespaceLabels:
  tenant: "true"
  managed-by: soctalk
  mssp-id: <uuid>
  install-id: <uuid>
  tenant-id: <uuid>
```

## 兼容性矩阵

SocTalk 维护一份兼容性矩阵，说明哪些 `soctalk-tenant` chart 版本受哪个 `soctalk-system` 版本支持。尝试应用超出范围的组合将被拒绝。

存储于 SocTalk 数据库中：

```sql
CREATE TABLE chart_compatibility (
  soctalk_system_version text NOT NULL,
  tenant_chart_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('supported','deprecated','blocked')),
  notes text,
  PRIMARY KEY (soctalk_system_version, tenant_chart_version)
);
```

在构建时由仓库中的一份 YAML 规格填充：

```yaml
# compatibility.yaml
- system: v1.0.0
  tenant:
    - version: v1.0.0
      status: supported
- system: v1.0.1
  tenant:
    - version: v1.0.0
      status: supported
    - version: v1.0.1
      status: supported
- system: v1.1.0
  tenant:
    - version: v1.0.0
      status: deprecated
      notes: "v1.0.x agents still work but upgrade recommended for FQDN egress changes"
    - version: v1.0.1
      status: supported
    - version: v1.1.0
      status: supported
```

强制执行：SocTalk 控制器对 blocked 组合拒绝执行 `helm upgrade`；对 deprecated 组合发出告警但允许执行；对 supported 组合则正常执行。

## 版本固定策略

### SocTalk 编写的镜像

在 `soctalk-tenant/values.yaml` 中按 digest 固定：
```yaml
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    digest: sha256:abc123...
```

### 上游 OSS chart 子 chart（Wazuh / TheHive / Cortex）

以目录形式内置（vendored）于 `charts/soctalk-tenant/charts/` 下，而非在安装时拉取。`Chart.yaml` 将它们列为本地依赖：

```yaml
dependencies:
  - name: wazuh
    version: "0.3.2-soctalk-v1"
    repository: "file://./charts/wazuh"
  - name: thehive
    version: "5.2.0-soctalk-v1"
    repository: "file://./charts/thehive"
  - name: cortex
    version: "3.1.8-soctalk-v1"
    repository: "file://./charts/cortex"
```

内置（vendoring）的原因（源自 chart-audit）：
- 无需依赖上游接纳即可应用 SocTalk 补丁。
- 为供应链证明提供稳定哈希（未来发行版的 cosign）。
- 可复现的构建。

## 渲染 → 应用流程

当 `POST /api/mssp/tenants` 到达时，控制器侧的流程如下：

```
1. Validate payload against tenant config JSON Schema.
2. Generate secrets (secret-placement §5): wazuh-bootstrap pw, thehive admin, cortex admin,
   cassandra pw, wazuh authd secret.
3. Write K8s Secrets in soctalk-system (per-tenant LLM, integration creds).
4. Write K8s Secrets in (to-be-created) tenant-<slug>: deferred until ns exists,
   deferred until step 6.
5. Insert Tenant row + TenantSecret references (state=pending).
6. Use SocTalk K8s ServiceAccount:
   a. Create Namespace tenant-<slug> with required labels.
   b. Create per-ns bootstrap Secrets (wazuh-bootstrap, thehive admin, etc.).
   c. helm install soctalk-tenant -n tenant-<slug> --values <rendered-values.yaml>
7. Transition state to provisioning.
8. Wait for all Helm-managed resources to be Ready (timeout 15 min pilot-prod, 30 min small-dev).
9. On adapter heartbeat arriving, transition state to active.
10. Emit TenantLifecycleEvent.
```

任一步骤失败时：
- 幂等重试：控制器记住哪一步已完成（经由 `TenantLifecycleEvent`）。
- 若 `helm install` 失败，通过 `helm uninstall` + `kubectl delete ns` 回滚。
- 租户状态保持 `pending` 并附带错误详情；MSSP 操作员可从 UI 重试。

当 `POST /api/mssp/tenants/:id:upgrade` 到达时（未来发行版的 API；运行手册）：
```
1. Check compatibility matrix.
2. helm upgrade soctalk-tenant -n tenant-<slug> --values <new-values.yaml>
3. Wait for rollout; on failure, helm rollback.
4. Emit TenantLifecycleEvent.
```

当 `POST /api/mssp/tenants/:id:decommission` 到达时：
```
1. Mark tenant decommissioning; grace period starts.
2. Document how to retrieve tenant data before teardown (backup/restore runbook).
3. After grace period: helm uninstall, kubectl delete ns.
4. Soft-delete Tenant row with deleted_at timestamp.
5. Retention window: keep row in DB for compliance period.
6. Hard delete after retention.
```

## Chart 发布

### 分发

- **（最小方案）**：作为 OCI 制品推送至 `ghcr.io/soctalk/charts/soctalk-system` 与 `/charts/soctalk-tenant`：公开、无需认证即可拉取。
- **未来发行版**：cosign 签名 + 附带 SBOM。

安装指南使用：
```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
    --version v1.0.0 \
    --namespace soctalk-system --create-namespace \
    -f values.yaml
```

### 版本节奏

- 任何 API 变更、schema 变更或功能新增都会触发 `soctalk-system` 版本递增。
- 任何数据平面子 chart 升级或租户模板变更都会触发 `soctalk-tenant` 版本递增。
- 每出现一个新组合，就为兼容性矩阵添加一条记录；发行说明记录受支持的范围。

## 测试该契约

后续发行版及测试：

1. **values.schema.json 校验**：对两个 chart 均使用样例值执行 `helm lint` + `helm template`。
2. **往返渲染**：SocTalk 渲染一份租户配置 → values → 应用 → 从 K8s 读回 → 比对。断言无漂移。
3. **子 chart 固定**：`Chart.lock` + digest 与预期一致；CI 在出现漂移时失败。
4. **兼容性矩阵强制执行**：针对 `controller.can_upgrade(system=X, tenant=Y)` 在 supported / deprecated / blocked 各组合上的单元测试。
5. **打包签名冒烟测试（未来发行版）**：对已发布的 chart 执行 `cosign verify`。
