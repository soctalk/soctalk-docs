# Die Demo-VM auf AWS ausführen

Bringen Sie die SocTalk-Demo-Appliance als EC2-Instanz zum Laufen. Es gibt zwei validierte Wege:

- **Option A, ein natives AMI mit Packer bauen.** Die Packer-Spezifikation des Repos enthält eine `amazon-ebs`-Quelle, die das AMI direkt in Ihrem AWS-Konto baut. Sauberstes Ergebnis, benötigt Packer lokal.
- **Option B, die veröffentlichte `.vmdk` mit VM Import importieren.** Kein Packer nötig: Laden Sie das Release-Artefakt nach S3 hoch und lassen Sie AWS es in ein AMI konvertieren. Langsamer (die Konvertierung dauert ~30–45 Minuten), verwendet aber nur die AWS CLI.

Beide enden am selben Punkt: einem AMI, das Sie starten, gefolgt vom üblichen Ablauf des [Setup-Assistenten](/de-de/setup-wizard). Dieser Weg ist für **Evaluatoren und Demos**: für eine Produktivinstallation auf Ihrem eigenen Cluster siehe [Installation](/de-de/install).

::: info Warum kein vorgefertigtes öffentliches AMI?
AMIs sind Ressourcen pro Konto und pro Region, anders als die `.qcow2`/`.vhd`/`.vmdk`-Dateien können sie nicht an ein GitHub-Release angehängt werden. Sie bauen oder importieren eines in Ihr eigenes Konto.
:::

## Voraussetzungen

- AWS CLI konfiguriert (`aws sts get-caller-identity` funktioniert) mit Berechtigungen für EC2, S3 und IAM.
- Option A benötigt zusätzlich [Packer](https://developer.hashicorp.com/packer/install) 1.11+ (`brew tap hashicorp/tap && brew install hashicorp/tap/packer` unter macOS).

Die Beispiele verwenden `us-west-2`; setzen Sie `REGION` nach Belieben.

```bash
REGION=us-west-2
```

## Option A: ein natives AMI mit Packer bauen

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.amazon-ebs.soctalk_demo" \
  -var version=<ver> -var aws_region=$REGION .
```

Packer startet eine temporäre Builder-Instanz vom Ubuntu-24.04-Basis-AMI, provisioniert sie identisch zu den veröffentlichten Images, erstellt einen Snapshot und gibt die resultierende AMI-ID aus (`soctalk-demo-<ver>-<timestamp>`). Springen Sie weiter zu [Eine Instanz starten](#launch-an-instance).

## Option B: die veröffentlichte `.vmdk` importieren

### 1. Herunterladen und entpacken

```bash
VER=<ver>   # e.g. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vmdk.xz   # streamOptimized vmdk, ~1 GB decompressed
```

### 2. Einmalig: die Service-Rolle `vmimport`

VM Import läuft als der Service `vmie.amazonaws.com` und benötigt eine Rolle mit exakt dem Namen `vmimport`:

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

### 3. Hochladen und importieren

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

Fragen Sie so lange ab, bis der Vorgang abgeschlossen ist (typischerweise 30–45 Minuten, AWS konvertiert die Festplatte und registriert das AMI):

```bash
watch -n 60 "aws ec2 describe-import-image-tasks --region $REGION \
  --import-task-ids $TASK \
  --query 'ImportImageTasks[0].[Status,Progress,StatusMessage,ImageId]' --output text"
```

Wenn `Status` gleich `completed` ist, ist das letzte Feld Ihre AMI-ID.

## Eine Instanz starten

Erstellen Sie ein Schlüsselpaar und eine Sicherheitsgruppe, die auf Ihre eigene IP beschränkt ist; die Box stellt SSH (22), die SocTalk-UI (443) und den Setup-Assistenten (8443) bereit, von denen keiner zum Internet hin offen sein sollte:

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

`t3.xlarge` (4 vCPU / 16 GiB) deckt die [Mindestdimensionierung](/de-de/reference/sizing) von 4 vCPU / 8 GB bequem ab. Verkleinern Sie das Root-Volume nicht; die virtuelle Festplatte des Images ist 60 GB groß, daher verlangt EC2 mindestens diese Größe.

::: tip Keine Seed-ISO nötig
Bei Hypervisoren hängen Sie eine NoCloud-`seed.iso` an, um einen SSH-Schlüssel einzuspeisen ([Schnellstart](/de-de/quickstart-vm#optional-cloud-init-seed)). Auf EC2 entfällt dieser Schritt: Das cloud-init des Images greift auf die EC2-Metadaten-Datenquelle zu und speist Ihr Schlüsselpaar automatisch ein; das funktioniert auch für die importierte `.vmdk`, obwohl sie für VMware paketiert wurde. Der Standardbenutzer auf EC2 ist **`ubuntu`**.
:::

## Den Assistenten ausführen und sich anmelden

Derselbe Ablauf wie auf jeder anderen Plattform. Geben Sie der Instanz nach dem Boot ~2 Minuten Zeit, dann:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP sudo cat /var/log/soctalk-setup-token
```

Rufen Sie `https://<IP>:8443/` auf, akzeptieren Sie das selbstsignierte Zertifikat, fügen Sie das Token ein, füllen Sie den Assistenten aus ([Feldreferenz](/de-de/setup-wizard)) und senden Sie ab. Der First-Boot-Installer führt `helm install` aus und onboardet den `demo`-Mandanten, etwa 2 Minuten für die `soctalk-system`-Pods, dann ein paar weitere für den Wazuh-Stack des Demo-Mandanten:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Rufen Sie dann `https://<IP>/` auf (Port 443, nicht 8443), melden Sie sich mit den im Assistenten festgelegten Admin-Zugangsdaten an und fahren Sie mit der [MSSP-UI-Tour](/de-de/mssp-ui) fort. Wenn Sie den Hostnamen im Assistenten leer gelassen haben, ordnen Sie `soctalk.local` in `/etc/hosts` der Instanz-IP zu und verwenden Sie `https://soctalk.local/`.

## Abbauen

Anders als bei der einzelnen Ressourcengruppe von Azure sind EC2-Ressourcen einzeln, löschen Sie jede:

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

Prüfen Sie, dass nichts mehr Kosten verursacht:

```bash
aws ec2 describe-instances --region $REGION \
  --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'length(Reservations)'
aws ec2 describe-images --region $REGION --owners self --query 'length(Images)'
aws ec2 describe-snapshots --region $REGION --owner-ids self --query 'length(Snapshots)'
```

## Fehlerbehebung

| Symptom | Prüfung |
|---|---|
| Packer oder `run-instances` schlägt mit `VPCIdNotSpecified` fehl | Das Konto/die Region hat keine Standard-VPC. `aws ec2 create-default-vpc --region $REGION` (beim Abbau wieder löschen, falls Sie sie nicht behalten möchten) |
| `import-image` hängt in `validating` / schlägt mit einem Rollenfehler fehl | Die Rolle muss exakt `vmimport` heißen und `vmie.amazonaws.com` mit der externen ID `vmimport` vertrauen, prüfen Sie Schritt 2 erneut |
| `run-instances` lehnt ein kleineres Root-Volume ab | Der importierte Snapshot ist 60 GB groß; das Root-Volume muss ≥ 60 GB sein. Lassen Sie `--block-device-mappings` weg, um den AMI-Standard zu verwenden |
| `SignatureDoesNotMatch` von der CLI | Veraltete `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` Umgebungsvariablen überschreiben `~/.aws/credentials`: `unset` sie |
| Alles nach dem Assistenten | Wie auf jeder Plattform, siehe die [Schnellstart-Fehlerbehebungstabelle](/de-de/quickstart-vm#troubleshooting) |
