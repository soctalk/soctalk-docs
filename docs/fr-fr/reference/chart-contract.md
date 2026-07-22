# Contrat à deux charts

> **Statut V1.** Les sections ci-dessous décrivent le **contrat cible**. Concrètement, dans cette version : la table `chart_compatibility`, l'artefact `compatibility.yaml`, la validation `controller.can_upgrade(system, tenant)` et la surface « System → Versions » de l'interface MSSP ne sont **pas implémentés**. Traitez la compatibilité comme un contrat de notes de version (combinaisons testées uniquement) jusqu'à leur livraison. Le schéma et la matrice ci-dessous restent utiles comme cible de conception.

## Classes de chart

| | `soctalk-system` | `soctalk-tenant` |
|---|---|---|
| **Portée** | Une par installation MSSP | Une par client final |
| **Namespace cible** | `soctalk-system` (fixe) | `tenant-<slug>` (créé à l'installation) |
| **Installé par** | Administrateur du cluster MSSP (`helm install soctalk-system …`) | Contrôleur SocTalk via le SDK Helm (déclenché par `POST /api/mssp/tenants`) |
| **Fréquence** | Une fois par durée de vie du cluster ; `helm upgrade` au changement de version | Par onboarding de client final ; `helm upgrade` au changement de version de la pile SOC |
| **Rédaction des valeurs** | Écrites à la main par l'administrateur MSSP | Rendues par SocTalk à partir de la configuration du tenant ; jamais éditées à la main |
| **Validées via** | `values.schema.json` | `values.schema.json` (SocTalk valide aussi avant le rendu) |
| **Source de vérité de version** | semver de Chart.yaml | semver de Chart.yaml |

## 2. Schéma de valeurs `soctalk-system` (brouillon)

Forme simplifiée ; l'artefact JSON Schema complet réside dans `charts/soctalk-system/values.schema.json`.

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

### Surcharges de rendu de tenant

`soctalk-system` porte aussi les clés que le contrôleur utilise lorsqu'il rend et installe chaque chart par tenant. Elles épinglent la référence du chart de tenant et les tags d'image écrits par SocTalk que le control plane injecte dans chaque rendu de tenant, de sorte qu'une installation met à niveau toute sa flotte de tenants en incrémentant ces valeurs à un seul endroit.

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

## 3. Schéma de valeurs `soctalk-tenant` (brouillon)

Correspond au modèle de configuration du tenant que SocTalk rend depuis la base de données. C'est le contrat contre lequel le contrôleur de SocTalk effectue le rendu ; `values.schema.json` le valide des deux côtés.

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

## Matrice de compatibilité

SocTalk maintient une matrice de compatibilité indiquant quelles versions de chart `soctalk-tenant` sont prises en charge par quelle version de `soctalk-system`. Toute tentative d'appliquer une combinaison hors plage est refusée.

Stockée dans la base de données de SocTalk :

```sql
CREATE TABLE chart_compatibility (
  soctalk_system_version text NOT NULL,
  tenant_chart_version text NOT NULL,
  status text NOT NULL CHECK (status IN ('supported','deprecated','blocked')),
  notes text,
  PRIMARY KEY (soctalk_system_version, tenant_chart_version)
);
```

Peuplée au moment de la compilation à partir d'une spécification YAML dans le dépôt :

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

Application : le contrôleur de SocTalk refuse `helm upgrade` avec une combinaison bloquée ; avertit en cas de combinaison dépréciée mais l'autorise ; procède sur une combinaison prise en charge.

## Politique d'épinglage de version

### Images créées par SocTalk

Épinglées par digest dans `soctalk-tenant/values.yaml` :
```yaml
adapter:
  image:
    repository: ghcr.io/soctalk/soctalk-adapter
    digest: sha256:abc123...
```

### Sous-charts OSS en amont (Wazuh / linux-ep)

Conservés comme charts frères sous `charts/` (`charts/wazuh`, `charts/linux-ep`) et référencés par chemin relatif, non récupérés au moment de l'installation. `Chart.yaml` les liste comme dépendances locales, chacune conditionnée par sa condition de composant :

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

TheHive et Cortex ne sont **pas** des sous-charts vendus. Ce sont des intégrations externes configurées par tenant (voir /fr-fr/integrate/thehive et /fr-fr/integrate/cortex).

Raisons de la vendorisation (d'après l'audit des charts) :
- Appliquer les correctifs de SocTalk sans dépendre de l'acceptation en amont.
- Hash stable pour l'attestation de la chaîne d'approvisionnement (cosign dans une future version).
- Builds reproductibles.

## Flux rendu → application

Flux côté contrôleur lorsque `POST /api/mssp/tenants` arrive :

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

En cas d'échec à une étape quelconque :
- Nouvelle tentative idempotente : le contrôleur mémorise quelle étape s'est achevée (via `TenantLifecycleEvent`).
- Si `helm install` échoue, rollback via `helm uninstall` + `kubectl delete ns`.
- L'état du tenant reste `pending` avec les détails de l'erreur ; l'opérateur MSSP peut relancer depuis l'interface.

Sur `POST /api/mssp/tenants/:id:upgrade` (API d'une future version ; runbook) :
```
1. Check compatibility matrix.
2. helm upgrade soctalk-tenant -n tenant-<slug> --values <new-values.yaml>
3. Wait for rollout; on failure, helm rollback.
4. Emit TenantLifecycleEvent.
```

Sur `POST /api/mssp/tenants/:id:decommission` :
```
1. Mark tenant decommissioning; grace period starts.
2. Document how to retrieve tenant data before teardown (backup/restore runbook).
3. After grace period: helm uninstall, kubectl delete ns.
4. Soft-delete Tenant row with deleted_at timestamp.
5. Retention window: keep row in DB for compliance period.
6. Hard delete after retention.
```

## Publication des charts

### Distribution

- **(minimal)** : pousser en tant qu'artefacts OCI vers `ghcr.io/soctalk/charts/soctalk-system` et `/charts/soctalk-tenant` : pulls publics, non authentifiés.
- **une future version** : signé par cosign + SBOM attaché.

Le guide d'installation utilise :
```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
    --version v1.0.0 \
    --namespace soctalk-system --create-namespace \
    -f values.yaml
```

### Cadence de versionnage

- La version de `soctalk-system` est incrémentée à tout changement d'API, changement de schéma ou ajout de fonctionnalité.
- La version de `soctalk-tenant` est incrémentée à toute mise à niveau de sous-chart du plan de données ou changement de modèle de tenant.
- Une entrée dans la matrice de compatibilité est ajoutée pour chaque nouvelle combinaison ; les notes de version documentent les plages prises en charge.

## Tester le contrat

Une version ultérieure et des tests :

1. **Validation de values.schema.json** : `helm lint` + `helm template` avec des valeurs d'exemple : les deux charts.
2. **Rendu aller-retour** : SocTalk rend une configuration de tenant → valeurs → application → relecture depuis K8s → comparaison. Vérifie l'absence de dérive.
3. **Épinglage des sous-charts** : `Chart.lock` + les digests correspondent aux attentes ; la CI échoue en cas de dérive.
4. **Application de la matrice de compatibilité** : test unitaire pour `controller.can_upgrade(system=X, tenant=Y)` sur les combinaisons prises en charge / dépréciées / bloquées.
5. **Test de fumée de signature du bundle (une future version)** : `cosign verify` sur le chart publié.
