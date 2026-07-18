# Ingress des agents Wazuh et enrôlement des certificats


## Problème

Chaque tenant dispose d'un manager Wazuh dédié s'exécutant dans le namespace `tenant-<slug>`. Les agents Wazuh sont installés sur les endpoints du client (en dehors du cluster du MSSP) et doivent se connecter au manager Wazuh de **leur tenant** sur :

- **1514/TCP** : flux d'événements des agents (chiffré avec le protocole natif de Wazuh sur TLS)
- **1515/TCP** : enrôlement des agents / `authd` (enregistrement à l'aide d'un secret partagé)

Contraintes :

- De nombreux tenants sur un même cluster → impossible d'exposer 1514/1515 sur un seul NodePort (collision de ports).
- Les agents ne doivent atteindre que le manager de *leur* tenant (pas celui d'un autre tenant).
- Les endpoints des clients se trouvent sur des réseaux inconnus (LAN d'entreprise, VMs cloud, ordinateurs portables) : le plus souvent, la connectivité passe par l'internet public.
- Les certificats TLS doivent être spécifiques à chaque tenant (chaîne de confiance délimitée par client).

## Modèle retenu : adresse par tenant à la périphérie du MSSP

Chaque tenant obtient un nom DNS dédié (`acme.soc.mssp.example.com`) qui se résout vers un endpoint L4 par tenant à la périphérie du MSSP. Le routage vers le bon manager Wazuh se fait par adresse de destination, et non par inspection du nom d'hôte.

**Pourquoi pas de routage L4 basé sur le SNI.** Le protocole d'agent de Wazuh sur 1514/TCP est un flux propriétaire chiffré en AES, et non du TLS standard ; les connexions ne transportent donc pas de ClientHello SNI. Un proxy L4 qui aiguille sur `req.ssl_sni` n'en verra aucun et le trafic des agents retombera sur le backend par défaut. Le canal d'enrôlement 1515/TCP négocie bien du TLS, mais le routage doit utiliser le même discriminateur que 1514, sinon les deux ports divergent.

Deux implémentations de l'adressage par tenant sont prises en charge :

1. **Service LoadBalancer par tenant (modèle recommandé ; pas encore câblé dans le chart).** Le sous-chart `wazuh` actuel crée le `Service` du manager Wazuh uniquement en `ClusterIP` — il n'y a **aucun provisionnement automatique de LoadBalancer ou de DNS** dans cette version. Pour rendre aujourd'hui un tenant routable depuis l'internet public, vous devez soit : superposer vous-même un Service LoadBalancer externe (`kubectl apply` manuel), placer chaque tenant derrière un HAProxy / NGINX de périphérie avec un SNI ou un mappage de ports par tenant, soit utiliser la topologie port-par-tenant décrite ci-dessous. Le LB cloud + DNS par tenant constitue la destination documentée ; y parvenir nécessite un câblage manuel côté MSSP.
2. **Port par tenant sur une seule IP de périphérie (solution de repli).** Lorsque les IPs uniques sont rares, allouez une plage de ports sur une IP de périphérie et affectez des décalages `(1514, 1515)` par tenant (par ex. acme → 15140/15141, beta → 15142/15143). Le DNS utilise des enregistrements `SRV` ou la configuration `manager_address:port` de l'agent pour l'aiguillage. Peu pratique sur le plan opérationnel, mais fonctionnel.

### Topologie

```
Customer endpoint (Wazuh agent)
        │
        │ TCP 1514 to acme.soc.mssp.example.com
        │ (Wazuh agent protocol; not standard TLS)
        ▼
DNS resolves to the LoadBalancer IP for tenant-acme
        │
        ▼
┌───────────────────────────────────┐
│ MSSP cluster ingress for          │
│ tenant-acme/wazuh-manager         │
│ (cloud LB IP or MetalLB-assigned) │
└─────────────┬──────────────────────┘
              │ cluster-internal forward
              ▼
  tenant-acme namespace
  ┌─────────────────┐
  │ wazuh-manager   │
  │ Service: 1514   │
  │ Pod with        │
  │ tenant-specific │
  │ TLS cert (1515) │
  └─────────────────┘
```

### DNS

Un enregistrement `A`/`AAAA` par tenant : `<slug>.soc.mssp.example.com → <tenant LB IP>` est la conception cible. **En V1, SocTalk N'ÉMET PAS d'enregistrements DNS** — l'opérateur gère le DNS manuellement (external-dns / console du fournisseur) une fois que le LB par tenant a été provisionné hors bande. Un chemin d'émission DNS piloté par SocTalk (annotations external-dns ou intégration directe au fournisseur) figure sur la feuille de route.

Le DNS wildcard ne fonctionne pas pour le modèle LoadBalancer, car chaque tenant possède sa propre IP. Il ne fonctionne que dans la topologie de repli (port par tenant), où chaque nom se résout vers la même IP de périphérie.

### Certificats TLS

Chaque tenant obtient un certificat dont le SAN couvre `<slug>.soc.mssp.example.com`. Options :

- **Certificat par tenant via cert-manager + Let's Encrypt** (recommandé pour le MVP) : une CR `Certificate` cert-manager par tenant, émise par un `ClusterIssuer` DNS-01 ou HTTP-01 : certificat stocké dans le namespace `tenant-<slug>` en tant que `Secret/wazuh-tls` : renouvelé automatiquement.
- **Certificat wildcard pour `*.soc.mssp.example.com`** : un seul certificat couvre tous les tenants. Plus simple, mais cela signifie que le manager Wazuh de n'importe quel tenant peut présenter le certificat pour l'agent de n'importe quel tenant lors de défaillances du proxy côté MSSP : risque acceptable pour cette version, puisque le routage constitue la véritable application de la règle.
- **CA interne fournie par le MSSP** : pour les MSSP exploitant leur propre PKI, cert-manager peut émettre depuis un `Issuer` intra-cluster adossé à la CA du MSSP.

Le guide d'installation documente les trois ; le pilote utilise par défaut Let's Encrypt par tenant.

### Provisionnement du LoadBalancer

Le MSSP exécute l'un des éléments suivants :

| Environnement | Source du LoadBalancer |
|---|---|
| Cloud managé (EKS, GKE, AKS, …) | Le contrôleur de load-balancer du cloud attribue une IP publique par `Service` de type `LoadBalancer`. |
| Bare-metal ou on-prem | MetalLB (mode L2 ou BGP) avec un pool d'adresses, ou kube-vip. |
| Périphérie à IP unique avec mappage de ports | Exécutez un proxy L4 externe (HAProxy, Envoy, nginx-stream) qui transfère les paires `(IP, port)` vers le `Service` du tenant. À n'utiliser que dans la topologie de repli port-par-tenant. |

La conception cible est que le `Service` du chart `soctalk-tenant` soit annoté afin que les contrôleurs cloud et MetalLB puissent appliquer une sélection de pool/classe d'IP (par ex. `metallb.universe.tf/address-pool: wazuh-agents`), et que le contrôleur SocTalk enregistre l'IP LB résultante et écrive l'enregistrement DNS par tenant. **En V1, aucun de ces éléments n'est câblé** — le Service du manager Wazuh est uniquement en `ClusterIP` et le contrôleur n'interroge pas pour l'attribution d'IP LB.

Si vous devez utiliser une seule IP de périphérie (repli), un mappage HAProxy de référence ressemble à ceci :

```
# Per-port routing — each tenant has its own 1514/1515 pair at the edge.
frontend wazuh-15140
    mode tcp
    bind *:15140
    default_backend tenant-acme-events
frontend wazuh-15141
    mode tcp
    bind *:15141
    default_backend tenant-acme-enroll
frontend wazuh-15142
    mode tcp
    bind *:15142
    default_backend tenant-beta-events

backend tenant-acme-events
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1514
backend tenant-acme-enroll
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1515
backend tenant-beta-events
    mode tcp
    server wazuh wazuh-manager.tenant-beta.svc.cluster.local:1514
```

N'aiguillez pas sur `req.ssl_sni` pour Wazuh 1514. Le protocole d'agent de Wazuh n'est pas du TLS standard et ne produit jamais de ClientHello à cet endroit. Le SNI n'est disponible que sur 1515 (enrôlement), ce qui est insuffisant — les événements auraient toujours besoin d'un discriminateur fonctionnel.

## Flux d'enrôlement des agents

L'enregistrement `authd` de Wazuh sur 1515/TCP requiert un secret partagé. Chaque tenant possède son propre secret `authd`, stocké dans `Secret/wazuh-<slug>-wazuh-creds` (clé : `AUTHD_PASS`) dans le namespace du tenant. Enrôlement :

1. **L'opérateur MSSP** intègre un nouveau client. SocTalk génère le secret partagé `authd` au moment du provisionnement du tenant.
2. **L'opérateur MSSP** fournit à l'administrateur des endpoints du client :
   - Le nom d'hôte du manager Wazuh du tenant (`acme.soc.mssp.example.com`)
   - Les ports (1514 événements, 1515 enrôlement)
   - Le secret partagé `authd` (via un canal sécurisé : plateforme de gestion des secrets, e-mail chiffré, ou tout ce qu'utilise le MSSP)
   - Le programme d'installation de l'agent Wazuh (paquet upstream standard)
3. **L'administrateur des endpoints du client** installe l'agent Wazuh avec le nom d'hôte et l'enrôle :
   ```bash
   /var/ossec/bin/agent-auth \
       -m acme.soc.mssp.example.com \
       -P "<authd-shared-secret>"
   ```
4. L'agent s'enregistre auprès du manager du tenant et reçoit son propre certificat par agent.
5. Les connexions suivantes sur 1514 se font en mTLS par agent.

Le routage sur 1515 utilise la même adresse par tenant que 1514 (IP LB ou port de périphérie). Le secret partagé `authd` est délimité par tenant : un agent utilisant le secret d'`acme` ne peut s'enregistrer qu'auprès du manager d'`acme` — l'adressage l'impose, et le secret est vérifié par le manager.

## Exigences en matière de pare-feu / réseau

Côté MSSP :
- IPs publiques pour le proxy de périphérie (une IP, ou des IPs par région pour les MSSP disposant de régions MSSP géo-distribuées).
- Le proxy de périphérie autorise les entrées 1514/TCP, 1515/TCP depuis 0.0.0.0/0 (ou des CIDR spécifiques au client si le MSSP le préfère).
- Le pare-feu intra-cluster (plage NodePort ou CIDR interne) autorise le proxy de périphérie → manager Wazuh du namespace du tenant.

Côté client :
- Les agents autorisent les sorties 1514/1515/TCP vers le nom d'hôte de périphérie du MSSP.
- Aucune entrée du MSSP vers les endpoints du client (Wazuh est sans pull : les événements proviennent de l'agent).

## Révocation de certificat / retrait d'agent

> **État de l'UI :** l'onglet Agents par tenant décrit ci-dessous est prévu. En attendant sa livraison, utilisez la solution de contournement en fin de section.

Pour révoquer un agent spécifique (UX prévue) :
1. L'opérateur MSSP ouvre le tenant dans l'UI MSSP → onglet Agents → révoque.
2. SocTalk appelle l'API du manager Wazuh pour supprimer l'enregistrement de l'agent.
3. L'administrateur des endpoints du client désinstalle l'agent (facultatif, entretien).

**Aujourd'hui**, révoquez directement depuis le tableau de bord Wazuh intégré (liste des Tenants → **Open SOC** → Agents) ou via l'API du manager Wazuh :

```bash
kubectl -n tenant-<slug> exec deploy/wazuh-manager -- \
  /var/ossec/bin/manage_agents -r <agent-id>
```

Pour révoquer tous les agents d'un tenant (par ex. désengagement d'un client) :
1. Faites tourner le secret partagé `authd` du tenant (réenrôlement requis pour les nouveaux agents).
2. Supprimez tous les enregistrements d'agents existants via l'API Wazuh.
3. La mise hors service du tenant finit par démanteler le manager.

## Modèles de connectivité alternatifs (documentés, non construits)

### VPN / tunnel géré par le client

Si la politique réseau d'un client interdit aux agents d'envoyer de la télémétrie sur l'internet public :
- Le client provisionne un tunnel WireGuard/IPsec vers le réseau privé du MSSP.
- Le MSSP achemine le trafic du tunnel vers le même proxy de périphérie (ou directement vers le cluster sur des adresses internes).
- La configuration de l'agent pointe vers un nom d'hôte interne.

Non implémenté dans l'outillage de cette version ; documenté comme modèle de configuration pour les MSSP qui en ont besoin.

### Tailscale / réseau overlay

Similaire au 6.1 ; le MSSP et le client rejoignent un réseau Tailscale, l'agent atteint directement `acme.soc.mssp.ts.net`. Adapté aux petits clients ; documenté.

### Périphérie MSSP par région

Pour les MSSP présentant une séparation géographique (EU, US, APAC), exécutez plusieurs proxies de périphérie dans différentes régions. Chaque tenant est affecté à sa région la plus proche et le DNS le reflète (`acme.soc.eu.mssp.example.com`, `acme.soc.us.mssp.example.com`). La conception le permet, car le routage du proxy de périphérie vers le namespace du tenant n'est qu'une résolution DNS intra-cluster. L'aiguillage multi-région automatisé figure sur la feuille de route.

## Runbook : intégration du premier agent d'un client

> **État de l'UI :** le panneau dédié « Agent Onboarding » sur le détail du tenant est prévu mais ne figure pas encore dans la build actuelle. Le runbook ci-dessous décrit l'UX cible ; la solution de contournement en dessous est le chemin actuel.

**UX prévue :**

1. L'opérateur MSSP crée un tenant dans l'[UI MSSP](/fr-fr/mssp-ui) → SocTalk provisionne la stack, génère le secret `authd`.
2. L'opérateur MSSP navigue vers le détail du tenant → section « Agent Onboarding ».
3. La section affiche :
   - Le nom d'hôte du tenant : `acme.soc.mssp.example.com`
   - Les ports : 1514/TCP (événements), 1515/TCP (enrôlement)
   - Le secret partagé `authd` (masqué ; copier-vers-presse-papiers + révélation unique)
   - Un exemple de commande `agent-auth`
   - Les exigences en matière de pare-feu
4. L'opérateur MSSP copie vers un canal sécurisé, partage avec l'administrateur des endpoints du client.
5. L'administrateur des endpoints du client installe + enrôle.
6. L'opérateur MSSP surveille le détail du tenant → onglet Agents, voit l'agent apparaître en ~30 secondes.

**Solution de contournement actuelle :**

1. Créez le tenant depuis l'[UI MSSP](/fr-fr/mssp-ui) → Tenants → **+ New Tenant**.
2. Une fois que les événements de cycle de vie affichent `workloads_ready`, récupérez le secret partagé `authd` depuis Kubernetes :
   ```bash
   kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
     -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
   ```
3. Calculez le nom d'hôte du manager Wazuh du tenant à partir du modèle wildcard de l'installation (`<slug>.soc.<mssp-domain>`).
4. Partagez les deux avec l'administrateur des endpoints du client via un canal sécurisé ; il exécute `agent-auth` comme indiqué ci-dessus.
5. Confirmez que l'agent apparaît dans le tableau de bord Wazuh intégré (Tenants → **Open SOC** → Agents).

## Tests (validation pré-version + pilote)

Validation pré-version :
- Le template de `Service` par tenant s'affiche correctement pour les deux valeurs de `tenant.wazuhIngress.mode` (`loadbalancer` et `edge-haproxy`).
- Émission de certificat par tenant via cert-manager pour le canal d'enrôlement des agents (1515).
- De bout en bout dans `k3d` avec deux tenants, MetalLB fournissant deux IPs LB (mode `loadbalancer`) : pour chaque tenant, exécutez `agent-auth -m <lb-ip> -P <secret>` depuis un pod hôte et confirmez que l'agent apparaît dans l'indexeur Wazuh de ce tenant et non dans l'autre.
- Même chose de bout en bout en mode `edge-haproxy` : HAProxy affiche une paire `(IP, port-pair)` par tenant, les agents s'enrôlent avec `-m <edge-ip> -p <tenant-port>`, et le flux d'événements atterrit dans le bon indexeur.
- Négatif : un agent pointé vers l'adresse du tenant A avec le secret `authd` du tenant B est rejeté par le manager.

Validation du pilote (version ultérieure) :
- Un véritable endpoint client sur l'internet public s'enrôle proprement.
- Sonde inter-tenant : enrôlez un agent `acme` avec le secret `authd` de `beta` contre l'adresse de `beta` — rejet attendu. Vice versa. Les deux échouent.

Aucune de ces vérifications ne comporte d'étape SNI : le protocole d'agent de Wazuh sur 1514 ne produit pas de ClientHello, donc tout test qui « surcharge le SNI » exerce un chemin de routage que l'ingress de production n'empruntera pas. Validez plutôt le discriminateur adresse/port.
