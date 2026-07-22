# Execute a VM de demonstração na AWS

Coloque o appliance de demonstração do SocTalk em execução como uma instância EC2. Há dois caminhos validados:

- **Opção A — construa uma AMI nativa com Packer.** A especificação Packer do repositório inclui uma fonte `amazon-ebs` que constrói a AMI diretamente na sua conta AWS. Resultado mais limpo, requer o Packer localmente.
- **Opção B — importe o `.vmdk` publicado com o VM Import.** Não precisa do Packer: envie o artefato de release para o S3 e deixe a AWS convertê-lo em uma AMI. Mais lento (a conversão leva ~30–45 minutos), mas usa apenas o AWS CLI.

Ambos terminam no mesmo ponto: uma AMI que você inicia e, em seguida, o fluxo padrão do [assistente de configuração](/pt-br/setup-wizard). Este caminho é para **avaliadores e demonstrações** — para uma instalação de produção no seu próprio cluster, consulte [Instalação](/pt-br/install).

::: info Por que não há uma AMI pública pré-construída?
As AMIs são recursos por conta e por região — diferentemente dos arquivos `.qcow2`/`.vhd`/`.vmdk`, elas não podem ser anexadas a um GitHub Release. Você constrói ou importa uma para a sua própria conta.
:::

## Pré-requisitos

- AWS CLI configurado (`aws sts get-caller-identity` funciona) com permissões para EC2, S3 e IAM.
- A Opção A precisa adicionalmente do [Packer](https://developer.hashicorp.com/packer/install) 1.11+ (`brew tap hashicorp/tap && brew install hashicorp/tap/packer` no macOS).

Os exemplos usam `us-west-2`; defina `REGION` conforme sua preferência.

```bash
REGION=us-west-2
```

## Opção A: construa uma AMI nativa com Packer

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.amazon-ebs.soctalk_demo" \
  -var version=<ver> -var aws_region=$REGION .
```

O Packer inicia uma instância builder temporária a partir da AMI base do Ubuntu 24.04, provisiona-a de forma idêntica às imagens lançadas, tira um snapshot e imprime o ID da AMI resultante (`soctalk-demo-<ver>-<timestamp>`). Avance para [Inicie uma instância](#launch-an-instance).

## Opção B: importe o `.vmdk` publicado

### 1. Baixe e descompacte

```bash
VER=<ver>   # e.g. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vmdk.xz   # streamOptimized vmdk, ~1 GB decompressed
```

### 2. Uma única vez: o service role `vmimport`

O VM Import é executado como o serviço `vmie.amazonaws.com` e precisa de um role com o nome exato `vmimport`:

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

### 3. Envie e importe

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

Faça o polling até concluir (normalmente 30–45 minutos — a AWS converte o disco e registra a AMI):

```bash
watch -n 60 "aws ec2 describe-import-image-tasks --region $REGION \
  --import-task-ids $TASK \
  --query 'ImportImageTasks[0].[Status,Progress,StatusMessage,ImageId]' --output text"
```

Quando `Status` for `completed`, o último campo é o ID da sua AMI.

## Inicie uma instância

Crie um par de chaves e um security group restrito ao seu próprio IP — a máquina expõe SSH (22), a UI do SocTalk (443) e o assistente de configuração (8443), nenhum dos quais deve ficar aberto à internet:

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

O `t3.xlarge` (4 vCPU / 16 GiB) cobre confortavelmente o [dimensionamento mínimo](/pt-br/reference/sizing) de 4 vCPU / 8 GB. Não reduza o volume raiz — o disco virtual da imagem tem 60 GB, então o EC2 exige pelo menos esse tamanho.

::: tip Nenhum seed ISO necessário
Em hypervisors, você anexa um `seed.iso` NoCloud para injetar uma chave SSH ([Quickstart](/pt-br/quickstart-vm#optional-cloud-init-seed)). No EC2 essa etapa desaparece: o cloud-init da imagem detecta o datasource de metadados do EC2 e injeta seu par de chaves automaticamente — isso funciona também para o `.vmdk` importado, mesmo tendo sido empacotado para VMware. O usuário padrão no EC2 é **`ubuntu`**.
:::

## Execute o assistente e faça login

Mesmo fluxo de todas as outras plataformas. Dê à instância ~2 minutos após o boot e, em seguida:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP sudo cat /var/log/soctalk-setup-token
```

Acesse `https://<IP>:8443/`, aceite o certificado autoassinado, cole o token, preencha o assistente ([referência de campos](/pt-br/setup-wizard)) e envie. O instalador de primeiro boot executa `helm install` e integra o tenant `demo` — cerca de 2 minutos para os pods do `soctalk-system` e mais alguns para a stack Wazuh do tenant de demonstração:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Em seguida, acesse `https://<IP>/` (porta 443, não 8443), faça login com as credenciais de admin do assistente e continue com o [Tour da UI do MSSP](/pt-br/mssp-ui). Se você deixou o hostname em branco no assistente, mapeie `soctalk.local` para o IP da instância em `/etc/hosts` e use `https://soctalk.local/`.

## Desmontagem

Diferentemente do único resource group do Azure, os recursos do EC2 são individuais — exclua cada um:

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

Verifique se nada permanece gerando cobrança:

```bash
aws ec2 describe-instances --region $REGION \
  --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'length(Reservations)'
aws ec2 describe-images --region $REGION --owners self --query 'length(Images)'
aws ec2 describe-snapshots --region $REGION --owner-ids self --query 'length(Snapshots)'
```

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| Packer ou `run-instances` falha com `VPCIdNotSpecified` | A conta/região não tem uma VPC padrão. `aws ec2 create-default-vpc --region $REGION` (exclua-a novamente na desmontagem se não a quiser) |
| `import-image` travado em `validating` / falha com um erro de role | O role deve ter o nome exato `vmimport` e confiar em `vmie.amazonaws.com` com o external ID `vmimport` — verifique novamente a etapa 2 |
| `run-instances` rejeita um volume raiz menor | O snapshot importado tem 60 GB; o volume raiz deve ser ≥ 60 GB. Omita `--block-device-mappings` para usar o padrão da AMI |
| `SignatureDoesNotMatch` do CLI | Variáveis de ambiente `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` obsoletas sobrepondo `~/.aws/credentials` — use `unset` nelas |
| Qualquer coisa após o assistente | Igual a todas as plataformas — veja a [tabela de solução de problemas do Quickstart](/pt-br/quickstart-vm#troubleshooting) |
