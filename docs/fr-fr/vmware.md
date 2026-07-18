# Exécuter la VM de démonstration sur VMware ESXi

Importez le fichier `soctalk-demo-<ver>.vmdk` publié dans VMware ESXi et démarrez-le. Ce guide couvre **ESXi 7/8** avec le Host Client intégré (l'interface web du navigateur). Si vous exécutez plutôt Fusion ou Workstation sur un ordinateur portable, la procédure est presque identique ; importez le même vmdk via File → Open.

Ce parcours s'adresse aux **évaluateurs et aux démonstrations** exécutant SocTalk sur leur ESXi on-premise existant. Pour une installation en production sur votre propre cluster Kubernetes, consultez [Installation](/fr-fr/install). Validé sur ESXi 8.0.3 (build 24677879) avec Host Client 2.x.

## Prérequis

- ESXi 7.0 ou plus récent avec un datastore utilisateur existant (VMFS). Si vous n'avez pas encore de datastore, la [section Nouveau datastore](#optional-create-a-vmfs-datastore) ci-dessous vous guide.
- Root ou un utilisateur disposant du privilège `Virtual machine.Provisioning.Deploy from template`.
- Un port group (généralement le **VM Network** créé automatiquement) disposant du DHCP + HTTPS sortant.
- Environ 10 Go libres sur le datastore (le vmdk fait environ 800 Mo en streamOptimized mais se convertit en un disque VMFS thin de 60 Go qui grandit à la demande).
- Une paire de clés SSH (`~/.ssh/id_ed25519.pub` dans les exemples) pour lire le jeton d'installation via SSH.

::: warning Il vous faut un véritable datastore VMFS, pas le volume OSDATA d'ESXi
Le programme d'installation d'ESXi crée un volume `OSDATA-*` sur le disque de démarrage. Il apparaît dans `esxcli storage filesystem list` et se monte sous `/vmfs/volumes/`, mais ce n'est **pas** un datastore utilisateur normal et les VM qui y sont stockées échouent au démarrage avec `msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`. Ajoutez un disque ou une partition distincte et formatez-le en VMFS avant de continuer.
:::

## 1. Télécharger et vérifier l'image

Récupérez le **vmdk** depuis la page [Téléchargements](/fr-fr/downloads). Sur n'importe quel hôte Linux/macOS disposant d'`ovftool` ou via un accès à la console d'une VM ESXi en SSH :

```bash
VER=0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

Vous disposez maintenant de `soctalk-demo-<ver>.vmdk`, un disque VMware **streamOptimized** (hébergé). Le VMFS d'ESXi ne peut pas l'exécuter directement ; le §4 le convertit une fois avec `vmkfstools`.

## 2. Construire un ISO seed cloud-init

Un petit ISO seed NoCloud crée un utilisateur `ops` avec votre clé SSH afin que vous puissiez lire le jeton d'installation généré à chaque démarrage. Si vous l'ignorez, vous pouvez tout de même vous connecter en tant qu'utilisateur `ubuntu:packer` créé au moment du build (voir [Accès SSH](/fr-fr/quickstart-vm#ssh-access-credentials)) — mais cet identifiant se trouve dans l'arborescence source publique, alors durcissez la VM avant de l'exposer. Sous Linux/macOS :

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

## 3. (Optionnel) Créer un datastore VMFS

Ignorez cette étape si votre ESXi dispose déjà d'un datastore utilisateur (par exemple `datastore1`) avec 10 Go et plus de libre.

Connectez-vous au Host Client et allez dans **Storage** → **Datastores**. Une installation qui n'a pas reçu de disque de données ressemble à ceci :

![Host Client ESXi — onglet Storage sans datastores](/screenshots/esxi-storage-empty.png)

Cliquez sur **New datastore** pour ouvrir l'assistant en 5 étapes.

**Étape 1 — Select creation type.** Choisissez **Create new VMFS datastore**. Next.

![Nouveau datastore étape 1 — type de création](/screenshots/esxi-new-datastore-01-type.png)

**Étape 2 — Name and select device.** Saisissez un nom (`datastore1` est le nom conventionnel) et sélectionnez le disque à formater. Seuls les disques non revendiqués apparaissent ici.

![Nouveau datastore étape 2 — nom](/screenshots/esxi-new-datastore-02-name.png)
![Nouveau datastore étape 3 — sélection du périphérique](/screenshots/esxi-new-datastore-03-device.png)

**Étape 3 — Select partitioning options.** Valeur par défaut : **Use full disk, VMFS 6**. Confirmez et cliquez sur Next.

![Nouveau datastore étape 4 — partitionnement](/screenshots/esxi-new-datastore-04-partition.png)

**Étape 4 — Ready to complete.** Vérifiez le récapitulatif et cliquez sur **Finish**. ESXi avertit que le disque sera repartitionné ; confirmez.

![Nouveau datastore étape 5 — révision](/screenshots/esxi-new-datastore-05-review.png)

**Résultat.** Storage → Datastores affiche désormais le nouveau datastore VMFS6. Recent tasks signale que **Create Vmfs Datastore** et **Rescan Vmfs** se sont tous deux terminés avec succès.

![Datastore créé](/screenshots/esxi-datastore-created.png)

## 4. Téléverser et convertir le vmdk

Le vmdk provenant de GHCR est en streamOptimized. Le sous-système VM d'ESXi a besoin d'un disque VMFS thin. Deux parcours :

::: code-group

```bash [SSH + vmkfstools (recommandé)]
# Enable SSH on the ESXi host: Host Client → Actions → Services → Enable SSH
# Copy the vmdk to the datastore (from any host that has scp)
DS=/vmfs/volumes/datastore1
scp soctalk-demo-0.1.4.vmdk root@<esxi-host>:$DS/soctalk-source.vmdk

# On the ESXi host: convert to VMFS thin (~1 minute on a fast SSD)
ssh root@<esxi-host>
mkdir -p /vmfs/volumes/datastore1/SocTalk-Demo
vmkfstools -i /vmfs/volumes/datastore1/soctalk-source.vmdk \
           /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmdk -d thin
rm /vmfs/volumes/datastore1/soctalk-source.vmdk
```

```bash [ovftool depuis votre poste de travail]
# Wraps the vmdk into a minimal OVF and pushes to ESXi in one command
ovftool --acceptAllEulas --diskMode=thin \
  --datastore=datastore1 \
  --net:"VM Network"="VM Network" \
  --name=SocTalk-Demo \
  soctalk-demo-0.1.4.vmdk \
  vi://root:<password>@<esxi-host>
```

:::

Téléversez également l'ISO seed via **Storage → Datastore browser → Upload** :

```
[datastore1]/SocTalk-Demo/soctalk-seed.iso
```

## 5. Créer la VM

Allez dans **Virtual Machines** dans le Host Client et cliquez sur **Create / Register VM** pour ouvrir l'assistant en 5 étapes.

![Assistant Create / Register VM](/screenshots/esxi-create-vm-wizard.png)

Parcourez l'assistant :

- **Select creation type** — **Register an existing virtual machine** (nous avons déjà placé le vmdk à l'étape 4).

Si votre build ESXi masque cette option ou si vous préférez tout configurer depuis l'assistant, choisissez plutôt **Create a new virtual machine** et utilisez ces paramètres :

- **Select a name and guest OS** — Nom `SocTalk-Demo`. Compatibilité `ESXi 8.0 virtual machine`. Famille de guest OS `Linux`. Version de guest OS `Ubuntu Linux (64-bit)`.
- **Select storage** — `datastore1`.
- **Customize settings** — définissez :
  - **CPU** 4
  - **Memory** 8 Go
  - **Hard disk 1** — cliquez sur la ligne du disque → **Existing hard disk**, naviguez jusqu'à `[datastore1] SocTalk-Demo/SocTalk-Demo.vmdk`
  - **Network adapter 1** — Network `VM Network`, type d'adaptateur `VMXNET3` (le NIC paravirtualisé recommandé par VMware ; utilisez-le sur ESXi bare-metal pour de meilleures performances)
  - **CD/DVD drive 1** — Datastore ISO file, naviguez jusqu'à `soctalk-seed.iso` — cochez **Connect at power on**
  - Laissez le contrôleur USB et le lecteur de disquette à leurs valeurs par défaut.
- **Ready to complete** — Finish.

La VM apparaît dans la liste Virtual Machines avec `Register VM` marqué comme terminé avec succès.

![VM enregistrée sur datastore1](/screenshots/esxi-vm-registered.png)

## 6. Démarrer et ouvrir la console

Sélectionnez **SocTalk-Demo** et cliquez sur **Power on**. L'en-tête bascule à l'état vert « sous tension » et la miniature de la console commence à se mettre à jour.

![VM sous tension, volet matériel visible](/screenshots/esxi-vm-powered-on.png)

Cliquez sur **Console** → **Open browser console** (l'onglet autonome est plus facile pour saisir du texte que l'aperçu intégré).

![Menu déroulant de la console](/screenshots/esxi-console-menu.png)

La console affiche Ubuntu 24.04 démarrant via cloud-init et arrivant à une invite de connexion :

![Console de la VM — démarrage d'Ubuntu jusqu'à la connexion](/screenshots/esxi-vm-console-boot.png)

## 7. Se connecter à la VM

Vous disposez de deux moyens d'accès, tous deux vous donnant un shell depuis lequel vous pouvez faire `sudo -i` pour devenir root.

::: code-group

```bash [SSH en tant qu'ops (ISO seed requis)]
# From the host whose SSH public key is in the seed ISO you built in §2.
# The VM's IP shows in the Host Client under SocTalk-Demo →
# General information → Networking.
ssh ops@<vm-ip>

# From the ops shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
whoami         # → root
```

```bash [SSH en tant qu'ubuntu:packer (repli — pas d'ISO seed)]
# Every published image ships a build-time ``ubuntu`` account with password
# ``packer``. This credential is in the public source tree, so treat it as
# public information; harden or delete the account before exposing the VM.
ssh ubuntu@<vm-ip>
# Password: packer

# From the ubuntu shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
```

```text [Console navigateur (pas de SSH disponible)]
# Host Client → SocTalk-Demo → Console → Open browser console
# Same credentials as the SSH tabs above.

packer-build login: ubuntu
Password: packer                    # not echoed on screen

ubuntu@packer-build:~$ sudo -i
root@packer-build:~#
```

:::

::: warning Durcissez ou supprimez l'identifiant packer avant d'exposer la VM
La connexion `ubuntu:packer` est intégrée à chaque image publiée et se trouve dans l'arborescence source publique. Sur toute VM qui quitte un laboratoire isolé : `sudo passwd -l ubuntu` (verrouiller le compte) plus `sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null && sudo systemctl reload ssh`. Consultez [Accès SSH + identifiants](/fr-fr/quickstart-vm#ssh-access-credentials) pour l'intégralité du durcissement.
:::

## 8. Lire le jeton d'installation

Depuis l'hôte qui possède la clé privée SSH présente dans l'ISO seed :

```bash
# Find the VM's IP: Host Client → SocTalk-Demo → General information → Networking
ssh ops@<vm-ip> sudo cat /run/soctalk/setup-token
```

Copiez le jeton, puis ouvrez **https://\<vm-ip\>/** dans un navigateur et collez-le lorsque l'assistant le demande. Poursuivez à partir de [Quickstart VM étape 6](/fr-fr/quickstart-vm#_6-open-the-setup-wizard).

Une fois l'installation terminée, vous arrivez sur le MSSP Dashboard :

![Tableau de bord MSSP SocTalk sur ESXi](/screenshots/esxi-soctalk-mssp-dashboard.png)

## Dépannage

Les entrées ci-dessous s'appliquent aux véritables hôtes ESXi bare-metal, sauf si elles portent la mention **(nested lab only)**. Celles qui la portent sont apparues lors de la validation de ce guide sur un ESXi imbriqué (ESXi 8.0.3 en tant qu'invité KVM sous Ubuntu 24.04) et n'affectent pas le matériel de production.

**`msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`** — les fichiers de la VM se trouvent sous `/vmfs/volumes/OSDATA-*` au lieu d'un véritable datastore utilisateur. Déplacez-les : `vmkfstools -i` le vmdk vers un véritable datastore VMFS (§3 + §4), copiez le `.vmx` à côté, désinscrivez l'ancienne VM (`vim-cmd vmsvc/unregister <id>`) et enregistrez la nouvelle (`vim-cmd solo/registervm /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmx SocTalk-Demo`).

**La VM démarre mais l'interface réseau est DOWN et n'obtient jamais d'IP** — l'image packer embarque une configuration netplan qui fait la correspondance par MAC. Lorsqu'ESXi attribue une nouvelle adresse MAC au vNIC, la correspondance échoue et le DHCP ne s'exécute jamais. Corrigez en modifiant `/etc/netplan/50-cloud-init.yaml` pour faire la correspondance par nom d'interface à la place :

```yaml
network:
  version: 2
  ethernets:
    all:
      match:
        name: "en*"
      dhcp4: true
```

Puis `netplan apply`.

**`ovftool: error while loading shared libraries: libssl.so.1.1`** — installez un runtime OpenSSL 1.1 compatible, ou utilisez plutôt le parcours SSH + `vmkfstools`.

**Le Host Client affiche une bannière rouge indiquant que l'ESXi Shell / SSH est activé** — attendu dans les configurations d'évaluation. Il s'agit d'un rappel de durcissement, pas d'une erreur. Désactivez SSH une fois terminé si l'hôte est exposé.

### Nested-lab only

Ces problèmes surviennent lorsqu'ESXi lui-même s'exécute en tant qu'invité au sein d'un autre hyperviseur (KVM, VirtualBox, Fusion, Workstation, ou une instance cloud « bare-metal-lite »). Sur un véritable ESXi bare-metal, vous n'en verrez aucun ; les valeurs par défaut du §5 (NIC VMXNET3, version matérielle 20, USB + disquette activés) fonctionnent telles quelles.

**Le démarrage échoue avec `E1000PCI: failed to register e1000e device` ou `Vmxnet3 PCI: failed to reserve slot` (nested lab only)** — l'hyperviseur externe n'émule pas une topologie PCIe suffisante pour qu'ESXi puisse allouer un slot au NIC paravirtualisé. Modifiez `SocTalk-Demo.vmx` et définissez `ethernet0.virtualDev = "e1000"` (le NIC émulé classique, qui en demande moins), puis `vim-cmd vmsvc/reload <id>` et redémarrez. Sur du matériel réel, conservez VMXNET3.

**vmx plante avec un signal 11 / `msg.vmx.poweron.failed` sur la version matérielle 20 (nested lab only)** — certains hyperviseurs externes n'annoncent pas les fonctionnalités PCIe/EPT plus récentes que vmx-20 suppose présentes. Modifiez `SocTalk-Demo.vmx` et rétrogradez vers `virtualHW.version = "15"`, supprimez `usb.present = "TRUE"` et `floppy0.present = "TRUE"` (ou définissez les deux à `"FALSE"`), puis `vim-cmd vmsvc/reload <id>` et réessayez. Un véritable ESXi bare-metal exécute vmx-20 sans problème.
