---
description: Onboarding de clientes Wazuh para MSSP, de ponta a ponta — provisione um SOC de tenant isolado, registre agentes, distribua acessos e estabeleça a linha de base da primeira semana.
---

# Onboarding de um tenant de cliente em um SOC Wazuh multi-tenant: um checklist para MSSP

Fazer o "onboarding" de um cliente em um serviço Wazuh multi-tenant são quatro trabalhos, não um: provisionar uma stack isolada por cliente, registrar os agentes do cliente no manager *dele* e de mais ninguém, distribuir acessos que respeitem a fronteira MSSP/cliente e estabelecer a linha de base da primeira semana de operações. Este guia percorre todo o caminho no SocTalk, onde cada cliente recebe um manager, um indexer e um dashboard Wazuh dedicados em seu próprio namespace Kubernetes, atrás de um único control plane do MSSP.

## Decisões a tomar antes de clicar em New Tenant

**Perfil.** O perfil é fixado no momento do onboarding — trocar depois significa descomissionar + recriar — então decida primeiro:

- `poc` — avaliações e pilotos de curta duração. Armazenamento `local-path` sem garantia real de persistência, requests de recursos baixos, sem hooks de backup. Este também é o **padrão se você não especificar um**, o que é o padrão errado para um cliente pagante.
- `persistent` — SOCs de clientes em produção. Usa a StorageClass padrão da sua instalação, requests dimensionados para produção e hooks de backup honrados se configurados.
- `provided` — o cliente já executa o Wazuh (BYO-SIEM). O SocTalk instala apenas seu adapter e o runs-worker no namespace do tenant e alcança o indexer do cliente (`:9200`) e a Manager API (`:55000`) pela rede. O material de conexão externa *e* as credenciais de LLM por tenant são obrigatórios no momento do onboarding — a API retorna 422 se estiverem ausentes.

**Dimensionamento.** Planeje cerca de 6–8 GB de RAM e ~1,5 vCPU por tenant `persistent`; o indexer Wazuh por tenant geralmente é o gargalo e determina o disco (PVC de 50 GB por padrão, retenção hot de 30 dias, ainda sem tiering hot→cold). O SocTalk é testado até ~50 tenants em um cluster de 3 nós de 16 vCPU / 64 GB; trate qualquer coisa acima de ~5 tenants em um único host como não validada. Detalhes em [Dimensionamento](/pt-br/reference/sizing).

**LLM por tenant.** A triagem roda sobre uma configuração de LLM por tenant: Anthropic ou qualquer endpoint compatível com OpenAI (Azure OpenAI, vLLM, Ollama, LiteLLM). Um cliente pode trazer a própria chave de API para isolamento de faturamento — montada como um Secret do Kubernetes no namespace dele, com a ressalva documentada da V1 de que a chave também é mantida em texto plano no banco de dados do SocTalk ([Segredos](/pt-br/reference/secrets)) — ou você pode apontar o tenant para um endpoint Ollama totalmente local, para uma postura sem nuvem e sem custo por token (reserve tempo para inferência lenta em CPU). Veja [Provedores de LLM](/pt-br/integrate/llm-providers).

## Provisionamento: o que realmente acontece

Crie o tenant pela [UI do MSSP](/pt-br/mssp-ui) (Tenants → **+ New Tenant**) ou pela API. O tenant entra em uma máquina de estados imposta pelo servidor — `pending → provisioning → active`, com `degraded`, `suspended`, `decommissioning`, `archived` e `purged` na sequência; transições inválidas são rejeitadas com um 409.

O controller executa nove fases ordenadas e idempotentes, cada uma emitindo um evento de ciclo de vida que você pode acompanhar na página de detalhes do tenant: verificações de preflight, geração dos segredos por tenant (`authd`, JWT, Postgres), criação do namespace (`tenant-<slug>` com labels, ResourceQuota e LimitRange dimensionados conforme o perfil), aplicação dos segredos, a instalação Helm do `soctalk-tenant` (que também provisiona automaticamente o usuário `tenant_admin`), a instalação do chart do Wazuh, um poll de readiness, a gravação da configuração de integração e a transição para `active`.

Se uma fase falhar, o tenant cai em `degraded`, com o passo que falhou capturado na linha do evento. Corrija a causa (PVC travado, quota subdimensionada, falha de image pull) e clique em **Retry Provisioning** — o retry retoma da fase 1 e toda fase é idempotente, então reexecuções são seguras. O retry só é válido *a partir de* `degraded`, não de `pending`. Runbooks para estados travados estão em [Operações diárias](/pt-br/operations).

## Registro de agentes: colocando os endpoints no tenant certo

Cada tenant recebe um nome DNS dedicado (`acme.soc.mssp.example.com`) que resolve para um endpoint L4 por tenant nas portas 1514/TCP (eventos) e 1515/TCP (registro). O roteamento é por endereço de destino, não por SNI — o protocolo de agente da 1514 do Wazuh não é TLS padrão e nunca apresenta um ClientHello.

**Ressalva honesta da V1:** o chart cria o Service do manager Wazuh apenas como `ClusterIP`. **Não há provisionamento automático de LoadBalancer nem de DNS nesta release** — você mesmo conecta a borda: um Service LoadBalancer por tenant aplicado manualmente, um HAProxy de borda com pares de portas por tenant em um único IP, ou um caminho de VPN em malha. Os registros DNS são igualmente gerenciados pelo operador.

O registro em si é escopado por tenant por design. Recupere o segredo compartilhado `authd` do tenant:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Entregue o hostname, as portas e o segredo ao administrador de endpoints do cliente por um canal seguro; ele executa `agent-auth -m <hostname> -P "<secret>"`. Um agente que possui o segredo do tenant A só consegue se registrar no manager do tenant A. Uma aba Agents dedicada e um painel de Agent Onboarding estão no roadmap; hoje, verifique os agentes no dashboard Wazuh incorporado (Tenants → **Open SOC** → Agents). Topologia completa e requisitos de firewall: [Ingress de agentes Wazuh](/pt-br/reference/wazuh-ingress).

## Pessoas: quem recebe um login

O provisionamento já criou um `tenant_admin`. Esse papel é self-service: gerencia os usuários da própria organização e as próprias configurações de LLM a partir do portal do cliente. Para stakeholders que precisam de visibilidade mas nunca devem agir, atribua `customer_viewer` — dashboards e investigações somente leitura, sem fila de revisão, sem chat.

Todo usuário criado recebe uma senha temporária de uso único, exibida uma única vez e com troca obrigatória no primeiro login. Uma parede de audiência separa os dois lados: papéis de tenant nunca podem ter capacidades de MSSP e vice-versa, imposto no capability guard, de modo que um login de cliente estruturalmente não consegue alcançar superfícies cross-tenant. Observe que não há fluxo self-service de recuperação de senha nesta release — os resets são forçados por um admin. Catálogo completo: [Usuários e papéis](/pt-br/users-and-roles).

## A primeira semana

- **Heartbeat.** Acompanhe `soctalk_tenant_adapter_heartbeat_age_seconds` em `/metrics` — na V1, é o único gauge ativamente atualizado e ele *não* degrada automaticamente o estado do tenant, então configure você mesmo o alerta.
- **Fila de revisão.** Tenants novos geram tráfego de revisão enquanto as linhas de base se estabilizam; toda escalação da AI aguarda um humano na fila do dashboard — não existe bypass de aprovação automática.
- **Janelas de engajamento.** Se o cliente tem um pentest agendado, declare a janela de engajamento (origem, host, técnica, horário) antes do início, para que a atividade sancionada seja sinalizada e auditada em vez de escalada — e a atividade do tester fora do escopo ainda force uma revisão humana.
- **Fundamentos de suspensão/descomissionamento.** Suspender muda o estado no banco e interrompe novas investigações, mas **não** reduz os workloads — o corte de emergência é um runbook manual. O descomissionamento derruba o data plane e mantém a linha do tenant mais o histórico de auditoria em `archived`; ainda não existe um endpoint de API `:purge`.

## Checklist de onboarding

- [ ] Perfil escolhido (`persistent` para produção; `provided` exige URLs do SIEM + credenciais de LLM desde o início)
- [ ] Folga do cluster verificada (~6–8 GB de RAM, ~1,5 vCPU por tenant `persistent`)
- [ ] LLM por tenant decidido (chave própria / padrão da instalação / Ollama local)
- [ ] Tenant criado; eventos de ciclo de vida chegaram a `active`
- [ ] Borda conectada manualmente: endpoint de LB ou edge-proxy + registro DNS para `<slug>.soc.<domain>`
- [ ] Secret do `authd` obtido e compartilhado por canal seguro
- [ ] Primeiro agente inscrito e visível no dashboard Wazuh do tenant
- [ ] `tenant_admin` entregue; contas `customer_viewer` criadas conforme necessário
- [ ] Alerta de heartbeat em `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Qualquer pentest agendado declarado como janela de engagement

## Para se aprofundar

- [Ciclo de vida do tenant](/pt-br/tenant-lifecycle) — máquina de estados, fases, caminhos de recuperação
- [Ingress de agentes Wazuh](/pt-br/reference/wazuh-ingress) — topologias de borda, certificados, revogação
- [Usuários e papéis](/pt-br/users-and-roles) — o catálogo completo de papéis e a parede de audiência
- [Operações diárias](/pt-br/operations) — o lado de runbook de tudo o que está acima
- [Launchpad](/pt-br/launchpad) — ensaie todo esse fluxo em um piloto multi-VM de ~15–25 minutos
