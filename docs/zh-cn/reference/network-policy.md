# CNI + NetworkPolicy 设计

> **V1 部署说明。** 下方的 CiliumNetworkPolicy 模板描述的是东西向隔离以及绑定 FQDN 的、面向各租户 LLM 的出站流量的**目标架构**。当前的 V1 chart 渲染的是更简单的策略：为 `soctalk-system-api` Deployment 提供宽松的出站策略（编排器与该 Pod 同置），并在每个 `tenant-<slug>` 命名空间中提供一个 `runs-worker-egress` 策略，允许向 LLM 提供方发起宽泛的 TCP/443 出站流量（没有按租户划分的 FQDN 允许列表）。在已渲染的策略中，从 `ingress-system` 命名空间到 Wazuh 的 1514/1515 入站流量**是**被允许的。请将本页其余内容作为设计目标来阅读；关于当前实际交付的内容，请查阅 [`charts/soctalk-system/templates/50-networkpolicy.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/50-networkpolicy.yaml)。

## 决策：以 Cilium 作为主 CNI

Cilium 是 SocTalk 支持的 CNI。理由如下：

1. **NetworkPolicy 强制执行**。K3s 默认的 Flannel 不会强制执行 `NetworkPolicy`：没有强制执行，网络层的租户隔离就只是一个没有支撑的说法。Cilium 开箱即用地强制执行标准 `NetworkPolicy`。
2. **FQDN 出站策略**：标准 `NetworkPolicy` 只允许基于 IP/CIDR 的出站。BYO LLM 端点是主机名（`api.openai.com`、位于具有动态 IP 的 CDN 之后的客户自托管端点）。Cilium 的 `CiliumNetworkPolicy` 通过 `toFQDNs` 匹配主机名。这是在不引入正向代理的情况下，在网络层强制执行按租户划分的 LLM 出站流量的唯一方式。
3. **基于 eBPF 的强制执行**：更高性能、更低延迟、没有 iptables 膨胀。
4. **可观测性（Hubble）**：流级别的可见性；在调试租户隔离时具有运维价值。
5. **成熟度**。CNCF 毕业项目，在生产环境中广泛部署。

### 备选安装模式：Calico + 出站代理

对于因运维要求必须运行 Calico 的 MSSP，可以在做出以下调整后使用：
- 使用标准 K8s `NetworkPolicy`（由 Calico 强制执行）来处理所有东西向流量和粗粒度出站流量。
- 在 `soctalk-system` 命名空间中部署一个执行基于 FQDN 的允许列表的**出站代理**（Envoy、HAProxy 或 Squid）。
- `NetworkPolicy` 限制租户 Pod 和 SocTalk 编排器，对于外部（集群外）目的地**只能通过该代理**出站。

该备选方案有文档记录，但不是推荐路径。它增加了一个组件、一个故障点，以及一个跨租户共享的资源（代理）。如果某个 MSSP 选择该方案，SocTalk 会在其入驻之前，在其集群上对该方案进行端到端验证。

## 安装要求

Cilium 是**集群前置条件**（参见 `/reference/chart-audit` §4）。`soctalk-system` chart 不会安装 Cilium。安装指南的前置条件章节规定：

```bash
# K3s without flannel, without default NP, and without kube-proxy
# (Cilium replaces it; running both rewrites Service translation twice
# and breaks routing).
curl -sfL https://get.k3s.io | sh -s - server \
    --flannel-backend=none \
    --disable-network-policy \
    --disable-kube-proxy \
    --disable=traefik  # if using a different ingress controller

# Install Cilium:
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium --version 1.15.x \
    --namespace kube-system \
    --set operator.replicas=1 \
    --set ipam.mode=kubernetes \
    --set kubeProxyReplacement=true \
    --set k8sServiceHost=<node-ip> \
    --set k8sServicePort=6443 \
    --set hubble.relay.enabled=true \
    --set hubble.ui.enabled=true
```

`soctalk-system` chart 的 pre-install 钩子会验证 Cilium 处于活动状态，如果不是则快速失败。

## NetworkPolicy 架构

在 SocTalk 管理的每个命名空间上采用默认拒绝（default-deny）基线。为每一条合法流显式添加允许规则。

### 必须放通的流

| 源 | 目的地 | 原因 |
|---|---|---|
| `soctalk-system` → `tenant-<slug>`（例如 Wazuh :55000、TheHive :9000、Cortex :9001） | 东西向 | SocTalk 编排器的 MCP 子进程调用租户数据平面 API |
| `tenant-<slug>`（适配器）→ `soctalk-system`（SocTalk API :8000） | 东西向 | 适配器上报健康状态并拉取配置 |
| `soctalk-system` → 外部的、按租户划分的 LLM FQDN | 出站 | 分诊期间的 LLM 调用（在 worker 上下文中使用租户的 LLM 密钥） |
| 外部 Wazuh 代理 → `tenant-<slug>` Wazuh manager（:1514、:1515） | 入站 | 客户端点遥测数据 |
| MSSP 用户 → `soctalk-system`（经由 Ingress :443） | 入站 | MSSP UI + 客户 UI 访问 |
| `soctalk-system` Postgres ↔ `soctalk-system`（自身） | 命名空间内 | SocTalk 组件与数据库通信 |
| `soctalk-system` → 外部 OIDC 提供方 | 出站 | Ingress 级别的 OIDC；流量经由 ingress-system 命名空间 |
| 租户 Pod 命名空间内通信（manager↔indexer、TheHive↔Cassandra 等） | 命名空间内 | 正常的技术栈运行 |

### 必须阻断的流（由默认拒绝捕获）

- `tenant-acme` → `tenant-beta`（任意端口、任意协议）
- `tenant-<slug>` → 互联网（除其配置的 LLM FQDN 之外）
- `tenant-<slug>` → `soctalk-system` Postgres 的直接访问（适配器使用 SocTalk API，而非数据库）
- 任意命名空间 → `kube-system`（标准解析器查询之外）
- 从任意被攻陷 Pod 发起的跨集群横向移动

## NetworkPolicy 模板

### `soctalk-system` 命名空间策略

由 `soctalk-system` chart 管理。共四条策略：

**4.1.1 默认拒绝所有入站/出站**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: soctalk-system }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.1.2 允许 SocTalk API 接收来自 Ingress 控制器 + 适配器的流量；允许出站到 Postgres + DNS**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-ingress-allow, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: ingress-system }
      ports: [{ port: 8000, protocol: TCP }]
    - from:
        - namespaceSelector:
            matchLabels: { managed-by: soctalk, tenant: "true" }
      ports: [{ port: 8000, protocol: TCP }]
---
# Egress: API needs Postgres + cluster DNS. Without this rule the
# default-deny policy above blocks API → DB and the API CrashLoops.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-egress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      ports: [{ port: 5432, protocol: TCP }]
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
---
# Egress: controller pod creates tenant namespaces, Secrets, and Helm
# releases via the Kubernetes API. Without this rule, default-deny
# blocks the controller → kube-apiserver and tenant provisioning hangs.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: controller-egress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-controller } }
  policyTypes: [Egress]
  egress:
    # Cluster DNS
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
    # kube-apiserver. The ClusterIP of `kubernetes.default.svc` is the
    # apiserver VIP; use CIDR egress to that VIP plus the apiserver
    # node IPs (the Service IP is rewritten to a node IP by kube-proxy
    # or its Cilium replacement).
    - to:
        - ipBlock: { cidr: <apiserver-cidr-or-service-ip>/32 }
      ports:
        - { port: 443, protocol: TCP }
        - { port: 6443, protocol: TCP }
    # Postgres for state writes.
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      ports: [{ port: 5432, protocol: TCP }]
```

> 如果控制器逻辑运行在 API Pod 内部而非作为独立的 Deployment，则将 kube-apiserver 规则并入上面的 `api-egress` 策略，而不要使用第二条策略。

> apiserver 地址因集群而异。在托管集群上，使用 kubelet 可见的 Service IP（`kubectl get svc kubernetes -n default`）以及底层的控制平面端点。借助 Cilium，另一种做法是在 `CiliumNetworkPolicy` 中使用 `toEntities: [kube-apiserver]`，它会动态解析 apiserver 身份。

**4.1.3 允许编排器访问租户命名空间 + DNS + LLM FQDN**

这是一条 `CiliumNetworkPolicy`，因为原生 NP 无法表达 FQDN 出站：

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: { name: orchestrator-egress, namespace: soctalk-system }
spec:
  endpointSelector:
    matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
  egress:
    # DNS
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace": kube-system
            "k8s:k8s-app": kube-dns
      toPorts:
        - ports: [{ port: "53", protocol: UDP }]
          rules:
            dns:
              - matchPattern: "*"
    # Tenant data plane APIs (any tenant-* namespace, specific ports)
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace-label:managed-by": soctalk
            "k8s:io.kubernetes.pod.namespace-label:tenant": "true"
      toPorts:
        - ports:
            - { port: "55000", protocol: TCP }  # Wazuh manager API
            - { port: "9200",  protocol: TCP }  # Wazuh indexer
            - { port: "9000",  protocol: TCP }  # TheHive
            - { port: "9001",  protocol: TCP }  # Cortex
    # Postgres (intra-ns)
    - toEndpoints:
        - matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      toPorts: [{ ports: [{ port: "5432", protocol: TCP }] }]
    # LLM endpoints. FQDN allow-list is composed dynamically
    # (see §4.2: one CiliumNetworkPolicy per tenant maintained by SocTalk controller)
```

**4.1.4 仅允许 Postgres 命名空间内访问**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: postgres-ingress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-postgres } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: {}  # any pod in soctalk-system
      ports: [{ port: 5432, protocol: TCP }]
```

### 按租户划分的 LLM FQDN 出站（动态）

SocTalk 控制器为每个租户渲染一条 `CiliumNetworkPolicy`，允许编排器 → 该租户的 LLM FQDN。当某个租户的 LLM 配置发生变化时，该策略会被更新；当某个租户下线时，该策略会被删除。

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: orchestrator-llm-egress-tenant-acme
  namespace: soctalk-system
  labels:
    managed-by: soctalk
    tenant-id: "<acme-uuid>"
spec:
  endpointSelector:
    matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
  egress:
    - toFQDNs:
        - matchName: "api.openai.com"  # or tenant's configured endpoint
      toPorts: [{ ports: [{ port: "443", protocol: TCP }] }]
```

Cilium 会合并所有选中编排器 Pod 的策略，因此每个租户所允许 FQDN 的并集在网络层都可从这些 Pod 访问。**在请求级别不存在按租户划分的 FQDN 隔离**——那是应用层的职责（按租户划分的 LLM 配置、以租户为作用域的缓存键）。网络策略缩小了爆炸半径（作为整体的 LLM 主机名允许列表，而非任意出站），但它本身并不约束编排器可以与哪个租户通信。

### 租户命名空间策略

由 `soctalk-tenant` chart 为每个租户渲染。每个命名空间四条策略：

**4.3.1 默认拒绝**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.3.2 允许命名空间内 + 集群 DNS**

Wazuh、TheHive 和 Cortex 通过 Kubernetes Service DNS 名称相互解析，因此每个数据平面 Pod 都需要向 `kube-dns` 出站。仅有命名空间内允许是不够的——没有 kube-dns 规则，技术栈将无法启动。

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: intra-ns-allow, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from: [{ podSelector: {} }]
  egress:
    - to: [{ podSelector: {} }]
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
```

**4.3.3 允许来自 soctalk-system 的入站（编排器 MCP 调用）**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-from-soctalk-system, namespace: tenant-acme }
spec:
  podSelector:
    matchExpressions:
      - { key: app.kubernetes.io/name, operator: In,
          values: [wazuh-manager, wazuh-indexer, thehive, cortex] }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
      ports:
        - { port: 55000, protocol: TCP }
        - { port: 9200,  protocol: TCP }
        - { port: 9000,  protocol: TCP }
        - { port: 9001,  protocol: TCP }
```

**4.3.4 允许适配器出站到 soctalk-system API**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: adapter-egress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-adapter } }
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
      ports: [{ port: 8000, protocol: TCP }]
    # DNS
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ port: 53, protocol: UDP }]
```

**4.3.5 允许 Wazuh 代理入站到租户 manager**

代理遥测数据在 1514/1515 上通过 [Wazuh Ingress](/zh-cn/reference/wazuh-ingress) 中记录的路径到达。参考部署是一个按租户划分的 LoadBalancer Service（云 LB 或 MetalLB），并以 `soctalk-system` 中一个集群内的 HAProxy Deployment 作为单 IP 回退方案。NetworkPolicy 必须放通安装实际运行的那条路径——`ingress-system` 对于二者而言**都不是**正确的源，因此不要在未经编辑的情况下直接使用 chart 自带的模板。

根据安装情况选择其中一个代码块：

```yaml
# Cloud-LB or MetalLB path. NetworkPolicy evaluates the packet source
# as either the original customer-endpoint IP or (when the service path
# SNATs) the node IP — NOT the LoadBalancer pool CIDR. So allowing the
# LB pool here does nothing useful.
#
# Use one of:
#   * the set of customer-network CIDRs the MSSP serves agents from
#     (recommended; tightens blast radius and is the policy's only
#     meaningful enforcement at this layer);
#   * the cluster node CIDR plus 0.0.0.0/0 if the service path SNATs
#     to node IPs and you accept open ingress on 1514/1515 (the LB
#     itself / cloud security groups are then the real control).
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: wazuh-agent-ingress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: wazuh-manager } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - ipBlock: { cidr: <customer-network-cidr> }
        # repeat for each customer the tenant serves; or 0.0.0.0/0 if
        # the LB / cloud SG handles source filtering.
      ports:
        - { port: 1514, protocol: TCP }
        - { port: 1515, protocol: TCP }
```

当 Service 使用 `externalTrafficPolicy: Local` 时，kube-proxy 和 Cilium 会保留客户端源 IP，因此上面的客户 CIDR 会被原样识别，策略才具有实际意义。在默认（`Cluster`）策略下，源 IP 的可见性取决于 LB 与 CNI 的组合；在该模式下，应将本 NetworkPolicy 视为纵深防御，并依赖 LB/云安全组作为主要的准入关卡。

```yaml
# In-cluster HAProxy fallback in soctalk-system. Source is the
# HAProxy pod in the SocTalk control plane, not the ingress
# controller namespace.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: wazuh-agent-ingress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: wazuh-manager } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector:
            matchLabels: { app.kubernetes.io/name: wazuh-edge-haproxy }
      ports:
        - { port: 1514, protocol: TCP }
        - { port: 1515, protocol: TCP }
```

`soctalk-tenant` chart 会渲染与 `tenant.wazuhIngress.mode`（`loadbalancer` 或 `edge-haproxy`）相匹配的那个变体。

## DNS 注意事项

- 必须在启用 `hubble` 的情况下配置 Cilium，才能观测 DNS 查询（对调试 FQDN 策略匹配很有用）。
- `toFQDNs` 策略的工作方式是拦截 DNS 响应，并将解析出的 IP 添加到临时规则中。DNS 响应的 TTL 决定策略缓存的新鲜度；如果某个 LLM 提供方的 TTL 极短（约 60 秒），则在 IP 轮换时可能偶尔出现短暂的连接失败。缓解措施：可调整 Cilium 的 `dnsProxy` 以获得更长的 `minTTL`：设置为 300 秒。
- 企业 DNS（客户在内部自托管的 LLM）：如果租户的 LLM 端点只能通过内部 DNS 服务器解析，则必须将 Cilium 配置为使用该服务器，或者该租户改用基于 IP 的出站（会失去 FQDN 所表达的意图语义）。

## 可观测性

Hubble（随 Cilium 捆绑）在参考安装中已启用。MSSP 运维团队可以运行 `hubble observe --namespace tenant-acme` 来查看流、强制执行裁决（allow/deny）以及丢包。这是排查租户隔离问题的主要调试工具。

## 测试

后续的一个发布关卡包含一项跨租户网络隔离测试：
1. 部署两个租户（`tenant-a`、`tenant-b`）。
2. 从 `tenant-a` 中的某个 Pod，尝试通过 IP 和 DNS 名称连接 `tenant-b` 的 Wazuh 服务。预期结果为连接被拒绝/超时。
3. 从 `soctalk-system` 中的编排器，在以 `tenant-b` 上下文运行时尝试调用 `tenant-a` 的 LLM FQDN。预期结果为应用层拒绝（无密钥）；由于两个 FQDN 都在允许列表中，策略层可能仍会放通。
4. 从 `soctalk-system` 中一个并非编排器的 Pod，尝试访问 `tenant-a` 的 Wazuh。预期结果为连接被拒绝（只有编排器拥有向租户数据平面端口的出站权限）。

## 已推迟（未来版本）

- **L7 HTTP 策略**：Cilium 支持 L7 HTTP `CiliumNetworkPolicy`（限制到特定路径/方法）。本版本仅为 L4。L7 对未来版本中更细粒度的 MCP 调用限制很有用。
- **基于身份的策略**：本版本仅使用标签；带有 SPIFFE 风格 mTLS 的 Cilium 身份属于未来版本。
- **用于静态源 IP 的出站网关**：如果 MSSP 的最终客户需要在 SocTalk 的 LLM 调用上使用列入白名单的静态源 IP，则由 Cilium Egress Gateway 处理。这属于未来版本。
- **透明加密（WireGuard/IPsec）**：对 Pod 到 Pod 流量进行集群范围的加密。属于未来版本的加固内容。
