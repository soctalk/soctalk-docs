# Downloads

Vorgefertigte SocTalk-Demo-VM-Images, veröffentlicht als GitHub-Release-Artefakte bei jedem `v*`-Tag des Repositories [`soctalk/soctalk`](https://github.com/soctalk/soctalk).

Alle Images stammen vom selben Build aus Ubuntu 24.04 + K3s + Setup-Assistent, lediglich in unterschiedliche Formate für virtuelle Datenträger konvertiert. Wählen Sie das Format, das Ihr Hypervisor nativ verarbeitet. **Es gibt keinen funktionalen Unterschied zwischen den Formaten.**

## Aktuelles Release

Aktuelle Version: **v0.2.0**: [Release-Seite](https://github.com/soctalk/soctalk/releases/tag/v0.2.0) · [alle Releases](https://github.com/soctalk/soctalk/releases)

Das Release umfasst:

- [`soctalk-demo-0.2.0.qcow2.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz), KVM, QEMU, libvirt, Proxmox
- [`soctalk-demo-0.2.0.vmdk.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vmdk.xz), VMware ESXi, Workstation, Fusion, VirtualBox
- [`soctalk-demo-0.2.0.vhdx.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhdx.xz), Microsoft Hyper-V (Generation 1)
- [`soctalk-demo-0.2.0.vhd.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhd.xz), Microsoft Azure (feste Größe, 1 MiB ausgerichtet)
- [`soctalk-demo-0.2.0.raw.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.raw.xz), generischer Cloud-Import (GCP, OpenStack), `dd` auf physischen Datenträger
- [`SHA256SUMS.txt`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt), Prüfsummen für alle oben genannten Dateien

Alle Artefakte sind mit `xz -9` komprimiert. Dekomprimieren Sie mit `xz -d <file>.xz`.

## Formatauswahl

| Ihre Plattform | Download |
|---|---|
| **Proxmox VE** | qcow2, `qm disk import`. Siehe [Auf Proxmox ausführen](/de-de/proxmox) |
| **libvirt / virt-manager / QEMU CLI** | qcow2 |
| **KVM (RHEL/CentOS/Alma)** | qcow2 |
| **VMware ESXi** | vmdk, siehe [Auf VMware ESXi ausführen](/de-de/vmware) |
| **VMware Workstation / Fusion** | vmdk |
| **VirtualBox** | vmdk, in VDI konvertieren, dann anhängen. Siehe [Auf VirtualBox ausführen](/de-de/virtualbox) |
| **Microsoft Hyper-V** | vhdx, Generation-1-VM (validiert; das Image bootet über BIOS-Firmware, Gen 2 / UEFI ist ungetestet) |
| **Microsoft Azure** | vhd, direkter Upload auf einen Managed Disk → Image → VM. Siehe [Auf Azure ausführen](/de-de/azure) |
| **Google Cloud** | raw, `tar czf disk.tar.gz disk.raw && gcloud compute images create` |
| **OpenStack** | raw, `openstack image create --disk-format raw` |
| **AWS** | vmdk, mit VM Import als AMI importieren oder mit Packer ein natives AMI erstellen. Siehe [Auf AWS ausführen](/de-de/aws) |
| **Bare Metal** | raw, `dd if=disk.raw of=/dev/sdX bs=4M` |

## Download verifizieren

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Datenträgergröße

Alle Images haben:

- **Komprimierte Größe**: ~600 MB bis 1,5 GB je nach Format
- **Dekomprimierte scheinbare Größe**: 60 GB
- **Tatsächliche Größe auf dem Datenträger nach dem ersten Boot**: ~3 GB (qcow2/vhdx sind sparse; raw und vhd haben feste Größe, aber der Großteil der 60 GB besteht aus Nullen und komprimiert sich auf nahezu nichts)

## Selbst erstellen

Der Packer-Harness liegt in [`infra/packer/`](https://github.com/soctalk/soctalk/tree/main/infra/packer). Mit KVM und Packer 1.11+ auf einem Linux-Host:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.qemu.soctalk_demo" .
```

Baut in ~1 Minute auf einem modernen Host mit KVM-Beschleunigung. Die Ausgaben landen in `build/dist/`: eine Datei pro Format. Siehe die [Packer-README](https://github.com/soctalk/soctalk/blob/main/infra/packer/README.md) für die cloud-init-Seed-Konfiguration und die AWS-AMI-Quelle.

## CI-Workflow

`build-packer-images.yml` ist ausschließlich `workflow_dispatch`: Packer-Builds werden nicht bei jedem Push ausgelöst, weil sie langsam sind und Runner-Minuten verbrauchen. Lösen Sie sie gezielt für ein neues Release aus:

```bash
gh workflow run build-packer-images.yml -f version=0.2.0
```

Der Workflow führt aus:

1. **build-wizard**: Go-Build der Binärdatei des Setup-Assistenten.
2. **build-qcow2**: Packer-Build, der alle fünf Formate erzeugt; xz-komprimiert; lädt jedes als separates Workflow-Artefakt hoch; hängt es bei `v*`-Tags an das GitHub-Release an.
3. **boot-test**: Bootet das qcow2 in einer frischen KVM-VM, wartet auf den Abschluss von `soctalk-firstboot`, führt einen Playwright-Validator aus. Lässt den Workflow fehlschlagen, wenn das Image defekt ist, damit niemals ein fehlerhaftes Release an ein Tag angehängt wird.
