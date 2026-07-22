# Exécuter la VM de démonstration sur AWS

Faites tourner l'appliance de démonstration SocTalk en tant qu'instance EC2. Il existe deux parcours validés :

- **Option A, construire une AMI native avec Packer.** La spécification Packer du dépôt inclut une source `amazon-ebs` qui construit l'AMI directement dans votre compte AWS. Résultat le plus propre, nécessite Packer en local.
- **Option B, importer le fichier `.vmdk` publié avec VM Import.** Aucun Packer requis : téléversez l'artefact de release vers S3 et laissez AWS le convertir en AMI. Plus lent (la conversion prend environ 30 à 45 minutes) mais n'utilise que l'AWS CLI.

Les deux aboutissent au même point : une AMI que vous lancez, puis le flux standard de l'[assistant de configuration](/fr-fr/setup-wizard). Ce parcours s'adresse aux **évaluateurs et aux démonstrations**: pour une installation en production sur votre propre cluster, consultez [Installation](/fr-fr/install).

::: info Pourquoi pas d'AMI publique pré-construite ?
Les AMI sont des ressources propres à un compte et à une région, contrairement aux fichiers `.qcow2`/`.vhd`/`.vmdk`, elles ne peuvent pas être attachées à une GitHub Release. Vous en construisez ou en importez une dans votre propre compte.
:::

## Prérequis

- AWS CLI configurée (`aws sts get-caller-identity` fonctionne) avec les autorisations pour EC2, S3 et IAM.
- L'option A nécessite en plus [Packer](https://developer.hashicorp.com/packer/install) 1.11+ (`brew tap hashicorp/tap && brew install hashicorp/tap/packer` sur macOS).

Les exemples utilisent `us-west-2` ; réglez `REGION` selon vos préférences.

```bash
REGION=us-west-2
```

## Option A : construire une AMI native avec Packer

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.amazon-ebs.soctalk_demo" \
  -var version=<ver> -var aws_region=$REGION .
```

Packer lance une instance de construction temporaire à partir de l'AMI de base Ubuntu 24.04, la provisionne à l'identique des images publiées, en prend un instantané, et affiche l'ID de l'AMI résultante (`soctalk-demo-<ver>-<timestamp>`). Passez directement à [Lancer une instance](#launch-an-instance).

## Option B : importer le fichier `.vmdk` publié

### 1. Télécharger et décompresser

```bash
VER=<ver>   # p. ex. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vmdk.xz   # vmdk streamOptimized, ~1 Go décompressé
```

### 2. Une seule fois : le rôle de service `vmimport`

VM Import s'exécute en tant que service `vmie.amazonaws.com` et nécessite un rôle nommé exactement `vmimport` :

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

### 3. Téléverser et importer

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

Interrogez jusqu'à la fin de l'opération (typiquement 30 à 45 minutes, AWS convertit le disque et enregistre l'AMI) :

```bash
watch -n 60 "aws ec2 describe-import-image-tasks --region $REGION \
  --import-task-ids $TASK \
  --query 'ImportImageTasks[0].[Status,Progress,StatusMessage,ImageId]' --output text"
```

Lorsque `Status` vaut `completed`, le dernier champ est l'ID de votre AMI.

## Lancer une instance

Créez une paire de clés et un groupe de sécurité limité à votre propre IP, la machine expose SSH (22), l'interface SocTalk (443) et l'assistant de configuration (8443), dont aucun ne devrait être ouvert sur Internet :

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

`t3.xlarge` (4 vCPU / 16 Gio) couvre confortablement le [dimensionnement minimal](/fr-fr/reference/sizing) de 4 vCPU / 8 Go. Ne réduisez pas le volume racine, le disque virtuel de l'image fait 60 Go, EC2 exige donc au moins cette taille.

::: tip Aucune ISO d'amorçage nécessaire
Sur les hyperviseurs, vous attachez une `seed.iso` NoCloud pour injecter une clé SSH ([Démarrage rapide](/fr-fr/quickstart-vm#optional-cloud-init-seed)). Sur EC2, cette étape disparaît : le cloud-init de l'image récupère la source de métadonnées EC2 et injecte automatiquement votre paire de clés, cela fonctionne aussi pour le `.vmdk` importé, même s'il a été empaqueté pour VMware. L'utilisateur par défaut sur EC2 est **`ubuntu`**.
:::

## Exécuter l'assistant et se connecter

Même flux que sur toutes les autres plateformes. Laissez environ 2 minutes à l'instance après le démarrage, puis :

```bash
ssh -i soctalk-demo.pem ubuntu@$IP sudo cat /var/log/soctalk-setup-token
```

Rendez-vous sur `https://<IP>:8443/`, acceptez le certificat auto-signé, collez le jeton, remplissez l'assistant ([référence des champs](/fr-fr/setup-wizard)) et validez. L'installateur de premier démarrage exécute `helm install` et intègre le tenant `demo`: environ 2 minutes pour les pods `soctalk-system`, puis quelques minutes de plus pour la pile Wazuh du tenant de démonstration :

```bash
ssh -i soctalk-demo.pem ubuntu@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Rendez-vous ensuite sur `https://<IP>/` (port 443, pas 8443), connectez-vous avec les identifiants administrateur de l'assistant, et poursuivez avec la [visite de l'interface MSSP](/fr-fr/mssp-ui). Si vous avez laissé le nom d'hôte vide dans l'assistant, mappez `soctalk.local` sur l'IP de l'instance dans `/etc/hosts` et utilisez `https://soctalk.local/`.

## Démonter

Contrairement au groupe de ressources unique d'Azure, les ressources EC2 sont individuelles, supprimez chacune :

```bash
aws ec2 terminate-instances --region $REGION --instance-ids $IID
aws ec2 wait instance-terminated --region $REGION --instance-ids $IID

# AMI + son instantané sous-jacent
SNAP=$(aws ec2 describe-images --region $REGION --image-ids $AMI \
  --query 'Images[0].BlockDeviceMappings[0].Ebs.SnapshotId' --output text)
aws ec2 deregister-image --region $REGION --image-id $AMI
aws ec2 delete-snapshot --region $REGION --snapshot-id $SNAP

aws ec2 delete-security-group --region $REGION --group-id $SG
aws ec2 delete-key-pair --region $REGION --key-name soctalk-demo

# Reliquats de l'option B
aws s3 rb s3://$BUCKET --force
aws iam delete-role-policy --role-name vmimport --policy-name vmimport-s3
aws iam delete-role --role-name vmimport
```

Vérifiez qu'il ne reste rien de facturable :

```bash
aws ec2 describe-instances --region $REGION \
  --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'length(Reservations)'
aws ec2 describe-images --region $REGION --owners self --query 'length(Images)'
aws ec2 describe-snapshots --region $REGION --owner-ids self --query 'length(Snapshots)'
```

## Dépannage

| Symptôme | Vérification |
|---|---|
| Packer ou `run-instances` échoue avec `VPCIdNotSpecified` | Le compte/la région n'a pas de VPC par défaut. `aws ec2 create-default-vpc --region $REGION` (supprimez-le à nouveau au démontage si vous n'en voulez pas) |
| `import-image` bloqué sur `validating` / échoue avec une erreur de rôle | Le rôle doit être nommé exactement `vmimport` et faire confiance à `vmie.amazonaws.com` avec l'ID externe `vmimport`: revérifiez l'étape 2 |
| `run-instances` rejette un volume racine plus petit | L'instantané importé fait 60 Go ; le volume racine doit faire ≥ 60 Go. Omettez `--block-device-mappings` pour utiliser la valeur par défaut de l'AMI |
| `SignatureDoesNotMatch` depuis la CLI | Des variables d'environnement `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` obsolètes remplacent `~/.aws/credentials`: utilisez `unset` pour les supprimer |
| Tout ce qui suit l'assistant | Comme sur toutes les plateformes, consultez le [tableau de dépannage du démarrage rapide](/fr-fr/quickstart-vm#troubleshooting) |
