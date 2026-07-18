# Pilote MSSP : faites-le vous-même

::: tip La plupart des pilotes devraient utiliser Launchpad
[**Launchpad**](/fr-fr/launchpad) automatise l'intégralité de ce déploiement — même installation, mêmes charts, même flux Tailscale — en une seule commande (~15-25 min, essentiellement de l'attente sur les téléchargements, contre ~2 heures à la main). **Commencez par là.** Recourez à ce guide « faites-le vous-même » lorsque vous voulez comprendre chaque étape, que vous dépannez une exécution de Launchpad, ou que votre environnement ne peut pas exécuter Launchpad — isolé du réseau (air-gapped), DNS on-prem à horizon partagé (split-horizon), substrat non pris en charge, ou cluster existant.
:::

Un parcours pratique pour les MSSP qui évaluent SocTalk avec 1 à 3 de leurs clients. Deux environnements on-premise (un plan de contrôle MSSP, un par tenant), reliés par un VPN maillé compatible pare-feu. État final : une installation SocTalk multi-tenant fonctionnelle, l'analyste SOC AI répondant à des questions sur les données Wazuh réelles de chaque tenant, et une capture d'écran que vous pouvez montrer à vos parties prenantes.

**Ce n'est pas une installation de production.** Pas de HA, pas de vrai TLS, votre nom d'hôte tailnet tient lieu d'ingress. Lorsque vous êtes prêt pour la production, voir [Installation](/fr-fr/install).

**Vous essayez d'abord SocTalk en solo ?** Commencez par la [VM Quickstart](/fr-fr/quickstart-vm) : machine unique, tenant unique, ~10 minutes.

::: tip Temps de manipulation
| Côté | Manipulation | Temps réel |
|---|---|---|
| MSSP (une fois) | ~45 min | ~60 min |
| Chaque tenant (1-3 d'entre eux) | ~30 min par tenant | ~45 min par tenant |
| Démo + vérification | ~10 min | ~10 min |
:::

## Ce qui est dans le périmètre

- 1 plan de contrôle MSSP + 1-3 tenants
- Les deux environnements **on-premise**, tout hyperviseur exécutant Ubuntu 24.04 (vSphere / Proxmox / Hyper-V / KVM / VirtualBox / bare metal)
- [Tailscale](https://tailscale.com) comme VPN maillé. Headscale, NetBird, ou tout maillage WireGuard fonctionne de la même manière ; Tailscale est ce que les commandes ci-dessous supposent sur le plan syntaxique.
- Le plan de contrôle SocTalk L1 du MSSP + le cloud-agent SocTalk L2 sur chaque tenant
- Wazuh **déjà installé** OU **installé via chart** par tenant ; les deux sont pris en charge

<!-- screenshot: arch-overview.svg — architecture diagram (MSSP VM left, tenant VMs right, tailnet wrapping both, cloud-agent shown on each tenant, optional dotted-line to existing Wazuh) -->

## 0. Avant de commencer

Rassemblez ces éléments. Ils vous seront tous demandés au cours des 90 prochaines minutes :

- [ ] Hyperviseur + identifiants admin pour le côté MSSP
- [ ] Hyperviseur + identifiants admin par tenant (un par client pilote)
- [ ] Un compte Tailscale ([inscription](https://login.tailscale.com/start) ; le niveau gratuit gère très bien un pilote)
- [ ] Une clé d'API LLM (Anthropic ou OpenAI). Pour une option isolée du réseau (air-gapped) ou sensible à la souveraineté, voir [Intégration Ollama](/fr-fr/integrate/ollama).
- [ ] Un contact par tenant (nom, email, dispose d'un Wazuh existant ? oui/non)
- [ ] Si un tenant dispose d'un Wazuh existant : **deux** jeux d'identifiants, un pour le Wazuh Indexer (`:9200`, authentification Basic) et un pour le Wazuh Manager API (`:55000`, utilisateur autorisé à émettre des JWT)

## 1. Configurer le tailnet

Le plan de contrôle MSSP et chaque tenant rejoignent le même tailnet. Le tailnet fournit des noms d'hôtes stables (afin que le cloud-agent compose un nom, et non une IP) et des ACL (afin que les tenants ne puissent pas s'atteindre les uns les autres).

### 1.1 Tags

Définissez un tag pour le MSSP et un par tenant dans l'interface d'administration Tailscale sous **Access Controls** → **Tags** :

```json
"tagOwners": {
  "tag:mssp":         ["autogroup:admin"],
  "tag:tenant-acme":  ["autogroup:admin"],
  "tag:tenant-globex":["autogroup:admin"]
}
```

Ajoutez un tag par tenant pilote. Les tags sont le moyen par lequel l'ACL empêche les tenants de s'atteindre les uns les autres.

### 1.2 ACL

Collez cette clause dans **Access Controls** → **Access Controls (JSON)**. Ajustez la liste des tags de tenant pour correspondre à votre pilote.

```json
"acls": [
  {
    "action": "accept",
    "src":    ["autogroup:admin"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  },
  {
    "action": "accept",
    "src":    ["tag:mssp"],
    "dst":    ["tag:tenant-acme:*", "tag:tenant-globex:*"]
  },
  {
    "action": "accept",
    "src":    ["tag:tenant-acme", "tag:tenant-globex"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  }
]
```

La première règle permet à **vos appareils d'opérateur** (votre ordinateur portable, tout nœud non taggé appartenant à l'admin sur le tailnet) d'atteindre l'interface MSSP. Sans elle, le refus par défaut de Tailscale bloque votre propre navigateur. La deuxième règle permet au MSSP d'atteindre chaque tenant pour les appels d'outils de chat (Wazuh API, observabilité). La troisième permet au cloud-agent de chaque tenant d'atteindre le point de terminaison HTTPS du MSSP pour s'enregistrer et diffuser des événements. Les tenants ne peuvent pas s'atteindre les uns les autres.

Vérifiez dans le volet ACL Preview avant d'enregistrer. Confirmez que `tag:tenant-acme` ne peut pas atteindre `tag:tenant-globex` sur aucun port.

<!-- screenshot: tailscale-acl-preview.png — ACL preview showing tenant-to-tenant denied, MSSP→tenant + tenant→MSSP allowed -->

### 1.3 Clés d'authentification

Sous **Settings** → **Keys**, générez :

- Une clé d'authentification **réutilisable** taggée `tag:mssp` pour le plan de contrôle MSSP.
- Une clé d'authentification **éphémère** par tenant taggée `tag:tenant-<slug>`. Réglez le TTL sur la durée de votre pilote (par ex. 90 jours).

Notez-les en lieu sûr ; vous les collerez lorsque chaque VM rejoindra le tailnet.

### 1.4 Exigences réseau

Tailscale a besoin uniquement de sortie (jamais d'entrée) depuis chaque nœud :

- **Chemin direct** (lorsque les deux pairs peuvent traverser le NAT) : WireGuard sur UDP via un port haut aléatoire. La plupart des réseaux le permettent déjà.
- **Repli DERP** (lorsque la traversée NAT échoue, par ex. pare-feu stricts ou double NAT) : TCP/443 vers les relais DERP de Tailscale. La plupart des pilotes utilisent ce chemin car il ressemble à du trafic HTTPS normal.

Si votre pare-feu autorise le HTTPS sortant, tout va bien. Aucune modification de règle entrante où que ce soit.

## 2. Côté MSSP : mettre en place le plan de contrôle

Le plan de contrôle MSSP est une VM SocTalk unique, la même que celle qu'installe la [VM Quickstart](/fr-fr/quickstart-vm). Nous utilisons ce tutoriel comme base et ajoutons l'intégration au tailnet.

### 2.1 Provisionner et installer

Suivez les **étapes 1 à 5** de la [VM Quickstart](/fr-fr/quickstart-vm) (télécharger, démarrer, obtenir le jeton de configuration, ouvrir l'assistant, se connecter). Lorsque l'assistant demande le **Hostname**, laissez-le vide pour l'instant. Vous le définirez sur le nom d'hôte tailnet au §2.3.

Arrêtez-vous lorsque vous avez atteint le tableau de bord MSSP. **Remarque :** le flux Quickstart intègre automatiquement un tenant nommé `demo` au premier démarrage. Vous verrez un tenant déjà présent dans votre liste ; c'est attendu. Vous pouvez soit le laisser (et l'ignorer au §5), soit le décommissionner depuis le tableau de bord avant d'ajouter vos vrais tenants pilotes :

```text
Tenants → demo → Decommission
```

L'un ou l'autre convient ; sachez-le simplement afin de ne pas être décontenancé lorsque `list all tenants` au §5 renvoie plus que votre nombre de tenants pilotes.

<!-- screenshot: mssp-dashboard-after-install.png — MSSP dashboard immediately after wizard install, showing the auto-onboarded demo tenant -->

### 2.2 Durcir la machine

::: danger Requis avant l'étape suivante
Les images disque téléchargeables sont livrées avec un utilisateur SSH `ubuntu:packer` créé au moment de la compilation. **Ne connectez pas la VM à votre tailnet tant que vous ne l'avez pas verrouillée.** Voir [Accès SSH + identifiants](/fr-fr/quickstart-vm#ssh-access-credentials) pour l'explication complète et les commandes de durcissement.

Minimum :
```bash
sudo passwd -l ubuntu
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```
:::

### 2.3 Installer Tailscale, rejoindre le tailnet

Connectez-vous en SSH en tant que `ops` (l'utilisateur créé par la graine cloud-init lors de votre installation de la [VM Quickstart](/fr-fr/quickstart-vm) ; **pas** l'utilisateur `ubuntu` créé à la compilation que le §2.2 vient de verrouiller) :

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-mssp-... --advertise-tags=tag:mssp --hostname=soctalk-mssp
```

Confirmez le nom d'hôte tailnet attribué :

```bash
tailscale status | head -1
# example: 100.64.10.5   soctalk-mssp        ops          linux   active; direct
```

Votre nom d'hôte MSSP est `soctalk-mssp.<your-tailnet>.ts.net`. Notez-le ; tout ce qui suit l'utilise.

### 2.4 Lier l'ingress de SocTalk au nom d'hôte tailnet

Éditez les valeurs déployées pour définir le nom d'hôte :

```bash
sudo nano /etc/soctalk/values.yaml
```

Modifiez `ingress.hostnames.mssp` et `ingress.hostnames.customer` pour qu'ils correspondent à votre nom d'hôte tailnet (par ex. `soctalk-mssp.taila1b2c3.ts.net`), puis redéployez :

```bash
sudo helm upgrade soctalk-system /opt/soctalk/charts/soctalk-system \
  -n soctalk-system -f /etc/soctalk/values.yaml
```

Référence des champs pour `values.yaml` : voir [Assistant de configuration](/fr-fr/setup-wizard) ; l'assistant écrit le même fichier.

### 2.5 Vérifier

Depuis tout autre appareil du tailnet (votre ordinateur portable d'opérateur convient ; l'ACL du §1.2 autorise `autogroup:admin → tag:mssp:443`) :

```bash
curl -k https://soctalk-mssp.<your-tailnet>.ts.net/health/ready
# expected: 200 OK
```

Connectez-vous au tableau de bord à l'adresse `https://soctalk-mssp.<your-tailnet>.ts.net/` avec les identifiants admin du §2.1. Vous devriez arriver sur la vue de flotte cross-tenant du MSSP : la bande de KPI en haut (Pending Reviews / Stuck Cases / Degraded Tenants / Repeated IOCs), la file d'enquêtes par tenant, et le tableau de santé des tenants.

![Tableau de bord MSSP : vue de flotte cross-tenant](/screenshots/mssp-dashboard.png)

## 3. Intégrer chaque tenant : émettre l'enregistrement de l'agent

Pour chaque tenant de votre pilote, vous ferez ceci dans le tableau de bord MSSP, puis transmettrez le résultat à l'opérateur du tenant.

### 3.1 Exécuter l'assistant Create Customer

Dans le tableau de bord MSSP, cliquez sur **Tenants** dans le rail de gauche, puis sur **New tenant** en haut de la page de liste. Cela ouvre l'assistant **Create Customer**. Pour les profils `poc` et `persistent`, il comporte 4 étapes (Identity → Profile → Branding → Review) ; pour `provided`, il en comporte 5 (une étape **External SIEM** apparaît entre Profile et Branding).

::: tip Rassemblez les informations du tenant en amont
Pour les tenants au profil `provided`, l'assistant requiert les **identifiants Wazuh existants** du tenant à l'étape 3. Obtenez-les auprès de votre contact tenant (hors bande, via le même canal sécurisé qu'au §3.3) **avant** de démarrer l'assistant afin de ne pas laisser un formulaire à moitié rempli. Pour `poc` / `persistent`, vous n'avez besoin que des informations de base.
:::

#### Étape 1 : Identity

- **Display name** : par ex. `Acme Corp`
- **Slug** : court, en minuscules, séparé par des tirets (3 à 32 caractères, validé par `[a-z0-9-]+`). **Doit correspondre** à votre tag tailnet du §1.1 (donc `tag:tenant-acme` → slug `acme`). Les étapes ultérieures substituent le slug directement dans `tag:tenant-<slug>` pour la clé d'authentification (§3.3) et la commande `tailscale up` du tenant (§4.2 / §4.7a) ; une non-concordance signifie que le nœud du tenant annonce un tag que vos ACL du §1.2 n'accordent pas.
- **Contact email**

![Create Customer : étape Identity](/screenshots/mssp-add-tenant-step1-identity.png)

#### Étape 2 : Profile

Choisissez l'une des trois options radio. L'API valide par rapport à `poc | persistent | provided` :

- **PoC** : le chart installe Wazuh + un simulateur linux-ep sur le cluster du tenant, avec un stockage `local-path` et des budgets de ressources serrés. Choisissez ceci pour des pilotes de courte durée où le tenant n'a pas de Wazuh existant. Voir [cycle de vie du tenant / poc](/fr-fr/tenant-lifecycle#poc).
- **Persistent** : même forme Wazuh-inclus que `poc`, mais dimensionné pour une charge de production soutenue avec la StorageClass par défaut du cluster et les plages de ressources complètes du chart. Voir [cycle de vie du tenant / persistent](/fr-fr/tenant-lifecycle#persistent).
- **Provided (apportez votre propre Wazuh)** : le chart installe uniquement l'adaptateur SocTalk ; vous le pointez vers le Wazuh existant du tenant via l'étape **External SIEM** (ci-dessous). Voir [cycle de vie du tenant / provided](/fr-fr/tenant-lifecycle#provided).

Il y a un volet **LLM (advanced)** sur la même étape pour surcharger le fournisseur LLM partagé à l'installation, l'URL de base, la clé, et (optionnellement) les ID de modèles Fast / Thinking. Pour `poc` / `persistent`, c'est optionnel ; laissez-le replié pour hériter des valeurs par défaut de l'installation. Pour `provided`, les identifiants LLM sont **requis** (il n'y a pas de repli partagé à l'installation) et conditionnent l'étape.

![Create Customer : étape Profile](/screenshots/mssp-add-tenant-step2-profile.png)

::: warning Le choix du profil est persistant
Changer le profil après le provisionnement du tenant nécessite un décommissionnement et une réintégration. Confirmez avec votre contact tenant avant de soumettre.
:::

#### Étape 3 : External SIEM (provided uniquement)

Cette étape est masquée sauf si vous avez choisi Provided à l'étape 2. Remplissez deux paires point de terminaison + identifiants :

- **Wazuh Indexer URL** (par ex. `https://wazuh.acme.example:9200`) + utilisateur indexer + mot de passe indexer (authentification Basic)
- **Wazuh Manager API URL** (par ex. `https://wazuh.acme.example:55000`) + utilisateur API + mot de passe API (utilisé pour émettre les JWT)

Ceux-ci doivent être joignables depuis la VM tenant que vous mettrez en place au §4. Le contrôleur côté MSSP transforme les URL en une liste d'autorisation d'egress FQDN Cilium sur le namespace du tenant ; l'adaptateur n'atteint jamais Wazuh directement depuis votre cluster MSSP.

Vérifiez la validité des identifiants du manager depuis la VM MSSP avant de soumettre :

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (long base64 string)
```

Si cela renvoie 200, les outils de chat du tenant se résoudront une fois le §4 terminé.

#### Étape 4 (ou 3 pour poc/persistent) : Branding

Optionnel. Nom d'affichage + petit téléversement de logo qui apparaît dans l'en-tête du tenant. Vous pouvez ignorer entièrement cette étape.

![Create Customer : étape Branding](/screenshots/mssp-add-tenant-step3-branding.png)

#### Étape finale : Review

Confirmez tout, puis cliquez sur **Create**. L'API répond 202 et vous êtes renvoyé à la liste des tenants ; le nouveau tenant démarre en `pending` et progresse par `provisioning → active`. Rafraîchissez la page de détail pour observer l'accumulation des événements du cycle de vie.

![Create Customer : étape Review](/screenshots/mssp-add-tenant-step4-review.png)

### 3.2 Émettre la commande d'enregistrement de l'agent

::: warning Pas de bouton d'interface (pour l'instant)
Au moment de la rédaction, la page de détail du tenant n'expose que les actions du cycle de vie (Suspend / Resume / Retry Provisioning / Decommission). Le flux `:issue-agent` est uniquement via API ; pilotez-le depuis un shell sur la VM MSSP. Un bouton **Issue Agent** dédié est sur la feuille de route.
:::

![Détail du tenant : actions du cycle de vie uniquement, pas de bouton Issue Agent](/screenshots/mssp-tenant-detail.png)

Depuis la VM MSSP, connectez-vous une fois pour obtenir un cookie de session, puis effectuez un POST vers le point de terminaison `:issue-agent` du tenant :

```bash
# Replace <mssp-host> with your MSSP UI hostname (e.g. soctalk-mssp.<tailnet>.ts.net)
# Replace <tenant-id> with the UUID from the tenant detail URL or from GET /api/mssp/tenants
MSSP=https://<mssp-host>
TENANT=<tenant-id>

curl -sk -c jar -X POST "$MSSP/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<mssp-admin-email>","password":"<password>"}'

curl -sk -b jar -X POST "$MSSP/api/mssp/tenants/$TENANT:issue-agent" \
  -H "Origin: $MSSP" \
  -H 'Content-Type: application/json' | jq .
```

Le corps de la réponse 201 contient un `helm_install_hint` que vous collez directement dans le shell du tenant. Il ressemble à ceci :

```bash
helm install soctalk-agent-acme \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token>
```

::: warning Utilisez la sortie de l'API telle quelle
La version de chart `0.1.x` et le jeton bootstrap ci-dessus sont illustratifs ; les vraies valeurs proviennent de votre réponse `:issue-agent`. Ne retapez pas la commande helm ; copiez le champ `helm_install_hint`.
:::

::: warning TTL du jeton bootstrap
Le jeton bootstrap expire (par défaut : 24 h). Si le tenant n'exécute pas la commande avant, réémettez vers le même point de terminaison `:issue-agent`. La réémission révoque tout jeton antérieur non consommé.
:::

### 3.3 Transmettre au contact tenant

L'opérateur du tenant a besoin de **deux** choses :

1. La **commande helm** du §3.2 (ci-dessus). Copiez-la en un seul bloc.
2. La **clé d'authentification Tailscale taggée pour le tenant** que vous avez générée au §1.3.

Envoyez-les via un gestionnaire de mots de passe partagé (1Password, Bitwarden, Vaultwarden, tout endroit doté d'un chiffrement de bout en bout). Ne collez ni l'un ni l'autre dans un canal Slack public et ne les envoyez pas par email en clair.

::: info Bientôt disponible
Le [SocTalk Launchpad](https://github.com/soctalk/soctalk) (en conception) générera un unique bundle signé que le tenant colle dans son assistant de configuration, automatisant ce transfert. Pour l'instant, c'est un copier-coller manuel.
:::

### 3.4 Coordonner les identifiants Wazuh externes pour les tenants `provided`

::: tip Ignorez cette section si vous avez choisi `poc` ou `persistent` au §3.1
Ces profils sont autonomes : le chart installe son propre Wazuh ; rien d'autre à faire côté MSSP. Passez au §4.
:::

Pour les tenants au profil `provided`, l'assistant a **déjà collecté** les identifiants External SIEM au §3.1 étape 3, de sorte qu'au moment où le tenant atteint `active`, l'adaptateur est configuré. Le seul travail hors bande se situe en amont du §3.1 : obtenir les identifiants auprès du tenant en premier lieu.

Séquence :

1. **Avant le §3.1**, demandez à votre contact tenant :
   - Wazuh Indexer URL + utilisateur + mot de passe (authentification Basic utilisée par l'adaptateur pour `_search`)
   - Wazuh Manager API URL + utilisateur + mot de passe (utilisé pour émettre les JWT)
   - Une décision de joignabilité : leur Wazuh est-il sur le même tailnet que la VM tenant que vous mettrez en place au §4 ? Sinon, ils devront `--advertise-routes` depuis le §4.2 (voir §4.7a pour le menu).
2. Ils suivent le §4.7a de leur côté pour confirmer la joignabilité.
3. Ils vous envoient les deux paires point de terminaison + identifiants (gestionnaire de mots de passe partagé).
4. Vous exécutez le §3.1 avec **Provided** à l'étape 2 et collez les identifiants à l'étape 3.

Si la situation de joignabilité du tenant change après le §3.1 (par ex. ils déplacent Wazuh vers un hôte différent), mettez à jour le panneau External SIEM sur la page de détail du tenant. Le contrôleur prend en compte le changement lors de la prochaine réconciliation (~30 s).

## 4. Côté tenant : mettre en place le plan de données

Cette section est autonome pour les contacts IT des tenants. **Si vous êtes un opérateur de tenant et que votre MSSP vous a envoyé une commande helm + une clé d'authentification Tailscale, vous pouvez commencer ici.** Parcourez le §0 pour le contexte, puis suivez cette section.

### 4.1 Provisionner une VM Linux

Vous aurez besoin d'une VM Ubuntu 24.04 LTS, 4 vCPU / 8 Go de RAM / 60 Go de disque au minimum, avec accès internet sortant. Provisionnez-la via votre processus IT habituel. Tout hyperviseur exécutant Ubuntu fonctionne (vSphere, Proxmox, Hyper-V, KVM, VirtualBox, bare metal). Si vous préférez utiliser une image SocTalk préconstruite, voir [VM Quickstart étape 1](/fr-fr/quickstart-vm#_1-download) pour les liens des images disque et les étapes d'import par hyperviseur ; revenez ici au §4.2.

### 4.2 Durcir la machine

::: warning
Si vous avez utilisé l'image SocTalk préconstruite, suivez [Accès SSH + identifiants](/fr-fr/quickstart-vm#ssh-access-credentials) avant de vous connecter à votre tailnet. Si vous avez provisionné une VM Ubuntu générique via votre pipeline IT, votre durcissement OS standard s'applique déjà.
:::

### 4.3 Installer Tailscale, rejoindre le tailnet

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-tenant-... --advertise-tags=tag:tenant-<slug> --hostname=soctalk-tenant-<slug>
```

Utilisez la clé d'authentification du transfert de votre MSSP (§3.3). Vérifiez :

```bash
tailscale ping soctalk-mssp.<tailnet>.ts.net
# expected: pong from the MSSP control plane
```

Si le `ping` échoue, vérifiez la liste des machines dans l'interface d'administration Tailscale. Assurez-vous que la machine MSSP est en ligne et que l'aperçu ACL montre que votre tag de tenant peut atteindre `tag:mssp`.

### 4.4 Installer k3s + Helm

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644" sh -
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

Vérifiez que k3s a démarré :

```bash
kubectl get nodes
# expected: one node, status Ready
```

### 4.5 Désactiver les NetworkPolicies côté tenant

::: danger Requis avant l'étape suivante
Le chart `soctalk-cloud-agent` et le chart tenant sont livrés avec des NetworkPolicies qui supposent des politiques FQDN Cilium. Le k3s vanilla n'a pas les CRD Cilium, donc les politiques bloquent l'egress légitime de l'agent vers le MSSP. Désactivez les NetworkPolicies du chart avant l'installation helm au §4.6.

Le chemin le plus simple : ajoutez `--set networkPolicies.enabled=false` à votre commande helm.

Si votre cluster tenant nécessite une isolation réseau, mettez-la en place au niveau du pare-feu de l'hôte (l'ACL tailnet du §1.2 fournit déjà l'isolation MSSP↔tenant).
:::

### 4.6 Exécuter la commande helm de votre MSSP

Collez la commande du §3.2, en ajoutant `--set networkPolicies.enabled=false` conformément au §4.5 :

```bash
helm install soctalk-agent-<slug> \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token> \
  --set networkPolicies.enabled=false
```

::: tip Certificat MSSP auto-signé ? Réglez insecureTLS
Si votre installation MSSP n'a pas encore provisionné de vrai certificat TLS pour le nom d'hôte tailnet (cert-manager côté chart non câblé, ou vous êtes derrière Tailscale et le traitez comme la frontière de confiance), ajoutez `--set insecureTLS=true` à la commande helm. L'agent ignorera la vérification du certificat sur `controlPlaneUrl` ; Tailscale gère de toute façon le chiffrement du transport. Désactivé par défaut ; ne réglez ceci que lorsque vous faites confiance au réseau sous-jacent.
:::

Le cloud-agent s'installe dans le namespace `soctalk-agent`, compose le plan de contrôle via le tailnet, s'enregistre, et à partir de là le contrôleur MSSP pilote l'installation du chart tenant sur ce même cluster.

Observez le démarrage de l'agent :

```bash
kubectl -n soctalk-agent logs deploy/soctalk-cloud-agent -f
# look for: agent_registered installation_id=...
```

Lorsque `agent_registered` apparaît dans les logs, l'agent a communiqué avec succès avec le MSSP.

### 4.7 Wazuh : existant ou neuf ?

::: code-group
```text [4.7a: Tenant has existing Wazuh]
Required: TWO endpoint + credential pairs.

1. Wazuh Indexer, typically https://<host>:9200
   - User + password with read access to wazuh-alerts-*
2. Wazuh Manager API, typically https://<host>:55000
   - User + password with permission to mint JWTs

Both must be reachable from this tenant VM. The Manager API must ALSO
be reachable from the MSSP via the tailnet; the L1 chat agent dials
it directly when answering questions about your alerts.

If your existing Wazuh runs on a SEPARATE host from this tenant VM
(common), pick one of these:

a) Install Tailscale on the Wazuh host too, join the same tailnet
   tagged tag:tenant-<slug>. Simplest; gives the MSSP a stable
   tailnet hostname to dial.

b) Advertise the Wazuh subnet from this tenant VM. On this VM:

     sudo tailscale up --auth-key=... --advertise-tags=tag:tenant-<slug> \
       --hostname=soctalk-tenant-<slug> \
       --advertise-routes=<wazuh-subnet>/<mask>

   Then approve the route in the Tailscale admin UI under
   Machines → this host → Edit route settings.

Without (a) or (b), the MSSP can reach this VM but cannot reach
your Wazuh Manager, and chat tool calls against your tenant will
fail.

Hand both endpoint + credential pairs (plus the chosen reachability
option) back to your MSSP. They paste the credentials at step 3 of
the Create Customer wizard (§3.1), which configures the SocTalk
tenant chart to use your Wazuh in "provided" mode. If the MSSP has
already onboarded you as `provided` and your reachability story
changes later, they update the External SIEM panel on the tenant
detail page instead (§3.4).
```

```text [4.7b: No existing Wazuh]
The SocTalk tenant chart installs Wazuh + one linux-ep agent
simulator automatically (the `poc` profile). No tenant action needed
beyond waiting ~5 minutes for the Wazuh stack to come up.

Watch progress:
  kubectl -n tenant-<slug> get pods -w
```
:::

### 4.8 Points de contrôle : deux états à surveiller

Le tenant traverse deux états de préparation distincts. Ne les confondez pas :

#### 4.8a Cloud-agent enregistré (~1 minute après le §4.6)

Reconnectez-vous au tableau de bord MSSP. Votre tenant bascule sur **Online** dans les 1 à 2 minutes suivant le succès du §4.6. Cela signifie que **le cloud-agent a atteint le MSSP et s'est enregistré** : la poignée de main de confiance est terminée.

Cela ne signifie **pas encore** que la pile Wazuh du tenant est opérationnelle ou que les outils de chat résoudront les requêtes contre ce tenant.

![Tableau de bord MSSP : tenant basculé sur Online](/screenshots/mssp-dashboard-tenant-online.png)

#### 4.8b Plan de données du tenant entièrement prêt (~5-7 minutes de plus)

Après l'enregistrement de l'agent, le contrôleur MSSP pilote l'installation du chart tenant sur le cluster du tenant :

- **Profil `poc`** : Wazuh + simulateur linux-ep démarrent. Temps réel ~5-7 minutes.
- **Profil `provided`** : l'adaptateur SocTalk démarre immédiatement. Les appels d'outils de chat Wazuh se résolvent dès que l'adaptateur atteint les points de terminaison External SIEM que le MSSP a fournis au §3.1 étape 3. Si ce n'est pas le cas, vérifiez la joignabilité conformément au §3.4.

Observez depuis la VM tenant :

```bash
kubectl -n tenant-<slug> get pods -w
# poc profile: wait until wazuh-manager-0, wazuh-indexer-0, linux-ep-N all Ready
# provided profile: wait until soctalk-adapter is Ready
```

Ce n'est qu'après le §4.8b que le tenant est prêt pour la démo au §5. Si le §4.8a se déclenche mais que le §4.8b ne se termine jamais, voir [Dépannage du pilote](#_7-pilot-troubleshooting).

## 5. Le moment de la démo

Le moment face aux parties prenantes. Reproduisez ces requêtes mot pour mot ; la formulation détermine l'outil que le LLM choisit.

Connectez-vous au tableau de bord MSSP. Ouvrez l'onglet **Chat**.

**Requête 1. Confirmer que le tenant est joignable.**

```text
list all tenants
```

Attendu : un badge d'outil `list_tenants`, puis une réponse listant vos tenants pilotes par slug + nom d'affichage.

![Chat : badge d'outil list_tenants + réponse](/screenshots/chat-list-tenants.png)

**Requête 2. Afficher les alertes d'un tenant spécifique.**

```text
show me the 5 most recent alerts at <tenant-slug> with rule ids
```

Attendu : un badge d'outil `recent_alerts` avec une puce `@ <tenant-slug>`, puis un résumé en langage naturel listant les ID de règles, les sévérités et les horodatages.

::: tip C'est la capture d'écran pour les parties prenantes
La puce `@ <tenant-slug>` sur le badge d'outil est la preuve : l'analyste SOC AI de SocTalk accède aux alertes Wazuh transférées du tenant et répond à une question sur des données réelles. Capturez cet écran.
:::

![Chat : recent_alerts @ acme avec ID de règles + analyse LLM](/screenshots/chat-wazuh-alerts.png)

::: info Pourquoi `recent_alerts` et non `get_wazuh_alert_summary` ?
Le profil `poc` du pilote installe Wazuh dans le cluster du tenant et l'adaptateur SocTalk transfère les alertes (sous réserve d'une sévérité minimale, configurable via `SOCTALK_ADAPTER_MIN_SEVERITY`) vers la base de données du MSSP. `recent_alerts` lit à partir de ce flux transféré, il fonctionne donc que le MSSP puisse ou non atteindre l'API Wazuh du tenant directement. `get_wazuh_alert_summary` est l'équivalent en intégration directe, utile pour le profil `provided` lorsque le MSSP détient l'URL + les identifiants Wazuh du tenant dans **Integrations**.
:::

Si la liste des alertes est vide (le Wazuh du tenant n'a encore vu aucun trafic), générez des alertes de test. Le chemin Wazuh installé via chart (§4.7b) livre un ou plusieurs pods `linux-ep-N` avec le simulateur d'attaque ; déclenchez-le sur la première réplique prête via un sélecteur de labels :

```bash
# On the tenant VM, against any linux-ep pod
kubectl -n tenant-<slug> exec -it \
  "$(kubectl -n tenant-<slug> get pod -l app=linux-ep -o jsonpath='{.items[0].metadata.name}')" \
  -- /opt/scripts/run-attack.sh
```

Attendez 30 à 60 secondes et relancez la requête de chat. Pour le chemin Wazuh existant (§4.7a), déclenchez les alertes comme vous le feriez normalement sur votre propre Wazuh, par ex. en tentant quelques mauvais mots de passe en SSH sur un hôte surveillé.

## 6. Jour 2 : et ensuite ?

- **Ajoutez le Wazuh réel du client.** Intégrez davantage de tenants en répétant les §3 et §4. Même schéma ; chaque nouveau tenant a besoin d'un nouveau tag Tailscale, d'une entrée ACL, d'une clé d'authentification éphémère et d'une émission d'agent.
- **Planifiez l'installation de production.** Lorsque vous êtes prêt à dépasser le pilote, voir [Installation](/fr-fr/install) pour le chemin K3s + Cilium + cert-manager + vrai ingress.
- **Opérations sur le cycle de vie des tenants.** [Cycle de vie du tenant](/fr-fr/tenant-lifecycle) couvre la suspension, la reprise et le décommissionnement des tenants depuis le tableau de bord MSSP.
- **Mises à niveau.** [Mises à niveau](/fr-fr/upgrades) couvre la montée de version de soctalk-system et du cloud-agent.
- **Sauvegardes.** [Sauvegarde et restauration](/fr-fr/backup-restore) pour les données à état.

### Ce qui N'EST PAS dans le pilote

- Haute disponibilité (un seul nœud k3s de chaque côté)
- Vrai TLS (le nom d'hôte tailnet utilise des certificats auto-signés ; la production nécessite cert-manager + vrai ingress)
- Multi-région
- Mise à l'échelle par tenant au-delà de ~50 agents Wazuh par tenant
- Ingress par tenant (ce pilote utilise le nom d'hôte tailnet pour tout)

Lorsque vous migrez vers la production, votre configuration produit MSSP (liste des tenants, historique de chat, clé LLM) peut être reportée avec de la planification. Parlez-en à l'équipe avant de décommissionner ce pilote.

## 7. Dépannage du pilote

Tableau orienté symptômes pour les défaillances spécifiques à la topologie du pilote. Les problèmes SocTalk génériques sont couverts dans [Dépannage](/fr-fr/troubleshooting).

| Symptôme | Cause probable | Vérification |
|---|---|---|
| Tenant bloqué en « Pending » dans le tableau de bord MSSP | Jeton bootstrap expiré avant l'exécution du §4.6 | Réémettre depuis le tableau de bord MSSP (§3.2) ; les jetons expirent par défaut au bout de 24 h |
| `tailscale ping soctalk-mssp.<tailnet>.ts.net` échoue depuis le tenant | ACL trop restrictive, ou machine MSSP hors ligne | Vérifier l'aperçu ACL dans l'interface d'administration Tailscale ; vérifier `tailscale status` du MSSP |
| Les logs de l'agent montrent `connection refused` vers `controlPlaneUrl` | Le `helm upgrade` côté MSSP du §2.4 n'a pas pris effet | Sur la VM MSSP : `kubectl -n soctalk-system get ingress` ; confirmer que le nom d'hôte correspond |
| Les logs de l'agent montrent `403 Forbidden` du MSSP | Jeton bootstrap déjà utilisé (usage unique) | Réémettre depuis le §3.2 |
| `kubectl -n soctalk-agent get pods` montre `ImagePullBackOff` | Le cluster tenant ne peut pas récupérer depuis `ghcr.io` (proxy d'entreprise) | Configurer registries.yaml de k3s avec le proxy ; ou pré-récupérer sur la VM tenant |
| Le chat dit « no Wazuh alerts » mais le tenant a des alertes | Cas Wazuh existant : Manager API non joignable depuis le tailnet MSSP | Depuis la VM MSSP : `curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"` (GET ; devrait renvoyer un JWT) |
| L'outil `get_wazuh_alert_summary` renvoie une erreur | Cas Wazuh existant : identifiants Indexer incorrects | Depuis la VM tenant : `curl -ku <user>:<pw> https://<wazuh-indexer>:9200/wazuh-alerts-*/_search?size=1` |
| Le heartbeat de l'adaptateur fonctionne mais l'agent n'atteint jamais « Online » | NetworkPolicies laissées activées au §4.5 | `kubectl -n soctalk-agent get networkpolicies` ; devrait être vide |
| `helm install` rejeté avec une erreur values-schema | Décalage de version de chart entre le plan de contrôle et le chart de l'agent | Utiliser la version de chart affichée par le point de terminaison issue-agent, et non « latest » |

## 8. Décommissionner le pilote

Lorsque le pilote se termine :

1. **Côté tenant, chaque tenant** : `helm uninstall soctalk-agent-<slug> -n soctalk-agent`. Éteignez et archivez (ou détruisez) la VM tenant.
2. **Interface d'administration Tailscale** : révoquez la clé d'authentification de chaque tenant sous **Settings → Keys** ; retirez chaque tag de tenant de **Access Controls**.
3. **Tableau de bord MSSP** : pour chaque tenant, **Decommission** depuis la page de détail du tenant (l'état passe à `decommissioning` → `archived`).
4. **VM MSSP** : archivez ou détruisez si vous ne migrez pas vers la production. Si vous migrez, voir [Installation](/fr-fr/install) pour le chemin cluster de production.

Conservez ces artefacts pour l'examen post-pilote :

- Le journal d'audit de chaque page de détail de tenant (téléchargeable)
- Votre `values.yaml` rempli du §2.4
- La clause ACL Tailscale du §1.2
- Les captures d'écran du §5
