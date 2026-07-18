# Ingress de Agentes Wazuh e Enrollment de Certificados


## Problema

Cada tenant tem um Wazuh manager dedicado rodando no namespace `tenant-<slug>`. Os agentes Wazuh são instalados nos endpoints do cliente (fora do cluster do MSSP) e devem se conectar ao Wazuh manager **do seu tenant** em:

- **1514/TCP**: fluxo de eventos do agente (criptografado com o protocolo nativo do Wazuh sobre TLS)
- **1515/TCP**: enrollment do agente / `authd` (registro usando segredo compartilhado)

Restrições:

- Muitos tenants em um único cluster → não é possível expor 1514/1515 em um único NodePort (colisão de portas).
- Os agentes devem alcançar apenas o manager do *seu* tenant (não o de outro tenant).
- Os endpoints dos clientes estão em redes desconhecidas (LAN corporativa, VMs em nuvem, laptops): conectividade via internet pública na maioria dos casos.
- Os certificados TLS devem ser específicos por tenant (cadeia de confiança com escopo por cliente).

## Padrão escolhido: endereço por tenant na borda do MSSP

Cada tenant recebe um nome DNS dedicado (`acme.soc.mssp.example.com`) que resolve para um endpoint L4 por tenant na borda do MSSP. O roteamento para o Wazuh manager correto é feito pelo endereço de destino, não por inspeção de hostname.

**Por que não roteamento L4 baseado em SNI.** O protocolo de agente do Wazuh na 1514/TCP é um fluxo proprietário criptografado com AES, e não TLS padrão, portanto as conexões não carregam um ClientHello com SNI. Um proxy L4 que ramifica com base em `req.ssl_sni` não verá nenhum, e o tráfego do agente cairá no backend padrão. O canal de enrollment 1515/TCP de fato negocia TLS, mas o roteamento precisa usar o mesmo discriminador que a 1514, ou as duas portas divergem.

Duas implementações de endereçamento por tenant são suportadas:

1. **Service LoadBalancer por tenant (padrão recomendado; ainda não integrado no chart).** O subchart `wazuh` atual cria o `Service` do Wazuh manager apenas como `ClusterIP` — **não há provisionamento automático de LoadBalancer ou DNS** neste release. Para tornar um tenant roteável a partir da internet pública hoje, você deve: adicionar você mesmo uma camada de Service LoadBalancer externo (`kubectl apply` manual), colocar cada tenant atrás de um HAProxy / NGINX de borda com SNI por tenant ou mapeamento de portas, ou usar a topologia de porta por tenant descrita abaixo. LB em nuvem + DNS por tenant é o destino documentado; chegar lá exige integração manual no lado do MSSP.
2. **Porta por tenant em um único IP de borda (fallback).** Quando IPs únicos são escassos, aloque uma faixa de portas em um único IP de borda e atribua offsets `(1514, 1515)` por tenant (por exemplo, acme → 15140/15141, beta → 15142/15143). O DNS usa registros `SRV` ou a configuração `manager_address:port` do agente para direcionar. Operacionalmente incômodo, mas funciona.

### Topologia

```
Customer endpoint (Wazuh agent)
        │
        │ TCP 1514 to acme.soc.mssp.example.com
        │ (Wazuh agent protocol; not standard TLS)
        ▼
DNS resolves to the LoadBalancer IP for tenant-acme
        │
        ▼
┌───────────────────────────────────┐
│ MSSP cluster ingress for          │
│ tenant-acme/wazuh-manager         │
│ (cloud LB IP or MetalLB-assigned) │
└─────────────┬──────────────────────┘
              │ cluster-internal forward
              ▼
  tenant-acme namespace
  ┌─────────────────┐
  │ wazuh-manager   │
  │ Service: 1514   │
  │ Pod with        │
  │ tenant-specific │
  │ TLS cert (1515) │
  └─────────────────┘
```

### DNS

Registro `A`/`AAAA` por tenant: `<slug>.soc.mssp.example.com → <tenant LB IP>` é o design pretendido. **No V1, o SocTalk NÃO emite registros DNS** — o operador gerencia o DNS manualmente (external-dns / console do provedor) uma vez que o LB por tenant tenha sido provisionado fora de banda. Um caminho de emissão de DNS conduzido pelo SocTalk (anotações external-dns ou integração direta com o provedor) está no roadmap.

DNS curinga não funciona para o padrão LoadBalancer porque cada tenant tem seu próprio IP. Ele só funciona na topologia de fallback (porta por tenant), em que todos os nomes resolvem para o mesmo IP de borda.

### Certificados TLS

Cada tenant recebe um certificado cujo SAN cobre `<slug>.soc.mssp.example.com`. Opções:

- **Certificado por tenant via cert-manager + Let's Encrypt** (recomendado para MVP): CR `Certificate` do cert-manager por tenant, emitido por um `ClusterIssuer` DNS-01 ou HTTP-01: certificado armazenado no namespace `tenant-<slug>` como `Secret/wazuh-tls`: renovado automaticamente.
- **Certificado curinga para `*.soc.mssp.example.com`**: um único certificado cobre todos os tenants. Mais simples, mas significa que o Wazuh manager de qualquer tenant pode apresentar o certificado para o agente de qualquer tenant durante falhas do proxy no lado do MSSP: risco aceitável para este release, já que o roteamento é a aplicação real da política.
- **CA interna fornecida pelo MSSP**: para MSSPs que operam sua própria PKI, o cert-manager pode emitir a partir de um `Issuer` in-cluster respaldado pela CA do MSSP.

O guia de instalação documenta as três opções; o piloto usa por padrão Let's Encrypt por tenant.

### Provisionamento de LoadBalancer

O MSSP executa um dos seguintes:

| Ambiente | Origem do LoadBalancer |
|---|---|
| Nuvem gerenciada (EKS, GKE, AKS, …) | O controlador de load balancer da nuvem atribui um IP público por `Service` do tipo `LoadBalancer`. |
| Bare-metal ou on-prem | MetalLB (modo L2 ou BGP) com um pool de endereços, ou kube-vip. |
| Borda de IP único com mapeamento de portas | Execute um proxy L4 externo (HAProxy, Envoy, nginx-stream) que encaminha pares `(IP, port)` para o `Service` do tenant. Use isto apenas na topologia de fallback por porta. |

O design pretendido é que o `Service` do chart `soctalk-tenant` seja anotado para que os controladores de nuvem e o MetalLB possam aplicar seleção de pool/classe de IP (por exemplo, `metallb.universe.tf/address-pool: wazuh-agents`), e o controlador do SocTalk registre o IP de LB resultante e escreva o registro DNS por tenant. **No V1, nenhum destes está integrado** — o Service do Wazuh manager é apenas `ClusterIP` e o controlador não faz polling para atribuição de IP de LB.

Se você precisar usar um único IP de borda (fallback), um mapeamento HAProxy de referência é assim:

```
# Per-port routing — each tenant has its own 1514/1515 pair at the edge.
frontend wazuh-15140
    mode tcp
    bind *:15140
    default_backend tenant-acme-events
frontend wazuh-15141
    mode tcp
    bind *:15141
    default_backend tenant-acme-enroll
frontend wazuh-15142
    mode tcp
    bind *:15142
    default_backend tenant-beta-events

backend tenant-acme-events
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1514
backend tenant-acme-enroll
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1515
backend tenant-beta-events
    mode tcp
    server wazuh wazuh-manager.tenant-beta.svc.cluster.local:1514
```

Não ramifique com base em `req.ssl_sni` para a 1514 do Wazuh. O protocolo de agente do Wazuh não é TLS padrão e nunca produz um ClientHello ali. O SNI está disponível apenas na 1515 (enrollment), o que é insuficiente — os eventos ainda precisariam de um discriminador funcional.

## Fluxo de enrollment do agente

O registro do `authd` do Wazuh na 1515/TCP requer um segredo compartilhado. Cada tenant tem seu próprio segredo `authd`, armazenado em `Secret/wazuh-<slug>-wazuh-creds` (chave: `AUTHD_PASS`) no namespace do tenant. Enrollment:

1. O **operador do MSSP** faz o onboarding de um novo cliente. O SocTalk gera o segredo compartilhado `authd` no momento do provisionamento do tenant.
2. O **operador do MSSP** fornece ao administrador do endpoint do cliente:
   - Hostname do Wazuh manager do tenant (`acme.soc.mssp.example.com`)
   - Portas (1514 eventos, 1515 enrollment)
   - Segredo compartilhado `authd` (via canal seguro: plataforma de gerenciamento de segredos, e-mail criptografado, o que quer que o MSSP use)
   - Instalador do agente Wazuh (pacote upstream padrão)
3. O **administrador do endpoint do cliente** instala o agente Wazuh com o hostname e faz o enrollment:
   ```bash
   /var/ossec/bin/agent-auth \
       -m acme.soc.mssp.example.com \
       -P "<authd-shared-secret>"
   ```
4. O agente se registra com o manager do tenant e recebe seu próprio certificado por agente.
5. As conexões subsequentes na 1514 são mTLS por agente.

O roteamento na 1515 usa o mesmo endereço por tenant que a 1514 (IP de LB ou porta de borda). O segredo compartilhado `authd` tem escopo por tenant: um agente que usa o segredo do `acme` só pode se registrar com o manager do `acme` — o endereçamento aplica isso, e o segredo é verificado pelo manager.

## Requisitos de firewall / rede

Lado do MSSP:
- IPs públicos para o proxy de borda (um único IP, ou IPs por região para MSSPs com regiões geograficamente distribuídas).
- O proxy de borda permite entrada de 1514/TCP, 1515/TCP a partir de 0.0.0.0/0 (ou CIDRs específicos de clientes, se o MSSP preferir).
- O firewall interno ao cluster (faixa de NodePort ou CIDR interno) permite proxy de borda → Wazuh manager no namespace do tenant.

Lado do cliente:
- Os agentes permitem saída de 1514/1515/TCP para o hostname de borda do MSSP.
- Nenhuma entrada do MSSP para os endpoints do cliente (o Wazuh é sem pull: os eventos se originam no agente).

## Revogação de certificados / remoção de agentes

> **Status da UI:** a aba Agents por tenant descrita abaixo está planejada. Até que seja lançada, use o workaround no final desta seção.

Para revogar um agente específico (UX planejada):
1. O operador do MSSP abre o tenant na UI do MSSP → aba Agents → revoga.
2. O SocTalk chama a API do Wazuh manager para remover o registro do agente.
3. O administrador do endpoint do cliente desinstala o agente (opcional, limpeza).

**Hoje**, revogue diretamente pelo dashboard Wazuh embutido (lista de Tenants → **Open SOC** → Agents) ou via API do Wazuh manager:

```bash
kubectl -n tenant-<slug> exec deploy/wazuh-manager -- \
  /var/ossec/bin/manage_agents -r <agent-id>
```

Para revogar todos os agentes de um tenant (por exemplo, offboarding do cliente):
1. Rotacione o segredo compartilhado `authd` do tenant (re-enrollment necessário para novos agentes).
2. Exclua todos os registros de agentes existentes via API do Wazuh.
3. O descomissionamento do tenant eventualmente desmonta o manager.

## Padrões de conectividade alternativos (documentados, não construídos)

### VPN / túnel gerenciado pelo cliente

Se a política de rede de um cliente não permitir que os agentes enviem telemetria pela internet pública:
- O cliente provisiona um túnel WireGuard/IPsec para a rede privada do MSSP.
- O MSSP roteia o tráfego do túnel para o mesmo proxy de borda (ou diretamente para o cluster em endereços internos).
- A configuração do agente aponta para um hostname interno.

Não implementado no tooling deste release; documentado como um padrão de setup para MSSPs que precisem dele.

### Tailscale / rede overlay

Semelhante ao 6.1; o MSSP e o cliente entram em uma rede Tailscale, e o agente alcança `acme.soc.mssp.ts.net` diretamente. Bom para clientes pequenos; documentado.

### Borda de MSSP por região

Para MSSPs com separação geográfica (EU, US, APAC), execute múltiplos proxies de borda em diferentes regiões. Cada tenant é atribuído à sua região mais próxima e o DNS reflete isso (`acme.soc.eu.mssp.example.com`, `acme.soc.us.mssp.example.com`). O design suporta isso porque o roteamento do proxy de borda para o namespace do tenant é apenas uma resolução DNS interna ao cluster. O despacho multirregional automatizado está no roadmap.

## Runbook: onboarding do primeiro agente de um cliente

> **Status da UI:** o painel dedicado "Agent Onboarding" no detalhe do tenant está planejado, mas ainda não está no build atual. O runbook abaixo descreve a UX pretendida; o workaround logo abaixo dele é o caminho atual.

**UX planejada:**

1. O operador do MSSP cria o tenant na [UI do MSSP](/pt-br/mssp-ui) → o SocTalk provisiona a stack, gera o segredo `authd`.
2. O operador do MSSP navega até o detalhe do tenant → seção "Agent Onboarding".
3. A seção exibe:
   - Hostname do tenant: `acme.soc.mssp.example.com`
   - Portas: 1514/TCP (eventos), 1515/TCP (enrollment)
   - Segredo compartilhado `authd` (mascarado; copiar para a área de transferência + revelação única)
   - Comando `agent-auth` de exemplo
   - Requisitos de firewall
4. O operador do MSSP copia para um canal seguro e compartilha com o administrador do endpoint do cliente.
5. O administrador do endpoint do cliente instala + faz o enrollment.
6. O operador do MSSP observa o detalhe do tenant → aba Agents e vê o agente aparecer em ~30 segundos.

**Workaround atual:**

1. Crie o tenant a partir da [UI do MSSP](/pt-br/mssp-ui) → Tenants → **+ New Tenant**.
2. Assim que os eventos de ciclo de vida mostrarem `workloads_ready`, recupere o segredo compartilhado `authd` do Kubernetes:
   ```bash
   kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
     -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
   ```
3. Calcule o hostname do Wazuh manager do tenant a partir do padrão curinga da instalação (`<slug>.soc.<mssp-domain>`).
4. Compartilhe ambos com o administrador do endpoint do cliente via um canal seguro; ele executa `agent-auth` conforme mostrado acima.
5. Confirme que o agente aparece no dashboard Wazuh embutido (Tenants → **Open SOC** → Agents).

## Testes (pré-release + validação do piloto)

Validação pré-release:
- O template de `Service` por tenant é renderizado corretamente para ambos os valores de `tenant.wazuhIngress.mode` (`loadbalancer` e `edge-haproxy`).
- Emissão de certificado por tenant via cert-manager para o canal de enrollment do agente (1515).
- End-to-end no `k3d` com dois tenants, MetalLB fornecendo dois IPs de LB (modo `loadbalancer`): para cada tenant, execute `agent-auth -m <lb-ip> -P <secret>` a partir de um pod host e confirme que o agente aparece no Wazuh indexer daquele tenant e não no do outro.
- O mesmo end-to-end no modo `edge-haproxy`: o HAProxy renderiza um par `(IP, port-pair)` por tenant, os agentes fazem enrollment usando `-m <edge-ip> -p <tenant-port>` e o fluxo de eventos chega ao indexer correto.
- Negativo: um agente apontado para o endereço do tenant A com o segredo `authd` do tenant B é rejeitado pelo manager.

Validação do piloto (release posterior):
- Um endpoint real de cliente pela internet pública faz enrollment sem problemas.
- Sonda cross-tenant: faça enrollment de um agente `acme` com o segredo `authd` do `beta` contra o endereço do `beta` — espere rejeição. E vice-versa. Ambos falham.

Não há etapa de SNI em nenhuma dessas verificações: o protocolo de agente do Wazuh na 1514 não produz um ClientHello, portanto qualquer teste que "sobrescreve o SNI" está exercitando um caminho de roteamento que o ingress de produção não seguirá. Valide o discriminador de endereço/porta em vez disso.
