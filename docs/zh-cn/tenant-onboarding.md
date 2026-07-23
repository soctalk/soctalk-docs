---
description: "在 SocTalk 中端到端接入一个客户租户：选择配置档、运行创建客户向导、观察预配到达 active、连接客户的端点，并交接访问权限。"
---

# 接入租户

接入会把一个客户变成你控制平面上一套隔离的租户 SOC。每个租户都获得自己的 Kubernetes 命名空间（`tenant-<slug>`），拥有各自的密钥、资源预算，并（对于 `poc` 和 `persistent` 配置档）拥有专属的 Wazuh manager、indexer 和 dashboard。本页走完 MSSP 管理员在 UI 中遵循的完整路径，从第一个决策到客户的分析师能够打开他们的 SOC 的那一刻。

关于概念性总览（规模规划、四项工作、第一周基线），参阅[上线检查清单指南](/zh-cn/guides/wazuh-tenant-onboarding)。关于状态机和配置档内部细节，参阅[租户生命周期](/zh-cn/tenant-lifecycle)。本页是面向操作者的演练。

## 开始之前

- 你的控制平面已安装，且你能以 MSSP 管理员身份登录。如果它尚未启动，请先遵循[生产环境安装](/zh-cn/install)或[演示 VM 快速上手](/zh-cn/quickstart-vm)。
- 你已确定租户的配置档。它在租户的整个生命周期内固定不变，因此在点击 **New tenant** 之前请先阅读下一节。
- 仅对 `provided` 租户，在打开向导之前带外收集客户现有的 Wazuh 连接材料：带 Basic 认证用户和密码的 Indexer URL、带用户和密码的 Manager API URL，以及租户级 LLM 凭据。向导会因缺少这些而阻塞，因此先收集齐全可以避免把表单填一半后搁置。参阅[协调外部 Wazuh 凭据](/zh-cn/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants)。

## 选择配置档

配置档只选择一次并固定不变。之后切换意味着 decommission 后重新接入，因此请慎重选择。

- **`poc`** 用于评估和短期试点。租户 chart 会安装 Wazuh 加一个 linux-ep 模拟器，使用 `local-path` 存储和紧凑的资源预算。如果你未指定配置档，这也是默认值；而 `local-path` 不提供任何持久化保证，因此它对真实客户来说是错误的选择。
- **`persistent`** 用于生产客户 SOC。与 `poc` 相同的含 Wazuh 形态，但按持续负载进行规格设定，使用集群的默认 StorageClass，采用完整的 chart 资源区间，并在已配置处遵循备份钩子。
- **`provided`** 用于已经在运行 Wazuh 的客户（自带 SIEM）。chart 只安装 SocTalk adapter 和 runs-worker；SocTalk 通过网络访问客户的 indexer 和 Manager API。外部连接材料和租户级 LLM 凭据在接入时必填。

每个 `persistent` 租户按大约 6 到 8 GB 内存和约 1.5 vCPU 规划；租户级 Wazuh indexer 通常是瓶颈。容量细节见[规模规划](/zh-cn/reference/sizing)，每个配置档在[租户生命周期](/zh-cn/tenant-lifecycle#profiles)中展开。

## 运行创建客户向导

在 MSSP 仪表盘中，点击左侧栏的 **Tenants**，再点击列表顶部的 **New tenant**。这会打开 **Create Customer** 向导。对于 `poc` 和 `persistent`，它是四步（Identity、Profile、Branding、Review）；对于 `provided`，它是五步，其中会在 Profile 和 Branding 之间出现一个 External SIEM 步骤。

### 第 1 步：Identity

- **Display name**，例如 `Acme Corp`。
- **Slug**：短、小写、用短横线分隔，3 到 32 个字符，按 `[a-z0-9-]+` 校验。该 slug 会成为 `tenant-<slug>` 命名空间，并被代入下游标识符，因此请谨慎选择。在 tailnet 试点中，它必须匹配租户的 Tailscale 标签。
- **Contact email**。

### 第 2 步：Profile

从 `poc`、`persistent` 或 `provided` 中选择一个。同一步骤带有一个 **LLM (advanced)** 展开项，用于覆盖安装时共享的 LLM 提供方、base URL、密钥，以及（可选的）Fast 和 Thinking 模型 ID。对于 `poc` 和 `persistent`，保持折叠即可继承安装默认值。对于 `provided`，LLM 凭据是必填的并会作为该步骤的门槛，因为该配置档没有安装时共享的回退值。

在预配后更改配置档需要停用并重新接入，因此在继续之前请确认你的选择。

### 第 3 步：External SIEM（仅 provided）

除非你选择了 `provided`，否则此步骤隐藏。填写两对端点和凭据：

- **Wazuh Indexer URL**，例如 `https://wazuh.acme.example:9200`，附带用于 Basic 认证的 indexer 用户和密码。
- **Wazuh Manager API URL**，例如 `https://wazuh.acme.example:55000`，附带用于签发 JWT 的 API 用户和密码。

两者都必须能从租户 VM 访问到。控制器会把这些 URL 转换为租户命名空间上的 Cilium FQDN 出站允许列表；适配器绝不会从 MSSP 集群直接访问 Wazuh。在提交之前，先对 manager 凭据做一次健全性检查：

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (a long base64 string)
```

如果返回一个令牌，那么在租户数据平面启动后，租户的聊天工具就能解析。

### 第 4 步（poc 和 persistent 则为第 3 步）：Branding

可选。一个 display name 和一个会显示在租户页头的小型 logo。你可以完全跳过此步骤。

### 最后一步：Review

确认所有内容，然后点击 **Create**。API 返回 `202` 并把你带回租户列表。新租户以 `pending` 开始，并经过 `provisioning` 走向 `active`。

## 观察预配到达 active

打开租户详情页并刷新它，以跟踪 **Lifecycle Events** 表。控制器运行九个有序且幂等的阶段，每个阶段发出一条事件：

1. `preflight_ok`：集群前置条件和命名冲突检查通过。
2. `secrets_minted`：生成每租户密钥（`authd`、JWT 签名、Postgres）。
3. `namespace_ready`：创建带标签、ResourceQuota 和 LimitRange 的 `tenant-<slug>`。
4. `secrets_applied`：将密钥作为 Kubernetes Secret 对象推送到命名空间中。
5. `helm_applied`（租户 chart）：`soctalk-tenant` chart 安装 adapter、runs-worker 和 ingress。作为此步骤的一部分，`tenant_admin` 用户会被自动预配。
6. `helm_applied`（Wazuh chart）：独立的 Wazuh chart 安装 manager、indexer 和 dashboard。事件负载标识出应用了哪个 chart。此阶段对 `provided` 租户不运行。
7. `workloads_ready`：所有数据平面 Pod 报告 Ready。
8. `integration_config_written`：将每租户集成配置（LLM、TheHive URL）写入数据库。
9. `active`：租户转换到 `active`，可以开始使用。

当租户到达 `active` 时，从租户列表使用 **Open SOC** 进入其仪表盘。

如果它停滞，失败的阶段会在事件表中标明：

- **卡在 `pending`**：控制器在阶段 1 之前被重新调度。不允许直接从 `pending` 重试；等待该尝试转换到 `degraded`，然后点击 **Retry Provisioning**。预配将从阶段 1 恢复。
- **处于 `provisioning` 超过 15 分钟**：通常是某个卡住的 Pod（ImagePullBackOff、`Pending` 状态的 PVC，或太小的 ResourceQuota）。参阅[日常运维](/zh-cn/operations#tenant-stuck-in-provisioning)。
- **处于 `degraded`**：某个预配阶段失败了。读取事件行以查看是哪一个，然后 **Retry Provisioning**，这是从 `degraded` 出发的有效转换。更多细节见[租户生命周期](/zh-cn/tenant-lifecycle#recovery-paths)。

## 注册客户的端点

端点注册意味着让客户的机器把数据上报到正确租户的 Wazuh manager。它适用于在自己命名空间内运行 Wazuh 的 `poc` 和 `persistent` 租户。`provided` 租户已经把它的端点发送到客户自有的 Wazuh，因此这里没有需要注册的内容；跳到下一节。

每个租户的 Wazuh manager 监听 1514/TCP（事件）和 1515/TCP（注册）。在本版本中，chart 只会把该 manager 创建为 `ClusterIP` Service：没有自动的 LoadBalancer 或 DNS 预配，因此你需要自行搭建边缘接入（按租户的 LoadBalancer Service、在单一 IP 上按租户分配端口对的边缘 HAProxy，或 mesh-VPN 路径），并管理 DNS 记录。完整的拓扑与防火墙要求见 [Wazuh 代理接入](/zh-cn/reference/wazuh-ingress)。

注册通过 manager 的 `authd` 共享密钥限定到该租户。获取它：

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

通过安全渠道把 manager 主机名、两个端口和该密钥交给客户的端点管理员。对方用以下命令注册每个端点：

```bash
agent-auth -m <tenant-manager-hostname> -P "<authd-secret>"
```

持有某个租户密钥的代理只能注册到该租户的 manager，这正是保持注册隔离的机制。在内嵌的 Wazuh dashboard 中确认代理已到位：Tenants，然后 **Open SOC**，再到 Agents。

如果租户的数据平面反而运行在独立的基础设施上（远程试点模式，即租户 VM 通过 tailnet 加入），那台 VM 会通过 `:issue-agent` cloud-agent 流程向控制平面注册，这与上面的端点注册是两回事。该路径在 [MSSP 试点演练](/zh-cn/mssp-pilot#_4-tenant-side-stand-up-the-data-plane)中有端到端的说明。

## 交接访问权限

`tenant_admin` 用户在阶段 5 期间自动创建，因此租户一到达 `active` 就拥有了一名管理员。要给这名管理员一份可用的凭据，从 MSSP 一侧强制一次密码重置（操作者必须是 `mssp_admin` 或 `platform_admin`）：

```bash
curl -X POST 'https://<mssp-host>/api/mssp/users/<user-id>/password/reset' \
  -b jar -H 'Origin: https://<mssp-host>'
```

响应返回一个标记为 `must_change=true` 的一次性 `temporary_password`，并且此次重置会吊销该用户任何已有的会话。通过端到端加密的渠道（例如共享密码管理器）把该密码连同客户的门户 URL 一起分享，绝不要用未加密的邮件或公开的聊天频道。租户管理员会在首次登录时设置一个新密码。

从那以后租户是自助式的：`tenant_admin` 登录客户门户，打开 **Users**，并预配本组织自己的登录账号（例如为只读干系人分配 `customer_viewer`）。MSSP 员工和租户用户处于一道由能力守卫强制执行的受众边界的两侧，因此租户登录在结构上无法触达跨租户界面。角色和该边界在[用户与角色](/zh-cn/users-and-roles)中有说明。

## 验证

- 租户在租户列表上显示 `active`，且 **Open SOC** 能加载它的仪表盘。
- 对于 `poc` 和 `persistent`，确认已注册的端点出现在 Open SOC 然后 Agents 下，且来自它们的事件落入租户的 Wazuh dashboard。
- 对于 `provided`，确认 `soctalk-adapter` Pod 处于 Ready，然后在 SocTalk 聊天中运行一个基于 Wazuh 的查询（例如，询问某台已知主机的近期告警）。一旦适配器能访问到客户的 External SIEM 端点，它就能解析；如果无法解析，按[协调外部 Wazuh 凭据](/zh-cn/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants)重新检查可达性。

## 参见

- [上线检查清单](/zh-cn/guides/wazuh-tenant-onboarding)：概念性总览与第一周基线。
- [租户生命周期](/zh-cn/tenant-lifecycle)：状态机、配置档、配额和恢复路径。
- [MSSP UI 导览](/zh-cn/mssp-ui#tenants)：租户列表和详情页。
- [MSSP 试点：自行部署](/zh-cn/mssp-pilot)：包含租户侧数据平面的完整、基于 tailnet 的部署。
