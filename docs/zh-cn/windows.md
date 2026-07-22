# 在 Windows 上运行（WSL2）

SocTalk 是 Kubernetes 原生的。在 Windows 上，它以 **WSL2 中的 k3s（轻量级 Kubernetes）** 形式运行——只需一条 PowerShell 命令即可为你完成安装与连接。无需 Docker Desktop。

::: tip 只是想评估一下？
**[VM 设备镜像](/zh-cn/downloads)**（Hyper-V `vhdx` 或 [VirtualBox](/zh-cn/virtualbox)）是在 Windows 上试用 SocTalk 最简单、最稳健的方式——它是一个自包含的 Linux VM，无需任何配置。本页介绍的 WSL2 路径是面向那些不愿运行完整 VM 的开发者的本地集群便捷选项。
:::

::: warning 架构
SocTalk 镜像**仅支持 amd64**，因此可在 **Windows x64** 上运行。在 ARM 版 Windows 上，该镜像集需要模拟运行。
:::

## 前提条件

- **Windows 10 2004（build 19041）或更新版本，或 Windows 11**——x64
- **管理员**权限的 PowerShell（安装程序会启用 Windows 功能并配置 WSL2）
- 固件中**已启用 CPU 虚拟化**（WSL2 需要它；在 VM 中，请启用嵌套虚拟化）

你**无需**预先安装 WSL2、Ubuntu 或 Docker——安装程序会处理这一切。

## 一键安装

以**管理员身份打开 PowerShell**并运行：

```powershell
irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1 | iex
```

安装过程：

1. **启用 WSL2**（需重启一次——重新登录后，安装会在你下次登录时**自动恢复**；WSL2 无法以 SYSTEM 账户运行，因此恢复过程在你的会话中进行）。
2. **导入一个 Ubuntu** 发行版并在其中启用 systemd。
3. 在 WSL2 内**将 k3s 安装**为 systemd 服务，随后部署 SocTalk 并载入一个 **`demo` 租户**。
4. **将 UI 暴露给 Windows**，地址为 **`https://localhost/`**（一个 `netsh portproxy` 将流量转发到 WSL2 内的集群；一个登录任务会在重启后刷新它）。

安装完成后会打印 URL 和演示凭据。在浏览器中打开 **`https://localhost/`**，接受自签名证书，然后登录。

若要进行**正式（非演示）**安装，请传入 `-Real`，系统会提示你输入 MSSP 名称、管理员邮箱/密码以及 LLM 密钥（或设置 `SOCTALK_*` 环境变量）：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1))) -Real
```

## 幕后原理

PowerShell 安装程序会引导 WSL2，然后运行与 Linux 设备镜像**相同的 `install.sh`**，以 k3s 作为运行时：

```bash
# inside the WSL2 Ubuntu distro, as root:
curl -sfL https://get.k3s.io | sh -          # k3s as a systemd service
helm upgrade --install soctalk-system \
  oci://ghcr.io/soctalk/charts/soctalk-system --version 0.2.0 \
  --namespace soctalk-system --create-namespace -f values.yaml
```

ingress 主机为 `localhost`，一个 Windows `netsh portproxy`（`localhost:443` → WSL2 IP）使其可从你的浏览器访问。

## 注意事项

- 需**重启一次**才能完成 WSL2 的启用；之后重新登录，安装会自行继续。
- **保持集群的 WSL 发行版处于运行状态**——k3s 就运行在其中。安装程序设置了 `vmIdleTimeout=-1`，使 WSL2 不会因空闲而退出；一个登录任务会在 Windows 重启后重新启动 WSL 并刷新 `localhost` 转发。
- WSL2 路径是**本地集群便捷**选项。对于 Windows 上始终在线/类生产环境的安装，请优先选择 **[VM 设备镜像](/zh-cn/downloads)**（Hyper-V/VirtualBox）——一个单独的 Linux VM，没有 WSL2 网络方面的活动部件。
- amd64 镜像 → 仅限 Windows **x64**。

## 拆除

```powershell
# remove the host forward + logon tasks
netsh interface portproxy reset
Get-ScheduledTask SocTalk* | Unregister-ScheduledTask -Confirm:$false

# remove the cluster (inside WSL) and/or the whole distro
wsl -d Ubuntu -u root -- /usr/local/bin/k3s-uninstall.sh
wsl --unregister Ubuntu      # optional: remove the distro entirely
```

## 故障排查

| 现象 | 检查 |
|---|---|
| 重启后安装未继续 | 以**同一用户**重新登录——恢复过程在你登录时运行。重新运行 `install.ps1` 是安全的（已完成的步骤会被跳过）。 |
| `https://localhost/` 无法加载 | WSL2 IP 可能已变更；`SocTalkExpose` 计划任务会刷新转发——运行它（`Start-ScheduledTask SocTalkExpose`）或重新运行安装，然后重试。 |
| `https://localhost/` 返回 `503` | 转发正常但 Pod 尚未就绪——运行 `wsl -d Ubuntu -u root -- k3s kubectl -n soctalk-system get pods` 并等待其变为 `Running`。 |
| WSL2 无法启动 | 在固件中启用 CPU 虚拟化（VT-x/AMD-V）；在 VM 中，请启用嵌套虚拟化。 |
| 向导之后的任何问题 | 与所有平台相同——参见 [Quickstart 故障排查表](/zh-cn/quickstart-vm#troubleshooting)。 |
