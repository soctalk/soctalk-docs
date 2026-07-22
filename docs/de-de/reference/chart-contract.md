# Zwei-Chart-Vertrag

> **V1-Status.** Die folgenden Abschnitte beschreiben den **angestrebten Vertrag**. Konkret sind in diesem Release die Tabelle `chart_compatibility`, das Artefakt `compatibility.yaml`, die Validierung `controller.can_upgrade(system, tenant)` und die MSSP-UI-Oberfläche „System → Versions" **nicht implementiert**. Behandeln Sie Kompatibilität bis zu deren Auslieferung als einen Vertrag der Release Notes (nur getestete Kombinationen). Das nachstehende Schema und die Matrix bleiben als Entwurfsziel nützlich.

## Chart-Klassen

| | `soctalk-system` | `soctalk-tenant` |
|---|---|---|
| **Geltungsbereich** | Eine pro MSSP-Installation | Eine pro Endkunde |
| **Ziel-Namespace** | `soctalk-system` (fest) | `tenant-<slug>` (bei Installation erstellt) |
| **Installiert von** | MSSP-Cluster-Admin (`helm install soctalk-system …`) | SocTalk-Controller über Helm SDK (ausgelöst durch `POST /api/mssp/tenants`) |
| **Wie oft** | Einmal pro Cluster-Lebensdauer; `helm upgrade` bei Versionswechsel | Pro Endkunden-Onboarding; `helm upgrade` bei Versionswechsel des SOC-Stacks |
| **Erstellung der Werte** | Von Hand geschrieben durch MSSP-Admin | Von SocTalk aus der Mandantenkonfiguration gerendert; niemals von Hand bearbeitet |
| **Validierung über** | `values.schema.json` | `values.schema.json` (SocTalk validiert zusätzlich vor dem Rendern) |
| **Quelle der Versionswahrheit** | Chart.yaml semver | Chart.yaml semver |

## 2. `soctalk-system` Werteschema (Entwurf)

Vereinfachte Struktur; das vollständige JSON-Schema-Artefakt liegt in `charts/soctalk-system/values.schema.json`.

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

### Tenant-Render-Overrides

`soctalk-system` trägt außerdem die Schlüssel, die der Controller verwendet, wenn er jedes mandantenspezifische Chart rendert und installiert. Sie pinnen die Referenz auf das Mandanten-Chart und die von SocTalk erstellten Image-Tags, die die Control Plane in jedes Mandanten-Render injiziert, sodass eine Installation ihre gesamte Mandantenflotte aktualisiert, indem diese an einer Stelle angehoben werden.

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

## 3. `soctalk-tenant` Werteschema (Entwurf)

Entspricht dem Mandantenkonfigurationsmodell, das SocTalk aus der DB rendert. Dies ist der Vertrag, gegen den der SocTalk-Controller rendert; `values.schema.json` validiert ihn auf beiden Seiten.

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

## Kompatibilitätsmatrix

SocTalk führt eine Kompatibilitätsmatrix darüber, welche `soctalk-tenant`-Chart-Versionen von welcher `soctalk-system`-Version unterstützt werden. Der Versuch, eine Kombination außerhalb des zulässigen Bereichs anzuwenden, wird abgelehnt.

Gespeichert in der SocTalk-DB:

```sql
CREATE TABLE chart_compatibility (
  soctalk_system_version text NOT NULL,
  tenant_chart_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('supported','deprecated','blocked')),
  notes text,
  PRIMARY KEY (soctalk_system_version, tenant_chart_version)
);
```

Zur Build-Zeit aus einer YAML-Spezifikation im Repository befüllt:

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

Durchsetzung: Der SocTalk-Controller lehnt `helm upgrade` bei einer blockierten Kombination ab; bei „deprecated" warnt er, lässt es aber zu; bei „supported" fährt er fort.

## Richtlinie zur Versionsfixierung

### Von SocTalk erstellte Images

Per Digest in `soctalk-tenant/values.yaml` fixiert:
```yaml
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    digest: sha256:abc123...
```

### Upstream-OSS-Chart-Subcharts (Wazuh / linux-ep)

Als Geschwister-Charts unter `charts/` (`charts/wazuh`, `charts/linux-ep`) geführt und per relativem Pfad referenziert, nicht zur Installationszeit abgerufen. `Chart.yaml` listet sie als lokale Abhängigkeiten auf, jede über ihre Komponentenbedingung gegated:

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

TheHive und Cortex sind **keine** vendorten Subcharts. Sie sind externe Integrationen, pro Mandant konfiguriert (siehe /integrate/thehive und /integrate/cortex).

Gründe für das Vendoring (aus dem Chart-Audit):
- SocTalk-Patches anwenden, ohne von der Annahme durch Upstream abhängig zu sein.
- Stabiler Hash für die Supply-Chain-Attestierung (cosign in einem künftigen Release).
- Reproduzierbare Builds.

## Render- → Apply-Ablauf

Controller-seitiger Ablauf, wenn `POST /api/mssp/tenants` eintrifft:

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

Bei Fehlern in einem beliebigen Schritt:
- Idempotenter Wiederholungsversuch: Der Controller merkt sich, welcher Schritt abgeschlossen wurde (über `TenantLifecycleEvent`).
- Schlägt `helm install` fehl, erfolgt ein Rollback über `helm uninstall` + `kubectl delete ns`.
- Der Mandantenstatus bleibt `pending` mit Fehlerdetails; der MSSP-Operator kann aus der UI erneut versuchen.

Bei `POST /api/mssp/tenants/:id:upgrade` (API in einem künftigen Release; Runbook):
```
1. Check compatibility matrix.
2. helm upgrade soctalk-tenant -n tenant-<slug> --values <new-values.yaml>
3. Wait for rollout; on failure, helm rollback.
4. Emit TenantLifecycleEvent.
```

Bei `POST /api/mssp/tenants/:id:decommission`:
```
1. Mark tenant decommissioning; grace period starts.
2. Document how to retrieve tenant data before teardown (backup/restore runbook).
3. After grace period: helm uninstall, kubectl delete ns.
4. Soft-delete Tenant row with deleted_at timestamp.
5. Retention window: keep row in DB for compliance period.
6. Hard delete after retention.
```

## Chart-Veröffentlichung

### Verteilung

- **(minimal)**: als OCI-Artefakte nach `ghcr.io/soctalk/charts/soctalk-system` und `/charts/soctalk-tenant` pushen: öffentliche, nicht authentifizierte Pulls.
- **künftiges Release**: cosign-signiert + SBOM angehängt.

Der Installationsleitfaden verwendet:
```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
    --version v1.0.0 \
    --namespace soctalk-system --create-namespace \
    -f values.yaml
```

### Versionierungskadenz

- Die `soctalk-system`-Version wird bei jeder API-Änderung, Schema-Änderung oder Funktionserweiterung angehoben.
- Die `soctalk-tenant`-Version wird bei jedem Subchart-Upgrade der Data Plane oder jeder Änderung des Mandanten-Templates angehoben.
- Für jede neue Kombination wird ein Eintrag in der Kompatibilitätsmatrix hinzugefügt; die Release Notes dokumentieren die unterstützten Bereiche.

## Testen des Vertrags

Ein späteres Release und Tests:

1. **values.schema.json-Validierung**: `helm lint` + `helm template` mit Beispielwerten: beide Charts.
2. **Round-Trip-Rendering**: SocTalk rendert eine Mandantenkonfiguration → Werte → Apply → Rücklesen aus K8s → Vergleich. Keine Drift zusichern.
3. **Subchart-Fixierung**: `Chart.lock` + Digests entsprechen den Erwartungen; CI schlägt bei Drift fehl.
4. **Durchsetzung der Kompatibilitätsmatrix**: Unit-Test für `controller.can_upgrade(system=X, tenant=Y)` über die Kombinationen supported / deprecated / blocked.
5. **Smoke-Test der Bundle-Signierung (künftiges Release)**: `cosign verify` für das veröffentlichte Chart.
