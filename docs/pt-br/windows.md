# Executar no Windows (WSL2)

O SocTalk é nativo de Kubernetes. No Windows ele roda como **k3s (Kubernetes leve) dentro do WSL2**: instalado e configurado para você por um único comando PowerShell. Não requer Docker Desktop.

::: tip Apenas avaliando?
O **[appliance de VM](/pt-br/downloads)** (Hyper-V `vhdx` ou [VirtualBox](/pt-br/virtualbox)) é a forma mais simples e robusta de experimentar o SocTalk no Windows, é uma VM Linux autocontida, sem nada a configurar. O caminho via WSL2 desta página é a opção de conveniência de cluster local para desenvolvedores que preferem não executar uma VM completa.
:::

::: warning Arquitetura
As imagens do SocTalk são **apenas amd64**, então isso funciona no **Windows x64**. No Windows on ARM o conjunto de imagens exigiria emulação.
:::

## Pré-requisitos

- **Windows 10 2004 (build 19041) ou mais recente, ou Windows 11**: x64
- PowerShell como **Administrador** (o instalador habilita recursos do Windows e configura o WSL2)
- **Virtualização de CPU habilitada** no firmware (o WSL2 precisa dela; em uma VM, habilite a virtualização aninhada)

Você **não** precisa pré-instalar WSL2, Ubuntu ou Docker, o instalador cuida de tudo isso.

## Instalação com um clique

Abra o **PowerShell como Administrador** e execute:

```powershell
irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1 | iex
```

O que acontece:

1. **Habilita o WSL2** (uma reinicialização, faça login novamente e a instalação **é retomada automaticamente** no seu próximo logon; o WSL2 não pode rodar como conta SYSTEM, então a retomada ocorre na sua sessão).
2. **Importa uma distro Ubuntu** e habilita o systemd dentro dela.
3. **Instala o k3s** como serviço systemd dentro do WSL2, então implanta o SocTalk e provisiona um **tenant `demo`**.
4. **Expõe a UI ao Windows** em **`https://localhost/`** (um `netsh portproxy` encaminha para o cluster dentro do WSL2; uma tarefa de logon o atualiza após reinicializações).

Ao terminar, ele imprime a URL e as credenciais de demonstração. Abra **`https://localhost/`** no seu navegador, aceite o certificado autoassinado e faça login.

Para uma instalação **real (não demo)**, passe `-Real` para ser solicitado o nome do MSSP, e-mail/senha de administrador e a chave do LLM (ou defina as variáveis de ambiente `SOCTALK_*`):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1))) -Real
```

## O que ele faz (nos bastidores)

O instalador PowerShell inicializa o WSL2 e então executa o **mesmo `install.sh`** que o appliance Linux usa, com o k3s como runtime:

```bash
# inside the WSL2 Ubuntu distro, as root:
curl -sfL https://get.k3s.io | sh -          # k3s as a systemd service
helm upgrade --install soctalk-system \
  oci://ghcr.io/soctalk/charts/soctalk-system --version 0.2.0 \
  --namespace soctalk-system --create-namespace -f values.yaml
```

O host do ingress é `localhost`, e um `netsh portproxy` do Windows (`localhost:443` → o IP do WSL2) o torna acessível a partir do seu navegador.

## Ressalvas

- **Uma reinicialização** é necessária para concluir a habilitação do WSL2; faça login novamente depois e a instalação continua por conta própria.
- **Mantenha a distro WSL do cluster em execução**: o k3s vive dentro dela. O instalador define `vmIdleTimeout=-1` para que o WSL2 não fique ocioso, e uma tarefa de logon reinicia o WSL + atualiza o encaminhamento de `localhost` após um reinício do Windows.
- O caminho via WSL2 é a opção de **conveniência de cluster local**. Para uma instalação sempre ativa / de estilo produção no Windows, prefira o **[appliance de VM](/pt-br/downloads)** (Hyper-V/VirtualBox), uma única VM Linux, sem as partes móveis de rede do WSL2.
- Imagens amd64 → apenas Windows **x64**.

## Desmontagem

```powershell
# remove the host forward + logon tasks
netsh interface portproxy reset
Get-ScheduledTask SocTalk* | Unregister-ScheduledTask -Confirm:$false

# remove the cluster (inside WSL) and/or the whole distro
wsl -d Ubuntu -u root -- /usr/local/bin/k3s-uninstall.sh
wsl --unregister Ubuntu      # optional: remove the distro entirely
```

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| A instalação não continuou após a reinicialização | faça login novamente como o **mesmo usuário**: a retomada ocorre no seu logon. Reexecutar `install.ps1` é seguro (etapas concluídas são ignoradas). |
| `https://localhost/` não carrega | o IP do WSL2 pode ter mudado; a tarefa agendada `SocTalkExpose` atualiza o encaminhamento, execute-a (`Start-ScheduledTask SocTalkExpose`) ou reexecute e tente novamente. |
| `503` de `https://localhost/` | o encaminhamento funciona, mas os pods ainda não estão prontos, `wsl -d Ubuntu -u root -- k3s kubectl -n soctalk-system get pods` e aguarde por `Running`. |
| O WSL2 não inicia | habilite a virtualização de CPU (VT-x/AMD-V) no firmware; em uma VM, habilite a virtualização aninhada. |
| Qualquer coisa após o assistente | igual a todas as plataformas, veja a [tabela de solução de problemas do Quickstart](/pt-br/quickstart-vm#troubleshooting). |
