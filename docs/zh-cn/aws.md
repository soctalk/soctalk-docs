# 在 AWS 上运行演示 VM

将 SocTalk 演示设备作为 EC2 实例运行。有两条经过验证的路径：

- **方案 A —— 使用 Packer 构建原生 AMI。** 仓库的 Packer 规范包含一个 `amazon-ebs` 源，可直接在你的 AWS 账户中构建 AMI。结果最干净，但需要在本地安装 Packer。
- **方案 B —— 使用 VM Import 导入已发布的 `.vmdk`。** 无需 Packer：将发布产物上传到 S3，让 AWS 将其转换为 AMI。速度较慢（转换约需 30–45 分钟），但仅使用 AWS CLI。

两条路径最终都会到达同一处：一个你可以启动的 AMI，随后进入标准的[安装向导](/zh-cn/setup-wizard)流程。此路径面向**评估者与演示** —— 若要在自有集群上进行生产安装，请参阅[安装](/zh-cn/install)。

::: info 为什么没有预构建的公共 AMI？
AMI 是按账户、按区域的资源 —— 与 `.qcow2`/`.vhd`/`.vmdk` 文件不同，它们无法附加到 GitHub Release。你需要在自己的账户中构建或导入一个。
:::

## 前置条件

- 已配置 AWS CLI（`aws sts get-caller-identity` 可正常运行），并具备 EC2、S3 和 IAM 权限。
- 方案 A 另外需要 [Packer](https://developer.hashicorp.com/packer/install) 1.11+（macOS 上执行 `brew tap hashicorp/tap && brew install hashicorp/tap/packer`）。

示例使用 `us-west-2`；请按需设置 `REGION`。

```bash
REGION=us-west-2
```

## 方案 A：使用 Packer 构建原生 AMI

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.amazon-ebs.soctalk_demo" \
  -var version=<ver> -var aws_region=$REGION .
```

Packer 会从 Ubuntu 24.04 基础 AMI 启动一个临时的构建实例，以与发布镜像完全相同的方式对其进行预置，为其创建快照，并打印出生成的 AMI ID（`soctalk-demo-<ver>-<timestamp>`）。直接跳到[启动实例](#launch-an-instance)。

## 方案 B：导入已发布的 `.vmdk`

### 1. 下载并解压

```bash
VER=<ver>   # 例如 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vmdk.xz   # streamOptimized vmdk，解压后约 1 GB
```

### 2. 一次性操作：`vmimport` 服务角色

VM Import 以 `vmie.amazonaws.com` 服务的身份运行，需要一个名称必须恰好为 `vmimport` 的角色：

```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
BUCKET=soctalk-vmimport-$ACCOUNT-$REGION
aws s3 mb s3://$BUCKET --region $REGION

cat > trust.json <<'EOF'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"vmie.amazonaws.com"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:Externalid":"vmimport"}}}]}
EOF
aws iam create-role --role-name vmimport --assume-role-policy-document file://trust.json

cat > role-policy.json <<EOF
{"Version":"2012-10-17","Statement":[
 {"Effect":"Allow","Action":["s3:GetBucketLocation","s3:GetObject","s3:ListBucket","s3:PutObject","s3:GetBucketAcl"],"Resource":["arn:aws:s3:::$BUCKET","arn:aws:s3:::$BUCKET/*"]},
 {"Effect":"Allow","Action":["ec2:ModifySnapshotAttribute","ec2:CopySnapshot","ec2:RegisterImage","ec2:Describe*"],"Resource":"*"}
]}
EOF
aws iam put-role-policy --role-name vmimport --policy-name vmimport-s3 \
  --policy-document file://role-policy.json
```

### 3. 上传并导入

```bash
aws s3 cp soctalk-demo-$VER.vmdk s3://$BUCKET/ --region $REGION

cat > containers.json <<EOF
[{"Description":"soctalk-demo-$VER","Format":"vmdk","UserBucket":{"S3Bucket":"$BUCKET","S3Key":"soctalk-demo-$VER.vmdk"}}]
EOF
TASK=$(aws ec2 import-image --region $REGION \
  --description "soctalk-demo-$VER" \
  --disk-containers file://containers.json \
  --query ImportTaskId --output text)
echo "import task: $TASK"
```

轮询直至完成（通常需 30–45 分钟 —— AWS 会转换磁盘并注册 AMI）：

```bash
watch -n 60 "aws ec2 describe-import-image-tasks --region $REGION \
  --import-task-ids $TASK \
  --query 'ImportImageTasks[0].[Status,Progress,StatusMessage,ImageId]' --output text"
```

当 `Status` 为 `completed` 时，最后一个字段即为你的 AMI ID。

## 启动实例

创建一个密钥对和一个仅限你自己 IP 的安全组 —— 该机器暴露了 SSH（22）、SocTalk UI（443）和安装向导（8443），这些端口都不应对互联网开放：

```bash
AMI=<ami-id-from-A-or-B>

aws ec2 create-key-pair --region $REGION --key-name soctalk-demo \
  --query KeyMaterial --output text > soctalk-demo.pem
chmod 600 soctalk-demo.pem

MYIP=$(curl -s https://ifconfig.me)
SG=$(aws ec2 create-security-group --region $REGION \
  --group-name soctalk-demo-sg --description "SocTalk demo, scoped to my IP" \
  --query GroupId --output text)
for port in 22 443 8443; do
  aws ec2 authorize-security-group-ingress --region $REGION --group-id $SG \
    --protocol tcp --port $port --cidr $MYIP/32
done

IID=$(aws ec2 run-instances --region $REGION \
  --image-id $AMI --instance-type t3.xlarge \
  --key-name soctalk-demo --security-group-ids $SG \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=soctalk-demo}]' \
  --query 'Instances[0].InstanceId' --output text)
aws ec2 wait instance-running --region $REGION --instance-ids $IID
IP=$(aws ec2 describe-instances --region $REGION --instance-ids $IID \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "instance at $IP"
```

`t3.xlarge`（4 vCPU / 16 GiB）足以从容满足 4 vCPU / 8 GB 的[最低配置要求](/zh-cn/reference/sizing)。不要缩小根卷 —— 镜像的虚拟磁盘为 60 GB，因此 EC2 要求至少这么大。

::: tip 无需 seed ISO
在其他 hypervisor 上，你需要附加一个 NoCloud `seed.iso` 来注入 SSH 密钥（[快速开始](/zh-cn/quickstart-vm#optional-cloud-init-seed)）。在 EC2 上，这一步骤消失了：镜像的 cloud-init 会拾取 EC2 元数据数据源并自动注入你的密钥对 —— 即使导入的 `.vmdk` 是为 VMware 打包的，这一机制同样适用。EC2 上的默认用户是 **`ubuntu`**。
:::

## 运行向导并登录

流程与其他所有平台相同。启动后给实例约 2 分钟，然后：

```bash
ssh -i soctalk-demo.pem ubuntu@$IP sudo cat /var/log/soctalk-setup-token
```

浏览到 `https://<IP>:8443/`，接受自签名证书，粘贴令牌，填写向导（[字段参考](/zh-cn/setup-wizard)）并提交。首次启动安装程序会运行 `helm install` 并接入 `demo` 租户 —— `soctalk-system` 各 pod 约需 2 分钟，随后演示租户的 Wazuh 技术栈还需几分钟：

```bash
ssh -i soctalk-demo.pem ubuntu@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

然后浏览到 `https://<IP>/`（端口 443，而非 8443），使用向导中的管理员凭据登录，并继续进行 [MSSP UI 导览](/zh-cn/mssp-ui)。如果你在向导中将主机名留空，请在 `/etc/hosts` 中将 `soctalk.local` 映射到实例 IP，并使用 `https://soctalk.local/`。

## 拆除

与 Azure 的单一资源组不同，EC2 资源是独立的 —— 需逐一删除：

```bash
aws ec2 terminate-instances --region $REGION --instance-ids $IID
aws ec2 wait instance-terminated --region $REGION --instance-ids $IID

# AMI 及其后备快照
SNAP=$(aws ec2 describe-images --region $REGION --image-ids $AMI \
  --query 'Images[0].BlockDeviceMappings[0].Ebs.SnapshotId' --output text)
aws ec2 deregister-image --region $REGION --image-id $AMI
aws ec2 delete-snapshot --region $REGION --snapshot-id $SNAP

aws ec2 delete-security-group --region $REGION --group-id $SG
aws ec2 delete-key-pair --region $REGION --key-name soctalk-demo

# 方案 B 的遗留资源
aws s3 rb s3://$BUCKET --force
aws iam delete-role-policy --role-name vmimport --policy-name vmimport-s3
aws iam delete-role --role-name vmimport
```

确认没有遗留任何计费项：

```bash
aws ec2 describe-instances --region $REGION \
  --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'length(Reservations)'
aws ec2 describe-images --region $REGION --owners self --query 'length(Images)'
aws ec2 describe-snapshots --region $REGION --owner-ids self --query 'length(Snapshots)'
```

## 故障排查

| 症状 | 检查 |
|---|---|
| Packer 或 `run-instances` 失败并报 `VPCIdNotSpecified` | 该账户/区域没有默认 VPC。执行 `aws ec2 create-default-vpc --region $REGION`（如果你不需要它，可在拆除时再次删除） |
| `import-image` 卡在 `validating` / 因角色错误而失败 | 角色名称必须恰好为 `vmimport`，并以外部 ID `vmimport` 信任 `vmie.amazonaws.com` —— 请重新核对步骤 2 |
| `run-instances` 拒绝较小的根卷 | 导入的快照为 60 GB；根卷必须 ≥ 60 GB。省略 `--block-device-mappings` 以使用 AMI 默认值 |
| CLI 返回 `SignatureDoesNotMatch` | 过时的 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 环境变量覆盖了 `~/.aws/credentials` —— 使用 `unset` 清除它们 |
| 向导之后的任何问题 | 与其他所有平台相同 —— 参阅[快速开始故障排查表](/zh-cn/quickstart-vm#troubleshooting) |
