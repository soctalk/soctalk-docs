# 从操作系统软件包安装（rpm / deb）

每个 SocTalk 版本都会在发布 VM 镜像的同时，为两大基于 systemd 的 Linux
发行版家族提供原生的操作系统软件包，与版本标签附加在同一个 GitHub Release 上：

| 文件 | 包管理器 | 已验证于 | 预期同样可用 |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9.8 | RHEL、Fedora、AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

两者都经过端到端验证：安装软件包，运行 `soctalk install`，打开
Web 应用并登录。“预期同样可用”一列属于同一个软件包家族，
只是未在这些具体的发行版上做过测试。

在 Rocky Linux 9.8 上，验证覆盖了本产品提供的两种形态，均在 SELinux 处于
Enforcing 模式的全新 VM 上进行。仅控制平面的安装拉起了 `api`、`app-ui`
和 `postgres`，引导管理员可以登录。完整安装还额外开通了一个 `poc`
租户，该租户自行拉起了 Wazuh manager、indexer 和 dashboard，并达到 `active`
状态。第二次运行是在启用 firewalld 的情况下完成的，这需要先应用下方
[RHEL 说明](#rhel-fedora-almalinux-rocky)中的规则，集群才能正常工作。
那些说明介绍了 SELinux 和 firewalld 各自对你有哪些要求、又有哪些并不要求。

**不支持 Alpine**，也没有发布 `.apk`：`soctalk install`
需要 systemd，而 Alpine 使用 OpenRC。参见下方的 [Alpine 及其他非 systemd
主机](#alpine-and-other-non-systemd-hosts)。**openSUSE / zypper** 和
**RHEL 10** 未经测试；有关 RHEL/Fedora 的说明可能并不完全适用。**仅限 amd64**：
没有 arm64 软件包。

它们发布于 [`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases)
的发布页面。当前版本为 **v0.2.0**：
[发布页面](https://github.com/soctalk/soctalk/releases/tag/v0.2.0)。该
仓库为公开仓库，因此无需身份验证即可下载。

## 软件包安装了什么

该软件包刻意保持精简。SocTalk 运行在 Kubernetes（K3s）之上，因此
软件包本身并不包含 SOC 栈。它安装一个轻量的管理 CLI
和安装程序，随后你只需运行一条命令即可拉起整个栈：

- `/usr/bin/soctalk`，即管理 CLI（`install`、`upgrade`、`status`、
  `logs`、`uninstall`、`version`）。
- `/usr/libexec/soctalk/install.sh`，与[演示 VM](/zh-cn/quickstart-vm)
  和[一条命令安装](/zh-cn/install)所用的安装程序完全相同。它会在
  K3s 和 Helm 缺失时自动引导安装，然后通过 Helm 从 GHCR 安装 `soctalk-system` chart。
- `/etc/soctalk/soctalk.env.example`，用于无人值守安装的模板。

唯一的依赖是 `curl` 和 `tar`；安装程序会自行获取 K3s 和 Helm。
当你要安装到自己直接管理的 Linux 主机上，并希望将 SocTalk
注册到系统软件包数据库中（以便 `dnf`/`apt`
跟踪并升级它）时，这是正确的路径。如果你只是想试用 SocTalk，
[演示 VM 镜像](/zh-cn/quickstart-vm)会更快。

## 安装软件包

选择适合你发行版的代码块。如果你使用的是更新的版本，请将 `0.2.0`
替换为当前版本。

### RHEL、Fedora、AlmaLinux、Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

`dnf` 会在 `curl` 和 `tar` 缺失时自动拉取。在较旧的主机上请使用
`sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`。

部分 RHEL 9 镜像以 `curl-minimal` 取代完整的 `curl`，这可能与按名称要求
`curl` 的软件包发生冲突。在这里不会发生冲突。在用于验证的 Rocky Linux 9.8
主机上，移除 `curl` 且只安装 `curl-minimal` 时，该 rpm 照常完成安装：
`curl-minimal` 带有 `Provides: curl`，因此依赖可以直接解析，无需替换，
也不需要 `--allowerasing`。

### Debian、Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` 会从你配置的仓库中解析 `curl` 和 `tar`
依赖。在没有 `apt` 的最小化镜像上，你可以使用
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install`。

## 校验下载

每个版本都包含 `SHA256SUMS.txt`，覆盖所有制品，包括软件包在内。

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` 只校验你实际下载的文件。每一行都应报告 `OK`。

## 拉起 SOC 栈

安装软件包并不会启动 SocTalk。软件包安装完成后，
通过 CLI 运行安装程序。这会在需要时安装 K3s 和 Helm，然后
在本主机上通过 Helm 安装 `soctalk-system`。

交互式（会提示输入 MSSP 名称、管理员和 LLM 提供商）：

```bash
sudo soctalk install
```

一次性演示（随机管理员密码，自动开通一个演示租户）：

```bash
sudo soctalk install --demo
```

`--demo` 仍会为一次同意提示暂停一次。若要完全无人值守运行（未连接
终端，例如从预配脚本中运行），请加上 `--yes`：
`sudo soctalk install --demo --yes`。

无人值守，由环境变量驱动（复制随附的模板）：

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

当 `SOCTALK_MSSP_NAME`、`SOCTALK_ADMIN_EMAIL` 和 `SOCTALK_ADMIN_PASSWORD`
全部设置后，安装程序会跳过其同意提示，因此这会在无需任何
交互的情况下运行。`install` 之后的任何参数都会透传给安装程序，例如
`soctalk install --chart-version 0.2.0` 用于固定某个 chart，或
`soctalk install --values-file /etc/soctalk/values.yaml` 用于隔离网络（air-gapped）
安装。完整的标志参考以及基于 Cilium 的集群路径请参见[生产环境安装](/zh-cn/install)。

## 管理安装

CLI 封装了常见的集群操作，因此你无需记住
`KUBECONFIG` 路径或 Helm release 名称。

```bash
soctalk status              # pods and their readiness in soctalk-system
soctalk logs api            # tail a component's logs (api, app-ui, postgres)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk logs` 覆盖 `soctalk-system` 中的控制平面。诸如适配器和 runs-worker
之类的按租户工作负载位于 `tenant-<slug>` 命名空间中，因此请改用
`kubectl` 针对该命名空间进行操作。

`soctalk upgrade` 就是一次 `helm upgrade --install`，因此可以安全地重复运行，
也是你在安装新软件包后迁移到更新 chart 的方式。

## 卸载

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

移除操作系统软件包（`dnf remove soctalk` 或 `apt remove soctalk`）会删除
CLI 和安装程序，但不会触及正在运行的集群。如果你想彻底清除 SOC 栈，
请先运行 `soctalk uninstall`。

## 操作系统特定说明

### RHEL、Fedora、AlmaLinux、Rocky

#### SELinux

已在 SELinux 处于 **Enforcing** 模式的 Rocky Linux 9.8 上验证，涵盖仅控制平面的
安装以及带 Wazuh 支撑租户的完整安装。无需任何手动的 SELinux 操作。在
`soctalk install` 期间，K3s 安装程序自行拉入了 `k3s-selinux` 1.6 和
`container-selinux`，集群顺利启动，无人改动任何布尔值、标签或自定义模块。
两次运行都没有记录到 AVC 拒绝。

请注意这一结论的含义。它表示 SocTalk 在 targeted 策略下能够正确运行，
而不是说 SELinux 正作为加固层约束该工作负载。启用 K3s 自身的 SELinux 强制
（`--selinux` / `K3S_SELINUX=true`）并未测试。RHEL 10 还需要为 K3s 安装
`kernel-modules-extra` 包，这一点同样未经测试。

#### firewalld

用于验证的 Rocky Linux 9.8 GenericCloud 镜像根本不包含 firewalld，因此在
云上的 VM 里通常无需做任何事。完整的服务器安装则带有 firewalld 并处于启用状态。
在 firewalld 以默认策略运行时，安装会一直停滞，直到 K3s 的 pod 和 service
网络被设为受信任，因此在这类主机上，这一步是前置条件，而不是加固建议。

这个失败值得认清，因为它看上去并不像防火墙问题。K3s 安装顺利，节点变为
`Ready`，镜像可以拉取，所有 pod 也都完成调度。真正中断的是 flannel 网桥上的
pod 到 pod 以及 pod 到 Service 的流量，于是 API 的 `db-init` 初始化容器无法
连上 Postgres，不断循环报 `No route to host`，而 Postgres 自身却安然处于
`1/1 Running`。随后安装会耗尽整个 Helm `--wait` 窗口，最终因超时失败，
真正的原因则埋在某个初始化容器的日志里。

请信任 K3s 的 pod 和 service 网络，并开放你实际用来访问 UI 的 ingress 端口：

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

这些都是 K3s 的默认值；如果你设置了自定义的集群或 service CIDR，请改用那些值。
多节点集群需要在节点之间开放更多端口（参见 K3s 网络要求）。

如果你在安装仍处于等待状态时应用这些规则，它会在下一次重试时恢复并完成；
你不必从头开始。如果 Helm 已经超时，请应用规则并重新运行 `sudo soctalk install`。
在 v0.2.0 之后，安装程序的预检会检查这一点，并在改动主机之前打印这些命令
（[soctalk#118](https://github.com/soctalk/soctalk/issues/118)）。

SocTalk 不会替你修改 firewalld 规则。那是属于你自己的安全边界，需要你来开放。

#### sudo 与 /usr/local/bin

K3s 和 Helm 会把它们的二进制文件以及 `kubectl` 符号链接安装到
`/usr/local/bin`。RHEL 系发行版并未把该目录纳入 sudo 的
`secure_path`（`Defaults secure_path = /sbin:/bin:/usr/sbin:/usr/bin`），因此直接执行
`sudo k3s ...`、`sudo kubectl ...` 或 `sudo helm ...` 会得到
`command not found`，尽管二进制文件就在那里，安装也确实成功了。

`soctalk` CLI 会自行解析这些路径，因此 `sudo soctalk install`、
`soctalk status` 和 `soctalk logs` 都可以按文中所写直接使用。当你需要直接使用
`kubectl` 时，要么给出完整路径，要么把该目录加入你自己的 `PATH`：

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

本站其他文档有时会把它写成 `sudo k3s kubectl ...`，这在 Debian 和 Ubuntu
上是正确的，但在 RHEL 系主机上需要完整路径。

### Alpine 及其他非 systemd 主机 {#alpine-and-other-non-systemd-hosts}

**SocTalk 的安装程序需要 systemd。** 它会将 K3s 作为 systemd 服务拉起，
并等待由 systemd 写入的 kubeconfig，因此它无法在 Alpine
（OpenRC）或任何其他非 systemd 的 init 上运行。在这样的主机上，`soctalk install`
会提前停止，并给出清晰的提示告知你原因。因此没有发布 `.apk`。

若要在你原本考虑使用 Alpine 的场景中运行 SocTalk，请使用 systemd
发行版（上文的 `.deb` 或 `.rpm` 路径）或预构建的
[演示 VM 镜像](/zh-cn/quickstart-vm)。

## 我该用哪条路径？

- **操作系统软件包（本页）**：你自己管理、由系统软件包管理器
  跟踪的 Linux 主机。适合可重复、配置管理式的安装。
- **[一条命令安装](/zh-cn/install)**：在裸 Ubuntu VM 上执行
  `curl … | install.sh | bash`，与不带软件包封装的安装程序相同。
- **[演示 VM 镜像](/zh-cn/quickstart-vm)**：带浏览器安装向导的预构建
  设备镜像，是评估阶段最快得到可运行系统的方式。

这三条路径最终都落在同一个 `soctalk-system` chart 和同一套正在运行的 SOC 上。
