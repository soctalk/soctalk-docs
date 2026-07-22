# 在 Proxmox VE 上运行演示 VM

将发布的 `soctalk-demo-<ver>.qcow2` 镜像导入 Proxmox VE 并启动。qcow2 是 Proxmox 的原生磁盘格式，因此这只需一条命令即可导入——无需转换步骤。

此路径面向**评估者与演示**——若要在你自己的集群上进行生产环境安装，请参阅 [安装](/zh-cn/install)。已在 Proxmox VE 8.4 上验证。

## 前提条件

- 一个 Proxmox VE 8.x 节点，可预留 ≥ 4 vCPU / 8 GB RAM / 60 GB 存储（[容量规划](/zh-cn/reference/sizing)）。
- 一个接受 **Disk image** 内容的存储（默认的 `local-lvm`，或启用了 *Disk image* 的目录型存储如 `local`）。
- 对该节点的 Shell 访问权限（磁盘导入是一条 `qm` 命令；其余操作都在 Web UI 中完成）。

## 1. 将镜像下载到节点上

SSH 登录到 Proxmox 节点：

```bash
VER=<ver>   # e.g. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.qcow2.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.qcow2.xz
```

## 2. 构建 cloud-init 种子 ISO

NoCloud 种子 ISO 会创建一个带有你 SSH 密钥的 `ops` 用户。没有它你仍可以用构建期的 `ubuntu:packer` 用户登录（参阅 [SSH 访问](/zh-cn/quickstart-vm#ssh-access-credentials)），但该凭据位于公开的源代码树中——在把 VM 暴露到你不信任的网络之前，请先提供种子。在该节点上，或任意 Linux 机器上：

```bash
cat > user-data <<'EOF'
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
cat > meta-data <<'EOF'
instance-id: soctalk-demo-001
local-hostname: soctalk-demo
EOF
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
# (apt install genisoimage if missing; cloud-localds from cloud-image-utils also works)
mv soctalk-seed.iso /var/lib/vz/template/iso/
```

如果你在别处构建了 ISO，则改为在 UI 中上传：选择 `local` 存储 → **ISO Images** → **Upload**。

::: tip
你可以完全跳过向导，方法是通过 `write_files` 把 `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` 加入种子——参阅 [可选：cloud-init 种子](/zh-cn/quickstart-vm#optional-cloud-init-seed)。
:::

## 3. 在 Web UI 中创建 VM

点击 **Create VM**（右上角）并按向导操作：

**General**——选择一个 VM ID 和名称：

![Create VM — General](/screenshots/proxmox-create-general.png)

**OS**——选择 **Do not use any media**（操作系统已经在导入的磁盘上）：

![Create VM — OS](/screenshots/proxmox-create-os.png)

**System**——保持默认值（SeaBIOS、i440fx——该镜像通过 BIOS 固件启动）。

**Disks**——用 `scsi0` 旁边的垃圾桶图标删除默认磁盘；导入的 qcow2 将取而代之：

![Create VM — Disks](/screenshots/proxmox-create-disks.png)

**CPU**——4 核，并将 **Type** 设为 `host`：

![Create VM — CPU](/screenshots/proxmox-create-cpu.png)

**Memory**——8192 MiB：

![Create VM — Memory](/screenshots/proxmox-create-memory.png)

**Network**——你的 LAN 桥（通常是 `vmbr0`），VirtIO 型号：

![Create VM — Network](/screenshots/proxmox-create-network.png)

**Confirm**——Finish。暂时不要启动 VM。

## 4. 导入磁盘

唯一的 CLI 步骤。在该节点上（调整 VM ID 与目标存储）：

```bash
qm disk import 100 soctalk-demo-<ver>.qcow2 local --format qcow2
```

在 LVM-thin 存储（`local-lvm`）上请去掉 `--format` 标志——块存储以 raw 格式存储。导入的磁盘会在 VM 上显示为 **Unused Disk 0**。

## 5. 挂载磁盘、种子 ISO 及启动顺序

回到 UI，打开该 VM 的 **Hardware** 面板：

![Hardware — unused disk](/screenshots/proxmox-hardware-unused.png)

- 双击 **Unused Disk 0** → 将 Bus/Device 保持为 `SCSI 0` → **Add**：

![Attach the imported disk](/screenshots/proxmox-attach-disk.png)

- 双击 **CD/DVD Drive (ide2)** → *Use CD/DVD disc image file* → 存储 `local`，ISO `soctalk-seed.iso` → **OK**：

![Mount the seed ISO](/screenshots/proxmox-attach-seed.png)

- **Options** → **Boot Order** → 将 `scsi0` 置于首位（或执行 `qm set 100 --boot order=scsi0`）。

此时 Hardware 面板应如下所示：

![Hardware — final](/screenshots/proxmox-hardware-final.png)

## 6. 启动并查找 VM 的 IP

点击 **Start**。Summary 面板会显示 VM 正在运行：

![VM running](/screenshots/proxmox-vm-running.png)

**Console** 会显示设备启动到登录提示符：

![Console — booted](/screenshots/proxmox-vm-console.png)

VM 会从你的 LAN 桥获取一个 DHCP 租约。可从控制台查找其 IP（`login: ops` 仅在通过 SSH 密钥时有效——请使用控制台输出或你的 DHCP 服务器/路由器），或从节点查找：

```bash
# the MAC is on the VM's Network Device (net0)
grep -B2 -A2 "$(qm config 100 | grep -oP 'virtio=\K[^,]+')" /var/lib/misc/dnsmasq.leases 2>/dev/null \
  || arp -an | grep -i "$(qm config 100 | grep -oP 'virtio=\K[^,]+')"
```

## 7. 运行向导并登录

从这里开始，流程与每个平台都相同：

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

浏览器打开 `https://<vm-ip>:8443/`，接受自签名证书，粘贴令牌，并填写向导（[字段参考](/zh-cn/setup-wizard)）。提交后，首次启动的安装程序会运行 `helm install` 并接入 `demo` 租户——`soctalk-system` 各 Pod 约需 2 分钟，随后演示租户的 Wazuh 栈还需几分钟。

然后浏览器打开 `https://<vm-ip>/`（端口 443，而非 8443），用向导中的管理员凭据登录，并继续 [MSSP UI 导览](/zh-cn/mssp-ui)。如果你在向导中留空了主机名，请在 `/etc/hosts` 中把 `soctalk.local` 映射到该 VM 的 IP，并使用 `https://soctalk.local/`。

## 故障排查

| 症状 | 检查项 |
|---|---|
| `qm disk import` 因存储错误失败 | 目标存储必须允许 **Disk image** 内容：Datacenter → Storage → edit → Content |
| VM 启动到 "No bootable device" | 启动顺序仍指向已删除的默认磁盘——Options → Boot Order → 将 `scsi0` 置于首位 |
| 向导有提示但无 SSH | 种子 ISO 未挂载（Hardware → ide2），或 `user-data` 中的密钥有误；你也可以改从控制台读取令牌：`sudo cat /var/log/soctalk-setup-token` |
| VM 没有 IP | 从控制台执行 `ip a`；检查 Hardware → net0 中的桥是否与你 LAN 上启用了 DHCP 的桥一致 |
| VM 有 IP 但无法上网（NAT 桥配置） | PVE 设置了 `bridge-nf-call-iptables=1`，这可能使桥接流量绕过仅作用于上行接口的 `MASQUERADE` 规则。执行 `sysctl -w net.bridge.bridge-nf-call-iptables=0`（若你不使用 PVE 防火墙），或使用与接口无关的规则：`iptables -t nat -A POSTROUTING -s <subnet> ! -d <subnet> -j MASQUERADE`，然后清空 conntrack |
| 向导之后的任何问题 | 与每个平台相同——参阅 [快速上手故障排查表](/zh-cn/quickstart-vm#troubleshooting) |
