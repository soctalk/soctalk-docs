# Exécuter la VM de démonstration sur VirtualBox

VirtualBox est le moyen multiplateforme le plus simple pour essayer SocTalk sur un poste de travail — gratuit, piloté par interface graphique, et disponible sur Windows, Linux et macOS Intel. Ce guide importe l'image de démonstration publiée et la démarre. Validé sur VirtualBox 7.0.

Cette voie s'adresse aux **évaluateurs et aux démonstrations** — pour une installation en production sur votre propre cluster, consultez [Installation](/fr-fr/install).

::: warning Mac Apple Silicon (série M)
L'image de démonstration est en **x86-64**, que VirtualBox ne peut pas exécuter sur Apple Silicon. Sur un Mac de série M, utilisez un [lancement cloud](/fr-fr/aws) ou un autre hôte. VirtualBox signifie ici Windows, Linux ou un Mac **Intel**.
:::

## Prérequis

- [VirtualBox](https://www.virtualbox.org/) 7.0 ou plus récent.
- ~3 Go d'espace disque libre pour l'image convertie.
- Une paire de clés SSH (`~/.ssh/id_ed25519.pub` dans les exemples) pour lire le jeton d'installation via SSH.

## 1. Télécharger et décompresser l'image

Récupérez le fichier **vmdk** depuis la page [Téléchargements](/fr-fr/downloads) (le format compatible VMware de VirtualBox) :

```bash
VER=0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

## 2. Convertir le vmdk au format natif VDI de VirtualBox

Le vmdk publié est en **streamOptimized** (une disposition VMware/OVA en lecture seule), que VirtualBox ne démarrera pas comme disque inscriptible. Convertissez-le une fois en VDI :

```bash
VBoxManage clonemedium disk soctalk-demo-0.2.0.vmdk soctalk-demo-0.2.0.vdi --format VDI
```

Cela produit un fichier `soctalk-demo-0.2.0.vdi` inscriptible et à taille dynamique (quelques Go sur le disque). `VBoxManage` est fourni avec VirtualBox — sous Windows, il se trouve dans `C:\Program Files\Oracle\VirtualBox\`.

## 3. Créer une image ISO d'amorçage cloud-init

Une petite image ISO d'amorçage NoCloud crée un utilisateur `ops` avec votre clé SSH afin que vous puissiez lire le jeton d'installation généré à chaque démarrage. Si vous l'omettez, vous pouvez toujours vous connecter en tant qu'utilisateur `ubuntu:packer` défini lors de la construction (voir [Accès SSH](/fr-fr/quickstart-vm#ssh-access-credentials)) — mais cette information d'identification figure dans l'arbre source public, alors renforcez la VM avant de l'exposer. Sous Linux/macOS :

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

## 4. Créer la VM

Ouvrez **VirtualBox** et cliquez sur **Nouvelle**.

![VirtualBox Manager](/screenshots/virtualbox-manager.png)

**Nom et système d'exploitation** — nommez-la `soctalk-demo`, réglez **Type** sur *Linux* et **Version** sur *Ubuntu (64-bit)*. Laissez l'ISO vide :

![Nom et système d'exploitation](/screenshots/virtualbox-create-name.png)

**Matériel** — attribuez-lui **8192 Mo** de mémoire et **4 processeurs** (le minimum de [dimensionnement](/fr-fr/reference/sizing) est de 4 vCPU / 8 Go ; la pile Wazuh a besoin de cette RAM) :

![Matériel](/screenshots/virtualbox-create-hardware.png)

**Disque dur virtuel** — choisissez **Utiliser un fichier de disque dur virtuel existant** et sélectionnez le fichier `soctalk-demo-0.2.0.vdi` que vous avez converti :

![Utiliser un disque existant](/screenshots/virtualbox-create-disk.png)

**Résumé** — confirmez les paramètres et cliquez sur **Terminer** :

![Résumé](/screenshots/virtualbox-create-summary.png)

La VM apparaît dans le Manager avec le VDI sur son contrôleur SATA :

![VM créée](/screenshots/virtualbox-vm-details.png)

## 5. Attacher l'ISO d'amorçage et configurer le réseau

Sélectionnez la VM et cliquez sur **Configuration**.

**Stockage** — sous le contrôleur IDE, cliquez sur le lecteur optique et choisissez votre fichier `soctalk-seed.iso` (cliquez sur l'icône du disque → *Choisir un fichier de disque*). Le VDI est déjà sur le contrôleur SATA :

![Stockage](/screenshots/virtualbox-storage.png)

**Réseau** — réglez **Adaptateur 1 → Attaché à : Accès par pont** afin que la VM obtienne une IP sur votre LAN et que vous puissiez atteindre l'assistant directement :

![Réseau — accès par pont](/screenshots/virtualbox-network.png)

Cliquez sur **OK**.

::: tip NAT au lieu de l'accès par pont
Si vous ne pouvez pas utiliser l'accès par pont (par exemple sur un réseau restreint), laissez le NAT par défaut et ajoutez des règles de **redirection de ports** sous Réseau → Avancé (hôte `8443` → invité `8443` pour l'assistant, hôte `8080` → invité `443` pour l'interface), puis utilisez `localhost` au lieu de l'IP de la VM ci-dessous.
:::

## 6. Démarrer et trouver l'IP de la VM

Cliquez sur **Démarrer**. La console démarre jusqu'à une invite de connexion :

![Console](/screenshots/virtualbox-console.png)

Trouvez l'IP en accès par pont de la VM — depuis les baux DHCP de votre routeur, ou en faisant correspondre l'adresse MAC de la VM :

```bash
VBoxManage showvminfo soctalk-demo | grep "MAC"      # note the MAC
arp -an | grep -i <mac>                               # find the matching IP
```

## 7. Exécuter l'assistant et se connecter

Lisez le jeton d'installation généré à chaque démarrage via SSH, puis pilotez l'assistant :

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Accédez à `https://<vm-ip>:8443/`, acceptez le certificat auto-signé, collez le jeton et remplissez l'assistant ([référence des champs](/fr-fr/setup-wizard)). Après la soumission, l'installateur de premier démarrage exécute `helm install` et intègre le tenant `demo` — environ 2 minutes pour les pods `soctalk-system`, puis quelques minutes de plus pour la pile Wazuh du tenant de démonstration :

```bash
ssh ops@<vm-ip>
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Accédez ensuite à `https://<vm-ip>/` (port 443, pas 8443), connectez-vous avec les identifiants administrateur de l'assistant, et poursuivez avec la [Visite de l'interface MSSP](/fr-fr/mssp-ui). Si vous avez laissé le nom d'hôte vide dans l'assistant, associez `soctalk.local` à l'IP de la VM dans votre fichier hosts et utilisez `https://soctalk.local/`.

## 8. Démonter

```bash
VBoxManage controlvm soctalk-demo poweroff
VBoxManage unregistervm soctalk-demo --delete
VBoxManage closemedium disk soctalk-demo-0.2.0.vdi --delete
```

## Dépannage

| Symptôme | Vérification |
|---|---|
| La VM ne démarre pas : « cannot open … streamOptimized » / disque en lecture seule | Vous avez attaché le fichier `.vmdk` brut. Utilisez le fichier `.vdi` converti à l'étape 2 |
| Ne s'exécute pas sur un Mac Apple Silicon | Attendu — l'image est en x86-64 ; utilisez plutôt un [lancement cloud](/fr-fr/aws) |
| La console affiche des erreurs `vmwgfx … unsupported hypervisor` | Sans conséquence — c'est le GPU émulé de VirtualBox ; l'appliance est headless et démarre correctement |
| La VM n'a pas d'IP en accès par pont | Choisissez la bonne carte réseau hôte dans Réseau → Nom ; vérifiez que votre LAN dispose du DHCP. Ou utilisez l'option NAT + redirection de ports ci-dessus |
| Impossible de lire le jeton (pas de SSH) | L'ISO d'amorçage n'est pas attachée (Stockage → IDE) ou sa clé est incorrecte ; revérifiez les étapes 3/5 |
| Tout ce qui suit l'assistant | Identique à toutes les plateformes — voir le [tableau de dépannage du démarrage rapide](/fr-fr/quickstart-vm#troubleshooting) |
