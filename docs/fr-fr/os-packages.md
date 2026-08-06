# Installer depuis un paquet système (rpm / deb)

Chaque version de SocTalk est livrée avec des paquets système natifs aux côtés
des images de VM, attachés à la même GitHub Release que le tag de version, pour
les deux familles Linux basées sur systemd :

| Fichier | Gestionnaire de paquets | Validé sur | Aussi supposé fonctionner |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9.8 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Les deux sont validés de bout en bout : installer le paquet, exécuter
`soctalk install`, atteindre l'application web et s'y connecter. La colonne
« aussi supposé » désigne la même famille de paquets, mais celle-ci n'a pas été
testée spécifiquement sur ces distributions.

Sur Rocky Linux 9.8, la validation a couvert les deux formes livrées par le
produit, sur des VM neuves avec SELinux en mode Enforcing. L'installation
limitée au plan de contrôle a démarré `api`, `app-ui` et `postgres`, et
l'administrateur d'amorçage a pu se connecter. L'installation complète a en
outre intégré un tenant `poc` qui a monté son propre manager, son indexer et
son dashboard Wazuh, et qui a atteint l'état `active`. Cette seconde exécution
a été menée avec firewalld activé, ce qui exige les règles décrites dans
[les notes RHEL](#rhel-fedora-almalinux-rocky) ci-dessous avant que le cluster
ne fonctionne. Ces notes expliquent ce que SELinux et firewalld exigent, ou
n'exigent pas, de votre part.

**Alpine n'est pas pris en charge** et aucun `.apk` n'est publié :
`soctalk install` requiert systemd, et Alpine utilise OpenRC. Voir
[Alpine et autres hôtes sans systemd](#alpine-and-other-non-systemd-hosts)
ci-dessous. **openSUSE / zypper** et **RHEL 10** ne sont pas testés ; les notes
RHEL/Fedora peuvent ne pas s'appliquer entièrement. **amd64 uniquement** : il
n'existe pas de paquet arm64.

Ils sont publiés sur la page des versions de
[`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases). La version
actuelle est la **v0.2.0** :
[page de la version](https://github.com/soctalk/soctalk/releases/tag/v0.2.0).
Le dépôt est public, aucune authentification n'est donc nécessaire pour les
télécharger.

## Ce que le paquet installe

Le paquet est volontairement léger. SocTalk s'exécute sur Kubernetes (K3s), le
paquet ne contient donc pas la stack SOC elle-même. Il installe une CLI de
gestion légère et l'installateur, puis vous exécutez une seule commande pour
démarrer la stack :

- `/usr/bin/soctalk`, la CLI de gestion (`install`, `upgrade`, `status`,
  `logs`, `uninstall`, `version`).
- `/usr/libexec/soctalk/install.sh`, le même installateur que celui utilisé par
  la [VM de démonstration](/fr-fr/quickstart-vm) et par l'[installation en une
  commande](/fr-fr/install). Il amorce K3s et Helm s'ils sont absents, puis
  installe via Helm la chart `soctalk-system` depuis GHCR.
- `/etc/soctalk/soctalk.env.example`, un modèle pour les installations sans
  intervention.

Les seules dépendances sont `curl` et `tar` ; l'installateur récupère K3s et
Helm lui-même. C'est la bonne voie lorsque vous installez sur un hôte Linux que
vous gérez directement et que vous voulez que SocTalk soit enregistré dans la
base de données de paquets du système (afin que `dnf`/`apt` le suivent et le
mettent à jour). Si vous voulez simplement essayer SocTalk, l'[image de VM de
démonstration](/fr-fr/quickstart-vm) est plus rapide.

## Installer le paquet

Choisissez le bloc correspondant à votre distribution. Remplacez `0.2.0` par la
version actuelle si vous êtes sur une version plus récente.

### RHEL, Fedora, AlmaLinux, Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

`dnf` récupère `curl` et `tar` s'ils sont absents. Sur les hôtes plus anciens,
utilisez `sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`.

Certaines images RHEL 9 embarquent `curl-minimal` à la place du `curl` complet,
ce qui peut entrer en conflit avec les paquets qui exigent `curl` par son nom.
Il n'y a pas de conflit ici. Sur l'hôte Rocky Linux 9.8 utilisé pour la
validation, avec `curl` supprimé et seul `curl-minimal` installé, le rpm s'est
installé sans changement : `curl-minimal` déclare `Provides: curl`, la
dépendance se résout donc sans remplacement et sans `--allowerasing`.

### Debian, Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` résout les dépendances `curl` et `tar` depuis les
dépôts que vous avez configurés. Sur une image minimale dépourvue d'`apt`, vous
pouvez utiliser
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install`.

## Vérifier le téléchargement

Chaque version inclut un fichier `SHA256SUMS.txt` couvrant tous les artefacts,
y compris les paquets.

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` ne vérifie que les fichiers que vous avez réellement
téléchargés. Chaque ligne devrait indiquer `OK`.

## Démarrer la stack SOC

Installer le paquet ne démarre pas SocTalk. Une fois le paquet installé,
exécutez l'installateur via la CLI. Cela installe K3s et Helm si nécessaire,
puis installe via Helm `soctalk-system` sur cet hôte.

Interactif (demande le nom du MSSP, l'administrateur et le fournisseur LLM) :

```bash
sudo soctalk install
```

Démonstration jetable (mot de passe admin aléatoire, intègre automatiquement un
tenant de démonstration) :

```bash
sudo soctalk install --demo
```

`--demo` marque tout de même une pause pour une invite de consentement. Pour une
exécution entièrement sans intervention (aucun terminal attaché, par exemple
depuis un script de provisionnement), ajoutez `--yes` :
`sudo soctalk install --demo --yes`.

Sans intervention, piloté par des variables d'environnement (copiez le modèle
livré) :

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

Lorsque `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL` et `SOCTALK_ADMIN_PASSWORD`
sont tous définis, l'installateur passe son invite de consentement, si bien que
cette exécution se déroule sans aucune interaction. Tout argument placé après
`install` est transmis à l'installateur, par exemple
`soctalk install --chart-version 0.2.0` pour épingler une chart ou
`soctalk install --values-file /etc/soctalk/values.yaml` pour une installation
en environnement isolé. Voir [Installation en production](/fr-fr/install) pour
la référence complète des options et pour la voie du cluster basé sur Cilium.

## Gérer l'installation

La CLI encapsule les opérations courantes du cluster afin que vous n'ayez pas à
mémoriser le chemin `KUBECONFIG` ni le nom de la release Helm.

```bash
soctalk status              # pods and their readiness in soctalk-system
soctalk logs api            # tail a component's logs (api, app-ui, postgres)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk logs` couvre le plan de contrôle dans `soctalk-system`. Les charges de
travail propres à chaque tenant, comme l'adaptateur et le runs-worker, vivent
dans des namespaces `tenant-<slug>` ; utilisez donc plutôt `kubectl` sur ce
namespace pour les atteindre.

`soctalk upgrade` est un `helm upgrade --install` : il est donc sans danger de
le relancer, et c'est ainsi que vous passez à une chart plus récente après avoir
installé un paquet plus récent.

## Désinstaller

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

Supprimer le paquet système (`dnf remove soctalk` ou `apt remove soctalk`)
efface la CLI et l'installateur, mais ne touche pas à un cluster en cours
d'exécution. Exécutez d'abord `soctalk uninstall` si vous voulez que la stack
SOC disparaisse.

## Notes spécifiques au système

### RHEL, Fedora, AlmaLinux, Rocky

#### SELinux

Validé sur Rocky Linux 9.8 avec SELinux en mode **Enforcing**, aussi bien pour
l'installation limitée au plan de contrôle que pour l'installation complète
avec un tenant adossé à Wazuh. Aucun travail manuel sur SELinux n'est
nécessaire. Pendant `soctalk install`, l'installateur K3s a récupéré de
lui-même `k3s-selinux` 1.6 et `container-selinux`, et le cluster a démarré sans
que personne ne touche à un booléen, à une étiquette ou à un module
personnalisé. Aucune des deux exécutions n'a enregistré de refus AVC.

Notez bien la portée de cette affirmation. Elle signifie que SocTalk fonctionne
correctement sous la politique targeted, et non que SELinux confine la charge
de travail comme couche de durcissement. L'activation de l'application SELinux
propre à K3s (`--selinux` / `K3S_SELINUX=true`) n'a pas été testée. RHEL 10
nécessite en outre le paquet `kernel-modules-extra` pour K3s, ce qui n'a pas
été testé non plus.

#### firewalld

L'image Rocky Linux 9.8 GenericCloud utilisée pour la validation n'inclut pas
du tout firewalld, une VM cloud n'a donc souvent rien à faire ici. Une
installation serveur complète, elle, l'inclut et l'active. Avec firewalld en
service sous sa politique par défaut, l'installation restait bloquée tant que
les réseaux de pods et de services de K3s n'étaient pas déclarés de confiance ;
sur un tel hôte, cette étape est donc un prérequis plutôt qu'un conseil de
durcissement.

Cette défaillance mérite d'être reconnue, car elle ne ressemble pas à un
problème de pare-feu. K3s s'installe proprement, le nœud passe `Ready`, les
images se téléchargent et tous les pods sont planifiés. Ce qui casse, c'est le
trafic de pod à pod et de pod à Service sur le pont flannel : le conteneur
d'initialisation `db-init` de l'API ne parvient pas à joindre Postgres et
boucle sur `No route to host` alors que Postgres lui-même reste bien
`1/1 Running`. L'installation consomme ensuite toute sa fenêtre Helm `--wait`
avant d'échouer sur un timeout, la véritable cause restant enfouie dans le
journal d'un conteneur d'initialisation.

Déclarez de confiance les réseaux de pods et de services de K3s, et ouvrez les
ports d'ingress par lesquels vous atteignez l'interface :

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

Ce sont les valeurs par défaut de K3s ; si vous définissez un CIDR de cluster ou
de service personnalisé, utilisez celui-ci à la place. Un cluster multi-nœuds
nécessite davantage de ports ouverts entre les nœuds (voir les exigences réseau
de K3s).

Si l'installation est encore en attente au moment où vous appliquez les règles,
elle repart au prochain essai et se termine ; vous n'avez pas à tout
recommencer. Si Helm a déjà expiré, appliquez les règles et relancez
`sudo soctalk install`. Après la v0.2.0, les contrôles préalables de
l'installateur vérifient ce point et affichent ces commandes avant de toucher à
l'hôte ([soctalk#118](https://github.com/soctalk/soctalk/issues/118)).

SocTalk ne modifie pas les règles firewalld à votre place. C'est votre frontière
de sécurité, et c'est à vous de l'ouvrir.

#### sudo et /usr/local/bin

K3s et Helm installent leurs binaires, ainsi que le lien symbolique `kubectl`,
dans `/usr/local/bin`. Les distributions de la famille RHEL laissent ce
répertoire en dehors du `secure_path` de sudo
(`Defaults secure_path = /sbin:/bin:/usr/sbin:/usr/bin`) : un simple
`sudo k3s ...`, `sudo kubectl ...` ou `sudo helm ...` répond donc
`command not found` alors même que le binaire est bien là et que l'installation
a réussi.

La CLI `soctalk` résout ces chemins elle-même, si bien que
`sudo soctalk install`, `soctalk status` et `soctalk logs` fonctionnent tels
quels. Lorsque vous avez besoin de `kubectl` directement, indiquez soit le
chemin complet, soit ajoutez le répertoire à votre propre `PATH` :

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

Ailleurs sur ce site, la documentation écrit parfois cela sous la forme
`sudo k3s kubectl ...`, ce qui est correct sur Debian et Ubuntu mais nécessite
le chemin complet sur les hôtes de la famille RHEL.

### Alpine et autres hôtes sans systemd {#alpine-and-other-non-systemd-hosts}

**L'installateur de SocTalk requiert systemd.** Il démarre K3s en tant que
service systemd et attend le kubeconfig écrit par systemd : il ne fonctionne
donc pas sur Alpine (OpenRC) ni sur aucun autre init dépourvu de systemd. Sur
un tel hôte, `soctalk install` s'arrête tôt avec un message clair qui vous
l'indique. C'est pour cette raison qu'aucun `.apk` n'est publié.

Pour exécuter SocTalk là où vous envisagiez Alpine, utilisez une distribution
avec systemd (la voie `.deb` ou `.rpm` ci-dessus) ou l'[image de VM de
démonstration](/fr-fr/quickstart-vm) préconstruite.

## Quelle voie choisir ?

- **Paquet système (cette page)** : un hôte Linux que vous gérez, suivi par le
  gestionnaire de paquets du système. Adapté aux installations reproductibles
  et gérées par configuration.
- **[Installation en une commande](/fr-fr/install)** :
  `curl … | install.sh | bash` sur une VM Ubuntu vierge, le même installateur
  sans l'enveloppe du paquet.
- **[Image de VM de démonstration](/fr-fr/quickstart-vm)** : une appliance
  préconstruite avec un assistant de configuration dans le navigateur, la voie
  la plus rapide vers un système opérationnel pour l'évaluation.

Toutes les trois aboutissent à la même chart `soctalk-system` et au même SOC en
cours d'exécution.
