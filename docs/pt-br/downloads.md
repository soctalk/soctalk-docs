# Downloads

Imagens de VM de demonstração do SocTalk pré-compiladas, publicadas como artefatos de GitHub Release a cada tag `v*` do repositório [`soctalk/soctalk`](https://github.com/soctalk/soctalk).

Todas as imagens são a mesma build de Ubuntu 24.04 + K3s + assistente de configuração, apenas convertidas para diferentes formatos de disco virtual. Escolha o formato que seu hypervisor consome nativamente. **Não há diferença funcional entre os formatos.**

## Versão mais recente

Versão atual: **v0.2.0**: [página do release](https://github.com/soctalk/soctalk/releases/tag/v0.2.0) · [todos os releases](https://github.com/soctalk/soctalk/releases)

O release inclui:

- [`soctalk-demo-0.2.0.qcow2.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz), KVM, QEMU, libvirt, Proxmox
- [`soctalk-demo-0.2.0.vmdk.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vmdk.xz), VMware ESXi, Workstation, Fusion, VirtualBox
- [`soctalk-demo-0.2.0.vhdx.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhdx.xz), Microsoft Hyper-V (Generation 1)
- [`soctalk-demo-0.2.0.vhd.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhd.xz), Microsoft Azure (tamanho fixo, alinhado a 1 MiB)
- [`soctalk-demo-0.2.0.raw.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.raw.xz), importação genérica para nuvem (GCP, OpenStack), `dd` para disco físico
- [`SHA256SUMS.txt`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt), checksums de todos os itens acima

Todos os artefatos são compactados com `xz -9`. Descompacte com `xz -d <file>.xz`.

## Seletor de formato

| Sua plataforma | Download |
|---|---|
| **Proxmox VE** | qcow2, `qm disk import`. Consulte [Executar no Proxmox](/pt-br/proxmox) |
| **libvirt / virt-manager / QEMU CLI** | qcow2 |
| **KVM (RHEL/CentOS/Alma)** | qcow2 |
| **VMware ESXi** | vmdk, consulte [Executar no VMware ESXi](/pt-br/vmware) |
| **VMware Workstation / Fusion** | vmdk |
| **VirtualBox** | vmdk, converta para VDI e depois anexe. Consulte [Executar no VirtualBox](/pt-br/virtualbox) |
| **Microsoft Hyper-V** | vhdx, VM Generation 1 (validada; a imagem inicializa via firmware BIOS, Gen 2 / UEFI não foi testada) |
| **Microsoft Azure** | vhd, upload direto para um Managed Disk → Image → VM. Consulte [Executar no Azure](/pt-br/azure) |
| **Google Cloud** | raw, `tar czf disk.tar.gz disk.raw && gcloud compute images create` |
| **OpenStack** | raw, `openstack image create --disk-format raw` |
| **AWS** | vmdk, importe como uma AMI com VM Import, ou compile uma AMI nativa com Packer. Consulte [Executar no AWS](/pt-br/aws) |
| **Bare metal** | raw, `dd if=disk.raw of=/dev/sdX bs=4M` |

## Verifique o download

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Tamanho do disco

Todas as imagens têm:

- **Tamanho compactado**: ~600 MB a 1,5 GB dependendo do formato
- **Tamanho aparente descompactado**: 60 GB
- **Tamanho real em disco após a primeira inicialização**: ~3 GB (qcow2/vhdx são esparsos; raw e vhd têm tamanho fixo, mas a maior parte dos 60 GB são zeros e compacta para quase nada)

## Compile você mesmo

O harness do Packer fica em [`infra/packer/`](https://github.com/soctalk/soctalk/tree/main/infra/packer). Com KVM e Packer 1.11+ em um host Linux:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.qemu.soctalk_demo" .
```

Compila em ~1 minuto em um host moderno com aceleração KVM. As saídas vão para `build/dist/`: um arquivo por formato. Consulte o [Packer README](https://github.com/soctalk/soctalk/blob/main/infra/packer/README.md) para a configuração do seed do cloud-init e a origem da AMI da AWS.

## Fluxo de CI

`build-packer-images.yml` é apenas `workflow_dispatch`: as builds do Packer não são disparadas a cada push porque são lentas e consomem minutos de runner. Dispare intencionalmente para um novo release:

```bash
gh workflow run build-packer-images.yml -f version=0.2.0
```

O workflow executa:

1. **build-wizard**: build em Go do binário do assistente de configuração.
2. **build-qcow2**: build do Packer produzindo todos os cinco formatos; compacta com xz; faz upload de cada um como um artefato de workflow separado; anexa ao GitHub Release nas tags `v*`.
3. **boot-test**: inicializa o qcow2 em uma VM KVM nova, aguarda o `soctalk-firstboot` concluir, executa um validador Playwright. Faz o workflow falhar se a imagem estiver quebrada, para que um release ruim nunca seja anexado a uma tag.
