# Guía rápida: VM de demostración de SocTalk

La forma más rápida de probar SocTalk de extremo a extremo: descarga una imagen de VM prediseñada, arráncala, abre el asistente de configuración en tu navegador y avanza con clics. Cinco minutos hasta una instalación multi-tenant en funcionamiento con un tenant de demostración incorporado.

Esta ruta es para **evaluadores y demostraciones**; para una instalación en producción en tu propio clúster consulta [Instalación](/es-419/install).

## Qué incluye la imagen

- Ubuntu 24.04 LTS, con cloud-init habilitado
- K3s con ingress Traefik incluido
- Helm + un chart `soctalk-system` prediscargado
- Un asistente de configuración de primer arranque en `:8443`
- Un instalador de primer arranque (`soctalk-firstboot.service`) que se ejecuta después de que el asistente recopila la configuración
- La imagen es la misma independientemente del formato (qcow2 / vmdk / vhdx / vhd / raw); elige el que tu hipervisor consuma de forma nativa. Consulta [Descargas](/es-419/downloads).

## 1. Descarga

Elige el formato para tu hipervisor en la página de [Descargas](/es-419/downloads). Ejemplos:

```bash
# KVM / Proxmox / libvirt
curl -L -o soctalk-demo.qcow2.xz \
  https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-<ver>.qcow2.xz
xz -d soctalk-demo.qcow2.xz
```

Verifica la suma de comprobación:

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 2. Arranca la imagen

### KVM / libvirt (CLI)

```bash
qemu-system-x86_64 \
  -m 8G -smp 4 -enable-kvm -cpu host \
  -drive file=soctalk-demo.qcow2,format=qcow2,if=virtio \
  -netdev user,id=net0,hostfwd=tcp::18022-:22,hostfwd=tcp::18443-:8443 \
  -device virtio-net,netdev=net0 \
  -nographic
```

### Proxmox VE

`qm disk import <vmid> soctalk-demo.qcow2 <storage>`, luego conéctalo como SCSI y arranca. Recorrido completo con capturas de la interfaz web: [Ejecutar en Proxmox](/es-419/proxmox).

### VMware

Importa `soctalk-demo.vmdk` como un disco existente en una VM nueva (Linux, Ubuntu 64-bit).

### VirtualBox

Convierte `soctalk-demo.vmdk` a VDI y conéctalo a una VM nueva. Recorrido completo con capturas: [Ejecutar en VirtualBox](/es-419/virtualbox).

### Hyper-V

Usa `soctalk-demo.vhdx` como disco del sistema operativo en una VM de **Generación 1** (la imagen arranca mediante firmware BIOS; Generación 2 / UEFI no está probada). Para inyectar una clave SSH, conecta un `seed.iso` NoCloud como una unidad de DVD; consulta [Opcional: seed de cloud-init](#opcional-seed-de-cloud-init).

### AWS

Crea una AMI nativa con Packer, o importa `soctalk-demo.vmdk` como una AMI con VM Import. Recorrido completo: [Ejecutar en AWS](/es-419/aws).

### Azure

Sube `soctalk-demo.vhd` (de tamaño fijo) directamente a un Managed Disk, luego crea una imagen y una VM de Generación 1 a partir de él. Recorrido completo: [Ejecutar en Azure](/es-419/azure).

### Raw / dd

`soctalk-demo.raw` es bit por bit lo que hay en el disco. Adecuado para la importación genérica de imágenes de nube (GCP, OpenStack) o para escribir en un disco físico con `dd`.

**Dimensionamiento mínimo**: 4 vCPU, 8 GB de RAM, 60 GB de disco. Consulta [Dimensionamiento](/es-419/reference/sizing).

## 3. Obtén el token de configuración

El asistente enlaza `:8443` con TLS (autofirmado). Rechaza las conexiones sin el token de configuración por arranque. Conéctate por SSH a la máquina y léelo:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

El inicio de sesión recomendado es el **usuario `ops` con tu clave SSH**, creado por el seed de cloud-init en [§ Opcional: seed de cloud-init](#opcional-seed-de-cloud-init) más abajo. Si arrancas sin un seed, consulta [§ Acceso SSH + credenciales](#acceso-ssh-credenciales) para conocer el respaldo de tiempo de compilación, y lee la nota de seguridad allí antes de exponer la VM a una red en la que no confías.

## 4. Abre el asistente

Navega a `https://<vm-ip>:8443/`. Acepta el certificado autofirmado. Llegarás a la página de ingreso del token:

![Asistente de configuración — ingreso del token](/screenshots/setup-wizard-token.png)

Pega el token y luego completa:

- Nombre del MSSP / organización
- Hostname (opcional; déjalo en blanco para usar la IP de la máquina)
- Correo electrónico + contraseña del administrador (mín. 12 caracteres)
- Proveedor de LLM + clave de API

Consulta [Asistente de configuración](/es-419/setup-wizard) para la referencia completa de campos.

Envía. El asistente escribe `values.yaml`, el Secret del LLM y un archivo de entorno de incorporación, luego sale. El instalador de primer arranque toma el control:

1. Inicia k3s
2. Crea el namespace `soctalk-system` + el Secret del LLM
3. `helm install soctalk-system`
4. Inicia sesión como el administrador de arranque e incorpora un tenant `demo` mediante `POST /api/mssp/tenants/onboard`

Tiempo total transcurrido desde el envío: alrededor de 2 minutos para que los pods de `soctalk-system` estén Ready, luego otros 1 a 3 minutos para que la pila Wazuh del tenant de demostración alcance el estado Ready.

## 5. Inicia sesión

Navega a `https://<vm-ip>/` (nota: puerto 443, no 8443; el asistente enlaza el 8443 específicamente para evitar conflictos con Traefik). El dashboard del MSSP espera un nombre DNS; si dejaste el hostname en blanco, agrega una entrada en `/etc/hosts` que apunte `soctalk.local` a la IP de la VM y navega a `https://soctalk.local/`.

Inicia sesión con el correo electrónico + contraseña del administrador que estableciste en el asistente. Llegarás al dashboard del MSSP. Continúa con el [Recorrido por la interfaz del MSSP](/es-419/mssp-ui).

## Opcional: seed de cloud-init

Si quieres inyectar una clave SSH (u omitir el asistente por completo suministrando values.yaml directamente), pasa los datos de usuario de cloud-init mediante NoCloud:

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
echo "instance-id: $(uuidgen)" > meta-data
cloud-localds seed.iso user-data meta-data

# conecta seed.iso como una segunda unidad en el primer arranque.
```

Para omitir el asistente, coloca `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` mediante `write_files` de cloud-init; la condición de systemd del asistente (`ConditionPathExists=!/etc/soctalk/values.yaml`) hará un cortocircuito y el instalador irá directo a `helm install`.

## Acceso SSH + credenciales

Las imágenes de disco descargables (qcow2 / vmdk / vhdx / vhd / raw) vienen todas con **dos** posibles identidades de inicio de sesión. Cuál uses depende de si proporcionaste datos de usuario de cloud-init.

### Producción: usuario `ops` (recomendado)

El seed de cloud-init en [§ Opcional: seed de cloud-init](#opcional-seed-de-cloud-init) crea un usuario `ops` con tu clave SSH. Solo autenticación por clave SSH; no se establece contraseña.

```bash
ssh -i ~/.ssh/<your-private-key> ops@<vm-ip>

# Shell de root, sin más contraseña
sudo -i
```

### Usuario `ubuntu` de tiempo de compilación (presente en cada imagen distribuida)

La compilación de Packer usa un usuario `ubuntu` de tiempo de compilación con una contraseña conocida. El paso de limpieza que debería bloquear esta cuenta aún no se ha implementado, así que se distribuye en la imagen. Si arrancas sin un seed de cloud-init es la única forma de obtener acceso a la consola mediante SSH:

| Usuario | Contraseña | Sudo |
|---|---|---|
| `ubuntu` | `packer` | `ALL=(ALL) NOPASSWD:ALL` |

La autenticación SSH por contraseña la habilita el mismo seed, así que la imagen acepta:

```bash
# Interactivo
ssh ubuntu@<vm-ip>
# password: packer

# No interactivo (requiere sshpass)
sshpass -p packer ssh -o StrictHostKeyChecking=accept-new ubuntu@<vm-ip>

# Shell de root, sin más contraseña
sudo -i
```

### Lista de verificación de endurecimiento

Ejecuta como `ops` después del primer arranque, o intégralo en tu `runcmd:` de cloud-init para que se dispare automáticamente:

```bash
# Deshabilita el usuario de compilación
sudo passwd -l ubuntu
sudo usermod -s /usr/sbin/nologin ubuntu

# Desactiva la autenticación SSH por contraseña
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```

La AMI de AWS se compila a partir de una fuente de Packer independiente (`amazon-ebs`) que no incluye el seed y usa en su lugar la inyección de par de claves de EC2; no lleva la credencial `ubuntu:packer`. La lista de verificación de endurecimiento aún aplica para el usuario `ubuntu` estándar de la imagen de nube de la AMI.

## Siguiente paso: incorpora clientes con Launchpad

Acabas de ejecutar SocTalk de extremo a extremo en una única máquina colocalizada. El siguiente paso natural es un piloto real: un plano de control de MSSP más uno o más entornos de tenant en tu propia infraestructura. [**Launchpad**](/es-419/launchpad) hace exactamente eso con un solo comando: arranca las VMs, las une a tu tailnet, instala SocTalk desde fuentes públicas y te entrega una URL. (¿Prefieres ejecutar cada paso a mano? Consulta el [piloto de MSSP hazlo tú mismo](/es-419/mssp-pilot).)

## Solución de problemas

| Síntoma | Verificación |
|---|---|
| La URL del asistente nunca carga | `systemctl status soctalk-setup-wizard` en la VM. Si está `inactive`, revisa `journalctl -u soctalk-setup-wizard` |
| El asistente dice "invalid token" | El token está en `/var/log/soctalk-setup-token`, **propiedad de root**. Usa `sudo cat`. Cada arranque regenera el token |
| El asistente dice "rate-limited" | El asistente bloquea la IP tras 10 intentos fallidos de token. Espera 1 h o `systemctl restart soctalk-setup-wizard` (esto también rota el token) |
| `helm install` se estanca | `kubectl get pods -A` desde la máquina; `journalctl -u soctalk-firstboot -f` |
| Los pods del adaptador / runs-worker del tenant de demostración quedan atascados en ImagePullBackOff | Conocido: el controlador usa por defecto una etiqueta de imagen no publicada. Consulta [Solución de problemas](/es-419/troubleshooting) |

Para un reinicio limpio: elimina `/var/lib/soctalk-firstboot.done`, `/var/lib/soctalk-wizard.done`, `/etc/soctalk/values.yaml`, luego `systemctl restart soctalk-setup-wizard`.
