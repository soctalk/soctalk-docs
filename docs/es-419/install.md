# Instalación

Para administradores de clúster de MSSP. Cubre los requisitos previos del clúster, la instalación del chart `soctalk-system` y la incorporación del primer cliente.

**¿Lo pruebas por primera vez? Usa mejor la [VM de demostración](/es-419/quickstart-vm).** Es una instalación de imagen única con un asistente basado en navegador — una ruta mucho más rápida hacia un sistema en funcionamiento. Esta página es la ruta de producción: K3s + Cilium + cert-manager + tu propio controlador de ingress.

**¿Evalúas con 1-3 tenants?** [Launchpad](/es-419/launchpad) automatiza el piloto multi-tenant de extremo a extremo (VMs + Tailscale + este instalador + incorporación de tenants). Vuelve aquí cuando estés construyendo el sistema real.

## Instalación rápida en una VM Ubuntu en la nube (un solo comando)

Para un plano de control de MSSP de un solo nodo en una VM Ubuntu 24.04 limpia (en la nube u on-prem), el mismo `install.sh` que la [VM de demostración](/es-419/quickstart-vm) incluye está disponible como instalador de un solo comando. Arranca k3s + Helm, descarga el chart OCI soctalk-system desde GHCR y siembra los secretos de admin / LLM en un solo paso.

Configura la instalación mediante variables de entorno (cualquier subconjunto; el resto se solicita) — cuando **las tres** variables `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL`, `SOCTALK_ADMIN_PASSWORD` están presentes, el instalador omite su solicitud de consentimiento para que los flujos desatendidos de `curl | bash` funcionen sin `-y`:

```bash
export SOCTALK_MSSP_NAME="Acme MSSP"
export SOCTALK_ADMIN_EMAIL="admin@acme.example"
export SOCTALK_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SOCTALK_HOSTNAME="soctalk.acme.example"      # cuál será la URL del dashboard
export SOCTALK_LLM_PROVIDER="anthropic"             # o openai-compatible
export SOCTALK_LLM_API_KEY="sk-..."                 # O --llm-key-file <path>

curl -sfL https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh | bash
```

Flags que conviene conocer: `--yes` / `-y` (asume sí cuando el entorno es parcial), `--demo` (contraseña de admin aleatoria + incorpora automáticamente un tenant de demostración — la ruta "solo muéstramelo" más rápida; no requiere variables de entorno), `--chart-version <v>` (fija una versión específica del chart), `--chart-dir <path>` / `--values-file <path>` (offline / air-gapped). Referencia completa: `install.sh --help`.

El script propaga `SOCTALK_HOSTNAME` a `ingress.hostnames.mssp` del chart y este, a su vez, deriva `SOCTALK_PUBLIC_ORIGIN` (CSRF) y `SOCTALK_L1_PUBLIC_URL` (la URL que el cloud-agent del tenant usa para `/register`). No se requiere ajustar variables de entorno manualmente en el Deployment de la api.

Si necesitas un control más fino — un controlador de ingress no predeterminado, un hostname de cliente separado, un `ClusterIssuer` de cert-manager, etc. — usa en su lugar la ruta de Helm que se describe más abajo.

## Requisitos previos del clúster

Instala esto una vez por clúster de K3s antes de `soctalk-system`. SocTalk requiere Kubernetes 1.30+ porque el chart del sistema instala un guard nativo `ValidatingAdmissionPolicy` para las operaciones sobre namespaces de tenants.

### K3s con Cilium

```bash
# K3s de producción: deshabilita flannel + kube-proxy + traefik para que Cilium (CNI)
# y el controlador de ingress que elijas tomen el control. La imagen de la VM de demostración usa
# el Traefik *incluido* en su lugar — eso es intencional para una instalación de una sola caja
# sin configuración, pero no es lo que quieres para producción.
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC=" \
  --flannel-backend=none \
  --disable-network-policy \
  --disable-kube-proxy \
  --disable=traefik \
" sh -

# Instala Cilium.
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium --version 1.15.x \
  --namespace kube-system \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=<node-ip> \
  --set k8sServicePort=6443 \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true

# Verifica.
cilium status
```

### cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.14.x \
  --set installCRDs=true
```

Configura un `ClusterIssuer` apropiado para tu entorno (Let's Encrypt, CA interna o autofirmado para desarrollo).

Los valores predeterminados de SocTalk solicitan un host comodín para las UIs de los clientes (`*.customers.your-mssp.example`), y Let's Encrypt solo emite comodines sobre DNS-01. Usa un solver DNS-01 con el proveedor que aloja tu zona. Ejemplo para Cloudflare:

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@your-mssp.example
    privateKeySecretRef: { name: letsencrypt-prod }
    solvers:
      - selector:
          dnsZones:
            - your-mssp.example
        dns01:
          cloudflare:
            email: ops@your-mssp.example
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
```

cert-manager tiene recetas de solver para Route 53, Cloud DNS, Azure DNS, RFC 2136 y otros. Elige la que corresponda al proveedor de tu zona.

> Si no necesitas hostnames comodín para clientes (es decir, enumeras los hosts de clientes individualmente), puedes usar HTTP-01 con `solvers: [- http01: { ingress: { class: traefik } }]` en su lugar. Los valores de `soctalk-system` usan por defecto `className: traefik`; el `ingress.class` del solver ACME (HTTP-01) o el proveedor de DNS debe coincidir con la clase de ingress del chart. Para ingress-nginx, establece `class: nginx` en ambos lados.

### Controlador de ingress

K3s no incluye Traefik con nosotros (lo deshabilitamos arriba). Instala tu ingress preferido:

```bash
# Opción A: Traefik v3
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n ingress-system --create-namespace

# Opción B: ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-system --create-namespace
```

Etiqueta el namespace de ingress para NetworkPolicy:

```bash
kubectl label namespace ingress-system managed-by=ingress
```

### Modo de autenticación

La API lee `SOCTALK_AUTH_MODE` (`internal | proxy`) al iniciar. El chart `soctalk-system` se despliega en modo `internal`: SocTalk es dueño del login, las sesiones y el almacenamiento de contraseñas, y el Job de bootstrap siembra un admin inicial en un Secret (consulta [Ejecutar el bootstrap](#run-the-bootstrap)).

El modo `proxy` — poner a SocTalk detrás de OAuth2-Proxy / Keycloak / Dex y confiar en las cabeceras de identidad upstream — es compatible con el runtime pero aún no está expuesto como una perilla de values del chart. Trátalo como un elemento para una versión futura; si operas un SSO central y quieres pilotarlo ahora, establece la variable de entorno directamente en el Deployment de la API tras la instalación.

Detalles completos: [Autenticación interna](/es-419/reference/internal-auth).

### StorageClass

Cualquier provisionador dinámico funciona. Para el predeterminado de K3s, `local-path` viene preinstalado. Para producción, usa Longhorn, Rook/Ceph o un CSI de proveedor de nube. Asegúrate de que uno esté marcado con `storageclass.kubernetes.io/is-default-class=true`.

## Instalar SocTalk

### Preparar los values

Crea `soctalk-system-values.yaml`:

```yaml
install:
  msspId: "<uuid>"         # generate: uuidgen | tr A-Z a-z
  msspName: "Your MSSP"
  installId: "<uuid>"
  installLabel: "pilot-prod"

image:
  registry: ghcr.io/soctalk
  tag: "0.1.4"

ingress:
  enabled: true
  className: traefik          # chart default; set to "nginx" for ingress-nginx
  tls:
    issuerRef: letsencrypt-prod
    secretName: soctalk-tls
  hostnames:
    mssp: mssp.your-mssp.example
    customer: "*.customers.your-mssp.example"

# Auth knobs the chart accepts today. See the Authentication mode
# section above for proxy mode (not yet wired through values).
auth:
  cookieSecure: true          # production TLS: keep true; HTTP-only dev: false

# Trusted headers and proxy CIDRs are read by the API only in proxy
# mode (which today requires a manual env-var override after install).
# Defaults shown for reference; safe to omit when running internal mode.
oidc:
  trustedHeaderUser: X-Forwarded-User
  trustedHeaderEmail: X-Forwarded-Email
  trustedHeaderGroups: X-Forwarded-Groups
  trustedProxyCIDRs:
    - 10.42.0.0/16   # your pod CIDR / ingress CIDR

postgres:
  enabled: true
  storage: { size: 20Gi }

# Required if you want a working sign-in on first install. The chart's
# db-init container creates this user inline; without it, no admin
# exists and `soctalk-auth set-password` (which only updates existing
# users) has nothing to update.
install:
  bootstrapAdmin:
    email: "ops@your-mssp.example"
    password: "changeMe-please-rotate"   # rotate via `soctalk-auth set-password` after first sign-in
    displayName: "MSSP Admin"
    # Production alternative: leave password empty and set
    # existingSecret to a pre-provisioned Secret with key `password`
    # so the credential never passes through helm values.
    # existingSecret: "my-bootstrap-admin"
```

### Instalar

```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version 0.1.4 \
  --namespace soctalk-system --create-namespace \
  -f soctalk-system-values.yaml
```

El Job de pre-instalación del chart verifica los requisitos previos del clúster y falla de inmediato si falta alguno.

### Las migraciones y el bootstrap se ejecutan automáticamente

Ambos ocurren dentro del comando de init del pod de la API antes de que arranque la aplicación FastAPI:

1. Esperar a que Postgres acepte conexiones.
2. `alembic upgrade head` para migrar al esquema más reciente.
3. Vincular las contraseñas por rol (`soctalk_app`, `soctalk_mssp`).
4. Sembrar la fila Organization a partir de `install.msspId` / `install.msspName`.
5. Si `install.bootstrapAdmin.email` e `install.bootstrapAdmin.password` están definidos en los values, hacer upsert del usuario como `mssp_admin` con `must_change=false` y la contraseña suministrada.

Así que si colocas las credenciales del admin de bootstrap en los values, **la API arranca con el admin ya creado** — sin ningún Job adicional que ejecutar.

El chart **no** incluye un Job de Alembic separado; la edición anterior de esta página describía uno que no existía. Las migraciones están ligadas al ciclo de vida del pod de la API. Para observarlas:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

En una actualización, eliminar el pod de la API vuelve a ejecutar la migración (alembic es idempotente, por lo que volver a ejecutarla sobre una DB sin cambios no tiene efecto).

Si NO suministraste `install.bootstrapAdmin.password` en los values, establece la contraseña del admin tras la instalación:

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password <admin-email>
```

En el modo de autenticación `proxy`, los endpoints de contraseña no se montan. **El aprovisionamiento JIT de usuarios en la primera solicitud autenticada no está implementado en V1** — debes sembrar manualmente el primer usuario de MSSP (por ejemplo, mediante `kubectl exec` en el pod de la API y un `INSERT` SQL directo contra la tabla `users`) antes de que cualquier solicitud autenticada por proxy pueda tener éxito. Una ruta JIT real está en el roadmap.

## Verificar la instalación

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace soctalk-system
```

Inicia sesión en `https://mssp.your-mssp.example` con el admin de bootstrap. Deberías llegar al dashboard de MSSP:

![MSSP dashboard](/screenshots/mssp-dashboard.png)

Para un recorrido por cada pantalla que verás de aquí en adelante, lee el [Recorrido por la UI de MSSP](/es-419/mssp-ui).

## Incorporar el primer cliente

En la UI de MSSP ve a **Tenants → New tenant**. El formulario de incorporación recopila: slug, nombre para mostrar, perfil (`poc` | `persistent` | `provided`), correo de contacto, branding y, opcionalmente, la URL base del LLM + overrides de modelo. Las invitaciones de customer-viewer **no** están en el formulario — eso se configura después de que el tenant llega a `active`. El aprovisionamiento se ejecuta de forma asíncrona; actualiza la página de detalle para ver aparecer nuevos eventos de ciclo de vida en la tabla de eventos. (Un stream de eventos en vivo está en el roadmap; `/api/events/stream` existe pero solo emite pings en esta versión.) Si eliges `provided` (BYO Wazuh), el formulario además requiere las URLs del indexador externo + la Manager API y las credenciales, más una clave de LLM por tenant — consulta [ciclo de vida del tenant / provided](/es-419/tenant-lifecycle#provided).

![Tenants list](/screenshots/tenants-list.png)

Después de que el tenant llega a `active`:

1. Actualiza la clave de API del LLM del tenant mediante **Customer → Settings → LLM**.
2. Configura el ingress del agente Wazuh según [Ingress de Wazuh](/es-419/reference/wazuh-ingress).
3. Comparte la URL de la UI del cliente y la invitación inicial de `customer_viewer` con el cliente final.

Luego verifica:

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# Tenant namespace exists and data plane is Ready
kubectl -n tenant-<slug> get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace tenant-<slug> --verdict DROPPED
```

## Siguiente

- [Operaciones diarias](/es-419/operations) para tareas de día 2.
- [Actualizaciones](/es-419/upgrades) para actualizaciones a nivel de instalación y por tenant.
- [Ingress de Wazuh](/es-419/reference/wazuh-ingress) para la incorporación de agentes de clientes.
