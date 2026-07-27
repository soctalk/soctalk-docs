# Instalación desde un paquete del sistema operativo (rpm / deb)

Cada versión de SocTalk publica paquetes nativos del sistema operativo junto con
las imágenes de VM, adjuntos a la misma GitHub Release que la etiqueta de
versión, para las dos familias de Linux basadas en systemd:

| Archivo | Gestor de paquetes | Verificado en | También se espera que funcione |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Ambos están verificados de extremo a extremo: instala el paquete, ejecuta
`soctalk install`, entra en la aplicación web e inicia sesión. La columna "también
se espera" corresponde a la misma familia de paquetes, pero no se ha probado
específicamente en esas distribuciones.

**Alpine no es compatible** y no se publica ningún `.apk`: `soctalk install`
requiere systemd, y Alpine usa OpenRC. Consulta [Alpine y otros hosts sin
systemd](#alpine-and-other-non-systemd-hosts) más abajo. **openSUSE / zypper** y
**RHEL 10** no están probados; puede que las notas de RHEL/Fedora no apliquen por
completo. **Solo amd64**: no hay paquete arm64.

Se publican en la página de versiones de
[`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases). La versión
actual es **v0.2.0**:
[página de la versión](https://github.com/soctalk/soctalk/releases/tag/v0.2.0). El
repositorio es público, así que no se necesita autenticación para descargarlos.

## Qué instala el paquete

El paquete es pequeño a propósito. SocTalk se ejecuta sobre Kubernetes (K3s), de
modo que el paquete no contiene el stack del SOC en sí. Instala una CLI de
gestión ligera y el instalador; luego ejecutas un solo comando para levantar el
stack:

- `/usr/bin/soctalk`, la CLI de gestión (`install`, `upgrade`, `status`,
  `logs`, `uninstall`, `version`).
- `/usr/libexec/soctalk/install.sh`, el mismo instalador que usan la [VM de
  demostración](/es-419/quickstart-vm) y la [instalación con un solo
  comando](/es-419/install). Arranca K3s y Helm si faltan, y luego instala con
  Helm el chart `soctalk-system` desde GHCR.
- `/etc/soctalk/soctalk.env.example`, una plantilla para instalaciones
  desatendidas.

Las únicas dependencias son `curl` y `tar`; el instalador se encarga de obtener
K3s y Helm. Esta es la vía adecuada cuando instalas en un host Linux que
administras directamente y quieres que SocTalk quede registrado en la base de
datos de paquetes del sistema (para que `dnf`/`apt` lo controlen y lo
actualicen). Si solo quieres probar SocTalk, la [imagen de VM de
demostración](/es-419/quickstart-vm) es más rápida.

## Instalar el paquete

Elige el bloque correspondiente a tu distribución. Reemplaza `0.2.0` por la
versión actual si estás en una versión más reciente.

### RHEL, Fedora, AlmaLinux, Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

`dnf` incorpora `curl` y `tar` si faltan. En hosts más antiguos usa
`sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`.

### Debian, Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` resuelve las dependencias `curl` y `tar` desde los
repositorios que tengas configurados. En una imagen mínima sin `apt` puedes usar
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install`.

## Verificar la descarga

Cada versión incluye `SHA256SUMS.txt`, que cubre todos los artefactos, incluidos
los paquetes.

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` comprueba solo los archivos que realmente descargaste. Cada
línea debería reportar `OK`.

## Levantar el stack del SOC

Instalar el paquete no arranca SocTalk. Una vez instalado el paquete, ejecuta el
instalador a través de la CLI. Esto instala K3s y Helm si es necesario, y luego
instala con Helm `soctalk-system` en este host.

Interactivo (solicita el nombre del MSSP, el administrador y el proveedor de
LLM):

```bash
sudo soctalk install
```

Demostración desechable (contraseña de administrador aleatoria, incorpora
automáticamente un tenant de demostración):

```bash
sudo soctalk install --demo
```

`--demo` aún se detiene una vez para pedir un consentimiento. Para una ejecución
totalmente desatendida (sin terminal conectada, por ejemplo desde un script de
aprovisionamiento) añade `--yes`: `sudo soctalk install --demo --yes`.

Desatendido, controlado por variables de entorno (copia la plantilla incluida):

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

Cuando `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL` y `SOCTALK_ADMIN_PASSWORD`
están todas definidas, el instalador omite su solicitud de consentimiento, de
modo que esto se ejecuta sin ninguna interacción. Cualquier argumento después de
`install` se pasa al instalador, por ejemplo
`soctalk install --chart-version 0.2.0` para fijar un chart o
`soctalk install --values-file /etc/soctalk/values.yaml` para una instalación
aislada de la red. Consulta [Instalación de producción](/es-419/install) para la
referencia completa de flags y la vía del clúster basado en Cilium.

## Administrar la instalación

La CLI envuelve las operaciones de clúster habituales para que no tengas que
recordar la ruta de `KUBECONFIG` ni el nombre de la release de Helm.

```bash
soctalk status              # pods and their readiness in the soctalk namespace
soctalk logs api            # tail a component's logs (api, orchestrator, adapter, app-ui)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk upgrade` es un `helm upgrade --install`, así que es seguro volver a
ejecutarlo y es la forma de pasar a un chart más reciente tras instalar un
paquete más reciente.

## Desinstalar

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

Quitar el paquete del sistema (`dnf remove soctalk` o `apt remove soctalk`)
elimina la CLI y el instalador, pero no toca un clúster en ejecución. Ejecuta
`soctalk uninstall` primero si quieres eliminar el stack del SOC.

## Notas específicas del sistema operativo

### RHEL, Fedora, AlmaLinux, Rocky

Verificado en Rocky Linux 9 con SELinux en modo **Enforcing**. No se necesita
ningún trabajo manual de SELinux para ponerlo en marcha: el instalador de K3s
incorpora automáticamente los paquetes de política `k3s-selinux` y
`container-selinux` durante `soctalk install`, de modo que el clúster arranca en
modo Enforcing. Ten en cuenta que esto significa "funciona correctamente bajo la
política targeted", no que SELinux esté confinando la carga de trabajo como capa
de endurecimiento; no se probó aquí habilitar la propia aplicación de SELinux de
K3s (`--selinux` / `K3S_SELINUX=true`). RHEL 10 también necesita el paquete
`kernel-modules-extra` para K3s, que no se probó.

Si **firewalld** está activo (habitual en una instalación completa de servidor
RHEL, aunque no en las imágenes mínimas de nube), puede bloquear el tráfico del
clúster, lo que se manifiesta como pods atascados en `ContainerCreating` o la
aplicación web inaccesible. Confía en las redes de pods y servicios de K3s, y
abre los puertos de ingress por los que realmente accedes a la UI:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

Los valores `10.42.0.0/16` y `10.43.0.0/16` son los predeterminados de K3s; si
configuras un CIDR de clúster o de servicios personalizado, usa esos en su lugar.
Un clúster de varios nodos necesita más puertos abiertos entre nodos (consulta
los requisitos de red de K3s).

### Alpine y otros hosts sin systemd {#alpine-and-other-non-systemd-hosts}

**El instalador de SocTalk requiere systemd.** Levanta K3s como un servicio de
systemd y espera al kubeconfig escrito por systemd, de modo que no funciona en
Alpine (OpenRC) ni en ningún otro init sin systemd. En un host así,
`soctalk install` se detiene pronto con un mensaje claro que te lo indica. Por
esa razón no se publica ningún `.apk`.

Para ejecutar SocTalk donde estabas considerando Alpine, usa una distribución
con systemd (la vía `.deb` o `.rpm` anterior) o la
[imagen de VM de demostración](/es-419/quickstart-vm) precompilada.

## ¿Qué vía debería usar?

- **Paquete del sistema operativo (esta página)**: un host Linux que administras,
  controlado por el gestor de paquetes del sistema. Bueno para instalaciones
  repetibles y gestionadas por configuración.
- **[Instalación con un solo comando](/es-419/install)**: `curl … | install.sh |
  bash` en una VM de Ubuntu limpia, el mismo instalador sin el envoltorio del
  paquete.
- **[Imagen de VM de demostración](/es-419/quickstart-vm)**: appliance
  precompilado con un asistente de configuración por navegador, la vía más rápida
  a un sistema en ejecución para evaluación.

Las tres llegan al mismo chart `soctalk-system` y al mismo SOC en ejecución.
