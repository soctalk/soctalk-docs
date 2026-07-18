# 在 VirtualBox 上运行演示 VM

VirtualBox 是在桌面上试用 SocTalk 最简便的跨平台方式——免费、图形界面驱动，并支持 Windows、Linux 和 Intel 版 macOS。本指南将导入已发布的演示镜像并启动它。已在 VirtualBox 7.0 上验证。

此路径面向**评估者与演示场景**——若要在你自己的集群上进行生产环境安装，请参阅 [安装](/zh-cn/install)。

::: warning Apple Silicon（M 系列）Mac
演示镜像为 **x86-64** 架构，VirtualBox 无法在 Apple Silicon 上运行它。在 M 系列 Mac 上，请改用 [云端启动](/zh-cn/aws) 或其他宿主机。此处的 VirtualBox 指的是 Windows、Linux 或 **Intel** 版 Mac。
:::

## 前置条件

- [VirtualBox](https://www.virtualbox.org/) 7.0 或更新版本。
- 约 3 GB 可用磁盘空间，用于存放转换后的镜像。
- 一对 SSH 密钥（示例中为 `~/.ssh/id_ed25519.pub`），用于通过 SSH 读取安装令牌。

## 1. 下载并解压镜像

从 [下载](/zh-cn/downloads) 页面获取 **vmdk**（VirtualBox 兼容的 VMware 格式）：

```bash
VER=0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

## 2. 将 vmdk 转换为 VirtualBox 原生的 VDI

发布的 vmdk 采用 **streamOptimized** 格式（一种只读的 VMware/OVA 布局），VirtualBox 无法将其作为可写磁盘启动。请一次性将它转换为 VDI：

```bash
VBoxManage clonemedium disk soctalk-demo-0.1.4.vmdk soctalk-demo-0.1.4.vdi --format VDI
```

这将生成一个可写、动态分配大小的 `soctalk-demo-0.1.4.vdi`（磁盘上占用数 GB）。`VBoxManage` 随 VirtualBox 一起提供——在 Windows 上位于 `C:\Program Files\Oracle\VirtualBox\`。

## 3. 构建 cloud-init seed ISO

一个小型的 NoCloud seed ISO 会创建一个带有你 SSH 密钥的 `ops` 用户，以便你读取每次启动生成的安装令牌。如果你跳过此步骤，仍可以使用构建时的 `ubuntu:packer` 用户登录（参见 [SSH 访问](/zh-cn/quickstart-vm#ssh-access-credentials)）——但该凭据位于公开的源代码树中，因此在对外暴露之前请先加固该 VM。在 Linux/macOS 上：

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

## 4. 创建 VM

打开 **VirtualBox** 并点击 **New**。

![VirtualBox Manager](/screenshots/virtualbox-manager.png)

**Name and Operating System**——将其命名为 `soctalk-demo`，将 **Type** 设为 *Linux*，**Version** 设为 *Ubuntu (64-bit)*。ISO 保持为空：

![Name and OS](/screenshots/virtualbox-create-name.png)

**Hardware**——为其分配 **8192 MB** 内存和 **4 CPUs**（[规格建议](/zh-cn/reference/sizing) 的最低要求为 4 vCPU / 8 GB；Wazuh 技术栈需要这些内存）：

![Hardware](/screenshots/virtualbox-create-hardware.png)

**Virtual Hard disk**——选择 **Use an Existing Virtual Hard Disk File** 并选中你转换得到的 `soctalk-demo-0.1.4.vdi`：

![Use existing disk](/screenshots/virtualbox-create-disk.png)

**Summary**——确认设置并点击 **Finish**：

![Summary](/screenshots/virtualbox-create-summary.png)

该 VM 将出现在 Manager 中，其 VDI 挂载在 SATA 控制器上：

![VM created](/screenshots/virtualbox-vm-details.png)

## 5. 挂载 seed ISO 并设置网络

选中该 VM 并点击 **Settings**。

**Storage**——在 IDE 控制器下，点击光驱并选择你的 `soctalk-seed.iso`（点击光盘图标 → *Choose a disk file*）。VDI 已经挂载在 SATA 上：

![Storage](/screenshots/virtualbox-storage.png)

**Network**——将 **Adapter 1 → Attached to: Bridged Adapter**，使该 VM 在你的局域网上获得一个 IP，从而可以直接访问向导：

![Network — bridged](/screenshots/virtualbox-network.png)

点击 **OK**。

::: tip 使用 NAT 而非桥接
如果你无法使用桥接（例如在受限网络中），请保留默认的 NAT，并在 Network → Advanced 下添加 **Port Forwarding** 规则（宿主机 `8443` → 客户机 `8443` 用于向导，宿主机 `8080` → 客户机 `443` 用于 UI），然后在下文中使用 `localhost` 代替 VM 的 IP。
:::

## 6. 启动并查找 VM 的 IP

点击 **Start**。控制台启动后进入登录提示符：

![Console](/screenshots/virtualbox-console.png)

查找该 VM 的桥接 IP——可以从路由器的 DHCP 租约中查看，或通过匹配该 VM 的 MAC 地址：

```bash
VBoxManage showvminfo soctalk-demo | grep "MAC"      # note the MAC
arp -an | grep -i <mac>                               # find the matching IP
```

## 7. 运行向导并登录

通过 SSH 读取每次启动生成的安装令牌，然后运行向导：

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

浏览至 `https://<vm-ip>:8443/`，接受自签名证书，粘贴令牌，并填写向导（[字段参考](/zh-cn/setup-wizard)）。提交后，首次启动安装程序会运行 `helm install` 并接入 `demo` 租户——`soctalk-system` 的 Pod 约需 2 分钟，随后演示租户的 Wazuh 技术栈再需几分钟：

```bash
ssh ops@<vm-ip>
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

然后浏览至 `https://<vm-ip>/`（端口 443，而非 8443），使用向导设置的管理员凭据登录，并继续进行 [MSSP UI 导览](/zh-cn/mssp-ui)。如果你在向导中将主机名留空，请在你的 hosts 文件中将 `soctalk.local` 映射到该 VM 的 IP，并使用 `https://soctalk.local/`。

## 8. 拆除

```bash
VBoxManage controlvm soctalk-demo poweroff
VBoxManage unregistervm soctalk-demo --delete
VBoxManage closemedium disk soctalk-demo-0.1.4.vdi --delete
```

## 故障排查

| 症状 | 检查 |
|---|---|
| VM 无法启动："cannot open … streamOptimized" / 磁盘只读 | 你挂载的是原始 `.vmdk`。请使用第 2 步转换得到的 `.vdi` |
| 无法在 Apple Silicon Mac 上运行 | 属预期情况——镜像为 x86-64；请改用 [云端启动](/zh-cn/aws) |
| 控制台显示 `vmwgfx … unsupported hypervisor` 错误 | 无害——这是 VirtualBox 模拟的 GPU；该设备为无头模式，可正常启动 |
| VM 在桥接模式下没有 IP | 在 Network → Name 中选择正确的宿主机网卡；确认你的局域网有 DHCP。或使用上文的 NAT + 端口转发方案 |
| 无法读取令牌（无 SSH） | seed ISO 未挂载（Storage → IDE），或其密钥有误；请重新检查第 3/5 步 |
| 向导之后的任何问题 | 与所有平台相同——参见 [快速上手故障排查表](/zh-cn/quickstart-vm#troubleshooting) |
