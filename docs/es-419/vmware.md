# Ejecutar la VM de demostración en VMware ESXi

Importa el `soctalk-demo-<ver>.vmdk` publicado en VMware ESXi y arráncalo. Esta guía cubre **ESXi 7/8** con el Host Client integrado (la interfaz web). Si en su lugar ejecutas Fusion o Workstation en una laptop, el flujo es casi idéntico; importa el mismo vmdk mediante File → Open.

Este camino es para **evaluadores y demostraciones** que ejecutan SocTalk en su ESXi on-premise existente. Para una instalación en producción sobre tu propio clúster de Kubernetes, consulta [Instalación](/es-419/install). Validado en ESXi 8.0.3 (build 24677879) con Host Client 2.x.

## Requisitos previos

- ESXi 7.0 o más reciente con un datastore de usuario existente (VMFS). Si aún no tienes un datastore, la [sección Nuevo datastore](#optional-create-a-vmfs-datastore) más abajo te guía en el proceso.
- Root o un usuario con el privilegio `Virtual machine.Provisioning.Deploy from template`.
- Un grupo de puertos (normalmente la **VM Network** creada automáticamente) que tenga DHCP + HTTPS saliente.
- ~10 GB libres en el datastore (el vmdk pesa ~800 MB streamOptimized pero se convierte en un disco VMFS thin de 60 GB que crece bajo demanda).
- Un par de claves SSH (`~/.ssh/id_ed25519.pub` en los ejemplos) para leer el token de configuración por SSH.

::: warning Necesitas un datastore VMFS real, no el volumen OSDATA de ESXi
El instalador de ESXi crea un volumen `OSDATA-*` en el disco de arranque. Aparece en `esxcli storage filesystem list` y se monta bajo `/vmfs/volumes/`, pero **no** es un datastore de usuario normal y las VMs almacenadas en él no encienden, fallando con `msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`. Agrega un disco o partición aparte y formatéalo como VMFS antes de continuar.
:::

## 1. Descargar y verificar la imagen

Obtén el **vmdk** desde la página de [Descargas](/es-419/downloads). En cualquier host Linux/macOS que tenga `ovftool` o con acceso por SSH a la consola de una VM en ESXi:

```bash
VER=0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

Ahora tienes `soctalk-demo-<ver>.vmdk`, un disco de VMware **streamOptimized** (hosted). El VMFS de ESXi no lo ejecuta directamente; el §4 lo convierte una vez con `vmkfstools`.

## 2. Construir un ISO seed de cloud-init

Un pequeño ISO seed NoCloud crea un usuario `ops` con tu clave SSH para que puedas leer el token de configuración por arranque. Si lo omites, aún puedes iniciar sesión como el usuario de tiempo de construcción `ubuntu:packer` (consulta [Acceso SSH](/es-419/quickstart-vm#ssh-access-credentials)) — pero esa credencial está en el árbol de código fuente público, así que endurece la VM antes de exponerla. En Linux/macOS:

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat ~/.ssh/id_ed25519.pub)
EOF
printf 'instance-id: soctalk-demo\nlocal-hostname: soctalk-demo\n' > meta-data
# Linux: genisoimage / cloud-localds   •   macOS: hdiutil o mkisofs (brew install cdrtools)
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
```

## 3. (Opcional) Crear un datastore VMFS

Omite este paso si tu ESXi ya tiene un datastore de usuario (p. ej. `datastore1`) con 10+ GB libres.

Inicia sesión en el Host Client y ve a **Storage** → **Datastores**. Una instalación a la que no se le ha asignado un disco de datos se ve así:

![ESXi Host Client — pestaña Storage sin datastores](/screenshots/esxi-storage-empty.png)

Haz clic en **New datastore** para abrir el asistente de 5 pasos.

**Paso 1 — Select creation type.** Elige **Create new VMFS datastore**. Next.

![Nuevo datastore paso 1 — tipo de creación](/screenshots/esxi-new-datastore-01-type.png)

**Paso 2 — Name and select device.** Introduce un nombre (`datastore1` es lo convencional) y elige el disco a formatear. Aquí solo aparecen los discos no reclamados.

![Nuevo datastore paso 2 — nombre](/screenshots/esxi-new-datastore-02-name.png)
![Nuevo datastore paso 3 — selección de dispositivo](/screenshots/esxi-new-datastore-03-device.png)

**Paso 3 — Select partitioning options.** Por defecto: **Use full disk, VMFS 6**. Confirma y haz clic en Next.

![Nuevo datastore paso 4 — particionado](/screenshots/esxi-new-datastore-04-partition.png)

**Paso 4 — Ready to complete.** Revisa el resumen y haz clic en **Finish**. ESXi advierte que el disco será reparticionado; confirma.

![Nuevo datastore paso 5 — revisión](/screenshots/esxi-new-datastore-05-review.png)

**Resultado.** Storage → Datastores ahora muestra el nuevo datastore VMFS6. Recent tasks informa que tanto **Create Vmfs Datastore** como **Rescan Vmfs** se completaron correctamente.

![Datastore creado](/screenshots/esxi-datastore-created.png)

## 4. Subir y convertir el vmdk

El vmdk de GHCR es streamOptimized. El subsistema de VM de ESXi necesita un disco VMFS thin. Dos caminos:

::: code-group

```bash [SSH + vmkfstools (recomendado)]
# Habilita SSH en el host ESXi: Host Client → Actions → Services → Enable SSH
# Copia el vmdk al datastore (desde cualquier host que tenga scp)
DS=/vmfs/volumes/datastore1
scp soctalk-demo-0.2.0.vmdk root@<esxi-host>:$DS/soctalk-source.vmdk

# En el host ESXi: convierte a VMFS thin (~1 minuto en un SSD rápido)
ssh root@<esxi-host>
mkdir -p /vmfs/volumes/datastore1/SocTalk-Demo
vmkfstools -i /vmfs/volumes/datastore1/soctalk-source.vmdk \
           /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmdk -d thin
rm /vmfs/volumes/datastore1/soctalk-source.vmdk
```

```bash [ovftool desde tu estación de trabajo]
# Envuelve el vmdk en un OVF mínimo y lo envía a ESXi en un solo comando
ovftool --acceptAllEulas --diskMode=thin \
  --datastore=datastore1 \
  --net:"VM Network"="VM Network" \
  --name=SocTalk-Demo \
  soctalk-demo-0.2.0.vmdk \
  vi://root:<password>@<esxi-host>
```

:::

Sube también el ISO seed mediante **Storage → Datastore browser → Upload**:

```
[datastore1]/SocTalk-Demo/soctalk-seed.iso
```

## 5. Crear la VM

Ve a **Virtual Machines** en el Host Client y haz clic en **Create / Register VM** para abrir el asistente de 5 pasos.

![Asistente Create / Register VM](/screenshots/esxi-create-vm-wizard.png)

Recorre el asistente:

- **Select creation type** — **Register an existing virtual machine** (ya colocamos el vmdk en el paso 4).

Si tu build de ESXi oculta esa opción o prefieres configurar todo desde el asistente, elige **Create a new virtual machine** en su lugar y usa estos ajustes:

- **Select a name and guest OS** — Nombre `SocTalk-Demo`. Compatibilidad `ESXi 8.0 virtual machine`. Familia de SO invitado `Linux`. Versión de SO invitado `Ubuntu Linux (64-bit)`.
- **Select storage** — `datastore1`.
- **Customize settings** — configura:
  - **CPU** 4
  - **Memory** 8 GB
  - **Hard disk 1** — haz clic en la fila del disco → **Existing hard disk**, navega a `[datastore1] SocTalk-Demo/SocTalk-Demo.vmdk`
  - **Network adapter 1** — Red `VM Network`, tipo de adaptador `VMXNET3` (la NIC paravirtualizada recomendada por VMware; úsala en ESXi bare-metal para el mejor rendimiento)
  - **CD/DVD drive 1** — Datastore ISO file, navega a `soctalk-seed.iso` — marca **Connect at power on**
  - Deja el controlador USB y Floppy en sus valores por defecto.
- **Ready to complete** — Finish.

La VM aparece en la lista Virtual Machines con `Register VM` marcado como completado correctamente.

![VM registrada en datastore1](/screenshots/esxi-vm-registered.png)

## 6. Encender y abrir la consola

Selecciona **SocTalk-Demo** y haz clic en **Power on**. El encabezado cambia al estado verde de encendido y la miniatura de la consola comienza a actualizarse.

![VM encendida, panel de hardware visible](/screenshots/esxi-vm-powered-on.png)

Haz clic en **Console** → **Open browser console** (la pestaña independiente es más fácil de usar para escribir que la vista previa incrustada).

![Menú desplegable de la consola](/screenshots/esxi-console-menu.png)

La consola muestra Ubuntu 24.04 arrancando a través de cloud-init y llegando a un prompt de inicio de sesión:

![Consola de la VM — arranque de Ubuntu hasta el login](/screenshots/esxi-vm-console-boot.png)

## 7. Iniciar sesión en la VM

Tienes dos formas de entrar, ambas te dan un shell desde el que puedes hacer `sudo -i` para convertirte en root.

::: code-group

```bash [SSH como ops (ISO seed requerido)]
# Desde el host cuya clave pública SSH está en el ISO seed que construiste en §2.
# La IP de la VM se muestra en el Host Client bajo SocTalk-Demo →
# General information → Networking.
ssh ops@<vm-ip>

# Desde el shell de ops:
sudo -i        # → shell de root (sudo NOPASSWD, sin solicitud de contraseña)
whoami         # → root
```

```bash [SSH como ubuntu:packer (fallback — sin ISO seed)]
# Cada imagen publicada incluye una cuenta ``ubuntu`` de tiempo de construcción con contraseña
# ``packer``. Esta credencial está en el árbol de código fuente público, así que trátala como
# información pública; endurece o elimina la cuenta antes de exponer la VM.
ssh ubuntu@<vm-ip>
# Contraseña: packer

# Desde el shell de ubuntu:
sudo -i        # → shell de root (sudo NOPASSWD, sin solicitud de contraseña)
```

```text [Consola del navegador (sin SSH disponible)]
# Host Client → SocTalk-Demo → Console → Open browser console
# Mismas credenciales que las pestañas SSH de arriba.

packer-build login: ubuntu
Password: packer                    # no se muestra en pantalla

ubuntu@packer-build:~$ sudo -i
root@packer-build:~#
```

:::

::: warning Endurece o elimina la credencial packer antes de exponer la VM
El login `ubuntu:packer` está incorporado en cada imagen publicada y reside en el árbol de código fuente público. En cualquier VM que salga de un laboratorio aislado: `sudo passwd -l ubuntu` (bloquea la cuenta) más `sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null && sudo systemctl reload ssh`. Consulta [Acceso SSH + credenciales](/es-419/quickstart-vm#ssh-access-credentials) para la historia completa de endurecimiento.
:::

## 8. Leer el token de configuración

Desde el host que posee la clave privada SSH del ISO seed:

```bash
# Encuentra la IP de la VM: Host Client → SocTalk-Demo → General information → Networking
ssh ops@<vm-ip> sudo cat /run/soctalk/setup-token
```

Copia el token, luego abre **https://\<vm-ip\>/** en un navegador y pégalo cuando el asistente lo pida. Continúa desde el [paso 6 de Quickstart VM](/es-419/quickstart-vm#_6-open-the-setup-wizard).

Una vez que la instalación se completa, estás en el MSSP Dashboard:

![Dashboard MSSP de SocTalk en ESXi](/screenshots/esxi-soctalk-mssp-dashboard.png)

## Resolución de problemas

Las entradas de abajo aplican a hosts ESXi bare-metal reales a menos que lleven una etiqueta **(solo laboratorio anidado)**. Las etiquetadas aparecieron al validar esta guía en ESXi anidado (ESXi 8.0.3 como invitado KVM bajo Ubuntu 24.04) y no afectan al hardware de producción.

**`msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`** — los archivos de la VM residen bajo `/vmfs/volumes/OSDATA-*` en lugar de un datastore de usuario real. Muévelos: haz `vmkfstools -i` del vmdk hacia un datastore VMFS real (§3 + §4), copia el `.vmx` junto a él, desregistra la VM antigua (`vim-cmd vmsvc/unregister <id>`) y registra la nueva (`vim-cmd solo/registervm /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmx SocTalk-Demo`).

**La VM arranca pero la interfaz de red está DOWN y nunca obtiene una IP** — la imagen de packer incluye una configuración de netplan que coincide por MAC. Cuando ESXi asigna una MAC nueva a la vNIC, la coincidencia falla y DHCP nunca se ejecuta. Corrígelo editando `/etc/netplan/50-cloud-init.yaml` para que coincida por nombre de interfaz en su lugar:

```yaml
network:
  version: 2
  ethernets:
    all:
      match:
        name: "en*"
      dhcp4: true
```

Luego `netplan apply`.

**`ovftool: error while loading shared libraries: libssl.so.1.1`** — instala un runtime compatible de OpenSSL 1.1, o usa el camino de SSH + `vmkfstools` en su lugar.

**El Host Client muestra un banner rojo sobre el ESXi Shell / SSH estando habilitado** — esperado en configuraciones de evaluación. Es un recordatorio de endurecimiento, no un error. Deshabilita SSH cuando termines si el host está expuesto.

### Solo laboratorio anidado

Estos aparecen cuando el propio ESXi se ejecuta como invitado dentro de otro hipervisor (KVM, VirtualBox, Fusion, Workstation, o una instancia cloud "bare-metal-lite"). En ESXi bare-metal real no verás ninguno de ellos; los valores por defecto del §5 (NIC VMXNET3, versión de hardware 20, USB + Floppy habilitados) funcionan tal cual.

**El encendido falla con `E1000PCI: failed to register e1000e device` o `Vmxnet3 PCI: failed to reserve slot` (solo laboratorio anidado)** — el hipervisor externo no emula suficiente topología PCIe para que ESXi asigne un slot a la NIC paravirtualizada. Edita `SocTalk-Demo.vmx` y establece `ethernet0.virtualDev = "e1000"` (la NIC emulada clásica, que necesita menos), luego `vim-cmd vmsvc/reload <id>` y enciende de nuevo. En hardware real, mantén VMXNET3.

**vmx da segfault con signal 11 / `msg.vmx.poweron.failed` en la versión de hardware 20 (solo laboratorio anidado)** — algunos hipervisores externos no anuncian las funciones más nuevas de PCIe/EPT que asume vmx-20. Edita `SocTalk-Demo.vmx` y baja a `virtualHW.version = "15"`, elimina `usb.present = "TRUE"` y `floppy0.present = "TRUE"` (o establece ambos en `"FALSE"`), luego `vim-cmd vmsvc/reload <id>` e inténtalo de nuevo. El ESXi bare-metal real ejecuta vmx-20 sin problemas.
