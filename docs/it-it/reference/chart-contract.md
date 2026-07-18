# Contratto a due chart

> **Stato V1.** Le sezioni seguenti descrivono il **contratto obiettivo**. Concretamente, in questa release: la tabella `chart_compatibility`, l'artefatto `compatibility.yaml`, la validazione `controller.can_upgrade(system, tenant)` e la superficie "System → Versions" della MSSP-UI **non sono implementati**. Tratta la compatibilità come un contratto da note di rilascio (solo combinazioni testate) finché non arriveranno. Lo schema e la matrice seguenti restano utili come obiettivo di progettazione.

## Classi di chart

| | `soctalk-system` | `soctalk-tenant` |
|---|---|---|
| **Ambito** | Uno per installazione MSSP | Uno per cliente finale |
| **Namespace di destinazione** | `soctalk-system` (fisso) | `tenant-<slug>` (creato all'installazione) |
| **Installato da** | Amministratore del cluster MSSP (`helm install soctalk-system …`) | Controller SocTalk tramite Helm SDK (attivato da `POST /api/mssp/tenants`) |
| **Con quale frequenza** | Una volta per ciclo di vita del cluster; `helm upgrade` al cambio di versione | Per onboarding di ogni cliente finale; `helm upgrade` al cambio di versione dello stack SOC |
| **Autorialità dei valori** | Scritti a mano dall'amministratore MSSP | Renderizzati da SocTalk dalla configurazione del tenant; mai modificati a mano |
| **Validazione tramite** | `values.schema.json` | `values.schema.json` (SocTalk valida anche pre-render) |
| **Fonte di verità della versione** | semver di Chart.yaml | semver di Chart.yaml |

## 2. Schema dei valori `soctalk-system` (bozza)

Forma semplificata; l'artefatto JSON Schema completo risiede in `charts/soctalk-system/values.schema.json`.

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

## 3. Schema dei valori `soctalk-tenant` (bozza)

Corrisponde al modello di configurazione del tenant che SocTalk renderizza dal DB. Questo è il contratto rispetto al quale il controller di SocTalk esegue il render; `values.schema.json` lo valida su entrambi i lati.

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
  # These are mostly informational in MVP;
  # real integration endpoints are tenant data plane (Wazuh/TheHive/Cortex in-ns).
  externalCortexUrl: ""        # if tenant wants to use an external Cortex instead of the in-ns one

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
  thehive:
    resources:
      requests: { cpu: 300m, memory: 1Gi }
      limits:   { cpu: 1,    memory: 2Gi }
    cassandra:
      resources:
        requests: { cpu: 500m, memory: 2Gi }
        limits:   { cpu: 1.5,  memory: 4Gi }
      persistence:
        size: 30Gi
  cortex:
    resources:
      requests: { cpu: 200m, memory: 768Mi }
      limits:   { cpu: 800m, memory: 1.5Gi }
    elasticsearch:
      resources:
        requests: { cpu: 300m, memory: 1Gi }
        limits:   { cpu: 1,    memory: 2Gi }
      persistence:
        size: 20Gi
    analyzers: []              # allowlist; empty = safe defaults
  misp:
    enabled: false             # a future release

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

# Labels applied to the tenant namespace
namespaceLabels:
  tenant: "true"
  managed-by: soctalk
  mssp-id: <uuid>
  install-id: <uuid>
  tenant-id: <uuid>
```

## Matrice di compatibilità

SocTalk mantiene una matrice di compatibilità che indica quali versioni del chart `soctalk-tenant` sono supportate da quale versione `soctalk-system`. Il tentativo di applicare una combinazione fuori range viene rifiutato.

Memorizzata nel DB di SocTalk:

```sql
CREATE TABLE chart_compatibility (
  soctalk_system_version text NOT NULL,
  tenant_chart_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('supported','deprecated','blocked')),
  notes text,
  PRIMARY KEY (soctalk_system_version, tenant_chart_version)
);
```

Popolata al momento della build da una specifica YAML nel repo:

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

Applicazione: il controller di SocTalk rifiuta `helm upgrade` con una combinazione bloccata (blocked); avvisa su quelle deprecate (deprecated) ma consente; procede su quelle supportate (supported).

## Politica di pinning delle versioni

### Immagini prodotte da SocTalk

Fissate per digest in `soctalk-tenant/values.yaml`:
```yaml
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    digest: sha256:abc123...
```

### Subchart OSS upstream (Wazuh / TheHive / Cortex)

Inclusi tramite vendoring sotto `charts/soctalk-tenant/charts/` come directory, non scaricati al momento dell'installazione. `Chart.yaml` li elenca come dipendenze locali:

```yaml
dependencies:
  - name: wazuh
    version: "0.3.2-soctalk-v1"
    repository: "file://./charts/wazuh"
  - name: thehive
    version: "5.2.0-soctalk-v1"
    repository: "file://./charts/thehive"
  - name: cortex
    version: "3.1.8-soctalk-v1"
    repository: "file://./charts/cortex"
```

Motivi del vendoring (da chart-audit):
- Applicare le patch di SocTalk senza dipendere dall'accettazione upstream.
- Hash stabile per l'attestazione della supply chain (una cosign in una release futura).
- Build riproducibili.

## Flusso render → apply

Flusso lato controller quando arriva `POST /api/mssp/tenants`:

```
1. Validate payload against tenant config JSON Schema.
2. Generate secrets (secret-placement §5): wazuh-bootstrap pw, thehive admin, cortex admin,
   cassandra pw, wazuh authd secret.
3. Write K8s Secrets in soctalk-system (per-tenant LLM, integration creds).
4. Write K8s Secrets in (to-be-created) tenant-<slug>: deferred until ns exists,
   deferred until step 6.
5. Insert Tenant row + TenantSecret references (state=pending).
6. Use SocTalk K8s ServiceAccount:
   a. Create Namespace tenant-<slug> with required labels.
   b. Create per-ns bootstrap Secrets (wazuh-bootstrap, thehive admin, etc.).
   c. helm install soctalk-tenant -n tenant-<slug> --values <rendered-values.yaml>
7. Transition state to provisioning.
8. Wait for all Helm-managed resources to be Ready (timeout 15 min pilot-prod, 30 min small-dev).
9. On adapter heartbeat arriving, transition state to active.
10. Emit TenantLifecycleEvent.
```

In caso di errore in un qualsiasi passo:
- Retry idempotente: il controller ricorda quale passo è stato completato (tramite `TenantLifecycleEvent`).
- Se `helm install` fallisce, rollback tramite `helm uninstall` + `kubectl delete ns`.
- Lo stato del tenant resta `pending` con i dettagli dell'errore; l'operatore MSSP può ritentare dalla UI.

Su `POST /api/mssp/tenants/:id:upgrade` (API di una release futura; runbook):
```
1. Check compatibility matrix.
2. helm upgrade soctalk-tenant -n tenant-<slug> --values <new-values.yaml>
3. Wait for rollout; on failure, helm rollback.
4. Emit TenantLifecycleEvent.
```

Su `POST /api/mssp/tenants/:id:decommission`:
```
1. Mark tenant decommissioning; grace period starts.
2. Document how to retrieve tenant data before teardown (backup/restore runbook).
3. After grace period: helm uninstall, kubectl delete ns.
4. Soft-delete Tenant row with deleted_at timestamp.
5. Retention window: keep row in DB for compliance period.
6. Hard delete after retention.
```

## Pubblicazione dei chart

### Distribuzione

- **(minimale)**: push come artefatti OCI su `ghcr.io/soctalk/charts/soctalk-system` e `/charts/soctalk-tenant`: pull pubblici e non autenticati.
- **una release futura**: firmati con cosign + SBOM allegato.

La guida all'installazione usa:
```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
    --version v1.0.0 \
    --namespace soctalk-system --create-namespace \
    -f values.yaml
```

### Cadenza di versionamento

- La versione `soctalk-system` avanza a ogni modifica dell'API, modifica dello schema o aggiunta di funzionalità.
- La versione `soctalk-tenant` avanza a ogni aggiornamento di un subchart del data plane o modifica del template del tenant.
- Una voce della matrice di compatibilità viene aggiunta per ogni nuova combinazione; le note di rilascio documentano i range supportati.

## Testare il contratto

Una release successiva e i test:

1. **Validazione values.schema.json**: `helm lint` + `helm template` con valori di esempio: entrambi i chart.
2. **Render round-trip**: SocTalk renderizza una configurazione del tenant → values → apply → rilettura da K8s → confronto. Verifica assenza di drift.
3. **Pinning dei subchart**: `Chart.lock` + i digest corrispondono alle aspettative; la CI fallisce in caso di drift.
4. **Applicazione della matrice di compatibilità**: unit test per `controller.can_upgrade(system=X, tenant=Y)` attraverso le combinazioni supported / deprecated / blocked.
5. **Smoke test della firma del bundle (una release futura)**: `cosign verify` sul chart pubblicato.
