# Contrato de duas charts

> **Status da V1.** As seções abaixo descrevem o **contrato-alvo**. Concretamente, nesta versão: a tabela `chart_compatibility`, o artefato `compatibility.yaml`, a validação `controller.can_upgrade(system, tenant)` e a superfície "System → Versions" da MSSP-UI **não estão implementados**. Trate a compatibilidade como um contrato de notas de versão (apenas combinações testadas) até que esses recursos sejam lançados. O schema e a matriz abaixo continuam úteis como alvo de design.

## Classes de chart

| | `soctalk-system` | `soctalk-tenant` |
|---|---|---|
| **Escopo** | Uma por instalação de MSSP | Uma por cliente final |
| **Namespace de destino** | `soctalk-system` (fixo) | `tenant-<slug>` (criado na instalação) |
| **Instalada por** | Admin do cluster MSSP (`helm install soctalk-system …`) | Controlador SocTalk via Helm SDK (acionado por `POST /api/mssp/tenants`) |
| **Com que frequência** | Uma vez por ciclo de vida do cluster; `helm upgrade` na mudança de versão | Por onboarding de cliente final; `helm upgrade` na mudança de versão do stack de SOC |
| **Autoria dos valores** | Escritos à mão pelo admin do MSSP | Renderizados pelo SocTalk a partir da config do tenant; nunca editados à mão |
| **Valida via** | `values.schema.json` | `values.schema.json` (o SocTalk também valida antes da renderização) |
| **Fonte da verdade da versão** | semver do Chart.yaml | semver do Chart.yaml |

## 2. Schema de valores do `soctalk-system` (rascunho)

Formato simplificado; o artefato completo de JSON Schema fica em `charts/soctalk-system/values.schema.json`.

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

## 3. Schema de valores do `soctalk-tenant` (rascunho)

Corresponde ao modelo de config de tenant que o SocTalk renderiza a partir do banco de dados. Este é o contrato contra o qual o controlador do SocTalk renderiza; o `values.schema.json` o valida em ambos os lados.

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

## Matriz de compatibilidade

O SocTalk mantém uma matriz de compatibilidade que indica quais versões da chart `soctalk-tenant` são suportadas por qual versão da `soctalk-system`. Tentar aplicar uma combinação fora do intervalo é recusado.

Armazenada no banco de dados do SocTalk:

```sql
CREATE TABLE chart_compatibility (
  soctalk_system_version text NOT NULL,
  tenant_chart_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('supported','deprecated','blocked')),
  notes text,
  PRIMARY KEY (soctalk_system_version, tenant_chart_version)
);
```

Populada em tempo de build a partir de uma spec YAML no repositório:

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

Aplicação: o controlador do SocTalk recusa `helm upgrade` com uma combinação bloqueada; avisa em combinações depreciadas mas permite; prossegue em combinações suportadas.

## Política de fixação de versão

### Imagens de autoria do SocTalk

Fixadas por digest em `soctalk-tenant/values.yaml`:
```yaml
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    digest: sha256:abc123...
```

### Subcharts OSS upstream (Wazuh / TheHive / Cortex)

Vendorizadas em `charts/soctalk-tenant/charts/` como diretórios, não obtidas em tempo de instalação. O `Chart.yaml` as lista como dependências locais:

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

Motivos para vendorizar (do chart-audit):
- Aplicar patches do SocTalk sem depender da aceitação upstream.
- Hash estável para atestação da cadeia de suprimentos (cosign em uma versão futura).
- Builds reproduzíveis.

## Fluxo de renderização → aplicação

Fluxo no lado do controlador quando um `POST /api/mssp/tenants` chega:

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

Em caso de falha em qualquer etapa:
- Retry idempotente: o controlador lembra qual etapa foi concluída (via `TenantLifecycleEvent`).
- Se o `helm install` falhar, rollback via `helm uninstall` + `kubectl delete ns`.
- O estado do tenant permanece `pending` com detalhes do erro; o operador do MSSP pode tentar novamente pela UI.

Em um `POST /api/mssp/tenants/:id:upgrade` (API de uma versão futura; runbook):
```
1. Check compatibility matrix.
2. helm upgrade soctalk-tenant -n tenant-<slug> --values <new-values.yaml>
3. Wait for rollout; on failure, helm rollback.
4. Emit TenantLifecycleEvent.
```

Em um `POST /api/mssp/tenants/:id:decommission`:
```
1. Mark tenant decommissioning; grace period starts.
2. Document how to retrieve tenant data before teardown (backup/restore runbook).
3. After grace period: helm uninstall, kubectl delete ns.
4. Soft-delete Tenant row with deleted_at timestamp.
5. Retention window: keep row in DB for compliance period.
6. Hard delete after retention.
```

## Publicação de charts

### Distribuição

- **(mínimo)**: publicar como artefatos OCI em `ghcr.io/soctalk/charts/soctalk-system` e `/charts/soctalk-tenant`: pulls públicos e não autenticados.
- **uma versão futura**: assinado com cosign + SBOM anexado.

O guia de instalação usa:
```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
    --version v1.0.0 \
    --namespace soctalk-system --create-namespace \
    -f values.yaml
```

### Cadência de versionamento

- A versão da `soctalk-system` sobe em qualquer mudança de API, mudança de schema ou adição de recurso.
- A versão da `soctalk-tenant` sobe em qualquer upgrade de subchart do data plane ou mudança de template de tenant.
- Uma entrada na matriz de compatibilidade é adicionada para cada nova combinação; as notas de versão documentam os intervalos suportados.

## Testando o contrato

Uma versão posterior e testes:

1. **validação do values.schema.json**: `helm lint` + `helm template` com valores de exemplo: ambas as charts.
2. **Renderização round-trip**: o SocTalk renderiza uma config de tenant → valores → aplica → lê de volta do K8s → compara. Afirma ausência de drift.
3. **Fixação de subchart**: `Chart.lock` + digests correspondem às expectativas; a CI falha em caso de drift.
4. **Aplicação da matriz de compatibilidade**: teste unitário para `controller.can_upgrade(system=X, tenant=Y)` nas combinações suportadas / depreciadas / bloqueadas.
5. **Smoke test de assinatura de bundle (uma versão futura)**: `cosign verify` na chart publicada.
