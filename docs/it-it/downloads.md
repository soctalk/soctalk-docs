# Download

Immagini VM demo di SocTalk pre-compilate, pubblicate come artefatti GitHub Release a ogni tag `v*` del repository [`soctalk/soctalk`](https://github.com/soctalk/soctalk).

Tutte le immagini sono la stessa build Ubuntu 24.04 + K3s + procedura guidata di setup, semplicemente convertita in formati di disco virtuale diversi. Scegli il formato che il tuo hypervisor consuma nativamente. **Non c'è alcuna differenza funzionale tra i formati.**

## Ultima release

Versione corrente: **v0.2.0** — [pagina della release](https://github.com/soctalk/soctalk/releases/tag/v0.2.0) · [tutte le release](https://github.com/soctalk/soctalk/releases)

La release include:

- [`soctalk-demo-0.2.0.qcow2.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz) — KVM, QEMU, libvirt, Proxmox
- [`soctalk-demo-0.2.0.vmdk.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vmdk.xz) — VMware ESXi, Workstation, Fusion, VirtualBox
- [`soctalk-demo-0.2.0.vhdx.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhdx.xz) — Microsoft Hyper-V (Generation 1)
- [`soctalk-demo-0.2.0.vhd.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhd.xz) — Microsoft Azure (dimensione fissa, allineato a 1 MiB)
- [`soctalk-demo-0.2.0.raw.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.raw.xz) — importazione cloud generica (GCP, OpenStack), `dd` su disco fisico
- [`SHA256SUMS.txt`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt) — checksum per tutti i file elencati sopra

Tutti gli artefatti sono compressi con `xz -9`. Decomprimi con `xz -d <file>.xz`.

## Selettore del formato

| La tua piattaforma | Download |
|---|---|
| **Proxmox VE** | qcow2 — `qm disk import`. Vedi [Esecuzione su Proxmox](/it-it/proxmox) |
| **libvirt / virt-manager / QEMU CLI** | qcow2 |
| **KVM (RHEL/CentOS/Alma)** | qcow2 |
| **VMware ESXi** | vmdk — vedi [Esecuzione su VMware ESXi](/it-it/vmware) |
| **VMware Workstation / Fusion** | vmdk |
| **VirtualBox** | vmdk — converti in VDI, poi collega. Vedi [Esecuzione su VirtualBox](/it-it/virtualbox) |
| **Microsoft Hyper-V** | vhdx — VM Generation 1 (convalidata; l'immagine si avvia tramite firmware BIOS, Gen 2 / UEFI non è testato) |
| **Microsoft Azure** | vhd — caricamento diretto su Managed Disk → Image → VM. Vedi [Esecuzione su Azure](/it-it/azure) |
| **Google Cloud** | raw — `tar czf disk.tar.gz disk.raw && gcloud compute images create` |
| **OpenStack** | raw — `openstack image create --disk-format raw` |
| **AWS** | vmdk — importa come AMI con VM Import, oppure crea un AMI nativo con Packer. Vedi [Esecuzione su AWS](/it-it/aws) |
| **Bare metal** | raw — `dd if=disk.raw of=/dev/sdX bs=4M` |

## Verifica del download

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Dimensione del disco

Tutte le immagini hanno:

- **Dimensione compressa**: da ~600 MB a 1,5 GB a seconda del formato
- **Dimensione apparente decompressa**: 60 GB
- **Dimensione effettiva su disco dopo il primo avvio**: ~3 GB (qcow2/vhdx sono sparse; raw e vhd sono a dimensione fissa ma la maggior parte dei 60 GB è composta da zeri che si comprimono a nulla)

## Compilarla da soli

L'harness Packer si trova in [`infra/packer/`](https://github.com/soctalk/soctalk/tree/main/infra/packer). Con KVM e Packer 1.11+ su un host Linux:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.qemu.soctalk_demo" .
```

Compila in ~1 minuto su un host moderno con accelerazione KVM. Gli output finiscono in `build/dist/`: un file per formato. Vedi il [README di Packer](https://github.com/soctalk/soctalk/blob/main/infra/packer/README.md) per la configurazione del seed cloud-init e la sorgente dell'AMI AWS.

## Workflow CI

`build-packer-images.yml` è solo `workflow_dispatch` — le build Packer non vengono avviate a ogni push perché sono lente e consumano minuti dei runner. Avviala intenzionalmente per una nuova release:

```bash
gh workflow run build-packer-images.yml -f version=0.2.0
```

Il workflow esegue:

1. **build-wizard** — build Go del binario della procedura guidata di setup.
2. **build-qcow2** — build Packer che produce tutti e cinque i formati; comprime con xz; carica ciascuno come artefatto di workflow separato; li allega alla GitHub Release sui tag `v*`.
3. **boot-test** — avvia il qcow2 in una nuova VM KVM, attende il completamento di `soctalk-firstboot`, esegue un validatore Playwright. Fa fallire il workflow se l'immagine è danneggiata, così una release difettosa non viene mai allegata a un tag.
