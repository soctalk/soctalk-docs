---
description: "Faça o onboarding de um tenant de cliente de ponta a ponta no SocTalk: escolha um perfil, execute o wizard Create Customer, acompanhe o provisionamento chegar a active, conecte os endpoints do cliente e distribua os acessos."
---

# Onboarding de tenant

O onboarding transforma um cliente em um SOC de tenant isolado no seu control plane. Cada tenant recebe seu próprio namespace Kubernetes (`tenant-<slug>`) com seus próprios secrets, orçamento de recursos e (para os perfis `poc` e `persistent`) um Wazuh manager, indexer e dashboard dedicados. Esta página percorre o caminho completo que um administrador de MSSP segue na UI, da primeira decisão ao momento em que os analistas do cliente conseguem abrir o SOC dele.

Para a visão conceitual (dimensionamento, as quatro tarefas, a linha de base da primeira semana), veja o [guia de checklist de onboarding](/pt-br/guides/wazuh-tenant-onboarding). Para a máquina de estados e os detalhes internos de perfil, veja [Ciclo de vida do tenant](/pt-br/tenant-lifecycle). Esta página é o passo a passo do operador.

## Antes de começar

- Seu control plane está instalado e você consegue entrar como administrador de MSSP. Se ele ainda não estiver no ar, siga primeiro a [instalação de produção](/pt-br/install) ou o [quickstart da VM de demonstração](/pt-br/quickstart-vm).
- Você já decidiu o perfil do tenant. Ele é fixo para o tempo de vida do tenant, então leia a próxima seção antes de clicar em **New tenant**.
- Apenas para um tenant `provided`, reúna o material de conexão do Wazuh existente do cliente out-of-band antes de abrir o wizard: a URL do Indexer com um usuário e senha de Basic auth, a URL da Manager API com um usuário e senha, e as credenciais de LLM por tenant. O wizard trava sem esses dados, então reuni-los primeiro evita deixar um formulário pela metade. Veja [Coordenando credenciais externas do Wazuh](/pt-br/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Escolha um perfil

O perfil é escolhido uma única vez e fica fixo. Trocar depois significa descomissionar e refazer o onboarding, então escolha com cuidado.

- **`poc`** é para avaliações e pilotos de curta duração. O chart do tenant instala o Wazuh mais um simulador linux-ep com armazenamento `local-path` e orçamentos de recursos apertados. Este também é o padrão se você não especificar um, e `local-path` não carrega garantia de persistência, então é a escolha errada para um cliente real.
- **`persistent`** é para SOCs de clientes em produção. Mesmo formato com Wazuh incluído do `poc`, mas dimensionado para carga sustentada na StorageClass padrão do cluster, com as faixas completas de recursos do chart e os hooks de backup respeitados onde configurados.
- **`provided`** é para um cliente que já opera o Wazuh (traga seu próprio SIEM). O chart instala apenas o adaptador do SocTalk e o runs-worker; o SocTalk alcança o indexer e a Manager API do cliente pela rede. O material de conexão externa e as credenciais de LLM por tenant são exigidos no momento do onboarding.

Planeje aproximadamente 6 a 8 GB de RAM e cerca de 1,5 vCPU por tenant `persistent`; o indexer Wazuh por tenant costuma ser o gargalo. Os detalhes de capacidade estão em [Dimensionamento](/pt-br/reference/sizing), e cada perfil é detalhado em [Ciclo de vida do tenant](/pt-br/tenant-lifecycle#profiles).

## Execute o wizard Create Customer

No dashboard MSSP, clique em **Tenants** no menu lateral esquerdo, depois em **New tenant** no topo da lista. Isso abre o wizard **Create Customer**. São quatro passos para `poc` e `persistent` (Identity, Profile, Branding, Review) e cinco para `provided`, onde um passo External SIEM aparece entre Profile e Branding.

### Passo 1: Identity

- **Display name**, por exemplo `Acme Corp`.
- **Slug**: curto, minúsculo, separado por hífens, 3 a 32 caracteres, validado contra `[a-z0-9-]+`. O slug se torna o namespace `tenant-<slug>` e é substituído nos identificadores subsequentes, então escolha-o com cuidado. Em um piloto de tailnet, ele precisa corresponder à tag do Tailscale do tenant.
- **Contact email**.

### Passo 2: Profile

Escolha um entre `poc`, `persistent` ou `provided`. O mesmo passo traz uma seção de divulgação **LLM (advanced)** para sobrescrever o provedor de LLM compartilhado da instalação, a base URL, a chave e, opcionalmente, os IDs de modelo Fast e Thinking. Deixe-a recolhida em `poc` e `persistent` para herdar os defaults da instalação. Em `provided`, as credenciais de LLM são obrigatórias e travam o passo, porque não há fallback compartilhado da instalação para esse perfil.

Alterar o perfil depois do provisionamento exige descomissionar e refazer o onboarding, então confirme a escolha antes de continuar.

### Passo 3: External SIEM (somente provided)

Este passo fica oculto a menos que você tenha escolhido `provided`. Preencha dois pares de endpoint e credencial:

- **Wazuh Indexer URL**, por exemplo `https://wazuh.acme.example:9200`, com o usuário e a senha do indexer usados para Basic auth.
- **Wazuh Manager API URL**, por exemplo `https://wazuh.acme.example:55000`, com o usuário e a senha da API usados para emitir JWTs.

Ambos precisam ser alcançáveis a partir da VM do tenant. O controlador transforma as URLs em uma allow-list de egress FQDN do Cilium no namespace do tenant; o adaptador nunca alcança o Wazuh diretamente a partir do cluster MSSP. Faça uma verificação de sanidade das credenciais do manager antes de enviar:

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (a long base64 string)
```

Se isto retornar um token, as ferramentas de chat do tenant resolverão assim que o data plane do tenant estiver no ar.

### Passo 4 (ou 3 para poc e persistent): Branding

Opcional. Um display name e um logo pequeno que aparecem no cabeçalho do tenant. Você pode pular este passo inteiramente.

### Passo final: Review

Confirme tudo e clique em **Create**. A API responde `202` e retorna você à lista de tenants. O novo tenant começa em `pending` e passa por `provisioning` rumo a `active`.

## Acompanhe o provisionamento chegar a active

Abra a página de detalhes do tenant e atualize-a para acompanhar a tabela **Lifecycle Events**. O controlador executa nove fases ordenadas e idempotentes, cada uma emitindo um evento:

1. `preflight_ok`: os pré-requisitos do cluster e os conflitos de nomenclatura passam.
2. `secrets_minted`: secrets por tenant gerados (`authd`, assinatura de JWT, Postgres).
3. `namespace_ready`: `tenant-<slug>` criado com labels, ResourceQuota e LimitRange.
4. `secrets_applied`: secrets empurrados para o namespace como objetos Secret do Kubernetes.
5. `helm_applied` (chart do tenant): o chart `soctalk-tenant` instala o adaptador, o runs-worker e o ingress. O usuário `tenant_admin` é provisionado automaticamente como parte deste passo.
6. `helm_applied` (chart do Wazuh): o chart standalone do Wazuh instala o manager, o indexer e o dashboard. O payload do evento identifica qual chart foi aplicado. Esta fase não roda para tenants `provided`.
7. `workloads_ready`: todos os pods do data plane reportam Ready.
8. `integration_config_written`: configurações de integração por tenant (LLM, URLs do TheHive) escritas no banco de dados.
9. `active`: o tenant transiciona para `active` e está pronto para uso.

Quando o tenant chega a `active`, use **Open SOC** na lista de tenants para entrar no dashboard dele.

Se travar, a fase que falhou é nomeada na tabela de eventos:

- **Travado em `pending`**: o controlador foi reagendado antes da fase 1. O retry não é permitido diretamente a partir de `pending`; espere a tentativa transicionar para `degraded`, depois clique em **Retry Provisioning**. O provisionamento retoma a partir da fase 1.
- **Em `provisioning` por mais de 15 minutos**: normalmente um pod travado (ImagePullBackOff, um PVC `Pending` ou um ResourceQuota pequeno demais). Veja [Operações diárias](/pt-br/operations#tenant-stuck-in-provisioning).
- **Em `degraded`**: uma fase de provisionamento falhou. Leia a linha do evento para ver qual, depois **Retry Provisioning**, que é uma transição válida a partir de `degraded`. Mais detalhes em [Ciclo de vida do tenant](/pt-br/tenant-lifecycle#recovery-paths).

## Registre os endpoints do cliente

Registrar endpoints significa fazer as máquinas do cliente reportarem ao Wazuh manager do tenant certo. Isso se aplica aos tenants `poc` e `persistent`, que rodam o Wazuh dentro do namespace deles. Um tenant `provided` já envia seus endpoints ao Wazuh próprio do cliente, então não há nada a registrar aqui; pule para a próxima seção.

O Wazuh manager de cada tenant escuta em 1514/TCP (eventos) e 1515/TCP (registro). Nesta versão, o chart cria esse manager apenas como um Service `ClusterIP`: não há provisionamento automático de LoadBalancer nem de DNS, então você monta a borda por conta própria (um Service LoadBalancer por tenant, um HAProxy de borda com pares de portas por tenant em um único IP, ou um caminho de VPN em malha) e gerencia o registro DNS. A topologia completa e os requisitos de firewall estão em [Ingress de agentes Wazuh](/pt-br/reference/wazuh-ingress).

O registro é limitado ao tenant pelo segredo compartilhado `authd` do manager. Recupere-o:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Entregue o hostname do manager, as duas portas e esse segredo ao administrador de endpoints do cliente por um canal seguro. Ele registra cada endpoint com:

```bash
agent-auth -m <tenant-manager-hostname> -P "<authd-secret>"
```

Um agente que detém o segredo de um tenant só consegue se registrar no manager daquele tenant, o que é o que mantém o registro isolado. Confirme que os agentes chegaram no dashboard Wazuh embutido: Tenants, depois **Open SOC**, depois Agents.

Se, em vez disso, o data plane do tenant roda em infraestrutura separada (o modelo de piloto remoto, em que uma VM do tenant se junta por um tailnet), essa VM é registrada com o control plane por um fluxo de cloud-agent `:issue-agent`, que é uma coisa diferente do registro de endpoints acima. Esse caminho é coberto de ponta a ponta no [tutorial de piloto MSSP](/pt-br/mssp-pilot#_4-tenant-side-stand-up-the-data-plane).

## Distribua os acessos

O usuário `tenant_admin` é criado automaticamente durante a fase 5, então o tenant tem um administrador assim que chega a `active`. Para dar a esse administrador uma credencial utilizável, force uma redefinição de senha a partir do lado MSSP (o ator precisa ser `mssp_admin` ou `platform_admin`):

```bash
curl -X POST 'https://<mssp-host>/api/mssp/users/<user-id>/password/reset' \
  -b jar -H 'Origin: https://<mssp-host>'
```

A resposta retorna uma `temporary_password` de uso único marcada como `must_change=true`, e a redefinição revoga quaisquer sessões existentes desse usuário. Compartilhe essa senha junto com a URL do portal do cliente por um canal criptografado de ponta a ponta, como um gerenciador de senhas compartilhado, nunca por um email não criptografado ou um canal de chat público. O tenant admin escolhe uma nova senha no primeiro login.

A partir daí o tenant é self-service: o `tenant_admin` entra no portal do cliente, abre **Users** e provisiona os logins da própria organização (por exemplo `customer_viewer` para stakeholders somente leitura). A equipe do MSSP e os usuários do tenant ficam em lados opostos de uma fronteira de audiência imposta pelo guard de capacidades, então um login de tenant estruturalmente não alcança superfícies cross-tenant. Os papéis e essa fronteira são descritos em [Usuários e papéis](/pt-br/users-and-roles).

## Verifique

- O tenant aparece como `active` na lista de tenants, e **Open SOC** carrega o dashboard dele.
- Para `poc` e `persistent`, confirme que os endpoints registrados aparecem em Open SOC, depois Agents, e que os eventos deles chegam no dashboard Wazuh do tenant.
- Para `provided`, confirme que o pod `soctalk-adapter` está Ready, depois execute uma consulta apoiada no Wazuh no chat do SocTalk (por exemplo, peça os alertas recentes de um host conhecido). Ela resolve assim que o adaptador consegue alcançar os endpoints do External SIEM do cliente; se não resolver, verifique novamente a alcançabilidade conforme [Coordenando credenciais externas do Wazuh](/pt-br/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Veja também

- [Checklist de onboarding](/pt-br/guides/wazuh-tenant-onboarding) para a visão conceitual e a linha de base da primeira semana.
- [Ciclo de vida do tenant](/pt-br/tenant-lifecycle) para a máquina de estados, perfis, quotas e caminhos de recuperação.
- [Tour pela UI do MSSP](/pt-br/mssp-ui#tenants) para a lista de tenants e as páginas de detalhes.
- [Piloto MSSP: faça você mesmo](/pt-br/mssp-pilot) para o rollout completo baseado em tailnet, incluindo o data plane do lado do tenant.
