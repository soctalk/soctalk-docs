# 从操作系统软件包安装（rpm / deb）

每个 SocTalk 版本都会在发布 VM 镜像的同时，为两大基于 systemd 的 Linux
发行版家族提供原生的操作系统软件包，与版本标签附加在同一个 GitHub Release 上：

| 文件 | 包管理器 | 已验证于 | 预期同样可用 |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9 | RHEL、Fedora、AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

两者都经过端到端验证：安装软件包，运行 `soctalk install`，打开
Web 应用并登录。“预期同样可用”一列属于同一个软件包家族，
只是未在这些具体的发行版上做过测试。

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
soctalk status              # pods and their readiness in the soctalk namespace
soctalk logs api            # tail a component's logs (api, orchestrator, adapter, app-ui)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

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

已在 SELinux 处于 **Enforcing** 模式的 Rocky Linux 9 上验证。无需任何手动的
SELinux 操作即可运行：K3s 安装程序会在 `soctalk install` 期间自动拉入
`k3s-selinux` 和 `container-selinux` 策略包，因此集群会在 Enforcing 下正常启动。
请注意，这意味着“在 targeted 策略下正确运行”，而不是说 SELinux
正作为加固层来约束该工作负载；启用 K3s 自身的 SELinux 强制
（`--selinux` / `K3S_SELINUX=true`）在此并未测试。RHEL 10 还需要为 K3s 安装
`kernel-modules-extra` 包，这一点也未经测试。

如果 **firewalld**处于活动状态（在完整的 RHEL 服务器安装中常见，但在
最小化云镜像上通常不是），它可能会阻断集群流量，其表现为 pods
卡在 `ContainerCreating` 状态，或 Web 应用无法访问。请信任 K3s 的 pod
和 service 网络，并开放你实际用来访问 UI 的 ingress 端口：

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

`10.42.0.0/16` 和 `10.43.0.0/16` 是 K3s 的默认值；如果你设置了
自定义的集群或 service CIDR，请改用那些值。多节点集群需要在节点之间
开放更多端口（参见 K3s 网络要求）。

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
