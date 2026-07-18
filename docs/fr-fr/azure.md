# Exécuter la VM de démonstration sur Azure

Importez l'image `soctalk-demo-<ver>.vhd` publiée dans Azure en tant que disque managé, transformez-la en image de VM, puis démarrez-la. Les VM Azure s'exécutent sur Hyper-V, c'est donc aussi le moyen le plus rapide de valider l'image sur un hyperviseur Hyper-V sans avoir à mettre en place un hôte Windows Server.

Ce parcours s'adresse aux **évaluateurs et aux démonstrations** — pour une installation en production sur votre propre cluster, voir [Installation](/fr-fr/install).

## Pourquoi le `.vhd` (et pourquoi la Génération 1)

- Azure n'accepte que les disques **VHD à taille fixe, alignés sur 1 Mio** (pas les VHDX, pas les VHD dynamiques). Le fichier `soctalk-demo-<ver>.vhd` publié est produit exactement de cette manière par le pipeline de publication (`qemu-img convert -O vpc -o subformat=fixed,force_size`), il s'importe donc tel quel — aucune étape de conversion locale.
- L'image est construite et testée au démarrage sous firmware BIOS, ce qui correspond aux VM Azure de **Génération 1**. Créez le disque et l'image avec `--hyper-v-generation V1`.
- Un VHD fixe de 60 Go peut sembler lourd, mais il est presque entièrement composé de zéros. `azcopy` téléverse vers un blob de pages et **ignore les pages nulles**, si bien que le transfert réel correspond à peu près aux ~3 Go de données réelles.

## Prérequis

- Un abonnement Azure (`az account list` doit en afficher un — un accès à l'annuaire au niveau du tenant ne suffit pas).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) et [AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10) (`azcopy`). Sur macOS : `brew install azure-cli azcopy`.
- ~61 Go d'espace disque local libre pour le VHD décompressé.
- Une paire de clés SSH (`~/.ssh/id_ed25519.pub` dans les exemples ci-dessous).

Connectez-vous et sélectionnez l'abonnement :

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

## 1. Télécharger et décompresser le VHD

```bash
VER=<ver>   # p. ex. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vhd.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vhd.xz   # décompresse en un VHD fixe de 60 Go
```

## 2. Créer un groupe de ressources

Tout dans ce guide vit dans un seul groupe de ressources, la suppression tient donc en une seule commande à la fin.

```bash
RG=soctalk-demo
LOC=westus2
az group create -n $RG -l $LOC
```

## 3. Téléverser le VHD directement vers un disque managé

Aucun compte de stockage nécessaire — Azure prend en charge le téléversement direct vers un disque managé. Créez un disque vide dimensionné exactement au nombre d'octets du fichier VHD, obtenez un SAS d'écriture à courte durée de vie, téléversez avec `azcopy`, puis révoquez le SAS :

```bash
VHD=soctalk-demo-$VER.vhd
SIZE=$(stat -f %z "$VHD" 2>/dev/null || stat -c %s "$VHD")   # macOS || Linux

az disk create -g $RG -n soctalk-demo \
  --for-upload --upload-size-bytes $SIZE \
  --sku standard_lrs --os-type Linux --hyper-v-generation V1

SAS=$(az disk grant-access -g $RG -n soctalk-demo \
  --access-level Write --duration-in-seconds 86400 \
  --query accessSAS -o tsv)

azcopy copy "$VHD" "$SAS" --blob-type PageBlob

az disk revoke-access -g $RG -n soctalk-demo
```

L'étape `azcopy` est la seule qui soit longue ; grâce à l'omission des pages nulles, elle ne déplace que les données réelles (~3 Go).

## 4. Créer une image à partir du disque

```bash
DISK_ID=$(az disk show -g $RG -n soctalk-demo --query id -o tsv)

az image create -g $RG -n soctalk-demo-image \
  --source $DISK_ID --os-type Linux --hyper-v-generation V1
```

## 5. Démarrer une VM

Restreignez le groupe de sécurité réseau à votre propre adresse IP — la machine expose SSH (22), l'interface SocTalk (443) et l'assistant de configuration (8443), dont aucun ne devrait être ouvert sur Internet :

```bash
MYIP=$(curl -s https://ifconfig.me)

az network nsg create -g $RG -n soctalk-nsg
i=100
for port in 22 443 8443; do
  az network nsg rule create -g $RG --nsg-name soctalk-nsg \
    -n allow-$port --priority $i --access Allow --protocol Tcp \
    --direction Inbound --source-address-prefixes $MYIP/32 \
    --destination-port-ranges $port
  i=$((i+10))
done

az vm create -g $RG -n soctalk-demo-vm \
  --image soctalk-demo-image \
  --size Standard_D4s_v3 \
  --admin-username ops \
  --ssh-key-values ~/.ssh/id_ed25519.pub \
  --nsg soctalk-nsg \
  --public-ip-sku Standard

IP=$(az vm show -g $RG -n soctalk-demo-vm -d --query publicIps -o tsv)
echo "VM is at $IP"
```

`Standard_D4s_v3` (4 vCPU / 16 Gio) couvre confortablement le [dimensionnement minimal](/fr-fr/reference/sizing) de 4 vCPU / 8 Go. Toute configuration plus petite peinera dès que la pile Wazuh du tenant de démonstration démarrera.

::: tip Aucun ISO de seed nécessaire
Sur les hyperviseurs, vous attachez un `seed.iso` NoCloud pour injecter une clé SSH ([Démarrage rapide](/fr-fr/quickstart-vm#optional-cloud-init-seed)). Sur Azure, cette étape disparaît : le cloud-init de l'image détecte la source de données Azure et provisionne automatiquement `--admin-username` / `--ssh-key-values`.
:::

## 6. Récupérer le jeton de configuration et lancer l'assistant

À partir d'ici, le flux est identique à celui de tout autre hyperviseur. Laissez ~2 minutes à la VM après le démarrage pour que le service de l'assistant soit disponible, puis :

```bash
ssh ops@$IP sudo cat /var/log/soctalk-setup-token
```

Rendez-vous sur `https://<IP>:8443/`, acceptez le certificat auto-signé, collez le jeton et remplissez l'assistant — nom du MSSP, identifiants administrateur, fournisseur LLM + clé API. Voir [Assistant de configuration](/fr-fr/setup-wizard) pour la référence des champs.

Après validation, l'installateur du premier démarrage exécute `helm install` et intègre le tenant `demo` — environ 2 minutes pour les pods `soctalk-system`, puis quelques minutes de plus pour la pile Wazuh du tenant de démonstration. Vous pouvez suivre l'opération depuis SSH :

```bash
ssh ops@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

## 7. Se connecter

Rendez-vous sur `https://<IP>/` (port 443, pas 8443) et connectez-vous avec les identifiants administrateur de l'assistant. Si vous avez laissé le nom d'hôte vide dans l'assistant, faites pointer `soctalk.local` vers l'IP de la VM dans `/etc/hosts` et utilisez `https://soctalk.local/`. Poursuivez avec la [Visite guidée de l'interface MSSP](/fr-fr/mssp-ui).

## 8. Supprimer l'environnement

Tout a été créé à l'intérieur du groupe de ressources, donc :

```bash
az group delete -n $RG --yes --no-wait
```

Cela supprime la VM, la carte réseau, l'IP publique, le NSG, le disque managé et l'image en une seule opération. Rien d'autre ne continue à être facturé.

## Dépannage

| Symptôme | Vérification |
|---|---|
| `az disk create --for-upload` rejeté | `--upload-size-bytes` doit être la taille **exacte** du fichier en octets du `.vhd` décompressé, pied de page inclus — relancez la commande `stat` |
| `azcopy` échoue avec une erreur 403 | Le SAS d'écriture a expiré (24 h dans l'exemple) ou a déjà été révoqué — relancez `az disk grant-access` |
| La VM n'obtient jamais la clé SSH | Vérifiez que l'image et le disque ont été créés avec `--hyper-v-generation V1` ; une image V2 issue de ce VHD ne démarrera pas, et un démarrage échoué n'atteint jamais cloud-init |
| L'URL de l'assistant ne se charge jamais | Règle NSG pour 8443 manquante ou votre IP publique a changé (`curl ifconfig.me` et comparez) ; ensuite `systemctl status soctalk-setup-wizard` via SSH |
| Tout ce qui suit l'assistant | Identique à chaque plateforme — voir le [tableau de dépannage du Démarrage rapide](/fr-fr/quickstart-vm#troubleshooting) |
