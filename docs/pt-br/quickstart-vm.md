# Início rápido: VM de demonstração do SocTalk

A maneira mais rápida de experimentar o SocTalk de ponta a ponta: baixe uma imagem de VM pré-construída, inicialize-a, abra o assistente de configuração no navegador e siga os passos. Cinco minutos até uma instalação multi-tenant em execução com um tenant de demonstração já integrado.

Este caminho é para **avaliadores e demonstrações**: para uma instalação em produção no seu próprio cluster, consulte [Instalação](/pt-br/install).

## O que há dentro da imagem

- Ubuntu 24.04 LTS, com cloud-init habilitado
- K3s com ingress Traefik incluído
- Helm + um chart `soctalk-system` pré-baixado
- Um assistente de configuração de primeira inicialização em `:8443`
- Um instalador de primeira inicialização (`soctalk-firstboot.service`) que roda depois que o assistente coleta a configuração
- A imagem é a mesma independentemente do formato (qcow2 / vmdk / vhdx / vhd / raw); escolha o que seu hypervisor consome nativamente. Consulte [Downloads](/pt-br/downloads).

## 1. Download

Escolha o formato para o seu hypervisor na página de [Downloads](/pt-br/downloads). Exemplos:

```bash
# KVM / Proxmox / libvirt
curl -L -o soctalk-demo.qcow2.xz \
  https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-<ver>.qcow2.xz
xz -d soctalk-demo.qcow2.xz
```

Verifique o checksum:

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 2. Inicialize a imagem

### KVM / libvirt (CLI)

```bash
qemu-system-x86_64 \
  -m 8G -smp 4 -enable-kvm -cpu host \
  -drive file=soctalk-demo.qcow2,format=qcow2,if=virtio \
  -netdev user,id=net0,hostfwd=tcp::18022-:22,hostfwd=tcp::18443-:8443 \
  -device virtio-net,netdev=net0 \
  -nographic
```

### Proxmox VE

`qm disk import <vmid> soctalk-demo.qcow2 <storage>`, depois anexe como SCSI e inicialize. Guia completo com capturas de tela da interface web: [Executar no Proxmox](/pt-br/proxmox).

### VMware

Importe `soctalk-demo.vmdk` como um disco existente em uma nova VM (Linux, Ubuntu 64-bit).

### VirtualBox

Converta `soctalk-demo.vmdk` para VDI e anexe-o a uma nova VM. Guia completo com capturas de tela: [Executar no VirtualBox](/pt-br/virtualbox).

### Hyper-V

Use `soctalk-demo.vhdx` como o disco do sistema operacional em uma VM de **Geração 1** (a imagem inicializa via firmware BIOS; Geração 2 / UEFI não foi testada). Para injetar uma chave SSH, anexe um `seed.iso` NoCloud como uma unidade de DVD, consulte [Opcional: seed do cloud-init](#opcional-seed-do-cloud-init).

### AWS

Construa uma AMI nativa com o Packer, ou importe `soctalk-demo.vmdk` como uma AMI com o VM Import. Guia completo: [Executar na AWS](/pt-br/aws).

### Azure

Faça upload de `soctalk-demo.vhd` (tamanho fixo) diretamente para um Managed Disk, depois crie uma imagem e uma VM de Geração 1 a partir dele. Guia completo: [Executar no Azure](/pt-br/azure).

### Raw / dd

`soctalk-demo.raw` é bit a bit o que está no disco. Adequado para importação genérica de imagem de nuvem (GCP, OpenStack) ou para gravar em um disco físico com `dd`.

**Dimensionamento mínimo**: 4 vCPU, 8 GB de RAM, 60 GB de disco. Consulte [Dimensionamento](/pt-br/reference/sizing).

## 3. Obtenha o token de configuração

O assistente vincula `:8443` com TLS (autoassinado). Ele recusa conexões sem o token de configuração gerado a cada inicialização. Conecte-se à máquina via SSH e leia-o:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

O login recomendado é o **usuário `ops` com sua chave SSH**, criado pelo seed do cloud-init em [§ Opcional: seed do cloud-init](#opcional-seed-do-cloud-init) abaixo. Se você inicializar sem um seed, consulte [§ Acesso SSH + credenciais](#acesso-ssh-credenciais) para o fallback definido em tempo de build, e leia a nota de segurança ali antes de expor a VM a uma rede em que você não confia.

## 4. Abra o assistente

Acesse `https://<vm-ip>:8443/` no navegador. Aceite o certificado autoassinado. Você chegará à página de inserção do token:

![Assistente de configuração, inserção do token](/screenshots/setup-wizard-token.png)

Cole o token e, em seguida, preencha:

- Nome do MSSP / organização
- Hostname (opcional, deixe em branco para usar o IP da máquina)
- E-mail + senha do administrador (mínimo de 12 caracteres)
- Provedor de LLM + chave de API

Consulte [Assistente de configuração](/pt-br/setup-wizard) para a referência completa dos campos.

Envie. O assistente grava `values.yaml`, o Secret do LLM e um arquivo env de integração, depois encerra. O instalador de primeira inicialização assume o controle:

1. Inicia o k3s
2. Cria o namespace `soctalk-system` + o Secret do LLM
3. `helm install soctalk-system`
4. Faz login como o administrador de bootstrap e integra um tenant `demo` via `POST /api/mssp/tenants/onboard`

Tempo total de relógio a partir do envio: cerca de 2 minutos para os pods do `soctalk-system` ficarem Ready, depois mais 1 a 3 minutos para a stack Wazuh do tenant de demonstração atingir o estado Ready.

## 5. Faça login

Acesse `https://<vm-ip>/` no navegador (observação: porta 443, não 8443, o assistente vincula a 8443 especificamente para evitar conflito com o Traefik). O dashboard do MSSP espera um nome DNS; se você usou um hostname em branco, adicione uma entrada em `/etc/hosts` apontando `soctalk.local` para o IP da VM e acesse `https://soctalk.local/`.

Faça login com o e-mail + senha do administrador que você definiu no assistente. Você chegará ao dashboard do MSSP. Continue com o [Tour pela interface do MSSP](/pt-br/mssp-ui).

## Opcional: seed do cloud-init

Se você quiser injetar uma chave SSH (ou pular o assistente completamente fornecendo o values.yaml diretamente), passe o user-data do cloud-init via NoCloud:

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
echo "instance-id: $(uuidgen)" > meta-data
cloud-localds seed.iso user-data meta-data

# attach seed.iso as a second drive on first boot.
```

Para pular o assistente, coloque `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` via `write_files` do cloud-init; a condição systemd do assistente (`ConditionPathExists=!/etc/soctalk/values.yaml`) fará um curto-circuito e o instalador irá direto para o `helm install`.

## Acesso SSH + credenciais

As imagens de disco disponíveis para download (qcow2 / vmdk / vhdx / vhd / raw) são todas fornecidas com **duas** identidades de login possíveis. Qual delas você usa depende de você ter fornecido ou não o user-data do cloud-init.

### Produção: usuário `ops` (recomendado)

O seed do cloud-init em [§ Opcional: seed do cloud-init](#opcional-seed-do-cloud-init) cria um usuário `ops` com sua chave SSH. Apenas autenticação por chave SSH, nenhuma senha é definida.

```bash
ssh -i ~/.ssh/<your-private-key> ops@<vm-ip>

# Root shell, no further password
sudo -i
```

### Usuário `ubuntu` de tempo de build (presente em toda imagem fornecida)

O build do Packer usa um usuário `ubuntu` de tempo de build com uma senha conhecida. A etapa de limpeza que deveria bloquear essa conta ainda não foi implementada, então ela é fornecida na imagem. Se você inicializar sem um seed do cloud-init, essa é a única forma de obter acesso ao console via SSH:

| Usuário | Senha | Sudo |
|---|---|---|
| `ubuntu` | `packer` | `ALL=(ALL) NOPASSWD:ALL` |

A autenticação SSH por senha é habilitada pelo mesmo seed, então a imagem aceita:

```bash
# Interactive
ssh ubuntu@<vm-ip>
# password: packer

# Non-interactive (requires sshpass)
sshpass -p packer ssh -o StrictHostKeyChecking=accept-new ubuntu@<vm-ip>

# Root shell, no further password
sudo -i
```

### Checklist de hardening

Execute como `ops` após a primeira inicialização, ou incorpore ao seu `runcmd:` do cloud-init para que rode automaticamente:

```bash
# Disable the build user
sudo passwd -l ubuntu
sudo usermod -s /usr/sbin/nologin ubuntu

# Turn off password SSH auth
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```

A AMI da AWS é construída a partir de uma fonte Packer separada (`amazon-ebs`) que não inclui o seed e usa a injeção de keypair do EC2 no lugar, ela não carrega a credencial `ubuntu:packer`. O checklist de hardening ainda se aplica a ela para o usuário `ubuntu` padrão da imagem de nuvem da AMI.

## Próximo passo: integre clientes com o Launchpad

Você acabou de executar o SocTalk de ponta a ponta em uma única máquina co-localizada. O próximo passo natural é um piloto real, um control plane MSSP mais um ou mais ambientes de tenant na sua própria infraestrutura. O [**Launchpad**](/pt-br/launchpad) faz exatamente isso com um único comando: ele inicializa as VMs, junta-as à sua tailnet, instala o SocTalk a partir de fontes públicas e entrega a você uma URL. (Prefere executar cada etapa manualmente? Consulte o [piloto MSSP faça-você-mesmo](/pt-br/mssp-pilot).)

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| A URL do assistente nunca carrega | `systemctl status soctalk-setup-wizard` na VM. Se estiver `inactive`, veja `journalctl -u soctalk-setup-wizard` |
| O assistente diz "invalid token" | O token está em `/var/log/soctalk-setup-token`, **de propriedade do root**. Use `sudo cat`. Cada inicialização regenera o token |
| O assistente diz "rate-limited" | O assistente bloqueia o IP após 10 tentativas de token malsucedidas. Aguarde 1 h ou execute `systemctl restart soctalk-setup-wizard` (isso também rotaciona o token) |
| O `helm install` trava | `kubectl get pods -A` a partir da máquina; `journalctl -u soctalk-firstboot -f` |
| Os pods do adaptador / runs-worker do tenant de demonstração ficam presos em ImagePullBackOff | Conhecido: o controlador usa por padrão uma tag de imagem não publicada. Consulte [Solução de problemas](/pt-br/troubleshooting) |

Para um reset limpo: exclua `/var/lib/soctalk-firstboot.done`, `/var/lib/soctalk-wizard.done`, `/etc/soctalk/values.yaml`, depois execute `systemctl restart soctalk-setup-wizard`.
