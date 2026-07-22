# Executar a VM de demonstração no VirtualBox

O VirtualBox é a forma multiplataforma mais fácil de experimentar o SocTalk em um desktop — gratuito, guiado por GUI e disponível no Windows, Linux e macOS Intel. Este guia importa a imagem de demonstração publicada e a inicializa. Validado no VirtualBox 7.0.

Este caminho é para **avaliadores e demonstrações** — para uma instalação em produção no seu próprio cluster, consulte [Instalar](/pt-br/install).

::: warning Macs Apple Silicon (série M)
A imagem de demonstração é **x86-64**, que o VirtualBox não consegue executar em Apple Silicon. Em um Mac da série M, use um [lançamento na nuvem](/pt-br/aws) ou outro host. VirtualBox aqui significa Windows, Linux ou um Mac **Intel**.
:::

## Pré-requisitos

- [VirtualBox](https://www.virtualbox.org/) 7.0 ou mais recente.
- ~3 GB de disco livre para a imagem convertida.
- Um par de chaves SSH (`~/.ssh/id_ed25519.pub` nos exemplos) para ler o token de configuração via SSH.

## 1. Baixar e descompactar a imagem

Obtenha o **vmdk** na página de [Downloads](/pt-br/downloads) (o formato do VirtualBox compatível com VMware):

```bash
VER=0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

## 2. Converter o vmdk para o VDI nativo do VirtualBox

O vmdk lançado é **streamOptimized** (um layout VMware/OVA somente leitura), que o VirtualBox não inicializa como um disco gravável. Converta-o uma vez para um VDI:

```bash
VBoxManage clonemedium disk soctalk-demo-0.2.0.vmdk soctalk-demo-0.2.0.vdi --format VDI
```

Isso produz um `soctalk-demo-0.2.0.vdi` gravável e de tamanho dinâmico (alguns GB em disco). O `VBoxManage` acompanha o VirtualBox — no Windows ele fica em `C:\Program Files\Oracle\VirtualBox\`.

## 3. Criar um ISO de seed do cloud-init

Um pequeno ISO de seed NoCloud cria um usuário `ops` com a sua chave SSH para que você possa ler o token de configuração por inicialização. Se você pular essa etapa, ainda poderá fazer login como o usuário de tempo de build `ubuntu:packer` (consulte [Acesso SSH](/pt-br/quickstart-vm#ssh-access-credentials)) — mas essa credencial está na árvore de código-fonte pública, então proteja a VM antes de expô-la. No Linux/macOS:

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

## 4. Criar a VM

Abra o **VirtualBox** e clique em **New**.

![VirtualBox Manager](/screenshots/virtualbox-manager.png)

**Name and Operating System** — nomeie-a como `soctalk-demo`, defina **Type** como *Linux* e **Version** como *Ubuntu (64-bit)*. Deixe o ISO vazio:

![Name and OS](/screenshots/virtualbox-create-name.png)

**Hardware** — atribua **8192 MB** de memória e **4 CPUs** (o mínimo de [dimensionamento](/pt-br/reference/sizing) é 4 vCPU / 8 GB; a stack do Wazuh precisa da RAM):

![Hardware](/screenshots/virtualbox-create-hardware.png)

**Virtual Hard disk** — escolha **Use an Existing Virtual Hard Disk File** e selecione o `soctalk-demo-0.2.0.vdi` que você converteu:

![Use existing disk](/screenshots/virtualbox-create-disk.png)

**Summary** — confirme as configurações e clique em **Finish**:

![Summary](/screenshots/virtualbox-create-summary.png)

A VM aparece no Manager com o VDI em seu controlador SATA:

![VM created](/screenshots/virtualbox-vm-details.png)

## 5. Anexar o ISO de seed e configurar a rede

Selecione a VM e clique em **Settings**.

**Storage** — sob o controlador IDE, clique na unidade óptica e escolha o seu `soctalk-seed.iso` (clique no ícone de disco → *Choose a disk file*). O VDI já está no SATA:

![Storage](/screenshots/virtualbox-storage.png)

**Network** — defina **Adapter 1 → Attached to: Bridged Adapter** para que a VM obtenha um IP na sua LAN e você possa acessar o assistente diretamente:

![Network — bridged](/screenshots/virtualbox-network.png)

Clique em **OK**.

::: tip NAT em vez de bridged
Se você não puder usar bridged (por exemplo, uma rede restrita), mantenha o NAT padrão e adicione regras de **Port Forwarding** em Network → Advanced (host `8443` → guest `8443` para o assistente, host `8080` → guest `443` para a UI), e então use `localhost` em vez do IP da VM abaixo.
:::

## 6. Iniciar e encontrar o IP da VM

Clique em **Start**. O console inicializa até um prompt de login:

![Console](/screenshots/virtualbox-console.png)

Encontre o IP bridged da VM — a partir das concessões DHCP do seu roteador, ou correspondendo ao MAC da VM:

```bash
VBoxManage showvminfo soctalk-demo | grep "MAC"      # note the MAC
arp -an | grep -i <mac>                               # find the matching IP
```

## 7. Executar o assistente e fazer login

Leia o token de configuração por inicialização via SSH e, em seguida, conduza o assistente:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Acesse `https://<vm-ip>:8443/`, aceite o certificado autoassinado, cole o token e preencha o assistente ([referência de campos](/pt-br/setup-wizard)). Após enviar, o instalador de primeira inicialização executa `helm install` e integra o tenant `demo` — cerca de 2 minutos para os pods do `soctalk-system`, e depois mais alguns para a stack do Wazuh do tenant de demonstração:

```bash
ssh ops@<vm-ip>
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Em seguida, acesse `https://<vm-ip>/` (porta 443, não 8443), faça login com as credenciais de administrador do assistente e continue com o [Tour pela UI do MSSP](/pt-br/mssp-ui). Se você deixou o hostname em branco no assistente, mapeie `soctalk.local` para o IP da VM no seu arquivo hosts e use `https://soctalk.local/`.

## 8. Desmontagem

```bash
VBoxManage controlvm soctalk-demo poweroff
VBoxManage unregistervm soctalk-demo --delete
VBoxManage closemedium disk soctalk-demo-0.2.0.vdi --delete
```

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| A VM não inicia: "cannot open … streamOptimized" / disco somente leitura | Você anexou o `.vmdk` bruto. Use o `.vdi` convertido da etapa 2 |
| Não roda em um Mac Apple Silicon | Esperado — a imagem é x86-64; use um [lançamento na nuvem](/pt-br/aws) em vez disso |
| O console mostra erros `vmwgfx … unsupported hypervisor` | Inofensivo — é a GPU emulada do VirtualBox; a appliance é headless e inicializa normalmente |
| A VM não tem IP em bridged | Escolha a NIC de host correta em Network → Name; confirme que a sua LAN tem DHCP. Ou use a opção NAT + port-forwarding acima |
| Não consegue ler o token (sem SSH) | O ISO de seed não está anexado (Storage → IDE) ou a chave dele está errada; verifique novamente as etapas 3/5 |
| Qualquer coisa após o assistente | Igual a todas as plataformas — consulte a [tabela de solução de problemas do Quickstart](/pt-br/quickstart-vm#troubleshooting) |
