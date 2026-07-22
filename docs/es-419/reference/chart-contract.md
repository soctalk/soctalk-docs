# Contrato de dos charts

> **Estado en V1.** Las secciones siguientes describen el **contrato objetivo**. Concretamente, en esta versión: la tabla `chart_compatibility`, el artefacto `compatibility.yaml`, la validación `controller.can_upgrade(system, tenant)` y la superficie "System → Versions" de la MSSP-UI **no están implementados**. Trata la compatibilidad como un contrato de notas de versión (solo combinaciones probadas) hasta que estos se publiquen. El esquema y la matriz de abajo siguen siendo útiles como objetivo de diseño.

## Clases de chart

| | `soctalk-system` | `soctalk-tenant` |
|---|---|---|
| **Alcance** | Uno por instalación de MSSP | Uno por cliente final |
| **Namespace destino** | `soctalk-system` (fijo) | `tenant-<slug>` (creado en la instalación) |
| **Instalado por** | Administrador del clúster del MSSP (`helm install soctalk-system …`) | Controlador de SocTalk mediante el SDK de Helm (activado por `POST /api/mssp/tenants`) |
| **Con qué frecuencia** | Una vez por vida del clúster; `helm upgrade` al cambiar de versión | Por incorporación de cada cliente final; `helm upgrade` al cambiar la versión del stack del SOC |
| **Autoría de valores** | Escritos a mano por el administrador del MSSP | Renderizados por SocTalk a partir de la configuración del tenant; nunca editados a mano |
| **Valida mediante** | `values.schema.json` | `values.schema.json` (SocTalk también valida antes del renderizado) |
| **Fuente de verdad de la versión** | semver de Chart.yaml | semver de Chart.yaml |

## 2. Esquema de valores de `soctalk-system` (borrador)

Forma simplificada; el artefacto completo de JSON Schema vive en `charts/soctalk-system/values.schema.json`.

```yaml
# Install identity
install:
  msspId: <uuid>              # written into Organization row
  msspName: "Example MSSP"
  installId: <uuid>           # written into Organization row; stable across upgrades
  installLabel: "pilot-prod"  # human-readable

# Image sources
image:
  registry: ghcr.io/soctalk
  tag: v1.0.0                 # or `latest`
  pullPolicy: IfNotPresent

# Postgres
postgres:
  enabled: true               # false = use external; then postgres.external.* required
  storage:
    size: 20Gi
    storageClassName: ""      # use cluster default
  external:
    host: ""
    port: 5432
    database: "soctalk"
    existingSecret: ""        # Secret must contain admin_user, admin_password, app_user, app_password, mssp_user, mssp_password

# Ingress (for MSSP UI + Customer UI)
ingress:
  enabled: true
  className: traefik          # or nginx, or anything the cluster provides
  tls:
    secretName: soctalk-tls
    issuerRef: letsencrypt-prod
  hostnames:
    mssp: mssp.example.com
    customer: "*.customers.example.com"  # per-tenant subdomain routing

# Authentication. Chart deploys `internal` mode (SocTalk-owned
# login/sessions/passwords). The runtime also supports `proxy` mode
# (OAuth2-Proxy / Keycloak / Dex forwards trusted identity headers),
# selectable via the `SOCTALK_AUTH_MODE` env var on the API
# Deployment — chart values do not yet expose this switch.
auth:
  cookieSecure: true            # production TLS: true; HTTP-only dev: false
  publicOriginOverride: ""      # set when browser origin includes a non-default port

# OIDC trusted-header config (consumed by the API only in proxy mode).
oidc:
  trustedHeaderUser: X-Forwarded-User
  trustedHeaderEmail: X-Forwarded-Email
  trustedHeaderGroups: X-Forwarded-Groups
  trustedProxyCIDRs:
    - 10.0.0.0/8                # ingress controller CIDR; SocTalk rejects OIDC headers from other sources

# LLM defaults (per-tenant overrides via tenant chart)
defaults:
  llm:
    provider: openai-compatible
    baseUrl: https://api.openai.com/v1
    model: gpt-4o

# Resource sizing for SocTalk control plane
resources:
  api:
    requests: { cpu: 500m, memory: 512Mi }
    limits:   { cpu: 2,    memory: 2Gi }
  orchestrator:
    requests: { cpu: 500m, memory: 1Gi }
    limits:   { cpu: 2,    memory: 4Gi }
  postgres:
    requests: { cpu: 250m, memory: 512Mi }
    limits:   { cpu: 2,    memory: 2Gi }

# Admission: native guard for SocTalk controller namespace operations.
admission:
  engine: vap    # vap | none

# Licensing: disabled in this release
licensing:
  enabled: false

# Telemetry: disabled in this release (no Cloud backend to send to)
telemetry:
  enabled: false
```

### Anulaciones de renderizado del tenant

`soctalk-system` también lleva las claves que usa el controlador cuando renderiza e instala el chart de cada tenant. Fijan la referencia del chart de tenant y las etiquetas (tags) de imagen creadas por SocTalk que el plano de control inyecta en cada render de tenant, de modo que una instalación actualiza toda su flota de tenants incrementando estas en un solo lugar.

```yaml
tenantProvisioning:
  # Which tenant chart the controller renders + installs
  tenantChartRef: oci://ghcr.io/soctalk/charts/soctalk-tenant
  tenantChartVersion: 0.2.0

  # Image overrides injected into each tenant render.
  # Empty repo means "use the chart's default repository"; only the tag is pinned here.
  adapterImageRepo: ''
  adapterImageTag: '0.2.0'
  runsWorkerImageRepo: ''
  runsWorkerImageTag: '0.2.0'
  linuxEpImageTag: '0.2.0'
```

## 3. Esquema de valores de `soctalk-tenant` (borrador)

Coincide con el modelo de configuración del tenant que SocTalk renderiza desde la base de datos. Este es el contrato contra el que renderiza el controlador de SocTalk; `values.schema.json` lo valida en ambos lados.

```yaml
# Tenant identity
tenant:
  id: <uuid>                  # tenant UUID
  slug: acme                  # DNS-safe, MSSP-unique
  msspId: <uuid>
  installId: <uuid>
  displayName: "Acme Corp"

# Branding (referenced by SocTalk UIs, not by data plane)
branding:
  appName: "Acme SOC"
  logoUrl: https://acme.example.com/logo.png
  primaryColor: "#1a73e8"
  secondaryColor: "#fbbc04"
  favicon: ""

# LLM config (per tenant; overrides install defaults)
llm:
  provider: openai-compatible
  baseUrl: https://api.openai.com/v1
  model: gpt-4o
  apiKeyRef:
    # V1: provisioning renders this as a secretKeyRef to a Secret in the
    # tenant's OWN namespace, not the system namespace.
    name: tenant-llm-key        # in tenant-<slug> namespace
    key: api_key

# Integration endpoints (tenant's external systems, if any)
integrations:
  # Wazuh is the in-namespace data plane; TheHive and Cortex are external
  # integrations reached over the network (see /integrate/thehive, /integrate/cortex),
  # not bundled subcharts.
  externalCortexUrl: ""        # external Cortex endpoint for this tenant, if used

# Data plane component sizing
components:
  wazuh:
    manager:
      resources:
        requests: { cpu: 200m, memory: 512Mi }
        limits:   { cpu: 500m, memory: 1Gi }
      persistence:
        size: 20Gi
    indexer:
      resources:
        requests: { cpu: 500m, memory: 2Gi }
        limits:   { cpu: 2,    memory: 4Gi }
      persistence:
        size: 50Gi
      jvm:
        heap: 1g
    dashboard:
      enabled: true
      resources:
        requests: { cpu: 100m, memory: 512Mi }
        limits:   { cpu: 500m, memory: 1Gi }
  # linux-ep is gated here (components.linuxep.enabled); its resources and
  # other subchart values are set on the top-level `linuxep:` passthrough
  # (shown below), not under components.
  misp:
    enabled: false             # a future release

# linux-ep (L2 endpoint-agent subchart) passthrough. Defaults from the subchart:
linuxep:
  resources:
    requests: { cpu: 50m,  memory: 128Mi }
    limits:   { cpu: 500m, memory: 512Mi }
# TheHive and Cortex are external integrations, not bundled subcharts.
# Configure them per tenant via /integrate/thehive and /integrate/cortex;
# the tenant chart does not render or size them.

# Tenant namespace policies
networkPolicies:
  enabled: true
  # LLM endpoint allowlist (mirrors llm.baseUrl hostname for Cilium FQDN policy)
  allowedLlmHosts:
    - api.openai.com

# Resource quota & limits (from sizing)
resourceQuota:
  requests:
    cpu: "3"
    memory: 8Gi
  limits:
    cpu: "7"
    memory: 16Gi
  persistentVolumeClaims: "10"
  pods: "50"

# Wazuh agent ingress
wazuhIngress:
  # mode selects the Service variant the chart renders for 1514/1515:
  #   loadbalancer = type: LoadBalancer (per-tenant LB IP via cloud LB
  #                  controller or MetalLB; the default and recommended)
  #   edge-haproxy = type: ClusterIP; an in-cluster HAProxy Deployment
  #                  in soctalk-system fronts every tenant on a single
  #                  edge IP with per-tenant (1514, 1515) port pairs
  mode: loadbalancer            # loadbalancer | edge-haproxy
  hostname: acme.soc.mssp.example.com
  # Only consulted in edge-haproxy mode; SocTalk picks the pair and
  # writes it back to the tenant lifecycle record.
  edgePorts: { events: 15140, enrollment: 15141 }
  tls:
    issuerRef: letsencrypt-prod  # cert-manager (for the 1515 channel)
    secretName: wazuh-tls

# Adapter
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    tag: v1.0.0
  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits:   { cpu: 200m, memory: 256Mi }
  tokenSecretRef:
    name: adapter-token
    key: token

# Runs worker: pulls investigations and fills the continuous vLLM/SGLang batch.
runsWorker:
  image:
    repository: ghcr.io/soctalk/soctalk-orchestrator
    # tag is pinned by the system chart's runsWorkerImageTag override
  concurrency: 1                # default 1 (serial, uses the code default);
                                # >1 runs concurrent investigations to keep the batch full
  drainSeconds: 60             # grace period applied when concurrency > 1

# Labels applied to the tenant namespace
namespaceLabels:
  tenant: "true"
  managed-by: soctalk
  mssp-id: <uuid>
  install-id: <uuid>
  tenant-id: <uuid>
```

## Matriz de compatibilidad

SocTalk mantiene una matriz de compatibilidad que indica qué versiones del chart `soctalk-tenant` son compatibles con cada versión de `soctalk-system`. Intentar aplicar una combinación fuera de rango se rechaza.

Almacenada en la base de datos de SocTalk:

```sql
CREATE TABLE chart_compatibility (
  soctalk_system_version text NOT NULL,
  tenant_chart_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('supported','deprecated','blocked')),
  notes text,
  PRIMARY KEY (soctalk_system_version, tenant_chart_version)
);
```

Poblada en tiempo de compilación a partir de una especificación YAML en el repositorio:

```yaml
# compatibility.yaml
- system: v1.0.0
  tenant:
    - version: v1.0.0
      status: supported
- system: v1.0.1
  tenant:
    - version: v1.0.0
      status: supported
    - version: v1.0.1
      status: supported
- system: v1.1.0
  tenant:
    - version: v1.0.0
      status: deprecated
      notes: "v1.0.x agents still work but upgrade recommended for FQDN egress changes"
    - version: v1.0.1
      status: supported
    - version: v1.1.0
      status: supported
```

Aplicación: el controlador de SocTalk rechaza `helm upgrade` con una combinación bloqueada; advierte en las obsoletas pero las permite; procede en las compatibles.

## Política de fijación de versiones

### Imágenes creadas por SocTalk

Fijadas por digest en `soctalk-tenant/values.yaml`:
```yaml
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    digest: sha256:abc123...
```

### Subcharts OSS upstream (Wazuh / linux-ep)

Mantenidos como charts hermanos bajo `charts/` (`charts/wazuh`, `charts/linux-ep`) y referenciados por ruta relativa, no obtenidos en tiempo de instalación. `Chart.yaml` los lista como dependencias locales, cada una condicionada por su componente:

```yaml
dependencies:
  - name: wazuh
    version: "0.2.0"
    repository: "file://../wazuh"
    condition: components.wazuh.enabled
  - name: linux-ep
    alias: linuxep
    version: "0.2.0"
    repository: "file://../linux-ep"
    condition: components.linuxep.enabled
```

TheHive y Cortex **no** son subcharts incorporados. Son integraciones externas configuradas por tenant (consulta /es-419/integrate/thehive y /es-419/integrate/cortex).

Razones para el vendoring (de la auditoría de charts):
- Aplicar parches de SocTalk sin depender de la aceptación upstream.
- Hash estable para atestación de la cadena de suministro (cosign en una versión futura).
- Compilaciones reproducibles.

## Flujo de renderizado → aplicación

Flujo del lado del controlador cuando llega `POST /api/mssp/tenants`:

```
1. Validate payload against tenant config JSON Schema.
2. Generate secrets (secret-placement §5): wazuh-bootstrap pw, wazuh authd secret.
3. Write K8s Secrets in soctalk-system (per-tenant LLM, integration creds).
4. Write K8s Secrets in (to-be-created) tenant-<slug>: deferred until ns exists,
   deferred until step 6.
5. Insert Tenant row + TenantSecret references (state=pending).
6. Use SocTalk K8s ServiceAccount:
   a. Create Namespace tenant-<slug> with required labels.
   b. Create per-ns bootstrap Secrets (wazuh-bootstrap, wazuh-authd, etc.).
   c. helm install soctalk-tenant -n tenant-<slug> --values <rendered-values.yaml>
7. Transition state to provisioning.
8. Wait for all Helm-managed resources to be Ready (timeout 15 min pilot-prod, 30 min small-dev).
9. On adapter heartbeat arriving, transition state to active.
10. Emit TenantLifecycleEvent.
```

En caso de fallo en cualquier paso:
- Reintento idempotente: el controlador recuerda qué paso se completó (mediante `TenantLifecycleEvent`).
- Si `helm install` falla, se revierte mediante `helm uninstall` + `kubectl delete ns`.
- El estado del tenant permanece en `pending` con detalles del error; el operador del MSSP puede reintentar desde la UI.

En `POST /api/mssp/tenants/:id:upgrade` (API de una versión futura; runbook):
```
1. Check compatibility matrix.
2. helm upgrade soctalk-tenant -n tenant-<slug> --values <new-values.yaml>
3. Wait for rollout; on failure, helm rollback.
4. Emit TenantLifecycleEvent.
```

En `POST /api/mssp/tenants/:id:decommission`:
```
1. Mark tenant decommissioning; grace period starts.
2. Document how to retrieve tenant data before teardown (backup/restore runbook).
3. After grace period: helm uninstall, kubectl delete ns.
4. Soft-delete Tenant row with deleted_at timestamp.
5. Retention window: keep row in DB for compliance period.
6. Hard delete after retention.
```

## Publicación de charts

### Distribución

- **(mínimo)**: publicar como artefactos OCI en `ghcr.io/soctalk/charts/soctalk-system` y `/charts/soctalk-tenant`: descargas públicas y sin autenticación.
- **versión futura**: firmados con cosign + SBOM adjunto.

La guía de instalación usa:
```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
    --version v1.0.0 \
    --namespace soctalk-system --create-namespace \
    -f values.yaml
```

### Cadencia de versionado

- La versión de `soctalk-system` se incrementa ante cualquier cambio de API, cambio de esquema o incorporación de funcionalidad.
- La versión de `soctalk-tenant` se incrementa ante cualquier actualización de subchart del plano de datos o cambio en la plantilla del tenant.
- Se agrega una entrada a la matriz de compatibilidad por cada nueva combinación; las notas de versión documentan los rangos compatibles.

## Prueba del contrato

Una versión posterior y pruebas:

1. **Validación de values.schema.json**: `helm lint` + `helm template` con valores de ejemplo: ambos charts.
2. **Renderizado de ida y vuelta**: SocTalk renderiza una configuración de tenant → valores → aplica → vuelve a leer desde K8s → compara. Verifica que no haya deriva.
3. **Fijación de subcharts**: `Chart.lock` + los digests coinciden con lo esperado; CI falla ante deriva.
4. **Aplicación de la matriz de compatibilidad**: prueba unitaria para `controller.can_upgrade(system=X, tenant=Y)` a través de combinaciones supported / deprecated / blocked.
5. **Prueba de humo de firma del bundle (versión futura)**: `cosign verify` sobre el chart publicado.
