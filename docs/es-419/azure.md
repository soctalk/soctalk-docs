# Ejecutar la VM de demostración en Azure

Importa la imagen publicada `soctalk-demo-<ver>.vhd` en Azure como un disco administrado, conviértela en una imagen de VM y arráncala. Las VM de Azure se ejecutan sobre Hyper-V, así que esta es también la forma más rápida de validar la imagen en un hipervisor Hyper-V sin tener que levantar un host de Windows Server.

Esta ruta es para **evaluadores y demostraciones**: para una instalación en producción en tu propio clúster consulta [Instalación](/es-419/install).

## Por qué el `.vhd` (y por qué Generation 1)

- Azure solo acepta discos **VHD de tamaño fijo y alineados a 1 MiB** (no VHDX, ni VHD dinámico). El `soctalk-demo-<ver>.vhd` publicado lo emite el pipeline de releases exactamente de esa manera (`qemu-img convert -O vpc -o subformat=fixed,force_size`), por lo que se importa tal cual, sin paso de conversión local.
- La imagen se construye y se prueba de arranque bajo firmware BIOS, que corresponde a las VM **Generation 1** de Azure. Crea el disco y la imagen con `--hyper-v-generation V1`.
- Un VHD fijo de 60 GB suena pesado, pero es casi todo ceros. `azcopy` sube a un page blob y **omite las páginas de ceros**, así que la transferencia real es aproximadamente los ~3 GB de datos reales.

## Requisitos previos

- Una suscripción de Azure (`az account list` debe mostrar una, el acceso al directorio a nivel de tenant no es suficiente).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) y [AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10) (`azcopy`). En macOS: `brew install azure-cli azcopy`.
- ~61 GB de disco local libre para el VHD descomprimido.
- Un par de claves SSH (`~/.ssh/id_ed25519.pub` en los ejemplos de abajo).

Inicia sesión y selecciona la suscripción:

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

## 1. Descargar y descomprimir el VHD

```bash
VER=<ver>   # p. ej. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vhd.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vhd.xz   # descomprime a un VHD fijo de 60 GB
```

## 2. Crear un grupo de recursos

Todo en esta guía vive en un solo grupo de recursos, así que el desmontaje es un único comando al final.

```bash
RG=soctalk-demo
LOC=westus2
az group create -n $RG -l $LOC
```

## 3. Subir el VHD directamente a un disco administrado

No se necesita cuenta de almacenamiento, Azure admite la subida directa a un disco administrado. Crea un disco vacío dimensionado al conteo exacto de bytes del archivo VHD, obtén un SAS de escritura de corta duración, sube con `azcopy` y luego revoca el SAS:

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

El paso de `azcopy` es el único largo; con la omisión de páginas de ceros solo mueve los datos reales (~3 GB).

## 4. Crear una imagen a partir del disco

```bash
DISK_ID=$(az disk show -g $RG -n soctalk-demo --query id -o tsv)

az image create -g $RG -n soctalk-demo-image \
  --source $DISK_ID --os-type Linux --hyper-v-generation V1
```

## 5. Arrancar una VM

Limita el grupo de seguridad de red a tu propia IP, la máquina expone SSH (22), la UI de SocTalk (443) y el asistente de configuración (8443), ninguno de los cuales debería estar abierto a internet:

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

`Standard_D4s_v3` (4 vCPU / 16 GiB) cubre cómodamente el [dimensionamiento mínimo](/es-419/reference/sizing) de 4 vCPU / 8 GB. Cualquier cosa más pequeña tendrá dificultades una vez que el stack de Wazuh del tenant de demostración arranque.

::: tip No se necesita seed ISO
En los hipervisores adjuntas un `seed.iso` NoCloud para inyectar una clave SSH ([Quickstart](/es-419/quickstart-vm#optional-cloud-init-seed)). En Azure ese paso desaparece: el cloud-init de la imagen detecta el datasource de Azure y aprovisiona `--admin-username` / `--ssh-key-values` automáticamente.
:::

## 6. Obtener el token de configuración y ejecutar el asistente

El mismo flujo que en cualquier otro hipervisor a partir de aquí. Dale a la VM ~2 minutos después del arranque para que el servicio del asistente se levante, y luego:

```bash
ssh ops@$IP sudo cat /var/log/soctalk-setup-token
```

Navega a `https://<IP>:8443/`, acepta el certificado autofirmado, pega el token y completa el asistente, nombre del MSSP, credenciales de administrador, proveedor de LLM + API key. Consulta [Asistente de configuración](/es-419/setup-wizard) para la referencia de campos.

Tras enviar, el instalador de primer arranque ejecuta `helm install` e incorpora el tenant `demo`: alrededor de 2 minutos para los pods de `soctalk-system`, y luego unos minutos más para el stack de Wazuh del tenant de demostración. Puedes observarlo desde SSH:

```bash
ssh ops@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

## 7. Iniciar sesión

Navega a `https://<IP>/` (puerto 443, no 8443) e inicia sesión con las credenciales de administrador del asistente. Si dejaste el hostname en blanco en el asistente, mapea `soctalk.local` a la IP de la VM en `/etc/hosts` y usa `https://soctalk.local/`. Continúa con el [Recorrido por la UI del MSSP](/es-419/mssp-ui).

## 8. Desmontar

Todo se creó dentro del grupo de recursos, así que:

```bash
az group delete -n $RG --yes --no-wait
```

Esto elimina la VM, la NIC, la IP pública, el NSG, el disco administrado y la imagen de una sola vez. No queda nada más generando cargos.

## Solución de problemas

| Síntoma | Comprobación |
|---|---|
| `az disk create --for-upload` rechazado | `--upload-size-bytes` debe ser el tamaño **exacto** del archivo en bytes del `.vhd` descomprimido, footer incluido, vuelve a ejecutar el comando `stat` |
| `azcopy` falla con 403 | El SAS de escritura expiró (24 h en el ejemplo) o ya fue revocado, vuelve a ejecutar `az disk grant-access` |
| La VM nunca obtiene la clave SSH | Confirma que la imagen y el disco se crearon con `--hyper-v-generation V1`; una imagen V2 a partir de este VHD no arrancará, y un arranque fallido nunca llega a cloud-init |
| La URL del asistente nunca carga | Falta la regla del NSG para el 8443 o tu IP pública cambió (`curl ifconfig.me` y compara); luego `systemctl status soctalk-setup-wizard` por SSH |
| Cualquier cosa después del asistente | Igual que en cada plataforma, consulta la [tabla de solución de problemas del Quickstart](/es-419/quickstart-vm#troubleshooting) |
