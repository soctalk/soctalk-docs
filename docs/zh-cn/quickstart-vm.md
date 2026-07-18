# 快速开始：SocTalk 演示 VM

端到端试用 SocTalk 的最快方式：下载一个预构建的 VM 镜像，启动它，在浏览器中打开安装向导，逐步点击完成。五分钟即可获得一套运行中的多租户安装，并已完成一个演示租户的接入。

此路径面向**评估者和演示**——若要在你自己的集群上进行生产安装，请参阅[安装](/zh-cn/install)。

## 镜像内含什么

- Ubuntu 24.04 LTS，已启用 cloud-init
- K3s，捆绑 Traefik ingress
- Helm，以及一个预拉取的 `soctalk-system` chart
- 位于 `:8443` 的首次启动安装向导
- 一个首次启动安装器（`soctalk-firstboot.service`），在向导收集完配置后运行
- 无论采用何种格式（qcow2 / vmdk / vhdx / vhd / raw），镜像内容都相同；选择你的虚拟机管理程序原生支持的那一种即可。参阅[下载](/zh-cn/downloads)。

## 1. 下载

在[下载](/zh-cn/downloads)页面上，选择适用于你的虚拟机管理程序的格式。示例：

```bash
# KVM / Proxmox / libvirt
curl -L -o soctalk-demo.qcow2.xz \
  https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-<ver>.qcow2.xz
xz -d soctalk-demo.qcow2.xz
```

校验校验和：

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 2. 启动镜像

### KVM / libvirt（CLI）

```bash
qemu-system-x86_64 \
  -m 8G -smp 4 -enable-kvm -cpu host \
  -drive file=soctalk-demo.qcow2,format=qcow2,if=virtio \
  -netdev user,id=net0,hostfwd=tcp::18022-:22,hostfwd=tcp::18443-:8443 \
  -device virtio-net,netdev=net0 \
  -nographic
```

### Proxmox VE

执行 `qm disk import <vmid> soctalk-demo.qcow2 <storage>`，然后作为 SCSI 挂载并启动。带 Web UI 截图的完整演练：[在 Proxmox 上运行](/zh-cn/proxmox)。

### VMware

将 `soctalk-demo.vmdk` 作为已有磁盘导入到一台新 VM（Linux，Ubuntu 64 位）。

### VirtualBox

将 `soctalk-demo.vmdk` 转换为 VDI 并挂载到一台新 VM。带截图的完整演练：[在 VirtualBox 上运行](/zh-cn/virtualbox)。

### Hyper-V

在**第 1 代（Generation 1）**VM 上使用 `soctalk-demo.vhdx` 作为操作系统磁盘（该镜像通过 BIOS 固件启动；第 2 代 / UEFI 未经测试）。若要注入 SSH 密钥，请将一个 NoCloud `seed.iso` 作为 DVD 驱动器挂载——参阅[可选：cloud-init seed](#optional-cloud-init-seed)。

### AWS

使用 Packer 构建原生 AMI，或使用 VM Import 将 `soctalk-demo.vmdk` 导入为 AMI。完整演练：[在 AWS 上运行](/zh-cn/aws)。

### Azure

将 `soctalk-demo.vhd`（固定大小）直接上传到一个 Managed Disk，然后由它创建一个第 1 代镜像和 VM。完整演练：[在 Azure 上运行](/zh-cn/azure)。

### Raw / dd

`soctalk-demo.raw` 与磁盘上的内容逐位一致。适用于通用云镜像导入（GCP、OpenStack），或用 `dd` 写入物理磁盘。

**最低规格**：4 vCPU、8 GB 内存、60 GB 磁盘。参阅[规格](/zh-cn/reference/sizing)。

## 3. 获取安装令牌

向导以 TLS（自签名）绑定 `:8443`。在没有每次启动生成的安装令牌时，它会拒绝连接。SSH 登录到该机器并读取令牌：

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

推荐的登录方式是**使用你的 SSH 密钥的 `ops` 用户**，该用户由下方[§ 可选：cloud-init seed](#optional-cloud-init-seed)中的 cloud-init seed 创建。如果你在没有 seed 的情况下启动，请参阅[§ SSH 访问 + 凭据](#ssh-access-credentials)了解构建时的备用方式——在将该 VM 暴露到你不信任的网络之前，务必先阅读那里的安全说明。

## 4. 打开向导

浏览到 `https://<vm-ip>:8443/`。接受自签名证书。你将进入令牌输入页面：

![安装向导 — 令牌输入](/screenshots/setup-wizard-token.png)

粘贴令牌，然后填写：

- MSSP / 组织名称
- 主机名（可选——留空则使用该机器的 IP）
- 管理员邮箱 + 密码（至少 12 个字符）
- LLM 提供商 + API key

完整字段参考请参阅[安装向导](/zh-cn/setup-wizard)。

提交。向导写入 `values.yaml`、LLM Secret 以及一个接入 env-file，然后退出。首次启动安装器接管：

1. 启动 k3s
2. 创建 `soctalk-system` namespace + LLM Secret
3. 执行 `helm install soctalk-system`
4. 以引导管理员身份登录，并通过 `POST /api/mssp/tenants/onboard` 接入一个 `demo` 租户

从提交开始的总耗时：约 2 分钟使 `soctalk-system` 的 pod 就绪（Ready），然后再用 1–3 分钟使演示租户的 Wazuh 栈达到就绪（Ready）。

## 5. 登录

浏览到 `https://<vm-ip>/`（注意：端口为 443，而非 8443——向导专门绑定 8443 以避免与 Traefik 冲突）。MSSP 仪表盘需要一个 DNS 名称；如果你使用了空白主机名，请添加一条 `/etc/hosts` 条目，将 `soctalk.local` 指向该 VM 的 IP，然后浏览到 `https://soctalk.local/`。

使用你在向导中设置的管理员邮箱 + 密码登录。你将进入 MSSP 仪表盘。继续阅读 [MSSP UI 导览](/zh-cn/mssp-ui)。

## 可选：cloud-init seed

如果你想注入 SSH 密钥（或直接提供 values.yaml 以完全跳过向导），请通过 NoCloud 传入 cloud-init user-data：

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
echo "instance-id: $(uuidgen)" > meta-data
cloud-localds seed.iso user-data meta-data

# attach seed.iso as a second drive on first boot.
```

若要跳过向导，请通过 cloud-init `write_files` 放置 `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key`；向导的 systemd 条件（`ConditionPathExists=!/etc/soctalk/values.yaml`）将短路，安装器直接进入 `helm install`。

## SSH 访问 + 凭据

可下载的磁盘镜像（qcow2 / vmdk / vhdx / vhd / raw）都随附**两种**可能的登录身份。你使用哪一种取决于你是否提供了 cloud-init user-data。

### 生产环境：`ops` 用户（推荐）

[§ 可选：cloud-init seed](#optional-cloud-init-seed)中的 cloud-init seed 会创建一个带有你的 SSH 密钥的 `ops` 用户。仅支持 SSH 密钥认证——不设置密码。

```bash
ssh -i ~/.ssh/<your-private-key> ops@<vm-ip>

# Root shell, no further password
sudo -i
```

### 构建时的 `ubuntu` 用户（存在于每个交付的镜像中）

Packer 构建使用一个带有已知密码的构建时 `ubuntu` 用户。本应锁定该账户的清理步骤尚未接入，因此它会随镜像交付。如果你在没有 cloud-init seed 的情况下启动，这是通过 SSH 获得控制台访问的唯一方式：

| 用户 | 密码 | Sudo |
|---|---|---|
| `ubuntu` | `packer` | `ALL=(ALL) NOPASSWD:ALL` |

同一个 seed 启用了密码 SSH 认证，因此该镜像接受：

```bash
# Interactive
ssh ubuntu@<vm-ip>
# password: packer

# Non-interactive (requires sshpass)
sshpass -p packer ssh -o StrictHostKeyChecking=accept-new ubuntu@<vm-ip>

# Root shell, no further password
sudo -i
```

### 加固清单

在首次启动后以 `ops` 身份运行，或将其折叠进你的 cloud-init `runcmd:` 以便自动执行：

```bash
# Disable the build user
sudo passwd -l ubuntu
sudo usermod -s /usr/sbin/nologin ubuntu

# Turn off password SSH auth
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```

AWS AMI 由一个独立的 Packer 源（`amazon-ebs`）构建，该源不包含 seed，而是改用 EC2 的密钥对注入——它不携带 `ubuntu:packer` 凭据。加固清单对它的标准 AMI `ubuntu` 云镜像用户仍然适用。

## 下一步：使用 Launchpad 接入客户

你刚刚在一台单一的同机部署机器上端到端运行了 SocTalk。自然的下一步是一次真正的试点——在你自己的基础设施上部署一个 MSSP 控制平面加上一个或多个租户环境。[**Launchpad**](/zh-cn/launchpad) 用一条命令实现这一点：它启动这些 VM，将它们加入你的 tailnet，从公共源安装 SocTalk，并交给你一个 URL。（更愿意手动执行每一步？参阅[自助式 MSSP 试点](/zh-cn/mssp-pilot)。）

## 故障排查

| 症状 | 检查 |
|---|---|
| 向导 URL 始终无法加载 | 在 VM 上执行 `systemctl status soctalk-setup-wizard`。若为 `inactive`，查看 `journalctl -u soctalk-setup-wizard` |
| 向导提示 "invalid token" | 令牌位于 `/var/log/soctalk-setup-token`，**归 root 所有**。使用 `sudo cat`。每次启动都会重新生成令牌 |
| 向导提示 "rate-limited" | 令牌尝试失败 10 次后，向导会锁定该 IP。等待 1 小时，或执行 `systemctl restart soctalk-setup-wizard`（这也会轮换令牌） |
| `helm install` 卡住 | 在该机器上执行 `kubectl get pods -A`；`journalctl -u soctalk-firstboot -f` |
| 演示租户的 adapter / runs-worker pod 卡在 ImagePullBackOff | 已知问题：控制器默认使用了一个未发布的镜像 tag。参阅[故障排查](/zh-cn/troubleshooting) |

若要进行干净重置：删除 `/var/lib/soctalk-firstboot.done`、`/var/lib/soctalk-wizard.done`、`/etc/soctalk/values.yaml`，然后执行 `systemctl restart soctalk-setup-wizard`。
