# Ejecutar en Windows (WSL2)

SocTalk es nativo de Kubernetes. En Windows se ejecuta como **k3s (Kubernetes liviano) dentro de WSL2**: instalado y conectado por ti mediante un único comando de PowerShell. No requiere Docker Desktop.

::: tip ¿Solo estás evaluando?
El **[appliance de VM](/es-419/downloads)** (Hyper-V `vhdx` o [VirtualBox](/es-419/virtualbox)) es la forma más simple y robusta de probar SocTalk en Windows; es una VM Linux autocontenida, sin nada que configurar. La ruta de WSL2 de esta página es la opción de conveniencia de clúster local para desarrolladores que prefieren no ejecutar una VM completa.
:::

::: warning Arquitectura
Las imágenes de SocTalk son **solo amd64**, por lo que esto funciona en **Windows x64**. En Windows on ARM el conjunto de imágenes necesitaría emulación.
:::

## Requisitos previos

- **Windows 10 2004 (build 19041) o más reciente, o Windows 11**: x64
- PowerShell como **Administrador** (el instalador habilita características de Windows y configura WSL2)
- **Virtualización de CPU habilitada** en el firmware (WSL2 la necesita; en una VM, habilita la virtualización anidada)

**No** necesitas preinstalar WSL2, Ubuntu ni Docker; el instalador se encarga de todo.

## Instalación con un clic

Abre **PowerShell como Administrador** y ejecuta:

```powershell
irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1 | iex
```

Lo que ocurre:

1. **Habilita WSL2** (un reinicio, vuelve a iniciar sesión y la instalación **se reanuda automáticamente** en tu siguiente inicio de sesión; WSL2 no puede ejecutarse como la cuenta SYSTEM, por lo que la reanudación corre en tu sesión).
2. **Importa una distro de Ubuntu** y habilita systemd dentro de ella.
3. **Instala k3s** como un servicio de systemd dentro de WSL2, luego despliega SocTalk e incorpora un **tenant `demo`**.
4. **Expone la UI a Windows** en **`https://localhost/`** (un `netsh portproxy` reenvía al clúster dentro de WSL2; una tarea de inicio de sesión lo refresca tras los reinicios).

Cuando termina imprime la URL y las credenciales de demo. Abre **`https://localhost/`** en tu navegador, acepta el certificado autofirmado e inicia sesión.

Para una instalación **real (no demo)**, pasa `-Real` para que se te pida el nombre del MSSP, el correo/contraseña del administrador y la clave del LLM (o define las variables de entorno `SOCTALK_*`):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1))) -Real
```

## Qué hace (por dentro)

El instalador de PowerShell inicializa WSL2 y luego ejecuta el **mismo `install.sh`** que usa el appliance Linux, con k3s como runtime:

```bash
# dentro de la distro Ubuntu de WSL2, como root:
curl -sfL https://get.k3s.io | sh -          # k3s como un servicio de systemd
helm upgrade --install soctalk-system \
  oci://ghcr.io/soctalk/charts/soctalk-system --version 0.2.0 \
  --namespace soctalk-system --create-namespace -f values.yaml
```

El host de ingress es `localhost`, y un `netsh portproxy` de Windows (`localhost:443` → la IP de WSL2) lo hace accesible desde tu navegador.

## Advertencias

- Se requiere **un reinicio** para terminar de habilitar WSL2; vuelve a iniciar sesión después y la instalación continúa por sí sola.
- **Mantén en ejecución la distro WSL del clúster**: k3s vive dentro de ella. El instalador define `vmIdleTimeout=-1` para que WSL2 no entre en reposo, y una tarea de inicio de sesión reinicia WSL y refresca el reenvío de `localhost` tras un reinicio de Windows.
- La ruta de WSL2 es la opción de **conveniencia de clúster local**. Para una instalación siempre activa / estilo producción en Windows, prefiere el **[appliance de VM](/es-419/downloads)** (Hyper-V/VirtualBox), una única VM Linux sin piezas móviles de red de WSL2.
- Imágenes amd64 → solo Windows **x64**.

## Desmontaje

```powershell
# remove the host forward + logon tasks
netsh interface portproxy reset
Get-ScheduledTask SocTalk* | Unregister-ScheduledTask -Confirm:$false

# remove the cluster (inside WSL) and/or the whole distro
wsl -d Ubuntu -u root -- /usr/local/bin/k3s-uninstall.sh
wsl --unregister Ubuntu      # optional: remove the distro entirely
```

## Solución de problemas

| Síntoma | Comprobación |
|---|---|
| La instalación no continuó tras el reinicio | vuelve a iniciar sesión como el **mismo usuario**: la reanudación corre en tu inicio de sesión. Volver a ejecutar `install.ps1` es seguro (los pasos completados se omiten). |
| `https://localhost/` no carga | puede que la IP de WSL2 haya cambiado; la tarea programada `SocTalkExpose` refresca el reenvío; ejecútala (`Start-ScheduledTask SocTalkExpose`) o vuelve a ejecutar el instalador, luego reintenta. |
| `503` desde `https://localhost/` | el reenvío funciona pero los pods aún no están listos, `wsl -d Ubuntu -u root -- k3s kubectl -n soctalk-system get pods` y espera a `Running`. |
| WSL2 no arranca | habilita la virtualización de CPU (VT-x/AMD-V) en el firmware; en una VM, habilita la virtualización anidada. |
| Cualquier cosa después del asistente | igual que en toda plataforma, consulta la [tabla de solución de problemas del Quickstart](/es-419/quickstart-vm#troubleshooting). |
