# Ejecutar la VM de demostración en Proxmox VE

Importa la imagen publicada `soctalk-demo-<ver>.qcow2` en Proxmox VE y arráncala. qcow2 es el formato de disco nativo de Proxmox, así que esta es una importación de un solo comando — sin paso de conversión.

Esta ruta es para **evaluadores y demostraciones** — para una instalación en producción sobre tu propio clúster consulta [Instalación](/es-419/install). Validado en Proxmox VE 8.4.

## Requisitos previos

- Un nodo Proxmox VE 8.x con ≥ 4 vCPU / 8 GB de RAM / 60 GB de almacenamiento disponibles ([dimensionamiento](/es-419/reference/sizing)).
- Un almacenamiento que acepte contenido de **Disk image** (el `local-lvm` por defecto o un almacenamiento de directorio como `local` con *Disk image* habilitado).
- Acceso por shell al nodo (la importación del disco es un solo comando `qm`; todo lo demás ocurre en la interfaz web).

## 1. Descarga la imagen en el nodo

Conéctate por SSH al nodo Proxmox:

```bash
VER=<ver>   # e.g. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.qcow2.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.qcow2.xz
```

## 2. Construye el ISO semilla de cloud-init

Un ISO semilla NoCloud crea un usuario `ops` con tu clave SSH. Sin él aún puedes iniciar sesión como el usuario de tiempo de compilación `ubuntu:packer` (consulta [Acceso SSH](/es-419/quickstart-vm#ssh-access-credentials)), pero esa credencial está en el árbol de código público — proporciona la semilla antes de exponer la VM a una red en la que no confíes. En el nodo, o en cualquier equipo Linux:

```bash
cat > user-data <<'EOF'
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
cat > meta-data <<'EOF'
instance-id: soctalk-demo-001
local-hostname: soctalk-demo
EOF
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
# (apt install genisoimage if missing; cloud-localds from cloud-image-utils also works)
mv soctalk-seed.iso /var/lib/vz/template/iso/
```

Si construiste el ISO en otro lugar, súbelo en la interfaz en su lugar: selecciona el almacenamiento `local` → **ISO Images** → **Upload**.

::: tip
Puedes omitir el asistente por completo añadiendo `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` a la semilla mediante `write_files` — consulta [Opcional: semilla de cloud-init](/es-419/quickstart-vm#optional-cloud-init-seed).
:::

## 3. Crea la VM en la interfaz web

Haz clic en **Create VM** (arriba a la derecha) y recorre el asistente:

**General** — elige un ID y nombre para la VM:

![Create VM — General](/screenshots/proxmox-create-general.png)

**OS** — selecciona **Do not use any media** (el sistema operativo ya está en el disco importado):

![Create VM — OS](/screenshots/proxmox-create-os.png)

**System** — mantén los valores por defecto (SeaBIOS, i440fx — la imagen arranca vía firmware BIOS).

**Disks** — elimina el disco por defecto con el ícono de papelera junto a `scsi0`; el qcow2 importado lo reemplaza:

![Create VM — Disks](/screenshots/proxmox-create-disks.png)

**CPU** — 4 núcleos, y establece **Type** en `host`:

![Create VM — CPU](/screenshots/proxmox-create-cpu.png)

**Memory** — 8192 MiB:

![Create VM — Memory](/screenshots/proxmox-create-memory.png)

**Network** — tu puente LAN (típicamente `vmbr0`), modelo VirtIO:

![Create VM — Network](/screenshots/proxmox-create-network.png)

**Confirm** — Finaliza. Aún no inicies la VM.

## 4. Importa el disco

El único paso por CLI. En el nodo (ajusta el ID de la VM y el almacenamiento de destino):

```bash
qm disk import 100 soctalk-demo-<ver>.qcow2 local --format qcow2
```

En almacenamiento LVM-thin (`local-lvm`) omite la opción `--format` — los almacenamientos de bloques guardan en raw. La importación aparece en la VM como **Unused Disk 0**.

## 5. Adjunta el disco, el ISO semilla y el orden de arranque

De vuelta en la interfaz, abre el panel **Hardware** de la VM:

![Hardware — unused disk](/screenshots/proxmox-hardware-unused.png)

- Haz doble clic en **Unused Disk 0** → deja Bus/Device en `SCSI 0` → **Add**:

![Attach the imported disk](/screenshots/proxmox-attach-disk.png)

- Haz doble clic en **CD/DVD Drive (ide2)** → *Use CD/DVD disc image file* → almacenamiento `local`, ISO `soctalk-seed.iso` → **OK**:

![Mount the seed ISO](/screenshots/proxmox-attach-seed.png)

- **Options** → **Boot Order** → coloca `scsi0` primero (o `qm set 100 --boot order=scsi0`).

El panel Hardware debería verse ahora así:

![Hardware — final](/screenshots/proxmox-hardware-final.png)

## 6. Inicia y encuentra la IP de la VM

Haz clic en **Start**. El panel Summary muestra la VM en ejecución:

![VM running](/screenshots/proxmox-vm-running.png)

La **Console** muestra el appliance arrancando hasta un prompt de inicio de sesión:

![Console — booted](/screenshots/proxmox-vm-console.png)

La VM toma una concesión DHCP de tu puente LAN. Encuentra su IP desde la consola (`login: ops` funciona solo con clave SSH — usa la salida de la consola o tu servidor/router DHCP), o desde el nodo:

```bash
# the MAC is on the VM's Network Device (net0)
grep -B2 -A2 "$(qm config 100 | grep -oP 'virtio=\K[^,]+')" /var/lib/misc/dnsmasq.leases 2>/dev/null \
  || arp -an | grep -i "$(qm config 100 | grep -oP 'virtio=\K[^,]+')"
```

## 7. Ejecuta el asistente e inicia sesión

El mismo flujo que en cada plataforma a partir de aquí:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Navega a `https://<vm-ip>:8443/`, acepta el certificado autofirmado, pega el token y completa el asistente ([referencia de campos](/es-419/setup-wizard)). Tras enviarlo, el instalador de primer arranque ejecuta `helm install` e incorpora el tenant `demo` — unos 2 minutos para los pods de `soctalk-system`, y luego unos minutos más para el stack de Wazuh del tenant de demostración.

Luego navega a `https://<vm-ip>/` (puerto 443, no 8443), inicia sesión con las credenciales de administrador del asistente y continúa con el [Recorrido por la interfaz MSSP](/es-419/mssp-ui). Si dejaste el nombre de host en blanco en el asistente, mapea `soctalk.local` a la IP de la VM en `/etc/hosts` y usa `https://soctalk.local/`.

## Solución de problemas

| Síntoma | Verificación |
|---|---|
| `qm disk import` falla con un error de almacenamiento | El almacenamiento de destino debe permitir contenido de **Disk image**: Datacenter → Storage → edit → Content |
| La VM arranca en "No bootable device" | El orden de arranque aún apunta al disco por defecto eliminado — Options → Boot Order → `scsi0` primero |
| El asistente aparece pero no hay SSH | El ISO semilla no está adjunto (Hardware → ide2) o la clave en `user-data` es incorrecta; puedes leer el token desde la Console en su lugar: `sudo cat /var/log/soctalk-setup-token` |
| La VM no tiene IP | `ip a` desde la Console; verifica que el puente en Hardware → net0 coincida con un puente con DHCP en tu LAN |
| La VM tiene IP pero no internet (configuraciones con puente NAT) | PVE establece `bridge-nf-call-iptables=1`, lo que puede hacer que el tráfico puenteado eluda una regla `MASQUERADE` acotada a la interfaz de enlace ascendente. `sysctl -w net.bridge.bridge-nf-call-iptables=0` (si no usas el firewall de PVE) o usa una regla independiente de la interfaz: `iptables -t nat -A POSTROUTING -s <subnet> ! -d <subnet> -j MASQUERADE`, luego vacía conntrack |
| Cualquier cosa más allá del asistente | Igual que en cada plataforma — consulta la [tabla de solución de problemas del Quickstart](/es-419/quickstart-vm#troubleshooting) |
