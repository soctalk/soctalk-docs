# Piloto MSSP: hágalo usted mismo

::: tip La mayoría de los pilotos deberían usar Launchpad
[**Launchpad**](/es-419/launchpad) automatiza todo este despliegue, la misma instalación, los mismos charts, el mismo flujo de Tailscale, en un solo comando (~15-25 min, casi todo esperando descargas, frente a ~2 horas a mano). **Empiece por ahí.** Recurra a esta guía de hágalo-usted-mismo cuando quiera entender cada paso, esté depurando una ejecución de Launchpad, o su entorno no pueda ejecutar Launchpad, aislado de la red (air-gapped), DNS de horizonte dividido on-premise, un sustrato no soportado, o un clúster existente.
:::

Un camino práctico para MSSPs que evalúan SocTalk con 1-3 de sus clientes. Dos entornos on-premise (uno para el plano de control del MSSP, uno por tenant), conectados por una VPN de malla amigable con firewalls. Estado final: una instalación multi-tenant de SocTalk funcionando, el analista SOC de AI respondiendo preguntas sobre los datos reales de Wazuh de cada tenant, y una captura de pantalla que puede mostrar a sus interesados.

**No es una instalación de producción.** Sin HA, sin TLS real, su nombre de host del tailnet reemplaza al ingress. Cuando esté listo para producción, consulte [Instalar](/es-419/install).

**¿Probando SocTalk en solitario primero?** Empiece con [Quickstart VM](/es-419/quickstart-vm): una sola máquina, un solo tenant, ~10 minutos.

::: tip Tiempo de trabajo práctico
| Lado | Trabajo práctico | Tiempo total |
|---|---|---|
| MSSP (una vez) | ~45 min | ~60 min |
| Cada tenant (1-3 de ellos) | ~30 min por tenant | ~45 min por tenant |
| Demo + verificación | ~10 min | ~10 min |
:::

## Qué está en alcance

- 1 plano de control MSSP + 1-3 tenants
- Ambos entornos **on-premise**, cualquier hipervisor que ejecute Ubuntu 24.04 (vSphere / Proxmox / Hyper-V / KVM / VirtualBox / bare metal)
- [Tailscale](https://tailscale.com) como la VPN de malla. Headscale, NetBird, o cualquier malla WireGuard funciona de la misma manera; Tailscale es lo que los comandos siguientes asumen sintácticamente.
- El plano de control L1 de SocTalk del MSSP + el cloud-agent L2 de SocTalk en cada tenant
- Wazuh **ya instalado** O **instalado por chart** por tenant; ambos soportados

<!-- screenshot: arch-overview.svg, architecture diagram (MSSP VM left, tenant VMs right, tailnet wrapping both, cloud-agent shown on each tenant, optional dotted-line to existing Wazuh) -->

## 0. Antes de empezar

Reúna lo siguiente. Se le pedirá todo esto a lo largo de los próximos 90 minutos:

- [ ] Hipervisor + inicio de sesión de administrador para el lado del MSSP
- [ ] Hipervisor + inicio de sesión de administrador por tenant (uno por cliente del piloto)
- [ ] Una cuenta de Tailscale ([registrarse](https://login.tailscale.com/start); el nivel gratuito maneja bien un piloto)
- [ ] Una clave de API de LLM (Anthropic u OpenAI). Para una opción aislada de la red o sensible a la soberanía, consulte [Integración con Ollama](/es-419/integrate/ollama).
- [ ] Un contacto por tenant (nombre, email, ¿tiene Wazuh existente? sí/no)
- [ ] Si un tenant tiene Wazuh existente: **dos** conjuntos de credenciales, uno para el Wazuh Indexer (`:9200`, autenticación Basic) y uno para el Wazuh Manager API (`:55000`, usuario capaz de emitir JWT)

## 1. Configurar el tailnet

El plano de control del MSSP y cada tenant se unen al mismo tailnet. El tailnet proporciona nombres de host estables (para que el cloud-agent marque un nombre, no una IP) y ACLs (para que los tenants no puedan alcanzarse entre sí).

### 1.1 Etiquetas (tags)

Defina una etiqueta para el MSSP y una por tenant en la UI de administración de Tailscale bajo **Access Controls** → **Tags**:

```json
"tagOwners": {
  "tag:mssp":         ["autogroup:admin"],
  "tag:tenant-acme":  ["autogroup:admin"],
  "tag:tenant-globex":["autogroup:admin"]
}
```

Agregue una etiqueta por cada tenant del piloto. Las etiquetas son la forma en que la ACL evita que los tenants se alcancen entre sí.

### 1.2 ACL

Pegue esta sección en **Access Controls** → **Access Controls (JSON)**. Ajuste la lista de etiquetas de tenant para que coincida con su piloto.

```json
"acls": [
  {
    "action": "accept",
    "src":    ["autogroup:admin"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  },
  {
    "action": "accept",
    "src":    ["tag:mssp"],
    "dst":    ["tag:tenant-acme:*", "tag:tenant-globex:*"]
  },
  {
    "action": "accept",
    "src":    ["tag:tenant-acme", "tag:tenant-globex"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  }
]
```

La primera regla permite que **sus dispositivos de operador** (su laptop, cualquier nodo sin etiqueta de propiedad de administrador en el tailnet) alcancen la UI del MSSP. Sin ella, el denegar-por-defecto de Tailscale bloquea su propio navegador. La segunda regla permite que el MSSP alcance a cada tenant para las llamadas de herramientas del chat (Wazuh API, observabilidad). La tercera permite que el cloud-agent de cada tenant alcance el endpoint HTTPS del MSSP para registrarse y transmitir eventos. Los tenants no pueden alcanzarse entre sí.

Verifique en el panel ACL Preview antes de guardar. Confirme que `tag:tenant-acme` no puede alcanzar `tag:tenant-globex` en ningún puerto.

<!-- screenshot: tailscale-acl-preview.png, ACL preview showing tenant-to-tenant denied, MSSP→tenant + tenant→MSSP allowed -->

### 1.3 Claves de autenticación

Bajo **Settings** → **Keys**, genere:

- Una clave de autenticación **reutilizable** etiquetada `tag:mssp` para el plano de control del MSSP.
- Una clave de autenticación **efímera** por tenant etiquetada `tag:tenant-<slug>`. Establezca el TTL a la duración de su piloto (p. ej. 90 días).

Anótelas en un lugar seguro; las pegará cuando cada VM se una al tailnet.

### 1.4 Requisitos de red

Tailscale solo necesita salida (nunca entrada) desde cada nodo:

- **Ruta directa** (cuando ambos peers pueden atravesar NAT): WireGuard sobre UDP en un puerto alto aleatorio. La mayoría de las redes ya lo permiten.
- **Fallback DERP** (cuando el atravesamiento de NAT falla, p. ej. firewalls estrictos o doble NAT): TCP/443 a los relés DERP de Tailscale. La mayoría de los pilotos usan esta ruta ya que se ve como tráfico HTTPS normal.

Si su firewall permite HTTPS saliente, está bien. Sin cambios de reglas de entrada en ningún lugar.

## 2. Lado MSSP: levantar el plano de control

El plano de control del MSSP es una sola VM de SocTalk, la misma que instala [Quickstart VM](/es-419/quickstart-vm). Usamos ese tutorial como base y agregamos la unión al tailnet.

### 2.1 Aprovisionar e instalar

Siga los **pasos 1 al 5** de [Quickstart VM](/es-419/quickstart-vm) (descargar, arrancar, obtener el token de configuración, abrir el asistente, iniciar sesión). Cuando el asistente pida el **Hostname**, déjelo en blanco por ahora. Lo establecerá al nombre de host del tailnet en §2.3.

Deténgase cuando haya llegado al dashboard del MSSP. **Nota:** el flujo de Quickstart incorpora automáticamente un tenant llamado `demo` en el primer arranque. Verá un tenant ya en su lista; eso es esperado. Puede dejarlo (e ignorarlo en §5) o darlo de baja desde el dashboard antes de agregar sus tenants reales del piloto:

```text
Tenants → demo → Decommission
```

Cualquiera está bien; solo téngalo presente para que no se confunda cuando `list all tenants` en §5 devuelva más que el número de su piloto.

<!-- screenshot: mssp-dashboard-after-install.png, MSSP dashboard immediately after wizard install, showing the auto-onboarded demo tenant -->

### 2.2 Endurecer la máquina

::: danger Requerido antes del siguiente paso
Las imágenes de disco descargables vienen con un usuario SSH `ubuntu:packer` de tiempo de compilación. **No conecte la VM a su tailnet hasta que la haya asegurado.** Consulte [Acceso SSH + credenciales](/es-419/quickstart-vm#ssh-access-credentials) para la historia completa y los comandos de endurecimiento.

Mínimo:
```bash
sudo passwd -l ubuntu
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```
:::

### 2.3 Instalar Tailscale, unirse al tailnet

Conéctese por SSH como `ops` (el usuario que la semilla cloud-init creó durante su instalación de [Quickstart VM](/es-419/quickstart-vm); **no** el usuario `ubuntu` de tiempo de compilación que §2.2 acaba de bloquear):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-mssp-... --advertise-tags=tag:mssp --hostname=soctalk-mssp
```

Confirme el nombre de host del tailnet asignado:

```bash
tailscale status | head -1
# example: 100.64.10.5   soctalk-mssp        ops          linux   active; direct
```

Su nombre de host del MSSP es `soctalk-mssp.<your-tailnet>.ts.net`. Anótelo; todo lo que sigue lo usa.

### 2.4 Vincular el ingress de SocTalk al nombre de host del tailnet

Edite los valores desplegados para establecer el nombre de host:

```bash
sudo nano /etc/soctalk/values.yaml
```

Cambie `ingress.hostnames.mssp` e `ingress.hostnames.customer` a su nombre de host del tailnet (p. ej. `soctalk-mssp.taila1b2c3.ts.net`), luego vuelva a desplegar:

```bash
sudo helm upgrade soctalk-system /opt/soctalk/charts/soctalk-system \
  -n soctalk-system -f /etc/soctalk/values.yaml
```

Referencia de campos para `values.yaml`: consulte [Asistente de configuración](/es-419/setup-wizard); el asistente escribe el mismo archivo.

### 2.5 Verificar

Desde cualquier otro dispositivo del tailnet (su laptop de operador funciona; la ACL de §1.2 permite `autogroup:admin → tag:mssp:443`):

```bash
curl -k https://soctalk-mssp.<your-tailnet>.ts.net/health/ready
# expected: 200 OK
```

Inicie sesión en el dashboard en `https://soctalk-mssp.<your-tailnet>.ts.net/` con las credenciales de administrador de §2.1. Debería llegar a la vista de flota multi-tenant del MSSP: la franja de KPI en la parte superior (Revisiones pendientes / Casos atascados / Tenants degradados / IOCs repetidos), la cola de investigación por tenant, y la tabla de salud de tenants.

![Dashboard MSSP: vista de flota multi-tenant](/screenshots/mssp-dashboard.png)

## 3. Incorporar cada tenant: emitir el registro del agente

Para cada tenant en su piloto, hará esto en el dashboard del MSSP, luego entregará el resultado al operador del tenant.

### 3.1 Ejecutar el asistente Create Customer

En el dashboard del MSSP, haga clic en **Tenants** en la barra izquierda, luego en **New tenant**. Esto abre el asistente **Create Customer**. El paso a paso completo (Identity, Profile, el paso External SIEM exclusivo de `provided`, Branding, Review) está documentado una sola vez en [Onboarding de un tenant](/es-419/tenant-onboarding#run-the-create-customer-wizard). Esta sección cubre únicamente lo que es específico del piloto de tailnet.

::: warning El slug debe coincidir con su etiqueta de tailnet
En el paso Identity, configure el **Slug** para que coincida con su etiqueta de tailnet de §1.1 (así que `tag:tenant-acme` → slug `acme`). Los pasos posteriores sustituyen el slug directamente en `tag:tenant-<slug>` para la clave de autenticación (§3.3) y el comando `tailscale up` del tenant (§4.2 / §4.7a); un desajuste significa que el nodo del tenant anuncia una etiqueta que sus ACLs de §1.2 no otorgan.
:::

::: tip Reúna las credenciales de provided por adelantado
Para un tenant de perfil `provided`, el paso External SIEM del asistente necesita las credenciales de Wazuh existentes del tenant, y esos endpoints deben ser alcanzables desde la VM del tenant que levantará en §4. Obténgalas primero de su contacto del tenant, fuera de banda; consulte [§3.4](#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).
:::

Cuando el asistente termina, el tenant comienza en `pending` y avanza por `provisioning → active`; observe cómo se acumulan los eventos de ciclo de vida en la página de detalle del tenant.

### 3.2 Emitir el comando de registro del agente

::: warning Sin botón en la UI (todavía)
Al momento de escribir esto, la página de detalle del tenant expone solo las acciones de ciclo de vida (Suspend / Resume / Retry Provisioning / Decommission). El flujo `:issue-agent` es solo por API; ejecútelo desde una shell en la VM del MSSP. Un botón dedicado **Issue Agent** está en la hoja de ruta.
:::

![Detalle del tenant: solo acciones de ciclo de vida, sin botón Issue Agent](/screenshots/mssp-tenant-detail.png)

Desde la VM del MSSP, inicie sesión una vez para obtener una cookie de sesión, luego haga POST contra el endpoint `:issue-agent` del tenant:

```bash
# Replace <mssp-host> with your MSSP UI hostname (e.g. soctalk-mssp.<tailnet>.ts.net)
# Replace <tenant-id> with the UUID from the tenant detail URL or from GET /api/mssp/tenants
MSSP=https://<mssp-host>
TENANT=<tenant-id>

curl -sk -c jar -X POST "$MSSP/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<mssp-admin-email>","password":"<password>"}'

curl -sk -b jar -X POST "$MSSP/api/mssp/tenants/$TENANT:issue-agent" \
  -H "Origin: $MSSP" \
  -H 'Content-Type: application/json' | jq .
```

El cuerpo de respuesta 201 contiene un `helm_install_hint` que pega directamente en la shell del tenant. Se ve así:

```bash
helm install soctalk-agent-acme \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token>
```

::: warning Use la salida de la API textualmente
La versión del chart `0.1.x` y el token de bootstrap de arriba son ilustrativos; los valores reales vienen de su respuesta de `:issue-agent`. No vuelva a teclear el comando de helm; copie el campo `helm_install_hint`.
:::

::: warning TTL del token de bootstrap
El token de bootstrap expira (por defecto: 24h). Si el tenant no ejecuta el comando antes de eso, vuelva a emitir contra el mismo endpoint `:issue-agent`. Volver a emitir revoca cualquier token previo no consumido.
:::

### 3.3 Entrega al contacto del tenant

El operador del tenant necesita **dos** cosas:

1. El **comando de helm** de §3.2 (arriba). Cópielo como un solo bloque.
2. La **clave de autenticación de Tailscale etiquetada por tenant** que generó en §1.3.

Envíe esto a través de un gestor de contraseñas compartido (1Password, Bitwarden, Vaultwarden, cualquiera con cifrado de extremo a extremo). No pegue ninguno en un canal público de Slack ni los envíe por email sin cifrar.

::: info Próximamente
El [SocTalk Launchpad](https://github.com/soctalk/soctalk) (en diseño) generará un solo paquete firmado que el tenant pega en su asistente de configuración, automatizando esta entrega. Por ahora es un copiar-pegar manual.
:::

### 3.4 Coordinar credenciales de Wazuh externo para tenants `provided`

::: tip Salte esta sección si eligió `poc` o `persistent` en §3.1
Esos perfiles son autocontenidos: el chart instala su propio Wazuh; nada más que hacer en el lado del MSSP. Salte a §4.
:::

Para tenants de perfil `provided` el asistente **ya recopiló** las credenciales de External SIEM en el paso 3 de §3.1, así que para cuando el tenant llega a `active` el adaptador está configurado. El único trabajo fuera de banda es previo a §3.1: obtener las credenciales del tenant en primer lugar.

Secuencia:

1. **Antes de §3.1**, pida a su contacto del tenant:
   - Wazuh Indexer URL + usuario + contraseña (autenticación Basic usada por el adaptador para `_search`)
   - Wazuh Manager API URL + usuario + contraseña (usado para emitir JWTs)
   - Una decisión de alcanzabilidad: ¿está su Wazuh en el mismo tailnet que la VM del tenant que levantará en §4? Si no, necesitarán `--advertise-routes` de §4.2 (consulte §4.7a para el menú).
2. Ellos siguen §4.7a de su lado para confirmar la alcanzabilidad.
3. Ellos le envían ambos pares de endpoint + credencial (gestor de contraseñas compartido).
4. Usted ejecuta §3.1 con **Provided** en el paso 2 y pega las credenciales en el paso 3.

Si la historia de alcanzabilidad del tenant cambia después de §3.1 (p. ej., mueven Wazuh a un host diferente), actualice el panel External SIEM en la página de detalle del tenant. El controlador recoge el cambio en la siguiente reconciliación (~30 s).

## 4. Lado tenant: levantar el plano de datos

Esta sección es autocontenida para los contactos de IT del tenant. **Si usted es un operador de tenant y su MSSP le envió un comando de helm + una clave de autenticación de Tailscale, puede empezar aquí.** Hojee §0 para contexto, luego siga esta sección.

### 4.1 Aprovisionar una VM Linux

Necesitará una VM Ubuntu 24.04 LTS, mínimo 4 vCPU / 8 GB RAM / 60 GB de disco, con internet saliente. Aprovisiónela a través de su proceso normal de IT. Cualquier hipervisor que ejecute Ubuntu funciona (vSphere, Proxmox, Hyper-V, KVM, VirtualBox, bare metal). Si prefiere usar una imagen de SocTalk pre-horneada, consulte [Quickstart VM paso 1](/es-419/quickstart-vm#_1-download) para los enlaces de imágenes de disco y los pasos de importación por hipervisor; regrese aquí en §4.2.

### 4.2 Endurecer la máquina

::: warning
Si usó la imagen de SocTalk pre-horneada, siga [Acceso SSH + credenciales](/es-419/quickstart-vm#ssh-access-credentials) antes de conectarse a su tailnet. Si aprovisionó una VM Ubuntu genérica a través de su pipeline de IT, su endurecimiento estándar de SO ya aplica.
:::

### 4.3 Instalar Tailscale, unirse al tailnet

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-tenant-... --advertise-tags=tag:tenant-<slug> --hostname=soctalk-tenant-<slug>
```

Use la clave de autenticación de la entrega de su MSSP (§3.3). Verifique:

```bash
tailscale ping soctalk-mssp.<tailnet>.ts.net
# expected: pong from the MSSP control plane
```

Si `ping` falla, revise la lista de máquinas de la UI de administración de Tailscale. Asegúrese de que la máquina del MSSP esté en línea y que el ACL preview muestre que su etiqueta de tenant puede alcanzar `tag:mssp`.

### 4.4 Instalar k3s + Helm

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644" sh -
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

Verifique que k3s se levantó:

```bash
kubectl get nodes
# expected: one node, status Ready
```

### 4.5 Deshabilitar las NetworkPolicies del lado del tenant

::: danger Requerido antes del siguiente paso
El chart `soctalk-cloud-agent` y el chart del tenant vienen con NetworkPolicies que asumen políticas FQDN de Cilium. El k3s vanilla no tiene los CRDs de Cilium, así que las políticas bloquean la salida legítima del agente hacia el MSSP. Deshabilite las NetworkPolicies del chart antes de la instalación de helm en §4.6.

El camino más simple: agregue `--set networkPolicies.enabled=false` a su comando de helm.

Si su clúster de tenant necesita aislamiento de red, aplíquelo en el firewall del host (la ACL del tailnet de §1.2 ya proporciona aislamiento MSSP↔tenant).
:::

### 4.6 Ejecutar el comando de helm de su MSSP

Pegue el comando de §3.2, añadiendo `--set networkPolicies.enabled=false` según §4.5:

```bash
helm install soctalk-agent-<slug> \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token> \
  --set networkPolicies.enabled=false
```

::: tip ¿Certificado del MSSP autofirmado? Establezca insecureTLS
Si su instalación del MSSP aún no ha aprovisionado un certificado TLS real para el nombre de host del tailnet (cert-manager del lado del chart no cableado, o está detrás de Tailscale y lo trata como el límite de confianza), añada `--set insecureTLS=true` al comando de helm. El agente omitirá la verificación de certificado en `controlPlaneUrl`; Tailscale maneja el cifrado de transporte de todos modos. Desactivado por defecto; solo establezca esto cuando confíe en la red subyacente.
:::

El cloud-agent se instala en el namespace `soctalk-agent`, marca al plano de control a través del tailnet, se registra, y desde ahí el controlador del MSSP conduce la instalación del chart del tenant en este mismo clúster.

Observe cómo se levanta el agente:

```bash
kubectl -n soctalk-agent logs deploy/soctalk-cloud-agent -f
# look for: agent_registered installation_id=...
```

Cuando `agent_registered` aparece en los logs, el agente ha hablado exitosamente con el MSSP.

### 4.7 Wazuh: ¿existente o nuevo?

::: code-group
```text [4.7a: Tenant has existing Wazuh]
Required: TWO endpoint + credential pairs.

1. Wazuh Indexer, typically https://<host>:9200
   - User + password with read access to wazuh-alerts-*
2. Wazuh Manager API, typically https://<host>:55000
   - User + password with permission to mint JWTs

Both must be reachable from this tenant VM. The Manager API must ALSO
be reachable from the MSSP via the tailnet; the L1 chat agent dials
it directly when answering questions about your alerts.

If your existing Wazuh runs on a SEPARATE host from this tenant VM
(common), pick one of these:

a) Install Tailscale on the Wazuh host too, join the same tailnet
   tagged tag:tenant-<slug>. Simplest; gives the MSSP a stable
   tailnet hostname to dial.

b) Advertise the Wazuh subnet from this tenant VM. On this VM:

     sudo tailscale up --auth-key=... --advertise-tags=tag:tenant-<slug> \
       --hostname=soctalk-tenant-<slug> \
       --advertise-routes=<wazuh-subnet>/<mask>

   Then approve the route in the Tailscale admin UI under
   Machines → this host → Edit route settings.

Without (a) or (b), the MSSP can reach this VM but cannot reach
your Wazuh Manager, and chat tool calls against your tenant will
fail.

Hand both endpoint + credential pairs (plus the chosen reachability
option) back to your MSSP. They paste the credentials at step 3 of
the Create Customer wizard (§3.1), which configures the SocTalk
tenant chart to use your Wazuh in "provided" mode. If the MSSP has
already onboarded you as `provided` and your reachability story
changes later, they update the External SIEM panel on the tenant
detail page instead (§3.4).
```

```text [4.7b: No existing Wazuh]
The SocTalk tenant chart installs Wazuh + one linux-ep agent
simulator automatically (the `poc` profile). No tenant action needed
beyond waiting ~5 minutes for the Wazuh stack to come up.

Watch progress:
  kubectl -n tenant-<slug> get pods -w
```
:::

### 4.8 Puntos de control: dos estados a observar

El tenant pasa por dos estados de preparación distintos. No los confunda:

#### 4.8a Cloud agent registrado (~1 minuto después de §4.6)

Vuelva a iniciar sesión en el dashboard del MSSP. Su tenant cambia a **Online** dentro de 1-2 minutos de que §4.6 tenga éxito. Esto significa que **el cloud-agent ha alcanzado el MSSP y se ha registrado**: el handshake de confianza está hecho.

Todavía **no** significa que el stack de Wazuh del tenant esté arriba ni que las herramientas del chat resolverán consultas contra este tenant.

![Dashboard MSSP: tenant cambiado a Online](/screenshots/mssp-dashboard-tenant-online.png)

#### 4.8b Plano de datos del tenant completamente listo (~5-7 minutos más)

Después del registro del agente, el controlador del MSSP conduce la instalación del chart del tenant en el clúster del tenant:

- **Perfil `poc`**: se levantan Wazuh + el simulador linux-ep. Tiempo total ~5-7 minutos.
- **Perfil `provided`**: el adaptador de SocTalk se levanta de inmediato. Las llamadas de herramientas de chat de Wazuh se resuelven tan pronto como el adaptador alcanza los endpoints de External SIEM que el MSSP proporcionó en el paso 3 de §3.1. Si no lo hacen, revise la alcanzabilidad según §3.4.

Observe desde la VM del tenant:

```bash
kubectl -n tenant-<slug> get pods -w
# poc profile: wait until wazuh-manager-0, wazuh-indexer-0, linux-ep-N all Ready
# provided profile: wait until soctalk-adapter is Ready
```

Solo después de §4.8b el tenant está listo para la demo en §5. Si §4.8a se dispara pero §4.8b nunca se completa, consulte [Solución de problemas del piloto](#_7-pilot-troubleshooting).

## 5. El momento de la demo

El momento de cara a los interesados. Reproduzca estas consultas textualmente; la redacción determina qué herramienta elige el LLM.

Inicie sesión en el dashboard del MSSP. Abra la pestaña **Chat**.

**Consulta 1. Confirmar que el tenant es alcanzable.**

```text
list all tenants
```

Esperado: una insignia de herramienta `list_tenants`, luego una respuesta que lista sus tenants del piloto por slug + nombre de visualización.

![Chat: insignia de herramienta list_tenants + respuesta](/screenshots/chat-list-tenants.png)

**Consulta 2. Mostrar alertas de un tenant específico.**

```text
show me the 5 most recent alerts at <tenant-slug> with rule ids
```

Esperado: una insignia de herramienta `recent_alerts` con un chip `@ <tenant-slug>`, luego un resumen en lenguaje natural que lista IDs de reglas, severidades y marcas de tiempo.

::: tip Esta es la captura de pantalla para los interesados
El chip `@ <tenant-slug>` en la insignia de herramienta es la prueba: el analista SOC de AI de SocTalk está alcanzando las alertas de Wazuh reenviadas del tenant y respondiendo una pregunta sobre datos reales. Capture esta pantalla.
:::

![Chat: recent_alerts @ acme con IDs de reglas + análisis del LLM](/screenshots/chat-wazuh-alerts.png)

::: info ¿Por qué `recent_alerts` y no `get_wazuh_alert_summary`?
El perfil `poc` del piloto despliega Wazuh en el clúster del tenant y el adaptador de SocTalk reenvía alertas (sujeto a una severidad mínima, configurable vía `SOCTALK_ADAPTER_MIN_SEVERITY`) a la base de datos del MSSP. `recent_alerts` lee de ese flujo reenviado, así que funciona sin importar si el MSSP puede alcanzar la API de Wazuh del tenant directamente. `get_wazuh_alert_summary` es la contraparte de integración en vivo, útil para el perfil `provided` cuando el MSSP tiene la URL de Wazuh + credenciales del tenant en **Integrations**.
:::

Si la lista de alertas está vacía (el Wazuh del tenant aún no ha visto ningún tráfico), genere alertas de prueba. La ruta de Wazuh instalado por chart (§4.7b) incluye uno o más pods `linux-ep-N` con el simulador de ataques; actívelo en la primera réplica lista mediante un selector de etiquetas:

```bash
# On the tenant VM, against any linux-ep pod
kubectl -n tenant-<slug> exec -it \
  "$(kubectl -n tenant-<slug> get pod -l app=linux-ep -o jsonpath='{.items[0].metadata.name}')" \
  -- /opt/scripts/run-attack.sh
```

Espere 30-60 segundos y vuelva a ejecutar la consulta del chat. Para la ruta de Wazuh existente (§4.7a), dispare alertas como lo haría normalmente en su propio Wazuh, p. ej. ingrese por SSH algunas contraseñas incorrectas en un host monitoreado.

## 6. Día 2: hacia dónde ir desde aquí

- **Agregue Wazuh de cliente real.** Incorpore más tenants repitiendo §3 y §4. El mismo patrón; cada nuevo tenant necesita una nueva etiqueta de Tailscale, una entrada de ACL, una clave de autenticación efímera y una emisión de agente.
- **Planifique la instalación de producción.** Cuando esté listo para pasar del piloto, consulte [Instalar](/es-419/install) para la ruta K3s + Cilium + cert-manager + ingress real.
- **Operaciones de ciclo de vida del tenant.** [Ciclo de vida del tenant](/es-419/tenant-lifecycle) cubre suspender, reanudar y dar de baja tenants desde el dashboard del MSSP.
- **Actualizaciones.** [Actualizaciones](/es-419/upgrades) cubre avanzar soctalk-system y el cloud-agent.
- **Respaldos.** [Respaldo y restauración](/es-419/backup-restore) para datos con estado.

### Qué NO está en el piloto

- Alta disponibilidad (un solo nodo k3s en cada lado)
- TLS real (el nombre de host del tailnet usa certificados autofirmados; producción necesita cert-manager + ingress real)
- Multi-región
- Escala por tenant más allá de ~50 agentes de Wazuh por tenant
- Ingress por tenant (este piloto usa el nombre de host del tailnet para todo)

Cuando migre a producción, la configuración de su producto MSSP (lista de tenants, historial de chat, clave de LLM) puede transferirse con planificación. Hable con el equipo antes de dar de baja este piloto.

## 7. Solución de problemas del piloto

Tabla orientada a síntomas para fallas específicas de la topología del piloto. Los problemas genéricos de SocTalk se cubren en [Solución de problemas](/es-419/troubleshooting).

| Síntoma | Causa probable | Verificación |
|---|---|---|
| Tenant atascado en "Pending" en el dashboard del MSSP | El token de bootstrap expiró antes de que §4.6 se ejecutara | Vuelva a emitir desde el dashboard del MSSP (§3.2); los tokens por defecto duran 24h |
| `tailscale ping soctalk-mssp.<tailnet>.ts.net` falla desde el tenant | ACL demasiado estricta, o máquina del MSSP fuera de línea | Revise el ACL preview en la UI de administración de Tailscale; revise `tailscale status` del MSSP |
| Los logs del agente muestran `connection refused` a `controlPlaneUrl` | El `helm upgrade` del lado MSSP de §2.4 no surtió efecto | En la VM del MSSP: `kubectl -n soctalk-system get ingress`; confirme que el nombre de host coincide |
| Los logs del agente muestran `403 Forbidden` desde el MSSP | Token de bootstrap ya usado (de un solo uso) | Vuelva a emitir desde §3.2 |
| `kubectl -n soctalk-agent get pods` muestra `ImagePullBackOff` | El clúster del tenant no puede descargar de `ghcr.io` (proxy corporativo) | Configure el registries.yaml de k3s con el proxy; o pre-descargue en la VM del tenant |
| El chat dice "no Wazuh alerts" pero el tenant tiene alertas | Caso de Wazuh existente: la Manager API no es alcanzable desde el tailnet del MSSP | Desde la VM del MSSP: `curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"` (GET; debería devolver un JWT) |
| La herramienta `get_wazuh_alert_summary` devuelve error | Caso de Wazuh existente: credenciales del Indexer incorrectas | Desde la VM del tenant: `curl -ku <user>:<pw> https://<wazuh-indexer>:9200/wazuh-alerts-*/_search?size=1` |
| El heartbeat del adaptador funciona pero el agente nunca llega a "Online" | NetworkPolicies dejadas habilitadas en §4.5 | `kubectl -n soctalk-agent get networkpolicies`; debería estar vacío |
| `helm install` rechazado con error de esquema de valores | Desajuste de versión de chart entre el plano de control y el chart del agente | Use la versión de chart impresa por el endpoint issue-agent, no "latest" |

## 8. Dar de baja el piloto

Cuando el piloto termina:

1. **Lado tenant, cada tenant**: `helm uninstall soctalk-agent-<slug> -n soctalk-agent`. Apague y archive (o destruya) la VM del tenant.
2. **UI de administración de Tailscale**: revoque la clave de autenticación de cada tenant bajo **Settings → Keys**; elimine cada etiqueta de tenant de **Access Controls**.
3. **Dashboard del MSSP**: para cada tenant, **Decommission** desde la página de detalle del tenant (el estado transiciona a `decommissioning` → `archived`).
4. **VM del MSSP**: archive o destruya si no migra a producción. Si migra, consulte [Instalar](/es-419/install) para la ruta del clúster de producción.

Conserve estos artefactos para la revisión posterior al piloto:

- El log de auditoría de cada página de detalle del tenant (descargable)
- Su `values.yaml` completado de §2.4
- La sección de ACL de Tailscale de §1.2
- Las capturas de pantalla de §5
