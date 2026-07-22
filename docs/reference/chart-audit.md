# Tenant Helm Chart Audit


> **Audit methodology**: this document captures the expected classification based on chart inspection. Actual `helm template` runs and diff-vs-classification are required in pre-release validation. Any object found in a real render that isn't listed here becomes a review gate.

## Scope of audit

Charts to audit:

| Upstream | Upstream source | Target version |
|---|---|---|
| Wazuh | `wazuh/wazuh-kubernetes` Helm chart (community) or official OCI chart | Latest stable 4.x supporting single-manager HA |
| linux-ep | SocTalk L2 endpoint-agent subchart (component key `components.linuxep`) | `0.2.0` |
| MISP | **deferred a future release** | |

The `soctalk-tenant` chart vendors exactly two subcharts, `wazuh` and `linux-ep`. For each we vendor the manifest templates (with patches if needed) as subchart dependencies of `charts/soctalk-tenant/`: Version pinning is strict. `Chart.yaml` uses exact semver with digest (OCI) where available.

TheHive and Cortex are **external integrations**, reached over the network and configured per tenant (see /integrate/thehive and /integrate/cortex). They are not vendored subcharts, so they are out of scope for this chart audit.

## Classification rules

For every rendered object, classify as:

- **NS-OK**: namespace-scoped object that lives inside `tenant-<slug>`. Safe, expected.
- **CLUSTER-PREREQ**: cluster-scoped object that must be installed once by the `soctalk-system` chart or documented as MSSP cluster-admin responsibility. Tenant chart must not re-install these per tenant.
- **FORBIDDEN**: object type or capability we refuse to allow in a tenant chart even when upstream declares it (e.g., cluster-wide `ClusterRoleBinding` giving Wazuh privileged access). Must be patched out.
- **PATCH**: keep the object but modify it (e.g., drop `hostPath` volumes, remove privileged `securityContext`, reduce default resource requests).

## Expected classification per upstream chart

### Wazuh

Wazuh charts typically render:

| Object | Expected class | Notes |
|---|---|---|
| `Deployment` / `StatefulSet` (manager, indexer, dashboard) | NS-OK | Core stack pods |
| `Service` (manager API, indexer, dashboard, agent ingress 1514/1515) | NS-OK | |
| `ConfigMap` (ossec.conf, indexer.yml, dashboard.yml) | NS-OK | |
| `Secret` (admin pw, mutual TLS certs) | NS-OK | Seeded per-tenant at provisioning |
| `PersistentVolumeClaim` (indexer data, manager data) | NS-OK | Size set via tenant values |
| `ServiceAccount` | NS-OK | Per-tenant SA |
| `Role` + `RoleBinding` (for leader election if used) | NS-OK | Namespace-scoped only |
| `NetworkPolicy` (chart-provided) | PATCH | Replace with SocTalk-rendered NP for consistent posture; don't allow upstream defaults to override default-deny |
| `StorageClass` references | CLUSTER-PREREQ | MSSP must provide a dynamic provisioner; `storageClassName` is a values input |
| `Ingress` | PATCH or disable | Wazuh's agent protocol on 1514 is not standard TLS, so HTTP/HTTPS `Ingress` is not appropriate. Strip any `Ingress` resources. For the agent-ingress `Service`, the chart should render the variant matching `tenant.wazuhIngress.mode`: a `LoadBalancer` Service for per-tenant LB IPs (default) or a `ClusterIP` Service when the install uses the in-cluster HAProxy fallback. See [Wazuh Ingress](/reference/wazuh-ingress). |
| `PodSecurityPolicy` / `SecurityContextConstraints` | CLUSTER-PREREQ if present; forbidden otherwise | PSP is deprecated; if present, remove. OpenShift SCC is not in scope for this release |
| `CustomResourceDefinition` | **FORBIDDEN** in tenant chart | If the chart tries to install a CRD, move to `soctalk-system` chart or document as prerequisite |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** in tenant chart | Never install cluster-wide RBAC from a tenant namespace |
| Privileged/host-network/hostPath pods | **FORBIDDEN**; patch out | Wazuh manager doesn't require these for standard operation; indexer doesn't either. If a subchart demands `hostPath` for logs, patch to `emptyDir` + PVC |
| `PodDisruptionBudget` | NS-OK | Optional; depends on Wazuh HA mode. Single-manager topology may skip |

**Expected patches**:
1. Remove any `ClusterRole`/`ClusterRoleBinding` from rendered output.
2. Remove any cluster-scoped resources (`ValidatingWebhookConfiguration`, etc.).
3. Render the agent-ingress `Service` to match `tenant.wazuhIngress.mode` (`LoadBalancer` for per-tenant LB IPs, `ClusterIP` for the in-cluster HAProxy fallback).
4. Strip `Ingress` resources. Wazuh dashboards are exposed via a separate SocTalk-managed path; the agent protocol on 1514 is not HTTP, so K8s `Ingress` does not apply.
5. Ensure all pods have `securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }`; patch if upstream sets otherwise.
6. Pin images to digests, not `latest`.

### linux-ep

The L2 endpoint-agent subchart (`components.linuxep`). Its rendered inventory is narrow: the chart emits a single `StatefulSet` and consumes an existing Secret by `secretKeyRef` rather than rendering its own credential objects.

| Object | Expected class | Notes |
|---|---|---|
| `StatefulSet` (endpoint agent) | NS-OK | The only workload the subchart renders; namespace-scoped |
| `Secret` (enrollment / agent credentials) | Consumed, not rendered | Referenced via `secretKeyRef`; seeded per-tenant at provisioning, outside this subchart |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** in tenant chart | Never install cluster-wide RBAC from a tenant namespace |

**Current state and expected patches**:
1. The subchart default sets `securityContext.privileged: true` on the agent pod. This is PoC-only behavior and a real risk, it must be scoped down (drop privileged, `allowPrivilegeEscalation: false`) before any production use.
2. Confirm no `ClusterRole`/`ClusterRoleBinding` appears in rendered output.
3. Pin images to digests, not `latest`.

### External integrations (out of audit scope)

TheHive and Cortex are **external integrations**, not vendored subcharts, so they are out of scope for this chart audit. SocTalk reaches them over the network per tenant; there are no in-namespace TheHive/Cortex objects to classify. Configure them via /integrate/thehive and /integrate/cortex.

## Cluster prerequisites list (rolled into install guide + `soctalk-system` chart prereq check)

Following the audit, these are **out-of-scope for the tenant chart** and must exist in the cluster before `soctalk-tenant` is applied to any namespace:

| Prerequisite | Why | source |
|---|---|---|
| K3s 1.30+ (or compatible K8s 1.30+) | Baseline plus `ValidatingAdmissionPolicy` v1 | MSSP responsibility |
| NP-enforcing CNI (Cilium primary, Calico alternate) | Isolation enforcement | MSSP responsibility |
| cert-manager | TLS for Ingress, per-tenant Wazuh cert issuance | MSSP responsibility; install guide provides `helm install` recipe |
| Ingress controller (Traefik default in K3s, ingress-nginx common) | MSSP UI + Customer UI + per-tenant WebUI routing | MSSP responsibility |
| Dynamic `StorageClass` (local-path, longhorn, cloud-provider CSI, etc.) | PVC provisioning | MSSP responsibility |
| `VolumeSnapshotClass` if using CSI snapshots | Backup/restore runbook (docs only) | Optional |

The `soctalk-system` chart includes a pre-install hook (`helm.sh/hook: pre-install`) that verifies:
- NP-enforcing CNI active (probes for Cilium or Calico markers)
- cert-manager CRDs present
- Default `StorageClass` set

Hook fails fast with actionable error message if any are missing.

## Patching strategy

Two paths:

1. **Values-driven overrides**: prefer upstream chart values that disable the unwanted object (e.g., `ingress.enabled: false`, `networkPolicy.enabled: false` if upstream's is looser than ours, `rbac.create: true` scoped to namespace only).
2. **Kustomize-style overlay** (Helm's `kustomize` integration or post-render hook) for objects that can't be disabled via values: strip `ClusterRole`s, remove `hostPath` volumes, set `securityContext`.

We vendor upstream charts as sibling charts under `charts/` (`charts/wazuh`, `charts/linux-ep`) referenced by relative path, not as `helm repo` references (helm copies them into the package at build time). This lets us:
- Pin to exact versions (no upstream surprise updates)
- Apply patches as needed without depending on upstream PR acceptance
- Sign our bundle as a single artifact (a future release when cosign lands)

If upstream doesn't meet our needs after patches, the fallback is to write SocTalk-native templates that call the same container images with our own manifests. pre-release validation decides this per chart.

## Known unknowns (pre-release validation resolves)

Items that require actual `helm template` runs + inspection to confirm:

- [ ] **Wazuh**: does the chosen chart version require CRDs for operator-driven deployment? If yes, move CRDs to `soctalk-system` chart.
- [ ] **linux-ep**: does the endpoint agent require host-level access (hostPath, host network) that must be patched out or scoped down?
- [ ] **All charts**: any `Job` or `CronJob` that runs with `ServiceAccount` beyond the namespace? Patch to ns-local SA.
- [ ] **All charts**: any `initContainer` with `privileged: true` or `hostPath` mounts? Patch or replace.
- [ ] **All charts**: default `resources.requests` and `limits`: Compare to sizing sizing profile; override in values where needed.

Each open item becomes a pre-release validation checklist entry. The spike's output is a filled-in classification table and the patched chart maintained under `charts/wazuh` / `charts/linux-ep`.

## Output artifact (produced before shipping)

The spike produces:

1. **Classified object inventory** (filling in section 3 tables with actual rendered objects).
2. **Patched chart bundles** maintained under `charts/wazuh/` and `charts/linux-ep/` with pinned versions.
3. **Cluster prerequisites list** merged into install guide.
4. **Values schema fragment** for each subchart (inputs SocTalk will provide per-tenant).

The spike's completion is a prerequisite for Helm chart implementation.

