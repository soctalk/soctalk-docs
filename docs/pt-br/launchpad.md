# Launchpad: piloto MSSP com um único comando

Depois de ter visto o SocTalk de ponta a ponta em uma única máquina co-localizada ([Quickstart](/pt-br/quickstart-vm)), **o Launchpad é o próximo passo**: ele leva você daquela demonstração local até um piloto real — um control plane MSSP mais um ou mais ambientes de tenant na sua própria infraestrutura. Conduza-o a partir de um **console web** (recomendado) ou, mais tarde, com um único comando headless: ele inicializa as VMs, junta-as ao seu tailnet, instala o SocTalk a partir de fontes públicas e entrega uma URL a você.

Prefere entender cada passo antes de deixar uma ferramenta executá-lo? O [piloto MSSP faça-você-mesmo](/pt-br/mssp-pilot) percorre a mesma instalação manualmente — os mesmos charts, o mesmo fluxo do Tailscale. O Launchpad apenas faz o copiar-e-colar por você.

::: tip Tempo prático
| Caminho | Prático | Tempo total |
|---|---|---|
| [Faça você mesmo](/pt-br/mssp-pilot) | ~90 min | ~2 horas |
| Console do Launchpad | ~5 min preenchendo um formulário | ~15-25 min (na maior parte esperando downloads) |
:::

## O que ele faz

Dadas as credenciais do seu administrador MSSP e uma lista de tenants, o Launchpad:

1. Baixa a imagem cloud do Ubuntu Noble no seu host de VM (armazenada em cache nas execuções subsequentes)
2. Provisiona VMs QEMU — uma para o MSSP, uma por tenant — com cloud-init + Tailscale
3. Aguarda cada VM se juntar ao seu tailnet com a tag que ela anuncia
4. Executa o [`install.sh`](https://github.com/soctalk/soctalk/blob/main/install.sh) no MSSP em modo `--demo`
5. Faz o onboarding de cada tenant via a API do MSSP
6. Chama `:issue-agent` para cada tenant para obter o token de bootstrap
7. Instala k3s + Helm + `soctalk-cloud-agent` em cada VM de tenant
8. O MSSP despacha o job `install_helm_release` → o cloud-agent baixa e aplica o chart `soctalk-tenant` (Wazuh manager + indexer + dashboard, adapter, runs-worker)

Ao final, você tem um dashboard MSSP funcional, tenants registrados e `active`, e o Wazuh rodando por tenant. Tudo baixado de fontes públicas — sem imagens pré-preparadas, sem charts empacotados.

## O que ele não é

- **Não é um instalador de produção.** É uma ferramenta de avaliação. As mesmas ressalvas de não-produção do piloto faça-você-mesmo: sem HA, certificados autoassinados, tailnet como ingress.
- **Não é um gerenciador de cluster.** Ele dispara uma vez e sai. Não observa o cluster, não faz upgrades, não faz reconciliação de drift. Use `helm upgrade` depois disso.
- **Não é um operador Kubernetes.** O Launchpad roda na sua mesa, não no cluster.

## Pré-requisitos

Reúna estes primeiro:

- [ ] **Um host de VM acessível a partir da sua estação de trabalho.** Uma máquina Linux com:
      - `qemu-system-x86_64`, `qemu-img`, `genisoimage`, `curl`
      - `/dev/kvm` (KVM aninhado funciona, bare metal é mais rápido)
      - Folga suficiente para suas VMs: **8 GB de RAM + 4 vCPU + 60 GB de disco por VM**
      - SSH sem senha a partir da sua estação de trabalho como um usuário no grupo `kvm`
- [ ] **Um tailnet do Tailscale.** O nível gratuito serve. Você vai precisar de:
      - O nome do tailnet (ex.: `taila1b2c3.ts.net`)
      - Um [token de acesso à API do Tailscale](https://login.tailscale.com/admin/settings/keys) com escopo `keys:write` — o Launchpad o usa para criar chaves de autenticação de dispositivo efêmeras por VM
      - Propriedade das tags que você vai usar — adicione-as à sua ACL:
        ```json
        "tagOwners": {
          "tag:mssp":        ["autogroup:admin"],
          "tag:tenant-acme": ["autogroup:admin"]
        }
        ```
- [ ] **Uma chave pública SSH** que você queira autorizada em cada VM provisionada (normalmente a da sua estação de trabalho).
- [ ] **Uma chave de API de LLM** para o MSSP. Escolha um provedor que você tenha (Anthropic, OpenAI, ou aponte para um Ollama local). Uma chave de placeholder funciona para um smoke test em que a AI não é exercitada.

::: warning Tailscale MagicDNS
O Launchpad espera que o MagicDNS esteja habilitado no seu tailnet para que os clusters de tenant possam alcançar o MSSP por hostname. Ele fica ligado por padrão. Se você o desligou, será preciso adicionar `hostAliases` você mesmo (veja o [piloto faça-você-mesmo](/pt-br/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant) para o padrão).
:::

## 1. Instale a CLI

Baixe o binário `launchpad` para a sua plataforma a partir do
[último release](https://github.com/soctalk/soctalk-launchpad/releases/latest),
e então deixe-o buscar seus plugins:

```bash
# pick the asset for your OS/arch: launchpad_{darwin,linux,windows}_{amd64,arm64}
base=https://github.com/soctalk/soctalk-launchpad/releases/latest/download
curl -fsSL "$base/launchpad_$(uname -s | tr A-Z a-z)_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o launchpad
chmod +x launchpad && sudo mv launchpad /usr/local/bin/launchpad

launchpad version
launchpad init   # downloads + signature-verifies every plugin into ~/.launchpad/plugins
```

O `init` puxa o conjunto de plugins para a sua plataforma do mesmo release assinado e
verifica cada binário contra o índice assinado com ed25519 do release antes de ser
instalado. Nada é executado sem verificação. (`launchpad plugin list` mostra o
conjunto instalado; `launchpad plugin sync` refaz o download ou repara o repositório.)

## 2. Execute o piloto no console web

`launchpad ui` inicia um console web local e o abre no seu navegador — a forma primária de conduzir um piloto. Você registra sua infraestrutura uma vez como **Hosts** e **Networks** reutilizáveis e testáveis, e então lança e acompanha.

```bash
launchpad ui
```

Na primeira execução, a CLI baixa e verifica o conjunto de plugins em `~/.launchpad/plugins`, e então serve o console a partir do mesmo binário — nada mais a instalar. No navegador, percorra três telas:

1. **Networks** — adicione seu tailnet: o nome do overlay (ex.: `taila1b2c3.ts.net`) e sua chave de API do Tailscale. Pressione **Test** para confirmar que a chave funciona antes de depender dela. Uma execução se vincula a uma network, e cada máquina se junta a ela.
2. **Hosts** — adicione o local onde você vai provisionar. Para este guia, essa é a sua máquina KVM: o alvo SSH e um diretório de trabalho gravável. Novos hosts pré-preenchem os campos que sua plataforma espera, e **Test** valida a conexão e as credenciais. As credenciais são armazenadas com o host e nunca deixam a máquina que roda o Launchpad.
3. **Runs** — crie uma execução: atribua o **control node** (seu MSSP) e cada **tenant** a um host, escolha a network, preencha as credenciais do administrador MSSP e a chave de LLM, e pressione **Launch**.

![Networks — o overlay ao qual cada máquina de uma execução se junta, registrado uma vez](/screenshots/launchpad-ui-networks.png)

![Hosts — os substratos nos quais você provisiona, registrados uma vez](/screenshots/launchpad-ui-hosts.png)

O console transmite o progresso ao vivo — cada VM sendo provisionada, se juntando ao tailnet e instalando o SocTalk — e entrega a URL do MSSP a você ao final. As execuções são idempotentes (relançar reconcilia contra as máquinas que já existem em vez de duplicá-las), e a ação **Down** desfaz as máquinas de uma execução.

![Uma execução em andamento — as VMs do MSSP e do tenant sendo provisionadas, com o rastreador de fases e um fluxo de eventos ao vivo](/screenshots/launchpad-ui-run.png)

::: tip Verificação de conformidade
Antes de apontar um plugin para infraestrutura real, você pode fazer uma checagem de sanidade a partir da CLI:
```bash
launchpad plugin verify qemu
```
Isto executa a suíte de conformidade de protocolo (checksum, handshake, `plan`, `destroy` idempotente) sem precisar de credenciais reais.
:::

## 3. Verifique se funcionou

Quando a execução for concluída (o console a marca como concluída, ou `launchpad up` sai com `0`), faça uma checagem de sanidade dos dois sistemas:

**Dashboard do MSSP** — abra a URL que a execução imprimiu ao final (ou `https://lp-mssp.<your-tailnet>.ts.net/`). Faça login com as credenciais de administrador que você definiu para a execução. Seu tenant deve aparecer listado e mudar para **Online** dentro de 1-2 minutos.

![Dashboard do MSSP provisionado pelo Launchpad](/screenshots/launchpad-mssp-dashboard.png)

**Wazuh no tenant** — faça SSH na VM do tenant (`ssh ops@lp-tenant-acme.<your-tailnet>.ts.net`) e verifique os pods:

```bash
sudo k3s kubectl -n tenant-acme get pods
```

Você deve ver:

```
NAME                                          READY   STATUS
tenant-acme-wazuh-manager-0                   1/1     Running
tenant-acme-wazuh-indexer-0                   1/1     Running
tenant-acme-wazuh-dashboard-<hash>            1/1     Running
tenant-acme-linuxep-0                         1/1     Running
soctalk-adapter-<hash>                        1/1     Running
soctalk-runs-worker-<hash>                    1/1     Running
```

O StatefulSet `linuxep-0` é um endpoint Linux de demonstração com o agente Wazuh instalado — um lugar para simular alertas. Veja [Simulador de ataque](/pt-br/mssp-pilot#5-3-generate-alerts) para detalhes.

### SSH nas VMs

Toda VM provisionada pelo Launchpad tem um usuário `ops` pré-configurado com as chaves SSH da configuração do seu host autorizadas e **sudo sem senha**. É assim que a fase de instalação do Launchpad alcança a máquina; você usa a mesma conta para solução de problemas.

```bash
# Interactive shell as ops
ssh ops@lp-mssp.<your-tailnet>.ts.net
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net

# One-off command as root
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net "sudo journalctl -u k3s -n 100"
```

::: tip Alternativa: conecte por IPv4 se o MagicDNS estiver desligado
Se o MagicDNS estiver desabilitado no seu tailnet, `lp-<key>.<tailnet>.ts.net` não vai resolver na sua estação de trabalho. Use `tailscale status | grep lp-` para encontrar o IPv4 do tailnet e `ssh ops@100.x.y.z` diretamente.
:::

## 4. Use seu piloto: faça o onboarding de clientes e pergunte à AI

O Launchpad entrega a você um MSSP funcional com seu primeiro tenant já integrado — a partir daqui você o conduz exatamente como um MSSP faria. O **Dashboard** é uma visão de frota cross-tenant: revisões pendentes, casos travados, tenants degradados e a saúde por tenant.

![O dashboard do MSSP — visão de frota cross-tenant](/screenshots/pilot-final-dashboard.png)

**Faça o onboarding de outro cliente.** **Tenants → Create customer** executa um breve assistente de quatro passos:

![Create customer — 1. Identidade](/screenshots/pilot-add-tenant-step1.png)
![Create customer — 2. Perfil](/screenshots/pilot-add-tenant-step2.png)
![Create customer — 3. Branding](/screenshots/pilot-add-tenant-step3.png)
![Create customer — 4. Revisão](/screenshots/pilot-add-tenant-step4.png)

O novo cliente se junta à frota, e o cloud-agent provisiona sua stack de Wazuh + adapter da mesma forma que o Launchpad fez para o primeiro tenant:

![A lista de tenants com o cliente integrado](/screenshots/pilot-final-tenants-list.png)

Aprofunde em um tenant para ver suas investigações abertas, revisões e a saúde do Wazuh:

![Detalhe do tenant](/screenshots/pilot-final-acme-detail.png)

**Pergunte ao analista SOC de AI.** A visão **Chat** responde perguntas em toda a frota ou com escopo em um único tenant, chamando ferramentas contra dados ao vivo e resumindo o que encontra:

![Ask AI — um resumo de toda a frota, com a chamada de ferramenta que ele executou](/screenshots/pilot-chat-mssp-reply.png)
![Ask AI — com escopo em um único tenant](/screenshots/pilot-chat-tenant-reply.png)

::: tip
A AI precisa de um [provedor de LLM](/pt-br/integrate/llm-providers) real configurado — a chave de placeholder do smoke test não responderá perguntas.
:::

## 5. Ajuste fino com um arquivo de configuração

Uma vez que um piloto funcione a partir do console, você pode capturar a mesma configuração como um arquivo YAML e conduzi-lo em modo headless com `launchpad up` — sem console. Recorra a isto quando quiser:

- **Execuções repetíveis e roteirizadas** — versione a configuração no git, execute-a em CI e faça asserções sobre o fluxo de eventos JSON.
- **Controle fino que o formulário não expõe** — fixe uma imagem base ou seu SHA, aponte para uma tag de release específica do `install.sh`, roteirize muitos tenants de uma vez, ou ajuste CPU / memória / disco por VM.

O console e a configuração compartilham os mesmos Hosts e Networks sob `~/.launchpad`, então uma execução por configuração reutiliza exatamente o que você já testou.

Salve isto como `pilot.yaml` e substitua os valores entre colchetes:

```yaml
run_id: my-pilot

# Provisioning target — the plugin that creates VMs. Others: vmware, hetzner, proxmox, docker.
target: qemu

# Passed opaquely to the qemu plugin's initialize.
plugin_config:
  ssh_host: [user]@[vm-host-ip]      # SSH target on your KVM host
  work_dir: /home/[user]/lp-vms       # writable path; caches images + hosts VM disks
  tailnet: [your-tailnet].ts.net
  cpu: 4
  memory_mb: 8192
  disk_gb: 60
  # base_image_url is optional; defaults to the current Ubuntu Noble cloud image.
  # base_image_sha256: <optional pin>

# SSH keys authorized on every provisioned VM (the launchpad SSHes in as `ops`).
ssh_keys:
  - "ssh-ed25519 AAAA... you@laptop"

mssp:
  key: mssp
  name: my-pilot-mssp
  role: mssp
  tags: { role: mssp }

tenants:
  - key: tenant-acme
    name: acme-corp
    role: tenant
    tenant_slug: acme
    tags: { role: tenant, tenant_slug: acme }

# Post-provision installation phase.
install:
  # Point at a pinned release tag for reproducible smoke tests. `main` also works.
  installer_url: https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh
  mssp_admin_email: admin@my-pilot.demo
  mssp_admin_password: [pick-a-strong-one]
  mssp_display_name: My Pilot MSSP
  llm_provider: anthropic
  llm_api_key: [your-anthropic-key]
```

::: warning Sobre a senha de administrador
Salve-a em um gerenciador de senhas antes de executar. O Launchpad não a exibirá de volta a você se você a perder de vista.
:::

Para adicionar tenants, estenda a lista `tenants:`. Cada um precisa de uma `key` única, um `tenant_slug` que corresponda à sua ACL do Tailscale, e uma entrada correspondente sob `tagOwners`.

### Execute

```bash
export TAILSCALE_API_KEY=tskey-api-...

launchpad up --config pilot.yaml --state ~/.launchpad/state.json
```

O padrão renderiza uma TUI Bubble Tea com barras de progresso por VM, um log de eventos ao vivo e um prompt de gate para passos interativos. Para execuções não assistidas (CI, scripts, os smoke tests deste guia) use `--headless` para transmitir eventos JSON para o stdout:

```bash
launchpad up --config pilot.yaml \
  --state ~/.launchpad/state.json \
  --headless --auto-resolve-gates | tee run.log
```

`--auto-resolve-gates` aceita todo gate (atualmente apenas a confirmação da ACL do Tailscale) sem perguntar. Pule-o se você quiser revisar sua ACL antes que os tenants sejam provisionados.

Tempos aproximados de fase em uma primeira execução (cache limpo, internet doméstica decente):

| Fase | Duração | O que está acontecendo |
|---|---|---|
| `provisioning` | 60-90s | Download da imagem (~600 MB) + cloud-init + junção ao Tailscale |
| `installing` (MSSP) | 3-5 min | Instalação do k3s, Helm, chart `soctalk-system` |
| `installing` (por tenant) | 3-5 min | k3s + Helm + `soctalk-cloud-agent`, e então o MSSP despacha o chart `soctalk-tenant` (Wazuh + adapter) |
| Total | **~10-15 min** | para MSSP + 1 tenant |

Execuções subsequentes são muito mais rápidas porque a imagem base fica em cache no host de VM.

## 6. Itere — retome, desfaça, reinicie

O Launchpad é idempotente. Relançar uma execução — o **Launch** do console novamente, ou `launchpad up` — retoma de onde parou:

- VMs que já existem são reutilizadas (sem duplo provisionamento)
- O passo de instalação do MSSP é pulado se a API já estiver respondendo
- O onboarding de tenant é pulado se o tenant já existir
- O chart `soctalk-cloud-agent` recebe `helm upgrade --install`, não é reinstalado

Para desfazer tudo de forma limpa (VMs, dispositivos Tailscale, diretório de trabalho), use a ação **Down** do console ou:

```bash
launchpad down --config pilot.yaml --state ~/.launchpad/state.json
```

Para adicionar um tenant a um piloto em execução, adicione-o no console (ou edite `tenants:` no `pilot.yaml`) e relance. As VMs existentes são deixadas intactas; o novo tenant é provisionado e instalado.

## 7. Solução de problemas

### `vm.wait_ready` esgota o tempo

A VM inicializou mas nunca se juntou ao tailnet. O cloud-init na VM não conseguiu alcançar os servidores de coordenação do Tailscale.

- Confirme que seu host de VM tem internet
- Faça SSH no host de VM e inspecione o log serial do QEMU em `<work_dir>/<run_id>/<vm_key>/serial.log` — ele captura a saída do cloud-init, incluindo o tailscale-up
- Causa comum: a chave de autenticação efêmera foi revogada antes de a VM usá-la (verifique o log do Tailscale admin → Machines)

### A instalação do MSSP esgota o tempo no `helm upgrade`

A instalação do chart rodou mas os pods não convergiram em 15 minutos. Normalmente image pulls em conexões lentas.

- Faça SSH na VM do MSSP: `sudo k3s kubectl -n soctalk-system get pods` e verifique se há `ImagePullBackOff` ou `CrashLoopBackOff`
- Se os pods ainda estiverem baixando, aguarde e relance — a segunda tentativa pula o passo de instalação assim que a API estiver respondendo

### O agente do tenant registra `no such host` em `/api/agent/register`

O DNS do cluster do pod não consegue resolver o hostname do tailnet do MSSP. É exatamente para isso que serve o `hostAliases`. O Launchpad insere isto no comando helm por padrão; se você estiver fazendo manualmente, veja o [piloto faça-você-mesmo](/pt-br/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant).

### Automação

O modo `--headless` é a superfície de automação do Launchpad. Cada fase, mudança de estado de VM, linha de log de instalação e prompt de gate é um evento JSON no stdout:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Faça asserções sobre esses eventos a partir do seu CI. Veja o [esquema de eventos do Launchpad](/pt-br/reference/launchpad-events) para a lista completa.

## Para onde ir a seguir

- **Adicione um tenant real.** Faça o onboarding a partir do dashboard do MSSP — veja o [piloto faça-você-mesmo §3](/pt-br/mssp-pilot#3-onboard-tenants) para o passo a passo do assistente.
- **Gere alguns alertas.** O [Simulador de ataque](/pt-br/mssp-pilot#5-3-generate-alerts) tem o runbook.
- **Aponte a AI para dados reais.** Configure seu [provedor de LLM](/pt-br/integrate/llm-providers) adequadamente (a chave de placeholder do smoke test não responderá perguntas).
- **Vá para produção.** [Install](/pt-br/install) é o caminho não-launchpad, capaz de HA.
