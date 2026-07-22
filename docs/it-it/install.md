# Installazione

Per gli amministratori di cluster MSSP. Copre i prerequisiti del cluster, l'installazione del chart `soctalk-system` e l'onboarding del primo cliente.

**È la prima volta che lo provi? Usa invece la [VM demo](/it-it/quickstart-vm).** È un'installazione a immagine singola con una procedura guidata da browser, un percorso molto più rapido verso un sistema funzionante. Questa pagina è il percorso di produzione: K3s + Cilium + cert-manager + il tuo ingress controller.

**Stai valutando con 1-3 tenant?** [Launchpad](/it-it/launchpad) automatizza il pilota multi-tenant end-to-end (VM + Tailscale + questo installer + onboarding dei tenant). Torna qui quando stai costruendo la cosa reale.

## Installazione rapida su una VM Ubuntu cloud (un solo comando)

Per un control plane MSSP a nodo singolo su una VM Ubuntu 24.04 nuda (cloud o on-prem), lo stesso `install.sh` che la [VM demo](/it-it/quickstart-vm) incorpora è raggiungibile come installer a un solo comando. Effettua il bootstrap di k3s + Helm, scarica il chart OCI soctalk-system da GHCR e inizializza i secret admin / LLM in un unico passaggio.

Imposta la configurazione di installazione tramite variabili d'ambiente (qualsiasi sottoinsieme; il resto viene richiesto interattivamente), quando **tutte e tre** le variabili `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL`, `SOCTALK_ADMIN_PASSWORD` sono presenti, l'installer salta il prompt di consenso, così i flussi non presidiati `curl | bash` funzionano senza `-y`:

```bash
export SOCTALK_MSSP_NAME="Acme MSSP"
export SOCTALK_ADMIN_EMAIL="admin@acme.example"
export SOCTALK_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SOCTALK_HOSTNAME="soctalk.acme.example"      # quale sarà l'URL della dashboard
export SOCTALK_LLM_PROVIDER="anthropic"             # oppure openai-compatible
export SOCTALK_LLM_API_KEY="sk-..."                 # OPPURE --llm-key-file <path>

curl -sfL https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh | bash
```

Flag che vale la pena conoscere: `--yes` / `-y` (assume-yes quando le variabili d'ambiente sono parziali), `--demo` (password admin casuale + onboarding automatico di un tenant demo, il percorso "mostrami e basta" più veloce; non richiede variabili d'ambiente), `--chart-version <v>` (fissa una release specifica del chart), `--chart-dir <path>` / `--values-file <path>` (offline / air-gapped). Riferimento completo: `install.sh --help`.

Lo script propaga `SOCTALK_HOSTNAME` in `ingress.hostnames.mssp` del chart e il chart a sua volta deriva `SOCTALK_PUBLIC_ORIGIN` (CSRF) e `SOCTALK_L1_PUBLIC_URL` (l'URL che il cloud-agent del tenant usa per `/register`). Nessun intervento manuale sulle variabili d'ambiente del Deployment dell'api è necessario.

Se hai bisogno di un controllo più fine, ingress controller non predefinito, hostname cliente separato, `ClusterIssuer` di cert-manager, ecc., usa invece il percorso Helm descritto di seguito.

## Prerequisiti del cluster

Installa questi una volta per cluster K3s prima di `soctalk-system`. SocTalk richiede Kubernetes 1.30+ perché il system chart installa un guard nativo `ValidatingAdmissionPolicy` per le operazioni sui namespace dei tenant.

### K3s con Cilium

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

Configura un `ClusterIssuer` adatto al tuo ambiente (Let's Encrypt, CA interna o self-signed per lo sviluppo).

I valori predefiniti di SocTalk richiedono un host wildcard per le UI dei clienti (`*.customers.your-mssp.example`), e Let's Encrypt rilascia wildcard solo tramite DNS-01. Usa un solver DNS-01 con il provider che ospita la tua zona. Esempio per Cloudflare:

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

cert-manager ha ricette di solver per Route 53, Cloud DNS, Azure DNS, RFC 2136 e altri. Scegli quello adatto al provider della tua zona.

> Se non hai bisogno di hostname cliente wildcard (cioè, enumeri gli host dei clienti individualmente), puoi usare invece HTTP-01 con `solvers: [- http01: { ingress: { class: traefik } }]`. I valori di `soctalk-system` usano come predefinito `className: traefik`; l'`ingress.class` (HTTP-01) del solver ACME o il provider DNS devono corrispondere alla ingress class del chart. Per ingress-nginx, imposta `class: nginx` su entrambi i lati.

### Ingress controller

K3s non include Traefik con la nostra configurazione (lo abbiamo disabilitato sopra). Installa il tuo ingress preferito:

```bash
# Option A: Traefik v3
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n ingress-system --create-namespace

# Option B: ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-system --create-namespace
```

Etichetta il namespace dell'ingress per la NetworkPolicy:

```bash
kubectl label namespace ingress-system managed-by=ingress
```

### Modalità di autenticazione

L'API legge `SOCTALK_AUTH_MODE` (`internal | proxy`) all'avvio. Il chart `soctalk-system` viene distribuito in modalità `internal`: SocTalk gestisce il login, le sessioni e l'archiviazione delle password, e il Job di bootstrap inizializza un admin iniziale in un Secret (vedi [Esegui il bootstrap](#run-the-bootstrap)).

La modalità `proxy`: anteporre a SocTalk OAuth2-Proxy / Keycloak / Dex e fidarsi degli header di identità upstream, è supportata dal runtime ma non ancora esposta come knob nei valori del chart. Consideralo un elemento per una release futura; se gestisci un SSO centrale e vuoi pilotarlo ora, imposta la variabile d'ambiente direttamente sul Deployment dell'API dopo l'installazione.

Dettagli completi: [Autenticazione interna](/it-it/reference/internal-auth).

### StorageClass

Qualsiasi provisioner dinamico funziona. Per il default di K3s, `local-path` è preinstallato. Per la produzione, usa Longhorn, Rook/Ceph o un CSI del cloud provider. Assicurati che uno sia contrassegnato con `storageclass.kubernetes.io/is-default-class=true`.

## Installa SocTalk

### Prepara i valori

Crea `soctalk-system-values.yaml`:

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

### Installa

```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version 0.2.0 \
  --namespace soctalk-system --create-namespace \
  -f soctalk-system-values.yaml
```

Il Job di pre-install del chart verifica i prerequisiti del cluster e fallisce immediatamente se qualcuno manca.

### Migrazioni e bootstrap vengono eseguiti automaticamente

Entrambi avvengono all'interno del comando init del pod dell'API prima che l'app FastAPI si avvii:

1. Attende che Postgres accetti le connessioni.
2. `alembic upgrade head` per migrare all'ultimo schema.
3. Associa le password per ruolo (`soctalk_app`, `soctalk_mssp`).
4. Inizializza la riga Organization da `install.msspId` / `install.msspName`.
5. Se `install.bootstrapAdmin.email` e `install.bootstrapAdmin.password` sono impostati nei valori, effettua l'upsert dell'utente come `mssp_admin` con `must_change=false` e la password fornita.

Quindi, se inserisci le credenziali dell'admin di bootstrap nei valori, **l'API si avvia con l'admin già creato**: nessun Job aggiuntivo da eseguire.

Il chart **non** include un Job Alembic separato; l'edizione precedente di questa pagina ne descriveva uno che non esisteva. Le migrazioni sono legate al ciclo di vita del pod dell'API. Per osservarle:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Durante un upgrade, l'eliminazione del pod dell'API riesegue la migrazione (alembic è idempotente, quindi rieseguirla su un DB invariato è un no-op).

Se NON hai fornito `install.bootstrapAdmin.password` nei valori, imposta la password dell'admin dopo l'installazione:

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password <admin-email>
```

In modalità di autenticazione `proxy`, gli endpoint delle password non sono montati. **Il provisioning JIT degli utenti alla prima richiesta autenticata non è implementato in V1**: devi inizializzare manualmente il primo utente MSSP (ad esempio, tramite `kubectl exec` sul pod dell'API e un `INSERT` SQL diretto sulla tabella `users`) prima che qualsiasi richiesta autenticata via proxy possa avere successo. Un vero percorso JIT è nella roadmap.

## Verifica l'installazione

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace soctalk-system
```

Accedi su `https://mssp.your-mssp.example` con l'admin di bootstrap. Dovresti arrivare sulla dashboard MSSP:

![MSSP dashboard](/screenshots/mssp-dashboard.png)

Per un tour di ogni schermata che vedrai da qui in avanti, leggi il [Tour dell'interfaccia MSSP](/it-it/mssp-ui).

## Onboarding del primo cliente

Nell'interfaccia MSSP vai su **Tenants → New tenant**. Il modulo di onboarding raccoglie: slug, nome visualizzato, profilo (`poc` | `persistent` | `provided`), email di contatto, branding e URL base LLM + override del modello opzionali. Gli inviti customer-viewer **non** sono nel modulo, vengono configurati dopo che il tenant raggiunge lo stato `active`. Il provisioning viene eseguito in modo asincrono; aggiorna la pagina di dettaglio per vedere comparire i nuovi eventi del ciclo di vita nella tabella degli eventi. (Uno stream di eventi in tempo reale è nella roadmap; `/api/events/stream` esiste ma emette solo ping in questa release.) Se scegli `provided` (BYO Wazuh), il modulo richiede in aggiunta gli URL e le credenziali dell'indexer esterno + della Manager API oltre a una chiave LLM per tenant, vedi [ciclo di vita del tenant / provided](/it-it/tenant-lifecycle#provided).

![Tenants list](/screenshots/tenants-list.png)

Dopo che il tenant raggiunge lo stato `active`:

1. Aggiorna la chiave API LLM del tenant tramite **Customer → Settings → LLM**.
2. Configura l'ingress dell'agente Wazuh secondo [Ingress Wazuh](/it-it/reference/wazuh-ingress).
3. Condividi l'URL dell'interfaccia cliente e l'invito iniziale `customer_viewer` con il cliente finale.

Poi verifica:

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# Tenant namespace exists and data plane is Ready
kubectl -n tenant-<slug> get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace tenant-<slug> --verdict DROPPED
```

## Prossimi passi

- [Operazioni quotidiane](/it-it/operations) per le attività di day-2.
- [Upgrade](/it-it/upgrades) per gli upgrade a livello di installazione e per tenant.
- [Ingress Wazuh](/it-it/reference/wazuh-ingress) per l'onboarding degli agenti dei clienti.
