# Instalar a partir de um pacote do sistema operacional (rpm / deb)

Todo release do SocTalk publica pacotes nativos do sistema operacional junto com as
imagens de VM, anexados ao mesmo GitHub Release que a tag de versão, para as duas
famílias Linux baseadas em systemd:

| Arquivo | Gerenciador de pacotes | Verificado em | Também esperado que funcione |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9.8 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Ambos são verificados de ponta a ponta: instale o pacote, execute `soctalk install`,
acesse o app web e faça login. A coluna "também esperado" é a mesma família de
pacotes, mas não foi testada especificamente nessas distribuições.

No Rocky Linux 9.8 a verificação cobriu as duas formas que o produto publica, em
VMs limpas com o SELinux no modo Enforcing. A instalação apenas do control plane
subiu `api`, `app-ui` e `postgres`, e o admin de bootstrap conseguiu fazer login. A
instalação completa adicionalmente integrou um tenant `poc` que levantou seu próprio
Wazuh manager, indexer e dashboard e chegou a `active`. Essa segunda execução foi
feita com o firewalld habilitado, o que exige as regras em
[as notas sobre RHEL](#rhel-fedora-almalinux-rocky) abaixo antes que o cluster
funcione. Essas notas cobrem o que o SELinux e o firewalld exigem e não exigem de
você.

**Alpine não é suportado** e nenhum `.apk` é publicado: `soctalk install`
requer systemd, e o Alpine usa OpenRC. Consulte [Alpine e outros hosts sem
systemd](#alpine-and-other-non-systemd-hosts) abaixo. **openSUSE / zypper** e
**RHEL 10** não são testados; as notas sobre RHEL/Fedora podem não se aplicar
totalmente. **Somente amd64**: não há pacote arm64.

Eles são publicados na página de releases de [`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases).
O release atual é **v0.2.0**:
[página do release](https://github.com/soctalk/soctalk/releases/tag/v0.2.0). O
repositório é público, então nenhuma autenticação é necessária para baixá-los.

## O que o pacote instala

O pacote é pequeno de propósito. O SocTalk roda sobre Kubernetes (K3s), então o
pacote não contém a stack de SOC em si. Ele instala uma CLI de gerenciamento enxuta
e o instalador, e então você executa um comando para subir a stack:

- `/usr/bin/soctalk`, a CLI de gerenciamento (`install`, `upgrade`, `status`,
  `logs`, `uninstall`, `version`).
- `/usr/libexec/soctalk/install.sh`, o mesmo instalador que a [VM de demonstração](/pt-br/quickstart-vm)
  e a [instalação de um comando](/pt-br/install) usam. Ele provisiona o K3s e o Helm se
  estiverem ausentes, e então instala via Helm o chart `soctalk-system` a partir do GHCR.
- `/etc/soctalk/soctalk.env.example`, um template para instalações não assistidas.

As únicas dependências são `curl` e `tar`; o instalador busca o K3s e o Helm
por conta própria. Este é o caminho certo quando você está instalando em um host Linux que
você gerencia diretamente e quer o SocTalk registrado no banco de dados de pacotes do sistema (para que
`dnf`/`apt` o acompanhem e atualizem). Se você só quer experimentar o SocTalk, a
[imagem de VM de demonstração](/pt-br/quickstart-vm) é mais rápida.

## Instalar o pacote

Escolha o bloco para a sua distribuição. Substitua `0.2.0` pela versão atual
se você estiver em um release mais novo.

### RHEL, Fedora, AlmaLinux, Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

O `dnf` puxa `curl` e `tar` se estiverem ausentes. Em hosts mais antigos use
`sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`.

Algumas imagens de RHEL 9 trazem o `curl-minimal` no lugar do `curl` completo, o que
pode conflitar com pacotes que exigem `curl` pelo nome. Aqui não há conflito.
No host Rocky Linux 9.8 usado para a verificação, com o `curl` removido e apenas o
`curl-minimal` instalado, o rpm foi instalado sem alterações: o `curl-minimal` traz
`Provides: curl`, então a dependência é resolvida sem troca de pacote e sem
`--allowerasing`.

### Debian, Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` resolve as dependências `curl` e `tar` a partir dos seus
repositórios configurados. Em uma imagem mínima sem `apt`, você pode usar
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install`.

## Verificar o download

Todo release inclui `SHA256SUMS.txt` cobrindo todos os artefatos, incluindo os
pacotes.

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` verifica apenas os arquivos que você realmente baixou. Cada linha
deve reportar `OK`.

## Subir a stack de SOC

Instalar o pacote não inicia o SocTalk. Após o pacote ser instalado,
execute o instalador através da CLI. Isso instala o K3s e o Helm se necessário, e então
instala via Helm o `soctalk-system` neste host.

Interativo (solicita nome do MSSP, admin e provedor de LLM):

```bash
sudo soctalk install
```

Demo descartável (senha de admin aleatória, integra automaticamente um tenant de demonstração):

```bash
sudo soctalk install --demo
```

`--demo` ainda pausa uma vez para uma solicitação de consentimento. Para uma execução totalmente não assistida (sem
terminal anexado, por exemplo a partir de um script de provisionamento) adicione `--yes`:
`sudo soctalk install --demo --yes`.

Não assistido, orientado por variáveis de ambiente (copie o template fornecido):

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

Quando `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL` e `SOCTALK_ADMIN_PASSWORD` estão
todas definidas, o instalador pula sua solicitação de consentimento, então isso roda sem nenhuma
interação. Qualquer argumento após `install` é repassado ao instalador, por
exemplo `soctalk install --chart-version 0.2.0` para fixar um chart ou
`soctalk install --values-file /etc/soctalk/values.yaml` para uma
instalação air-gapped. Consulte [Instalação em produção](/pt-br/install) para a referência completa de flags e o
caminho de cluster baseado em Cilium.

## Gerenciar a instalação

A CLI encapsula as operações comuns de cluster para que você não precise lembrar do
caminho do `KUBECONFIG` nem do nome do release do Helm.

```bash
soctalk status              # pods and their readiness in soctalk-system
soctalk logs api            # tail a component's logs (api, app-ui, postgres)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

O `soctalk logs` cobre o control plane em `soctalk-system`. Cargas de trabalho por
tenant, como o adapter e o runs-worker, vivem em namespaces `tenant-<slug>`, então
acesse essas com o `kubectl` apontando para aquele namespace.

`soctalk upgrade` é um `helm upgrade --install`, então é seguro reexecutar e é
como você migra para um chart mais novo após instalar um pacote mais novo.

## Desinstalar

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

Remover o pacote do sistema operacional (`dnf remove soctalk` ou `apt remove soctalk`) apaga
a CLI e o instalador, mas não toca em um cluster em execução. Execute
`soctalk uninstall` primeiro se você quiser eliminar a stack de SOC.

## Notas específicas do sistema operacional

### RHEL, Fedora, AlmaLinux, Rocky

#### SELinux

Verificado no Rocky Linux 9.8 com o SELinux no modo **Enforcing**, tanto para a
instalação apenas do control plane quanto para a instalação completa com um tenant
apoiado por Wazuh. Nenhum trabalho manual de SELinux é necessário. Durante o
`soctalk install`, o instalador do K3s puxou por conta própria o `k3s-selinux` 1.6 e
o `container-selinux`, e o cluster subiu sem ninguém tocar em um booleano, um rótulo
ou um módulo personalizado. Nenhuma das duas execuções registrou uma negação AVC.

Repare no que essa afirmação significa. Ela quer dizer que o SocTalk roda corretamente
sob a política targeted, não que o SELinux esteja confinando a carga de trabalho como
uma camada de proteção. Habilitar a própria imposição de SELinux do K3s
(`--selinux` / `K3S_SELINUX=true`) não foi testado. O RHEL 10 também precisa do
pacote `kernel-modules-extra` para o K3s, o que não foi testado.

#### firewalld

A imagem Rocky Linux 9.8 GenericCloud usada na verificação não inclui o firewalld,
então em uma VM de nuvem muitas vezes não há nada a fazer aqui. Uma instalação
completa de servidor tem o firewalld, habilitado. Com o firewalld rodando sob sua
política padrão, a instalação travou até que as redes de pods e de serviços do K3s
fossem confiadas, então em um host desses este passo é um pré-requisito, não um
conselho de proteção.

Vale reconhecer essa falha porque ela não parece um problema de firewall. O K3s
instala sem erros, o nó fica `Ready`, as imagens são baixadas e todos os pods são
agendados. O que quebra é o tráfego pod a pod e pod a Service na bridge do flannel,
de modo que o init container `db-init` da API não consegue alcançar o Postgres e
fica em loop com `No route to host` enquanto o próprio Postgres permanece ali
`1/1 Running`. A instalação então consome toda a sua janela de `--wait` do Helm
antes de falhar por timeout, com a causa real enterrada no log de um init container.

Confie nas redes de pods e serviços do K3s, e abra as portas de ingress pelas quais
você acessa a UI:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

Esses são os padrões do K3s; se você definir um CIDR de cluster ou de serviço
personalizado, use esses no lugar. Um cluster com múltiplos nós precisa de mais
portas abertas entre os nós (consulte os requisitos de rede do K3s).

Se a instalação ainda estiver aguardando quando você aplicar as regras, ela se
recupera na próxima tentativa e conclui; você não precisa começar de novo. Se o Helm
já tiver estourado o timeout, aplique as regras e reexecute `sudo soctalk install`.
Depois da v0.2.0, o preflight do instalador verifica isso e imprime esses comandos
antes de tocar no host ([soctalk#118](https://github.com/soctalk/soctalk/issues/118)).

O SocTalk não altera as regras do firewalld por você. Esse é o seu limite de
segurança para abrir.

#### sudo e /usr/local/bin

O K3s e o Helm instalam seus binários, e o symlink do `kubectl`, em
`/usr/local/bin`. As distribuições da família RHEL deixam esse diretório fora do
`secure_path` do sudo (`Defaults secure_path = /sbin:/bin:/usr/sbin:/usr/bin`), então
um `sudo k3s ...`, `sudo kubectl ...` ou `sudo helm ...` puro responde
`command not found` mesmo com o binário ali e a instalação bem-sucedida.

A CLI `soctalk` resolve esses caminhos por conta própria, então `sudo soctalk install`,
`soctalk status` e `soctalk logs` funcionam exatamente como estão escritos. Quando você
precisar do `kubectl` diretamente, informe o caminho completo ou adicione o diretório
ao seu próprio `PATH`:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

A documentação em outras partes deste site às vezes escreve isso como
`sudo k3s kubectl ...`, o que está correto no Debian e no Ubuntu, mas precisa do
caminho completo em hosts da família RHEL.

### Alpine e outros hosts sem systemd {#alpine-and-other-non-systemd-hosts}

**O instalador do SocTalk requer systemd.** Ele sobe o K3s como um serviço systemd
e aguarda o kubeconfig escrito pelo systemd, então ele não funciona no Alpine
(OpenRC) nem em qualquer outro init sem systemd. Em um host desse tipo, `soctalk install` para
cedo com uma mensagem clara informando você disso. Por essa razão, nenhum `.apk` é
publicado.

Para rodar o SocTalk onde você estava considerando o Alpine, use uma distribuição com systemd
(o caminho `.deb` ou `.rpm` acima) ou a
[imagem de VM de demonstração](/pt-br/quickstart-vm) pré-compilada.

## Qual caminho devo usar?

- **Pacote do sistema operacional (esta página)**: um host Linux que você gerencia, acompanhado pelo gerenciador
  de pacotes do sistema. Bom para instalações repetíveis e gerenciadas por configuração.
- **[Instalação de um comando](/pt-br/install)**: `curl … | install.sh | bash` em uma VM
  Ubuntu limpa, o mesmo instalador sem o invólucro do pacote.
- **[Imagem de VM de demonstração](/pt-br/quickstart-vm)**: appliance pré-compilado com um assistente de configuração
  no navegador, o caminho mais rápido para um sistema em execução para avaliação.

Os três chegam ao mesmo chart `soctalk-system` e ao mesmo SOC em execução.
