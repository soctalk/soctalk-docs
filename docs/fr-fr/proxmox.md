# Exécuter la VM de démonstration sur Proxmox VE

Importez l'image publiée `soctalk-demo-<ver>.qcow2` dans Proxmox VE et démarrez-la. qcow2 est le format de disque natif de Proxmox, donc il s'agit d'un import en une seule commande, aucune étape de conversion.

Ce parcours s'adresse aux **évaluateurs et aux démonstrations**: pour une installation en production sur votre propre cluster, consultez [Installation](/fr-fr/install). Validé sur Proxmox VE 8.4.

## Prérequis

- Un nœud Proxmox VE 8.x disposant de ≥ 4 vCPU / 8 Go de RAM / 60 Go de stockage libre ([dimensionnement](/fr-fr/reference/sizing)).
- Un stockage qui accepte le contenu **Disk image** (le `local-lvm` par défaut ou un stockage de type répertoire comme `local` avec *Disk image* activé).
- Un accès shell au nœud (l'import du disque est une seule commande `qm` ; tout le reste se passe dans l'interface web).

## 1. Télécharger l'image sur le nœud

Connectez-vous en SSH au nœud Proxmox :

```bash
VER=<ver>   # e.g. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.qcow2.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.qcow2.xz
```

## 2. Construire l'ISO d'amorçage cloud-init

Une ISO d'amorçage NoCloud crée un utilisateur `ops` avec votre clé SSH. Sans elle, vous pouvez toujours vous connecter avec l'utilisateur `ubuntu:packer` défini au moment du build (voir [Accès SSH](/fr-fr/quickstart-vm#ssh-access-credentials)), mais cet identifiant se trouve dans l'arborescence source publique, fournissez l'amorçage avant d'exposer la VM à un réseau auquel vous ne faites pas confiance. Sur le nœud, ou toute machine Linux :

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

Si vous avez construit l'ISO ailleurs, téléversez-la plutôt dans l'interface : sélectionnez le stockage `local` → **ISO Images** → **Upload**.

::: tip
Vous pouvez sauter entièrement l'assistant en ajoutant `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` à l'amorçage via `write_files`: voir [Optionnel : amorçage cloud-init](/fr-fr/quickstart-vm#optional-cloud-init-seed).
:::

## 3. Créer la VM dans l'interface web

Cliquez sur **Create VM** (en haut à droite) et parcourez l'assistant :

**General**: choisissez un ID et un nom de VM :

![Create VM, General](/screenshots/proxmox-create-general.png)

**OS**: sélectionnez **Do not use any media** (l'OS est déjà présent sur le disque importé) :

![Create VM, OS](/screenshots/proxmox-create-os.png)

**System**: conservez les valeurs par défaut (SeaBIOS, i440fx, l'image démarre via le firmware BIOS).

**Disks**: supprimez le disque par défaut avec l'icône corbeille à côté de `scsi0` ; le qcow2 importé le remplace :

![Create VM, Disks](/screenshots/proxmox-create-disks.png)

**CPU**: 4 cœurs, et réglez **Type** sur `host` :

![Create VM, CPU](/screenshots/proxmox-create-cpu.png)

**Memory**: 8192 MiB :

![Create VM, Memory](/screenshots/proxmox-create-memory.png)

**Network**: votre pont LAN (généralement `vmbr0`), modèle VirtIO :

![Create VM, Network](/screenshots/proxmox-create-network.png)

**Confirm**: Finish. Ne démarrez pas encore la VM.

## 4. Importer le disque

L'unique étape en CLI. Sur le nœud (ajustez l'ID de la VM et le stockage cible) :

```bash
qm disk import 100 soctalk-demo-<ver>.qcow2 local --format qcow2
```

Sur un stockage LVM-thin (`local-lvm`), retirez l'option `--format`: les stockages en mode bloc stockent en raw. L'import apparaît sur la VM sous le nom **Unused Disk 0**.

## 5. Attacher le disque, l'ISO d'amorçage et l'ordre de démarrage

De retour dans l'interface, ouvrez le panneau **Hardware** de la VM :

![Hardware, unused disk](/screenshots/proxmox-hardware-unused.png)

- Double-cliquez sur **Unused Disk 0** → laissez Bus/Device sur `SCSI 0` → **Add** :

![Attach the imported disk](/screenshots/proxmox-attach-disk.png)

- Double-cliquez sur **CD/DVD Drive (ide2)** → *Use CD/DVD disc image file* → stockage `local`, ISO `soctalk-seed.iso` → **OK** :

![Mount the seed ISO](/screenshots/proxmox-attach-seed.png)

- **Options** → **Boot Order** → placez `scsi0` en premier (ou `qm set 100 --boot order=scsi0`).

Le panneau Hardware devrait maintenant ressembler à ceci :

![Hardware, final](/screenshots/proxmox-hardware-final.png)

## 6. Démarrer et trouver l'IP de la VM

Cliquez sur **Start**. Le panneau Summary indique la VM en cours d'exécution :

![VM running](/screenshots/proxmox-vm-running.png)

La **Console** montre l'appliance qui démarre jusqu'à l'invite de connexion :

![Console, booted](/screenshots/proxmox-vm-console.png)

La VM obtient un bail DHCP depuis votre pont LAN. Trouvez son IP depuis la console (`login: ops` ne fonctionne que via une clé SSH, utilisez la sortie console ou votre serveur DHCP/routeur), ou depuis le nœud :

```bash
# the MAC is on the VM's Network Device (net0)
grep -B2 -A2 "$(qm config 100 | grep -oP 'virtio=\K[^,]+')" /var/lib/misc/dnsmasq.leases 2>/dev/null \
  || arp -an | grep -i "$(qm config 100 | grep -oP 'virtio=\K[^,]+')"
```

## 7. Lancer l'assistant et se connecter

Même déroulé que sur toutes les plateformes à partir d'ici :

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Rendez-vous sur `https://<vm-ip>:8443/`, acceptez le certificat auto-signé, collez le token et remplissez l'assistant ([référence des champs](/fr-fr/setup-wizard)). Après validation, l'installateur de premier démarrage exécute `helm install` et intègre le tenant `demo`: environ 2 minutes pour les pods `soctalk-system`, puis quelques minutes de plus pour la pile Wazuh du tenant de démonstration.

Rendez-vous ensuite sur `https://<vm-ip>/` (port 443, pas 8443), connectez-vous avec les identifiants admin de l'assistant, et poursuivez avec la [visite de l'interface MSSP](/fr-fr/mssp-ui). Si vous avez laissé le nom d'hôte vide dans l'assistant, associez `soctalk.local` à l'IP de la VM dans `/etc/hosts` et utilisez `https://soctalk.local/`.

## Dépannage

| Symptôme | Vérification |
|---|---|
| `qm disk import` échoue avec une erreur de stockage | Le stockage cible doit autoriser le contenu **Disk image** : Datacenter → Storage → edit → Content |
| La VM démarre sur « No bootable device » | L'ordre de démarrage pointe encore vers le disque par défaut supprimé, Options → Boot Order → `scsi0` en premier |
| L'assistant s'affiche mais pas de SSH | L'ISO d'amorçage n'est pas attachée (Hardware → ide2) ou la clé dans `user-data` est incorrecte ; vous pouvez lire le token depuis la Console à la place : `sudo cat /var/log/soctalk-setup-token` |
| La VM n'a pas d'IP | `ip a` depuis la Console ; vérifiez que le pont dans Hardware → net0 correspond à un pont avec DHCP sur votre LAN |
| La VM a une IP mais pas d'accès internet (configurations avec pont NAT) | PVE définit `bridge-nf-call-iptables=1`, ce qui peut faire que le trafic ponté contourne une règle `MASQUERADE` limitée à l'interface d'uplink. `sysctl -w net.bridge.bridge-nf-call-iptables=0` (si vous n'utilisez pas le pare-feu PVE) ou utilisez une règle indépendante de l'interface : `iptables -t nat -A POSTROUTING -s <subnet> ! -d <subnet> -j MASQUERADE`, puis videz conntrack |
| Tout ce qui se passe après l'assistant | Comme sur toutes les plateformes, voir le [tableau de dépannage du démarrage rapide](/fr-fr/quickstart-vm#troubleshooting) |
