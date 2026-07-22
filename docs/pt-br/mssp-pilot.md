# Piloto MSSP: Faça Você Mesmo

::: tip A maioria dos pilotos deve usar o Launchpad
O [**Launchpad**](/pt-br/launchpad) automatiza todo esse rollout, mesma instalação, mesmos charts, mesmo fluxo do Tailscale, em um único comando (~15-25 min, na maior parte aguardando downloads, contra ~2 horas feito manualmente). **Comece por ele.** Recorra a este guia faça-você-mesmo quando quiser entender cada passo, estiver diagnosticando uma execução do Launchpad ou seu ambiente não conseguir rodar o Launchpad, air-gapped, DNS split-horizon on-prem, um substrato não suportado ou um cluster já existente.
:::

Um caminho prático para MSSPs que estão avaliando o SocTalk com 1-3 de seus clientes. Dois ambientes on-premise (um control plane MSSP, um por tenant), conectados por uma mesh VPN amigável a firewalls. Estado final: uma instalação multi-tenant do SocTalk funcionando, o analista SOC de AI respondendo perguntas sobre os dados reais do Wazuh de cada tenant e um screenshot que você pode mostrar aos seus stakeholders.

**Não é uma instalação de produção.** Sem HA, sem TLS real, seu hostname de tailnet faz as vezes do ingress. Quando estiver pronto para produção, veja [Instalação](/pt-br/install).

**Experimentando o SocTalk sozinho primeiro?** Comece pelo [Quickstart VM](/pt-br/quickstart-vm): uma única máquina, um único tenant, ~10 minutos.

::: tip Tempo prático
| Lado | Prático | Tempo total |
|---|---|---|
| MSSP (uma vez) | ~45 min | ~60 min |
| Cada tenant (1-3 deles) | ~30 min por tenant | ~45 min por tenant |
| Demo + verificação | ~10 min | ~10 min |
:::

## O que está no escopo

- 1 control plane MSSP + 1-3 tenants
- Ambos os ambientes **on-premise**, qualquer hypervisor que rode Ubuntu 24.04 (vSphere / Proxmox / Hyper-V / KVM / VirtualBox / bare metal)
- [Tailscale](https://tailscale.com) como mesh VPN. Headscale, NetBird ou qualquer mesh WireGuard funciona da mesma forma; o Tailscale é o que os comandos abaixo assumem sintaticamente.
- O control plane SocTalk L1 do MSSP + o cloud-agent SocTalk L2 em cada tenant
- Wazuh **já instalado** OU **instalado via chart** por tenant; ambos suportados

<!-- screenshot: arch-overview.svg, architecture diagram (MSSP VM left, tenant VMs right, tailnet wrapping both, cloud-agent shown on each tenant, optional dotted-line to existing Wazuh) -->

## 0. Antes de começar

Reúna estes itens. Todos eles serão solicitados ao longo dos próximos 90 minutos:

- [ ] Hypervisor + login de admin para o lado do MSSP
- [ ] Hypervisor + login de admin por tenant (um por cliente do piloto)
- [ ] Uma conta Tailscale ([cadastre-se](https://login.tailscale.com/start); o tier gratuito dá conta de um piloto tranquilamente)
- [ ] Uma chave de API de LLM (Anthropic ou OpenAI). Para uma opção air-gapped ou sensível à soberania, veja [integração com Ollama](/pt-br/integrate/ollama).
- [ ] Um contato por tenant (nome, email, tem Wazuh existente? sim/não)
- [ ] Se um tenant tem Wazuh existente: **dois** conjuntos de credenciais, um para o Wazuh Indexer (`:9200`, autenticação Basic) e um para a Wazuh Manager API (`:55000`, usuário capaz de emitir JWT)

## 1. Configurar o tailnet

O control plane MSSP e cada tenant entram no mesmo tailnet. O tailnet fornece hostnames estáveis (para que o cloud-agent disque um nome, e não um IP) e ACLs (para que os tenants não consigam alcançar uns aos outros).

### 1.1 Tags

Defina uma tag para o MSSP e uma por tenant na UI de admin do Tailscale em **Access Controls** → **Tags**:

```json
"tagOwners": {
  "tag:mssp":         ["autogroup:admin"],
  "tag:tenant-acme":  ["autogroup:admin"],
  "tag:tenant-globex":["autogroup:admin"]
}
```

Adicione uma tag por tenant do piloto. As tags são como a ACL impede que os tenants alcancem uns aos outros.

### 1.2 ACL

Cole esta stanza em **Access Controls** → **Access Controls (JSON)**. Ajuste a lista de tags de tenant para corresponder ao seu piloto.

```json
"acls": [
  {
    "action": "accept",
    "src":    ["autogroup:admin"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  },
  {
    "action": "accept",
    "src":    ["tag:mssp"],
    "dst":    ["tag:tenant-acme:*", "tag:tenant-globex:*"]
  },
  {
    "action": "accept",
    "src":    ["tag:tenant-acme", "tag:tenant-globex"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  }
]
```

A primeira regra permite que **seus dispositivos de operador** (seu laptop, qualquer nó sem tag pertencente a admin no tailnet) alcancem a UI do MSSP. Sem ela, o default-deny do Tailscale bloqueia seu próprio navegador. A segunda regra permite que o MSSP alcance cada tenant para as chamadas de ferramentas do chat (API do Wazuh, observabilidade). A terceira permite que o cloud-agent de cada tenant alcance o endpoint HTTPS do MSSP para se registrar e transmitir eventos. Os tenants não conseguem alcançar uns aos outros.

Verifique no painel ACL Preview antes de salvar. Confirme que `tag:tenant-acme` não consegue alcançar `tag:tenant-globex` em nenhuma porta.

<!-- screenshot: tailscale-acl-preview.png, ACL preview showing tenant-to-tenant denied, MSSP→tenant + tenant→MSSP allowed -->

### 1.3 Auth keys

Em **Settings** → **Keys**, gere:

- Uma auth key **reusable** com a tag `tag:mssp` para o control plane MSSP.
- Uma auth key **ephemeral** por tenant com a tag `tag:tenant-<slug>`. Defina o TTL para a duração do seu piloto (por exemplo, 90 dias).

Anote-as em local seguro; você as colará quando cada VM entrar no tailnet.

### 1.4 Requisitos de rede

O Tailscale precisa apenas de egress (nunca inbound) a partir de cada nó:

- **Caminho direto** (quando ambos os peers conseguem fazer NAT-traversal): WireGuard sobre UDP em uma porta alta aleatória. A maioria das redes já permite isso.
- **Fallback DERP** (quando o NAT traversal falha, por exemplo firewalls restritivos ou double-NAT): TCP/443 para os relays DERP do Tailscale. A maioria dos pilotos usa este caminho, já que parece tráfego HTTPS normal.

Se seu firewall permite HTTPS de saída, você está pronto. Nenhuma mudança de regra inbound em lugar algum.

## 2. Lado MSSP: subir o control plane

O control plane MSSP é uma única VM SocTalk, a mesma que o [Quickstart VM](/pt-br/quickstart-vm) instala. Usamos aquele tutorial como base e adicionamos a entrada no tailnet.

### 2.1 Provisionar e instalar

Siga os **passos 1 a 5** do [Quickstart VM](/pt-br/quickstart-vm) (download, boot, obter o token de setup, abrir o wizard, entrar). Quando o wizard pedir o **Hostname**, deixe em branco por enquanto. Você o definirá para o hostname do tailnet em §2.3.

Pare quando tiver chegado ao dashboard MSSP. **Observação:** o fluxo do Quickstart faz o onboarding automático de um tenant chamado `demo` no primeiro boot. Você verá um tenant já na sua lista; isso é esperado. Você pode deixá-lo (e ignorá-lo em §5) ou desativá-lo pelo dashboard antes de adicionar seus tenants reais do piloto:

```text
Tenants → demo → Decommission
```

Qualquer opção serve; apenas fique atento para não se confundir quando `list all tenants` em §5 retornar mais do que a contagem do seu piloto.

<!-- screenshot: mssp-dashboard-after-install.png, MSSP dashboard immediately after wizard install, showing the auto-onboarded demo tenant -->

### 2.2 Endurecer a máquina

::: danger Obrigatório antes do próximo passo
As imagens de disco baixáveis vêm com um usuário SSH `ubuntu:packer` definido em tempo de build. **Não conecte a VM ao seu tailnet até tê-la bloqueado.** Veja [Acesso SSH + credenciais](/pt-br/quickstart-vm#ssh-access-credentials) para a explicação completa e os comandos de endurecimento.

Mínimo:
```bash
sudo passwd -l ubuntu
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```
:::

### 2.3 Instalar o Tailscale, entrar no tailnet

Conecte via SSH como `ops` (o usuário que o seed cloud-init criou durante sua instalação do [Quickstart VM](/pt-br/quickstart-vm); **não** o usuário `ubuntu` de tempo de build que §2.2 acabou de bloquear):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-mssp-... --advertise-tags=tag:mssp --hostname=soctalk-mssp
```

Confirme o hostname de tailnet atribuído:

```bash
tailscale status | head -1
# example: 100.64.10.5   soctalk-mssp        ops          linux   active; direct
```

Seu hostname MSSP é `soctalk-mssp.<your-tailnet>.ts.net`. Anote-o; tudo o que segue o utiliza.

### 2.4 Vincular o ingress do SocTalk ao hostname do tailnet

Edite os values implantados para definir o hostname:

```bash
sudo nano /etc/soctalk/values.yaml
```

Altere `ingress.hostnames.mssp` e `ingress.hostnames.customer` para seu hostname de tailnet (por exemplo, `soctalk-mssp.taila1b2c3.ts.net`), depois faça o redeploy:

```bash
sudo helm upgrade soctalk-system /opt/soctalk/charts/soctalk-system \
  -n soctalk-system -f /etc/soctalk/values.yaml
```

Referência de campos para `values.yaml`: veja [Setup wizard](/pt-br/setup-wizard); o wizard escreve o mesmo arquivo.

### 2.5 Verificar

A partir de qualquer outro dispositivo do tailnet (seu laptop de operador serve; a ACL de §1.2 permite `autogroup:admin → tag:mssp:443`):

```bash
curl -k https://soctalk-mssp.<your-tailnet>.ts.net/health/ready
# expected: 200 OK
```

Entre no dashboard em `https://soctalk-mssp.<your-tailnet>.ts.net/` com as credenciais de admin de §2.1. Você deve aterrissar na visão de frota cross-tenant do MSSP: a faixa de KPIs no topo (Pending Reviews / Stuck Cases / Degraded Tenants / Repeated IOCs), a fila de investigação por tenant e a tabela de saúde dos tenants.

![Dashboard MSSP: visão de frota cross-tenant](/screenshots/mssp-dashboard.png)

## 3. Onboarding de cada tenant: emitir o registro do agente

Para cada tenant do seu piloto, você fará isto no dashboard MSSP e depois entregará o resultado ao operador do tenant.

### 3.1 Executar o wizard Create Customer

No dashboard MSSP, clique em **Tenants** no menu lateral esquerdo, depois em **New tenant** no topo da página de listagem. Isso abre o wizard **Create Customer**. Para os perfis `poc` e `persistent` são 4 passos (Identity → Profile → Branding → Review); para `provided` são 5 (um passo **External SIEM** aparece entre Profile e Branding).

::: tip Colete as informações do tenant de antemão
Para tenants de perfil `provided`, o wizard exige as **credenciais Wazuh existentes** do tenant no passo 3. Obtenha-as com seu contato do tenant (out-of-band, mesmo canal seguro de §3.3) **antes** de iniciar o wizard, para não deixar um formulário pela metade. Para `poc` / `persistent` você só precisa do básico.
:::

#### Passo 1: Identity

- **Display name**: por exemplo, `Acme Corp`
- **Slug**: curto, minúsculo, separado por hífens (3–32 caracteres, validado com `[a-z0-9-]+`). **Deve corresponder** à sua tag de tailnet de §1.1 (portanto `tag:tenant-acme` → slug `acme`). Passos posteriores substituem o slug diretamente em `tag:tenant-<slug>` para a auth key (§3.3) e para o comando `tailscale up` do tenant (§4.2 / §4.7a); uma incompatibilidade significa que o nó do tenant anuncia uma tag que suas ACLs de §1.2 não concedem.
- **Contact email**

![Create Customer: passo Identity](/screenshots/mssp-add-tenant-step1-identity.png)

#### Passo 2: Profile

Escolha uma de três opções de rádio. A API valida contra `poc | persistent | provided`:

- **PoC**: o chart instala o Wazuh + um simulador linux-ep no cluster do tenant, com storage `local-path` e orçamentos de recursos apertados. Escolha este para pilotos de curta duração em que o tenant não tem Wazuh existente. Veja [ciclo de vida do tenant / poc](/pt-br/tenant-lifecycle#poc).
- **Persistent**: mesmo formato com Wazuh incluído do `poc`, mas dimensionado para carga de produção sustentada com a StorageClass padrão do cluster e as faixas completas de recursos do chart. Veja [ciclo de vida do tenant / persistent](/pt-br/tenant-lifecycle#persistent).
- **Provided (traga seu próprio Wazuh)**: o chart instala apenas o adapter do SocTalk; você o aponta para o Wazuh existente do tenant via o passo **External SIEM** (abaixo). Veja [ciclo de vida do tenant / provided](/pt-br/tenant-lifecycle#provided).

Há uma seção de divulgação **LLM (advanced)** no mesmo passo para sobrescrever o provedor de LLM compartilhado da instalação, a base URL, a chave e (opcionalmente) os IDs de modelo Fast / Thinking. Para `poc` / `persistent` isso é opcional; deixe-a recolhida para herdar os defaults da instalação. Para `provided`, as credenciais de LLM são **obrigatórias** (não há fallback compartilhado da instalação) e travam o passo.

![Create Customer: passo Profile](/screenshots/mssp-add-tenant-step2-profile.png)

::: warning A escolha de perfil é permanente
Alterar o perfil depois que o tenant foi provisionado exige desativar e refazer o onboarding. Confirme com seu contato do tenant antes de enviar.
:::

#### Passo 3: External SIEM (somente provided)

Este passo fica oculto a menos que você tenha escolhido Provided no passo 2. Preencha dois pares de endpoint + credencial:

- **Wazuh Indexer URL** (por exemplo, `https://wazuh.acme.example:9200`) + usuário do indexer + senha do indexer (autenticação Basic)
- **Wazuh Manager API URL** (por exemplo, `https://wazuh.acme.example:55000`) + usuário da API + senha da API (usados para emitir JWTs)

Estes precisam ser alcançáveis a partir da VM do tenant que você subirá em §4. O controlador do lado MSSP transforma as URLs em uma allow-list de egress FQDN do Cilium no namespace do tenant; o adapter nunca alcança o Wazuh diretamente a partir do seu cluster MSSP.

Faça uma verificação de sanidade das credenciais do manager a partir da VM MSSP antes de enviar:

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (long base64 string)
```

Se isto retornar 200, as ferramentas de chat do tenant resolverão assim que §4 for concluída.

#### Passo 4 (ou 3 para poc/persistent): Branding

Opcional. Display name + upload de um logo pequeno que aparece no cabeçalho do tenant. Você pode pular isto inteiramente.

![Create Customer: passo Branding](/screenshots/mssp-add-tenant-step3-branding.png)

#### Passo final: Review

Confirme tudo e clique em **Create**. A API responde 202 e você é retornado à lista de tenants; o novo tenant começa em `pending` e passa por `provisioning → active`. Atualize a página de detalhes para acompanhar os eventos de ciclo de vida se acumularem.

![Create Customer: passo Review](/screenshots/mssp-add-tenant-step4-review.png)

### 3.2 Emitir o comando de registro do agente

::: warning Sem botão na UI (ainda)
No momento em que isto foi escrito, a página de detalhes do tenant expõe apenas as ações de ciclo de vida (Suspend / Resume / Retry Provisioning / Decommission). O fluxo `:issue-agent` é somente por API; execute-o a partir de um shell na VM MSSP. Um botão dedicado **Issue Agent** está no roadmap.
:::

![Detalhe do tenant: apenas ações de ciclo de vida, sem botão Issue Agent](/screenshots/mssp-tenant-detail.png)

A partir da VM MSSP, entre uma vez para obter um cookie de sessão, depois faça um POST contra o endpoint `:issue-agent` do tenant:

```bash
# Replace <mssp-host> with your MSSP UI hostname (e.g. soctalk-mssp.<tailnet>.ts.net)
# Replace <tenant-id> with the UUID from the tenant detail URL or from GET /api/mssp/tenants
MSSP=https://<mssp-host>
TENANT=<tenant-id>

curl -sk -c jar -X POST "$MSSP/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<mssp-admin-email>","password":"<password>"}'

curl -sk -b jar -X POST "$MSSP/api/mssp/tenants/$TENANT:issue-agent" \
  -H "Origin: $MSSP" \
  -H 'Content-Type: application/json' | jq .
```

O corpo da resposta 201 contém um `helm_install_hint` que você cola diretamente no shell do tenant. Ele se parece com:

```bash
helm install soctalk-agent-acme \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token>
```

::: warning Use a saída da API literalmente
A versão de chart `0.1.x` e o bootstrap token acima são ilustrativos; os valores reais vêm da sua resposta de `:issue-agent`. Não redigite o comando helm; copie o campo `helm_install_hint`.
:::

::: warning TTL do bootstrap token
O bootstrap token expira (default: 24h). Se o tenant não executar o comando antes disso, reemita contra o mesmo endpoint `:issue-agent`. Reemitir revoga qualquer token anterior não consumido.
:::

### 3.3 Repasse ao contato do tenant

O operador do tenant precisa de **duas** coisas:

1. O **comando helm** de §3.2 (acima). Copie como um único bloco.
2. A **auth key do Tailscale com a tag do tenant** que você gerou em §1.3.

Envie estes através de um gerenciador de senhas compartilhado (1Password, Bitwarden, Vaultwarden, qualquer lugar com criptografia end-to-end). Não cole nenhum deles em um canal público do Slack nem os envie por email sem criptografia.

::: info Em breve
O [SocTalk Launchpad](https://github.com/soctalk/soctalk) (em design) gerará um único bundle assinado que o tenant cola em seu setup wizard, automatizando esse repasse. Por ora, é uma cópia-e-cola manual.
:::

### 3.4 Coordenar as credenciais de Wazuh externo para tenants `provided`

::: tip Pule esta seção se você escolheu `poc` ou `persistent` em §3.1
Esses perfis são autocontidos: o chart instala seu próprio Wazuh; nada mais a fazer no lado MSSP. Vá para §4.
:::

Para tenants de perfil `provided`, o wizard **já coletou** as credenciais do External SIEM em §3.1 passo 3, então quando o tenant chega em `active` o adapter já está configurado. O único trabalho out-of-band é anterior a §3.1: obter as credenciais do tenant em primeiro lugar.

Sequência:

1. **Antes de §3.1**, peça ao seu contato do tenant:
   - Wazuh Indexer URL + usuário + senha (autenticação Basic usada pelo adapter para `_search`)
   - Wazuh Manager API URL + usuário + senha (usados para emitir JWTs)
   - Uma decisão de alcançabilidade: o Wazuh deles está no mesmo tailnet que a VM do tenant que você subirá em §4? Se não, eles precisarão de `--advertise-routes` de §4.2 (veja §4.7a para o menu de opções).
2. Eles seguem §4.7a do lado deles para confirmar a alcançabilidade.
3. Eles enviam ambos os pares de endpoint + credencial para você (gerenciador de senhas compartilhado).
4. Você executa §3.1 com **Provided** no passo 2 e cola as credenciais no passo 3.

Se a situação de alcançabilidade do tenant mudar depois de §3.1 (por exemplo, eles movem o Wazuh para outro host), atualize o painel External SIEM na página de detalhes do tenant. O controlador captura a mudança na próxima reconciliação (~30 s).

## 4. Lado tenant: subir o data plane

Esta seção é autocontida para os contatos de TI do tenant. **Se você é um operador de tenant e seu MSSP lhe enviou um comando helm + uma auth key do Tailscale, pode começar aqui.** Dê uma olhada em §0 para contexto, depois siga esta seção.

### 4.1 Provisionar uma VM Linux

Você precisará de uma VM Ubuntu 24.04 LTS, no mínimo 4 vCPU / 8 GB RAM / 60 GB de disco, com internet de saída. Provisione-a pelo seu processo de TI normal. Qualquer hypervisor que rode Ubuntu funciona (vSphere, Proxmox, Hyper-V, KVM, VirtualBox, bare metal). Se preferir usar uma imagem SocTalk pré-pronta, veja [Quickstart VM passo 1](/pt-br/quickstart-vm#_1-download) para os links de imagem de disco e os passos de importação por hypervisor; volte aqui em §4.2.

### 4.2 Endurecer a máquina

::: warning
Se você usou a imagem SocTalk pré-pronta, siga [Acesso SSH + credenciais](/pt-br/quickstart-vm#ssh-access-credentials) antes de conectar ao seu tailnet. Se você provisionou uma VM Ubuntu genérica pelo seu pipeline de TI, seu endurecimento de OS padrão já se aplica.
:::

### 4.3 Instalar o Tailscale, entrar no tailnet

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-tenant-... --advertise-tags=tag:tenant-<slug> --hostname=soctalk-tenant-<slug>
```

Use a auth key do repasse do seu MSSP (§3.3). Verifique:

```bash
tailscale ping soctalk-mssp.<tailnet>.ts.net
# expected: pong from the MSSP control plane
```

Se o `ping` falhar, verifique a lista de máquinas na UI de admin do Tailscale. Certifique-se de que a máquina MSSP está online e que o ACL preview mostra que sua tag de tenant consegue alcançar `tag:mssp`.

### 4.4 Instalar k3s + Helm

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644" sh -
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

Verifique se o k3s subiu:

```bash
kubectl get nodes
# expected: one node, status Ready
```

### 4.5 Desabilitar as NetworkPolicies do lado tenant

::: danger Obrigatório antes do próximo passo
O chart `soctalk-cloud-agent` e o chart do tenant vêm com NetworkPolicies que assumem políticas FQDN do Cilium. O k3s vanilla não tem CRDs do Cilium, então as políticas bloqueiam egress legítimo do agente para o MSSP. Desabilite as NetworkPolicies do chart antes do helm install em §4.6.

O caminho mais simples: adicione `--set networkPolicies.enabled=false` ao seu comando helm.

Se seu cluster de tenant precisa de isolamento de rede, faça-o na camada do firewall do host (a ACL do tailnet de §1.2 já fornece o isolamento MSSP↔tenant).
:::

### 4.6 Executar o comando helm do seu MSSP

Cole o comando de §3.2, acrescentando `--set networkPolicies.enabled=false` conforme §4.5:

```bash
helm install soctalk-agent-<slug> \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token> \
  --set networkPolicies.enabled=false
```

::: tip Cert MSSP self-signed? Defina insecureTLS
Se sua instalação MSSP ainda não provisionou um cert TLS real para o hostname do tailnet (cert-manager do lado do chart não conectado, ou você está atrás do Tailscale e o trata como a fronteira de confiança), acrescente `--set insecureTLS=true` ao comando helm. O agente pulará a verificação de cert em `controlPlaneUrl`; o Tailscale cuida da criptografia de transporte de qualquer forma. Desligado por padrão; defina isto apenas quando confiar na rede subjacente.
:::

O cloud-agent é instalado no namespace `soctalk-agent`, disca o control plane via tailnet, se registra e, a partir daí, o controlador MSSP conduz a instalação do chart do tenant neste mesmo cluster.

Acompanhe o agente subir:

```bash
kubectl -n soctalk-agent logs deploy/soctalk-cloud-agent -f
# look for: agent_registered installation_id=...
```

Quando `agent_registered` aparecer nos logs, o agente conversou com o MSSP com sucesso.

### 4.7 Wazuh: existente ou novo?

::: code-group
```text [4.7a: Tenant has existing Wazuh]
Required: TWO endpoint + credential pairs.

1. Wazuh Indexer, typically https://<host>:9200
   - User + password with read access to wazuh-alerts-*
2. Wazuh Manager API, typically https://<host>:55000
   - User + password with permission to mint JWTs

Both must be reachable from this tenant VM. The Manager API must ALSO
be reachable from the MSSP via the tailnet; the L1 chat agent dials
it directly when answering questions about your alerts.

If your existing Wazuh runs on a SEPARATE host from this tenant VM
(common), pick one of these:

a) Install Tailscale on the Wazuh host too, join the same tailnet
   tagged tag:tenant-<slug>. Simplest; gives the MSSP a stable
   tailnet hostname to dial.

b) Advertise the Wazuh subnet from this tenant VM. On this VM:

     sudo tailscale up --auth-key=... --advertise-tags=tag:tenant-<slug> \
       --hostname=soctalk-tenant-<slug> \
       --advertise-routes=<wazuh-subnet>/<mask>

   Then approve the route in the Tailscale admin UI under
   Machines → this host → Edit route settings.

Without (a) or (b), the MSSP can reach this VM but cannot reach
your Wazuh Manager, and chat tool calls against your tenant will
fail.

Hand both endpoint + credential pairs (plus the chosen reachability
option) back to your MSSP. They paste the credentials at step 3 of
the Create Customer wizard (§3.1), which configures the SocTalk
tenant chart to use your Wazuh in "provided" mode. If the MSSP has
already onboarded you as `provided` and your reachability story
changes later, they update the External SIEM panel on the tenant
detail page instead (§3.4).
```

```text [4.7b: No existing Wazuh]
The SocTalk tenant chart installs Wazuh + one linux-ep agent
simulator automatically (the `poc` profile). No tenant action needed
beyond waiting ~5 minutes for the Wazuh stack to come up.

Watch progress:
  kubectl -n tenant-<slug> get pods -w
```
:::

### 4.8 Checkpoints: dois estados para observar

O tenant passa por dois estados de prontidão distintos. Não os confunda:

#### 4.8a Cloud agent registrado (~1 minuto após §4.6)

Entre novamente no dashboard MSSP. Seu tenant muda para **Online** em 1-2 minutos após §4.6 ter sido bem-sucedida. Isso significa que **o cloud-agent alcançou o MSSP e se registrou**: o handshake de confiança está concluído.

Isso **ainda não** significa que o stack Wazuh do tenant está no ar nem que as ferramentas de chat resolverão consultas contra este tenant.

![Dashboard MSSP: tenant mudou para Online](/screenshots/mssp-dashboard-tenant-online.png)

#### 4.8b Data plane do tenant totalmente pronto (~5-7 minutos a mais)

Após o registro do agente, o controlador MSSP conduz a instalação do chart do tenant no cluster do tenant:

- **perfil `poc`**: Wazuh + simulador linux-ep sobem. Tempo total ~5-7 minutos.
- **perfil `provided`**: o adapter do SocTalk sobe imediatamente. As chamadas de ferramentas de chat do Wazuh resolvem assim que o adapter alcança os endpoints do External SIEM que o MSSP forneceu em §3.1 passo 3. Se não resolverem, verifique a alcançabilidade conforme §3.4.

Acompanhe a partir da VM do tenant:

```bash
kubectl -n tenant-<slug> get pods -w
# poc profile: wait until wazuh-manager-0, wazuh-indexer-0, linux-ep-N all Ready
# provided profile: wait until soctalk-adapter is Ready
```

Somente após §4.8b o tenant está pronto para a demo em §5. Se §4.8a dispara mas §4.8b nunca é concluída, veja [Diagnóstico do piloto](#_7-pilot-troubleshooting).

## 5. O momento da demo

O momento voltado para os stakeholders. Reproduza estas consultas literalmente; a redação determina qual ferramenta o LLM escolhe.

Entre no dashboard MSSP. Abra a aba **Chat**.

**Consulta 1. Confirmar que o tenant está alcançável.**

```text
list all tenants
```

Esperado: um badge de ferramenta `list_tenants`, depois uma resposta listando seus tenants do piloto por slug + display name.

![Chat: badge da ferramenta list_tenants + resposta](/screenshots/chat-list-tenants.png)

**Consulta 2. Mostrar alertas de um tenant específico.**

```text
show me the 5 most recent alerts at <tenant-slug> with rule ids
```

Esperado: um badge de ferramenta `recent_alerts` com um chip `@ <tenant-slug>`, depois um resumo em linguagem natural listando rule IDs, severidades e timestamps.

::: tip Este é o screenshot para os stakeholders
O chip `@ <tenant-slug>` no badge da ferramenta é a prova: o analista SOC de AI do SocTalk está alcançando os alertas Wazuh encaminhados do tenant e respondendo uma pergunta sobre dados reais. Capture esta tela.
:::

![Chat: recent_alerts @ acme com rule IDs + análise do LLM](/screenshots/chat-wazuh-alerts.png)

::: info Por que `recent_alerts` e não `get_wazuh_alert_summary`?
O perfil `poc` do piloto entrega o Wazuh no cluster do tenant e o adapter do SocTalk encaminha os alertas (sujeitos a uma severidade mínima, configurável via `SOCTALK_ADAPTER_MIN_SEVERITY`) para o banco de dados do MSSP. `recent_alerts` lê desse stream encaminhado, então funciona independentemente de o MSSP conseguir alcançar a API do Wazuh do tenant diretamente. `get_wazuh_alert_summary` é a contraparte de integração ao vivo, útil para o perfil `provided` quando o MSSP mantém a URL + credenciais do Wazuh do tenant em **Integrations**.
:::

Se a lista de alertas estiver vazia (o Wazuh do tenant ainda não viu tráfego), gere alertas de teste. O caminho de Wazuh instalado via chart (§4.7b) entrega um ou mais pods `linux-ep-N` com o simulador de ataque; dispare-o na primeira réplica pronta via um label selector:

```bash
# On the tenant VM, against any linux-ep pod
kubectl -n tenant-<slug> exec -it \
  "$(kubectl -n tenant-<slug> get pod -l app=linux-ep -o jsonpath='{.items[0].metadata.name}')" \
  -- /opt/scripts/run-attack.sh
```

Aguarde 30-60 segundos e execute a consulta de chat novamente. Para o caminho de Wazuh existente (§4.7a), dispare alertas como você normalmente faria no seu próprio Wazuh, por exemplo tentando algumas senhas erradas via SSH em um host monitorado.

## 6. Dia 2: para onde ir a partir daqui

- **Adicionar o Wazuh do cliente real.** Faça o onboarding de mais tenants repetindo §3 e §4. Mesmo padrão; cada novo tenant precisa de uma nova tag do Tailscale, entrada na ACL, auth key ephemeral e emissão de agente.
- **Planejar a instalação de produção.** Quando estiver pronto para ir além do piloto, veja [Instalação](/pt-br/install) para o caminho K3s + Cilium + cert-manager + ingress real.
- **Operações de ciclo de vida do tenant.** [Ciclo de vida do tenant](/pt-br/tenant-lifecycle) cobre suspender, retomar e desativar tenants a partir do dashboard MSSP.
- **Upgrades.** [Upgrades](/pt-br/upgrades) cobre a evolução do soctalk-system e do cloud-agent.
- **Backups.** [Backup & restore](/pt-br/backup-restore) para dados com estado.

### O que NÃO está no piloto

- Alta disponibilidade (único nó k3s de cada lado)
- TLS real (o hostname do tailnet usa certs self-signed; produção precisa de cert-manager + ingress real)
- Multi-região
- Escala por tenant além de ~50 agentes Wazuh por tenant
- Ingress por tenant (este piloto usa o hostname do tailnet para tudo)

Quando você migrar para produção, sua configuração de produto MSSP (lista de tenants, histórico de chat, chave de LLM) pode ser levada adiante com planejamento. Fale com a equipe antes de desativar este piloto.

## 7. Diagnóstico do piloto

Tabela orientada a sintomas para falhas específicas da topologia do piloto. Problemas genéricos do SocTalk estão cobertos em [Troubleshooting](/pt-br/troubleshooting).

| Sintoma | Causa provável | Verificação |
|---|---|---|
| Tenant preso em "Pending" no dashboard MSSP | Bootstrap token expirou antes de §4.6 rodar | Reemita a partir do dashboard MSSP (§3.2); tokens têm default de 24h |
| `tailscale ping soctalk-mssp.<tailnet>.ts.net` falha a partir do tenant | ACL restritiva demais, ou máquina MSSP offline | Verifique o ACL preview na UI de admin do Tailscale; verifique o `tailscale status` do MSSP |
| Logs do agente mostram `connection refused` para `controlPlaneUrl` | O `helm upgrade` do lado MSSP de §2.4 não pegou | Na VM MSSP: `kubectl -n soctalk-system get ingress`; confirme que o hostname corresponde |
| Logs do agente mostram `403 Forbidden` do MSSP | Bootstrap token já usado (uso único) | Reemita a partir de §3.2 |
| `kubectl -n soctalk-agent get pods` mostra `ImagePullBackOff` | O cluster do tenant não consegue puxar de `ghcr.io` (proxy corporativo) | Configure o registries.yaml do k3s com o proxy; ou faça pre-pull na VM do tenant |
| O chat diz "no Wazuh alerts" mas o tenant tem alertas | Caso de Wazuh existente: a Manager API não é alcançável a partir do tailnet do MSSP | Da VM MSSP: `curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"` (GET; deve retornar um JWT) |
| A ferramenta `get_wazuh_alert_summary` retorna erro | Caso de Wazuh existente: credenciais do Indexer erradas | Da VM tenant: `curl -ku <user>:<pw> https://<wazuh-indexer>:9200/wazuh-alerts-*/_search?size=1` |
| O heartbeat do adapter funciona mas o agente nunca chega a "Online" | NetworkPolicies deixadas habilitadas em §4.5 | `kubectl -n soctalk-agent get networkpolicies`; deve estar vazio |
| `helm install` rejeitado com erro de values-schema | Divergência de versão de chart entre control plane e chart do agente | Use a versão de chart impressa pelo endpoint issue-agent, não "latest" |

## 8. Desativação do piloto

Quando o piloto terminar:

1. **Lado tenant, cada tenant**: `helm uninstall soctalk-agent-<slug> -n soctalk-agent`. Desligue e arquive (ou destrua) a VM do tenant.
2. **UI de admin do Tailscale**: revogue a auth key de cada tenant em **Settings → Keys**; remova cada tag de tenant de **Access Controls**.
3. **Dashboard MSSP**: para cada tenant, **Decommission** na página de detalhes do tenant (o estado transiciona para `decommissioning` → `archived`).
4. **VM MSSP**: arquive ou destrua se não estiver migrando para produção. Se estiver migrando, veja [Instalação](/pt-br/install) para o caminho de cluster de produção.

Mantenha estes artefatos para revisão pós-piloto:

- O log de auditoria de cada página de detalhes de tenant (baixável)
- Seu `values.yaml` preenchido de §2.4
- A stanza de ACL do Tailscale de §1.2
- Screenshots de §5
