# Run the demo VM on AWS

Get the SocTalk demo appliance running as an EC2 instance. There are two validated paths:

- **Option A — build a native AMI with Packer.** The repo's Packer spec includes an `amazon-ebs` source that builds the AMI directly in your AWS account. Cleanest result, needs Packer locally.
- **Option B — import the published `.vmdk` with VM Import.** No Packer needed: upload the release artifact to S3 and let AWS convert it to an AMI. Slower (the conversion takes ~30–45 minutes) but uses only the AWS CLI.

Both end at the same place: an AMI you launch, then the standard [setup wizard](/setup-wizard) flow. This path is for **evaluators and demos** — for a production install on your own cluster see [Install](/install).

::: info Why no pre-built public AMI?
AMIs are per-account, per-region resources — unlike the `.qcow2`/`.vhd`/`.vmdk` files, they can't be attached to a GitHub Release. You build or import one into your own account.
:::

## Prerequisites

- AWS CLI configured (`aws sts get-caller-identity` works) with permissions for EC2, S3, and IAM.
- Option A additionally needs [Packer](https://developer.hashicorp.com/packer/install) 1.11+ (`brew tap hashicorp/tap && brew install hashicorp/tap/packer` on macOS).

The examples use `us-west-2`; set `REGION` to taste.

```bash
REGION=us-west-2
```

## Option A: build a native AMI with Packer

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.amazon-ebs.soctalk_demo" \
  -var version=<ver> -var aws_region=$REGION .
```

Packer launches a temporary builder instance from the Ubuntu 24.04 base AMI, provisions it identically to the released images, snapshots it, and prints the resulting AMI ID (`soctalk-demo-<ver>-<timestamp>`). Skip ahead to [Launch an instance](#launch-an-instance).

## Option B: import the published `.vmdk`

### 1. Download and decompress

```bash
VER=<ver>   # e.g. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vmdk.xz   # streamOptimized vmdk, ~1 GB decompressed
```

### 2. One-time: the `vmimport` service role

VM Import runs as the `vmie.amazonaws.com` service and needs a role named exactly `vmimport`:

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

### 3. Upload and import

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

Poll until it completes (typically 30–45 minutes — AWS converts the disk and registers the AMI):

```bash
watch -n 60 "aws ec2 describe-import-image-tasks --region $REGION \
  --import-task-ids $TASK \
  --query 'ImportImageTasks[0].[Status,Progress,StatusMessage,ImageId]' --output text"
```

When `Status` is `completed`, the last field is your AMI ID.

## Launch an instance

Create a key pair and a security group scoped to your own IP — the box exposes SSH (22), the SocTalk UI (443), and the setup wizard (8443), none of which should be open to the internet:

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

`t3.xlarge` (4 vCPU / 16 GiB) comfortably covers the [minimum sizing](/reference/sizing) of 4 vCPU / 8 GB. Don't shrink the root volume — the image's virtual disk is 60 GB, so EC2 requires at least that.

::: tip No seed ISO needed
On hypervisors you attach a NoCloud `seed.iso` to inject an SSH key ([Quickstart](/quickstart-vm#optional-cloud-init-seed)). On EC2 that step disappears: the image's cloud-init picks up the EC2 metadata datasource and injects your key pair automatically — this works for the imported `.vmdk` too, even though it was packaged for VMware. The default user on EC2 is **`ubuntu`**.
:::

## Run the wizard and sign in

Same flow as every other platform. Give the instance ~2 minutes after boot, then:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP sudo cat /var/log/soctalk-setup-token
```

Browse to `https://<IP>:8443/`, accept the self-signed certificate, paste the token, fill in the wizard ([field reference](/setup-wizard)), and submit. The first-boot installer runs `helm install` and onboards the `demo` tenant — about 2 minutes for the `soctalk-system` pods, then a few more for the demo tenant's Wazuh stack:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Then browse to `https://<IP>/` (port 443, not 8443), sign in with the wizard's admin credentials, and continue with the [MSSP UI Tour](/mssp-ui). If you left the hostname blank in the wizard, map `soctalk.local` to the instance IP in `/etc/hosts` and use `https://soctalk.local/`.

## Tear down

Unlike Azure's single resource group, EC2 resources are individual — delete each:

```bash
aws ec2 terminate-instances --region $REGION --instance-ids $IID
aws ec2 wait instance-terminated --region $REGION --instance-ids $IID

# AMI + its backing snapshot
SNAP=$(aws ec2 describe-images --region $REGION --image-ids $AMI \
  --query 'Images[0].BlockDeviceMappings[0].Ebs.SnapshotId' --output text)
aws ec2 deregister-image --region $REGION --image-id $AMI
aws ec2 delete-snapshot --region $REGION --snapshot-id $SNAP

aws ec2 delete-security-group --region $REGION --group-id $SG
aws ec2 delete-key-pair --region $REGION --key-name soctalk-demo

# Option B leftovers
aws s3 rb s3://$BUCKET --force
aws iam delete-role-policy --role-name vmimport --policy-name vmimport-s3
aws iam delete-role --role-name vmimport
```

Verify nothing is left billing:

```bash
aws ec2 describe-instances --region $REGION \
  --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'length(Reservations)'
aws ec2 describe-images --region $REGION --owners self --query 'length(Images)'
aws ec2 describe-snapshots --region $REGION --owner-ids self --query 'length(Snapshots)'
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Packer or `run-instances` fails with `VPCIdNotSpecified` | The account/region has no default VPC. `aws ec2 create-default-vpc --region $REGION` (delete it again at teardown if you don't want it) |
| `import-image` stuck in `validating` / fails with a role error | The role must be named exactly `vmimport` and trust `vmie.amazonaws.com` with external ID `vmimport` — re-check step 2 |
| `run-instances` rejects a smaller root volume | The imported snapshot is 60 GB; the root volume must be ≥ 60 GB. Omit `--block-device-mappings` to use the AMI default |
| `SignatureDoesNotMatch` from the CLI | Stale `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` env vars overriding `~/.aws/credentials` — `unset` them |
| Anything past the wizard | Same as every platform — see the [Quickstart troubleshooting table](/quickstart-vm#troubleshooting) |
