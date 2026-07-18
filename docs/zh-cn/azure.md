# 在 Azure 上运行演示 VM

将发布的 `soctalk-demo-<ver>.vhd` 镜像导入 Azure 作为托管磁盘，将其转换为 VM 镜像，然后启动它。Azure VM 运行在 Hyper-V 之上，因此这也是无需搭建 Windows Server 主机即可在 Hyper-V 虚拟机监控程序上验证镜像的最快方式。

此路径面向**评估人员与演示**——若要在你自己的集群上进行生产环境安装，请参阅[安装](/zh-cn/install)。

## 为何使用 `.vhd`（以及为何使用 Generation 1）

- Azure 仅接受**固定大小、按 1 MiB 对齐的 VHD** 磁盘（不接受 VHDX，也不接受动态 VHD）。发布的 `soctalk-demo-<ver>.vhd` 正是由发布流水线以此方式生成的（`qemu-img convert -O vpc -o subformat=fixed,force_size`），因此可原样导入——无需本地转换步骤。
- 该镜像在 BIOS 固件下构建并通过启动测试，对应于 Azure 的 **Generation 1** VM。请使用 `--hyper-v-generation V1` 创建磁盘和镜像。
- 一个固定的 60 GB VHD 听起来很庞大，但它几乎全是零。`azcopy` 会上传到页 blob 并**跳过零页**，因此实际传输量大约只有约 3 GB 的真实数据。

## 前置条件

- 一个 Azure 订阅（`az account list` 必须显示至少一个订阅——仅有租户级目录访问权限是不够的）。
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli)（`az`）和 [AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10)（`azcopy`）。在 macOS 上：`brew install azure-cli azcopy`。
- 用于存放解压后 VHD 的约 61 GB 本地可用磁盘空间。
- 一对 SSH 密钥（下面的示例中使用 `~/.ssh/id_ed25519.pub`）。

登录并选择订阅：

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

## 1. 下载并解压 VHD

```bash
VER=<ver>   # e.g. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vhd.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vhd.xz   # decompresses to a 60 GB fixed VHD
```

## 2. 创建资源组

本指南中的所有内容都存放在一个资源组内，因此最后拆除时只需一条命令。

```bash
RG=soctalk-demo
LOC=westus2
az group create -n $RG -l $LOC
```

## 3. 将 VHD 直接上传到托管磁盘

无需存储账户——Azure 支持直接上传到托管磁盘。创建一个大小与 VHD 文件精确字节数相同的空磁盘，获取一个短期有效的写入 SAS，用 `azcopy` 上传，然后吊销 SAS：

```bash
VHD=soctalk-demo-$VER.vhd
SIZE=$(stat -f %z "$VHD" 2>/dev/null || stat -c %s "$VHD")   # macOS || Linux

az disk create -g $RG -n soctalk-demo \
  --for-upload --upload-size-bytes $SIZE \
  --sku standard_lrs --os-type Linux --hyper-v-generation V1

SAS=$(az disk grant-access -g $RG -n soctalk-demo \
  --access-level Write --duration-in-seconds 86400 \
  --query accessSAS -o tsv)

azcopy copy "$VHD" "$SAS" --blob-type PageBlob

az disk revoke-access -g $RG -n soctalk-demo
```

`azcopy` 这一步是唯一耗时较长的步骤；借助零页跳过，它只会传输真实数据（约 3 GB）。

## 4. 从磁盘创建镜像

```bash
DISK_ID=$(az disk show -g $RG -n soctalk-demo --query id -o tsv)

az image create -g $RG -n soctalk-demo-image \
  --source $DISK_ID --os-type Linux --hyper-v-generation V1
```

## 5. 启动一个 VM

将网络安全组的范围限定为你自己的 IP——该机器暴露了 SSH（22）、SocTalk UI（443）和安装向导（8443），这些端口都不应向互联网开放：

```bash
MYIP=$(curl -s https://ifconfig.me)

az network nsg create -g $RG -n soctalk-nsg
i=100
for port in 22 443 8443; do
  az network nsg rule create -g $RG --nsg-name soctalk-nsg \
    -n allow-$port --priority $i --access Allow --protocol Tcp \
    --direction Inbound --source-address-prefixes $MYIP/32 \
    --destination-port-ranges $port
  i=$((i+10))
done

az vm create -g $RG -n soctalk-demo-vm \
  --image soctalk-demo-image \
  --size Standard_D4s_v3 \
  --admin-username ops \
  --ssh-key-values ~/.ssh/id_ed25519.pub \
  --nsg soctalk-nsg \
  --public-ip-sku Standard

IP=$(az vm show -g $RG -n soctalk-demo-vm -d --query publicIps -o tsv)
echo "VM is at $IP"
```

`Standard_D4s_v3`（4 vCPU / 16 GiB）可从容满足 4 vCPU / 8 GB 的[最低规格要求](/zh-cn/reference/sizing)。任何更小的规格在演示租户的 Wazuh 栈启动后都会力不从心。

::: tip 无需 seed ISO
在虚拟机监控程序上，你需要挂载一个 NoCloud `seed.iso` 来注入 SSH 密钥（[快速入门](/zh-cn/quickstart-vm#optional-cloud-init-seed)）。在 Azure 上这一步会消失：镜像的 cloud-init 会识别 Azure 数据源，并自动完成 `--admin-username` / `--ssh-key-values` 的配置。
:::

## 6. 获取安装令牌并运行向导

从这里开始的流程与其他任何虚拟机监控程序相同。启动后给 VM 约 2 分钟让向导服务就绪，然后：

```bash
ssh ops@$IP sudo cat /var/log/soctalk-setup-token
```

浏览到 `https://<IP>:8443/`，接受自签名证书，粘贴令牌，并填写向导——MSSP 名称、管理员凭据、LLM 提供商 + API 密钥。字段说明请参阅[安装向导](/zh-cn/setup-wizard)。

提交后，首次启动安装程序会运行 `helm install` 并载入 `demo` 租户——`soctalk-system` pod 约需 2 分钟，之后演示租户的 Wazuh 栈还需要几分钟。你可以从 SSH 观察：

```bash
ssh ops@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

## 7. 登录

浏览到 `https://<IP>/`（端口 443，而非 8443），并使用向导中的管理员凭据登录。如果你在向导中将主机名留空，请在 `/etc/hosts` 中将 `soctalk.local` 映射到 VM 的 IP，并使用 `https://soctalk.local/`。继续阅读 [MSSP UI 导览](/zh-cn/mssp-ui)。

## 8. 拆除

所有内容都是在资源组内创建的，因此：

```bash
az group delete -n $RG --yes --no-wait
```

这将一次性移除 VM、NIC、公网 IP、NSG、托管磁盘和镜像。不会遗留任何仍在计费的资源。

## 故障排查

| 症状 | 检查项 |
|---|---|
| `az disk create --for-upload` 被拒绝 | `--upload-size-bytes` 必须是解压后 `.vhd` 的**精确**字节数（含 footer）——重新运行 `stat` 命令 |
| `azcopy` 以 403 失败 | 写入 SAS 已过期（示例中为 24 小时）或已被吊销——重新运行 `az disk grant-access` |
| VM 始终未获得 SSH 密钥 | 确认镜像和磁盘是以 `--hyper-v-generation V1` 创建的；由此 VHD 生成的 V2 镜像将无法启动，而启动失败永远无法到达 cloud-init |
| 向导 URL 始终无法加载 | 缺少 8443 的 NSG 规则，或你的公网 IP 已更改（运行 `curl ifconfig.me` 并比对）；随后通过 SSH 执行 `systemctl status soctalk-setup-wizard` |
| 向导之后的任何问题 | 与每个平台相同——参阅[快速入门故障排查表](/zh-cn/quickstart-vm#troubleshooting) |
