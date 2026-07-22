# Téléchargements

Images de VM de démonstration SocTalk préconstruites, publiées comme artefacts de GitHub Release à chaque tag `v*` du dépôt [`soctalk/soctalk`](https://github.com/soctalk/soctalk).

Toutes les images correspondent au même build Ubuntu 24.04 + K3s + assistant de configuration, simplement converti dans différents formats de disque virtuel. Choisissez le format que votre hyperviseur consomme nativement. **Il n'y a aucune différence fonctionnelle d'un format à l'autre.**

## Dernière version

Version actuelle : **v0.2.0**: [page de la version](https://github.com/soctalk/soctalk/releases/tag/v0.2.0) · [toutes les versions](https://github.com/soctalk/soctalk/releases)

La version inclut :

- [`soctalk-demo-0.2.0.qcow2.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz), KVM, QEMU, libvirt, Proxmox
- [`soctalk-demo-0.2.0.vmdk.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vmdk.xz), VMware ESXi, Workstation, Fusion, VirtualBox
- [`soctalk-demo-0.2.0.vhdx.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhdx.xz), Microsoft Hyper-V (Génération 1)
- [`soctalk-demo-0.2.0.vhd.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhd.xz), Microsoft Azure (taille fixe, aligné sur 1 MiB)
- [`soctalk-demo-0.2.0.raw.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.raw.xz), import cloud générique (GCP, OpenStack), `dd` vers un disque physique
- [`SHA256SUMS.txt`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt), sommes de contrôle pour tous les fichiers ci-dessus

Tous les artefacts sont compressés avec `xz -9`. Décompressez avec `xz -d <file>.xz`.

## Sélecteur de format

| Votre plateforme | Téléchargement |
|---|---|
| **Proxmox VE** | qcow2, `qm disk import`. Voir [Exécuter sur Proxmox](/fr-fr/proxmox) |
| **libvirt / virt-manager / QEMU CLI** | qcow2 |
| **KVM (RHEL/CentOS/Alma)** | qcow2 |
| **VMware ESXi** | vmdk, voir [Exécuter sur VMware ESXi](/fr-fr/vmware) |
| **VMware Workstation / Fusion** | vmdk |
| **VirtualBox** | vmdk, convertir en VDI, puis attacher. Voir [Exécuter sur VirtualBox](/fr-fr/virtualbox) |
| **Microsoft Hyper-V** | vhdx, VM de Génération 1 (validé ; l'image démarre via le firmware BIOS, la Gen 2 / UEFI n'est pas testée) |
| **Microsoft Azure** | vhd, upload direct vers un Managed Disk → Image → VM. Voir [Exécuter sur Azure](/fr-fr/azure) |
| **Google Cloud** | raw, `tar czf disk.tar.gz disk.raw && gcloud compute images create` |
| **OpenStack** | raw, `openstack image create --disk-format raw` |
| **AWS** | vmdk, importer comme AMI avec VM Import, ou construire une AMI native avec Packer. Voir [Exécuter sur AWS](/fr-fr/aws) |
| **Bare metal** | raw, `dd if=disk.raw of=/dev/sdX bs=4M` |

## Vérifier le téléchargement

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Taille du disque

Toutes les images présentent :

- **Taille compressée** : ~600 Mo à 1,5 Go selon le format
- **Taille apparente décompressée** : 60 Go
- **Taille réelle sur disque après le premier démarrage** : ~3 Go (qcow2/vhdx sont creux ; raw et vhd sont de taille fixe, mais la majeure partie des 60 Go n'est que des zéros et se compresse à néant)

## Construire l'image vous-même

Le harnais Packer se trouve dans [`infra/packer/`](https://github.com/soctalk/soctalk/tree/main/infra/packer). Avec KVM et Packer 1.11+ sur un hôte Linux :

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.qemu.soctalk_demo" .
```

Construction en ~1 minute sur un hôte moderne avec accélération KVM. Les sorties atterrissent dans `build/dist/` : un fichier par format. Consultez le [README Packer](https://github.com/soctalk/soctalk/blob/main/infra/packer/README.md) pour la configuration du seed cloud-init et la source de l'AMI AWS.

## Workflow CI

`build-packer-images.yml` est exclusivement `workflow_dispatch`: les builds Packer ne sont pas déclenchés à chaque push, car ils sont lents et consomment des minutes de runner. Déclenchez-le intentionnellement pour une nouvelle version :

```bash
gh workflow run build-packer-images.yml -f version=0.2.0
```

Le workflow exécute :

1. **build-wizard**: build Go du binaire de l'assistant de configuration.
2. **build-qcow2**: build Packer produisant les cinq formats ; compresse avec xz ; téléverse chacun comme artefact de workflow distinct ; attache à la GitHub Release sur les tags `v*`.
3. **boot-test**: démarre le qcow2 dans une VM KVM neuve, attend la fin de `soctalk-firstboot`, exécute un validateur Playwright. Fait échouer le workflow si l'image est cassée, afin qu'une mauvaise version ne soit jamais attachée à un tag.
