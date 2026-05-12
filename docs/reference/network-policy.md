# CNI + NetworkPolicy Design


## Decision: Cilium as primary CNI

Cilium is the supported CNI for SocTalk. Rationale:

1. **NetworkPolicy enforcement**. K3s's default Flannel does not enforce `NetworkPolicy`: Without enforcement, tenant isolation at the network layer is a claim without backing. Cilium enforces standard `NetworkPolicy` out of the box.
2. **FQDN egress policies**: standard `NetworkPolicy` permits only IP/CIDR-based egress. BYO LLM endpoints are hostnames (`api.openai.com`, customer-self-hosted endpoints behind CDNs with dynamic IPs). Cilium's `CiliumNetworkPolicy` with `toFQDNs` matches hostnames. This is the only way to enforce per-tenant LLM egress at the network layer without introducing a forward proxy.
3. **eBPF-based enforcement**: higher performance, lower latency, no iptables bloat.
4. **Observability (Hubble)**: flow-level visibility; operationally useful for debugging tenant isolation.
5. **Maturity**. CNCF Graduated, widely deployed in production.

### Alternate install mode: Calico + egress proxy

MSSPs with an operational mandate to run Calico can use with the following adjustment:
- Standard K8s `NetworkPolicy` (Calico-enforced) for all east-west and coarse egress.
- An **egress proxy** (Envoy, HAProxy, or Squid) in `soctalk-system` namespace that does FQDN-based allowlisting.
- `NetworkPolicy` restricts tenant pods and SocTalk orchestrator to egress **only through the proxy** for external (non-cluster) destinations.

This alternate is documented but is not the recommended path. It adds one component, one failure point, and inter-tenant shared resource (the proxy). If an MSSP selects it, SocTalk's will validate it end-to-end on their cluster before onboarding.

## Install requirements

Cilium is a **cluster prerequisite** (see `/reference/chart-audit` §4). The `soctalk-system` chart does not install Cilium. The install guide's prerequisite section specifies:

```bash
# K3s without flannel, without default NP, and without kube-proxy
# (Cilium replaces it; running both rewrites Service translation twice
# and breaks routing).
curl -sfL https://get.k3s.io | sh -s - server \
    --flannel-backend=none \
    --disable-network-policy \
    --disable-kube-proxy \
    --disable=traefik  # if using a different ingress controller

# Install Cilium:
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium --version 1.15.x \
    --namespace kube-system \
    --set operator.replicas=1 \
    --set ipam.mode=kubernetes \
    --set kubeProxyReplacement=true \
    --set k8sServiceHost=<node-ip> \
    --set k8sServicePort=6443 \
    --set hubble.relay.enabled=true \
    --set hubble.ui.enabled=true
```

The `soctalk-system` chart's pre-install hook verifies Cilium is active and fails fast if not.

## NetworkPolicy architecture

Default-deny baseline on every namespace SocTalk manages. Allow rules added explicitly for each legitimate flow.

### Flows that must work

| Source | Destination | Why |
|---|---|---|
| `soctalk-system` → `tenant-<slug>` (e.g., Wazuh :55000, TheHive :9000, Cortex :9001) | East-west | SocTalk orchestrator's MCP subprocesses call tenant data plane APIs |
| `tenant-<slug>` (adapter) → `soctalk-system` (SocTalk API :8000) | East-west | Adapter reports health and pulls config |
| `soctalk-system` → external per-tenant LLM FQDN | Egress | LLM calls during triage (using tenant's LLM key under worker context) |
| External Wazuh agents → `tenant-<slug>` Wazuh manager (:1514, :1515) | Ingress | Customer endpoint telemetry |
| MSSP users → `soctalk-system` (via Ingress :443) | Ingress | MSSP UI + Customer UI access |
| `soctalk-system` Postgres ↔ `soctalk-system` (itself) | Intra-ns | SocTalk components talking to DB |
| `soctalk-system` → external OIDC provider | Egress | Ingress-level OIDC; flows via ingress-system ns |
| Tenant pods intra-namespace (manager↔indexer, TheHive↔Cassandra, etc.) | Intra-ns | Normal stack operation |

### Flows that must be blocked (default-deny catches these)

- `tenant-acme` → `tenant-beta` (any port, any protocol)
- `tenant-<slug>` → internet (other than its configured LLM FQDN)
- `tenant-<slug>` → `soctalk-system` Postgres directly (adapter uses SocTalk API, not DB)
- Any namespace → `kube-system` beyond standard resolver queries
- Cross-cluster lateral movement from any compromised pod

## NetworkPolicy templates

### `soctalk-system` namespace policies

Managed by `soctalk-system` chart. Four policies:

**4.1.1 Default-deny all ingress/egress**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: soctalk-system }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.1.2 Allow SocTalk API to receive from Ingress controller + adapters; egress to Postgres + DNS**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-ingress-allow, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: ingress-system }
      ports: [{ port: 8000, protocol: TCP }]
    - from:
        - namespaceSelector:
            matchLabels: { managed-by: soctalk, tenant: "true" }
      ports: [{ port: 8000, protocol: TCP }]
---
# Egress: API needs Postgres + cluster DNS. Without this rule the
# default-deny policy above blocks API → DB and the API CrashLoops.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-egress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      ports: [{ port: 5432, protocol: TCP }]
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
---
# Egress: controller pod creates tenant namespaces, Secrets, and Helm
# releases via the Kubernetes API. Without this rule, default-deny
# blocks the controller → kube-apiserver and tenant provisioning hangs.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: controller-egress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-controller } }
  policyTypes: [Egress]
  egress:
    # Cluster DNS
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
    # kube-apiserver. The ClusterIP of `kubernetes.default.svc` is the
    # apiserver VIP; use CIDR egress to that VIP plus the apiserver
    # node IPs (the Service IP is rewritten to a node IP by kube-proxy
    # or its Cilium replacement).
    - to:
        - ipBlock: { cidr: <apiserver-cidr-or-service-ip>/32 }
      ports:
        - { port: 443, protocol: TCP }
        - { port: 6443, protocol: TCP }
    # Postgres for state writes.
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      ports: [{ port: 5432, protocol: TCP }]
```

> If the controller logic runs inside the API pod rather than as a separate Deployment, fold the kube-apiserver rule into the `api-egress` policy above instead of using a second policy.

> The apiserver address differs per cluster. On managed clusters use the kubelet-visible Service IP (`kubectl get svc kubernetes -n default`) and the underlying control-plane endpoints. With Cilium, an alternative is `toEntities: [kube-apiserver]` in a `CiliumNetworkPolicy`, which resolves the apiserver identity dynamically.

**4.1.3 Allow orchestrator to reach tenant namespaces + DNS + LLM FQDNs**

This is a `CiliumNetworkPolicy` because vanilla NP can't express FQDN egress:

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: { name: orchestrator-egress, namespace: soctalk-system }
spec:
  endpointSelector:
    matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
  egress:
    # DNS
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace": kube-system
            "k8s:k8s-app": kube-dns
      toPorts:
        - ports: [{ port: "53", protocol: UDP }]
          rules:
            dns:
              - matchPattern: "*"
    # Tenant data plane APIs (any tenant-* namespace, specific ports)
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace-label:managed-by": soctalk
            "k8s:io.kubernetes.pod.namespace-label:tenant": "true"
      toPorts:
        - ports:
            - { port: "55000", protocol: TCP }  # Wazuh manager API
            - { port: "9200",  protocol: TCP }  # Wazuh indexer
            - { port: "9000",  protocol: TCP }  # TheHive
            - { port: "9001",  protocol: TCP }  # Cortex
    # Postgres (intra-ns)
    - toEndpoints:
        - matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      toPorts: [{ ports: [{ port: "5432", protocol: TCP }] }]
    # LLM endpoints. FQDN allow-list is composed dynamically
    # (see §4.2: one CiliumNetworkPolicy per tenant maintained by SocTalk controller)
```

**4.1.4 Allow Postgres intra-ns only**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: postgres-ingress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-postgres } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: {}  # any pod in soctalk-system
      ports: [{ port: 5432, protocol: TCP }]
```

### Per-tenant LLM FQDN egress (dynamic)

SocTalk controller renders a `CiliumNetworkPolicy` per tenant that allows orchestrator → that tenant's LLM FQDN. When a tenant's LLM config changes, the policy is updated; when a tenant is decommissioned, the policy is deleted.

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: orchestrator-llm-egress-tenant-acme
  namespace: soctalk-system
  labels:
    managed-by: soctalk
    tenant-id: "<acme-uuid>"
spec:
  endpointSelector:
    matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
  egress:
    - toFQDNs:
        - matchName: "api.openai.com"  # or tenant's configured endpoint
      toPorts: [{ ports: [{ port: "443", protocol: TCP }] }]
```

Cilium combines all policies that select the orchestrator pods, so the union of every tenant's allowed FQDNs is reachable from those pods at the network layer. **There is no per-tenant FQDN isolation at the request level** — that's the application's responsibility (per-tenant LLM config, tenant-scoped cache keys). The network policy reduces blast radius (the LLM hostname allow-list as a whole, not arbitrary egress), but it does not by itself constrain which tenant the orchestrator can talk to.

### Tenant namespace policies

Rendered by `soctalk-tenant` chart per tenant. Four policies per namespace:

**4.3.1 Default-deny**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.3.2 Allow intra-namespace + cluster DNS**

Wazuh, TheHive, and Cortex resolve each other via Kubernetes Service DNS names, so every data-plane pod needs egress to `kube-dns`. The intra-ns allow alone is not enough — without the kube-dns rule, the stack fails to start.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: intra-ns-allow, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from: [{ podSelector: {} }]
  egress:
    - to: [{ podSelector: {} }]
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
```

**4.3.3 Allow ingress from soctalk-system (orchestrator MCP calls)**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-from-soctalk-system, namespace: tenant-acme }
spec:
  podSelector:
    matchExpressions:
      - { key: app.kubernetes.io/name, operator: In,
          values: [wazuh-manager, wazuh-indexer, thehive, cortex] }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
      ports:
        - { port: 55000, protocol: TCP }
        - { port: 9200,  protocol: TCP }
        - { port: 9000,  protocol: TCP }
        - { port: 9001,  protocol: TCP }
```

**4.3.4 Allow adapter to egress soctalk-system API**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: adapter-egress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-adapter } }
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
      ports: [{ port: 8000, protocol: TCP }]
    # DNS
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ port: 53, protocol: UDP }]
```

**4.3.5 Allow Wazuh agent ingress to the tenant manager**

Agent telemetry on 1514/1515 arrives via the path documented in [Wazuh Ingress](/reference/wazuh-ingress). The reference deployment is a per-tenant LoadBalancer Service (cloud LB or MetalLB), with an in-cluster HAProxy Deployment in `soctalk-system` as the single-IP fallback. The NetworkPolicy must allow whichever of those paths the install actually runs — `ingress-system` is **not** the right source for either, so do not use the chart's stock template without editing it.

Pick one block based on the install:

```yaml
# Cloud-LB or MetalLB path. NetworkPolicy evaluates the packet source
# as either the original customer-endpoint IP or (when the service path
# SNATs) the node IP — NOT the LoadBalancer pool CIDR. So allowing the
# LB pool here does nothing useful.
#
# Use one of:
#   * the set of customer-network CIDRs the MSSP serves agents from
#     (recommended; tightens blast radius and is the policy's only
#     meaningful enforcement at this layer);
#   * the cluster node CIDR plus 0.0.0.0/0 if the service path SNATs
#     to node IPs and you accept open ingress on 1514/1515 (the LB
#     itself / cloud security groups are then the real control).
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: wazuh-agent-ingress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: wazuh-manager } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - ipBlock: { cidr: <customer-network-cidr> }
        # repeat for each customer the tenant serves; or 0.0.0.0/0 if
        # the LB / cloud SG handles source filtering.
      ports:
        - { port: 1514, protocol: TCP }
        - { port: 1515, protocol: TCP }
```

When the service uses `externalTrafficPolicy: Local`, kube-proxy and Cilium preserve the client source IP, so the customer CIDRs above are seen verbatim and the policy is meaningful. Under default (`Cluster`) policy, source-IP visibility depends on the LB and CNI combination; in that mode, treat this NetworkPolicy as defense in depth and lean on the LB/cloud security group as the primary gate.

```yaml
# In-cluster HAProxy fallback in soctalk-system. Source is the
# HAProxy pod in the SocTalk control plane, not the ingress
# controller namespace.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: wazuh-agent-ingress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: wazuh-manager } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector:
            matchLabels: { app.kubernetes.io/name: wazuh-edge-haproxy }
      ports:
        - { port: 1514, protocol: TCP }
        - { port: 1515, protocol: TCP }
```

The `soctalk-tenant` chart renders whichever variant matches `tenant.wazuhIngress.mode` (`loadbalancer` or `edge-haproxy`).

## DNS considerations

- Cilium must be configured with `hubble` enabled to observe DNS queries (useful for debugging FQDN policy matches).
- `toFQDNs` policies work by intercepting DNS responses and adding resolved IPs to ephemeral rules. TTL of the DNS response governs policy cache freshness; if an LLM provider has extremely short TTLs (~60s), expect occasional brief connection failures on IP rotation. Mitigation: Cilium's `dnsProxy` can be tuned for longer `minTTL`: set to 300s.
- Corporate DNS (customer-LLM-hosted internally): if the tenant's LLM endpoint resolves only via an internal DNS server, Cilium must be configured to use that server, or the tenant uses IP-based egress (loses FQDN-of-intent semantics).

## Observability

Hubble (bundled with Cilium) is enabled in the reference install. MSSP ops teams can run `hubble observe --namespace tenant-acme` to see flows, enforcement verdicts (allow/deny), and drops. This is the primary debugging tool for tenant isolation questions.

## Testing

A later release gate includes a cross-tenant network isolation test:
1. Deploy two tenants (`tenant-a`, `tenant-b`).
2. From a pod in `tenant-a`, attempt to connect to `tenant-b`'s Wazuh service by IP and by DNS name. Expect connection refused / timeout.
3. From the orchestrator in `soctalk-system`, attempt to call `tenant-a`'s LLM FQDN while operating in `tenant-b` context. Expect application-layer refusal (no key); policy layer may still permit since both FQDNs are in allow-list.
4. From a pod in `soctalk-system` that isn't the orchestrator, attempt to reach `tenant-a`'s Wazuh. Expect connection refused (only orchestrator has egress to tenant data plane ports).

## Deferred (future releases)

- **L7 HTTP policies**: Cilium supports L7 HTTP `CiliumNetworkPolicy` (restrict to specific paths/methods). This release is L4 only. L7 useful for finer MCP call restrictions in a future release.
- **Identity-based policies**: labels-only in this release; Cilium identity with SPIFFE-style mTLS is a future release.
- **Egress gateway for static source IP**: if MSSP end-customers need whitelisted static source IP on SocTalk's LLM calls, Cilium Egress Gateway handles it. a future release.
- **Transparent encryption (WireGuard/IPsec)**: cluster-wide encryption of pod-to-pod traffic. a future release hardening.
