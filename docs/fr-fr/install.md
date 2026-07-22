# Installation

Pour les administrateurs de cluster MSSP. Couvre les prérequis du cluster, l'installation du chart `soctalk-system` et l'onboarding du premier client.

**Vous l'essayez pour la première fois ? Utilisez plutôt la [VM de démonstration](/fr-fr/quickstart-vm).** C'est une installation à image unique avec un assistant basé sur navigateur — un chemin bien plus rapide vers un système fonctionnel. Cette page décrit le chemin de production : K3s + Cilium + cert-manager + votre propre contrôleur d'ingress.

**Vous évaluez avec 1 à 3 tenants ?** [Launchpad](/fr-fr/launchpad) automatise le pilote multi-tenant de bout en bout (VMs + Tailscale + cet installateur + onboarding des tenants). Revenez ici quand vous construirez la vraie chose.

## Installation rapide sur une VM Ubuntu cloud (en une commande)

Pour un plan de contrôle MSSP mononœud sur une VM Ubuntu 24.04 vierge (cloud ou on-prem), le même `install.sh` que la [VM de démonstration](/fr-fr/quickstart-vm) intègre est accessible sous forme d'installateur en une commande. Il amorce k3s + Helm, récupère le chart OCI soctalk-system depuis GHCR et initialise les secrets admin / LLM en une seule étape.

Définissez la configuration d'installation via l'environnement (n'importe quel sous-ensemble ; le reste est demandé) — lorsque **les trois** variables `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL`, `SOCTALK_ADMIN_PASSWORD` sont présentes, l'installateur saute son invite de consentement afin que les flux `curl | bash` sans intervention fonctionnent sans `-y` :

```bash
export SOCTALK_MSSP_NAME="Acme MSSP"
export SOCTALK_ADMIN_EMAIL="admin@acme.example"
export SOCTALK_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SOCTALK_HOSTNAME="soctalk.acme.example"      # what the dashboard URL will be
export SOCTALK_LLM_PROVIDER="anthropic"             # or openai-compatible
export SOCTALK_LLM_API_KEY="sk-..."                 # OR --llm-key-file <path>

curl -sfL https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh | bash
```

Options utiles à connaître : `--yes` / `-y` (assume-yes lorsque l'environnement est partiel), `--demo` (mot de passe admin aléatoire + onboarding automatique d'un tenant de démonstration — le chemin « montre-moi juste » le plus rapide ; aucun environnement requis), `--chart-version <v>` (épingle une version de chart spécifique), `--chart-dir <path>` / `--values-file <path>` (hors ligne / air-gapped). Référence complète : `install.sh --help`.

Le script propage `SOCTALK_HOSTNAME` dans le `ingress.hostnames.mssp` du chart, et le chart en dérive à son tour `SOCTALK_PUBLIC_ORIGIN` (CSRF) et `SOCTALK_L1_PUBLIC_URL` (l'URL que le cloud-agent du tenant utilise pour `/register`). Aucun réglage manuel de variable d'environnement n'est requis sur le Deployment api.

Si vous avez besoin d'un contrôle plus fin — contrôleur d'ingress non par défaut, nom d'hôte client distinct, `ClusterIssuer` cert-manager, etc. — utilisez plutôt le chemin Helm ci-dessous.

## Prérequis du cluster

Installez-les une fois par cluster K3s avant `soctalk-system`. SocTalk exige Kubernetes 1.30+ car le chart système installe un garde `ValidatingAdmissionPolicy` natif pour les opérations sur les namespaces des tenants.

### K3s avec Cilium

```bash
# Production K3s: disable flannel + kube-proxy + traefik so Cilium (CNI)
# and your chosen ingress controller take over. The demo VM image uses
# the *bundled* Traefik instead — that's intentional for a zero-config
# single-box install but not what you want for production.
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC=" \
  --flannel-backend=none \
  --disable-network-policy \
  --disable-kube-proxy \
  --disable=traefik \
" sh -

# Install Cilium.
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium --version 1.15.x \
  --namespace kube-system \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=<node-ip> \
  --set k8sServicePort=6443 \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true

# Verify.
cilium status
```

### cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.14.x \
  --set installCRDs=true
```

Configurez un `ClusterIssuer` adapté à votre environnement (Let's Encrypt, CA interne, ou auto-signé pour le développement).

Les valeurs SocTalk par défaut demandent un hôte wildcard pour les UIs client (`*.customers.your-mssp.example`), et Let's Encrypt n'émet des wildcards que via DNS-01. Utilisez un solveur DNS-01 avec le fournisseur qui héberge votre zone. Exemple pour Cloudflare :

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@your-mssp.example
    privateKeySecretRef: { name: letsencrypt-prod }
    solvers:
      - selector:
          dnsZones:
            - your-mssp.example
        dns01:
          cloudflare:
            email: ops@your-mssp.example
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
```

cert-manager dispose de recettes de solveur pour Route 53, Cloud DNS, Azure DNS, RFC 2136 et d'autres. Choisissez celle qui correspond au fournisseur de votre zone.

> Si vous n'avez pas besoin de noms d'hôte client wildcard (c.-à-d. que vous énumérez les hôtes client individuellement), vous pouvez utiliser HTTP-01 avec `solvers: [- http01: { ingress: { class: traefik } }]` à la place. Les valeurs de `soctalk-system` définissent par défaut `className: traefik` ; le `ingress.class` du solveur ACME (HTTP-01) ou le fournisseur DNS doit correspondre à la classe d'ingress du chart. Pour ingress-nginx, définissez `class: nginx` des deux côtés.

### Contrôleur d'ingress

K3s ne livre pas Traefik avec nous (nous l'avons désactivé ci-dessus). Installez votre ingress préféré :

```bash
# Option A: Traefik v3
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n ingress-system --create-namespace

# Option B: ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-system --create-namespace
```

Étiquetez le namespace d'ingress pour la NetworkPolicy :

```bash
kubectl label namespace ingress-system managed-by=ingress
```

### Mode d'authentification

L'API lit `SOCTALK_AUTH_MODE` (`internal | proxy`) au démarrage. Le chart `soctalk-system` se déploie en mode `internal` : SocTalk possède la connexion, les sessions et le stockage des mots de passe, et le Job de bootstrap initialise un admin initial dans un Secret (voir [Exécuter le bootstrap](#run-the-bootstrap)).

Le mode `proxy` — placer SocTalk derrière OAuth2-Proxy / Keycloak / Dex et faire confiance aux en-têtes d'identité en amont — est pris en charge par le runtime mais n'est pas encore exposé comme réglage de valeurs du chart. Considérez-le comme un élément d'une future version ; si vous exploitez un SSO central et souhaitez le piloter dès maintenant, définissez la variable d'environnement directement sur le Deployment api après l'installation.

Détails complets : [Authentification interne](/fr-fr/reference/internal-auth).

### StorageClass

N'importe quel provisionneur dynamique fonctionne. Pour K3s par défaut, `local-path` est préinstallé. Pour la production, utilisez Longhorn, Rook/Ceph, ou un CSI de fournisseur cloud. Assurez-vous que l'un d'eux est marqué `storageclass.kubernetes.io/is-default-class=true`.

## Installer SocTalk

### Préparer les valeurs

Créez `soctalk-system-values.yaml` :

```yaml
install:
  msspId: "<uuid>"         # generate: uuidgen | tr A-Z a-z
  msspName: "Your MSSP"
  installId: "<uuid>"
  installLabel: "pilot-prod"

image:
  registry: ghcr.io/soctalk
  tag: "0.2.0"

ingress:
  enabled: true
  className: traefik          # chart default; set to "nginx" for ingress-nginx
  tls:
    issuerRef: letsencrypt-prod
    secretName: soctalk-tls
  hostnames:
    mssp: mssp.your-mssp.example
    customer: "*.customers.your-mssp.example"

# Auth knobs the chart accepts today. See the Authentication mode
# section above for proxy mode (not yet wired through values).
auth:
  cookieSecure: true          # production TLS: keep true; HTTP-only dev: false

# Trusted headers and proxy CIDRs are read by the API only in proxy
# mode (which today requires a manual env-var override after install).
# Defaults shown for reference; safe to omit when running internal mode.
oidc:
  trustedHeaderUser: X-Forwarded-User
  trustedHeaderEmail: X-Forwarded-Email
  trustedHeaderGroups: X-Forwarded-Groups
  trustedProxyCIDRs:
    - 10.42.0.0/16   # your pod CIDR / ingress CIDR

postgres:
  enabled: true
  storage: { size: 20Gi }

# Required if you want a working sign-in on first install. The chart's
# db-init container creates this user inline; without it, no admin
# exists and `soctalk-auth set-password` (which only updates existing
# users) has nothing to update.
install:
  bootstrapAdmin:
    email: "ops@your-mssp.example"
    password: "changeMe-please-rotate"   # rotate via `soctalk-auth set-password` after first sign-in
    displayName: "MSSP Admin"
    # Production alternative: leave password empty and set
    # existingSecret to a pre-provisioned Secret with key `password`
    # so the credential never passes through helm values.
    # existingSecret: "my-bootstrap-admin"
```

### Installer

```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version 0.2.0 \
  --namespace soctalk-system --create-namespace \
  -f soctalk-system-values.yaml
```

Le Job de pré-installation du chart vérifie les prérequis du cluster et échoue rapidement si l'un d'eux manque.

### Les migrations et le bootstrap s'exécutent automatiquement

Les deux se produisent à l'intérieur de la commande d'init du pod API avant le démarrage de l'application FastAPI :

1. Attendre que Postgres accepte les connexions.
2. `alembic upgrade head` pour migrer vers le schéma le plus récent.
3. Lier les mots de passe par rôle (`soctalk_app`, `soctalk_mssp`).
4. Initialiser la ligne Organization à partir de `install.msspId` / `install.msspName`.
5. Si `install.bootstrapAdmin.email` et `install.bootstrapAdmin.password` sont définis dans les valeurs, faire un upsert de l'utilisateur en `mssp_admin` avec `must_change=false` et le mot de passe fourni.

Ainsi, si vous placez les identifiants de l'admin de bootstrap dans les valeurs, **l'API démarre avec l'admin déjà créé** — aucun Job supplémentaire à exécuter.

Le chart **ne** livre **pas** de Job Alembic séparé ; l'édition précédente de cette page en décrivait un qui n'existait pas. Les migrations sont liées au cycle de vie du pod API. Pour les observer :

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Lors d'une mise à niveau, supprimer le pod API réexécute la migration (alembic est idempotent, donc une réexécution sur une base de données inchangée est sans effet).

Si vous n'avez PAS fourni `install.bootstrapAdmin.password` dans les valeurs, définissez le mot de passe admin après l'installation :

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password <admin-email>
```

En mode d'authentification `proxy`, les endpoints de mot de passe ne sont pas montés. **Le provisionnement JIT des utilisateurs à la première requête authentifiée n'est pas implémenté en V1** — vous devez initialiser manuellement le premier utilisateur MSSP (par exemple, via `kubectl exec` sur le pod API et un `INSERT` SQL direct dans la table `users`) avant que toute requête authentifiée par proxy puisse aboutir. Un vrai chemin JIT est sur la feuille de route.

## Vérifier l'installation

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace soctalk-system
```

Connectez-vous sur `https://mssp.your-mssp.example` avec l'admin de bootstrap. Vous devriez arriver sur le tableau de bord MSSP :

![MSSP dashboard](/screenshots/mssp-dashboard.png)

Pour une visite de chaque écran que vous verrez à partir d'ici, lisez la [Visite de l'UI MSSP](/fr-fr/mssp-ui).

## Onboarder le premier client

Dans l'UI MSSP, allez dans **Tenants → Nouveau tenant**. Le formulaire d'onboarding collecte : slug, nom d'affichage, profil (`poc` | `persistent` | `provided`), e-mail de contact, branding, et éventuellement l'URL de base LLM + surcharges de modèle. Les invitations customer-viewer ne sont **pas** dans le formulaire — cela se configure après que le tenant a atteint l'état `active`. Le provisionnement s'exécute de manière asynchrone ; rafraîchissez la page de détail pour voir apparaître de nouveaux événements de cycle de vie dans la table des événements. (Un flux d'événements en direct est sur la feuille de route ; `/api/events/stream` existe mais n'émet que des pings dans cette version.) Si vous choisissez `provided` (BYO Wazuh), le formulaire exige en plus les URLs de l'indexeur externe + de la Manager API et les identifiants, ainsi qu'une clé LLM par tenant — voir [cycle de vie du tenant / provided](/fr-fr/tenant-lifecycle#provided).

![Tenants list](/screenshots/tenants-list.png)

Une fois que le tenant a atteint l'état `active` :

1. Mettez à jour la clé API LLM du tenant via **Customer → Settings → LLM**.
2. Configurez l'ingress de l'agent Wazuh selon [Ingress Wazuh](/fr-fr/reference/wazuh-ingress).
3. Partagez l'URL de l'UI client et l'invitation `customer_viewer` initiale avec le client final.

Puis vérifiez :

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# Tenant namespace exists and data plane is Ready
kubectl -n tenant-<slug> get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace tenant-<slug> --verdict DROPPED
```

## Suite

- [Opérations quotidiennes](/fr-fr/operations) pour les tâches du jour 2.
- [Mises à niveau](/fr-fr/upgrades) pour les mises à niveau au niveau installation et par tenant.
- [Ingress Wazuh](/fr-fr/reference/wazuh-ingress) pour l'onboarding des agents client.
