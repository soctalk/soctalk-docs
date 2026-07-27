# Installer depuis un paquet système (rpm / deb)

Chaque version de SocTalk est livrée avec des paquets système natifs aux côtés des images de VM, attachés à la même GitHub Release que le tag de version, pour les deux familles Linux basées sur systemd :

| Fichier | Gestionnaire de paquets | Validé sur | Aussi supposé fonctionner |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Les deux sont validés de bout en bout : installer le paquet, exécuter `soctalk install`, atteindre l'application web et se connecter. La colonne « aussi supposé » désigne la même famille de paquets, mais qui n'a pas été testée spécifiquement sur ces distributions.

**Alpine n'est pas pris en charge** et aucun `.apk` n'est publié : `soctalk install` requiert systemd, et Alpine utilise OpenRC. Voir [Alpine et autres hôtes sans systemd](#alpine-and-other-non-systemd-hosts) ci-dessous. **openSUSE / zypper** et **RHEL 10** ne sont pas testés ; les notes RHEL/Fedora peuvent ne pas s'appliquer entièrement. **amd64 uniquement** : il n'existe pas de paquet arm64.

Ils sont publiés sur la page des versions [`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases). La version actuelle est **v0.2.0** : [page de la version](https://github.com/soctalk/soctalk/releases/tag/v0.2.0). Le dépôt est public, aucune authentification n'est donc nécessaire pour les télécharger.

## Ce que le paquet installe

Le paquet est volontairement léger. SocTalk s'exécute sur Kubernetes (K3s), le paquet ne contient donc pas la stack SOC elle-même. Il installe une CLI de gestion légère et l'installateur, puis vous exécutez une seule commande pour démarrer la stack :

- `/usr/bin/soctalk`, la CLI de gestion (`install`, `upgrade`, `status`,
  `logs`, `uninstall`, `version`).
- `/usr/libexec/soctalk/install.sh`, le même installateur qu'utilisent la [VM de démonstration](/fr-fr/quickstart-vm)
  et l'[installation en une commande](/fr-fr/install). Il amorce K3s et Helm s'ils
  sont absents, puis installe via Helm la chart `soctalk-system` depuis GHCR.
- `/etc/soctalk/soctalk.env.example`, un modèle pour les installations sans intervention.

Les seules dépendances sont `curl` et `tar` ; l'installateur récupère K3s et Helm lui-même. C'est la bonne voie lorsque vous installez sur un hôte Linux que vous gérez directement et que vous voulez que SocTalk soit enregistré dans la base de données de paquets du système (afin que `dnf`/`apt` le suivent et le mettent à jour). Si vous voulez simplement essayer SocTalk, l'[image de VM de démonstration](/fr-fr/quickstart-vm) est plus rapide.

## Installer le paquet

Choisissez le bloc correspondant à votre distribution. Remplacez `0.2.0` par la version actuelle si vous êtes sur une version plus récente.

### RHEL, Fedora, AlmaLinux, Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

`dnf` récupère `curl` et `tar` s'ils sont absents. Sur les hôtes plus anciens, utilisez
`sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`.

### Debian, Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` résout les dépendances `curl` et `tar` depuis vos dépôts configurés. Sur une image minimale sans `apt`, vous pouvez utiliser
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install`.

## Vérifier le téléchargement

Chaque version inclut `SHA256SUMS.txt` couvrant tous les artefacts, y compris les paquets.

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` ne vérifie que les fichiers que vous avez réellement téléchargés. Chaque ligne devrait indiquer `OK`.

## Démarrer la stack SOC

Installer le paquet ne démarre pas SocTalk. Une fois le paquet installé, exécutez l'installateur via la CLI. Cela installe K3s et Helm si nécessaire, puis installe via Helm `soctalk-system` sur cet hôte.

Interactif (demande le nom du MSSP, l'administrateur et le fournisseur LLM) :

```bash
sudo soctalk install
```

Démonstration jetable (mot de passe admin aléatoire, intègre automatiquement un tenant de démonstration) :

```bash
sudo soctalk install --demo
```

`--demo` marque tout de même une pause pour une invite de consentement. Pour une exécution entièrement sans intervention (aucun terminal attaché, par exemple depuis un script de provisionnement), ajoutez `--yes` :
`sudo soctalk install --demo --yes`.

Sans intervention, piloté par des variables d'environnement (copiez le modèle livré) :

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

Lorsque `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL` et `SOCTALK_ADMIN_PASSWORD` sont tous définis, l'installateur passe son invite de consentement, ce qui permet une exécution sans aucune interaction. Tout argument après `install` est transmis à l'installateur, par exemple `soctalk install --chart-version 0.2.0` pour épingler une chart ou
`soctalk install --values-file /etc/soctalk/values.yaml` pour une installation en environnement isolé. Voir [Installation en production](/fr-fr/install) pour la référence complète des options et la voie du cluster basé sur Cilium.

## Gérer l'installation

La CLI encapsule les opérations courantes du cluster afin que vous n'ayez pas à mémoriser le chemin `KUBECONFIG` ni le nom de la release Helm.

```bash
soctalk status              # pods and their readiness in the soctalk namespace
soctalk logs api            # tail a component's logs (api, orchestrator, adapter, app-ui)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk upgrade` est un `helm upgrade --install`, il est donc sans danger de le relancer et c'est ainsi que vous passez à une chart plus récente après avoir installé un paquet plus récent.

## Désinstaller

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

Supprimer le paquet système (`dnf remove soctalk` ou `apt remove soctalk`) efface la CLI et l'installateur, mais ne touche pas à un cluster en cours d'exécution. Exécutez d'abord `soctalk uninstall` si vous voulez que la stack SOC disparaisse.

## Notes spécifiques au système

### RHEL, Fedora, AlmaLinux, Rocky

Validé sur Rocky Linux 9 avec SELinux en mode **Enforcing**. Aucun travail manuel sur SELinux n'est nécessaire pour démarrer : l'installateur K3s récupère automatiquement les paquets de politique `k3s-selinux` et `container-selinux` pendant `soctalk install`, de sorte que le cluster démarre sous Enforcing. Notez que cela signifie « fonctionne correctement sous la politique targeted », et non que SELinux confine la charge de travail comme couche de durcissement ; l'activation de la propre application SELinux de K3s (`--selinux` / `K3S_SELINUX=true`) n'a pas été testée ici. RHEL 10 nécessite également le paquet `kernel-modules-extra` pour K3s, ce qui n'a pas été testé.

Si **firewalld** est actif (courant sur une installation complète de serveur RHEL, mais pas sur les images cloud minimales), il peut bloquer le trafic du cluster, ce qui se manifeste par des pods bloqués en `ContainerCreating` ou par l'application web injoignable. Faites confiance aux réseaux de pods et de services K3s, et ouvrez les ports d'ingress par lesquels vous atteignez réellement l'interface :

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

Les valeurs `10.42.0.0/16` et `10.43.0.0/16` sont les valeurs par défaut de K3s ; si vous définissez un CIDR de cluster ou de service personnalisé, utilisez ceux-ci à la place. Un cluster multi-nœuds nécessite davantage de ports ouverts entre les nœuds (voir les exigences réseau de K3s).

### Alpine et autres hôtes sans systemd {#alpine-and-other-non-systemd-hosts}

**L'installateur de SocTalk requiert systemd.** Il démarre K3s en tant que service systemd et attend le kubeconfig écrit par systemd, il ne fonctionne donc pas sur Alpine (OpenRC) ni sur aucun autre init sans systemd. Sur un tel hôte, `soctalk install` s'arrête tôt avec un message clair vous l'indiquant. Pour cette raison, aucun `.apk` n'est publié.

Pour exécuter SocTalk là où vous envisagiez Alpine, utilisez une distribution avec systemd (la voie `.deb` ou `.rpm` ci-dessus) ou l'[image de VM de démonstration](/fr-fr/quickstart-vm) préconstruite.

## Quelle voie choisir ?

- **Paquet système (cette page)** : un hôte Linux que vous gérez, suivi par le gestionnaire de paquets du système. Adapté aux installations reproductibles et gérées par configuration.
- **[Installation en une commande](/fr-fr/install)** : `curl … | install.sh | bash` sur une VM Ubuntu vierge, le même installateur sans l'enveloppe du paquet.
- **[Image de VM de démonstration](/fr-fr/quickstart-vm)** : une appliance préconstruite avec un assistant de configuration dans le navigateur, la voie la plus rapide vers un système opérationnel pour l'évaluation.

Toutes les trois aboutissent à la même chart `soctalk-system` et au même SOC en cours d'exécution.
