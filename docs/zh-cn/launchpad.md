# Launchpad：一条命令启动 MSSP 试点

当你在单台同置主机上完整体验过 SocTalk（[快速开始](/zh-cn/quickstart-vm)）之后，**Launchpad 是下一步**：它带你从本地演示走向真正的试点——在你自己的基础设施上部署一个 MSSP 控制平面加一个或多个租户环境。你可以通过 **Web 控制台**（推荐）驱动它，或者稍后通过一条无界面命令来运行：它会启动 VM、将其加入你的 tailnet、从公共来源安装 SocTalk，并交给你一个 URL。

想在让工具动手之前理解每一个步骤？[手动搭建 MSSP 试点](/zh-cn/mssp-pilot)会带你逐步手工完成同样的安装——相同的 chart、相同的 Tailscale 流程。Launchpad 只是替你完成了复制粘贴。

::: tip 上手时间
| 路径 | 上手操作 | 实际耗时 |
|---|---|---|
| [手动搭建](/zh-cn/mssp-pilot) | 约 90 分钟 | 约 2 小时 |
| Launchpad 控制台 | 约 5 分钟填一张表单 | 约 15-25 分钟（大部分时间在等待下载） |
:::

## 它做什么

给定你的 MSSP 管理员凭据和一份租户清单，Launchpad 会：

1. 在你的 VM 主机上下载 Ubuntu Noble 云镜像（后续运行会使用缓存）
2. 预置 QEMU VM——一个给 MSSP，每个租户各一个——并配置 cloud-init + Tailscale
3. 等待每台 VM 以其所声明的 tag 加入你的 tailnet
4. 在 MSSP 上以 `--demo` 模式运行 [`install.sh`](https://github.com/soctalk/soctalk/blob/main/install.sh)
5. 通过 MSSP API 逐个接入各租户
6. 为每个租户调用 `:issue-agent` 以获取引导令牌
7. 在每台租户 VM 上安装 k3s + Helm + `soctalk-cloud-agent`
8. MSSP 派发 `install_helm_release` 作业 → cloud-agent 拉取并应用 `soctalk-tenant` chart（Wazuh manager + indexer + dashboard、adapter、runs-worker）

结束时，你将拥有一个可用的 MSSP 仪表板、注册完毕且状态为 `active` 的租户，以及每个租户各自运行的 Wazuh。一切都从公共来源下载——没有预置镜像，没有捆绑的 chart。

## 它不是什么

- **不是生产安装器。** 它是一个评估工具。与手动搭建试点相同的非生产注意事项：无 HA、自签名证书、以 tailnet 作为入口。
- **不是集群管理器。** 它只触发一次然后退出。它不监视集群、不做升级、不做漂移协调。之后请使用 `helm upgrade`。
- **不是 Kubernetes operator。** launchpad 运行在你的桌面上，而非集群内。

## 前置条件

请先准备好这些：

- [ ] **一台可从你工作站访问的 VM 主机。** 一台 Linux 主机，具备：
      - `qemu-system-x86_64`、`qemu-img`、`genisoimage`、`curl`
      - `/dev/kvm`（嵌套 KVM 可用，裸机更快）
      - 足够运行你 VM 的余量：**每台 VM 8 GB 内存 + 4 vCPU + 60 GB 磁盘**
      - 从你的工作站以 `kvm` 组内某用户身份进行免密码 SSH
- [ ] **一个 Tailscale tailnet。** 免费套餐即可。你需要：
      - tailnet 名称（例如 `taila1b2c3.ts.net`）
      - 一个具备 `keys:write` 权限的 [Tailscale API 访问令牌](https://login.tailscale.com/admin/settings/keys)——launchpad 用它为每台 VM 铸造临时设备认证密钥
      - 你将使用的 tag 的所有权——把这些加入你的 ACL：
        ```json
        "tagOwners": {
          "tag:mssp":        ["autogroup:admin"],
          "tag:tenant-acme": ["autogroup:admin"]
        }
        ```
- [ ] **一个 SSH 公钥**，你希望在每台预置的 VM 上授权（通常是你工作站的公钥）。
- [ ] **一个供 MSSP 使用的 LLM API 密钥。** 选一个你拥有的提供商（Anthropic、OpenAI，或指向本地的 Ollama）。在不涉及 AI 的冒烟测试中，占位密钥也能用。

::: warning Tailscale MagicDNS
launchpad 预期你的 tailnet 上已启用 MagicDNS，以便租户集群能通过主机名访问 MSSP。它默认开启。如果你关闭了它，你需要自己添加 `hostAliases`（相应模式参见[手动搭建试点](/zh-cn/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant)）。
:::

## 1. 安装 CLI

从[最新发布版](https://github.com/soctalk/soctalk-launchpad/releases/latest)下载适合你平台的 `launchpad` 二进制文件，然后让它拉取其插件：

```bash
# pick the asset for your OS/arch: launchpad_{darwin,linux,windows}_{amd64,arm64}
base=https://github.com/soctalk/soctalk-launchpad/releases/latest/download
curl -fsSL "$base/launchpad_$(uname -s | tr A-Z a-z)_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o launchpad
chmod +x launchpad && sudo mv launchpad /usr/local/bin/launchpad

launchpad version
launchpad init   # downloads + signature-verifies every plugin into ~/.launchpad/plugins
```

`init` 会从同一个已签名的发布版拉取适合你平台的插件集，并在安装前将每个二进制文件与该发布版的 ed25519 签名索引进行校验。任何东西都不会未经校验就运行。（`launchpad plugin list` 显示已安装的插件集；`launchpad plugin sync` 重新拉取或修复该存储。）

## 2. 在 Web 控制台中运行试点

`launchpad ui` 会启动一个本地 Web 控制台并在你的浏览器中打开它——这是驱动试点的主要方式。你只需将基础设施注册一次，作为可复用、可测试的 **Hosts** 和 **Networks**，然后启动并观察。

```bash
launchpad ui
```

首次运行时，CLI 会将插件集下载并校验到 `~/.launchpad/plugins`，然后从同一个二进制文件提供该控制台——无需安装其他任何东西。在浏览器中，依次完成三个界面：

1. **Networks** — 添加你的 tailnet：覆盖网络名称（例如 `taila1b2c3.ts.net`）和你的 Tailscale API 密钥。按 **Test** 确认密钥可用，然后再依赖它。一次运行绑定到一个网络，所有机器都会加入它。
2. **Hosts** — 添加你要在其上预置的位置。就本指南而言即你的 KVM 主机：SSH 目标和一个可写的工作目录。新主机会预填其平台所需的字段，**Test** 会验证连接和凭据。凭据随主机一起存储，绝不离开运行 Launchpad 的机器。
3. **Runs** — 创建一次运行：把**控制节点**（你的 MSSP）和每个**租户**分配到一台主机，选择网络，填入 MSSP 管理员凭据和 LLM 密钥，然后按 **Launch**。

![Networks——一次运行中每台机器都会加入的覆盖网络，注册一次即可](/screenshots/launchpad-ui-networks.png)

![Hosts——你在其上预置的底层，注册一次即可](/screenshots/launchpad-ui-hosts.png)

控制台会实时流式展示进度——每台 VM 的预置、加入 tailnet 以及安装 SocTalk——并在结束时给你 MSSP URL。运行是幂等的（重新启动会针对已存在的机器进行协调，而非重复创建它们），而 **Down** 操作会把一次运行的机器拆除。

![进行中的一次运行——MSSP 与租户 VM 正在预置，带有阶段追踪器和实时事件流](/screenshots/launchpad-ui-run.png)

::: tip 合规检查
在把插件指向真实基础设施之前，你可以从 CLI 对它做一次健全性检查：
```bash
launchpad plugin verify qemu
```
这会运行协议合规套件（校验和、握手、`plan`、幂等 `destroy`），无需真实凭据。
:::

## 3. 验证是否成功

当运行完成时（控制台标记为完成，或 `launchpad up` 以 `0` 退出），对两个系统做健全性检查：

**MSSP 仪表板** — 打开运行结束时打印的 URL（或 `https://lp-mssp.<your-tailnet>.ts.net/`）。用你为该运行设置的管理员凭据登录。你的租户应当被列出，并在 1-2 分钟内翻转为 **Online**。

![Launchpad 预置的 MSSP 仪表板](/screenshots/launchpad-mssp-dashboard.png)

**租户上的 Wazuh** — SSH 进入租户 VM（`ssh ops@lp-tenant-acme.<your-tailnet>.ts.net`）并检查 pod：

```bash
sudo k3s kubectl -n tenant-acme get pods
```

你应当看到：

```
NAME                                          READY   STATUS
tenant-acme-wazuh-manager-0                   1/1     Running
tenant-acme-wazuh-indexer-0                   1/1     Running
tenant-acme-wazuh-dashboard-<hash>            1/1     Running
tenant-acme-linuxep-0                         1/1     Running
soctalk-adapter-<hash>                        1/1     Running
soctalk-runs-worker-<hash>                    1/1     Running
```

`linuxep-0` StatefulSet 是一个装有 Wazuh agent 的演示 Linux 端点——一个用来模拟告警的地方。详情参见[攻击模拟器](/zh-cn/mssp-pilot#5-3-generate-alerts)。

### SSH 进入 VM

每台由 launchpad 预置的 VM 都有一个预配置的 `ops` 用户，已授权你主机配置中的 SSH 密钥并具备**免密码 sudo**。这正是 launchpad 的安装阶段进行接入的方式；你可以用同一个账户进行故障排查。

```bash
# Interactive shell as ops
ssh ops@lp-mssp.<your-tailnet>.ts.net
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net

# One-off command as root
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net "sudo journalctl -u k3s -n 100"
```

::: tip 回退方案：MagicDNS 关闭时通过 IPv4 连接
如果你的 tailnet 上禁用了 MagicDNS，`lp-<key>.<tailnet>.ts.net` 在你的工作站上将无法解析。使用 `tailscale status | grep lp-` 找到 tailnet 的 IPv4，并直接 `ssh ops@100.x.y.z`。
:::

## 4. 使用你的试点：接入客户并向 AI 提问

Launchpad 交给你一个可用的 MSSP，其中你的第一个租户已经接入完毕——从这里开始，你可以完全像一个 MSSP 那样驱动它。**Dashboard** 是一个跨租户的舰队视图：待处理的审查、卡住的案件、状态劣化的租户，以及各租户的健康状况。

![MSSP 仪表板——跨租户舰队视图](/screenshots/pilot-final-dashboard.png)

**接入另一个客户。** **Tenants → Create customer** 会运行一个简短的四步向导：

![Create customer——1. 身份](/screenshots/pilot-add-tenant-step1.png)
![Create customer——2. 档案](/screenshots/pilot-add-tenant-step2.png)
![Create customer——3. 品牌](/screenshots/pilot-add-tenant-step3.png)
![Create customer——4. 审查](/screenshots/pilot-add-tenant-step4.png)

新客户加入舰队，cloud-agent 会以 Launchpad 为第一个租户所做的相同方式预置其 Wazuh + adapter 栈：

![已接入客户后的租户列表](/screenshots/pilot-final-tenants-list.png)

深入某个租户以查看其未结的调查、审查和 Wazuh 健康状况：

![租户详情](/screenshots/pilot-final-acme-detail.png)

**向 AI SOC 分析师提问。** **Chat** 视图可以回答跨整个舰队或限定于单个租户的问题，它会针对实时数据调用工具并总结所发现的内容：

![向 AI 提问——一份全舰队范围的总结，附带它所运行的工具调用](/screenshots/pilot-chat-mssp-reply.png)
![向 AI 提问——限定于单个租户](/screenshots/pilot-chat-tenant-reply.png)

::: tip
AI 需要配置一个真实的 [LLM 提供商](/zh-cn/integrate/llm-providers)——冒烟测试的占位密钥无法回答问题。
:::

## 5. 用配置文件精细调优

一旦试点在控制台中跑通，你就可以把同样的设置捕获为一份 YAML 配置，并用 `launchpad up` 无界面驱动它——无需控制台。在以下情况下可考虑这样做：

- **可重复、可脚本化的运行** — 把配置签入 git，在 CI 中运行它，并针对 JSON 事件流做断言。
- **表单未暴露的精细控制** — 固定某个基础镜像或其 SHA、指向特定的 `install.sh` 发布标签、一次性脚本化多个租户，或按 VM 调优 CPU / 内存 / 磁盘。

控制台和配置在 `~/.launchpad` 下共享同一套 Hosts 和 Networks，因此配置驱动的运行会精确复用你已经测试过的东西。

将下面内容保存为 `pilot.yaml` 并替换方括号中的值：

```yaml
run_id: my-pilot

# Provisioning target — the plugin that creates VMs. Others: vmware, hetzner, proxmox, docker.
target: qemu

# Passed opaquely to the qemu plugin's initialize.
plugin_config:
  ssh_host: [user]@[vm-host-ip]      # SSH target on your KVM host
  work_dir: /home/[user]/lp-vms       # writable path; caches images + hosts VM disks
  tailnet: [your-tailnet].ts.net
  cpu: 4
  memory_mb: 8192
  disk_gb: 60
  # base_image_url is optional; defaults to the current Ubuntu Noble cloud image.
  # base_image_sha256: <optional pin>

# SSH keys authorized on every provisioned VM (the launchpad SSHes in as `ops`).
ssh_keys:
  - "ssh-ed25519 AAAA... you@laptop"

mssp:
  key: mssp
  name: my-pilot-mssp
  role: mssp
  tags: { role: mssp }

tenants:
  - key: tenant-acme
    name: acme-corp
    role: tenant
    tenant_slug: acme
    tags: { role: tenant, tenant_slug: acme }

# Post-provision installation phase.
install:
  # Point at a pinned release tag for reproducible smoke tests. `main` also works.
  installer_url: https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh
  mssp_admin_email: admin@my-pilot.demo
  mssp_admin_password: [pick-a-strong-one]
  mssp_display_name: My Pilot MSSP
  llm_provider: anthropic
  llm_api_key: [your-anthropic-key]
```

::: warning 关于管理员密码
运行之前请将它保存到密码管理器中。如果你弄丢了它，launchpad 不会再把它回显给你。
:::

要添加租户，请扩展 `tenants:` 列表。每个租户都需要一个唯一的 `key`、一个与你的 Tailscale ACL 匹配的 `tenant_slug`，以及 `tagOwners` 下相应的条目。

### 运行它

```bash
export TAILSCALE_API_KEY=tskey-api-...

launchpad up --config pilot.yaml --state ~/.launchpad/state.json
```

默认会渲染一个 Bubble Tea TUI，带有各 VM 的进度条、实时事件日志，以及针对交互式步骤的门控提示。对于无人值守的运行（CI、脚本、本指南的冒烟测试），使用 `--headless` 将 JSON 事件流式输出到 stdout：

```bash
launchpad up --config pilot.yaml \
  --state ~/.launchpad/state.json \
  --headless --auto-resolve-gates | tee run.log
```

`--auto-resolve-gates` 会接受每一个门控（目前只有 Tailscale ACL 确认）而不提示。如果你想在租户被预置之前审查你的 ACL，请跳过它。

首次运行的粗略阶段耗时（缓存全新，家庭网络尚可）：

| 阶段 | 时长 | 正在发生什么 |
|---|---|---|
| `provisioning` | 60-90 秒 | 镜像下载（约 600 MB）+ cloud-init + 加入 Tailscale |
| `installing`（MSSP） | 3-5 分钟 | k3s 安装、Helm、`soctalk-system` chart |
| `installing`（每个租户） | 3-5 分钟 | k3s + Helm + `soctalk-cloud-agent`，随后 MSSP 派发 `soctalk-tenant` chart（Wazuh + adapter） |
| 合计 | **约 10-15 分钟** | 对于 MSSP + 1 个租户 |

后续运行会快得多，因为基础镜像已缓存在 VM 主机上。

## 6. 迭代——恢复、拆除、重启

launchpad 是幂等的。重新启动一次运行——再次点击控制台的 **Launch**，或运行 `launchpad up`——会从中断处继续：

- 已存在的 VM 会被复用（不会重复预置）
- 如果 API 已经在应答，则跳过 MSSP 安装步骤
- 如果租户已存在，则跳过租户接入
- `soctalk-cloud-agent` chart 会以 `helm upgrade --install` 方式处理，而非重新安装

要干净地拆除一切（VM、Tailscale 设备、工作目录），使用控制台的 **Down** 操作，或：

```bash
launchpad down --config pilot.yaml --state ~/.launchpad/state.json
```

要向一个运行中的试点添加租户，在控制台中添加它（或编辑 `pilot.yaml` 中的 `tenants:`）并重新启动。已存在的 VM 不受影响；新租户会被预置和安装。

## 7. 故障排查

### `vm.wait_ready` 超时

VM 已启动但从未加入 tailnet。VM 上的 cloud-init 无法访问 Tailscale 协调服务器。

- 确认你的 VM 主机有互联网连接
- SSH 进入 VM 主机并检查位于 `<work_dir>/<run_id>/<vm_key>/serial.log` 的 QEMU 串口日志——它捕获了包括 tailscale-up 在内的 cloud-init 输出
- 常见原因：临时认证密钥在 VM 使用之前就被吊销了（检查 Tailscale 管理后台 → Machines 日志）

### MSSP 安装在 `helm upgrade` 处超时

chart 安装已运行，但 pod 在 15 分钟内没有收敛。通常是慢速连接上的镜像拉取。

- SSH 进入 MSSP VM：`sudo k3s kubectl -n soctalk-system get pods` 并检查是否有 `ImagePullBackOff` 或 `CrashLoopBackOff`
- 如果 pod 仍在拉取，稍等后重新启动——一旦 API 应答，第二次尝试会跳过安装步骤

### 租户 agent 在 `/api/agent/register` 上记录 `no such host`

pod 的集群 DNS 无法解析 MSSP 的 tailnet 主机名。这正是 `hostAliases` 的用途。launchpad 默认会把它拼接进 helm 命令；如果你在手动操作，参见[手动搭建试点](/zh-cn/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant)。

### 自动化

`--headless` 模式是 launchpad 的自动化面。每个阶段、VM 状态变化、安装日志行和门控提示都是 stdout 上的一个 JSON 事件：

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

从你的 CI 中针对这些事件做断言。完整列表参见 [Launchpad 事件 schema](/zh-cn/reference/launchpad-events)。

## 下一步去哪

- **添加一个真实租户。** 从 MSSP 仪表板接入——向导操作详见[手动搭建试点 §3](/zh-cn/mssp-pilot#3-onboard-tenants)。
- **生成一些告警。** [攻击模拟器](/zh-cn/mssp-pilot#5-3-generate-alerts)提供了操作手册。
- **让 AI 面向真实数据。** 正确配置你的 [LLM 提供商](/zh-cn/integrate/llm-providers)（冒烟测试的占位密钥无法回答问题）。
- **迈向生产。** [安装](/zh-cn/install)是非 launchpad、支持 HA 的路径。
