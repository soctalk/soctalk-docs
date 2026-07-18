# MSSP 试点：自行部署

::: tip 大多数试点应使用 Launchpad
[**Launchpad**](/zh-cn/launchpad) 通过单条命令自动完成整个部署流程——相同的安装、相同的 charts、相同的 Tailscale 流程——耗时约 15-25 分钟（大部分时间在等待下载，而手动部署约需 2 小时）。**请从这里开始。** 只有当你想理解每一个步骤、正在排查某次 Launchpad 运行的故障，或你的环境无法运行 Launchpad 时（气隙网络、本地部署的 split-horizon DNS、不受支持的底层基础设施，或已有集群），才需要使用这份自行部署指南。
:::

一条面向 MSSP 用其 1-3 家客户评估 SocTalk 的实用路径。两套本地部署环境（一套 MSSP 控制平面，每个租户各一套），通过一条对防火墙友好的网状 VPN 连接。最终状态：一套可用的多租户 SocTalk 安装、能够回答关于每个租户真实 Wazuh 数据问题的 AI SOC 分析师，以及一张可以展示给相关方的截图。

**这不是生产环境安装。** 没有 HA、没有真实 TLS，你的 tailnet 主机名代替了 ingress。当你准备好投入生产时，参阅 [安装](/zh-cn/install)。

**想先单独试用 SocTalk？** 从 [Quickstart VM](/zh-cn/quickstart-vm) 开始：单机、单租户，约 10 分钟。

::: tip 动手时间
| 环节 | 动手时间 | 实际耗时 |
|---|---|---|
| MSSP（一次性） | 约 45 分钟 | 约 60 分钟 |
| 每个租户（其中 1-3 个） | 每个租户约 30 分钟 | 每个租户约 45 分钟 |
| 演示 + 验证 | 约 10 分钟 | 约 10 分钟 |
:::

## 涵盖范围

- 1 个 MSSP 控制平面 + 1-3 个租户
- 两套环境均为**本地部署**，任何可运行 Ubuntu 24.04 的虚拟化平台（vSphere / Proxmox / Hyper-V / KVM / VirtualBox / 裸机）
- [Tailscale](https://tailscale.com) 作为网状 VPN。Headscale、NetBird 或任何 WireGuard 网状网络的用法都相同；下文命令在语法上假定使用 Tailscale。
- MSSP 的 L1 SocTalk 控制平面 + 每个租户上的 L2 SocTalk cloud-agent
- 每个租户**已安装** Wazuh 或**通过 chart 安装** Wazuh；两者均受支持

<!-- screenshot: arch-overview.svg — architecture diagram (MSSP VM left, tenant VMs right, tailnet wrapping both, cloud-agent shown on each tenant, optional dotted-line to existing Wazuh) -->

## 0. 开始之前

先收集以下内容。在接下来的 90 分钟里，这些都会被逐一用到：

- [ ] MSSP 一侧的虚拟化平台 + 管理员登录凭据
- [ ] 每个租户的虚拟化平台 + 管理员登录凭据（每个试点客户一套）
- [ ] 一个 Tailscale 账户（[注册](https://login.tailscale.com/start)；免费套餐足以支撑一次试点）
- [ ] 一个 LLM API 密钥（Anthropic 或 OpenAI）。对于气隙网络或数据主权敏感的场景，参阅 [Ollama 集成](/zh-cn/integrate/ollama)。
- [ ] 每个租户一名联系人（姓名、邮箱、是否已有 Wazuh？是/否）
- [ ] 如果某个租户已有 Wazuh：需要**两**套凭据，一套用于 Wazuh Indexer（`:9200`，Basic 认证），一套用于 Wazuh Manager API（`:55000`，可签发 JWT 的用户）

## 1. 搭建 tailnet

MSSP 控制平面和每个租户都加入同一个 tailnet。tailnet 提供稳定的主机名（这样 cloud-agent 拨号连接的是名称而非 IP）和 ACL（这样租户之间无法互相访问）。

### 1.1 标签

在 Tailscale 管理界面的 **Access Controls** → **Tags** 下，为 MSSP 定义一个标签，为每个租户各定义一个标签：

```json
"tagOwners": {
  "tag:mssp":         ["autogroup:admin"],
  "tag:tenant-acme":  ["autogroup:admin"],
  "tag:tenant-globex":["autogroup:admin"]
}
```

为每个试点租户添加一个标签。标签是 ACL 用来阻止租户互相访问的机制。

### 1.2 ACL

将这段配置粘贴到 **Access Controls** → **Access Controls (JSON)**。调整租户标签列表以匹配你的试点。

```json
"acls": [
  {
    "action": "accept",
    "src":    ["autogroup:admin"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  },
  {
    "action": "accept",
    "src":    ["tag:mssp"],
    "dst":    ["tag:tenant-acme:*", "tag:tenant-globex:*"]
  },
  {
    "action": "accept",
    "src":    ["tag:tenant-acme", "tag:tenant-globex"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  }
]
```

第一条规则让**你的操作员设备**（你的笔记本电脑、tailnet 上任何管理员拥有的未打标签节点）能够访问 MSSP UI。没有它，Tailscale 默认拒绝的策略会拦住你自己的浏览器。第二条规则让 MSSP 能够访问每个租户以进行聊天工具调用（Wazuh API、可观测性）。第三条规则让每个租户的 cloud-agent 能够访问 MSSP 的 HTTPS 端点以注册并流式传输事件。租户之间无法互相访问。

在保存前先在 ACL Preview 窗格中验证。确认 `tag:tenant-acme` 在任何端口上都无法访问 `tag:tenant-globex`。

<!-- screenshot: tailscale-acl-preview.png — ACL preview showing tenant-to-tenant denied, MSSP→tenant + tenant→MSSP allowed -->

### 1.3 认证密钥

在 **Settings** → **Keys** 下，生成：

- 一个打上 `tag:mssp` 标签、用于 MSSP 控制平面的**可复用**认证密钥。
- 每个租户各一个打上 `tag:tenant-<slug>` 标签的**临时**认证密钥。将 TTL 设为你的试点时长（例如 90 天）。

将这些密钥记在安全的地方；当每台 VM 加入 tailnet 时你需要粘贴它们。

### 1.4 网络要求

Tailscale 只需要每个节点的出站流量（从不需要入站）：

- **直连路径**（当两个对端都能进行 NAT 穿透时）：通过随机高位端口上的 UDP 承载 WireGuard。大多数网络本来就允许这种流量。
- **DERP 回退**（当 NAT 穿透失败时，例如严格的防火墙或双重 NAT）：到 Tailscale DERP 中继的 TCP/443。大多数试点使用这条路径，因为它看起来就像普通的 HTTPS 流量。

如果你的防火墙允许出站 HTTPS，就没问题。任何地方都无需更改入站规则。

## 2. MSSP 一侧：搭建控制平面

MSSP 控制平面是一台 SocTalk VM，与 [Quickstart VM](/zh-cn/quickstart-vm) 安装的那台相同。我们以该教程为基础，再加上加入 tailnet 的步骤。

### 2.1 置备并安装

遵循 [Quickstart VM](/zh-cn/quickstart-vm) 的**第 1 步到第 5 步**（下载、启动、获取设置令牌、打开向导、登录）。当向导询问 **Hostname** 时，暂时留空。你会在 §2.3 中把它设为 tailnet 主机名。

到达 MSSP 仪表盘时停下。**注意：** Quickstart 流程会在首次启动时自动接入一个名为 `demo` 的租户。你会在列表中看到已有一个租户；这是正常的。你可以保留它（并在 §5 中忽略它），也可以在添加你真正的试点租户之前从仪表盘中将其停用：

```text
Tenants → demo → Decommission
```

两种方式都可以；只需知道这一点，这样当 §5 中的 `list all tenants` 返回的数量多于你的试点数时你不会困惑。

<!-- screenshot: mssp-dashboard-after-install.png — MSSP dashboard immediately after wizard install, showing the auto-onboarded demo tenant -->

### 2.2 加固主机

::: danger 进入下一步前必须完成
可下载的磁盘镜像自带一个构建时的 `ubuntu:packer` SSH 用户。**在锁定它之前，不要将该 VM 连接到你的 tailnet。** 完整说明和加固命令参阅 [SSH 访问 + 凭据](/zh-cn/quickstart-vm#ssh-access-credentials)。

最低要求：
```bash
sudo passwd -l ubuntu
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```
:::

### 2.3 安装 Tailscale，加入 tailnet

以 `ops` 身份 SSH 登录（这是在你 [Quickstart VM](/zh-cn/quickstart-vm) 安装期间由 cloud-init 种子创建的用户；**不是** §2.2 刚刚锁定的构建时 `ubuntu` 用户）：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-mssp-... --advertise-tags=tag:mssp --hostname=soctalk-mssp
```

确认分配到的 tailnet 主机名：

```bash
tailscale status | head -1
# example: 100.64.10.5   soctalk-mssp        ops          linux   active; direct
```

你的 MSSP 主机名是 `soctalk-mssp.<your-tailnet>.ts.net`。记下它；后续所有步骤都会用到它。

### 2.4 将 SocTalk 的 ingress 绑定到 tailnet 主机名

编辑已部署的 values 以设置主机名：

```bash
sudo nano /etc/soctalk/values.yaml
```

将 `ingress.hostnames.mssp` 和 `ingress.hostnames.customer` 改为你的 tailnet 主机名（例如 `soctalk-mssp.taila1b2c3.ts.net`），然后重新部署：

```bash
sudo helm upgrade soctalk-system /opt/soctalk/charts/soctalk-system \
  -n soctalk-system -f /etc/soctalk/values.yaml
```

`values.yaml` 的字段参考：参阅 [设置向导](/zh-cn/setup-wizard)；向导写入的是同一个文件。

### 2.5 验证

从任何其他 tailnet 设备（你的操作员笔记本电脑即可；§1.2 的 ACL 允许 `autogroup:admin → tag:mssp:443`）：

```bash
curl -k https://soctalk-mssp.<your-tailnet>.ts.net/health/ready
# expected: 200 OK
```

使用 §2.1 中的管理员凭据在 `https://soctalk-mssp.<your-tailnet>.ts.net/` 登录仪表盘。你应当进入 MSSP 跨租户舰队视图：顶部的 KPI 条（Pending Reviews / Stuck Cases / Degraded Tenants / Repeated IOCs）、按租户划分的调查队列，以及租户健康表。

![MSSP dashboard: cross-tenant fleet view](/screenshots/mssp-dashboard.png)

## 3. 接入每个租户：签发 agent 注册

对试点中的每个租户，你都会在 MSSP 仪表盘中执行此操作，然后将结果交给租户操作员。

### 3.1 运行创建客户向导

在 MSSP 仪表盘中，点击左侧栏的 **Tenants**，再点击列表页顶部的 **New tenant**。这会打开 **Create Customer** 向导。对于 `poc` 和 `persistent` 配置，它是 4 步（Identity → Profile → Branding → Review）；对于 `provided`，它是 5 步（在 Profile 和 Branding 之间会出现一个 **External SIEM** 步骤）。

::: tip 提前收集租户信息
对于 `provided` 配置的租户，向导在第 3 步需要租户的**现有 Wazuh 凭据**。在开始向导**之前**，从你的租户联系人处获取它们（带外传递，使用与 §3.3 相同的安全渠道），这样你就不会中途停在一个填了一半的表单上。对于 `poc` / `persistent`，你只需要基本信息。
:::

#### 第 1 步：Identity

- **Display name**：例如 `Acme Corp`
- **Slug**：短、小写、用短横线分隔（3–32 个字符，按 `[a-z0-9-]+` 校验）。**必须匹配** §1.1 中你的 tailnet 标签（因此 `tag:tenant-acme` → slug `acme`）。后续步骤会将该 slug 直接代入认证密钥（§3.3）和租户的 `tailscale up` 命令（§4.2 / §4.7a）中的 `tag:tenant-<slug>`；不匹配意味着租户节点通告的标签得不到 §1.2 ACL 的授权。
- **Contact email**

![Create Customer: Identity step](/screenshots/mssp-add-tenant-step1-identity.png)

#### 第 2 步：Profile

从三个单选项中选择一个。API 按 `poc | persistent | provided` 校验：

- **PoC**：chart 会在租户集群上安装 Wazuh + 一个 linux-ep 模拟器，使用 `local-path` 存储并采用紧凑的资源预算。为租户没有现有 Wazuh 的短期试点选择此项。参阅 [租户生命周期 / poc](/zh-cn/tenant-lifecycle#poc)。
- **Persistent**：与 `poc` 相同的含 Wazuh 形态，但按持续的生产负载进行规格设定，使用集群的默认 StorageClass 和完整的 chart 资源区间。参阅 [租户生命周期 / persistent](/zh-cn/tenant-lifecycle#persistent)。
- **Provided（自带 Wazuh）**：chart 只安装 SocTalk 适配器；你通过 **External SIEM** 步骤（如下）将其指向租户的现有 Wazuh。参阅 [租户生命周期 / provided](/zh-cn/tenant-lifecycle#provided)。

同一步骤上有一个 **LLM (advanced)** 展开项，用于覆盖安装时共享的 LLM 提供方、base URL、密钥以及（可选的）Fast / Thinking 模型 ID。对于 `poc` / `persistent`，这是可选的；保持折叠即可继承安装默认值。对于 `provided`，LLM 凭据是**必填的**（没有安装时共享的回退值）并会作为该步骤的门槛。

![Create Customer: Profile step](/screenshots/mssp-add-tenant-step2-profile.png)

::: warning 配置选择具有粘性
在租户已置备后更改配置需要停用并重新接入。提交前请与你的租户联系人确认。
:::

#### 第 3 步：External SIEM（仅 provided）

除非你在第 2 步选择了 Provided，否则此步骤隐藏。填写两对端点 + 凭据：

- **Wazuh Indexer URL**（例如 `https://wazuh.acme.example:9200`）+ indexer 用户 + indexer 密码（Basic 认证）
- **Wazuh Manager API URL**（例如 `https://wazuh.acme.example:55000`）+ API 用户 + API 密码（用于签发 JWT）

这些必须能从你将在 §4 中搭建的租户 VM 访问到。MSSP 一侧的控制器会将这些 URL 转换为租户命名空间上的 Cilium FQDN 出站白名单；适配器绝不会从你的 MSSP 集群直接访问 Wazuh。

在提交前，从 MSSP VM 对 manager 凭据做一次健全性检查：

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (long base64 string)
```

如果返回 200，那么在 §4 完成后，租户聊天工具就能解析查询。

#### 第 4 步（poc/persistent 则为第 3 步）：Branding

可选。Display name + 一个小型 logo 上传，会显示在租户页头。你可以完全跳过此步。

![Create Customer: Branding step](/screenshots/mssp-add-tenant-step3-branding.png)

#### 最后一步：Review

确认所有内容，然后点击 **Create**。API 返回 202，你会被带回租户列表；新租户以 `pending` 开始，并经过 `provisioning → active`。刷新详情页可观察生命周期事件的累积。

![Create Customer: Review step](/screenshots/mssp-add-tenant-step4-review.png)

### 3.2 签发 agent 注册命令

::: warning 尚无 UI 按钮
截至撰写本文时，租户详情页只暴露了生命周期操作（Suspend / Resume / Retry Provisioning / Decommission）。`:issue-agent` 流程仅限 API；请从 MSSP VM 的 shell 中驱动它。一个专门的 **Issue Agent** 按钮已在路线图中。
:::

![Tenant detail: lifecycle actions only, no Issue Agent button](/screenshots/mssp-tenant-detail.png)

从 MSSP VM 登录一次以获取会话 cookie，然后对租户的 `:issue-agent` 端点发起 POST：

```bash
# Replace <mssp-host> with your MSSP UI hostname (e.g. soctalk-mssp.<tailnet>.ts.net)
# Replace <tenant-id> with the UUID from the tenant detail URL or from GET /api/mssp/tenants
MSSP=https://<mssp-host>
TENANT=<tenant-id>

curl -sk -c jar -X POST "$MSSP/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<mssp-admin-email>","password":"<password>"}'

curl -sk -b jar -X POST "$MSSP/api/mssp/tenants/$TENANT:issue-agent" \
  -H "Origin: $MSSP" \
  -H 'Content-Type: application/json' | jq .
```

201 响应体包含一个 `helm_install_hint`，你可以直接把它粘贴到租户的 shell 中。它看起来像：

```bash
helm install soctalk-agent-acme \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token>
```

::: warning 逐字使用 API 输出
上面的 `0.1.x` chart 版本和 bootstrap token 仅为示意；真实值来自你的 `:issue-agent` 响应。不要重新键入 helm 命令；请复制 `helm_install_hint` 字段。
:::

::: warning Bootstrap token TTL
bootstrap token 会过期（默认：24h）。如果租户没有在此之前运行该命令，请对同一个 `:issue-agent` 端点重新签发。重新签发会吊销任何尚未使用的先前令牌。
:::

### 3.3 交接给租户联系人

租户操作员需要**两**样东西：

1. §3.2（上文）的 **helm 命令**。整块复制。
2. 你在 §1.3 中生成的**打上租户标签的 Tailscale 认证密钥**。

通过共享密码管理器（1Password、Bitwarden、Vaultwarden，任何具备端到端加密的工具）发送这些内容。不要把二者中任何一个粘贴到公开的 Slack 频道，也不要以未加密方式通过邮件发送。

::: info 即将推出
[SocTalk Launchpad](https://github.com/soctalk/soctalk)（设计中）将生成一个已签名的捆绑包，租户把它粘贴进自己的设置向导，从而自动化这次交接。目前仍是手动的复制粘贴。
:::

### 3.4 为 `provided` 租户协调外部 Wazuh 凭据

::: tip 如果你在 §3.1 中选择了 `poc` 或 `persistent`，请跳过本节
那些配置是自包含的：chart 会安装自己的 Wazuh；MSSP 一侧无需其他操作。直接跳到 §4。
:::

对于 `provided` 配置的租户，向导**已经**在 §3.1 第 3 步收集了 External SIEM 凭据，因此当租户到达 `active` 时适配器已配置完毕。唯一的带外工作在 §3.1 之前：即首先从租户处获取凭据。

流程：

1. **在 §3.1 之前**，向你的租户联系人索要：
   - Wazuh Indexer URL + 用户 + 密码（适配器用于 `_search` 的 Basic 认证）
   - Wazuh Manager API URL + 用户 + 密码（用于签发 JWT）
   - 一个可达性决策：他们的 Wazuh 是否与你将在 §4 中搭建的租户 VM 在同一个 tailnet 上？如果不是，他们需要在 §4.2 中 `--advertise-routes`（菜单见 §4.7a）。
2. 他们在自己一侧遵循 §4.7a 以确认可达性。
3. 他们把两对端点 + 凭据发给你（共享密码管理器）。
4. 你运行 §3.1，在第 2 步选择 **Provided**，并在第 3 步粘贴凭据。

如果租户的可达性情况在 §3.1 之后发生变化（例如他们把 Wazuh 迁到了另一台主机），请在租户详情页更新 External SIEM 面板。控制器会在下一次协调（约 30 秒）时拾取该变更。

## 4. 租户一侧：搭建数据平面

本节对租户 IT 联系人来说是自包含的。**如果你是租户操作员，且你的 MSSP 给了你一条 helm 命令 + 一个 Tailscale 认证密钥，你可以从这里开始。** 浏览 §0 了解背景，然后遵循本节。

### 4.1 置备一台 Linux VM

你需要一台 Ubuntu 24.04 LTS VM，最低 4 vCPU / 8 GB RAM / 60 GB 磁盘，具备出站互联网。通过你正常的 IT 流程置备它。任何可运行 Ubuntu 的虚拟化平台都行（vSphere、Proxmox、Hyper-V、KVM、VirtualBox、裸机）。如果你更愿意使用预制的 SocTalk 镜像，磁盘镜像链接和各虚拟化平台的导入步骤参阅 [Quickstart VM 第 1 步](/zh-cn/quickstart-vm#_1-download)；之后回到本节 §4.2。

### 4.2 加固主机

::: warning
如果你使用了预制的 SocTalk 镜像，请在连接到你的 tailnet 之前遵循 [SSH 访问 + 凭据](/zh-cn/quickstart-vm#ssh-access-credentials)。如果你通过 IT 流水线置备了一台通用 Ubuntu VM，你标准的操作系统加固已经适用。
:::

### 4.3 安装 Tailscale，加入 tailnet

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-tenant-... --advertise-tags=tag:tenant-<slug> --hostname=soctalk-tenant-<slug>
```

使用来自 MSSP 交接（§3.3）的认证密钥。验证：

```bash
tailscale ping soctalk-mssp.<tailnet>.ts.net
# expected: pong from the MSSP control plane
```

如果 `ping` 失败，检查 Tailscale 管理界面的机器列表。确保 MSSP 机器在线，并且 ACL 预览显示你的租户标签可以访问 `tag:mssp`。

### 4.4 安装 k3s + Helm

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644" sh -
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

验证 k3s 已启动：

```bash
kubectl get nodes
# expected: one node, status Ready
```

### 4.5 禁用租户一侧的 NetworkPolicies

::: danger 进入下一步前必须完成
`soctalk-cloud-agent` chart 和租户 chart 自带的 NetworkPolicies 假定使用 Cilium FQDN 策略。原生 k3s 没有 Cilium CRD，因此这些策略会阻断 agent 到 MSSP 的合法出站流量。在 §4.6 的 helm install 之前禁用 chart 的 NetworkPolicies。

最简单的做法：在你的 helm 命令中加上 `--set networkPolicies.enabled=false`。

如果你的租户集群需要网络隔离，请在主机防火墙层实现（§1.2 的 tailnet ACL 已经提供了 MSSP↔租户隔离）。
:::

### 4.6 运行来自 MSSP 的 helm 命令

粘贴 §3.2 的命令，并按 §4.5 追加 `--set networkPolicies.enabled=false`：

```bash
helm install soctalk-agent-<slug> \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token> \
  --set networkPolicies.enabled=false
```

::: tip MSSP 证书是自签名的？设置 insecureTLS
如果你的 MSSP 安装尚未为 tailnet 主机名置备真实的 TLS 证书（chart 侧的 cert-manager 未接通，或你处于 Tailscale 之后并将其视为信任边界），请在 helm 命令中追加 `--set insecureTLS=true`。agent 将跳过对 `controlPlaneUrl` 的证书验证；无论如何 Tailscale 都会处理传输层加密。默认关闭；仅当你信任底层网络时才设置它。
:::

cloud-agent 安装在 `soctalk-agent` 命名空间中，通过 tailnet 拨号连接控制平面并注册，此后 MSSP 控制器会在这同一个集群上驱动租户 chart 的安装。

观察 agent 启动：

```bash
kubectl -n soctalk-agent logs deploy/soctalk-cloud-agent -f
# look for: agent_registered installation_id=...
```

当 `agent_registered` 出现在日志中时，agent 已成功与 MSSP 通信。

### 4.7 Wazuh：现有还是全新？

::: code-group
```text [4.7a: Tenant has existing Wazuh]
Required: TWO endpoint + credential pairs.

1. Wazuh Indexer, typically https://<host>:9200
   - User + password with read access to wazuh-alerts-*
2. Wazuh Manager API, typically https://<host>:55000
   - User + password with permission to mint JWTs

Both must be reachable from this tenant VM. The Manager API must ALSO
be reachable from the MSSP via the tailnet; the L1 chat agent dials
it directly when answering questions about your alerts.

If your existing Wazuh runs on a SEPARATE host from this tenant VM
(common), pick one of these:

a) Install Tailscale on the Wazuh host too, join the same tailnet
   tagged tag:tenant-<slug>. Simplest; gives the MSSP a stable
   tailnet hostname to dial.

b) Advertise the Wazuh subnet from this tenant VM. On this VM:

     sudo tailscale up --auth-key=... --advertise-tags=tag:tenant-<slug> \
       --hostname=soctalk-tenant-<slug> \
       --advertise-routes=<wazuh-subnet>/<mask>

   Then approve the route in the Tailscale admin UI under
   Machines → this host → Edit route settings.

Without (a) or (b), the MSSP can reach this VM but cannot reach
your Wazuh Manager, and chat tool calls against your tenant will
fail.

Hand both endpoint + credential pairs (plus the chosen reachability
option) back to your MSSP. They paste the credentials at step 3 of
the Create Customer wizard (§3.1), which configures the SocTalk
tenant chart to use your Wazuh in "provided" mode. If the MSSP has
already onboarded you as `provided` and your reachability story
changes later, they update the External SIEM panel on the tenant
detail page instead (§3.4).
```

```text [4.7b: No existing Wazuh]
The SocTalk tenant chart installs Wazuh + one linux-ep agent
simulator automatically (the `poc` profile). No tenant action needed
beyond waiting ~5 minutes for the Wazuh stack to come up.

Watch progress:
  kubectl -n tenant-<slug> get pods -w
```
:::

### 4.8 检查点：需要关注的两个状态

租户会经历两个不同的就绪状态。不要把它们弄混：

#### 4.8a Cloud agent 已注册（§4.6 之后约 1 分钟）

重新登录 MSSP 仪表盘。你的租户会在 §4.6 成功后的 1-2 分钟内翻转为 **Online**。这意味着 **cloud-agent 已联系到 MSSP 并完成注册**：信任握手已完成。

这**还不**意味着租户 Wazuh 栈已启动，也不意味着聊天工具能对该租户解析查询。

![MSSP dashboard: tenant flipped to Online](/screenshots/mssp-dashboard-tenant-online.png)

#### 4.8b 租户数据平面完全就绪（再约 5-7 分钟）

在 agent 注册之后，MSSP 控制器会在租户集群上驱动租户 chart 的安装：

- **`poc` 配置**：Wazuh + linux-ep 模拟器启动。实际耗时约 5-7 分钟。
- **`provided` 配置**：SocTalk 适配器立即启动。一旦适配器联系到 MSSP 在 §3.1 第 3 步提供的 External SIEM 端点，Wazuh 聊天工具调用即可解析。如果无法解析，按 §3.4 检查可达性。

从租户 VM 观察：

```bash
kubectl -n tenant-<slug> get pods -w
# poc profile: wait until wazuh-manager-0, wazuh-indexer-0, linux-ep-N all Ready
# provided profile: wait until soctalk-adapter is Ready
```

只有在 §4.8b 之后，租户才为 §5 的演示做好准备。如果 §4.8a 触发但 §4.8b 始终未完成，参阅 [试点故障排查](#_7-pilot-troubleshooting)。

## 5. 演示时刻

面向相关方的时刻。逐字复现这些查询；措辞决定了 LLM 会选择哪个工具。

登录 MSSP 仪表盘。打开 **Chat** 标签页。

**查询 1。确认租户可达。**

```text
list all tenants
```

预期：一个 `list_tenants` 工具徽章，随后是一条按 slug + display name 列出你试点租户的回复。

![Chat: list_tenants tool badge + reply](/screenshots/chat-list-tenants.png)

**查询 2。展示某一个特定租户的告警。**

```text
show me the 5 most recent alerts at <tenant-slug> with rule ids
```

预期：一个带有 `@ <tenant-slug>` 标记的 `recent_alerts` 工具徽章，随后是一段列出规则 ID、严重级别和时间戳的自然语言摘要。

::: tip 这就是给相关方看的截图
工具徽章上的 `@ <tenant-slug>` 标记就是证据：SocTalk 的 AI SOC 分析师正在深入租户转发过来的 Wazuh 告警，并回答一个关于真实数据的问题。捕获这一屏画面。
:::

![Chat: recent_alerts @ acme with rule IDs + LLM analysis](/screenshots/chat-wazuh-alerts.png)

::: info 为什么是 `recent_alerts` 而不是 `get_wazuh_alert_summary`？
试点的 `poc` 配置将 Wazuh 部署进租户集群，SocTalk 适配器把告警（受最低严重级别约束，可通过 `SOCTALK_ADAPTER_MIN_SEVERITY` 配置）转发到 MSSP 数据库。`recent_alerts` 从该转发流中读取，因此无论 MSSP 能否直接访问租户的 Wazuh API，它都能工作。`get_wazuh_alert_summary` 是实时集成的对应工具，适用于 MSSP 在 **Integrations** 中持有租户 Wazuh URL + 凭据的 `provided` 配置。
:::

如果告警列表为空（租户 Wazuh 尚未看到任何流量），生成测试告警。通过 chart 安装的 Wazuh 路径（§4.7b）会附带一个或多个带攻击模拟器的 `linux-ep-N` pod；通过标签选择器在第一个就绪的副本上触发它：

```bash
# On the tenant VM, against any linux-ep pod
kubectl -n tenant-<slug> exec -it \
  "$(kubectl -n tenant-<slug> get pod -l app=linux-ep -o jsonpath='{.items[0].metadata.name}')" \
  -- /opt/scripts/run-attack.sh
```

等待 30-60 秒，然后重新运行聊天查询。对于现有 Wazuh 路径（§4.7a），在你自己的 Wazuh 上以你平常的方式触发告警，例如对一台受监控主机 SSH 输入几次错误密码。

## 6. 第二天：接下来往哪走

- **接入真实客户 Wazuh。** 通过重复 §3 和 §4 接入更多租户。模式相同；每个新租户都需要一个新的 Tailscale 标签、ACL 条目、临时认证密钥和 agent 签发。
- **规划生产环境安装。** 当你准备好越过试点时，参阅 [安装](/zh-cn/install) 了解 K3s + Cilium + cert-manager + 真实 ingress 的路径。
- **租户生命周期运维。** [租户生命周期](/zh-cn/tenant-lifecycle) 涵盖从 MSSP 仪表盘挂起、恢复和停用租户。
- **升级。** [升级](/zh-cn/upgrades) 涵盖将 soctalk-system 和 cloud-agent 向前滚动。
- **备份。** [备份与恢复](/zh-cn/backup-restore) 用于有状态数据。

### 试点中**不**包含的内容

- 高可用（每一侧都是单个 k3s 节点）
- 真实 TLS（tailnet 主机名使用自签名证书；生产环境需要 cert-manager + 真实 ingress）
- 多区域
- 每个租户扩展到约 50 个 Wazuh agent 以上
- 每个租户独立的 ingress（本试点全程使用 tailnet 主机名）

当你迁移到生产环境时，你的 MSSP 产品配置（租户列表、聊天历史、LLM 密钥）经过规划可以延续下去。在停用本试点之前，请与团队沟通。

## 7. 试点故障排查

针对试点拓扑特有故障的、以症状为导向的表格。通用的 SocTalk 问题在 [故障排查](/zh-cn/troubleshooting) 中涵盖。

| 症状 | 可能原因 | 检查 |
|---|---|---|
| 租户在 MSSP 仪表盘中卡在 "Pending" | bootstrap token 在 §4.6 运行前已过期 | 从 MSSP 仪表盘重新签发（§3.2）；token 默认 24h |
| 从租户执行 `tailscale ping soctalk-mssp.<tailnet>.ts.net` 失败 | ACL 过严，或 MSSP 机器离线 | 检查 Tailscale 管理界面中的 ACL 预览；检查 MSSP 的 `tailscale status` |
| Agent 日志显示到 `controlPlaneUrl` 的 `connection refused` | §2.4 中 MSSP 一侧的 `helm upgrade` 未生效 | 在 MSSP VM 上：`kubectl -n soctalk-system get ingress`；确认主机名匹配 |
| Agent 日志显示来自 MSSP 的 `403 Forbidden` | bootstrap token 已被使用（一次性） | 从 §3.2 重新签发 |
| `kubectl -n soctalk-agent get pods` 显示 `ImagePullBackOff` | 租户集群无法从 `ghcr.io` 拉取（企业代理） | 用代理配置 k3s registries.yaml；或在租户 VM 上预先拉取 |
| 聊天称 "no Wazuh alerts" 但租户有告警 | 现有 Wazuh 场景：Manager API 无法从 MSSP tailnet 访问 | 从 MSSP VM：`curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"`（GET；应返回一个 JWT） |
| `get_wazuh_alert_summary` 工具返回错误 | 现有 Wazuh 场景：Indexer 凭据错误 | 从租户 VM：`curl -ku <user>:<pw> https://<wazuh-indexer>:9200/wazuh-alerts-*/_search?size=1` |
| 适配器心跳正常但 agent 始终不到 "Online" | §4.5 中的 NetworkPolicies 仍处于启用状态 | `kubectl -n soctalk-agent get networkpolicies`；应为空 |
| `helm install` 因 values-schema 错误被拒 | 控制平面与 agent chart 之间的 chart 版本偏差 | 使用 issue-agent 端点打印的 chart 版本，而不是 "latest" |

## 8. 停用试点

当试点结束时：

1. **租户一侧，每个租户**：`helm uninstall soctalk-agent-<slug> -n soctalk-agent`。关闭并归档（或销毁）租户 VM。
2. **Tailscale 管理界面**：在 **Settings → Keys** 下吊销每个租户的认证密钥；从 **Access Controls** 中移除每个租户标签。
3. **MSSP 仪表盘**：对每个租户，从租户详情页执行 **Decommission**（状态转变为 `decommissioning` → `archived`）。
4. **MSSP VM**：如果不迁移到生产环境则归档或销毁。如果迁移，生产集群路径参阅 [安装](/zh-cn/install)。

保留以下工件以供试点后复盘：

- 每个租户详情页的审计日志（可下载）
- 你在 §2.4 填好的 `values.yaml`
- §1.2 的 Tailscale ACL 配置段
- §5 的截图
