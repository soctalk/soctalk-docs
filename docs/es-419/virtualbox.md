# Ejecutar la VM de demostración en VirtualBox

VirtualBox es la forma multiplataforma más sencilla de probar SocTalk en un escritorio: gratuita, con interfaz gráfica y disponible en Windows, Linux y macOS Intel. Esta guía importa la imagen de demostración publicada y la arranca. Validada en VirtualBox 7.0.

Esta ruta es para **evaluadores y demostraciones**: para una instalación en producción en tu propio clúster, consulta [Instalación](/es-419/install).

::: warning Macs con Apple Silicon (serie M)
La imagen de demostración es **x86-64**, que VirtualBox no puede ejecutar en Apple Silicon. En un Mac de la serie M, usa un [arranque en la nube](/es-419/aws) u otro host. VirtualBox aquí significa Windows, Linux o un Mac **Intel**.
:::

## Requisitos previos

- [VirtualBox](https://www.virtualbox.org/) 7.0 o más reciente.
- ~3 GB de disco libre para la imagen convertida.
- Un par de claves SSH (`~/.ssh/id_ed25519.pub` en los ejemplos) para leer el token de configuración por SSH.

## 1. Descarga y descomprime la imagen

Obtén el **vmdk** desde la página de [Descargas](/es-419/downloads) (el formato de VirtualBox compatible con VMware):

```bash
VER=0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

## 2. Convierte el vmdk al formato nativo VDI de VirtualBox

El vmdk publicado es **streamOptimized** (una disposición de VMware/OVA de solo lectura), que VirtualBox no arrancará como disco escribible. Conviértelo una vez a VDI:

```bash
VBoxManage clonemedium disk soctalk-demo-0.1.4.vmdk soctalk-demo-0.1.4.vdi --format VDI
```

Esto produce un `soctalk-demo-0.1.4.vdi` escribible y de tamaño dinámico (unos pocos GB en disco). `VBoxManage` se incluye con VirtualBox; en Windows está en `C:\Program Files\Oracle\VirtualBox\`.

## 3. Crea un ISO semilla de cloud-init

Un pequeño ISO semilla NoCloud crea un usuario `ops` con tu clave SSH para que puedas leer el token de configuración de cada arranque. Si lo omites, aún puedes iniciar sesión como el usuario `ubuntu:packer` de tiempo de compilación (consulta [Acceso SSH](/es-419/quickstart-vm#ssh-access-credentials)), pero esa credencial está en el árbol de código fuente público, así que endurece la VM antes de exponerla. En Linux/macOS:

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

## 4. Crea la VM

Abre **VirtualBox** y haz clic en **New**.

![VirtualBox Manager](/screenshots/virtualbox-manager.png)

**Name and Operating System** — nómbrala `soctalk-demo`, establece **Type** en *Linux* y **Version** en *Ubuntu (64-bit)*. Deja el ISO vacío:

![Name and OS](/screenshots/virtualbox-create-name.png)

**Hardware** — asígnale **8192 MB** de memoria y **4 CPUs** (el mínimo de [dimensionamiento](/es-419/reference/sizing) es 4 vCPU / 8 GB; la pila de Wazuh necesita la RAM):

![Hardware](/screenshots/virtualbox-create-hardware.png)

**Virtual Hard disk** — elige **Use an Existing Virtual Hard Disk File** y selecciona el `soctalk-demo-0.1.4.vdi` que convertiste:

![Use existing disk](/screenshots/virtualbox-create-disk.png)

**Summary** — confirma la configuración y haz clic en **Finish**:

![Summary](/screenshots/virtualbox-create-summary.png)

La VM aparece en el Manager con el VDI en su controlador SATA:

![VM created](/screenshots/virtualbox-vm-details.png)

## 5. Adjunta el ISO semilla y configura la red

Selecciona la VM y haz clic en **Settings**.

**Storage** — bajo el controlador IDE, haz clic en la unidad óptica y elige tu `soctalk-seed.iso` (haz clic en el icono del disco → *Choose a disk file*). El VDI ya está en SATA:

![Storage](/screenshots/virtualbox-storage.png)

**Network** — establece **Adapter 1 → Attached to: Bridged Adapter** para que la VM obtenga una IP en tu LAN y puedas alcanzar el asistente directamente:

![Network — bridged](/screenshots/virtualbox-network.png)

Haz clic en **OK**.

::: tip NAT en lugar de bridged
Si no puedes usar bridged (por ejemplo, en una red restringida), deja el NAT predeterminado y agrega reglas de **Port Forwarding** en Network → Advanced (host `8443` → guest `8443` para el asistente, host `8080` → guest `443` para la interfaz), y luego usa `localhost` en lugar de la IP de la VM más abajo.
:::

## 6. Inicia y encuentra la IP de la VM

Haz clic en **Start**. La consola arranca hasta un aviso de inicio de sesión:

![Console](/screenshots/virtualbox-console.png)

Encuentra la IP bridged de la VM: desde las concesiones DHCP de tu router, o emparejando la MAC de la VM:

```bash
VBoxManage showvminfo soctalk-demo | grep "MAC"      # note the MAC
arp -an | grep -i <mac>                               # find the matching IP
```

## 7. Ejecuta el asistente e inicia sesión

Lee el token de configuración de cada arranque por SSH, luego guía el asistente:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Navega a `https://<vm-ip>:8443/`, acepta el certificado autofirmado, pega el token y completa el asistente ([referencia de campos](/es-419/setup-wizard)). Tras enviar, el instalador de primer arranque ejecuta `helm install` e incorpora el tenant `demo`: unos 2 minutos para los pods de `soctalk-system`, y luego unos minutos más para la pila de Wazuh del tenant de demostración:

```bash
ssh ops@<vm-ip>
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Luego navega a `https://<vm-ip>/` (puerto 443, no 8443), inicia sesión con las credenciales de administrador del asistente y continúa con el [Recorrido por la interfaz MSSP](/es-419/mssp-ui). Si dejaste el hostname en blanco en el asistente, mapea `soctalk.local` a la IP de la VM en tu archivo hosts y usa `https://soctalk.local/`.

## 8. Desmontaje

```bash
VBoxManage controlvm soctalk-demo poweroff
VBoxManage unregistervm soctalk-demo --delete
VBoxManage closemedium disk soctalk-demo-0.1.4.vdi --delete
```

## Solución de problemas

| Síntoma | Comprobación |
|---|---|
| La VM no arranca: "cannot open … streamOptimized" / disco de solo lectura | Adjuntaste el `.vmdk` sin procesar. Usa el `.vdi` convertido del paso 2 |
| No se ejecuta en un Mac con Apple Silicon | Es lo esperado: la imagen es x86-64; usa un [arranque en la nube](/es-419/aws) en su lugar |
| La consola muestra errores `vmwgfx … unsupported hypervisor` | Inofensivo: es la GPU emulada de VirtualBox; el appliance es headless y arranca bien |
| La VM no tiene IP en bridged | Elige la NIC de host correcta en Network → Name; confirma que tu LAN tiene DHCP. O usa la opción NAT + reenvío de puertos de arriba |
| No se puede leer el token (sin SSH) | El ISO semilla no está adjunto (Storage → IDE) o su clave es incorrecta; vuelve a revisar el paso 3/5 |
| Cualquier cosa después del asistente | Igual que en toda plataforma: consulta la [tabla de solución de problemas del Quickstart](/es-419/quickstart-vm#troubleshooting) |
