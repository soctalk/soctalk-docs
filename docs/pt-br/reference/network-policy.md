# Design de CNI + NetworkPolicy

> **Nota sobre a implantação V1.** Os templates de CiliumNetworkPolicy abaixo descrevem a **arquitetura-alvo** para isolamento leste-oeste e egress fixado por FQDN para LLMs por tenant. O chart V1 hoje renderiza políticas mais simples: um egress permissivo para o Deployment `soctalk-system-api` (o orquestrador está co-localizado nesse pod) e uma política `runs-worker-egress` em cada namespace `tenant-<slug>` que permite egress amplo em TCP/443 para o provedor de LLM (sem allowlist de FQDN por tenant). O ingress do Wazuh nas portas 1514/1515 **é** permitido a partir do namespace `ingress-system` nas políticas renderizadas. Leia o restante desta página como o destino de design; consulte [`charts/soctalk-system/templates/50-networkpolicy.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/50-networkpolicy.yaml) para o que é entregue atualmente.

## Decisão: Cilium como CNI primário

Cilium é o CNI suportado para o SocTalk. Justificativa:

1. **Aplicação de NetworkPolicy**. O Flannel padrão do K3s não aplica `NetworkPolicy`: sem aplicação, o isolamento de tenant na camada de rede é uma alegação sem sustentação. O Cilium aplica `NetworkPolicy` padrão prontamente.
2. **Políticas de egress por FQDN**: a `NetworkPolicy` padrão permite apenas egress baseado em IP/CIDR. Endpoints de BYO LLM são hostnames (`api.openai.com`, endpoints auto-hospedados pelo cliente atrás de CDNs com IPs dinâmicos). A `CiliumNetworkPolicy` do Cilium com `toFQDNs` faz correspondência de hostnames. Esta é a única forma de aplicar egress de LLM por tenant na camada de rede sem introduzir um proxy de encaminhamento.
3. **Aplicação baseada em eBPF**: maior desempenho, menor latência, sem inchaço de iptables.
4. **Observabilidade (Hubble)**: visibilidade em nível de fluxo; operacionalmente útil para depurar o isolamento de tenant.
5. **Maturidade**. CNCF Graduated, amplamente implantado em produção.

### Modo de instalação alternativo: Calico + proxy de egress

MSSPs com mandato operacional para executar Calico podem usá-lo com o seguinte ajuste:
- `NetworkPolicy` padrão do K8s (aplicada pelo Calico) para todo o tráfego leste-oeste e egress grosseiro.
- Um **proxy de egress** (Envoy, HAProxy ou Squid) no namespace `soctalk-system` que faz allowlisting baseado em FQDN.
- A `NetworkPolicy` restringe os pods de tenant e o orquestrador do SocTalk a egress **apenas através do proxy** para destinos externos (fora do cluster).

Esta alternativa está documentada, mas não é o caminho recomendado. Ela adiciona um componente, um ponto de falha e um recurso compartilhado entre tenants (o proxy). Se um MSSP a selecionar, o SocTalk a validará de ponta a ponta em seu cluster antes do onboarding.

## Requisitos de instalação

O Cilium é um **pré-requisito de cluster** (veja `/reference/chart-audit` §4). O chart `soctalk-system` não instala o Cilium. A seção de pré-requisitos do guia de instalação especifica:

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

O hook de pré-instalação do chart `soctalk-system` verifica se o Cilium está ativo e falha rapidamente caso não esteja.

## Arquitetura de NetworkPolicy

Baseline default-deny em todos os namespaces gerenciados pelo SocTalk. Regras de allow adicionadas explicitamente para cada fluxo legítimo.

### Fluxos que precisam funcionar

| Origem | Destino | Por quê |
|---|---|---|
| `soctalk-system` → `tenant-<slug>` (Wazuh :55000, indexer :9200) | Leste-oeste | Os subprocessos MCP do orquestrador do SocTalk chamam o data plane Wazuh do tenant |
| `soctalk-system` → endpoints externos de TheHive / Cortex | Egress | TheHive e Cortex são integrações externas alcançadas pela rede, não pods de tenant no namespace |
| `tenant-<slug>` (adaptador) → `soctalk-system` (SocTalk API :8000) | Leste-oeste | O adaptador reporta saúde e obtém configuração |
| `soctalk-system` → FQDN externo do LLM por tenant | Egress | Chamadas de LLM durante a triagem (usando a chave de LLM do tenant sob o contexto do worker) |
| Agentes Wazuh externos → gerenciador Wazuh do `tenant-<slug>` (:1514, :1515) | Ingress | Telemetria de endpoint do cliente |
| Usuários MSSP → `soctalk-system` (via Ingress :443) | Ingress | Acesso à UI do MSSP + UI do Cliente |
| Postgres do `soctalk-system` ↔ `soctalk-system` (ele mesmo) | Intra-ns | Componentes do SocTalk conversando com o BD |
| `soctalk-system` → provedor OIDC externo | Egress | OIDC em nível de ingress; flui via ns ingress-system |
| Pods de tenant intra-namespace (Wazuh manager↔indexer, agente↔manager, etc.) | Intra-ns | Operação normal da stack |

### Fluxos que precisam ser bloqueados (o default-deny captura estes)

- `tenant-acme` → `tenant-beta` (qualquer porta, qualquer protocolo)
- `tenant-<slug>` → internet (exceto seu FQDN de LLM configurado)
- `tenant-<slug>` → Postgres do `soctalk-system` diretamente (o adaptador usa a SocTalk API, não o BD)
- Qualquer namespace → `kube-system` além das consultas padrão de resolver
- Movimentação lateral entre clusters a partir de qualquer pod comprometido

## Templates de NetworkPolicy

### Políticas do namespace `soctalk-system`

Gerenciadas pelo chart `soctalk-system`. Quatro políticas:

**4.1.1 Default-deny para todo ingress/egress**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: soctalk-system }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.1.2 Permitir que a SocTalk API receba do controlador Ingress + adaptadores; egress para Postgres + DNS**

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

> Se a lógica do controlador rodar dentro do pod da API em vez de como um Deployment separado, incorpore a regra do kube-apiserver na política `api-egress` acima em vez de usar uma segunda política.

> O endereço do apiserver difere por cluster. Em clusters gerenciados, use o Service IP visível ao kubelet (`kubectl get svc kubernetes -n default`) e os endpoints subjacentes do control-plane. Com o Cilium, uma alternativa é `toEntities: [kube-apiserver]` em uma `CiliumNetworkPolicy`, que resolve a identidade do apiserver dinamicamente.

**4.1.3 Permitir que o orquestrador alcance os namespaces de tenant + DNS + FQDNs de LLM**

Esta é uma `CiliumNetworkPolicy` porque a NP padrão não consegue expressar egress por FQDN:

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

**4.1.4 Permitir Postgres apenas intra-ns**

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

### Egress por FQDN de LLM por tenant (dinâmico)

O controlador do SocTalk renderiza uma `CiliumNetworkPolicy` por tenant que permite orquestrador → o FQDN de LLM daquele tenant. Quando a config de LLM de um tenant muda, a política é atualizada; quando um tenant é descomissionado, a política é excluída.

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

O Cilium combina todas as políticas que selecionam os pods do orquestrador, de modo que a união de todos os FQDNs permitidos de cada tenant é alcançável a partir desses pods na camada de rede. **Não há isolamento de FQDN por tenant no nível da requisição**: isso é responsabilidade da aplicação (config de LLM por tenant, chaves de cache com escopo de tenant). A política de rede reduz o raio de impacto (a allow-list de hostnames de LLM como um todo, não egress arbitrário), mas por si só não restringe com qual tenant o orquestrador pode conversar.

### Políticas do namespace de tenant

Renderizadas pelo chart `soctalk-tenant` por tenant. Quatro políticas por namespace:

**4.3.1 Default-deny**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.3.2 Permitir intra-namespace + DNS de cluster**

Os pods do data-plane Wazuh resolvem uns aos outros via nomes DNS de Service do Kubernetes, portanto todo pod do data-plane precisa de egress para o `kube-dns`. O allow intra-ns sozinho não é suficiente; sem a regra do kube-dns, a stack não inicia.

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

**4.3.3 Permitir ingress a partir do soctalk-system (chamadas MCP do orquestrador)**

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

**4.3.4 Permitir que o adaptador faça egress para a API do soctalk-system**

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

**4.3.5 Permitir ingress de agente Wazuh para o gerenciador do tenant**

A telemetria de agente nas portas 1514/1515 chega pelo caminho documentado em [Ingress do Wazuh](/pt-br/reference/wazuh-ingress). A implantação de referência é um Service LoadBalancer por tenant (LB de nuvem ou MetalLB), com um Deployment HAProxy in-cluster em `soctalk-system` como fallback de IP único. A NetworkPolicy deve permitir qualquer que seja o caminho que a instalação realmente executa, o `ingress-system` **não** é a origem correta para nenhum deles, portanto não use o template padrão do chart sem editá-lo.

Escolha um bloco com base na instalação:

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

Quando o service usa `externalTrafficPolicy: Local`, o kube-proxy e o Cilium preservam o IP de origem do cliente, portanto os CIDRs do cliente acima são vistos literalmente e a política é significativa. Sob a política padrão (`Cluster`), a visibilidade do IP de origem depende da combinação de LB e CNI; nesse modo, trate esta NetworkPolicy como defesa em profundidade e apoie-se no LB/security group de nuvem como o portão primário.

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

O chart `soctalk-tenant` renderiza a variante que corresponde a `tenant.wazuhIngress.mode` (`loadbalancer` ou `edge-haproxy`).

## Considerações sobre DNS

- O Cilium deve ser configurado com o `hubble` habilitado para observar consultas DNS (útil para depurar correspondências de política de FQDN).
- As políticas `toFQDNs` funcionam interceptando respostas DNS e adicionando os IPs resolvidos a regras efêmeras. O TTL da resposta DNS governa a atualidade do cache da política; se um provedor de LLM tiver TTLs extremamente curtos (~60s), espere falhas de conexão breves e ocasionais na rotação de IP. Mitigação: o `dnsProxy` do Cilium pode ser ajustado para um `minTTL` mais longo: definir para 300s.
- DNS corporativo (LLM do cliente hospedado internamente): se o endpoint de LLM do tenant resolve apenas via um servidor DNS interno, o Cilium deve ser configurado para usar esse servidor, ou o tenant usa egress baseado em IP (perde a semântica de FQDN-como-intenção).

## Observabilidade

O Hubble (empacotado com o Cilium) é habilitado na instalação de referência. As equipes de ops do MSSP podem executar `hubble observe --namespace tenant-acme` para ver fluxos, vereditos de aplicação (allow/deny) e drops. Esta é a principal ferramenta de depuração para questões de isolamento de tenant.

## Testes

Um release gate posterior inclui um teste de isolamento de rede entre tenants:
1. Implante dois tenants (`tenant-a`, `tenant-b`).
2. A partir de um pod em `tenant-a`, tente conectar-se ao service Wazuh do `tenant-b` por IP e por nome DNS. Espere conexão recusada / timeout.
3. A partir do orquestrador em `soctalk-system`, tente chamar o FQDN de LLM do `tenant-a` enquanto opera no contexto do `tenant-b`. Espere recusa na camada de aplicação (sem chave); a camada de política ainda pode permitir, já que ambos os FQDNs estão na allow-list.
4. A partir de um pod em `soctalk-system` que não seja o orquestrador, tente alcançar o Wazuh do `tenant-a`. Espere conexão recusada (apenas o orquestrador tem egress para as portas do data plane do tenant).

## Adiado (releases futuras)

- **Políticas HTTP L7**: o Cilium suporta `CiliumNetworkPolicy` HTTP L7 (restringir a paths/métodos específicos). Esta release é apenas L4. L7 é útil para restrições mais finas de chamadas MCP em uma release futura.
- **Políticas baseadas em identidade**: apenas labels nesta release; identidade do Cilium com mTLS no estilo SPIFFE é uma release futura.
- **Egress gateway para IP de origem estático**: se os clientes finais do MSSP precisarem de um IP de origem estático em allowlist nas chamadas de LLM do SocTalk, o Cilium Egress Gateway lida com isso. Uma release futura.
- **Criptografia transparente (WireGuard/IPsec)**: criptografia de todo o cluster do tráfego pod-a-pod. Um hardening de release futura.
