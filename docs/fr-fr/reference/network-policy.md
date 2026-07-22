# Conception CNI + NetworkPolicy

> **Note de déploiement V1.** Les modèles CiliumNetworkPolicy ci-dessous décrivent l'**architecture cible** pour l'isolation est-ouest et l'egress épinglé par FQDN vers les LLM par tenant. Le chart V1 rend aujourd'hui des politiques plus simples : un egress permissif pour le Deployment `soctalk-system-api` (l'orchestrateur est co-localisé dans ce pod), et une politique `runs-worker-egress` dans chaque namespace `tenant-<slug>` qui autorise un large egress TCP/443 vers le fournisseur LLM (pas d'allowlist FQDN par tenant). L'ingress Wazuh sur 1514/1515 **est** autorisé depuis le namespace `ingress-system` dans les politiques rendues. Lisez le reste de cette page comme la destination de conception ; consultez [`charts/soctalk-system/templates/50-networkpolicy.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/50-networkpolicy.yaml) pour ce qui est livré actuellement.

## Décision : Cilium comme CNI principal

Cilium est le CNI pris en charge pour SocTalk. Justification :

1. **Application des NetworkPolicy**. Le Flannel par défaut de K3s n'applique pas les `NetworkPolicy` : sans application, l'isolation des tenants au niveau réseau est une affirmation sans fondement. Cilium applique les `NetworkPolicy` standard prêtes à l'emploi.
2. **Politiques d'egress par FQDN** : les `NetworkPolicy` standard n'autorisent que l'egress basé sur IP/CIDR. Les endpoints BYO LLM sont des noms d'hôte (`api.openai.com`, endpoints auto-hébergés par le client derrière des CDN avec des IP dynamiques). La `CiliumNetworkPolicy` de Cilium avec `toFQDNs` correspond aux noms d'hôte. C'est le seul moyen d'appliquer l'egress LLM par tenant au niveau réseau sans introduire de proxy direct.
3. **Application basée sur eBPF** : performances supérieures, latence plus faible, pas de surcharge iptables.
4. **Observabilité (Hubble)** : visibilité au niveau des flux ; utile en exploitation pour déboguer l'isolation des tenants.
5. **Maturité**. Diplômé de la CNCF, largement déployé en production.

### Mode d'installation alternatif : Calico + proxy d'egress

Les MSSP ayant un mandat opérationnel d'exécuter Calico peuvent l'utiliser avec l'ajustement suivant :
- `NetworkPolicy` K8s standard (appliquée par Calico) pour tout l'est-ouest et l'egress grossier.
- Un **proxy d'egress** (Envoy, HAProxy ou Squid) dans le namespace `soctalk-system` qui effectue l'allowlisting basé sur FQDN.
- La `NetworkPolicy` restreint les pods de tenant et l'orchestrateur SocTalk à l'egress **uniquement via le proxy** pour les destinations externes (hors cluster).

Cet alternatif est documenté mais n'est pas le chemin recommandé. Il ajoute un composant, un point de défaillance et une ressource partagée inter-tenants (le proxy). Si un MSSP le sélectionne, SocTalk le validera de bout en bout sur leur cluster avant l'onboarding.

## Prérequis d'installation

Cilium est un **prérequis de cluster** (voir `/reference/chart-audit` §4). Le chart `soctalk-system` n'installe pas Cilium. La section prérequis du guide d'installation spécifie :

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

Le hook de pré-installation du chart `soctalk-system` vérifie que Cilium est actif et échoue immédiatement dans le cas contraire.

## Architecture NetworkPolicy

Base de refus par défaut sur chaque namespace géré par SocTalk. Des règles d'autorisation sont ajoutées explicitement pour chaque flux légitime.

### Flux qui doivent fonctionner

| Source | Destination | Pourquoi |
|---|---|---|
| `soctalk-system` → `tenant-<slug>` (Wazuh :55000, indexeur :9200) | Est-ouest | Les sous-processus MCP de l'orchestrateur SocTalk appellent le plan de données Wazuh du tenant |
| `soctalk-system` → endpoints TheHive / Cortex externes | Egress | TheHive et Cortex sont des intégrations externes atteintes sur le réseau, pas des pods de tenant in-namespace |
| `tenant-<slug>` (adaptateur) → `soctalk-system` (API SocTalk :8000) | Est-ouest | L'adaptateur reporte son état de santé et récupère la configuration |
| `soctalk-system` → FQDN LLM externe par tenant | Egress | Appels LLM pendant le triage (utilisant la clé LLM du tenant dans le contexte worker) |
| Agents Wazuh externes → gestionnaire Wazuh `tenant-<slug>` (:1514, :1515) | Ingress | Télémétrie des endpoints clients |
| Utilisateurs MSSP → `soctalk-system` (via Ingress :443) | Ingress | Accès à l'UI MSSP + UI Client |
| Postgres `soctalk-system` ↔ `soctalk-system` (lui-même) | Intra-ns | Composants SocTalk communiquant avec la base de données |
| `soctalk-system` → fournisseur OIDC externe | Egress | OIDC au niveau ingress ; transite via le namespace ingress-system |
| Pods de tenant intra-namespace (manager Wazuh↔indexeur, agent↔manager, etc.) | Intra-ns | Fonctionnement normal de la stack |

### Flux qui doivent être bloqués (le refus par défaut les intercepte)

- `tenant-acme` → `tenant-beta` (tout port, tout protocole)
- `tenant-<slug>` → internet (autre que son FQDN LLM configuré)
- `tenant-<slug>` → Postgres `soctalk-system` directement (l'adaptateur utilise l'API SocTalk, pas la base de données)
- Tout namespace → `kube-system` au-delà des requêtes de résolveur standard
- Mouvement latéral inter-cluster depuis tout pod compromis

## Modèles NetworkPolicy

### Politiques du namespace `soctalk-system`

Gérées par le chart `soctalk-system`. Quatre politiques :

**4.1.1 Refus par défaut de tout ingress/egress**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: soctalk-system }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.1.2 Autoriser l'API SocTalk à recevoir du contrôleur Ingress + des adaptateurs ; egress vers Postgres + DNS**

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

> Si la logique du contrôleur s'exécute à l'intérieur du pod API plutôt que comme un Deployment séparé, intégrez la règle kube-apiserver dans la politique `api-egress` ci-dessus au lieu d'utiliser une seconde politique.

> L'adresse de l'apiserver diffère selon le cluster. Sur les clusters managés, utilisez l'IP de Service visible par le kubelet (`kubectl get svc kubernetes -n default`) et les endpoints sous-jacents du plan de contrôle. Avec Cilium, une alternative est `toEntities: [kube-apiserver]` dans une `CiliumNetworkPolicy`, qui résout dynamiquement l'identité de l'apiserver.

**4.1.3 Autoriser l'orchestrateur à atteindre les namespaces de tenant + DNS + FQDN LLM**

Il s'agit d'une `CiliumNetworkPolicy` car les NP classiques ne peuvent pas exprimer l'egress par FQDN :

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

**4.1.4 Autoriser Postgres en intra-ns uniquement**

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

### Egress FQDN LLM par tenant (dynamique)

Le contrôleur SocTalk rend une `CiliumNetworkPolicy` par tenant qui autorise orchestrateur → le FQDN LLM de ce tenant. Lorsque la config LLM d'un tenant change, la politique est mise à jour ; lorsqu'un tenant est décommissionné, la politique est supprimée.

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

Cilium combine toutes les politiques qui sélectionnent les pods de l'orchestrateur, de sorte que l'union de tous les FQDN autorisés de chaque tenant est joignable depuis ces pods au niveau réseau. **Il n'y a pas d'isolation FQDN par tenant au niveau de la requête**: c'est la responsabilité de l'application (config LLM par tenant, clés de cache à portée tenant). La politique réseau réduit le rayon d'impact (l'allow-list de noms d'hôte LLM dans son ensemble, et non un egress arbitraire), mais elle ne contraint pas à elle seule le tenant avec lequel l'orchestrateur peut communiquer.

### Politiques du namespace de tenant

Rendues par le chart `soctalk-tenant` par tenant. Quatre politiques par namespace :

**4.3.1 Refus par défaut**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.3.2 Autoriser l'intra-namespace + le DNS du cluster**

Les pods du plan de données Wazuh se résolvent mutuellement via les noms DNS de Service Kubernetes, donc chaque pod du plan de données a besoin d'un egress vers `kube-dns`. L'autorisation intra-ns seule ne suffit pas ; sans la règle kube-dns, la stack ne démarre pas.

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

**4.3.3 Autoriser l'ingress depuis soctalk-system (appels MCP de l'orchestrateur)**

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

**4.3.4 Autoriser l'adaptateur à faire de l'egress vers l'API soctalk-system**

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

**4.3.5 Autoriser l'ingress d'agent Wazuh vers le gestionnaire du tenant**

La télémétrie d'agent sur 1514/1515 arrive via le chemin documenté dans [Wazuh Ingress](/fr-fr/reference/wazuh-ingress). Le déploiement de référence est un Service LoadBalancer par tenant (LB cloud ou MetalLB), avec un Deployment HAProxy dans le cluster dans `soctalk-system` comme repli à IP unique. La NetworkPolicy doit autoriser celui de ces chemins que l'installation exécute réellement, `ingress-system` n'est **pas** la bonne source pour l'un ou l'autre, donc n'utilisez pas le modèle standard du chart sans le modifier.

Choisissez un bloc en fonction de l'installation :

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

Lorsque le service utilise `externalTrafficPolicy: Local`, kube-proxy et Cilium préservent l'IP source du client, de sorte que les CIDR clients ci-dessus sont vus tels quels et que la politique est significative. Sous la politique par défaut (`Cluster`), la visibilité de l'IP source dépend de la combinaison LB et CNI ; dans ce mode, considérez cette NetworkPolicy comme une défense en profondeur et appuyez-vous sur le groupe de sécurité LB/cloud comme portail principal.

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

Le chart `soctalk-tenant` rend la variante qui correspond à `tenant.wazuhIngress.mode` (`loadbalancer` ou `edge-haproxy`).

## Considérations DNS

- Cilium doit être configuré avec `hubble` activé pour observer les requêtes DNS (utile pour déboguer les correspondances de politique FQDN).
- Les politiques `toFQDNs` fonctionnent en interceptant les réponses DNS et en ajoutant les IP résolues à des règles éphémères. Le TTL de la réponse DNS gouverne la fraîcheur du cache de politique ; si un fournisseur LLM a des TTL extrêmement courts (~60 s), attendez-vous à des échecs de connexion brefs occasionnels lors de la rotation d'IP. Atténuation : le `dnsProxy` de Cilium peut être ajusté pour un `minTTL` plus long : réglé à 300 s.
- DNS d'entreprise (LLM client hébergé en interne) : si l'endpoint LLM du tenant ne se résout que via un serveur DNS interne, Cilium doit être configuré pour utiliser ce serveur, ou le tenant utilise l'egress basé sur IP (perd la sémantique de FQDN-d'intention).

## Observabilité

Hubble (fourni avec Cilium) est activé dans l'installation de référence. Les équipes d'exploitation MSSP peuvent exécuter `hubble observe --namespace tenant-acme` pour voir les flux, les verdicts d'application (autoriser/refuser) et les rejets. C'est le principal outil de débogage pour les questions d'isolation des tenants.

## Tests

Une porte de version ultérieure inclut un test d'isolation réseau inter-tenants :
1. Déployer deux tenants (`tenant-a`, `tenant-b`).
2. Depuis un pod dans `tenant-a`, tenter de se connecter au service Wazuh de `tenant-b` par IP et par nom DNS. Attendre un refus de connexion / timeout.
3. Depuis l'orchestrateur dans `soctalk-system`, tenter d'appeler le FQDN LLM de `tenant-a` tout en opérant dans le contexte de `tenant-b`. Attendre un refus au niveau applicatif (pas de clé) ; la couche de politique peut tout de même autoriser puisque les deux FQDN sont dans l'allow-list.
4. Depuis un pod dans `soctalk-system` qui n'est pas l'orchestrateur, tenter d'atteindre le Wazuh de `tenant-a`. Attendre un refus de connexion (seul l'orchestrateur dispose d'un egress vers les ports du plan de données du tenant).

## Reporté (versions futures)

- **Politiques HTTP L7** : Cilium prend en charge les `CiliumNetworkPolicy` HTTP L7 (restriction à des chemins/méthodes spécifiques). Cette version est L4 uniquement. L7 utile pour des restrictions plus fines des appels MCP dans une version future.
- **Politiques basées sur l'identité** : uniquement basées sur les labels dans cette version ; l'identité Cilium avec mTLS de style SPIFFE est une version future.
- **Passerelle d'egress pour IP source statique** : si les clients finaux MSSP ont besoin d'une IP source statique en liste blanche sur les appels LLM de SocTalk, la Cilium Egress Gateway s'en charge. Une version future.
- **Chiffrement transparent (WireGuard/IPsec)** : chiffrement à l'échelle du cluster du trafic pod-à-pod. Un durcissement de version future.
