# Launchpad : pilote MSSP en une seule commande

Une fois que vous avez vu SocTalk de bout en bout sur une seule machine co-localisée ([Démarrage rapide](/fr-fr/quickstart-vm)), **Launchpad est l'étape suivante** : il vous fait passer de cette démonstration locale à un véritable pilote — un plan de contrôle MSSP plus un ou plusieurs environnements tenant sur votre propre infrastructure. Pilotez-le depuis une **console web** (recommandé) ou, plus tard, avec une seule commande headless : il démarre les VM, les rattache à votre tailnet, installe SocTalk depuis des sources publiques et vous remet une URL.

Vous préférez comprendre chaque étape avant de laisser un outil l'exécuter ? Le [pilote MSSP à faire soi-même](/fr-fr/mssp-pilot) parcourt la même installation à la main — mêmes charts, même flux Tailscale. Launchpad se contente de faire le copier-coller à votre place.

::: tip Temps de manipulation
| Parcours | Manipulation | Temps réel |
|---|---|---|
| [À faire soi-même](/fr-fr/mssp-pilot) | ~90 min | ~2 heures |
| Console Launchpad | ~5 min à remplir un formulaire | ~15-25 min (surtout de l'attente sur les téléchargements) |
:::

## Ce qu'il fait

À partir de vos identifiants d'administrateur MSSP et d'une liste de tenants, Launchpad :

1. Télécharge l'image cloud Ubuntu Noble sur votre hôte de VM (mise en cache lors des exécutions suivantes)
2. Provisionne des VM QEMU — une pour le MSSP, une par tenant — avec cloud-init + Tailscale
3. Attend que chaque VM rejoigne votre tailnet avec le tag qu'elle annonce
4. Exécute [`install.sh`](https://github.com/soctalk/soctalk/blob/main/install.sh) sur le MSSP en mode `--demo`
5. Intègre chaque tenant via l'API MSSP
6. Appelle `:issue-agent` pour chaque tenant afin d'obtenir le jeton d'amorçage
7. Installe k3s + Helm + `soctalk-cloud-agent` sur chaque VM tenant
8. Le MSSP répartit la tâche `install_helm_release` → le cloud-agent récupère et applique le chart `soctalk-tenant` (manager + indexer + dashboard Wazuh, adaptateur, runs-worker)

À la fin, vous disposez d'un dashboard MSSP fonctionnel, de tenants enregistrés et `active`, et de Wazuh fonctionnant par tenant. Tout est téléchargé depuis des sources publiques — pas d'images pré-préparées, pas de charts embarqués.

## Ce qu'il n'est pas

- **Pas un installateur de production.** C'est un outil d'évaluation. Mêmes réserves de non-production que le pilote à faire soi-même : pas de HA, certificats auto-signés, tailnet en guise d'ingress.
- **Pas un gestionnaire de cluster.** Il s'exécute une fois puis s'arrête. Il ne surveille pas le cluster, ne réalise pas de mises à niveau, ne réconcilie pas les dérives. Utilisez `helm upgrade` ensuite.
- **Pas un opérateur Kubernetes.** Le launchpad s'exécute sur votre poste, pas dans le cluster.

## Prérequis

Rassemblez d'abord ces éléments :

- [ ] **Un hôte de VM accessible depuis votre poste de travail.** Une machine Linux avec :
      - `qemu-system-x86_64`, `qemu-img`, `genisoimage`, `curl`
      - `/dev/kvm` (le KVM imbriqué fonctionne, le bare metal est plus rapide)
      - Assez de marge pour vos VM : **8 Go de RAM + 4 vCPU + 60 Go de disque par VM**
      - Un accès SSH sans mot de passe depuis votre poste de travail en tant qu'utilisateur du groupe `kvm`
- [ ] **Un tailnet Tailscale.** L'offre gratuite suffit. Vous aurez besoin de :
      - Le nom du tailnet (par ex. `taila1b2c3.ts.net`)
      - Un [jeton d'accès à l'API Tailscale](https://login.tailscale.com/admin/settings/keys) avec la portée `keys:write` — le launchpad l'utilise pour générer des clés d'authentification d'appareil éphémères par VM
      - La propriété des tags que vous utiliserez — ajoutez-les à votre ACL :
        ```json
        "tagOwners": {
          "tag:mssp":        ["autogroup:admin"],
          "tag:tenant-acme": ["autogroup:admin"]
        }
        ```
- [ ] **Une clé publique SSH** que vous souhaitez autoriser sur chaque VM provisionnée (généralement celle de votre poste de travail).
- [ ] **Une clé d'API LLM** pour le MSSP. Choisissez un fournisseur dont vous disposez (Anthropic, OpenAI, ou pointez vers un Ollama local). Une clé fictive fonctionne pour un test de fumée où l'AI n'est pas sollicitée.

::: warning Tailscale MagicDNS
Le launchpad s'attend à ce que MagicDNS soit activé sur votre tailnet afin que les clusters tenant puissent joindre le MSSP par nom d'hôte. Il est activé par défaut. Si vous l'avez désactivé, vous devrez ajouter `hostAliases` vous-même (voir le [pilote à faire soi-même](/fr-fr/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant) pour le modèle).
:::

## 1. Installer la CLI

Téléchargez le binaire `launchpad` pour votre plateforme depuis la
[dernière version](https://github.com/soctalk/soctalk-launchpad/releases/latest),
puis laissez-le récupérer ses plugins :

```bash
# choisissez l'asset pour votre OS/arch : launchpad_{darwin,linux,windows}_{amd64,arm64}
base=https://github.com/soctalk/soctalk-launchpad/releases/latest/download
curl -fsSL "$base/launchpad_$(uname -s | tr A-Z a-z)_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o launchpad
chmod +x launchpad && sudo mv launchpad /usr/local/bin/launchpad

launchpad version
launchpad init   # télécharge + vérifie la signature de chaque plugin dans ~/.launchpad/plugins
```

`init` récupère l'ensemble de plugins pour votre plateforme depuis la même version signée et
vérifie chaque binaire par rapport à l'index signé en ed25519 de la version avant qu'il ne soit
installé. Rien n'est exécuté sans vérification. (`launchpad plugin list` affiche l'ensemble
installé ; `launchpad plugin sync` re-récupère ou répare le magasin.)

## 2. Lancer le pilote dans la console web

`launchpad ui` démarre une console web locale et l'ouvre dans votre navigateur — le principal moyen de piloter un pilote. Vous enregistrez votre infrastructure une seule fois sous forme de **Hosts** et de **Networks** réutilisables et testables, puis vous lancez et observez.

```bash
launchpad ui
```

Au premier lancement, la CLI télécharge et vérifie l'ensemble de plugins dans `~/.launchpad/plugins`, puis sert la console depuis le même binaire — rien d'autre à installer. Dans le navigateur, parcourez trois écrans :

1. **Networks** — ajoutez votre tailnet : le nom de l'overlay (par ex. `taila1b2c3.ts.net`) et votre clé d'API Tailscale. Appuyez sur **Test** pour confirmer que la clé fonctionne avant de vous y fier. Une exécution est liée à un seul réseau, et chaque machine le rejoint.
2. **Hosts** — ajoutez l'endroit où vous provisionnerez. Pour ce guide, il s'agit de votre machine KVM : la cible SSH et un répertoire de travail accessible en écriture. Les nouveaux hôtes pré-remplissent les champs attendus par leur plateforme, et **Test** valide la connexion et les identifiants. Les identifiants sont stockés avec l'hôte et ne quittent jamais la machine exécutant Launchpad.
3. **Runs** — créez une exécution : affectez le **nœud de contrôle** (votre MSSP) et chaque **tenant** à un hôte, choisissez le réseau, renseignez les identifiants d'administrateur MSSP et la clé LLM, puis appuyez sur **Launch**.

![Networks — l'overlay que rejoint chaque machine d'une exécution, enregistré une seule fois](/screenshots/launchpad-ui-networks.png)

![Hosts — les substrats sur lesquels vous provisionnez, enregistrés une seule fois](/screenshots/launchpad-ui-hosts.png)

La console diffuse la progression en direct — chaque VM provisionnée, rejoignant le tailnet et installant SocTalk — et vous donne l'URL du MSSP à la fin. Les exécutions sont idempotentes (relancer réconcilie avec les machines qui existent déjà plutôt que de les dupliquer), et l'action **Down** détruit les machines d'une exécution.

![Une exécution en cours — les VM MSSP et tenant en cours de provisionnement, avec le suivi des phases et un flux d'événements en direct](/screenshots/launchpad-ui-run.png)

::: tip Contrôle de conformité
Avant de pointer un plugin vers une infrastructure réelle, vous pouvez le vérifier depuis la CLI :
```bash
launchpad plugin verify qemu
```
Cela exécute la suite de conformité au protocole (checksum, handshake, `plan`, `destroy` idempotent) sans nécessiter d'identifiants réels.
:::

## 3. Vérifier que cela a fonctionné

Une fois l'exécution terminée (la console la marque comme terminée, ou `launchpad up` sort avec `0`), vérifiez les deux systèmes :

**Dashboard MSSP** — ouvrez l'URL affichée à la fin de l'exécution (ou `https://lp-mssp.<your-tailnet>.ts.net/`). Connectez-vous avec les identifiants d'administrateur que vous avez définis pour l'exécution. Votre tenant devrait être listé et passer à **Online** en 1 à 2 minutes.

![Dashboard MSSP provisionné par Launchpad](/screenshots/launchpad-mssp-dashboard.png)

**Wazuh sur le tenant** — connectez-vous en SSH à la VM tenant (`ssh ops@lp-tenant-acme.<your-tailnet>.ts.net`) et vérifiez les pods :

```bash
sudo k3s kubectl -n tenant-acme get pods
```

Vous devriez voir :

```
NAME                                          READY   STATUS
tenant-acme-wazuh-manager-0                   1/1     Running
tenant-acme-wazuh-indexer-0                   1/1     Running
tenant-acme-wazuh-dashboard-<hash>            1/1     Running
tenant-acme-linuxep-0                         1/1     Running
soctalk-adapter-<hash>                        1/1     Running
soctalk-runs-worker-<hash>                    1/1     Running
```

Le StatefulSet `linuxep-0` est un endpoint Linux de démonstration avec l'agent Wazuh installé — un endroit pour simuler des alertes. Voir le [Simulateur d'attaque](/fr-fr/mssp-pilot#5-3-generate-alerts) pour plus de détails.

### Se connecter en SSH aux VM

Chaque VM provisionnée par le launchpad dispose d'un utilisateur `ops` préconfiguré avec les clés SSH de votre configuration d'hôte autorisées et le **sudo sans mot de passe**. C'est ainsi que la phase d'installation du launchpad accède à la machine ; vous utilisez le même compte pour le dépannage.

```bash
# Shell interactif en tant que ops
ssh ops@lp-mssp.<your-tailnet>.ts.net
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net

# Commande ponctuelle en tant que root
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net "sudo journalctl -u k3s -n 100"
```

::: tip Repli : connectez-vous en IPv4 si MagicDNS est désactivé
Si MagicDNS est désactivé sur votre tailnet, `lp-<key>.<tailnet>.ts.net` ne se résoudra pas sur votre poste de travail. Utilisez `tailscale status | grep lp-` pour trouver l'IPv4 du tailnet et `ssh ops@100.x.y.z` directement.
:::

## 4. Utiliser votre pilote : intégrer des clients et interroger l'AI

Launchpad vous remet un MSSP fonctionnel avec votre premier tenant déjà intégré — à partir de là, vous le pilotez exactement comme le ferait un MSSP. Le **Dashboard** est une vue de flotte inter-tenants : examens en attente, cas bloqués, tenants dégradés et santé par tenant.

![Le dashboard MSSP — vue de flotte inter-tenants](/screenshots/pilot-final-dashboard.png)

**Intégrer un autre client.** **Tenants → Create customer** lance un court assistant en quatre étapes :

![Create customer — 1. Identité](/screenshots/pilot-add-tenant-step1.png)
![Create customer — 2. Profil](/screenshots/pilot-add-tenant-step2.png)
![Create customer — 3. Image de marque](/screenshots/pilot-add-tenant-step3.png)
![Create customer — 4. Examen](/screenshots/pilot-add-tenant-step4.png)

Le nouveau client rejoint la flotte, et le cloud-agent provisionne sa pile Wazuh + adaptateur de la même manière que Launchpad l'a fait pour le premier tenant :

![La liste des tenants avec le client intégré](/screenshots/pilot-final-tenants-list.png)

Explorez un tenant pour voir ses enquêtes ouvertes, ses examens et la santé de Wazuh :

![Détail du tenant](/screenshots/pilot-final-acme-detail.png)

**Interroger l'analyste SOC AI.** La vue **Chat** répond aux questions sur l'ensemble de la flotte ou dans le périmètre d'un seul tenant, en appelant des outils sur des données en direct et en résumant ce qu'elle trouve :

![Ask AI — un résumé à l'échelle de la flotte, avec l'appel d'outil exécuté](/screenshots/pilot-chat-mssp-reply.png)
![Ask AI — dans le périmètre d'un seul tenant](/screenshots/pilot-chat-tenant-reply.png)

::: tip
L'AI a besoin d'un véritable [fournisseur LLM](/fr-fr/integrate/llm-providers) configuré — la clé fictive du test de fumée ne répondra pas aux questions.
:::

## 5. Affiner avec un fichier de configuration

Une fois qu'un pilote fonctionne depuis la console, vous pouvez capturer la même configuration sous forme de config YAML et la piloter en headless avec `launchpad up` — sans console. Recourez-y lorsque vous voulez :

- **Des exécutions reproductibles et scriptées** — versionnez la config dans git, exécutez-la en CI et faites des assertions sur le flux d'événements JSON.
- **Un contrôle fin que le formulaire n'expose pas** — épinglez une image de base ou son SHA, pointez vers un tag de version `install.sh` spécifique, scriptez de nombreux tenants d'un coup, ou ajustez CPU / mémoire / disque par VM.

La console et la config partagent les mêmes Hosts et Networks sous `~/.launchpad`, si bien qu'une exécution par config réutilise exactement ce que vous avez déjà testé.

Enregistrez ceci sous `pilot.yaml` et remplacez les valeurs entre crochets :

```yaml
run_id: my-pilot

# Provisioning target — the plugin that creates VMs. Others: vmware, hetzner, proxmox, docker.
target: qemu

# Passed opaquely to the qemu plugin's initialize.
plugin_config:
  ssh_host: [user]@[vm-host-ip]      # SSH target on your KVM host
  work_dir: /home/[user]/lp-vms       # writable path; caches images + hosts VM disks
  tailnet: [your-tailnet].ts.net
  cpu: 4
  memory_mb: 8192
  disk_gb: 60
  # base_image_url is optional; defaults to the current Ubuntu Noble cloud image.
  # base_image_sha256: <optional pin>

# SSH keys authorized on every provisioned VM (the launchpad SSHes in as `ops`).
ssh_keys:
  - "ssh-ed25519 AAAA... you@laptop"

mssp:
  key: mssp
  name: my-pilot-mssp
  role: mssp
  tags: { role: mssp }

tenants:
  - key: tenant-acme
    name: acme-corp
    role: tenant
    tenant_slug: acme
    tags: { role: tenant, tenant_slug: acme }

# Post-provision installation phase.
install:
  # Point at a pinned release tag for reproducible smoke tests. `main` also works.
  installer_url: https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh
  mssp_admin_email: admin@my-pilot.demo
  mssp_admin_password: [pick-a-strong-one]
  mssp_display_name: My Pilot MSSP
  llm_provider: anthropic
  llm_api_key: [your-anthropic-key]
```

::: warning À propos du mot de passe administrateur
Enregistrez-le dans un gestionnaire de mots de passe avant de lancer l'exécution. Le launchpad ne vous le réaffichera pas si vous le perdez.
:::

Pour ajouter des tenants, étendez la liste `tenants:`. Chacun a besoin d'une `key` unique, d'un `tenant_slug` qui correspond à votre ACL Tailscale, et d'une entrée correspondante sous `tagOwners`.

### Lancez-le

```bash
export TAILSCALE_API_KEY=tskey-api-...

launchpad up --config pilot.yaml --state ~/.launchpad/state.json
```

Par défaut, cela affiche une TUI Bubble Tea avec des barres de progression par VM, un journal d'événements en direct et une invite de porte pour les étapes interactives. Pour les exécutions non surveillées (CI, scripts, tests de fumée de ce guide), utilisez `--headless` pour diffuser les événements JSON vers stdout :

```bash
launchpad up --config pilot.yaml \
  --state ~/.launchpad/state.json \
  --headless --auto-resolve-gates | tee run.log
```

`--auto-resolve-gates` accepte chaque porte (actuellement uniquement la confirmation de l'ACL Tailscale) sans demander de confirmation. Ne l'utilisez pas si vous souhaitez examiner votre ACL avant que les tenants ne soient provisionnés.

Timing approximatif des phases lors d'une première exécution (cache vierge, connexion internet domestique correcte) :

| Phase | Durée | Ce qui se passe |
|---|---|---|
| `provisioning` | 60-90 s | Téléchargement de l'image (~600 Mo) + cloud-init + rattachement Tailscale |
| `installing` (MSSP) | 3-5 min | Installation de k3s, Helm, chart `soctalk-system` |
| `installing` (par tenant) | 3-5 min | k3s + Helm + `soctalk-cloud-agent`, puis le MSSP répartit le chart `soctalk-tenant` (Wazuh + adaptateur) |
| Total | **~10-15 min** | pour MSSP + 1 tenant |

Les exécutions suivantes sont bien plus rapides car l'image de base est mise en cache sur l'hôte de VM.

## 6. Itérer — reprendre, détruire, redémarrer

Le launchpad est idempotent. Relancer une exécution — à nouveau **Launch** dans la console, ou `launchpad up` — reprend là où elle s'était arrêtée :

- Les VM qui existent déjà sont réutilisées (pas de double provisionnement)
- L'étape d'installation du MSSP est ignorée si l'API répond déjà
- L'intégration d'un tenant est ignorée si le tenant existe déjà
- Le chart `soctalk-cloud-agent` fait l'objet d'un `helm upgrade --install`, pas d'une réinstallation

Pour tout détruire proprement (VM, appareils Tailscale, répertoire de travail), utilisez l'action **Down** de la console ou :

```bash
launchpad down --config pilot.yaml --state ~/.launchpad/state.json
```

Pour ajouter un tenant à un pilote en cours d'exécution, ajoutez-le dans la console (ou modifiez `tenants:` dans `pilot.yaml`) et relancez. Les VM existantes sont laissées telles quelles ; le nouveau tenant est provisionné et installé.

## 7. Dépannage

### `vm.wait_ready` expire

La VM a démarré mais n'a jamais rejoint le tailnet. Cloud-init sur la VM n'a pas pu joindre les serveurs de coordination Tailscale.

- Confirmez que votre hôte de VM dispose d'un accès internet
- Connectez-vous en SSH à l'hôte de VM et inspectez le journal série QEMU à `<work_dir>/<run_id>/<vm_key>/serial.log` — il capture la sortie de cloud-init, y compris tailscale-up
- Cause fréquente : la clé d'authentification éphémère a été révoquée avant que la VM ne l'utilise (vérifiez le journal Machines dans l'admin Tailscale)

### L'installation du MSSP expire sur `helm upgrade`

L'installation du chart s'est exécutée mais les pods n'ont pas convergé en 15 minutes. Généralement à cause des récupérations d'images sur des connexions lentes.

- Connectez-vous en SSH à la VM MSSP : `sudo k3s kubectl -n soctalk-system get pods` et vérifiez la présence de `ImagePullBackOff` ou `CrashLoopBackOff`
- Si les pods sont toujours en cours de récupération, attendez et relancez — la deuxième tentative ignore l'étape d'installation une fois que l'API répond

### L'agent tenant journalise `no such host` sur `/api/agent/register`

Le DNS du cluster du pod ne parvient pas à résoudre le nom d'hôte du tailnet du MSSP. C'est exactement à cela que sert `hostAliases`. Le launchpad l'insère dans la commande helm par défaut ; si vous le faites à la main, voir le [pilote à faire soi-même](/fr-fr/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant).

### Automatisation

Le mode `--headless` est la surface d'automatisation du launchpad. Chaque phase, changement d'état de VM, ligne de journal d'installation et invite de porte constitue un événement JSON sur stdout :

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Faites des assertions sur ces événements depuis votre CI. Voir le [schéma d'événements Launchpad](/fr-fr/reference/launchpad-events) pour la liste complète.

## Et ensuite

- **Ajoutez un vrai tenant.** Intégrez-le depuis le dashboard MSSP — voir le [pilote à faire soi-même §3](/fr-fr/mssp-pilot#3-onboard-tenants) pour la présentation de l'assistant.
- **Générez des alertes.** Le [Simulateur d'attaque](/fr-fr/mssp-pilot#5-3-generate-alerts) fournit le runbook.
- **Pointez l'AI vers des données réelles.** Configurez correctement votre [fournisseur LLM](/fr-fr/integrate/llm-providers) (la clé fictive du test de fumée ne répondra pas aux questions).
- **Passez en production.** [Install](/fr-fr/install) est le parcours hors-launchpad, compatible HA.
