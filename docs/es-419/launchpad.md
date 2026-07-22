# Launchpad: piloto de MSSP con un solo comando

Una vez que hayas visto SocTalk de extremo a extremo en una sola máquina co-ubicada ([Quickstart](/es-419/quickstart-vm)), **Launchpad es el siguiente paso**: te lleva de esa demo local a un piloto real, un plano de control de MSSP más uno o más entornos de tenant en tu propia infraestructura. Contrólalo desde una **consola web** (recomendado) o, más adelante, con un solo comando sin interfaz: arranca las VMs, las une a tu tailnet, instala SocTalk desde fuentes públicas y te entrega una URL.

¿Prefieres entender cada paso antes de dejar que una herramienta lo haga? El [piloto de MSSP hazlo tú mismo](/es-419/mssp-pilot) recorre la misma instalación a mano, los mismos charts, el mismo flujo de Tailscale. Launchpad simplemente hace el copiar y pegar por ti.

::: tip Tiempo de trabajo manual
| Ruta | Trabajo manual | Tiempo total |
|---|---|---|
| [Hazlo tú mismo](/es-419/mssp-pilot) | ~90 min | ~2 horas |
| Consola de Launchpad | ~5 min llenando un formulario | ~15-25 min (mayormente esperando descargas) |
:::

## Qué hace

Dadas tus credenciales de administrador de MSSP y una lista de tenants, Launchpad:

1. Descarga la imagen cloud de Ubuntu Noble en tu host de VMs (se almacena en caché en ejecuciones posteriores)
2. Aprovisiona VMs QEMU, una para el MSSP, una por tenant, con cloud-init + Tailscale
3. Espera a que cada VM se una a tu tailnet con la etiqueta que anuncia
4. Ejecuta [`install.sh`](https://github.com/soctalk/soctalk/blob/main/install.sh) en el MSSP en modo `--demo`
5. Da de alta cada tenant a través de la API del MSSP
6. Llama a `:issue-agent` para cada tenant para obtener el token de bootstrap
7. Instala k3s + Helm + `soctalk-cloud-agent` en cada VM de tenant
8. El MSSP despacha el job `install_helm_release` → el cloud-agent obtiene y aplica el chart `soctalk-tenant` (Wazuh manager + indexer + dashboard, adapter, runs-worker)

Al final tienes un dashboard de MSSP en funcionamiento, tenants registrados y `active`, y Wazuh corriendo por tenant. Todo descargado desde fuentes públicas, sin imágenes pre-preparadas, sin charts empaquetados.

## Qué no es

- **No es un instalador de producción.** Es una herramienta de evaluación. Las mismas advertencias de no-producción que el piloto hazlo tú mismo: sin HA, certificados autofirmados, tailnet como ingress.
- **No es un gestor de clústeres.** Se dispara una vez y sale. No vigila el clúster, no hace actualizaciones, no reconcilia la deriva. Usa `helm upgrade` después de eso.
- **No es un operador de Kubernetes.** El launchpad corre en tu escritorio, no en el clúster.

## Requisitos previos

Reúne esto primero:

- [ ] **Un host de VMs alcanzable desde tu estación de trabajo.** Una máquina Linux con:
      - `qemu-system-x86_64`, `qemu-img`, `genisoimage`, `curl`
      - `/dev/kvm` (KVM anidado funciona, bare metal es más rápido)
      - Suficiente margen para tus VMs: **8 GB RAM + 4 vCPU + 60 GB de disco por VM**
      - SSH sin contraseña desde tu estación de trabajo como un usuario en el grupo `kvm`
- [ ] **Una tailnet de Tailscale.** El nivel gratuito basta. Necesitarás:
      - El nombre de la tailnet (p. ej. `taila1b2c3.ts.net`)
      - Un [token de acceso a la API de Tailscale](https://login.tailscale.com/admin/settings/keys) con alcance `keys:write`: el launchpad lo usa para generar claves de autenticación de dispositivo efímeras por VM
      - Propiedad de las etiquetas que usarás, agrégalas a tu ACL:
        ```json
        "tagOwners": {
          "tag:mssp":        ["autogroup:admin"],
          "tag:tenant-acme": ["autogroup:admin"]
        }
        ```
- [ ] **Una clave pública SSH** que quieras autorizar en cada VM aprovisionada (usualmente la de tu estación de trabajo).
- [ ] **Una clave de API de LLM** para el MSSP. Elige un proveedor que tengas (Anthropic, OpenAI, o apunta a un Ollama local). Una clave de marcador de posición funciona para una prueba de humo donde no se ejercita la AI.

::: warning MagicDNS de Tailscale
El launchpad espera que MagicDNS esté habilitado en tu tailnet para que los clústeres de tenant puedan alcanzar el MSSP por nombre de host. Está activado por defecto. Si lo desactivaste, tendrás que agregar `hostAliases` tú mismo (consulta el [piloto hazlo tú mismo](/es-419/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant) para ver el patrón).
:::

## 1. Instala el CLI

Descarga el binario `launchpad` para tu plataforma desde la
[última release](https://github.com/soctalk/soctalk-launchpad/releases/latest),
luego deja que obtenga sus plugins:

```bash
# elige el asset para tu OS/arch: launchpad_{darwin,linux,windows}_{amd64,arm64}
base=https://github.com/soctalk/soctalk-launchpad/releases/latest/download
curl -fsSL "$base/launchpad_$(uname -s | tr A-Z a-z)_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o launchpad
chmod +x launchpad && sudo mv launchpad /usr/local/bin/launchpad

launchpad version
launchpad init   # descarga + verifica la firma de cada plugin en ~/.launchpad/plugins
```

`init` obtiene el conjunto de plugins para tu plataforma desde la misma release firmada y
verifica cada binario contra el índice firmado con ed25519 de la release antes de que se
instale. Nada se ejecuta sin verificar. (`launchpad plugin list` muestra el
conjunto instalado; `launchpad plugin sync` vuelve a obtener o repara el almacén.)

## 2. Ejecuta el piloto en la consola web

`launchpad ui` inicia una consola web local y la abre en tu navegador, la forma principal de conducir un piloto. Registras tu infraestructura una vez como **Hosts** y **Networks** reutilizables y verificables, luego lanzas y observas.

```bash
launchpad ui
```

En la primera ejecución el CLI descarga y verifica el conjunto de plugins en `~/.launchpad/plugins`, luego sirve la consola desde el mismo binario, nada más que instalar. En el navegador, recorre tres pantallas:

1. **Networks**: agrega tu tailnet: el nombre del overlay (p. ej. `taila1b2c3.ts.net`) y tu clave de API de Tailscale. Presiona **Test** para confirmar que la clave funciona antes de depender de ella. Una ejecución se vincula a una red, y cada máquina se une a ella.
2. **Hosts**: agrega el lugar donde aprovisionarás. Para esta guía ese es tu máquina KVM: el destino SSH y un directorio de trabajo con permisos de escritura. Los hosts nuevos precompletan los campos que su plataforma espera, y **Test** valida la conexión y las credenciales. Las credenciales se almacenan con el host y nunca salen de la máquina que ejecuta Launchpad.
3. **Runs**: crea una ejecución: asigna el **nodo de control** (tu MSSP) y cada **tenant** a un host, elige la red, completa las credenciales de administrador de MSSP y la clave de LLM, y presiona **Launch**.

![Networks, el overlay al que se une cada máquina de una ejecución, registrado una vez](/screenshots/launchpad-ui-networks.png)

![Hosts, los sustratos sobre los que aprovisionas, registrados una vez](/screenshots/launchpad-ui-hosts.png)

La consola transmite el progreso en vivo, cada VM aprovisionándose, uniéndose a la tailnet e instalando SocTalk, y te da la URL del MSSP al final. Las ejecuciones son idempotentes (relanzar reconcilia contra las máquinas que ya existen en lugar de duplicarlas), y la acción **Down** desmonta las máquinas de una ejecución.

![Una ejecución en progreso, las VMs del MSSP y del tenant aprovisionándose, con el rastreador de fases y un flujo de eventos en vivo](/screenshots/launchpad-ui-run.png)

::: tip Verificación de cumplimiento
Antes de apuntar un plugin a infraestructura real puedes comprobarlo desde el CLI:
```bash
launchpad plugin verify qemu
```
Esto ejecuta la suite de cumplimiento de protocolo (checksum, handshake, `plan`, `destroy` idempotente) sin necesitar credenciales reales.
:::

## 3. Verifica que funcionó

Cuando la ejecución termina (la consola la marca como completa, o `launchpad up` sale con `0`), comprueba los dos sistemas:

**Dashboard del MSSP**: abre la URL que la ejecución imprimió al final (o `https://lp-mssp.<your-tailnet>.ts.net/`). Inicia sesión con las credenciales de administrador que estableciste para la ejecución. Tu tenant debería aparecer en la lista y pasar a **Online** en 1-2 minutos.

![Dashboard del MSSP aprovisionado por Launchpad](/screenshots/launchpad-mssp-dashboard.png)

**Wazuh en el tenant**: conéctate por SSH a la VM del tenant (`ssh ops@lp-tenant-acme.<your-tailnet>.ts.net`) y revisa los pods:

```bash
sudo k3s kubectl -n tenant-acme get pods
```

Deberías ver:

```
NAME                                          READY   STATUS
tenant-acme-wazuh-manager-0                   1/1     Running
tenant-acme-wazuh-indexer-0                   1/1     Running
tenant-acme-wazuh-dashboard-<hash>            1/1     Running
tenant-acme-linuxep-0                         1/1     Running
soctalk-adapter-<hash>                        1/1     Running
soctalk-runs-worker-<hash>                    1/1     Running
```

El StatefulSet `linuxep-0` es un endpoint Linux de demostración con el agente de Wazuh instalado, un lugar para simular alertas. Consulta [Simulador de ataques](/es-419/mssp-pilot#5-3-generate-alerts) para más detalles.

### Conéctate por SSH a las VMs

Cada VM aprovisionada por el launchpad tiene un usuario `ops` preconfigurado con las claves SSH de tu configuración de host autorizadas y **sudo sin contraseña**. Así es como la fase de instalación del launchpad accede; usas la misma cuenta para la resolución de problemas.

```bash
# Shell interactivo como ops
ssh ops@lp-mssp.<your-tailnet>.ts.net
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net

# Comando puntual como root
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net "sudo journalctl -u k3s -n 100"
```

::: tip Alternativa: conéctate por IPv4 si MagicDNS está desactivado
Si MagicDNS está deshabilitado en tu tailnet, `lp-<key>.<tailnet>.ts.net` no se resolverá en tu estación de trabajo. Usa `tailscale status | grep lp-` para encontrar la IPv4 de la tailnet y `ssh ops@100.x.y.z` directamente.
:::

## 4. Usa tu piloto: da de alta clientes y pregúntale a la AI

Launchpad te entrega un MSSP en funcionamiento con tu primer tenant ya dado de alta, desde aquí lo conduces exactamente como lo haría un MSSP. El **Dashboard** es una vista de flota entre tenants: revisiones pendientes, casos atascados, tenants degradados y salud por tenant.

![El dashboard del MSSP, vista de flota entre tenants](/screenshots/pilot-final-dashboard.png)

**Da de alta otro cliente.** **Tenants → Create customer** ejecuta un breve asistente de cuatro pasos:

![Create customer, 1. Identidad](/screenshots/pilot-add-tenant-step1.png)
![Create customer, 2. Perfil](/screenshots/pilot-add-tenant-step2.png)
![Create customer, 3. Marca](/screenshots/pilot-add-tenant-step3.png)
![Create customer, 4. Revisión](/screenshots/pilot-add-tenant-step4.png)

El nuevo cliente se une a la flota, y el cloud-agent aprovisiona su stack de Wazuh + adapter de la misma manera en que Launchpad lo hizo para el primer tenant:

![La lista de tenants con el cliente dado de alta](/screenshots/pilot-final-tenants-list.png)

Profundiza en un tenant para ver sus investigaciones abiertas, revisiones y la salud de Wazuh:

![Detalle de tenant](/screenshots/pilot-final-acme-detail.png)

**Pregúntale al analista SOC de AI.** La vista **Chat** responde preguntas sobre toda la flota o acotadas a un tenant, llamando herramientas contra datos en vivo y resumiendo lo que encuentra:

![Ask AI, un resumen de toda la flota, con la llamada a herramienta que ejecutó](/screenshots/pilot-chat-mssp-reply.png)
![Ask AI, acotado a un solo tenant](/screenshots/pilot-chat-tenant-reply.png)

::: tip
La AI necesita un [proveedor de LLM](/es-419/integrate/llm-providers) real configurado, la clave de marcador de posición de la prueba de humo no responderá preguntas.
:::

## 5. Ajusta con un archivo de configuración

Una vez que un piloto funciona desde la consola, puedes capturar la misma configuración como un archivo YAML y conducirlo sin interfaz con `launchpad up`: sin consola. Recurre a esto cuando quieras:

- **Ejecuciones repetibles y programadas**: registra la configuración en git, ejecútala en CI y verifica sobre el flujo de eventos JSON.
- **Control fino que el formulario no expone**: fija una imagen base o su SHA, apunta a un tag de release específico de `install.sh`, programa muchos tenants a la vez, o ajusta CPU / memoria / disco por VM.

La consola y la configuración comparten los mismos Hosts y Networks bajo `~/.launchpad`, así que una ejecución por configuración reutiliza exactamente lo que ya probaste.

Guarda esto como `pilot.yaml` y reemplaza los valores entre corchetes:

```yaml
run_id: my-pilot

# Provisioning target — the plugin that creates VMs. Others: vmware, hetzner, proxmox, docker.
target: qemu

# Passed opaquely to the qemu plugin's initialize.
plugin_config:
  ssh_host: [user]@[vm-host-ip]      # SSH target on your KVM host
  work_dir: /home/[user]/lp-vms       # writable path; caches images + hosts VM disks
  tailnet: [your-tailnet].ts.net
  cpu: 4
  memory_mb: 8192
  disk_gb: 60
  # base_image_url is optional; defaults to the current Ubuntu Noble cloud image.
  # base_image_sha256: <optional pin>

# SSH keys authorized on every provisioned VM (the launchpad SSHes in as `ops`).
ssh_keys:
  - "ssh-ed25519 AAAA... you@laptop"

mssp:
  key: mssp
  name: my-pilot-mssp
  role: mssp
  tags: { role: mssp }

tenants:
  - key: tenant-acme
    name: acme-corp
    role: tenant
    tenant_slug: acme
    tags: { role: tenant, tenant_slug: acme }

# Post-provision installation phase.
install:
  # Point at a pinned release tag for reproducible smoke tests. `main` also works.
  installer_url: https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh
  mssp_admin_email: admin@my-pilot.demo
  mssp_admin_password: [pick-a-strong-one]
  mssp_display_name: My Pilot MSSP
  llm_provider: anthropic
  llm_api_key: [your-anthropic-key]
```

::: warning Sobre la contraseña de administrador
Guárdala en un gestor de contraseñas antes de ejecutar. El launchpad no te la volverá a mostrar si la pierdes de vista.
:::

Para agregar tenants, extiende la lista `tenants:`. Cada uno necesita un `key` único, un `tenant_slug` que coincida con tu ACL de Tailscale, y una entrada correspondiente bajo `tagOwners`.

### Ejecútalo

```bash
export TAILSCALE_API_KEY=tskey-api-...

launchpad up --config pilot.yaml --state ~/.launchpad/state.json
```

Por defecto renderiza una TUI de Bubble Tea con barras de progreso por VM, un registro de eventos en vivo y un aviso de compuerta para los pasos interactivos. Para ejecuciones desatendidas (CI, scripts, las pruebas de humo de esta guía) usa `--headless` para transmitir eventos JSON a stdout:

```bash
launchpad up --config pilot.yaml \
  --state ~/.launchpad/state.json \
  --headless --auto-resolve-gates | tee run.log
```

`--auto-resolve-gates` acepta cada compuerta (actualmente solo la confirmación del ACL de Tailscale) sin preguntar. Omítelo si quieres revisar tu ACL antes de que se aprovisionen los tenants.

Tiempos aproximados de fase en una primera ejecución (caché fresca, internet doméstico decente):

| Fase | Duración | Qué está ocurriendo |
|---|---|---|
| `provisioning` | 60-90s | Descarga de imagen (~600 MB) + cloud-init + unión a Tailscale |
| `installing` (MSSP) | 3-5 min | Instalación de k3s, Helm, chart `soctalk-system` |
| `installing` (por tenant) | 3-5 min | k3s + Helm + `soctalk-cloud-agent`, luego el MSSP despacha el chart `soctalk-tenant` (Wazuh + adapter) |
| Total | **~10-15 min** | para MSSP + 1 tenant |

Las ejecuciones posteriores son mucho más rápidas porque la imagen base está en caché en el host de VMs.

## 6. Itera, reanuda, desmonta, reinicia

El launchpad es idempotente. Relanzar una ejecución, el **Launch** de la consola de nuevo, o `launchpad up`: retoma donde lo dejó:

- Las VMs que ya existen se reutilizan (sin doble aprovisionamiento)
- El paso de instalación del MSSP se omite si la API ya responde
- El alta del tenant se omite si el tenant ya existe
- El chart `soctalk-cloud-agent` se instala con `helm upgrade --install`, no se reinstala

Para desmontar todo limpiamente (VMs, dispositivos de Tailscale, directorio de trabajo), usa la acción **Down** de la consola o:

```bash
launchpad down --config pilot.yaml --state ~/.launchpad/state.json
```

Para agregar un tenant a un piloto en ejecución, agrégalo en la consola (o edita `tenants:` en `pilot.yaml`) y relanza. Las VMs existentes se dejan intactas; el nuevo tenant se aprovisiona e instala.

## 7. Resolución de problemas

### `vm.wait_ready` agota el tiempo de espera

La VM arrancó pero nunca se unió a la tailnet. Cloud-init en la VM no pudo alcanzar los servidores de coordinación de Tailscale.

- Confirma que tu host de VMs tiene internet
- Conéctate por SSH al host de VMs e inspecciona el registro serial de QEMU en `<work_dir>/<run_id>/<vm_key>/serial.log`: captura la salida de cloud-init incluyendo tailscale-up
- Causa común: la clave de autenticación efímera fue revocada antes de que la VM la usara (revisa el registro del administrador de Tailscale → Machines)

### La instalación del MSSP agota el tiempo de espera en `helm upgrade`

La instalación del chart se ejecutó pero los pods no convergieron en 15 minutos. Usualmente descargas de imágenes en conexiones lentas.

- Conéctate por SSH a la VM del MSSP: `sudo k3s kubectl -n soctalk-system get pods` y busca `ImagePullBackOff` o `CrashLoopBackOff`
- Si los pods todavía están descargando, espera y relanza, el segundo intento omite el paso de instalación una vez que la API responde

### El agente del tenant registra `no such host` en `/api/agent/register`

El DNS de clúster del pod no puede resolver el nombre de host de tailnet del MSSP. Para esto es exactamente `hostAliases`. El launchpad lo inserta en el comando de helm por defecto; si lo estás haciendo a mano, consulta el [piloto hazlo tú mismo](/es-419/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant).

### Automatización

El modo `--headless` es la superficie de automatización del launchpad. Cada fase, cambio de estado de VM, línea de registro de instalación y aviso de compuerta es un evento JSON en stdout:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Verifica sobre esos eventos desde tu CI. Consulta [Esquema de eventos de Launchpad](/es-419/reference/launchpad-events) para ver la lista completa.

## A dónde ir después

- **Agrega un tenant real.** Da de alta desde el dashboard del MSSP, consulta el [piloto hazlo tú mismo §3](/es-419/mssp-pilot#3-onboard-tenants) para el recorrido del asistente.
- **Genera algunas alertas.** El [Simulador de ataques](/es-419/mssp-pilot#5-3-generate-alerts) tiene el runbook.
- **Apunta la AI a datos reales.** Configura tu [proveedor de LLM](/es-419/integrate/llm-providers) correctamente (la clave de marcador de posición de la prueba de humo no responderá preguntas).
- **Pasa a producción.** [Install](/es-419/install) es la ruta sin launchpad, con capacidad de HA.
