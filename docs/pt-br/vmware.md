# Executar a VM de demonstração no VMware ESXi

Importe o `soctalk-demo-<ver>.vmdk` publicado no VMware ESXi e inicialize-o. Este guia cobre o **ESXi 7/8** com o Host Client integrado (a interface de navegador). Se, em vez disso, você estiver rodando o Fusion ou o Workstation em um laptop, o fluxo é quase idêntico; importe o mesmo vmdk via File → Open.

Este caminho é para **avaliadores e demonstrações** que executam o SocTalk em seu ESXi on-premise existente. Para uma instalação em produção no seu próprio cluster Kubernetes, consulte [Instalação](/pt-br/install). Validado no ESXi 8.0.3 (build 24677879) com o Host Client 2.x.

## Pré-requisitos

- ESXi 7.0 ou mais recente com um datastore de usuário existente (VMFS). Se você ainda não tiver um datastore, a [seção Novo datastore](#_3-opcional-criar-um-datastore-vmfs) abaixo mostra como criá-lo.
- Root ou um usuário com o privilégio `Virtual machine.Provisioning.Deploy from template`.
- Um port group (geralmente o **VM Network** criado automaticamente) que tenha DHCP + HTTPS de saída.
- ~10 GB livres no datastore (o vmdk tem ~800 MB streamOptimized, mas converte para um disco VMFS thin de 60 GB que cresce sob demanda).
- Um par de chaves SSH (`~/.ssh/id_ed25519.pub` nos exemplos) para ler o token de configuração via SSH.

::: warning Você precisa de um datastore VMFS de verdade, não do volume OSDATA do ESXi
O instalador do ESXi cria um volume `OSDATA-*` no disco de boot. Ele aparece em `esxcli storage filesystem list` e é montado em `/vmfs/volumes/`, mas **não** é um datastore de usuário normal, e VMs armazenadas nele falham ao ligar com `msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`. Adicione um disco ou partição separada e formate-o como VMFS antes de continuar.
:::

## 1. Baixar e verificar a imagem

Obtenha o **vmdk** na página de [Downloads](/pt-br/downloads). Em qualquer host Linux/macOS que tenha `ovftool` ou via SSH em um acesso ao console de VM ESXi:

```bash
VER=0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

Agora você tem o `soctalk-demo-<ver>.vmdk`, um disco VMware **streamOptimized** (hosted). O VMFS do ESXi não o executa diretamente; o §4 o converte uma vez com o `vmkfstools`.

## 2. Construir uma ISO seed do cloud-init

Uma pequena ISO seed NoCloud cria um usuário `ops` com sua chave SSH para que você possa ler o token de configuração de cada boot. Se você pular esta etapa, ainda poderá fazer login como o usuário `ubuntu:packer` do momento da build (consulte [Acesso SSH](/pt-br/quickstart-vm#ssh-access-credentials)), mas essa credencial está na árvore de código-fonte pública, então proteja a VM antes de expô-la. No Linux/macOS:

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat ~/.ssh/id_ed25519.pub)
EOF
printf 'instance-id: soctalk-demo\nlocal-hostname: soctalk-demo\n' > meta-data
# Linux: genisoimage / cloud-localds   •   macOS: hdiutil or mkisofs (brew install cdrtools)
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
```

## 3. (Opcional) Criar um datastore VMFS

Pule esta etapa se o seu ESXi já tiver um datastore de usuário (por exemplo, `datastore1`) com mais de 10 GB livres.

Faça login no Host Client e vá em **Storage** → **Datastores**. Uma instalação à qual não foi atribuído um disco de dados fica assim:

![ESXi Host Client, aba Storage sem datastores](/screenshots/esxi-storage-empty.png)

Clique em **New datastore** para abrir o assistente de 5 etapas.

**Etapa 1, Select creation type.** Escolha **Create new VMFS datastore**. Next.

![Novo datastore etapa 1, tipo de criação](/screenshots/esxi-new-datastore-01-type.png)

**Etapa 2, Name and select device.** Insira um nome (`datastore1` é convencional) e escolha o disco a formatar. Somente discos não reivindicados aparecem aqui.

![Novo datastore etapa 2, nome](/screenshots/esxi-new-datastore-02-name.png)
![Novo datastore etapa 3, seleção de dispositivo](/screenshots/esxi-new-datastore-03-device.png)

**Etapa 3, Select partitioning options.** Padrão: **Use full disk, VMFS 6**. Confirme e clique em Next.

![Novo datastore etapa 4, particionamento](/screenshots/esxi-new-datastore-04-partition.png)

**Etapa 4, Ready to complete.** Confira o resumo e clique em **Finish**. O ESXi avisa que o disco será reparticionado; confirme.

![Novo datastore etapa 5, revisão](/screenshots/esxi-new-datastore-05-review.png)

**Resultado.** Storage → Datastores agora mostra o novo datastore VMFS6. Recent tasks reporta que tanto **Create Vmfs Datastore** quanto **Rescan Vmfs** foram concluídas com sucesso.

![Datastore criado](/screenshots/esxi-datastore-created.png)

## 4. Enviar e converter o vmdk

O vmdk do GHCR é streamOptimized. O subsistema de VM do ESXi precisa de um disco VMFS thin. Dois caminhos:

::: code-group

```bash [SSH + vmkfstools (recomendado)]
# Enable SSH on the ESXi host: Host Client → Actions → Services → Enable SSH
# Copy the vmdk to the datastore (from any host that has scp)
DS=/vmfs/volumes/datastore1
scp soctalk-demo-0.2.0.vmdk root@<esxi-host>:$DS/soctalk-source.vmdk

# On the ESXi host: convert to VMFS thin (~1 minute on a fast SSD)
ssh root@<esxi-host>
mkdir -p /vmfs/volumes/datastore1/SocTalk-Demo
vmkfstools -i /vmfs/volumes/datastore1/soctalk-source.vmdk \
           /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmdk -d thin
rm /vmfs/volumes/datastore1/soctalk-source.vmdk
```

```bash [ovftool from your workstation]
# Wraps the vmdk into a minimal OVF and pushes to ESXi in one command
ovftool --acceptAllEulas --diskMode=thin \
  --datastore=datastore1 \
  --net:"VM Network"="VM Network" \
  --name=SocTalk-Demo \
  soctalk-demo-0.2.0.vmdk \
  vi://root:<password>@<esxi-host>
```

:::

Envie também a ISO seed via **Storage → Datastore browser → Upload**:

```
[datastore1]/SocTalk-Demo/soctalk-seed.iso
```

## 5. Criar a VM

Vá em **Virtual Machines** no Host Client e clique em **Create / Register VM** para abrir o assistente de 5 etapas.

![Assistente Create / Register VM](/screenshots/esxi-create-vm-wizard.png)

Percorra o assistente:

- **Select creation type**: **Register an existing virtual machine** (já colocamos o vmdk na etapa 4).

Se a sua build do ESXi ocultar essa opção ou se você preferir configurar tudo pelo assistente, escolha **Create a new virtual machine** e use estas configurações:

- **Select a name and guest OS**: Nome `SocTalk-Demo`. Compatibilidade `ESXi 8.0 virtual machine`. Família do SO convidado `Linux`. Versão do SO convidado `Ubuntu Linux (64-bit)`.
- **Select storage**: `datastore1`.
- **Customize settings**: defina:
  - **CPU** 4
  - **Memory** 8 GB
  - **Hard disk 1**: clique na linha do disco → **Existing hard disk**, navegue até `[datastore1] SocTalk-Demo/SocTalk-Demo.vmdk`
  - **Network adapter 1**: Network `VM Network`, tipo de adaptador `VMXNET3` (a NIC paravirtualizada recomendada pela VMware; use-a em ESXi bare-metal para melhor desempenho)
  - **CD/DVD drive 1**: Datastore ISO file, navegue até `soctalk-seed.iso`: marque **Connect at power on**
  - Deixe o controlador USB e o Floppy nos padrões.
- **Ready to complete**: Finish.

A VM aparece na lista Virtual Machines com `Register VM` marcado como concluído com sucesso.

![VM registrada no datastore1](/screenshots/esxi-vm-registered.png)

## 6. Ligar e abrir o console

Selecione **SocTalk-Demo** e clique em **Power on**. O cabeçalho muda para o estado verde de ligado e a miniatura do console começa a atualizar.

![VM ligada, painel de hardware visível](/screenshots/esxi-vm-powered-on.png)

Clique em **Console** → **Open browser console** (a aba autônoma é mais fácil de digitar do que a prévia embutida).

![Menu suspenso do console](/screenshots/esxi-console-menu.png)

O console mostra o Ubuntu 24.04 inicializando através do cloud-init e chegando a um prompt de login:

![Console da VM, boot do Ubuntu até o login](/screenshots/esxi-vm-console-boot.png)

## 7. Fazer login na VM

Você tem duas formas de entrar, ambas dando um shell a partir do qual você pode usar `sudo -i` para se tornar root.

::: code-group

```bash [SSH as ops (seed ISO required)]
# From the host whose SSH public key is in the seed ISO you built in §2.
# The VM's IP shows in the Host Client under SocTalk-Demo →
# General information → Networking.
ssh ops@<vm-ip>

# From the ops shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
whoami         # → root
```

```bash [SSH as ubuntu:packer (fallback — no seed ISO)]
# Every published image ships a build-time ``ubuntu`` account with password
# ``packer``. This credential is in the public source tree, so treat it as
# public information; harden or delete the account before exposing the VM.
ssh ubuntu@<vm-ip>
# Password: packer

# From the ubuntu shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
```

```text [Browser console (no SSH available)]
# Host Client → SocTalk-Demo → Console → Open browser console
# Same credentials as the SSH tabs above.

packer-build login: ubuntu
Password: packer                    # not echoed on screen

ubuntu@packer-build:~$ sudo -i
root@packer-build:~#
```

:::

::: warning Proteja ou exclua a credencial packer antes de expor a VM
O login `ubuntu:packer` está embutido em toda imagem publicada e vive na árvore de código-fonte pública. Em qualquer VM que saia de um laboratório isolado: `sudo passwd -l ubuntu` (bloqueia a conta) mais `sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null && sudo systemctl reload ssh`. Consulte [Acesso SSH + credenciais](/pt-br/quickstart-vm#ssh-access-credentials) para o roteiro completo de hardening.
:::

## 8. Ler o token de configuração

A partir do host que possui a chave SSH privada da ISO seed:

```bash
# Find the VM's IP: Host Client → SocTalk-Demo → General information → Networking
ssh ops@<vm-ip> sudo cat /run/soctalk/setup-token
```

Copie o token, depois abra **https://\<vm-ip\>/** em um navegador e cole-o quando o assistente solicitar. Continue a partir do [passo 6 do Quickstart VM](/pt-br/quickstart-vm#_6-open-the-setup-wizard).

Assim que a instalação for concluída, você estará no MSSP Dashboard:

![Dashboard MSSP do SocTalk no ESXi](/screenshots/esxi-soctalk-mssp-dashboard.png)

## Solução de problemas

As entradas abaixo se aplicam a hosts ESXi bare-metal reais, a menos que carreguem a tag **(apenas laboratório aninhado)**. As marcadas apareceram durante a validação deste guia em ESXi aninhado (ESXi 8.0.3 como convidado KVM sob Ubuntu 24.04) e não afetam hardware de produção.

**`msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`**: os arquivos da VM residem em `/vmfs/volumes/OSDATA-*` em vez de um datastore de usuário real. Mova-os: use `vmkfstools -i` para levar o vmdk a um datastore VMFS real (§3 + §4), copie o `.vmx` junto, desregistre a VM antiga (`vim-cmd vmsvc/unregister <id>`) e registre a nova (`vim-cmd solo/registervm /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmx SocTalk-Demo`).

**A VM inicializa, mas a interface de rede fica DOWN e nunca obtém um IP**: a imagem packer traz uma configuração netplan que faz correspondência por MAC. Quando o ESXi atribui um novo MAC à vNIC, a correspondência falha e o DHCP nunca roda. Corrija editando `/etc/netplan/50-cloud-init.yaml` para corresponder por nome de interface:

```yaml
network:
  version: 2
  ethernets:
    all:
      match:
        name: "en*"
      dhcp4: true
```

Depois `netplan apply`.

**`ovftool: error while loading shared libraries: libssl.so.1.1`**: instale um runtime OpenSSL 1.1 compatível ou use o caminho SSH + `vmkfstools`.

**O Host Client mostra um banner vermelho sobre o ESXi Shell / SSH estar habilitado**: esperado em configurações de avaliação. É um lembrete de hardening, não um erro. Desabilite o SSH quando terminar se o host estiver exposto.

### Apenas laboratório aninhado

Estes aparecem quando o próprio ESXi está rodando como convidado dentro de outro hypervisor (KVM, VirtualBox, Fusion, Workstation ou uma instância de nuvem "bare-metal-lite"). Em ESXi bare-metal real você não verá nenhum deles; os padrões do §5 (NIC VMXNET3, hardware versão 20, USB + Floppy habilitados) funcionam como estão.

**A ligação falha com `E1000PCI: failed to register e1000e device` ou `Vmxnet3 PCI: failed to reserve slot` (apenas laboratório aninhado)**: o hypervisor externo não emula topologia PCIe suficiente para o ESXi alocar um slot para a NIC paravirtualizada. Edite `SocTalk-Demo.vmx` e defina `ethernet0.virtualDev = "e1000"` (a NIC emulada clássica, que precisa de menos), depois `vim-cmd vmsvc/reload <id>` e ligue novamente. Em hardware real, mantenha VMXNET3.

**O vmx sofre segfault com signal 11 / `msg.vmx.poweron.failed` no hardware versão 20 (apenas laboratório aninhado)**: alguns hypervisors externos não anunciam os recursos PCIe/EPT mais novos que o vmx-20 assume. Edite `SocTalk-Demo.vmx` e reduza para `virtualHW.version = "15"`, remova `usb.present = "TRUE"` e `floppy0.present = "TRUE"` (ou defina ambos como `"FALSE"`), depois `vim-cmd vmsvc/reload <id>` e tente de novo. O ESXi bare-metal real roda o vmx-20 sem problemas.
