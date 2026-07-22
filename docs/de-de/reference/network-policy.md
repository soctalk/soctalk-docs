# CNI + NetworkPolicy-Design

> **Hinweis zur V1-Bereitstellung.** Die nachstehenden CiliumNetworkPolicy-Templates beschreiben die **Zielarchitektur** für Ost-West-Isolation und FQDN-fixierten Egress zu mandantenspezifischen LLMs. Das V1-Chart rendert heute einfachere Policies: einen permissiven Egress für das `soctalk-system-api`-Deployment (der Orchestrator ist in diesem Pod mit untergebracht) sowie eine `runs-worker-egress`-Policy in jedem `tenant-<slug>`-Namespace, die breiten TCP/443-Egress zum LLM-Anbieter erlaubt (keine mandantenspezifische FQDN-Allowlist). Wazuh-Ingress auf 1514/1515 **ist** in den gerenderten Policies aus dem `ingress-system`-Namespace erlaubt. Lies den Rest dieser Seite als Designziel; konsultiere [`charts/soctalk-system/templates/50-networkpolicy.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/50-networkpolicy.yaml) für den aktuell ausgelieferten Stand.

## Entscheidung: Cilium als primäres CNI

Cilium ist das unterstützte CNI für SocTalk. Begründung:

1. **NetworkPolicy-Durchsetzung**. Das Standard-Flannel von K3s setzt `NetworkPolicy` nicht durch: Ohne Durchsetzung ist Mandantenisolation auf Netzwerkebene eine Behauptung ohne Deckung. Cilium setzt Standard-`NetworkPolicy` von Haus aus durch.
2. **FQDN-Egress-Policies**: Standard-`NetworkPolicy` erlaubt nur IP-/CIDR-basierten Egress. BYO-LLM-Endpunkte sind Hostnamen (`api.openai.com`, kundenseitig selbst gehostete Endpunkte hinter CDNs mit dynamischen IPs). Ciliums `CiliumNetworkPolicy` mit `toFQDNs` gleicht Hostnamen ab. Dies ist die einzige Möglichkeit, mandantenspezifischen LLM-Egress auf Netzwerkebene durchzusetzen, ohne einen Forward-Proxy einzuführen.
3. **eBPF-basierte Durchsetzung**: höhere Performance, geringere Latenz, kein iptables-Ballast.
4. **Observability (Hubble)**: Sichtbarkeit auf Flow-Ebene; operativ nützlich für das Debugging der Mandantenisolation.
5. **Reife**. CNCF Graduated, breit in Produktion im Einsatz.

### Alternativer Installationsmodus: Calico + Egress-Proxy

MSSPs mit einem betrieblichen Auftrag, Calico zu betreiben, können dies mit folgender Anpassung nutzen:
- Standard-K8s-`NetworkPolicy` (Calico-durchgesetzt) für sämtlichen Ost-West-Verkehr und groben Egress.
- Ein **Egress-Proxy** (Envoy, HAProxy oder Squid) im `soctalk-system`-Namespace, der FQDN-basiertes Allowlisting durchführt.
- `NetworkPolicy` beschränkt Mandanten-Pods und den SocTalk-Orchestrator darauf, für externe (clusterfremde) Ziele Egress **nur über den Proxy** zu betreiben.

Diese Alternative ist dokumentiert, ist aber nicht der empfohlene Weg. Sie fügt eine Komponente, einen Ausfallpunkt und eine mandantenübergreifend gemeinsam genutzte Ressource (den Proxy) hinzu. Wenn ein MSSP sie wählt, validiert SocTalk sie vor dem Onboarding end-to-end auf dessen Cluster.

## Installationsvoraussetzungen

Cilium ist eine **Cluster-Voraussetzung** (siehe `/reference/chart-audit` §4). Das `soctalk-system`-Chart installiert Cilium nicht. Der Abschnitt zu den Voraussetzungen im Installationsleitfaden legt fest:

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

Der Pre-Install-Hook des `soctalk-system`-Charts prüft, ob Cilium aktiv ist, und schlägt andernfalls sofort fehl.

## NetworkPolicy-Architektur

Default-Deny-Baseline auf jedem Namespace, den SocTalk verwaltet. Allow-Regeln werden für jeden legitimen Flow explizit hinzugefügt.

### Flows, die funktionieren müssen

| Quelle | Ziel | Warum |
|---|---|---|
| `soctalk-system` → `tenant-<slug>` (Wazuh :55000, Indexer :9200) | Ost-West | Die MCP-Subprozesse des SocTalk-Orchestrators rufen die Wazuh-Data-Plane des Mandanten auf |
| `soctalk-system` → externe TheHive-/Cortex-Endpunkte | Egress | TheHive und Cortex sind externe Integrationen, über das Netzwerk erreicht, keine In-Namespace-Mandanten-Pods |
| `tenant-<slug>` (Adapter) → `soctalk-system` (SocTalk-API :8000) | Ost-West | Der Adapter meldet Zustand und ruft Konfiguration ab |
| `soctalk-system` → externer mandantenspezifischer LLM-FQDN | Egress | LLM-Aufrufe während der Triage (mit dem LLM-Schlüssel des Mandanten im Worker-Kontext) |
| Externe Wazuh-Agents → `tenant-<slug>` Wazuh-Manager (:1514, :1515) | Ingress | Telemetrie von Kunden-Endpunkten |
| MSSP-Benutzer → `soctalk-system` (über Ingress :443) | Ingress | Zugriff auf MSSP-UI + Kunden-UI |
| `soctalk-system` Postgres ↔ `soctalk-system` (selbst) | Intra-ns | SocTalk-Komponenten kommunizieren mit der DB |
| `soctalk-system` → externer OIDC-Anbieter | Egress | OIDC auf Ingress-Ebene; fließt über den ingress-system-ns |
| Mandanten-Pods intra-namespace (Wazuh-Manager↔Indexer, Agent↔Manager usw.) | Intra-ns | Normaler Stack-Betrieb |

### Flows, die blockiert werden müssen (Default-Deny fängt diese ab)

- `tenant-acme` → `tenant-beta` (beliebiger Port, beliebiges Protokoll)
- `tenant-<slug>` → Internet (außer dem konfigurierten LLM-FQDN)
- `tenant-<slug>` → `soctalk-system` Postgres direkt (der Adapter nutzt die SocTalk-API, nicht die DB)
- Beliebiger Namespace → `kube-system` über Standard-Resolver-Abfragen hinaus
- Cluster-übergreifende laterale Bewegung von jedem kompromittierten Pod

## NetworkPolicy-Templates

### Policies im `soctalk-system`-Namespace

Verwaltet vom `soctalk-system`-Chart. Vier Policies:

**4.1.1 Default-Deny für gesamten Ingress/Egress**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: soctalk-system }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.1.2 SocTalk-API erlauben, vom Ingress-Controller + Adaptern zu empfangen; Egress zu Postgres + DNS**

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

> Wenn die Controller-Logik innerhalb des API-Pods statt als eigenständiges Deployment läuft, integriere die kube-apiserver-Regel in die obige `api-egress`-Policy, anstatt eine zweite Policy zu verwenden.

> Die apiserver-Adresse unterscheidet sich je Cluster. Verwende auf Managed Clusters die kubelet-sichtbare Service-IP (`kubectl get svc kubernetes -n default`) und die zugrunde liegenden Control-Plane-Endpunkte. Mit Cilium ist `toEntities: [kube-apiserver]` in einer `CiliumNetworkPolicy` eine Alternative, die die apiserver-Identität dynamisch auflöst.

**4.1.3 Orchestrator erlauben, Mandanten-Namespaces + DNS + LLM-FQDNs zu erreichen**

Dies ist eine `CiliumNetworkPolicy`, weil Vanilla-NP FQDN-Egress nicht ausdrücken kann:

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
    # TheHive and Cortex are external integrations, not in-namespace tenant
    # pods, so orchestrator reaches them via network egress (per-tenant
    # FQDN/endpoint), not through this tenant-namespace selector.
    # Postgres (intra-ns)
    - toEndpoints:
        - matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      toPorts: [{ ports: [{ port: "5432", protocol: TCP }] }]
    # LLM endpoints. FQDN allow-list is composed dynamically
    # (see §4.2: one CiliumNetworkPolicy per tenant maintained by SocTalk controller)
```

**4.1.4 Postgres nur intra-ns erlauben**

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

### Mandantenspezifischer LLM-FQDN-Egress (dynamisch)

Der SocTalk-Controller rendert pro Mandant eine `CiliumNetworkPolicy`, die Orchestrator → LLM-FQDN dieses Mandanten erlaubt. Wenn sich die LLM-Konfiguration eines Mandanten ändert, wird die Policy aktualisiert; wenn ein Mandant außer Betrieb genommen wird, wird die Policy gelöscht.

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

Cilium kombiniert alle Policies, die die Orchestrator-Pods selektieren, sodass die Vereinigung der erlaubten FQDNs jedes Mandanten von diesen Pods auf Netzwerkebene erreichbar ist. **Es gibt keine mandantenspezifische FQDN-Isolation auf Request-Ebene** — das ist Aufgabe der Anwendung (mandantenspezifische LLM-Konfiguration, mandantengebundene Cache-Schlüssel). Die Netzwerk-Policy verkleinert den Explosionsradius (die LLM-Hostname-Allowlist als Ganzes, nicht beliebiger Egress), schränkt aber für sich genommen nicht ein, mit welchem Mandanten der Orchestrator sprechen kann.

### Policies im Mandanten-Namespace

Vom `soctalk-tenant`-Chart pro Mandant gerendert. Vier Policies pro Namespace:

**4.3.1 Default-Deny**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.3.2 Intra-Namespace + Cluster-DNS erlauben**

Die Wazuh-Data-Plane-Pods lösen einander über Kubernetes-Service-DNS-Namen auf, sodass jeder Data-Plane-Pod Egress zu `kube-dns` benötigt. Die Intra-ns-Erlaubnis allein genügt nicht; ohne die kube-dns-Regel startet der Stack nicht.

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

**4.3.3 Ingress von soctalk-system erlauben (Orchestrator-MCP-Aufrufe)**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-from-soctalk-system, namespace: tenant-acme }
spec:
  podSelector:
    matchExpressions:
      # `wazuh` covers the wazuh subchart's manager/indexer/dashboard.
      # `thehive`/`cortex` are inert forward-compat placeholders: TheHive
      # and Cortex are external integrations today, so these selectors and
      # the 9000/9001 ports below match no in-namespace pods. They stay in
      # the rendered policy so a future in-namespace dep needs no NP change.
      - { key: app.kubernetes.io/name, operator: In,
          values: [wazuh, thehive, cortex] }
      - { key: app.kubernetes.io/component, operator: In,
          values: [manager, indexer, dashboard, thehive, cortex] }
  policyTypes: [Ingress]
  ingress:
    # Ingress from BOTH the orchestrator (verdict / runs-worker path) and
    # the API pod (the chat agent's per-tenant Wazuh routing lands on the
    # API process, not the orchestrator).
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector:
            matchExpressions:
              - { key: app.kubernetes.io/component, operator: In,
                  values: [orchestrator, api] }
      ports:
        - { port: 55000, protocol: TCP }  # Wazuh manager API
        - { port: 9200,  protocol: TCP }  # Wazuh indexer
        - { port: 9000,  protocol: TCP }  # TheHive (inert placeholder)
        - { port: 9001,  protocol: TCP }  # Cortex (inert placeholder)
```

**4.3.4 Adapter erlauben, Egress zur soctalk-system-API zu betreiben**

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

**4.3.5 Wazuh-Agent-Ingress zum Mandanten-Manager erlauben**

Agent-Telemetrie auf 1514/1515 trifft über den in [Wazuh Ingress](/de-de/reference/wazuh-ingress) dokumentierten Pfad ein. Die Referenzbereitstellung ist ein mandantenspezifischer LoadBalancer-Service (Cloud-LB oder MetalLB) mit einem clusterinternen HAProxy-Deployment in `soctalk-system` als Single-IP-Fallback. Die NetworkPolicy muss denjenigen dieser Pfade erlauben, den die Installation tatsächlich betreibt — `ingress-system` ist für keinen von beiden die richtige Quelle, verwende das Stock-Template des Charts also nicht ohne Bearbeitung.

Wähle je nach Installation einen Block:

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

Wenn der Service `externalTrafficPolicy: Local` verwendet, bewahren kube-proxy und Cilium die Quell-IP des Clients, sodass die obigen Kunden-CIDRs unverändert gesehen werden und die Policy aussagekräftig ist. Unter der Standard-Policy (`Cluster`) hängt die Sichtbarkeit der Quell-IP von der Kombination aus LB und CNI ab; behandle diese NetworkPolicy in diesem Modus als Defense-in-Depth und verlasse dich auf die LB-/Cloud-Security-Group als primäres Gate.

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

Das `soctalk-tenant`-Chart rendert die Variante, die zu `tenant.wazuhIngress.mode` passt (`loadbalancer` oder `edge-haproxy`).

## DNS-Überlegungen

- Cilium muss mit aktiviertem `hubble` konfiguriert werden, um DNS-Abfragen zu beobachten (nützlich für das Debugging von FQDN-Policy-Matches).
- `toFQDNs`-Policies funktionieren, indem sie DNS-Antworten abfangen und die aufgelösten IPs zu kurzlebigen Regeln hinzufügen. Die TTL der DNS-Antwort bestimmt die Aktualität des Policy-Caches; wenn ein LLM-Anbieter extrem kurze TTLs hat (~60s), sind gelegentliche kurze Verbindungsfehler bei IP-Rotation zu erwarten. Abhilfe: Ciliums `dnsProxy` kann auf eine längere `minTTL` eingestellt werden: auf 300s setzen.
- Unternehmens-DNS (kundenintern gehostetes LLM): Wenn der LLM-Endpunkt des Mandanten nur über einen internen DNS-Server auflösbar ist, muss Cilium so konfiguriert werden, dass es diesen Server nutzt, oder der Mandant verwendet IP-basierten Egress (verliert die FQDN-of-Intent-Semantik).

## Observability

Hubble (mit Cilium gebündelt) ist in der Referenzinstallation aktiviert. MSSP-Ops-Teams können `hubble observe --namespace tenant-acme` ausführen, um Flows, Durchsetzungsverdikte (allow/deny) und Drops zu sehen. Dies ist das primäre Debugging-Werkzeug für Fragen der Mandantenisolation.

## Testen

Ein späteres Release-Gate umfasst einen Test der mandantenübergreifenden Netzwerkisolation:
1. Zwei Mandanten bereitstellen (`tenant-a`, `tenant-b`).
2. Von einem Pod in `tenant-a` aus versuchen, den Wazuh-Service von `tenant-b` per IP und per DNS-Namen zu erreichen. Erwartet: Connection Refused / Timeout.
3. Vom Orchestrator in `soctalk-system` aus versuchen, den LLM-FQDN von `tenant-a` aufzurufen, während im Kontext von `tenant-b` operiert wird. Erwartet: Ablehnung auf Anwendungsebene (kein Schlüssel); die Policy-Ebene kann weiterhin erlauben, da beide FQDNs in der Allowlist stehen.
4. Von einem Pod in `soctalk-system`, der nicht der Orchestrator ist, aus versuchen, das Wazuh von `tenant-a` zu erreichen. Erwartet: Connection Refused (nur der Orchestrator hat Egress zu den Data-Plane-Ports der Mandanten).

## Zurückgestellt (künftige Releases)

- **L7-HTTP-Policies**: Cilium unterstützt L7-HTTP-`CiliumNetworkPolicy` (Beschränkung auf bestimmte Pfade/Methoden). Dieses Release ist ausschließlich L4. L7 ist nützlich für feinere MCP-Aufrufbeschränkungen in einem künftigen Release.
- **Identitätsbasierte Policies**: in diesem Release ausschließlich Labels; Cilium-Identität mit SPIFFE-artigem mTLS ist ein künftiges Release.
- **Egress-Gateway für statische Quell-IP**: Wenn MSSP-Endkunden eine per Whitelist zugelassene statische Quell-IP für SocTalks LLM-Aufrufe benötigen, übernimmt das Cilium Egress Gateway dies. Ein künftiges Release.
- **Transparente Verschlüsselung (WireGuard/IPsec)**: clusterweite Verschlüsselung des Pod-zu-Pod-Verkehrs. Eine Härtung in einem künftigen Release.
