---
title: "Wazuh multi-tenant para MSSPs: padrões de arquitetura que realmente isolam tenants"
description: "Como operar Wazuh multi-tenant como MSSP: manager por tenant no Kubernetes, RLS no Postgres, isolamento de rede, registro de agentes e dimensionamento por tenant."
---

# Wazuh multi-tenant para MSSPs: padrões de arquitetura que realmente isolam tenants

O Wazuh não tem multi-tenancy de primeira classe. Não existe um objeto "tenant" no manager, nenhuma fronteira por cliente no ruleset e nenhum escopo por cliente no registro via `authd`. Todo MSSP que padroniza no Wazuh acaba construindo a tenancy em volta dele, e o padrão que você escolhe determina suas garantias de isolamento, sua velocidade de onboarding e seu piso de custo por cliente.

Este guia cobre o que um MSSP precisa de uma implantação Wazuh multi-tenant, os três padrões que as equipes tentam na prática e o que o isolamento de nível de produção exige além do próprio SIEM. É a arquitetura que o SocTalk implementa como open source (Apache 2.0); as páginas de referência vinculadas ao longo do texto aprofundam cada camada.

## O que um MSSP precisa e o Wazuh não oferece

Três requisitos aparecem em toda conversa sobre implantação em MSSPs:

1. **Isolamento que você consegue defender em uma revisão de segurança do cliente.** Um filtro de dashboard sozinho não convence ninguém; "o cliente A não pode ler os alertas do cliente B" precisa valer na camada de dados, na camada de rede e na camada de registro de agentes.
2. **Velocidade de onboarding.** Se provisionar o SOC de um novo cliente leva uma semana de trabalho manual, o padrão não escala além de um punhado de clientes.
3. **Controle de custo por tenant.** Você precisa saber quanto um cliente custa em RAM, CPU e disco, limitar esse custo e impedir que um tenant ruidoso sufoque os demais.

## Os três padrões que os MSSPs tentam

### Padrão 1: manager compartilhado, separação em nível de índice

Um único manager Wazuh, agentes de todos os clientes registrados nele, e a separação feita a jusante: multi-tenancy do OpenSearch Dashboards para objetos de dashboard, index patterns e security roles para escopo de leitura. Este é o padrão que a maioria das discussões sobre multi-tenancy no Wazuh descreve, porque é o único que você consegue montar sem sair do ferramental do próprio Wazuh.

O problema é que a separação acontece no momento da leitura e não traça nenhuma fronteira em volta dos dados. O manager em si é compartilhado: um ruleset, um segredo `authd`, uma API, uma janela de upgrade para todo mundo. Uma role mal configurada expõe todos os clientes de uma vez, e pacotes de regras ou políticas de retenção por cliente são impossíveis sem afetar os demais.

### Padrão 2: manager por tenant em VMs

Uma VM (ou conjunto de VMs) por cliente, rodando um manager e um indexer dedicados. O isolamento é real: processos, discos e credenciais separados. É onde os MSSPs param depois que o padrão de manager compartilhado os castiga. O custo é operacional: onboarding significa provisionar máquinas, upgrades significam tocar cada VM, e o piso de recursos por tenant é uma VM inteira, sem agendamento compartilhado para recuperar capacidade ociosa. Funciona com 5 clientes e dói com 30.

### Padrão 3: manager por tenant no Kubernetes, atrás de um control plane

Cada cliente recebe um manager, um indexer e um dashboard Wazuh dedicados em seu próprio namespace do Kubernetes, com ResourceQuota e LimitRange limitando sua pegada. Um control plane é dono do ciclo de vida: o onboarding renderiza um release Helm por tenant, o desmonte o remove, e o estado do tenant vive em um banco de dados em vez de uma planilha. O isolamento vem da fronteira de namespace mais NetworkPolicy; a densidade vem do scheduler empacotando tenants em nós compartilhados.

### Como os padrões se comparam

| | Manager compartilhado + separação por índice | Manager por tenant em VMs | Manager por tenant no Kubernetes |
|---|---|---|---|
| Fronteira de isolamento | Filtros de leitura sobre dados compartilhados | Fronteira de máquina | Namespace + NetworkPolicy + quota |
| Raio de impacto de um comprometimento | Todos os clientes | Um cliente | Um cliente |
| Regras / retenção / upgrades por tenant | Não | Sim | Sim |
| Onboarding de um cliente | Rápido (mudança de config) | Lento (provisionar máquinas) | Rápido, se automatizado (release Helm) |
| Densidade / custo por tenant | Melhor | Pior | Bom (empacotado pelo scheduler, limitado por quota) |
| Habilidade operacional exigida | Wazuh + segurança do OpenSearch | Automação de frota/VM | Kubernetes |
| Operações de frota com 30+ tenants | N/A (uma pilha só) | Doloroso | Tratável com um control plane |

Dos três, o padrão 3 é o único construído para entregar isolamento real e velocidade de onboarding ao mesmo tempo, mas só se o control plane existir. Namespaces sozinhos equivalem a uma convenção de nomes; uma fronteira de segurança precisa ser construída em cima deles. O resto deste guia trata do que torna essa fronteira real.

## Isolamento de produção é mais do que o SIEM

Uma pilha Wazuh por tenant isola os dados do SIEM. Uma plataforma de MSSP também tem estado cross-tenant, de casos e filas de revisão a logs de auditoria e configurações de integração, e essa camada precisa da sua própria aplicação de regras.

### Camada de dados: row-level security do Postgres, forçada e testada

Com filtragem `WHERE tenant_id = ?` no nível da aplicação, uma cláusula esquecida vaza dados entre tenants. O banco de dados deve impor a tenancy por conta própria. O padrão:

- Toda tabela com escopo de tenant carrega políticas de RLS baseadas em uma configuração `app.current_tenant_id` por transação. Um contexto não definido retorna **zero linhas**; o modo de falha é um resultado vazio, nunca os dados de outro tenant.
- `FORCE ROW LEVEL SECURITY` em toda tabela com escopo de tenant, para que até o dono da tabela (a role de migração) esteja sujeito à política. Por padrão o Postgres isenta os donos; uma migração que lê dados de tenant poderia cruzar tenants em silêncio.
- Uma divisão em três roles: um dono de migração, uma role de runtime sujeita a RLS e uma role `BYPASSRLS` segregada, reservada para caminhos cross-tenant auditados. Nenhuma aplicação conecta como superusuário.
- Testes de isolamento no CI: sondas de endpoint, SQL cru sob a role da aplicação, workers sem contexto, sondas com a role de dono, streams de eventos cross-tenant. O SocTalk roda sete testes desses, todos obrigatórios; nenhum opcional.
- Chaves de idempotência com escopo `UNIQUE (tenant_id, idempotency_key)`, para que os pipelines de alerta de dois clientes possam emitir o mesmo ID de alerta externo sem colidir.

Templates completos de política, DDL das roles e a suíte de testes: [Postgres RLS](/pt-br/reference/postgres-rls).

### Camada de rede: NetworkPolicy por namespace

A fronteira de namespace não significa nada sem um CNI que a imponha; o Flannel padrão do K3s não impõe NetworkPolicy de forma alguma. A postura-alvo é uma linha de base default-deny por namespace de tenant com liberações explícitas: tráfego intra-namespace, DNS, acesso do control plane às portas do data plane do tenant e ingress de agentes em 1514/1515. Tráfego de tenant para tenant e egress geral do tenant ficam bloqueados.

O SocTalk usa Cilium como o CNI suportado (imposição de NetworkPolicy, egress baseado em FQDN para endpoints de LLM endereçados por hostname, observabilidade de fluxos com Hubble para depurar questões de isolamento). Fique atento à ressalva da V1: a allowlist de egress por tenant totalmente fixada por FQDN é o destino do design, e o chart atual renderiza políticas mais simples, com egress permissivo no control plane e egress TCP/443 amplo para o worker por tenant. Os templates renderizados estão no repositório; leia [Design de NetworkPolicy](/pt-br/reference/network-policy) para ver tanto as políticas entregues quanto a arquitetura-alvo.

### Registro de agentes: endpoints e segredos por tenant

O modo de falha mais sutil: o agente do cliente A se registrando no manager do cliente B. O protocolo de agente do Wazuh em 1514/TCP é um stream criptografado proprietário, não TLS padrão. Não há SNI para rotear, então proxies L4 que inspecionam hostname quebram silenciosamente. O roteamento precisa ser por endereço de destino: cada tenant recebe seu próprio nome DNS (`acme.soc.mssp.example.com`) resolvendo para um endpoint L4 por tenant, com um fallback de porta por tenant quando IPs são escassos.

Os segredos de registro têm escopo de tenant: o segredo compartilhado `authd` de cada tenant vive no namespace daquele tenant, então um agente que possui o segredo do tenant A só consegue se registrar no manager de A: o endereçamento o roteia para lá e o manager verifica o segredo. Na V1, o provisionamento de LoadBalancer e DNS é fiação manual do MSSP, não automatizada. Detalhes e o runbook de registro: [Ingress de agentes Wazuh](/pt-br/reference/wazuh-ingress).

## Capacidade: quanto custa um tenant

Os números que os MSSPs pedem primeiro, a partir do trabalho de dimensionamento do SocTalk:

- **Pegada por tenant (pilha completa):** ~8 GB de request de RAM (~16 GB de limit), ~2,2 vCPU de request, ~120 GB de disco. O uso sustentado acompanha os requests; os limits são tetos de burst.
- **O gargalo costuma ser o indexer Wazuh por tenant.** Cada um é um processo Java com heap próprio. Planeje ~6 a 8 GB de RAM e ~1,5 vCPU por tenant de produção.
- **O disco é ditado pela taxa de ingestão:** cerca de 5 GB/dia de índice a 10 alertas/s sustentados; o PVC padrão do indexer é de 50 GB com retenção quente de 30 dias.
- **Escala testada:** até ~50 tenants em um cluster de 3 nós (16 vCPU / 64 GB por nó). Perfis maiores de instalação única estão documentados mas não foram validados nesta release; não planeje além desse número em uma única instalação sem testar.

Perfis de host de referência e a fórmula de máximo de tenants por nó: [Dimensionamento](/pt-br/reference/sizing) e a [FAQ de escala](/pt-br/faq#does-it-scale-to-n-customers).

## Como o SocTalk empacota esse padrão

O SocTalk é uma implementação open source (Apache 2.0, sem divisão community/enterprise) do padrão 3: um control plane, um release Helm `soctalk-tenant` por cliente, no seu próprio Kubernetes 1.30+, seja ele K3s, EKS, AKS ou GKE.

```mermaid
flowchart TB
    subgraph cp["soctalk-system namespace (control plane)"]
        api["API + orchestrator"]
        ctrl["Provisioning controller"]
        pg[("Postgres: RLS, FORCE, 3 roles")]
        api --> pg
        ctrl --> pg
    end
    subgraph ta["tenant-acme namespace"]
        ma["Wazuh manager"]
        ia["Wazuh indexer"]
        wa["runs-worker + adapter"]
    end
    subgraph tb["tenant-beta namespace"]
        mb["Wazuh manager"]
        ib["Wazuh indexer"]
        wb["runs-worker + adapter"]
    end
    ctrl -- "Helm: soctalk-tenant" --> ta
    ctrl -- "Helm: soctalk-tenant" --> tb
    agA["Customer A agents"] -- "acme.soc.mssp.example.com : 1514/1515" --> ma
    agB["Customer B agents"] -- "beta.soc.mssp.example.com : 1514/1515" --> mb
```

O onboarding executa uma sequência de provisionamento em nove fases (preflight, geração de segredos, namespace com quotas, instalações Helm, polling de prontidão), cada fase emitindo um evento de ciclo de vida e podendo ser repetida de forma idempotente a partir de `degraded`. O estado do tenant é uma máquina imposta pelo servidor (`pending → provisioning → active`, com os estados suspended, decommissioning, archived e purged; transições inválidas retornam 409). Três perfis de onboarding cobrem demos (`poc`), produção (`persistent`) e BYO-Wazuh (`provided`, em que o SocTalk conecta na pilha existente de um cliente em vez de implantar uma). O decommission desmonta o data plane mas mantém a linha do tenant e o histórico de auditoria.

O ciclo de vida completo, de estados e fases a quotas e caminhos de recuperação, está em [Ciclo de vida do tenant](/pt-br/tenant-lifecycle). Para rodar: o [guia de instalação](/pt-br/install) cobre um cluster de produção em cerca de uma hora, e a [VM de demonstração](/pt-br/quickstart-vm) sobe uma instalação multi-tenant funcional com um tenant de demo em cerca de cinco minutos.
