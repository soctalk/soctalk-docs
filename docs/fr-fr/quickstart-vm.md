# Démarrage rapide : VM de démonstration SocTalk

Le moyen le plus rapide d'essayer SocTalk de bout en bout : téléchargez une image de VM pré-construite, démarrez-la, ouvrez l'assistant de configuration dans votre navigateur et cliquez pour avancer. Cinq minutes suffisent pour obtenir une installation multi-tenant opérationnelle avec un tenant de démonstration intégré.

Ce parcours s'adresse aux **évaluateurs et aux démonstrations**: pour une installation en production sur votre propre cluster, consultez [Installation](/fr-fr/install).

## Ce que contient l'image

- Ubuntu 24.04 LTS, cloud-init activé
- K3s avec l'ingress Traefik intégré
- Helm + un chart `soctalk-system` pré-téléchargé
- Un assistant de configuration au premier démarrage sur `:8443`
- Un installateur de premier démarrage (`soctalk-firstboot.service`) qui s'exécute une fois que l'assistant a collecté la configuration
- L'image est identique quel que soit le format (qcow2 / vmdk / vhdx / vhd / raw) ; choisissez celui que votre hyperviseur consomme nativement. Consultez [Téléchargements](/fr-fr/downloads).

## 1. Télécharger

Choisissez le format adapté à votre hyperviseur sur la page [Téléchargements](/fr-fr/downloads). Exemples :

```bash
# KVM / Proxmox / libvirt
curl -L -o soctalk-demo.qcow2.xz \
  https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-<ver>.qcow2.xz
xz -d soctalk-demo.qcow2.xz
```

Vérifiez la somme de contrôle :

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 2. Démarrer l'image

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

`qm disk import <vmid> soctalk-demo.qcow2 <storage>`, puis attachez-le en SCSI et démarrez. Guide complet avec captures d'écran de l'interface web : [Exécuter sur Proxmox](/fr-fr/proxmox).

### VMware

Importez `soctalk-demo.vmdk` comme disque existant sur une nouvelle VM (Linux, Ubuntu 64 bits).

### VirtualBox

Convertissez `soctalk-demo.vmdk` en VDI et attachez-le à une nouvelle VM. Guide complet avec captures d'écran : [Exécuter sur VirtualBox](/fr-fr/virtualbox).

### Hyper-V

Utilisez `soctalk-demo.vhdx` comme disque système sur une VM de **Génération 1** (l'image démarre via le firmware BIOS ; la Génération 2 / UEFI n'est pas testée). Pour injecter une clé SSH, attachez un `seed.iso` NoCloud comme lecteur DVD, consultez [Optionnel : seed cloud-init](#optional-cloud-init-seed).

### AWS

Construisez une AMI native avec Packer, ou importez `soctalk-demo.vmdk` comme AMI avec VM Import. Guide complet : [Exécuter sur AWS](/fr-fr/aws).

### Azure

Téléversez `soctalk-demo.vhd` (taille fixe) directement sur un Managed Disk, puis créez une image et une VM de Génération 1 à partir de celui-ci. Guide complet : [Exécuter sur Azure](/fr-fr/azure).

### Raw / dd

`soctalk-demo.raw` est la copie bit à bit de ce qui se trouve sur le disque. Convient à l'import d'image cloud générique (GCP, OpenStack) ou à l'écriture sur un disque physique avec `dd`.

**Dimensionnement minimum** : 4 vCPU, 8 Go de RAM, 60 Go de disque. Consultez [Dimensionnement](/fr-fr/reference/sizing).

## 3. Obtenir le jeton de configuration

L'assistant écoute sur `:8443` avec TLS (auto-signé). Il refuse les connexions sans le jeton de configuration propre à chaque démarrage. Connectez-vous en SSH à la machine et lisez-le :

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

La connexion recommandée est l'**utilisateur `ops` avec votre clé SSH**, créé par le seed cloud-init dans [§ Optionnel : seed cloud-init](#optional-cloud-init-seed) ci-dessous. Si vous démarrez sans seed, consultez [§ Accès SSH + identifiants](#ssh-access-credentials) pour la solution de repli définie au moment de la construction, et lisez la note de sécurité qui s'y trouve avant d'exposer la VM à un réseau auquel vous ne faites pas confiance.

## 4. Ouvrir l'assistant

Rendez-vous sur `https://<vm-ip>:8443/`. Acceptez le certificat auto-signé. Vous arriverez sur la page de saisie du jeton :

![Assistant de configuration, saisie du jeton](/screenshots/setup-wizard-token.png)

Collez le jeton, puis renseignez :

- Nom du MSSP / de l'organisation
- Nom d'hôte (optionnel, laissez vide pour utiliser l'IP de la machine)
- E-mail + mot de passe de l'administrateur (12 caractères minimum)
- Fournisseur LLM + clé API

Consultez [Assistant de configuration](/fr-fr/setup-wizard) pour la référence complète des champs.

Validez. L'assistant écrit `values.yaml`, le Secret LLM et un fichier d'environnement d'intégration, puis se termine. L'installateur de premier démarrage prend le relais :

1. Démarre k3s
2. Crée le namespace `soctalk-system` + le Secret LLM
3. `helm install soctalk-system`
4. Se connecte en tant qu'administrateur bootstrap et intègre un tenant `demo` via `POST /api/mssp/tenants/onboard`

Temps total écoulé après validation : environ 2 minutes pour que les pods `soctalk-system` soient Ready, puis 1 à 3 minutes supplémentaires pour que la stack Wazuh du tenant de démonstration atteigne l'état Ready.

## 5. Se connecter

Rendez-vous sur `https://<vm-ip>/` (remarque : port 443, et non 8443, l'assistant écoute spécifiquement sur 8443 pour éviter tout conflit avec Traefik). Le tableau de bord MSSP attend un nom DNS ; si vous avez laissé le nom d'hôte vide, ajoutez une entrée `/etc/hosts` faisant pointer `soctalk.local` vers l'IP de la VM et rendez-vous sur `https://soctalk.local/`.

Connectez-vous avec l'e-mail + le mot de passe de l'administrateur définis dans l'assistant. Vous arriverez sur le tableau de bord MSSP. Poursuivez avec la [Visite de l'interface MSSP](/fr-fr/mssp-ui).

## Optionnel : seed cloud-init

Si vous souhaitez injecter une clé SSH (ou ignorer entièrement l'assistant en fournissant directement values.yaml), transmettez les user-data cloud-init via NoCloud :

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

Pour ignorer l'assistant, déposez `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` via `write_files` de cloud-init ; la condition systemd de l'assistant (`ConditionPathExists=!/etc/soctalk/values.yaml`) court-circuitera et l'installateur passera directement à `helm install`.

## Accès SSH + identifiants

Les images disque téléchargeables (qcow2 / vmdk / vhdx / vhd / raw) sont toutes livrées avec **deux** identités de connexion possibles. Celle que vous utilisez dépend du fait que vous ayez ou non fourni des user-data cloud-init.

### Production : utilisateur `ops` (recommandé)

Le seed cloud-init dans [§ Optionnel : seed cloud-init](#optional-cloud-init-seed) crée un utilisateur `ops` avec votre clé SSH. Authentification par clé SSH uniquement, aucun mot de passe n'est défini.

```bash
ssh -i ~/.ssh/<your-private-key> ops@<vm-ip>

# Root shell, no further password
sudo -i
```

### Utilisateur `ubuntu` de construction (présent dans chaque image livrée)

La construction Packer utilise un utilisateur `ubuntu` de construction avec un mot de passe connu. L'étape de nettoyage censée verrouiller ce compte n'a pas encore été mise en place, il est donc livré dans l'image. Si vous démarrez sans seed cloud-init, c'est le seul moyen d'obtenir un accès console via SSH :

| Utilisateur | Mot de passe | Sudo |
|---|---|---|
| `ubuntu` | `packer` | `ALL=(ALL) NOPASSWD:ALL` |

L'authentification SSH par mot de passe est activée par le même seed, de sorte que l'image accepte :

```bash
# Interactive
ssh ubuntu@<vm-ip>
# password: packer

# Non-interactive (requires sshpass)
sshpass -p packer ssh -o StrictHostKeyChecking=accept-new ubuntu@<vm-ip>

# Root shell, no further password
sudo -i
```

### Liste de vérification du durcissement

À exécuter en tant que `ops` après le premier démarrage, ou à intégrer dans votre `runcmd:` cloud-init pour qu'elle se déclenche automatiquement :

```bash
# Disable the build user
sudo passwd -l ubuntu
sudo usermod -s /usr/sbin/nologin ubuntu

# Turn off password SSH auth
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```

L'AMI AWS est construite à partir d'une source Packer distincte (`amazon-ebs`) qui n'inclut pas le seed et utilise plutôt l'injection de paire de clés d'EC2 ; elle ne comporte pas l'identifiant `ubuntu:packer`. La liste de vérification du durcissement s'applique tout de même à elle pour l'utilisateur `ubuntu` standard de l'image cloud de l'AMI.

## Étape suivante : intégrer des clients avec Launchpad

Vous venez d'exécuter SocTalk de bout en bout sur une seule machine co-localisée. L'étape suivante naturelle est un véritable pilote, un plan de contrôle MSSP plus un ou plusieurs environnements tenant sur votre propre infrastructure. [**Launchpad**](/fr-fr/launchpad) fait exactement cela avec une seule commande : il démarre les VMs, les joint à votre tailnet, installe SocTalk depuis des sources publiques et vous remet une URL. (Vous préférez exécuter chaque étape à la main ? Consultez le [pilote MSSP à faire soi-même](/fr-fr/mssp-pilot).)

## Dépannage

| Symptôme | Vérification |
|---|---|
| L'URL de l'assistant ne se charge jamais | `systemctl status soctalk-setup-wizard` sur la VM. Si `inactive`, examinez `journalctl -u soctalk-setup-wizard` |
| L'assistant indique « invalid token » | Le jeton se trouve dans `/var/log/soctalk-setup-token`, **détenu par root**. Utilisez `sudo cat`. Chaque démarrage régénère le jeton |
| L'assistant indique « rate-limited » | L'assistant verrouille l'IP après 10 tentatives de jeton échouées. Attendez 1 h ou exécutez `systemctl restart soctalk-setup-wizard` (cela fait aussi tourner le jeton) |
| `helm install` se bloque | `kubectl get pods -A` depuis la machine ; `journalctl -u soctalk-firstboot -f` |
| Les pods adapter / runs-worker du tenant de démonstration restent bloqués en ImagePullBackOff | Connu : le contrôleur utilise par défaut un tag d'image non publié. Consultez [Dépannage](/fr-fr/troubleshooting) |

Pour une réinitialisation propre : supprimez `/var/lib/soctalk-firstboot.done`, `/var/lib/soctalk-wizard.done`, `/etc/soctalk/values.yaml`, puis exécutez `systemctl restart soctalk-setup-wizard`.
