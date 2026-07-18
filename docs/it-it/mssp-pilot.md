# Pilot MSSP: fai da te

::: tip La maggior parte dei pilot dovrebbe usare Launchpad
[**Launchpad**](/it-it/launchpad) automatizza l'intero rollout — stessa installazione, stessi chart, stesso flusso Tailscale — con un singolo comando (~15-25 min, per lo più in attesa dei download, contro ~2 ore fatte a mano). **Parti da lì.** Ricorri a questa guida fai da te quando vuoi comprendere ogni passaggio, stai risolvendo problemi di un'esecuzione di Launchpad, oppure il tuo ambiente non può eseguire Launchpad — air-gapped, DNS split-horizon on-prem, un substrato non supportato o un cluster esistente.
:::

Un percorso pratico per gli MSSP che valutano SocTalk con 1-3 dei loro clienti. Due ambienti on-premise (uno per il control plane MSSP, uno per ogni tenant), collegati da una mesh VPN firewall-friendly. Stato finale: un'installazione SocTalk multi-tenant funzionante, l'analista SOC AI che risponde a domande sui dati Wazuh reali di ciascun tenant e uno screenshot da mostrare ai tuoi stakeholder.

**Non è un'installazione di produzione.** Nessuna HA, nessun TLS reale, il tuo hostname tailnet fa da ingress. Quando sei pronto per la produzione, consulta [Installazione](/it-it/install).

**Vuoi provare SocTalk da solo prima?** Parti da [Quickstart VM](/it-it/quickstart-vm): singola macchina, singolo tenant, ~10 minuti.

::: tip Tempo pratico
| Lato | Pratico | Tempo reale |
|---|---|---|
| MSSP (una volta) | ~45 min | ~60 min |
| Ogni tenant (1-3 di essi) | ~30 min per tenant | ~45 min per tenant |
| Demo + verifica | ~10 min | ~10 min |
:::

## Cosa rientra nel perimetro

- 1 control plane MSSP + 1-3 tenant
- Entrambi gli ambienti **on-premise**, qualsiasi hypervisor che esegue Ubuntu 24.04 (vSphere / Proxmox / Hyper-V / KVM / VirtualBox / bare metal)
- [Tailscale](https://tailscale.com) come mesh VPN. Headscale, NetBird o qualsiasi mesh WireGuard funzionano allo stesso modo; Tailscale è ciò che i comandi seguenti assumono a livello sintattico.
- Il control plane SocTalk L1 dell'MSSP + il cloud-agent SocTalk L2 su ciascun tenant
- Wazuh **già installato** OPPURE **installato via chart** per tenant; entrambi supportati

<!-- screenshot: arch-overview.svg — architecture diagram (MSSP VM left, tenant VMs right, tailnet wrapping both, cloud-agent shown on each tenant, optional dotted-line to existing Wazuh) -->

## 0. Prima di iniziare

Raccogli questi elementi. Ti verranno richiesti tutti nei prossimi 90 minuti:

- [ ] Hypervisor + login amministratore per il lato MSSP
- [ ] Hypervisor + login amministratore per tenant (uno per cliente pilot)
- [ ] Un account Tailscale ([registrati](https://login.tailscale.com/start); il piano gratuito gestisce bene un pilot)
- [ ] Una chiave API LLM (Anthropic o OpenAI). Per un'opzione air-gapped o sensibile alla sovranità, consulta [Integrazione Ollama](/it-it/integrate/ollama).
- [ ] Un contatto per tenant (nome, email, ha Wazuh esistente? sì/no)
- [ ] Se un tenant ha Wazuh esistente: **due** set di credenziali, uno per il Wazuh Indexer (`:9200`, autenticazione Basic) e uno per la Wazuh Manager API (`:55000`, utente abilitato a coniare JWT)

## 1. Configura il tailnet

Il control plane MSSP e ogni tenant si uniscono allo stesso tailnet. Il tailnet fornisce hostname stabili (così il cloud-agent chiama un nome, non un IP) e ACL (così i tenant non possono raggiungersi tra loro).

### 1.1 Tag

Definisci un tag per l'MSSP e uno per tenant nella UI di amministrazione Tailscale sotto **Access Controls** → **Tags**:

```json
"tagOwners": {
  "tag:mssp":         ["autogroup:admin"],
  "tag:tenant-acme":  ["autogroup:admin"],
  "tag:tenant-globex":["autogroup:admin"]
}
```

Aggiungi un tag per ogni tenant del pilot. I tag sono il modo in cui l'ACL impedisce ai tenant di raggiungersi tra loro.

### 1.2 ACL

Incolla questa sezione in **Access Controls** → **Access Controls (JSON)**. Adatta l'elenco dei tag tenant per corrispondere al tuo pilot.

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

La prima regola consente ai **tuoi dispositivi operatore** (il tuo laptop, qualsiasi nodo untagged di proprietà dell'amministratore sul tailnet) di raggiungere la UI MSSP. Senza di essa, il default-deny di Tailscale blocca il tuo stesso browser. La seconda regola consente all'MSSP di raggiungere ciascun tenant per le chiamate agli strumenti di chat (Wazuh API, observability). La terza consente al cloud-agent di ciascun tenant di raggiungere l'endpoint HTTPS dell'MSSP per registrarsi e trasmettere eventi. I tenant non possono raggiungersi tra loro.

Verifica nel pannello ACL Preview prima di salvare. Conferma che `tag:tenant-acme` non possa raggiungere `tag:tenant-globex` su nessuna porta.

<!-- screenshot: tailscale-acl-preview.png — ACL preview showing tenant-to-tenant denied, MSSP→tenant + tenant→MSSP allowed -->

### 1.3 Chiavi di autenticazione

Sotto **Settings** → **Keys**, genera:

- Una chiave di autenticazione **riutilizzabile** con tag `tag:mssp` per il control plane MSSP.
- Una chiave di autenticazione **effimera** per tenant con tag `tag:tenant-<slug>`. Imposta il TTL alla durata del tuo pilot (es. 90 giorni).

Annotale in un luogo sicuro; le incollerai quando ogni VM si unisce al tailnet.

### 1.4 Requisiti di rete

Tailscale necessita solo di egress (mai inbound) da ciascun nodo:

- **Percorso diretto** (quando entrambi i peer possono attraversare il NAT): WireGuard su UDP su una porta alta casuale. La maggior parte delle reti lo consente già.
- **Fallback DERP** (quando l'attraversamento NAT fallisce, es. firewall rigidi o double-NAT): TCP/443 verso i relay DERP di Tailscale. La maggior parte dei pilot usa questo percorso poiché appare come normale traffico HTTPS.

Se il tuo firewall consente HTTPS in uscita, sei a posto. Nessuna modifica alle regole inbound da nessuna parte.

## 2. Lato MSSP: predisponi il control plane

Il control plane MSSP è una singola VM SocTalk, la stessa che installa [Quickstart VM](/it-it/quickstart-vm). Usiamo quel tutorial come base e aggiungiamo l'adesione al tailnet.

### 2.1 Provisioning e installazione

Segui [Quickstart VM](/it-it/quickstart-vm) **passaggi da 1 a 5** (download, boot, ottieni il token di setup, apri il wizard, accedi). Quando il wizard chiede l'**Hostname**, lascialo vuoto per ora. Lo imposterai all'hostname del tailnet nel §2.3.

Fermati quando hai raggiunto la dashboard MSSP. **Nota:** il flusso Quickstart effettua automaticamente l'onboarding di un tenant chiamato `demo` al primo avvio. Vedrai un tenant già presente nel tuo elenco; è previsto. Puoi lasciarlo (e ignorarlo nel §5) oppure dismetterlo dalla dashboard prima di aggiungere i tuoi tenant pilot reali:

```text
Tenants → demo → Decommission
```

Entrambe le scelte vanno bene; sii solo consapevole così da non confonderti quando `list all tenants` nel §5 restituisce più tenant del conteggio del tuo pilot.

<!-- screenshot: mssp-dashboard-after-install.png — MSSP dashboard immediately after wizard install, showing the auto-onboarded demo tenant -->

### 2.2 Metti in sicurezza la macchina

::: danger Obbligatorio prima del passaggio successivo
Le immagini disco scaricabili includono un utente SSH `ubuntu:packer` creato in fase di build. **Non connettere la VM al tuo tailnet finché non l'hai messa in sicurezza.** Consulta [Accesso SSH + credenziali](/it-it/quickstart-vm#ssh-access-credentials) per la spiegazione completa e i comandi di hardening.

Minimo:
```bash
sudo passwd -l ubuntu
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```
:::

### 2.3 Installa Tailscale, unisciti al tailnet

Accedi via SSH come `ops` (l'utente creato dal seed cloud-init durante la tua installazione [Quickstart VM](/it-it/quickstart-vm); **non** l'utente `ubuntu` creato in fase di build che il §2.2 ha appena bloccato):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-mssp-... --advertise-tags=tag:mssp --hostname=soctalk-mssp
```

Conferma l'hostname tailnet assegnato:

```bash
tailscale status | head -1
# example: 100.64.10.5   soctalk-mssp        ops          linux   active; direct
```

Il tuo hostname MSSP è `soctalk-mssp.<your-tailnet>.ts.net`. Annotalo; tutto ciò che segue lo utilizza.

### 2.4 Vincola l'ingress di SocTalk all'hostname del tailnet

Modifica i values distribuiti per impostare l'hostname:

```bash
sudo nano /etc/soctalk/values.yaml
```

Cambia `ingress.hostnames.mssp` e `ingress.hostnames.customer` con il tuo hostname tailnet (es. `soctalk-mssp.taila1b2c3.ts.net`), poi ridistribuisci:

```bash
sudo helm upgrade soctalk-system /opt/soctalk/charts/soctalk-system \
  -n soctalk-system -f /etc/soctalk/values.yaml
```

Riferimento dei campi per `values.yaml`: consulta [Setup wizard](/it-it/setup-wizard); il wizard scrive lo stesso file.

### 2.5 Verifica

Da qualsiasi altro dispositivo del tailnet (il tuo laptop operatore va bene; l'ACL del §1.2 consente `autogroup:admin → tag:mssp:443`):

```bash
curl -k https://soctalk-mssp.<your-tailnet>.ts.net/health/ready
# expected: 200 OK
```

Accedi alla dashboard su `https://soctalk-mssp.<your-tailnet>.ts.net/` con le credenziali admin del §2.1. Dovresti arrivare alla vista fleet cross-tenant dell'MSSP: la striscia KPI in alto (Pending Reviews / Stuck Cases / Degraded Tenants / Repeated IOCs), la coda di indagini per tenant e la tabella di salute dei tenant.

![Dashboard MSSP: vista fleet cross-tenant](/screenshots/mssp-dashboard.png)

## 3. Onboarding di ciascun tenant: emetti la registrazione dell'agent

Per ogni tenant del tuo pilot, farai questo nella dashboard MSSP, poi consegnerai il risultato all'operatore del tenant.

### 3.1 Esegui il wizard Create Customer

Nella dashboard MSSP, fai clic su **Tenants** nella barra laterale sinistra, poi su **New tenant** in cima alla pagina dell'elenco. Questo apre il wizard **Create Customer**. Per i profili `poc` e `persistent` sono 4 passaggi (Identity → Profile → Branding → Review); per `provided` sono 5 (un passaggio **External SIEM** compare tra Profile e Branding).

::: tip Raccogli le informazioni del tenant in anticipo
Per i tenant con profilo `provided`, il wizard richiede le **credenziali Wazuh esistenti** del tenant al passaggio 3. Ottienile dal tuo contatto tenant (out-of-band, sullo stesso canale sicuro del §3.3) **prima** di avviare il wizard così da non lasciare in sospeso un form compilato a metà. Per `poc` / `persistent` ti servono solo le informazioni di base.
:::

#### Passaggio 1: Identity

- **Display name**: es. `Acme Corp`
- **Slug**: breve, minuscolo, separato da trattini (3–32 caratteri, validato `[a-z0-9-]+`). **Deve corrispondere** al tag tailnet del §1.1 (così `tag:tenant-acme` → slug `acme`). I passaggi successivi sostituiscono lo slug direttamente in `tag:tenant-<slug>` per la chiave di autenticazione (§3.3) e il comando `tailscale up` del tenant (§4.2 / §4.7a); una mancata corrispondenza significa che il nodo del tenant annuncia un tag che le tue ACL del §1.2 non concedono.
- **Contact email**

![Create Customer: passaggio Identity](/screenshots/mssp-add-tenant-step1-identity.png)

#### Passaggio 2: Profile

Scegli una delle tre opzioni radio. L'API valida rispetto a `poc | persistent | provided`:

- **PoC**: il chart installa Wazuh + un simulatore linux-ep sul cluster del tenant, con storage `local-path` e budget di risorse ridotti. Scegli questo per pilot di breve durata dove il tenant non ha Wazuh esistente. Consulta [ciclo di vita del tenant / poc](/it-it/tenant-lifecycle#poc).
- **Persistent**: stessa forma con Wazuh incluso di `poc`, ma dimensionato per carico di produzione sostenuto con la StorageClass predefinita del cluster e i range di risorse completi del chart. Consulta [ciclo di vita del tenant / persistent](/it-it/tenant-lifecycle#persistent).
- **Provided (porta il tuo Wazuh)**: il chart installa solo l'adapter SocTalk; lo punti al Wazuh esistente del tenant tramite il passaggio **External SIEM** (sotto). Consulta [ciclo di vita del tenant / provided](/it-it/tenant-lifecycle#provided).

C'è una sezione a scomparsa **LLM (advanced)** nello stesso passaggio per sovrascrivere il provider LLM condiviso dell'installazione, la base URL, la chiave e (opzionalmente) gli ID dei modelli Fast / Thinking. Per `poc` / `persistent` è opzionale; lasciala collassata per ereditare i default dell'installazione. Per `provided` le credenziali LLM sono **obbligatorie** (non c'è fallback condiviso dell'installazione) e bloccano il passaggio.

![Create Customer: passaggio Profile](/screenshots/mssp-add-tenant-step2-profile.png)

::: warning La scelta del profilo è permanente
Cambiare il profilo dopo che il tenant è stato provisionato richiede di dismetterlo e rifare l'onboarding. Conferma con il tuo contatto tenant prima di inviare.
:::

#### Passaggio 3: External SIEM (solo provided)

Questo passaggio è nascosto a meno che tu non abbia scelto Provided al passaggio 2. Compila due coppie endpoint + credenziali:

- **Wazuh Indexer URL** (es. `https://wazuh.acme.example:9200`) + utente indexer + password indexer (autenticazione Basic)
- **Wazuh Manager API URL** (es. `https://wazuh.acme.example:55000`) + utente API + password API (usati per coniare JWT)

Questi devono essere raggiungibili dalla VM del tenant che predisporrai nel §4. Il controller lato MSSP trasforma le URL in una allow-list di egress FQDN Cilium sul namespace del tenant; l'adapter non raggiunge mai Wazuh direttamente dal tuo cluster MSSP.

Fai un controllo di sanità delle credenziali del manager dalla VM MSSP prima di inviare:

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (long base64 string)
```

Se questo restituisce 200, gli strumenti di chat del tenant si risolveranno una volta completato il §4.

#### Passaggio 4 (o 3 per poc/persistent): Branding

Opzionale. Display name + caricamento di un piccolo logo che compare nell'header del tenant. Puoi saltare completamente questo passaggio.

![Create Customer: passaggio Branding](/screenshots/mssp-add-tenant-step3-branding.png)

#### Passaggio finale: Review

Conferma tutto, poi fai clic su **Create**. L'API risponde 202 e vieni riportato all'elenco dei tenant; il nuovo tenant parte in `pending` e attraversa `provisioning → active`. Aggiorna la pagina di dettaglio per osservare l'accumularsi degli eventi del ciclo di vita.

![Create Customer: passaggio Review](/screenshots/mssp-add-tenant-step4-review.png)

### 3.2 Emetti il comando di registrazione dell'agent

::: warning Nessun pulsante UI (ancora)
Al momento della stesura, la pagina di dettaglio del tenant espone solo le azioni del ciclo di vita (Suspend / Resume / Retry Provisioning / Decommission). Il flusso `:issue-agent` è solo via API; guidalo da una shell sulla VM MSSP. Un pulsante dedicato **Issue Agent** è in roadmap.
:::

![Dettaglio tenant: solo azioni del ciclo di vita, nessun pulsante Issue Agent](/screenshots/mssp-tenant-detail.png)

Dalla VM MSSP, accedi una volta per ottenere un cookie di sessione, poi effettua una POST verso l'endpoint `:issue-agent` del tenant:

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

Il corpo della risposta 201 contiene un `helm_install_hint` che incolli direttamente nella shell del tenant. Appare così:

```bash
helm install soctalk-agent-acme \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token>
```

::: warning Usa l'output dell'API alla lettera
La versione del chart `0.1.x` e il bootstrap token qui sopra sono illustrativi; i valori reali provengono dalla tua risposta `:issue-agent`. Non ridigitare il comando helm; copia il campo `helm_install_hint`.
:::

::: warning TTL del bootstrap token
Il bootstrap token scade (default: 24h). Se il tenant non esegue il comando prima di allora, riemettilo verso lo stesso endpoint `:issue-agent`. La riemissione revoca qualsiasi token precedente non consumato.
:::

### 3.3 Consegna al contatto del tenant

L'operatore del tenant ha bisogno di **due** cose:

1. Il **comando helm** del §3.2 (sopra). Copialo come un unico blocco.
2. La **chiave di autenticazione Tailscale con tag tenant** che hai generato nel §1.3.

Invia questi elementi tramite un password manager condiviso (1Password, Bitwarden, Vaultwarden, qualsiasi soluzione con cifratura end-to-end). Non incollare nessuno dei due in un canale Slack pubblico né inviarli via email non cifrati.

::: info In arrivo
Il [SocTalk Launchpad](https://github.com/soctalk/soctalk) (in fase di design) genererà un singolo bundle firmato che il tenant incolla nel proprio wizard di setup, automatizzando questa consegna. Per ora è un copia-incolla manuale.
:::

### 3.4 Coordinare le credenziali Wazuh esterne per i tenant `provided`

::: tip Salta questa sezione se hai scelto `poc` o `persistent` nel §3.1
Quei profili sono autosufficienti: il chart installa il proprio Wazuh; nulla d'altro da fare sul lato MSSP. Salta al §4.
:::

Per i tenant con profilo `provided` il wizard **ha già raccolto** le credenziali External SIEM al passaggio 3 del §3.1, quindi quando il tenant raggiunge `active` l'adapter è configurato. L'unico lavoro out-of-band è a monte del §3.1: ottenere le credenziali dal tenant in primo luogo.

Sequenza:

1. **Prima del §3.1**, chiedi al tuo contatto tenant:
   - Wazuh Indexer URL + utente + password (autenticazione Basic usata dall'adapter per `_search`)
   - Wazuh Manager API URL + utente + password (usati per coniare JWT)
   - Una decisione sulla raggiungibilità: il loro Wazuh è sullo stesso tailnet della VM del tenant che predisporrai nel §4? In caso contrario, dovranno usare `--advertise-routes` dal §4.2 (vedi §4.7a per il menu).
2. Seguono il §4.7a dal loro lato per confermare la raggiungibilità.
3. Ti inviano entrambe le coppie endpoint + credenziali (password manager condiviso).
4. Esegui il §3.1 con **Provided** al passaggio 2 e incolli le credenziali al passaggio 3.

Se la situazione di raggiungibilità del tenant cambia dopo il §3.1 (es. spostano Wazuh su un host diverso), aggiorna il pannello External SIEM nella pagina di dettaglio del tenant. Il controller recepisce la modifica alla successiva riconciliazione (~30 s).

## 4. Lato tenant: predisponi il data plane

Questa sezione è autosufficiente per i contatti IT del tenant. **Se sei un operatore tenant e il tuo MSSP ti ha inviato un comando helm + una chiave di autenticazione Tailscale, puoi partire da qui.** Dai una scorsa al §0 per il contesto, poi segui questa sezione.

### 4.1 Provisioning di una VM Linux

Ti servirà una VM Ubuntu 24.04 LTS, minimo 4 vCPU / 8 GB RAM / 60 GB di disco, con accesso a internet in uscita. Effettuane il provisioning tramite il tuo normale processo IT. Funziona qualsiasi hypervisor che esegue Ubuntu (vSphere, Proxmox, Hyper-V, KVM, VirtualBox, bare metal). Se preferisci usare un'immagine SocTalk preconfezionata, consulta [Quickstart VM passaggio 1](/it-it/quickstart-vm#_1-download) per i link alle immagini disco e i passaggi di importazione per hypervisor; torna qui al §4.2.

### 4.2 Metti in sicurezza la macchina

::: warning
Se hai usato l'immagine SocTalk preconfezionata, segui [Accesso SSH + credenziali](/it-it/quickstart-vm#ssh-access-credentials) prima di connetterti al tuo tailnet. Se hai effettuato il provisioning di una VM Ubuntu generica tramite la tua pipeline IT, si applica già il tuo hardening standard del sistema operativo.
:::

### 4.3 Installa Tailscale, unisciti al tailnet

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-tenant-... --advertise-tags=tag:tenant-<slug> --hostname=soctalk-tenant-<slug>
```

Usa la chiave di autenticazione dalla consegna del tuo MSSP (§3.3). Verifica:

```bash
tailscale ping soctalk-mssp.<tailnet>.ts.net
# expected: pong from the MSSP control plane
```

Se il `ping` fallisce, controlla l'elenco delle macchine nella UI di amministrazione Tailscale. Assicurati che la macchina MSSP sia online e che l'anteprima ACL mostri che il tuo tag tenant può raggiungere `tag:mssp`.

### 4.4 Installa k3s + Helm

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644" sh -
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

Verifica che k3s sia partito:

```bash
kubectl get nodes
# expected: one node, status Ready
```

### 4.5 Disabilita le NetworkPolicy lato tenant

::: danger Obbligatorio prima del passaggio successivo
Il chart `soctalk-cloud-agent` e il chart del tenant includono NetworkPolicy che assumono le policy FQDN di Cilium. Il k3s vanilla non ha le CRD di Cilium, quindi le policy bloccano l'egress legittimo dall'agent verso l'MSSP. Disabilita le NetworkPolicy del chart prima dell'installazione helm nel §4.6.

Il percorso più semplice: aggiungi `--set networkPolicies.enabled=false` al tuo comando helm.

Se il tuo cluster tenant necessita di isolamento di rete, applicalo a livello del firewall host (l'ACL del tailnet del §1.2 fornisce già l'isolamento MSSP↔tenant).
:::

### 4.6 Esegui il comando helm dal tuo MSSP

Incolla il comando del §3.2, aggiungendo `--set networkPolicies.enabled=false` come da §4.5:

```bash
helm install soctalk-agent-<slug> \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token> \
  --set networkPolicies.enabled=false
```

::: tip Certificato MSSP self-signed? Imposta insecureTLS
Se la tua installazione MSSP non ha ancora provisionato un certificato TLS reale per l'hostname del tailnet (cert-manager lato chart non collegato, oppure sei dietro Tailscale e lo tratti come il confine di fiducia), aggiungi `--set insecureTLS=true` al comando helm. L'agent salterà la verifica del certificato su `controlPlaneUrl`; Tailscale gestisce comunque la cifratura del trasporto. Disattivato per default; imposta questo solo quando ti fidi della rete sottostante.
:::

Il cloud-agent si installa nel namespace `soctalk-agent`, chiama il control plane tramite il tailnet, si registra, e da lì il controller MSSP guida l'installazione del chart del tenant su questo stesso cluster.

Osserva l'avvio dell'agent:

```bash
kubectl -n soctalk-agent logs deploy/soctalk-cloud-agent -f
# look for: agent_registered installation_id=...
```

Quando `agent_registered` compare nei log, l'agent ha comunicato con successo con l'MSSP.

### 4.7 Wazuh: esistente o nuovo?

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

### 4.8 Checkpoint: due stati da monitorare

Il tenant attraversa due stati di readiness distinti. Non confonderli:

#### 4.8a Cloud agent registrato (~1 minuto dopo il §4.6)

Rientra nella dashboard MSSP. Il tuo tenant passa a **Online** entro 1-2 minuti dal successo del §4.6. Questo significa che **il cloud-agent ha raggiunto l'MSSP e si è registrato**: l'handshake di fiducia è completato.

Non significa ancora che lo stack Wazuh del tenant sia attivo né che gli strumenti di chat risolveranno le query contro questo tenant.

![Dashboard MSSP: tenant passato a Online](/screenshots/mssp-dashboard-tenant-online.png)

#### 4.8b Data plane del tenant completamente pronto (~5-7 minuti in più)

Dopo la registrazione dell'agent, il controller MSSP guida l'installazione del chart del tenant sul cluster del tenant:

- **profilo `poc`**: Wazuh + simulatore linux-ep si avviano. Tempo reale ~5-7 minuti.
- **profilo `provided`**: l'adapter SocTalk si avvia immediatamente. Le chiamate agli strumenti di chat Wazuh si risolvono non appena l'adapter raggiunge gli endpoint External SIEM che l'MSSP ha fornito al passaggio 3 del §3.1. In caso contrario, verifica la raggiungibilità come da §3.4.

Osserva dalla VM del tenant:

```bash
kubectl -n tenant-<slug> get pods -w
# poc profile: wait until wazuh-manager-0, wazuh-indexer-0, linux-ep-N all Ready
# provided profile: wait until soctalk-adapter is Ready
```

Solo dopo il §4.8b il tenant è pronto per la demo del §5. Se il §4.8a si attiva ma il §4.8b non si completa mai, consulta [Risoluzione problemi del pilot](#_7-pilot-troubleshooting).

## 5. Il momento della demo

Il momento rivolto agli stakeholder. Riproduci queste query alla lettera; la formulazione determina quale strumento sceglie l'LLM.

Accedi alla dashboard MSSP. Apri la scheda **Chat**.

**Query 1. Conferma che il tenant sia raggiungibile.**

```text
list all tenants
```

Atteso: un badge di strumento `list_tenants`, poi una risposta che elenca i tuoi tenant pilot per slug + display name.

![Chat: badge strumento list_tenants + risposta](/screenshots/chat-list-tenants.png)

**Query 2. Mostra gli alert da uno specifico tenant.**

```text
show me the 5 most recent alerts at <tenant-slug> with rule ids
```

Atteso: un badge di strumento `recent_alerts` con un chip `@ <tenant-slug>`, poi un riepilogo in linguaggio naturale che elenca rule ID, severità e timestamp.

::: tip Questo è lo screenshot per gli stakeholder
Il chip `@ <tenant-slug>` sul badge dello strumento è la prova: l'analista SOC AI di SocTalk sta accedendo agli alert Wazuh inoltrati del tenant e rispondendo a una domanda su dati reali. Cattura questa schermata.
:::

![Chat: recent_alerts @ acme con rule ID + analisi LLM](/screenshots/chat-wazuh-alerts.png)

::: info Perché `recent_alerts` e non `get_wazuh_alert_summary`?
Il profilo `poc` del pilot porta Wazuh nel cluster del tenant e l'adapter SocTalk inoltra gli alert (soggetti a una severità minima, configurabile tramite `SOCTALK_ADAPTER_MIN_SEVERITY`) al database MSSP. `recent_alerts` legge da quel flusso inoltrato, quindi funziona indipendentemente dal fatto che l'MSSP possa raggiungere direttamente la Wazuh API del tenant. `get_wazuh_alert_summary` è la controparte a integrazione live, utile per il profilo `provided` quando l'MSSP detiene la URL + le credenziali Wazuh del tenant in **Integrations**.
:::

Se l'elenco degli alert è vuoto (il Wazuh del tenant non ha ancora visto traffico), genera alert di test. Il percorso Wazuh installato via chart (§4.7b) include uno o più pod `linux-ep-N` con il simulatore di attacchi; attivalo sulla prima replica pronta tramite un label selector:

```bash
# On the tenant VM, against any linux-ep pod
kubectl -n tenant-<slug> exec -it \
  "$(kubectl -n tenant-<slug> get pod -l app=linux-ep -o jsonpath='{.items[0].metadata.name}')" \
  -- /opt/scripts/run-attack.sh
```

Attendi 30-60 secondi e riesegui la query di chat. Per il percorso con Wazuh esistente (§4.7a), attiva gli alert come faresti normalmente sul tuo Wazuh, es. effettuando via SSH qualche tentativo con password errate su un host monitorato.

## 6. Day 2: dove andare da qui

- **Aggiungi il Wazuh reale del cliente.** Effettua l'onboarding di altri tenant ripetendo il §3 e il §4. Stesso schema; ogni nuovo tenant necessita di un nuovo tag Tailscale, una voce ACL, una chiave di autenticazione effimera e l'emissione dell'agent.
- **Pianifica l'installazione di produzione.** Quando sei pronto per andare oltre il pilot, consulta [Installazione](/it-it/install) per il percorso K3s + Cilium + cert-manager + ingress reale.
- **Operazioni sul ciclo di vita del tenant.** [Ciclo di vita del tenant](/it-it/tenant-lifecycle) copre la sospensione, la ripresa e la dismissione dei tenant dalla dashboard MSSP.
- **Aggiornamenti.** [Aggiornamenti](/it-it/upgrades) copre l'avanzamento di soctalk-system e del cloud-agent.
- **Backup.** [Backup e ripristino](/it-it/backup-restore) per i dati stateful.

### Cosa NON è nel pilot

- Alta disponibilità (singolo nodo k3s su ciascun lato)
- TLS reale (l'hostname del tailnet usa certificati self-signed; la produzione necessita di cert-manager + ingress reale)
- Multi-region
- Scala per tenant oltre ~50 agent Wazuh per tenant
- Ingress per tenant (questo pilot usa l'hostname del tailnet per tutto)

Quando migri in produzione, la configurazione del tuo prodotto MSSP (elenco tenant, cronologia chat, chiave LLM) può essere portata avanti con pianificazione. Parla con il team prima di dismettere questo pilot.

## 7. Risoluzione problemi del pilot

Tabella guidata dai sintomi per i fallimenti specifici della topologia del pilot. I problemi generici di SocTalk sono trattati in [Risoluzione problemi](/it-it/troubleshooting).

| Sintomo | Causa probabile | Verifica |
|---|---|---|
| Tenant bloccato su "Pending" nella dashboard MSSP | Bootstrap token scaduto prima dell'esecuzione del §4.6 | Riemetti dalla dashboard MSSP (§3.2); i token durano di default 24h |
| `tailscale ping soctalk-mssp.<tailnet>.ts.net` fallisce dal tenant | ACL troppo restrittiva, o macchina MSSP offline | Controlla l'anteprima ACL nella UI di amministrazione Tailscale; controlla `tailscale status` dell'MSSP |
| I log dell'agent mostrano `connection refused` verso `controlPlaneUrl` | L'`helm upgrade` lato MSSP del §2.4 non ha avuto effetto | Sulla VM MSSP: `kubectl -n soctalk-system get ingress`; conferma che l'hostname corrisponda |
| I log dell'agent mostrano `403 Forbidden` dall'MSSP | Bootstrap token già usato (one-shot) | Riemetti dal §3.2 |
| `kubectl -n soctalk-agent get pods` mostra `ImagePullBackOff` | Il cluster tenant non riesce a fare pull da `ghcr.io` (proxy aziendale) | Configura registries.yaml di k3s con il proxy; oppure fai un pre-pull sulla VM del tenant |
| La chat dice "no Wazuh alerts" ma il tenant ha alert | Caso Wazuh esistente: Manager API non raggiungibile dal tailnet MSSP | Dalla VM MSSP: `curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"` (GET; dovrebbe restituire un JWT) |
| Lo strumento `get_wazuh_alert_summary` restituisce errore | Caso Wazuh esistente: credenziali Indexer errate | Dalla VM del tenant: `curl -ku <user>:<pw> https://<wazuh-indexer>:9200/wazuh-alerts-*/_search?size=1` |
| L'heartbeat dell'adapter funziona ma l'agent non raggiunge mai "Online" | NetworkPolicy lasciate abilitate nel §4.5 | `kubectl -n soctalk-agent get networkpolicies`; dovrebbe essere vuoto |
| `helm install` rifiutato con errore di schema dei values | Disallineamento della versione del chart tra control plane e chart dell'agent | Usa la versione del chart stampata dall'endpoint issue-agent, non "latest" |

## 8. Dismissione del pilot

Quando il pilot termina:

1. **Lato tenant, per ogni tenant**: `helm uninstall soctalk-agent-<slug> -n soctalk-agent`. Spegni e archivia (o distruggi) la VM del tenant.
2. **UI di amministrazione Tailscale**: revoca la chiave di autenticazione di ciascun tenant sotto **Settings → Keys**; rimuovi ogni tag tenant da **Access Controls**.
3. **Dashboard MSSP**: per ogni tenant, **Decommission** dalla pagina di dettaglio del tenant (lo stato transita a `decommissioning` → `archived`).
4. **VM MSSP**: archivia o distruggi se non migri in produzione. Se migri, consulta [Installazione](/it-it/install) per il percorso del cluster di produzione.

Conserva questi artefatti per la revisione post-pilot:

- Il log di audit da ciascuna pagina di dettaglio del tenant (scaricabile)
- Il tuo `values.yaml` compilato del §2.4
- La sezione ACL Tailscale del §1.2
- Gli screenshot del §5
