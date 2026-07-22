# 下载

预构建的 SocTalk 演示 VM 镜像，作为 GitHub Release 制品发布于 [`soctalk/soctalk`](https://github.com/soctalk/soctalk) 仓库的每个 `v*` 标签。

所有镜像都是同一套 Ubuntu 24.04 + K3s + 安装向导构建，仅转换为不同的虚拟磁盘格式。请选择你的虚拟机管理程序原生支持的格式。**各格式之间没有功能差异。**

## 最新版本

当前版本：**v0.2.0** — [发布页面](https://github.com/soctalk/soctalk/releases/tag/v0.2.0) · [所有版本](https://github.com/soctalk/soctalk/releases)

该版本包含：

- [`soctalk-demo-0.2.0.qcow2.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz) — KVM、QEMU、libvirt、Proxmox
- [`soctalk-demo-0.2.0.vmdk.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vmdk.xz) — VMware ESXi、Workstation、Fusion、VirtualBox
- [`soctalk-demo-0.2.0.vhdx.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhdx.xz) — Microsoft Hyper-V（第 1 代）
- [`soctalk-demo-0.2.0.vhd.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhd.xz) — Microsoft Azure（固定大小，1 MiB 对齐）
- [`soctalk-demo-0.2.0.raw.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.raw.xz) — 通用云导入（GCP、OpenStack），可 `dd` 写入物理磁盘
- [`SHA256SUMS.txt`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt) — 以上所有文件的校验和

所有制品均使用 `xz -9` 压缩。请使用 `xz -d <file>.xz` 解压。

## 格式选择器

| 你的平台 | 下载 |
|---|---|
| **Proxmox VE** | qcow2 — `qm disk import`。参见[在 Proxmox 上运行](/zh-cn/proxmox) |
| **libvirt / virt-manager / QEMU CLI** | qcow2 |
| **KVM（RHEL/CentOS/Alma）** | qcow2 |
| **VMware ESXi** | vmdk — 参见[在 VMware ESXi 上运行](/zh-cn/vmware) |
| **VMware Workstation / Fusion** | vmdk |
| **VirtualBox** | vmdk — 转换为 VDI 后再挂载。参见[在 VirtualBox 上运行](/zh-cn/virtualbox) |
| **Microsoft Hyper-V** | vhdx — 第 1 代虚拟机（已验证；镜像通过 BIOS 固件引导，第 2 代 / UEFI 未经测试） |
| **Microsoft Azure** | vhd — 直接上传到托管磁盘 → 映像 → VM。参见[在 Azure 上运行](/zh-cn/azure) |
| **Google Cloud** | raw — `tar czf disk.tar.gz disk.raw && gcloud compute images create` |
| **OpenStack** | raw — `openstack image create --disk-format raw` |
| **AWS** | vmdk — 通过 VM Import 导入为 AMI，或使用 Packer 构建原生 AMI。参见[在 AWS 上运行](/zh-cn/aws) |
| **裸机** | raw — `dd if=disk.raw of=/dev/sdX bs=4M` |

## 校验下载

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 磁盘大小

所有镜像均具有：

- **压缩后大小**：约 600 MB 至 1.5 GB，取决于格式
- **解压后表观大小**：60 GB
- **首次启动后实际占用磁盘大小**：约 3 GB（qcow2/vhdx 为稀疏格式；raw 和 vhd 为固定大小，但 60 GB 中大部分为零，压缩后几乎不占空间）

## 自行构建

Packer 构建工具位于 [`infra/packer/`](https://github.com/soctalk/soctalk/tree/main/infra/packer)。在 Linux 主机上使用 KVM 与 Packer 1.11+：

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.qemu.soctalk_demo" .
```

在启用 KVM 加速的现代主机上约 1 分钟即可完成构建。输出文件位于 `build/dist/`：每种格式一个文件。有关 cloud-init 种子配置及 AWS AMI 源，请参见 [Packer README](https://github.com/soctalk/soctalk/blob/main/infra/packer/README.md)。

## CI 工作流

`build-packer-images.yml` 仅支持 `workflow_dispatch` — Packer 构建不会在每次推送时触发，因为它们速度慢且消耗 runner 时长。请为新版本有意手动触发：

```bash
gh workflow run build-packer-images.yml -f version=0.2.0
```

该工作流执行：

1. **build-wizard** — Go 编译安装向导二进制文件。
2. **build-qcow2** — Packer 构建，生成全部五种格式；进行 xz 压缩；将每种格式作为独立的工作流制品上传；并在 `v*` 标签上附加到 GitHub Release。
3. **boot-test** — 在全新的 KVM 虚拟机中启动 qcow2，等待 `soctalk-firstboot` 完成，运行 Playwright 校验器。如果镜像损坏则使工作流失败，从而确保损坏的版本永远不会被附加到标签上。
