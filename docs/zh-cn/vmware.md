# 在 VMware ESXi 上运行演示虚拟机

将发布的 `soctalk-demo-<ver>.vmdk` 导入 VMware ESXi 并启动。本指南针对使用内置 Host Client（浏览器 UI）的 **ESXi 7/8**。如果你改在笔记本上运行 Fusion 或 Workstation，流程几乎相同；通过“文件 → 打开”导入同一个 vmdk 即可。

此路径面向在既有本地 ESXi 上运行 SocTalk 的**评估者和演示场景**。如需在你自己的 Kubernetes 集群上进行生产安装，请参阅 [安装](/zh-cn/install)。已在 ESXi 8.0.3（build 24677879）配合 Host Client 2.x 上验证。

## 前提条件

- ESXi 7.0 或更高版本，且已有用户数据存储（VMFS）。如果你还没有数据存储，下方的 [新建数据存储小节](#optional-create-a-vmfs-datastore) 会逐步说明。
- Root 用户，或具有 `Virtual machine.Provisioning.Deploy from template` 权限的用户。
- 一个端口组（通常是自动创建的 **VM Network**），具备 DHCP + 出站 HTTPS。
- 数据存储上约 10 GB 的可用空间（vmdk 采用 streamOptimized 格式，约 800 MB，但会转换为 60 GB 的精简 VMFS 磁盘并按需增长）。
- 一对 SSH 密钥（示例中为 `~/.ssh/id_ed25519.pub`），用于通过 SSH 读取安装令牌。

::: warning 你需要的是真正的 VMFS 数据存储，而不是 ESXi OSDATA 卷
ESXi 安装程序会在引导磁盘上创建一个 `OSDATA-*` 卷。它会出现在 `esxcli storage filesystem list` 中并挂载于 `/vmfs/volumes/` 下，但它**不是**普通的用户数据存储，存放于其上的虚拟机在开机时会失败并报错 `msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`。请在继续之前添加一块单独的磁盘或分区，并将其格式化为 VMFS。
:::

## 1. 下载并校验镜像

从 [下载](/zh-cn/downloads) 页面获取 **vmdk**。在任何装有 `ovftool` 的 Linux/macOS 主机上，或通过 SSH 进入具备控制台访问权限的 ESXi 虚拟机：

```bash
VER=0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

现在你得到了 `soctalk-demo-<ver>.vmdk`，一个 **streamOptimized**（托管型）VMware 磁盘。ESXi 的 VMFS 无法直接运行它；§4 会用 `vmkfstools` 将其转换一次。

## 2. 构建 cloud-init 种子 ISO

一个小型的 NoCloud 种子 ISO 会用你的 SSH 密钥创建一个 `ops` 用户，以便你读取每次启动时的安装令牌。如果跳过此步，你仍可以用构建时的 `ubuntu:packer` 用户登录（参见 [SSH 访问](/zh-cn/quickstart-vm#ssh-access-credentials)）——但该凭据存在于公开源码树中，因此在对外暴露虚拟机之前请先加固它。在 Linux/macOS 上：

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat ~/.ssh/id_ed25519.pub)
EOF
printf 'instance-id: soctalk-demo\nlocal-hostname: soctalk-demo\n' > meta-data
# Linux: genisoimage / cloud-localds   •   macOS: hdiutil or mkisofs (brew install cdrtools)
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
```

## 3.（可选）创建 VMFS 数据存储

如果你的 ESXi 已有一个可用空间达 10+ GB 的用户数据存储（例如 `datastore1`），可跳过此步。

登录 Host Client，进入 **Storage** → **Datastores**。一个尚未分配数据磁盘的安装看起来是这样：

![ESXi Host Client — 没有数据存储的 Storage 标签页](/screenshots/esxi-storage-empty.png)

点击 **New datastore** 打开 5 步向导。

**步骤 1 — 选择创建类型。** 选择 **Create new VMFS datastore**。点击 Next。

![新建数据存储步骤 1 — 创建类型](/screenshots/esxi-new-datastore-01-type.png)

**步骤 2 — 命名并选择设备。** 输入名称（`datastore1` 是惯例）并选择要格式化的磁盘。此处只显示未被占用的磁盘。

![新建数据存储步骤 2 — 命名](/screenshots/esxi-new-datastore-02-name.png)
![新建数据存储步骤 3 — 设备选择](/screenshots/esxi-new-datastore-03-device.png)

**步骤 3 — 选择分区选项。** 默认：**Use full disk, VMFS 6**。确认后点击 Next。

![新建数据存储步骤 4 — 分区](/screenshots/esxi-new-datastore-04-partition.png)

**步骤 4 — 准备完成。** 核对摘要后点击 **Finish**。ESXi 会警告磁盘将被重新分区；确认即可。

![新建数据存储步骤 5 — 检查](/screenshots/esxi-new-datastore-05-review.png)

**结果。** Storage → Datastores 现在显示了新的 VMFS6 数据存储。近期任务中报告 **Create Vmfs Datastore** 和 **Rescan Vmfs** 均已成功完成。

![数据存储已创建](/screenshots/esxi-datastore-created.png)

## 4. 上传并转换 vmdk

来自 GHCR 的 vmdk 是 streamOptimized 格式。ESXi 的虚拟机子系统需要一个 VMFS 精简磁盘。两种路径：

::: code-group

```bash [SSH + vmkfstools（推荐）]
# Enable SSH on the ESXi host: Host Client → Actions → Services → Enable SSH
# Copy the vmdk to the datastore (from any host that has scp)
DS=/vmfs/volumes/datastore1
scp soctalk-demo-0.2.0.vmdk root@<esxi-host>:$DS/soctalk-source.vmdk

# On the ESXi host: convert to VMFS thin (~1 minute on a fast SSD)
ssh root@<esxi-host>
mkdir -p /vmfs/volumes/datastore1/SocTalk-Demo
vmkfstools -i /vmfs/volumes/datastore1/soctalk-source.vmdk \
           /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmdk -d thin
rm /vmfs/volumes/datastore1/soctalk-source.vmdk
```

```bash [从你的工作站运行 ovftool]
# Wraps the vmdk into a minimal OVF and pushes to ESXi in one command
ovftool --acceptAllEulas --diskMode=thin \
  --datastore=datastore1 \
  --net:"VM Network"="VM Network" \
  --name=SocTalk-Demo \
  soctalk-demo-0.2.0.vmdk \
  vi://root:<password>@<esxi-host>
```

:::

同样通过 **Storage → Datastore browser → Upload** 上传种子 ISO：

```
[datastore1]/SocTalk-Demo/soctalk-seed.iso
```

## 5. 创建虚拟机

在 Host Client 中进入 **Virtual Machines**，点击 **Create / Register VM** 打开 5 步向导。

![Create / Register VM 向导](/screenshots/esxi-create-vm-wizard.png)

按向导操作：

- **Select creation type** — **Register an existing virtual machine**（我们已在步骤 4 中放置了 vmdk）。

如果你的 ESXi 版本隐藏了该选项，或你更愿意在向导中配置全部内容，请改选 **Create a new virtual machine** 并使用以下设置：

- **Select a name and guest OS** — 名称 `SocTalk-Demo`。兼容性 `ESXi 8.0 virtual machine`。客户机操作系统系列 `Linux`。客户机操作系统版本 `Ubuntu Linux (64-bit)`。
- **Select storage** — `datastore1`。
- **Customize settings** — 设置：
  - **CPU** 4
  - **Memory** 8 GB
  - **Hard disk 1** — 点击磁盘行 → **Existing hard disk**，浏览到 `[datastore1] SocTalk-Demo/SocTalk-Demo.vmdk`
  - **Network adapter 1** — 网络 `VM Network`，适配器类型 `VMXNET3`（VMware 推荐的半虚拟化 NIC；在裸机 ESXi 上使用它以获得最佳性能）
  - **CD/DVD drive 1** — Datastore ISO file，浏览到 `soctalk-seed.iso` — 勾选 **Connect at power on**
  - USB 控制器和软盘保持默认。
- **Ready to complete** — Finish。

虚拟机随即出现在 Virtual Machines 列表中，`Register VM` 标记为已成功完成。

![虚拟机已在 datastore1 上注册](/screenshots/esxi-vm-registered.png)

## 6. 开机并打开控制台

选择 **SocTalk-Demo** 并点击 **Power on**。标题栏切换为绿色的开机状态，控制台缩略图开始更新。

![虚拟机已开机，可见硬件面板](/screenshots/esxi-vm-powered-on.png)

点击 **Console** → **Open browser console**（独立标签页比内嵌预览更便于输入）。

![控制台下拉菜单](/screenshots/esxi-console-menu.png)

控制台显示 Ubuntu 24.04 经由 cloud-init 启动并进入登录提示符：

![虚拟机控制台 — Ubuntu 启动至登录](/screenshots/esxi-vm-console-boot.png)

## 7. 登录虚拟机

你有两种登录方式，两者都能给你一个可通过 `sudo -i` 提权为 root 的 shell。

::: code-group

```bash [以 ops 身份 SSH（需要种子 ISO）]
# From the host whose SSH public key is in the seed ISO you built in §2.
# The VM's IP shows in the Host Client under SocTalk-Demo →
# General information → Networking.
ssh ops@<vm-ip>

# From the ops shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
whoami         # → root
```

```bash [以 ubuntu:packer 身份 SSH（回退方案 — 无种子 ISO）]
# Every published image ships a build-time ``ubuntu`` account with password
# ``packer``. This credential is in the public source tree, so treat it as
# public information; harden or delete the account before exposing the VM.
ssh ubuntu@<vm-ip>
# Password: packer

# From the ubuntu shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
```

```text [浏览器控制台（无可用 SSH）]
# Host Client → SocTalk-Demo → Console → Open browser console
# Same credentials as the SSH tabs above.

packer-build login: ubuntu
Password: packer                    # not echoed on screen

ubuntu@packer-build:~$ sudo -i
root@packer-build:~#
```

:::

::: warning 在对外暴露虚拟机之前，加固或删除 packer 凭据
`ubuntu:packer` 登录凭据被烧录进每一个发布镜像中，并存在于公开源码树里。对任何将离开隔离实验环境的虚拟机执行：`sudo passwd -l ubuntu`（锁定账户），再加上 `sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null && sudo systemctl reload ssh`。完整的加固说明参见 [SSH 访问 + 凭据](/zh-cn/quickstart-vm#ssh-access-credentials)。
:::

## 8. 读取安装令牌

从持有种子 ISO 中对应 SSH 私钥的主机上执行：

```bash
# Find the VM's IP: Host Client → SocTalk-Demo → General information → Networking
ssh ops@<vm-ip> sudo cat /run/soctalk/setup-token
```

复制令牌，然后在浏览器中打开 **https://\<vm-ip\>/**，在向导提示时粘贴它。从 [Quickstart VM 步骤 6](/zh-cn/quickstart-vm#_6-open-the-setup-wizard) 继续。

安装完成后，你将进入 MSSP Dashboard：

![ESXi 上的 SocTalk MSSP 仪表盘](/screenshots/esxi-soctalk-mssp-dashboard.png)

## 故障排查

除非条目带有 **(nested lab only)** 标签，否则以下条目适用于真实的裸机 ESXi 主机。带标签的条目是在嵌套 ESXi（在 Ubuntu 24.04 下作为 KVM 客户机运行的 ESXi 8.0.3）上验证本指南时出现的，不影响生产硬件。

**`msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`** — 虚拟机文件位于 `/vmfs/volumes/OSDATA-*` 下，而不是真正的用户数据存储上。移动它们：用 `vmkfstools -i` 将 vmdk 转入真正的 VMFS 数据存储（§3 + §4），把 `.vmx` 一并复制过去，注销旧虚拟机（`vim-cmd vmsvc/unregister <id>`），并注册新的（`vim-cmd solo/registervm /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmx SocTalk-Demo`）。

**虚拟机启动了但网络接口处于 DOWN 状态且始终获取不到 IP** — packer 镜像自带一份按 MAC 匹配的 netplan 配置。当 ESXi 为 vNIC 分配了新的 MAC 时，匹配失败，DHCP 便永不运行。修复方法是编辑 `/etc/netplan/50-cloud-init.yaml`，改为按接口名称匹配：

```yaml
network:
  version: 2
  ethernets:
    all:
      match:
        name: "en*"
      dhcp4: true
```

然后执行 `netplan apply`。

**`ovftool: error while loading shared libraries: libssl.so.1.1`** — 安装一个兼容的 OpenSSL 1.1 运行时，或改用 SSH + `vmkfstools` 路径。

**Host Client 显示一条关于 ESXi Shell / SSH 已启用的红色横幅** — 在评估环境中这是预期的。它是一条加固提醒，而非错误。如果主机对外暴露，完成后请禁用 SSH。

### 仅限嵌套实验环境

以下情况出现在 ESXi 本身作为客户机运行于另一个虚拟机监控程序（KVM、VirtualBox、Fusion、Workstation，或云端“准裸机”实例）之中时。在真实的裸机 ESXi 上你不会遇到任何一项；§5 的默认设置（VMXNET3 NIC、硬件版本 20、启用 USB + 软盘）可原样使用。

**开机失败并报 `E1000PCI: failed to register e1000e device` 或 `Vmxnet3 PCI: failed to reserve slot`（仅限嵌套实验环境）** — 外层虚拟机监控程序没有为 ESXi 模拟足够的 PCIe 拓扑来为半虚拟化 NIC 分配插槽。编辑 `SocTalk-Demo.vmx` 并设置 `ethernet0.virtualDev = "e1000"`（占用资源更少的经典模拟 NIC），然后执行 `vim-cmd vmsvc/reload <id>` 并重新开机。在真实硬件上，请保留 VMXNET3。

**在硬件版本 20 上 vmx 因信号 11 而段错误 / `msg.vmx.poweron.failed`（仅限嵌套实验环境）** — 某些外层虚拟机监控程序不宣告 vmx-20 所假定的较新 PCIe/EPT 特性。编辑 `SocTalk-Demo.vmx`，将其降到 `virtualHW.version = "15"`，删除 `usb.present = "TRUE"` 和 `floppy0.present = "TRUE"`（或将两者都设为 `"FALSE"`），然后执行 `vim-cmd vmsvc/reload <id>` 再试一次。真实的裸机 ESXi 可正常运行 vmx-20。
