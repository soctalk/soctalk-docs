# Progettazione di CNI + NetworkPolicy

> **Nota sul deployment V1.** I template CiliumNetworkPolicy riportati di seguito descrivono l'**architettura di destinazione** per l'isolamento est-ovest e l'egress verso gli LLM per-tenant vincolato tramite FQDN. Il chart V1 oggi genera policy più semplici: un egress permissivo per il Deployment `soctalk-system-api` (l'orchestratore è co-locato in quel pod) e una policy `runs-worker-egress` in ogni namespace `tenant-<slug>` che consente un ampio egress TCP/443 verso il provider LLM (nessuna allowlist FQDN per-tenant). L'ingress di Wazuh su 1514/1515 **è** consentito dal namespace `ingress-system` nelle policy generate. Leggi il resto di questa pagina come la destinazione progettuale; consulta [`charts/soctalk-system/templates/50-networkpolicy.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/50-networkpolicy.yaml) per ciò che viene attualmente rilasciato.

## Decisione: Cilium come CNI primario

Cilium è il CNI supportato per SocTalk. Motivazioni:

1. **Enforcement di NetworkPolicy**. Il Flannel predefinito di K3s non applica `NetworkPolicy`: senza enforcement, l'isolamento dei tenant a livello di rete è un'affermazione priva di garanzie. Cilium applica le `NetworkPolicy` standard out of the box.
2. **Policy di egress basate su FQDN**: le `NetworkPolicy` standard consentono solo egress basato su IP/CIDR. Gli endpoint BYO LLM sono hostname (`api.openai.com`, endpoint self-hosted del cliente dietro CDN con IP dinamici). La `CiliumNetworkPolicy` di Cilium con `toFQDNs` fa il match sugli hostname. Questo è l'unico modo per applicare l'egress LLM per-tenant a livello di rete senza introdurre un forward proxy.
3. **Enforcement basato su eBPF**: prestazioni più elevate, latenza inferiore, nessun sovraccarico di iptables.
4. **Osservabilità (Hubble)**: visibilità a livello di flusso; operativamente utile per il debug dell'isolamento dei tenant.
5. **Maturità**. CNCF Graduated, ampiamente distribuito in produzione.

### Modalità di installazione alternativa: Calico + egress proxy

Gli MSSP con un mandato operativo di eseguire Calico possono utilizzarlo con la seguente modifica:
- `NetworkPolicy` K8s standard (applicata da Calico) per tutto l'est-ovest e l'egress a grana grossa.
- Un **egress proxy** (Envoy, HAProxy o Squid) nel namespace `soctalk-system` che effettua l'allowlisting basato su FQDN.
- La `NetworkPolicy` limita i pod dei tenant e l'orchestratore SocTalk all'egress **solo attraverso il proxy** per le destinazioni esterne (non del cluster).

Questa alternativa è documentata ma non è il percorso raccomandato. Aggiunge un componente, un punto di guasto e una risorsa condivisa inter-tenant (il proxy). Se un MSSP la seleziona, SocTalk la validerà end-to-end sul loro cluster prima dell'onboarding.

## Requisiti di installazione

Cilium è un **prerequisito del cluster** (vedi `/reference/chart-audit` §4). Il chart `soctalk-system` non installa Cilium. La sezione dei prerequisiti della guida all'installazione specifica:

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

L'hook pre-install del chart `soctalk-system` verifica che Cilium sia attivo e fallisce rapidamente in caso contrario.

## Architettura di NetworkPolicy

Baseline default-deny su ogni namespace gestito da SocTalk. Le regole di allow vengono aggiunte esplicitamente per ogni flusso legittimo.

### Flussi che devono funzionare

| Sorgente | Destinazione | Perché |
|---|---|---|
| `soctalk-system` → `tenant-<slug>` (es., Wazuh :55000, TheHive :9000, Cortex :9001) | Est-ovest | I sottoprocessi MCP dell'orchestratore SocTalk chiamano le API del data plane del tenant |
| `tenant-<slug>` (adapter) → `soctalk-system` (SocTalk API :8000) | Est-ovest | L'adapter riporta lo stato di salute e recupera la configurazione |
| `soctalk-system` → FQDN LLM esterno per-tenant | Egress | Chiamate LLM durante il triage (usando la chiave LLM del tenant nel contesto del worker) |
| Agenti Wazuh esterni → Wazuh manager di `tenant-<slug>` (:1514, :1515) | Ingress | Telemetria degli endpoint del cliente |
| Utenti MSSP → `soctalk-system` (via Ingress :443) | Ingress | Accesso alla UI MSSP + UI del cliente |
| Postgres di `soctalk-system` ↔ `soctalk-system` (se stesso) | Intra-ns | Componenti SocTalk che comunicano con il DB |
| `soctalk-system` → provider OIDC esterno | Egress | OIDC a livello di ingress; il flusso passa dal namespace ingress-system |
| Pod dei tenant intra-namespace (manager↔indexer, TheHive↔Cassandra, ecc.) | Intra-ns | Normale funzionamento dello stack |

### Flussi che devono essere bloccati (il default-deny li intercetta)

- `tenant-acme` → `tenant-beta` (qualsiasi porta, qualsiasi protocollo)
- `tenant-<slug>` → internet (diverso dall'FQDN LLM configurato)
- `tenant-<slug>` → Postgres di `soctalk-system` direttamente (l'adapter usa la SocTalk API, non il DB)
- Qualsiasi namespace → `kube-system` oltre le query standard del resolver
- Movimento laterale cross-cluster da qualsiasi pod compromesso

## Template di NetworkPolicy

### Policy del namespace `soctalk-system`

Gestite dal chart `soctalk-system`. Quattro policy:

**4.1.1 Default-deny per tutto l'ingress/egress**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: soctalk-system }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.1.2 Consenti alla SocTalk API di ricevere dal controller Ingress + adapter; egress verso Postgres + DNS**

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

> Se la logica del controller viene eseguita all'interno del pod API anziché come Deployment separato, incorpora la regola kube-apiserver nella policy `api-egress` sopra invece di usare una seconda policy.

> L'indirizzo dell'apiserver differisce da cluster a cluster. Sui cluster gestiti usa il Service IP visibile al kubelet (`kubectl get svc kubernetes -n default`) e gli endpoint del control plane sottostanti. Con Cilium, un'alternativa è `toEntities: [kube-apiserver]` in una `CiliumNetworkPolicy`, che risolve dinamicamente l'identità dell'apiserver.

**4.1.3 Consenti all'orchestratore di raggiungere i namespace dei tenant + DNS + FQDN LLM**

Questa è una `CiliumNetworkPolicy` perché la NP standard non può esprimere l'egress FQDN:

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

**4.1.4 Consenti Postgres solo intra-ns**

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

### Egress FQDN LLM per-tenant (dinamico)

Il controller SocTalk genera una `CiliumNetworkPolicy` per tenant che consente orchestratore → FQDN LLM di quel tenant. Quando la configurazione LLM di un tenant cambia, la policy viene aggiornata; quando un tenant viene dismesso, la policy viene eliminata.

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

Cilium combina tutte le policy che selezionano i pod dell'orchestratore, quindi l'unione di tutti gli FQDN consentiti di ogni tenant è raggiungibile da quei pod a livello di rete. **Non esiste alcun isolamento FQDN per-tenant a livello di richiesta** — questa è responsabilità dell'applicazione (configurazione LLM per-tenant, chiavi di cache con scope per tenant). La policy di rete riduce il raggio d'impatto (l'allow-list degli hostname LLM nel suo complesso, non un egress arbitrario), ma di per sé non vincola con quale tenant l'orchestratore può comunicare.

### Policy del namespace del tenant

Generate dal chart `soctalk-tenant` per ciascun tenant. Quattro policy per namespace:

**4.3.1 Default-deny**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.3.2 Consenti intra-namespace + DNS del cluster**

Wazuh, TheHive e Cortex si risolvono reciprocamente tramite i nomi DNS dei Service Kubernetes, quindi ogni pod del data plane necessita di egress verso `kube-dns`. Il solo allow intra-ns non è sufficiente — senza la regola kube-dns, lo stack non riesce ad avviarsi.

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

**4.3.3 Consenti ingress da soctalk-system (chiamate MCP dell'orchestratore)**

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

**4.3.4 Consenti all'adapter l'egress verso la API di soctalk-system**

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

**4.3.5 Consenti l'ingress dell'agente Wazuh verso il manager del tenant**

La telemetria dell'agente su 1514/1515 arriva tramite il percorso documentato in [Wazuh Ingress](/it-it/reference/wazuh-ingress). Il deployment di riferimento è un Service LoadBalancer per-tenant (LB cloud o MetalLB), con un Deployment HAProxy in-cluster in `soctalk-system` come fallback a IP singolo. La NetworkPolicy deve consentire qualunque di quei percorsi l'installazione effettivamente esegua — `ingress-system` **non** è la sorgente corretta per nessuno dei due, quindi non usare il template stock del chart senza modificarlo.

Scegli un blocco in base all'installazione:

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

Quando il Service usa `externalTrafficPolicy: Local`, kube-proxy e Cilium preservano l'IP sorgente del client, quindi i CIDR del cliente indicati sopra vengono visti alla lettera e la policy è significativa. Con la policy predefinita (`Cluster`), la visibilità dell'IP sorgente dipende dalla combinazione di LB e CNI; in quella modalità, tratta questa NetworkPolicy come difesa in profondità e affidati al security group dell'LB/cloud come gate primario.

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

Il chart `soctalk-tenant` genera la variante che corrisponde a `tenant.wazuhIngress.mode` (`loadbalancer` o `edge-haproxy`).

## Considerazioni sul DNS

- Cilium deve essere configurato con `hubble` abilitato per osservare le query DNS (utile per il debug dei match delle policy FQDN).
- Le policy `toFQDNs` funzionano intercettando le risposte DNS e aggiungendo gli IP risolti a regole effimere. Il TTL della risposta DNS governa la freschezza della cache della policy; se un provider LLM ha TTL estremamente brevi (~60s), aspettati occasionali brevi fallimenti di connessione durante la rotazione degli IP. Mitigazione: il `dnsProxy` di Cilium può essere regolato per un `minTTL` più lungo: impostato a 300s.
- DNS aziendale (LLM del cliente ospitato internamente): se l'endpoint LLM del tenant si risolve solo tramite un server DNS interno, Cilium deve essere configurato per usare quel server, oppure il tenant usa egress basato su IP (perdendo la semantica di FQDN-of-intent).

## Osservabilità

Hubble (incluso con Cilium) è abilitato nell'installazione di riferimento. I team ops MSSP possono eseguire `hubble observe --namespace tenant-acme` per vedere i flussi, i verdetti di enforcement (allow/deny) e i drop. Questo è il principale strumento di debug per le questioni di isolamento dei tenant.

## Testing

Un successivo gate di rilascio include un test di isolamento di rete cross-tenant:
1. Distribuisci due tenant (`tenant-a`, `tenant-b`).
2. Da un pod in `tenant-a`, prova a connetterti al Service Wazuh di `tenant-b` tramite IP e tramite nome DNS. Attendi connessione rifiutata / timeout.
3. Dall'orchestratore in `soctalk-system`, prova a chiamare l'FQDN LLM di `tenant-a` mentre operi nel contesto di `tenant-b`. Attendi un rifiuto a livello applicativo (nessuna chiave); il livello di policy potrebbe comunque permetterlo poiché entrambi gli FQDN sono nell'allow-list.
4. Da un pod in `soctalk-system` che non sia l'orchestratore, prova a raggiungere il Wazuh di `tenant-a`. Attendi connessione rifiutata (solo l'orchestratore ha egress verso le porte del data plane dei tenant).

## Rimandato (release future)

- **Policy L7 HTTP**: Cilium supporta `CiliumNetworkPolicy` L7 HTTP (restrizione a percorsi/metodi specifici). Questa release è solo L4. L7 è utile per restrizioni più fini delle chiamate MCP in una release futura.
- **Policy basate su identità**: solo label in questa release; l'identità Cilium con mTLS in stile SPIFFE è una release futura.
- **Egress gateway per IP sorgente statico**: se gli utenti finali MSSP necessitano di un IP sorgente statico in whitelist sulle chiamate LLM di SocTalk, il Cilium Egress Gateway lo gestisce. Una release futura.
- **Cifratura trasparente (WireGuard/IPsec)**: cifratura a livello di cluster del traffico pod-to-pod. Un hardening di una release futura.
