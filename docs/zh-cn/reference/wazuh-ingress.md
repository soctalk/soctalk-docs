# Wazuh 代理入站与证书注册


## 问题

每个租户都有一个专用的 Wazuh manager，运行在 `tenant-<slug>` 命名空间中。Wazuh 代理安装在客户的端点上（位于 MSSP 集群之外），必须连接到**其所属租户的** Wazuh manager，通过以下端口：

- **1514/TCP**：代理事件流（使用 Wazuh 原生协议在 TLS 上加密）
- **1515/TCP**：代理注册 / `authd`（使用共享密钥进行注册）

约束条件：

- 单个集群上有众多租户 → 无法在单一 NodePort 上暴露 1514/1515（端口冲突）。
- 代理只能连接到*其所属*租户的 manager（而非其他租户的）。
- 客户端点位于未知网络中（企业局域网、云虚拟机、笔记本电脑）：连接方式最常见的是通过公共互联网。
- TLS 证书必须是租户专属的（信任链按客户范围划分）。

## 所选方案：在 MSSP 边缘按租户分配地址

每个租户获得一个专用 DNS 名称（`acme.soc.mssp.example.com`），该名称解析到 MSSP 边缘处的一个按租户划分的 L4 端点。路由到正确的 Wazuh manager 是依据目标地址，而非主机名检查。

**为什么不采用基于 SNI 的 L4 路由。** Wazuh 在 1514/TCP 上的代理协议是一种专有的 AES 加密流，并非标准 TLS，因此连接不携带 SNI ClientHello。基于 `req.ssl_sni` 分支的 L4 代理看不到 SNI，代理流量便会落入默认后端。1515/TCP 注册通道确实会协商 TLS，但路由必须使用与 1514 相同的判别依据，否则两个端口就会分道扬镳。

支持两种按租户分配地址的实现方式：

1. **按租户的 LoadBalancer Service（推荐方案；尚未在 chart 中接入）。** 当前的 `wazuh` 子 chart 仅将 Wazuh manager 的 `Service` 创建为 `ClusterIP` ——本版本中**没有自动的 LoadBalancer 或 DNS 供给**。要让某个租户在今天就能从公共互联网路由到，你必须选择以下方式之一：自行叠加一个外部 LoadBalancer Service（手动 `kubectl apply`）、将每个租户置于一个带有按租户 SNI 或端口映射的边缘 HAProxy / NGINX 之后，或使用下文描述的按租户端口拓扑。云 LB + 按租户 DNS 是文档所述的目标形态；要达到该形态需要 MSSP 侧的手动接线。
2. **在单一边缘 IP 上按租户分配端口（回退方案）。** 当唯一 IP 稀缺时，在一个边缘 IP 上分配一个端口范围，并为每个租户分配 `(1514, 1515)` 偏移量（例如，acme → 15140/15141，beta → 15142/15143）。DNS 使用 `SRV` 记录或代理的 `manager_address:port` 配置来分发。运维上略显别扭，但可以工作。

### 拓扑

```
Customer endpoint (Wazuh agent)
        │
        │ TCP 1514 to acme.soc.mssp.example.com
        │ (Wazuh agent protocol; not standard TLS)
        ▼
DNS resolves to the LoadBalancer IP for tenant-acme
        │
        ▼
┌───────────────────────────────────┐
│ MSSP cluster ingress for          │
│ tenant-acme/wazuh-manager         │
│ (cloud LB IP or MetalLB-assigned) │
└─────────────┬──────────────────────┘
              │ cluster-internal forward
              ▼
  tenant-acme namespace
  ┌─────────────────┐
  │ wazuh-manager   │
  │ Service: 1514   │
  │ Pod with        │
  │ tenant-specific │
  │ TLS cert (1515) │
  └─────────────────┘
```

### DNS

按租户的 `A`/`AAAA` 记录：`<slug>.soc.mssp.example.com → <tenant LB IP>` 是目标设计。**在 V1 中，SocTalk 不会发出 DNS 记录** —— 一旦按租户的 LB 通过带外方式供给完成，运维人员需手动管理 DNS（external-dns / 提供商控制台）。由 SocTalk 驱动的 DNS 发出路径（external-dns 注解或直接与提供商集成）已列入路线图。

通配符 DNS 对 LoadBalancer 方案不起作用，因为每个租户都有自己的 IP。它只在回退（按租户端口）拓扑下才有效，此时所有名称都解析到同一个边缘 IP。

### TLS 证书

每个租户获得一份 SAN 覆盖 `<slug>.soc.mssp.example.com` 的证书。可选方案：

- **通过 cert-manager + Let's Encrypt 签发按租户证书**（推荐用于 MVP）：为每个租户创建一个 cert-manager `Certificate` CR，由 DNS-01 或 HTTP-01 `ClusterIssuer` 签发：证书作为 `Secret/wazuh-tls` 存储在 `tenant-<slug>` 命名空间中：自动续期。
- **`*.soc.mssp.example.com` 的通配符证书**：一份证书覆盖所有租户。更简单，但意味着在 MSSP 侧代理故障期间，任何租户的 Wazuh manager 都可以向任何租户的代理出示该证书：对本版本而言是可接受的风险，因为路由才是真正的强制手段。
- **MSSP 提供的内部 CA**：对于运行自有 PKI 的 MSSP，cert-manager 可以从一个由 MSSP CA 支撑的集群内 `Issuer` 签发证书。

安装指南对这三种方案均有说明；试点默认采用 Let's Encrypt 按租户证书。

### LoadBalancer 供给

MSSP 运行以下之一：

| 环境 | LoadBalancer 来源 |
|---|---|
| 托管云（EKS、GKE、AKS，……） | 云的负载均衡器控制器为每个 `LoadBalancer` 类型的 `Service` 分配一个公网 IP。 |
| 裸金属或本地部署 | 带有地址池的 MetalLB（L2 或 BGP 模式），或 kube-vip。 |
| 带端口映射的单 IP 边缘 | 运行一个外部 L4 代理（HAProxy、Envoy、nginx-stream），将 `(IP, port)` 对转发到租户 `Service`。仅在回退的按端口拓扑下使用此方式。 |

目标设计是让 `soctalk-tenant` chart 的 `Service` 带有注解，以便云控制器和 MetalLB 可以应用池/IP 类别选择（例如 `metallb.universe.tf/address-pool: wazuh-agents`），并由 SocTalk 控制器记录生成的 LB IP 并写入按租户的 DNS 记录。**在 V1 中这两者都未接入** —— Wazuh manager 的 Service 仅为 `ClusterIP`，控制器也不会轮询 LB IP 分配情况。

如果你必须使用单一边缘 IP（回退方案），一份参考的 HAProxy 映射如下所示：

```
# Per-port routing — each tenant has its own 1514/1515 pair at the edge.
frontend wazuh-15140
    mode tcp
    bind *:15140
    default_backend tenant-acme-events
frontend wazuh-15141
    mode tcp
    bind *:15141
    default_backend tenant-acme-enroll
frontend wazuh-15142
    mode tcp
    bind *:15142
    default_backend tenant-beta-events

backend tenant-acme-events
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1514
backend tenant-acme-enroll
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1515
backend tenant-beta-events
    mode tcp
    server wazuh wazuh-manager.tenant-beta.svc.cluster.local:1514
```

不要对 Wazuh 1514 基于 `req.ssl_sni` 分支。Wazuh 的代理协议并非标准 TLS，在该端口上从不产生 ClientHello。SNI 仅在 1515（注册）上可用，而这并不够 —— 事件流仍然需要一个可用的判别依据。

## 代理注册流程

Wazuh 在 1515/TCP 上的 `authd` 注册需要一个共享密钥。每个租户都有自己的 `authd` 密钥，存储在租户命名空间中的 `Secret/wazuh-<slug>-wazuh-creds`（键：`AUTHD_PASS`）里。注册流程：

1. **MSSP 运维人员**接入一个新客户。SocTalk 在租户供给时生成 `authd` 共享密钥。
2. **MSSP 运维人员**向客户端点管理员提供：
   - 租户的 Wazuh manager 主机名（`acme.soc.mssp.example.com`）
   - 端口（1514 事件、1515 注册）
   - `authd` 共享密钥（通过安全通道：密钥管理平台、加密邮件，或 MSSP 使用的任何方式）
   - Wazuh 代理安装程序（标准上游软件包）
3. **客户端点管理员**使用该主机名安装 Wazuh 代理并进行注册：
   ```bash
   /var/ossec/bin/agent-auth \
       -m acme.soc.mssp.example.com \
       -P "<authd-shared-secret>"
   ```
4. 代理向租户的 manager 注册，接收其自己的按代理证书。
5. 后续在 1514 上的连接为按代理 mTLS。

1515 上的路由使用与 1514 相同的按租户地址（LB IP 或边缘端口）。`authd` 共享密钥按租户划分：使用 `acme` 密钥的代理只能向 `acme` 的 manager 注册 —— 由地址寻址加以强制，且密钥由 manager 验证。

## 防火墙 / 网络要求

MSSP 侧：
- 用于边缘代理的公网 IP（一个 IP，或对于跨地理分布的 MSSP 区域按区域分配的 IP）。
- 边缘代理允许来自 0.0.0.0/0 的入站 1514/TCP、1515/TCP（如果 MSSP 更倾向，也可用客户专属的 CIDR）。
- 集群内部防火墙（NodePort 范围或内部 CIDR）允许边缘代理 → 租户命名空间的 Wazuh manager。

客户侧：
- 代理允许出站 1514/1515/TCP 到 MSSP 的边缘主机名。
- 无需从 MSSP 到客户端点的入站（Wazuh 是无拉取模式的：事件由代理发起）。

## 证书吊销 / 代理移除

> **UI 状态：**下文描述的按租户 Agents 标签页尚在规划中。在它上线之前，请使用本节末尾的变通方法。

要吊销某个特定代理（规划中的 UX）：
1. MSSP 运维人员在 MSSP UI 中打开租户 → Agents 标签页 → 吊销。
2. SocTalk 调用 Wazuh manager API 移除该代理的注册。
3. 客户端点管理员卸载该代理（可选，属于清理工作）。

**目前**，请直接从嵌入式 Wazuh 仪表板（租户列表 → **Open SOC** → Agents）或通过 Wazuh manager API 进行吊销：

```bash
kubectl -n tenant-<slug> exec deploy/wazuh-manager -- \
  /var/ossec/bin/manage_agents -r <agent-id>
```

要吊销某租户的所有代理（例如客户退出时）：
1. 轮换租户的 `authd` 共享密钥（新代理需要重新注册）。
2. 通过 Wazuh API 删除所有现有代理注册。
3. 租户下线最终会拆除 manager。

## 备选连接方案（已有文档，但未构建）

### 客户自管的 VPN / 隧道

如果客户的网络策略不允许代理通过公共互联网发送遥测数据：
- 客户向 MSSP 的专用网络供给一条 WireGuard/IPsec 隧道。
- MSSP 将隧道流量路由到同一个边缘代理（或直接通过内部地址路由到集群）。
- 代理配置指向一个内部主机名。

本版本工具中未实现；作为面向有此需求的 MSSP 的一种搭建方案，以文档形式提供。

### Tailscale / 覆盖网络

与 6.1 类似；MSSP 和客户加入同一个 Tailscale 网络，代理直接连接 `acme.soc.mssp.ts.net`。适合小型客户；已有文档。

### 按区域的 MSSP 边缘

对于存在地理分隔（EU、US、APAC）的 MSSP，可在不同区域运行多个边缘代理。每个租户被分配到离它最近的区域，DNS 也反映这一点（`acme.soc.eu.mssp.example.com`、`acme.soc.us.mssp.example.com`）。该设计支持这一点，因为边缘代理到租户命名空间的路由只是一次集群内部的 DNS 查找。自动化的多区域分发已列入路线图。

## 运行手册：接入客户的第一个代理

> **UI 状态：**租户详情页上专用的“Agent Onboarding”面板已在规划中，但尚未进入当前构建。下面的运行手册描述的是目标 UX；其下的变通方法是当前的路径。

**规划中的 UX：**

1. MSSP 运维人员在 [MSSP UI](/zh-cn/mssp-ui) 中创建租户 → SocTalk 供给技术栈，生成 `authd` 密钥。
2. MSSP 运维人员导航到租户详情页 → “Agent Onboarding”部分。
3. 该部分显示：
   - 租户主机名：`acme.soc.mssp.example.com`
   - 端口：1514/TCP（事件）、1515/TCP（注册）
   - `authd` 共享密钥（已遮蔽；复制到剪贴板 + 一次性显示）
   - 示例 `agent-auth` 命令
   - 防火墙要求
4. MSSP 运维人员复制到安全通道，与客户端点管理员共享。
5. 客户端点管理员安装 + 注册。
6. MSSP 运维人员观察租户详情页 → Agents 标签页，在约 30 秒内看到代理出现。

**当前变通方法：**

1. 从 [MSSP UI](/zh-cn/mssp-ui) → Tenants → **+ New Tenant** 创建租户。
2. 一旦生命周期事件显示 `workloads_ready`，从 Kubernetes 中获取 `authd` 共享密钥：
   ```bash
   kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
     -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
   ```
3. 根据安装的通配符模式（`<slug>.soc.<mssp-domain>`）推算出租户的 Wazuh manager 主机名。
4. 通过安全通道与客户端点管理员共享两者；他们按上文所示运行 `agent-auth`。
5. 确认代理出现在嵌入式 Wazuh 仪表板中（租户 → **Open SOC** → Agents）。

## 测试（发布前 + 试点验证）

发布前验证：
- 按租户的 `Service` 模板对 `tenant.wazuhIngress.mode` 的两种取值（`loadbalancer` 和 `edge-haproxy`）都能正确渲染。
- cert-manager 为代理注册通道（1515）签发按租户证书。
- 在 `k3d` 中进行端到端测试，使用两个租户，MetalLB 提供两个 LB IP（`loadbalancer` 模式）：对每个租户，从一个主机 pod 运行 `agent-auth -m <lb-ip> -P <secret>`，确认代理出现在该租户的 Wazuh indexer 中而非另一个。
- 在 `edge-haproxy` 模式下进行相同的端到端测试：HAProxy 为每个租户渲染一个 `(IP, port-pair)`，代理使用 `-m <edge-ip> -p <tenant-port>` 注册，事件流落入正确的 indexer。
- 负向测试：一个指向租户 A 地址但使用租户 B 的 `authd` 密钥的代理会被 manager 拒绝。

试点验证（后续版本）：
- 真实客户端点通过公共互联网干净地完成注册。
- 跨租户探测：用 `beta` 的 `authd` 密钥针对 `beta` 的地址注册一个 `acme` 代理 —— 预期被拒绝。反之亦然。两者都失败。

在这些检查中都没有 SNI 步骤：Wazuh 在 1514 上的代理协议不会产生 ClientHello，因此任何“覆盖 SNI”的测试都是在演练一条生产入站不会走的路由路径。请改为验证地址/端口判别依据。
