# Ejecutar la VM de demostración en AWS

Pon en marcha el appliance de demostración de SocTalk como una instancia EC2. Hay dos rutas validadas:

- **Opción A — construir una AMI nativa con Packer.** La especificación de Packer del repositorio incluye una fuente `amazon-ebs` que construye la AMI directamente en tu cuenta de AWS. El resultado más limpio; requiere Packer en local.
- **Opción B — importar el `.vmdk` publicado con VM Import.** No necesitas Packer: sube el artefacto de la release a S3 y deja que AWS lo convierta en una AMI. Más lento (la conversión tarda ~30–45 minutos) pero solo usa el AWS CLI.

Ambas terminan en el mismo punto: una AMI que lanzas y luego el flujo estándar del [asistente de configuración](/es-419/setup-wizard). Esta ruta es para **evaluadores y demostraciones** — para una instalación en producción sobre tu propio clúster, consulta [Instalar](/es-419/install).

::: info ¿Por qué no hay una AMI pública prediseñada?
Las AMI son recursos por cuenta y por región — a diferencia de los archivos `.qcow2`/`.vhd`/`.vmdk`, no pueden adjuntarse a una GitHub Release. Construyes o importas una en tu propia cuenta.
:::

## Requisitos previos

- AWS CLI configurado (`aws sts get-caller-identity` funciona) con permisos para EC2, S3 e IAM.
- La Opción A necesita además [Packer](https://developer.hashicorp.com/packer/install) 1.11+ (`brew tap hashicorp/tap && brew install hashicorp/tap/packer` en macOS).

Los ejemplos usan `us-west-2`; ajusta `REGION` a tu gusto.

```bash
REGION=us-west-2
```

## Opción A: construir una AMI nativa con Packer

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.amazon-ebs.soctalk_demo" \
  -var version=<ver> -var aws_region=$REGION .
```

Packer lanza una instancia constructora temporal a partir de la AMI base de Ubuntu 24.04, la aprovisiona de forma idéntica a las imágenes publicadas, toma un snapshot e imprime el ID de la AMI resultante (`soctalk-demo-<ver>-<timestamp>`). Salta a [Lanzar una instancia](#launch-an-instance).

## Opción B: importar el `.vmdk` publicado

### 1. Descargar y descomprimir

```bash
VER=<ver>   # p. ej. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vmdk.xz   # vmdk streamOptimized, ~1 GB descomprimido
```

### 2. Una sola vez: el rol de servicio `vmimport`

VM Import se ejecuta como el servicio `vmie.amazonaws.com` y necesita un rol llamado exactamente `vmimport`:

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

### 3. Subir e importar

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

Consulta el estado hasta que se complete (normalmente 30–45 minutos — AWS convierte el disco y registra la AMI):

```bash
watch -n 60 "aws ec2 describe-import-image-tasks --region $REGION \
  --import-task-ids $TASK \
  --query 'ImportImageTasks[0].[Status,Progress,StatusMessage,ImageId]' --output text"
```

Cuando `Status` sea `completed`, el último campo es el ID de tu AMI.

## Lanzar una instancia

Crea un par de claves y un grupo de seguridad restringido a tu propia IP — la máquina expone SSH (22), la UI de SocTalk (443) y el asistente de configuración (8443), ninguno de los cuales debería estar abierto a Internet:

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

`t3.xlarge` (4 vCPU / 16 GiB) cubre holgadamente el [dimensionamiento mínimo](/es-419/reference/sizing) de 4 vCPU / 8 GB. No reduzcas el volumen raíz — el disco virtual de la imagen es de 60 GB, así que EC2 requiere al menos ese tamaño.

::: tip No se necesita seed ISO
En los hipervisores adjuntas un `seed.iso` NoCloud para inyectar una clave SSH ([Quickstart](/es-419/quickstart-vm#optional-cloud-init-seed)). En EC2 ese paso desaparece: el cloud-init de la imagen detecta el datasource de metadatos de EC2 e inyecta tu par de claves automáticamente — esto también funciona para el `.vmdk` importado, aunque se haya empaquetado para VMware. El usuario predeterminado en EC2 es **`ubuntu`**.
:::

## Ejecutar el asistente e iniciar sesión

El mismo flujo que en cualquier otra plataforma. Da a la instancia ~2 minutos tras el arranque y luego:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP sudo cat /var/log/soctalk-setup-token
```

Navega a `https://<IP>:8443/`, acepta el certificado autofirmado, pega el token, completa el asistente ([referencia de campos](/es-419/setup-wizard)) y envía. El instalador de primer arranque ejecuta `helm install` e incorpora el tenant `demo` — unos 2 minutos para los pods de `soctalk-system`, y luego unos minutos más para el stack de Wazuh del tenant de demostración:

```bash
ssh -i soctalk-demo.pem ubuntu@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Después navega a `https://<IP>/` (puerto 443, no 8443), inicia sesión con las credenciales de administrador del asistente y continúa con el [Recorrido por la UI de MSSP](/es-419/mssp-ui). Si dejaste el hostname en blanco en el asistente, mapea `soctalk.local` a la IP de la instancia en `/etc/hosts` y usa `https://soctalk.local/`.

## Desmontar

A diferencia del grupo de recursos único de Azure, los recursos de EC2 son individuales — elimina cada uno:

```bash
aws ec2 terminate-instances --region $REGION --instance-ids $IID
aws ec2 wait instance-terminated --region $REGION --instance-ids $IID

# AMI + su snapshot de respaldo
SNAP=$(aws ec2 describe-images --region $REGION --image-ids $AMI \
  --query 'Images[0].BlockDeviceMappings[0].Ebs.SnapshotId' --output text)
aws ec2 deregister-image --region $REGION --image-id $AMI
aws ec2 delete-snapshot --region $REGION --snapshot-id $SNAP

aws ec2 delete-security-group --region $REGION --group-id $SG
aws ec2 delete-key-pair --region $REGION --key-name soctalk-demo

# Sobrantes de la Opción B
aws s3 rb s3://$BUCKET --force
aws iam delete-role-policy --role-name vmimport --policy-name vmimport-s3
aws iam delete-role --role-name vmimport
```

Verifica que no quede nada generando cargos:

```bash
aws ec2 describe-instances --region $REGION \
  --filters Name=instance-state-name,Values=pending,running,stopping,stopped \
  --query 'length(Reservations)'
aws ec2 describe-images --region $REGION --owners self --query 'length(Images)'
aws ec2 describe-snapshots --region $REGION --owner-ids self --query 'length(Snapshots)'
```

## Solución de problemas

| Síntoma | Comprobación |
|---|---|
| Packer o `run-instances` falla con `VPCIdNotSpecified` | La cuenta/región no tiene una VPC predeterminada. `aws ec2 create-default-vpc --region $REGION` (bórrala de nuevo en el desmontaje si no la quieres) |
| `import-image` atascado en `validating` / falla con un error de rol | El rol debe llamarse exactamente `vmimport` y confiar en `vmie.amazonaws.com` con el ID externo `vmimport` — vuelve a revisar el paso 2 |
| `run-instances` rechaza un volumen raíz más pequeño | El snapshot importado es de 60 GB; el volumen raíz debe ser ≥ 60 GB. Omite `--block-device-mappings` para usar el valor predeterminado de la AMI |
| `SignatureDoesNotMatch` desde el CLI | Variables de entorno `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` obsoletas que anulan `~/.aws/credentials` — usa `unset` con ellas |
| Cualquier cosa después del asistente | Igual que en cualquier plataforma — consulta la [tabla de solución de problemas del Quickstart](/es-419/quickstart-vm#troubleshooting) |
