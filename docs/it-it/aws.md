# Esegui la VM demo su AWS

Metti in esecuzione l'appliance demo di SocTalk come istanza EC2. Esistono due percorsi validati:

- **Opzione A — costruisci una AMI nativa con Packer.** La specifica Packer del repo include una sorgente `amazon-ebs` che costruisce la AMI direttamente nel tuo account AWS. Il risultato più pulito, richiede Packer in locale.
- **Opzione B — importa il `.vmdk` pubblicato con VM Import.** Nessun Packer necessario: carica l'artefatto di release su S3 e lascia che AWS lo converta in una AMI. Più lento (la conversione richiede ~30–45 minuti) ma usa solo la AWS CLI.

Entrambi terminano nello stesso punto: una AMI che avvii, seguita dal consueto flusso della [procedura guidata di setup](/it-it/setup-wizard). Questo percorso è pensato per **valutatori e demo** — per un'installazione di produzione sul tuo cluster consulta [Install](/it-it/install).

::: info Perché non c'è una AMI pubblica pre-costruita?
Le AMI sono risorse per-account e per-region — a differenza dei file `.qcow2`/`.vhd`/`.vmdk`, non possono essere allegate a una GitHub Release. Ne costruisci o importi una nel tuo account.
:::

## Prerequisiti

- AWS CLI configurata (`aws sts get-caller-identity` funziona) con permessi per EC2, S3 e IAM.
- L'opzione A richiede inoltre [Packer](https://developer.hashicorp.com/packer/install) 1.11+ (`brew tap hashicorp/tap && brew install hashicorp/tap/packer` su macOS).

Gli esempi usano `us-west-2`; imposta `REGION` a piacere.

```bash
REGION=us-west-2
```

## Opzione A: costruisci una AMI nativa con Packer

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.amazon-ebs.soctalk_demo" \
  -var version=<ver> -var aws_region=$REGION .
```

Packer avvia un'istanza builder temporanea a partire dalla AMI base di Ubuntu 24.04, la provisiona in modo identico alle immagini rilasciate, ne crea uno snapshot e stampa l'ID della AMI risultante (`soctalk-demo-<ver>-<timestamp>`). Passa direttamente a [Avvia un'istanza](#launch-an-instance).

## Opzione B: importa il `.vmdk` pubblicato

### 1. Scarica e decomprimi

```bash
VER=<ver>   # e.g. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vmdk.xz   # streamOptimized vmdk, ~1 GB decompressed
```

### 2. Operazione una tantum: il ruolo di servizio `vmimport`

VM Import viene eseguito come servizio `vmie.amazonaws.com` e necessita di un ruolo denominato esattamente `vmimport`:

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

### 3. Carica e importa

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

Interroga finché non termina (in genere 30–45 minuti — AWS converte il disco e registra la AMI):

```bash
watch -n 60 "aws ec2 describe-import-image-tasks --region $REGION \
  --import-task-ids $TASK \
  --query 'ImportImageTasks[0].[Status,Progress,StatusMessage,ImageId]' --output text"
```

Quando `Status` è `completed`, l'ultimo campo è l'ID della tua AMI.

## Avvia un'istanza

Crea una key pair e un security group limitato al tuo indirizzo IP — la macchina espone SSH (22), la UI di SocTalk (443) e la procedura guidata di setup (8443), nessuno dei quali dovrebbe essere aperto a Internet:

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

`t3.xlarge` (4 vCPU / 16 GiB) copre comodamente il [dimensionamento minimo](/it-it/reference/sizing) di 4 vCPU / 8 GB. Non ridurre il volume root — il disco virtuale dell'immagine è di 60 GB, quindi EC2 ne richiede almeno altrettanti.

::: tip Nessuna seed ISO necessaria
Sugli hypervisor colleghi una `seed.iso` NoCloud per iniettare una chiave SSH ([Quickstart](/it-it/quickstart-vm#optional-cloud-init-seed)). Su EC2 quel passaggio scompare: il cloud-init dell'immagine rileva il datasource dei metadati EC2 e inietta automaticamente la tua key pair — questo funziona anche per il `.vmdk` importato, anche se era stato pacchettizzato per VMware. L'utente predefinito su EC2 è **`ubuntu`**.
:::

## Esegui la procedura guidata e accedi

Stesso flusso di ogni altra piattaforma. Concedi all'istanza ~2 minuti dopo l'avvio, quindi:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP sudo cat /var/log/soctalk-setup-token
```

Vai a `https://<IP>:8443/`, accetta il certificato self-signed, incolla il token, compila la procedura guidata ([riferimento dei campi](/it-it/setup-wizard)) e invia. L'installer al primo avvio esegue `helm install` e effettua l'onboarding del tenant `demo` — circa 2 minuti per i pod di `soctalk-system`, poi qualche minuto in più per lo stack Wazuh del tenant demo:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Poi vai a `https://<IP>/` (porta 443, non 8443), accedi con le credenziali admin della procedura guidata e prosegui con il [Tour della UI MSSP](/it-it/mssp-ui). Se hai lasciato vuoto l'hostname nella procedura guidata, mappa `soctalk.local` all'IP dell'istanza in `/etc/hosts` e usa `https://soctalk.local/`.

## Smantellamento

A differenza del singolo resource group di Azure, le risorse EC2 sono individuali — eliminale una a una:

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

Verifica che non resti nulla in fatturazione:

```bash
aws ec2 describe-instances --region $REGION \
  --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'length(Reservations)'
aws ec2 describe-images --region $REGION --owners self --query 'length(Images)'
aws ec2 describe-snapshots --region $REGION --owner-ids self --query 'length(Snapshots)'
```

## Risoluzione dei problemi

| Sintomo | Verifica |
|---|---|
| Packer o `run-instances` fallisce con `VPCIdNotSpecified` | L'account/region non ha una VPC di default. `aws ec2 create-default-vpc --region $REGION` (eliminala di nuovo allo smantellamento se non la vuoi) |
| `import-image` bloccato in `validating` / fallisce con un errore di ruolo | Il ruolo deve essere denominato esattamente `vmimport` e avere trust verso `vmie.amazonaws.com` con external ID `vmimport` — ricontrolla il passaggio 2 |
| `run-instances` rifiuta un volume root più piccolo | Lo snapshot importato è di 60 GB; il volume root deve essere ≥ 60 GB. Ometti `--block-device-mappings` per usare il default della AMI |
| `SignatureDoesNotMatch` dalla CLI | Variabili d'ambiente `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` obsolete che sovrascrivono `~/.aws/credentials` — eseguine `unset` |
| Qualsiasi cosa dopo la procedura guidata | Come per ogni piattaforma — consulta la [tabella di risoluzione dei problemi del Quickstart](/it-it/quickstart-vm#troubleshooting) |
