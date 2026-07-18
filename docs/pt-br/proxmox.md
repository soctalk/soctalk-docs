# Execute a VM de demonstração no Proxmox VE

Importe a imagem publicada `soctalk-demo-<ver>.qcow2` no Proxmox VE e inicialize-a. qcow2 é o formato de disco nativo do Proxmox, então esta é uma importação de um único comando — sem etapa de conversão.

Este caminho é destinado a **avaliadores e demonstrações** — para uma instalação em produção no seu próprio cluster, consulte [Instalação](/pt-br/install). Validado no Proxmox VE 8.4.

## Pré-requisitos

- Um nó Proxmox VE 8.x com ≥ 4 vCPU / 8 GB de RAM / 60 GB de armazenamento disponíveis ([dimensionamento](/pt-br/reference/sizing)).
- Um armazenamento que aceite conteúdo do tipo **Disk image** (o `local-lvm` padrão ou um armazenamento de diretório como `local` com *Disk image* habilitado).
- Acesso ao shell do nó (a importação do disco é um único comando `qm`; todo o resto acontece na interface web).

## 1. Baixe a imagem no nó

Conecte-se via SSH ao nó Proxmox:

```bash
VER=<ver>   # e.g. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.qcow2.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.qcow2.xz
```

## 2. Construa a ISO seed do cloud-init

Uma ISO seed NoCloud cria um usuário `ops` com a sua chave SSH. Sem ela, você ainda pode fazer login como o usuário `ubuntu:packer` definido no momento do build (consulte [Acesso SSH](/pt-br/quickstart-vm#ssh-access-credentials)), mas essa credencial está na árvore de código-fonte pública — forneça a seed antes de expor a VM a uma rede em que você não confia. No nó, ou em qualquer máquina Linux:

```bash
cat > user-data <<'EOF'
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
cat > meta-data <<'EOF'
instance-id: soctalk-demo-001
local-hostname: soctalk-demo
EOF
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
# (apt install genisoimage if missing; cloud-localds from cloud-image-utils also works)
mv soctalk-seed.iso /var/lib/vz/template/iso/
```

Se você construiu a ISO em outro lugar, faça o upload dela pela interface: selecione o armazenamento `local` → **ISO Images** → **Upload**.

::: tip
Você pode pular o assistente por completo adicionando `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` à seed via `write_files` — consulte [Opcional: seed do cloud-init](/pt-br/quickstart-vm#optional-cloud-init-seed).
:::

## 3. Crie a VM na interface web

Clique em **Create VM** (canto superior direito) e percorra o assistente:

**General** — escolha um ID e nome de VM:

![Create VM — General](/screenshots/proxmox-create-general.png)

**OS** — selecione **Do not use any media** (o sistema operacional já está no disco importado):

![Create VM — OS](/screenshots/proxmox-create-os.png)

**System** — mantenha os padrões (SeaBIOS, i440fx — a imagem inicializa via firmware BIOS).

**Disks** — exclua o disco padrão com o ícone de lixeira ao lado de `scsi0`; o qcow2 importado o substitui:

![Create VM — Disks](/screenshots/proxmox-create-disks.png)

**CPU** — 4 núcleos e defina **Type** como `host`:

![Create VM — CPU](/screenshots/proxmox-create-cpu.png)

**Memory** — 8192 MiB:

![Create VM — Memory](/screenshots/proxmox-create-memory.png)

**Network** — a sua bridge de LAN (tipicamente `vmbr0`), modelo VirtIO:

![Create VM — Network](/screenshots/proxmox-create-network.png)

**Confirm** — Finish. Ainda não inicie a VM.

## 4. Importe o disco

A única etapa via CLI. No nó (ajuste o ID da VM e o armazenamento de destino):

```bash
qm disk import 100 soctalk-demo-<ver>.qcow2 local --format qcow2
```

Em armazenamento LVM-thin (`local-lvm`), omita a flag `--format` — armazenamentos de blocos guardam raw. A importação aparece na VM como **Unused Disk 0**.

## 5. Anexe o disco, a ISO seed e a ordem de boot

De volta à interface, abra o painel **Hardware** da VM:

![Hardware — unused disk](/screenshots/proxmox-hardware-unused.png)

- Clique duas vezes em **Unused Disk 0** → mantenha Bus/Device em `SCSI 0` → **Add**:

![Attach the imported disk](/screenshots/proxmox-attach-disk.png)

- Clique duas vezes em **CD/DVD Drive (ide2)** → *Use CD/DVD disc image file* → armazenamento `local`, ISO `soctalk-seed.iso` → **OK**:

![Mount the seed ISO](/screenshots/proxmox-attach-seed.png)

- **Options** → **Boot Order** → coloque `scsi0` em primeiro (ou `qm set 100 --boot order=scsi0`).

O painel Hardware agora deve ficar assim:

![Hardware — final](/screenshots/proxmox-hardware-final.png)

## 6. Inicie e descubra o IP da VM

Clique em **Start**. O painel Summary mostra a VM em execução:

![VM running](/screenshots/proxmox-vm-running.png)

O **Console** mostra o appliance inicializando até o prompt de login:

![Console — booted](/screenshots/proxmox-vm-console.png)

A VM obtém um lease DHCP da sua bridge de LAN. Descubra o IP pelo console (`login: ops` funciona apenas via chave SSH — use a saída do console ou o seu servidor DHCP/roteador), ou a partir do nó:

```bash
# the MAC is on the VM's Network Device (net0)
grep -B2 -A2 "$(qm config 100 | grep -oP 'virtio=\K[^,]+')" /var/lib/misc/dnsmasq.leases 2>/dev/null \
  || arp -an | grep -i "$(qm config 100 | grep -oP 'virtio=\K[^,]+')"
```

## 7. Execute o assistente e faça login

O mesmo fluxo de todas as plataformas a partir daqui:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Acesse `https://<vm-ip>:8443/`, aceite o certificado autoassinado, cole o token e preencha o assistente ([referência de campos](/pt-br/setup-wizard)). Após enviar, o instalador de primeiro boot executa `helm install` e faz o onboarding do tenant `demo` — cerca de 2 minutos para os pods do `soctalk-system`, e mais alguns para a stack Wazuh do tenant de demonstração.

Em seguida, acesse `https://<vm-ip>/` (porta 443, não 8443), faça login com as credenciais de administrador do assistente e continue com o [Tour pela interface MSSP](/pt-br/mssp-ui). Se você deixou o hostname em branco no assistente, mapeie `soctalk.local` para o IP da VM em `/etc/hosts` e use `https://soctalk.local/`.

## Solução de problemas

| Sintoma | Verificação |
|---|---|
| `qm disk import` falha com um erro de armazenamento | O armazenamento de destino deve permitir conteúdo do tipo **Disk image**: Datacenter → Storage → edit → Content |
| A VM inicializa em "No bootable device" | A ordem de boot ainda aponta para o disco padrão excluído — Options → Boot Order → `scsi0` primeiro |
| O assistente aparece, mas sem SSH | A ISO seed não está anexada (Hardware → ide2) ou a chave em `user-data` está incorreta; você pode ler o token pelo Console em vez disso: `sudo cat /var/log/soctalk-setup-token` |
| A VM não tem IP | `ip a` a partir do Console; verifique se a bridge em Hardware → net0 corresponde a uma bridge com DHCP na sua LAN |
| A VM tem IP mas não tem internet (configurações de bridge NAT) | O PVE define `bridge-nf-call-iptables=1`, o que pode fazer o tráfego em bridge ignorar uma regra `MASQUERADE` restrita à interface de uplink. `sysctl -w net.bridge.bridge-nf-call-iptables=0` (se você não usa o firewall do PVE) ou use uma regra independente de interface: `iptables -t nat -A POSTROUTING -s <subnet> ! -d <subnet> -j MASQUERADE`, e então limpe o conntrack |
| Qualquer coisa após o assistente | Igual a todas as plataformas — consulte a [tabela de solução de problemas do Guia rápido](/pt-br/quickstart-vm#troubleshooting) |
