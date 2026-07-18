# Ingress degli agenti Wazuh ed enrollment dei certificati


## Problema

Ogni tenant dispone di un Wazuh manager dedicato in esecuzione nel namespace `tenant-<slug>`. Gli agenti Wazuh sono installati sugli endpoint del cliente (esterni al cluster dell'MSSP) e devono connettersi al Wazuh manager **del proprio tenant** su:

- **1514/TCP**: stream degli eventi dell'agente (cifrato con il protocollo nativo di Wazuh su TLS)
- **1515/TCP**: enrollment dell'agente / `authd` (registrazione tramite segreto condiviso)

Vincoli:

- Molti tenant su un unico cluster → non è possibile esporre 1514/1515 su un singolo NodePort (collisione di porte).
- Gli agenti devono raggiungere esclusivamente il manager del *proprio* tenant (non quello di un altro tenant).
- Gli endpoint dei clienti si trovano su reti sconosciute (LAN aziendale, VM cloud, laptop): connettività via internet pubblica nella maggior parte dei casi.
- I certificati TLS devono essere specifici per tenant (catena di attendibilità limitata al singolo cliente).

## Pattern adottato: indirizzo per-tenant all'edge dell'MSSP

Ogni tenant riceve un nome DNS dedicato (`acme.soc.mssp.example.com`) che risolve in un endpoint L4 per-tenant all'edge dell'MSSP. L'instradamento verso il Wazuh manager corretto avviene per indirizzo di destinazione, non tramite ispezione dell'hostname.

**Perché non l'instradamento L4 basato su SNI.** Il protocollo agente di Wazuh su 1514/TCP è uno stream proprietario cifrato in AES, non TLS standard, quindi le connessioni non trasportano un ClientHello SNI. Un proxy L4 che si dirama su `req.ssl_sni` non ne troverà uno e il traffico dell'agente ricade sul backend di default. Il canale di enrollment 1515/TCP negozia effettivamente il TLS, ma l'instradamento deve usare lo stesso discriminatore di 1514, altrimenti le due porte divergono.

Sono supportate due implementazioni dell'indirizzamento per-tenant:

1. **Service LoadBalancer per-tenant (pattern raccomandato; non ancora integrato nel chart).** L'attuale subchart `wazuh` crea il `Service` del Wazuh manager solo come `ClusterIP`: in questa release **non è previsto alcun provisioning automatico di LoadBalancer o DNS**. Per rendere oggi un tenant instradabile dall'internet pubblica, devi in alternativa: sovrapporre tu stesso un Service LoadBalancer esterno (`kubectl apply` manuale), collocare ciascun tenant dietro un HAProxy / NGINX di edge con SNI o mappatura di porta per-tenant, oppure usare la topologia per-porta descritta più avanti. LB cloud + DNS per-tenant è la destinazione documentata; arrivarci richiede un cablaggio manuale lato MSSP.
2. **Porta per-tenant su un singolo IP di edge (fallback).** Quando gli IP univoci sono scarsi, alloca un intervallo di porte su un unico IP di edge e assegna gli offset `(1514, 1515)` per tenant (ad es. acme → 15140/15141, beta → 15142/15143). Il DNS usa record `SRV` o la configurazione `manager_address:port` dell'agente per il dispatch. Operativamente scomodo ma funzionante.

### Topologia

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

Record `A`/`AAAA` per-tenant: `<slug>.soc.mssp.example.com → <tenant LB IP>` è il design di riferimento. **In V1, SocTalk NON emette record DNS** — l'operatore gestisce il DNS manualmente (external-dns / console del provider) una volta che l'LB per-tenant è stato provisionato out-of-band. Un percorso di emissione DNS pilotato da SocTalk (annotazioni external-dns o integrazione diretta con il provider) è in roadmap.

Il DNS wildcard non funziona con il pattern LoadBalancer perché ogni tenant ha il proprio IP. Funziona solo con la topologia di fallback (porta per-tenant), in cui ogni nome risolve nello stesso IP di edge.

### Certificati TLS

Ogni tenant riceve un certificato il cui SAN copre `<slug>.soc.mssp.example.com`. Opzioni:

- **Certificato per-tenant tramite cert-manager + Let's Encrypt** (raccomandato per l'MVP): CR `Certificate` di cert-manager per tenant, emesso da un `ClusterIssuer` DNS-01 o HTTP-01: certificato memorizzato nel ns `tenant-<slug>` come `Secret/wazuh-tls`: rinnovato automaticamente.
- **Certificato wildcard per `*.soc.mssp.example.com`**: un unico certificato copre tutti i tenant. Più semplice, ma significa che il Wazuh manager di un qualsiasi tenant può presentare il certificato per l'agente di un qualsiasi altro tenant durante i guasti del proxy lato MSSP: rischio accettabile per questa release dato che l'instradamento è l'effettivo meccanismo di enforcement.
- **CA interna fornita dall'MSSP**: per gli MSSP che gestiscono una propria PKI, cert-manager può emettere da un `Issuer` in-cluster basato sulla CA dell'MSSP.

La guida di installazione documenta tutte e tre le opzioni; il pilota usa di default Let's Encrypt per-tenant.

### Provisioning del LoadBalancer

L'MSSP esegue una tra le seguenti opzioni:

| Ambiente | Sorgente del LoadBalancer |
|---|---|
| Cloud gestito (EKS, GKE, AKS, …) | Il controller di load-balancer del cloud assegna un IP pubblico per ogni `Service` di tipo `LoadBalancer`. |
| Bare-metal o on-prem | MetalLB (modalità L2 o BGP) con un pool di indirizzi, oppure kube-vip. |
| Edge a IP singolo con mappatura di porta | Esegui un proxy L4 esterno (HAProxy, Envoy, nginx-stream) che inoltra le coppie `(IP, port)` al `Service` del tenant. Usalo solo con la topologia per-porta di fallback. |

Il design di riferimento prevede che il `Service` del chart `soctalk-tenant` sia annotato in modo che i controller cloud e MetalLB possano applicare la selezione di pool/classe di IP (ad es. `metallb.universe.tf/address-pool: wazuh-agents`), e che il controller SocTalk registri l'IP LB risultante e scriva il record DNS per-tenant. **In V1 nessuno di questi è integrato** — il Service del Wazuh manager è solo `ClusterIP` e il controller non effettua polling per l'assegnazione dell'IP LB.

Se devi usare un singolo IP di edge (fallback), una mappatura HAProxy di riferimento ha questo aspetto:

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

Non diramare su `req.ssl_sni` per Wazuh 1514. Il protocollo agente di Wazuh non è TLS standard e non produce mai un ClientHello su quella porta. L'SNI è disponibile solo su 1515 (enrollment), il che è insufficiente — gli eventi avrebbero comunque bisogno di un discriminatore funzionante.

## Flusso di enrollment dell'agente

La registrazione `authd` di Wazuh su 1515/TCP richiede un segreto condiviso. Ogni tenant ha il proprio segreto `authd`, memorizzato in `Secret/wazuh-<slug>-wazuh-creds` (chiave: `AUTHD_PASS`) nel namespace del tenant. Enrollment:

1. **L'operatore MSSP** effettua l'onboarding di un nuovo cliente. SocTalk genera il segreto condiviso `authd` al momento del provisioning del tenant.
2. **L'operatore MSSP** fornisce all'amministratore dell'endpoint del cliente:
   - Hostname del Wazuh manager del tenant (`acme.soc.mssp.example.com`)
   - Porte (1514 eventi, 1515 enrollment)
   - Segreto condiviso `authd` (tramite canale sicuro: piattaforma di gestione dei segreti, email cifrata, qualunque cosa usi l'MSSP)
   - Installer dell'agente Wazuh (pacchetto upstream standard)
3. **L'amministratore dell'endpoint del cliente** installa l'agente Wazuh con l'hostname ed effettua l'enrollment:
   ```bash
   /var/ossec/bin/agent-auth \
       -m acme.soc.mssp.example.com \
       -P "<authd-shared-secret>"
   ```
4. L'agente si registra con il manager del tenant e riceve il proprio certificato per-agente.
5. Le connessioni successive su 1514 sono mTLS per-agente.

L'instradamento su 1515 usa lo stesso indirizzo per-tenant di 1514 (IP LB o porta di edge). Il segreto condiviso `authd` è limitato al tenant: un agente che usa il segreto di `acme` può registrarsi solo con il manager di `acme` — è l'indirizzamento a imporlo, e il segreto è verificato dal manager.

## Requisiti di firewall / rete

Lato MSSP:
- IP pubblici per il proxy di edge (un IP, oppure IP per-regione per gli MSSP con regioni MSSP distribuite geograficamente).
- Il proxy di edge consente il traffico in ingresso 1514/TCP, 1515/TCP da 0.0.0.0/0 (oppure CIDR specifici del cliente se l'MSSP preferisce).
- Il firewall interno al cluster (intervallo NodePort o CIDR interno) consente proxy di edge → Wazuh manager nel namespace del tenant.

Lato cliente:
- Gli agenti consentono il traffico in uscita 1514/1515/TCP verso l'hostname di edge dell'MSSP.
- Nessun traffico in ingresso dall'MSSP verso gli endpoint del cliente (Wazuh è pull-less: gli eventi originano dall'agente).

## Revoca dei certificati / rimozione degli agenti

> **Stato UI:** la scheda Agents per-tenant descritta di seguito è pianificata. Fino al suo rilascio, usa la soluzione alternativa alla fine di questa sezione.

Per revocare un agente specifico (UX pianificata):
1. L'operatore MSSP apre il tenant nella UI MSSP → scheda Agents → revoca.
2. SocTalk chiama l'API del Wazuh manager per rimuovere la registrazione dell'agente.
3. L'amministratore dell'endpoint del cliente disinstalla l'agente (opzionale, per pulizia).

**Oggi**, revoca direttamente dalla dashboard Wazuh integrata (elenco Tenant → **Open SOC** → Agents) oppure tramite l'API del Wazuh manager:

```bash
kubectl -n tenant-<slug> exec deploy/wazuh-manager -- \
  /var/ossec/bin/manage_agents -r <agent-id>
```

Per revocare tutti gli agenti di un tenant (ad es. offboarding del cliente):
1. Ruota il segreto condiviso `authd` del tenant (ri-enrollment richiesto per i nuovi agenti).
2. Elimina tutte le registrazioni degli agenti esistenti tramite l'API Wazuh.
3. La dismissione del tenant alla fine smantella il manager.

## Pattern di connettività alternativi (documentati, non implementati)

### VPN / tunnel gestito dal cliente

Se la policy di rete di un cliente vieta agli agenti di inviare telemetria su internet pubblica:
- Il cliente predispone un tunnel WireGuard/IPsec verso la rete privata dell'MSSP.
- L'MSSP instrada il traffico del tunnel verso lo stesso proxy di edge (o direttamente al cluster su indirizzi interni).
- La configurazione dell'agente punta a un hostname interno.

Non implementato nel tooling di questa release; documentato come pattern di setup per gli MSSP che ne hanno bisogno.

### Tailscale / rete overlay

Simile a 6.1; MSSP e cliente si uniscono a una rete Tailscale, l'agente raggiunge direttamente `acme.soc.mssp.ts.net`. Ottimo per i clienti piccoli; documentato.

### Edge MSSP per-regione

Per gli MSSP con separazione geografica (EU, US, APAC), esegui più proxy di edge in regioni diverse. Ogni tenant è assegnato alla regione più vicina e il DNS lo riflette (`acme.soc.eu.mssp.example.com`, `acme.soc.us.mssp.example.com`). Il design lo supporta perché l'instradamento da proxy di edge a namespace del tenant è semplicemente una risoluzione DNS interna al cluster. Il dispatch multi-regione automatizzato è in roadmap.

## Runbook: onboarding del primo agente di un cliente

> **Stato UI:** il pannello dedicato "Agent Onboarding" nel dettaglio del tenant è pianificato ma non ancora presente nella build attuale. Il runbook seguente descrive la UX di riferimento; la soluzione alternativa che segue è il percorso attuale.

**UX pianificata:**

1. L'operatore MSSP crea il tenant nella [UI MSSP](/it-it/mssp-ui) → SocTalk esegue il provisioning dello stack, genera il segreto `authd`.
2. L'operatore MSSP naviga al dettaglio del tenant → sezione "Agent Onboarding".
3. La sezione mostra:
   - Hostname del tenant: `acme.soc.mssp.example.com`
   - Porte: 1514/TCP (eventi), 1515/TCP (enrollment)
   - Segreto condiviso `authd` (mascherato; copia negli appunti + rivelazione una tantum)
   - Comando `agent-auth` di esempio
   - Requisiti di firewall
4. L'operatore MSSP copia in un canale sicuro e condivide con l'amministratore dell'endpoint del cliente.
5. L'amministratore dell'endpoint del cliente installa + effettua l'enrollment.
6. L'operatore MSSP osserva il dettaglio del tenant → scheda Agents, vede l'agente comparire entro ~30 secondi.

**Soluzione alternativa attuale:**

1. Crea il tenant dalla [UI MSSP](/it-it/mssp-ui) → Tenant → **+ New Tenant**.
2. Una volta che gli eventi di ciclo di vita mostrano `workloads_ready`, recupera il segreto condiviso `authd` da Kubernetes:
   ```bash
   kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
     -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
   ```
3. Calcola l'hostname del Wazuh manager del tenant a partire dal pattern wildcard dell'installazione (`<slug>.soc.<mssp-domain>`).
4. Condividi entrambi con l'amministratore dell'endpoint del cliente tramite un canale sicuro; questi esegue `agent-auth` come mostrato sopra.
5. Conferma che l'agente compaia nella dashboard Wazuh integrata (Tenant → **Open SOC** → Agents).

## Test (validazione pre-release + pilota)

Validazione pre-release:
- Il template `Service` per-tenant viene renderizzato correttamente per entrambi i valori di `tenant.wazuhIngress.mode` (`loadbalancer` ed `edge-haproxy`).
- Emissione del certificato per-tenant di cert-manager per il canale di enrollment dell'agente (1515).
- End-to-end in `k3d` con due tenant, con MetalLB che fornisce due IP LB (modalità `loadbalancer`): per ciascun tenant, esegui `agent-auth -m <lb-ip> -P <secret>` da un pod host e conferma che l'agente compaia nell'indexer Wazuh di quel tenant e non nell'altro.
- Lo stesso end-to-end in modalità `edge-haproxy`: HAProxy renderizza una coppia `(IP, port-pair)` per tenant, gli agenti effettuano l'enrollment usando `-m <edge-ip> -p <tenant-port>`, e lo stream degli eventi arriva nell'indexer corretto.
- Negativo: un agente puntato all'indirizzo del tenant A con il segreto `authd` del tenant B viene rifiutato dal manager.

Validazione pilota (release successiva):
- Un endpoint reale di cliente sull'internet pubblica effettua l'enrollment senza problemi.
- Sonda cross-tenant: effettua l'enrollment di un agente `acme` con il segreto `authd` di `beta` contro l'indirizzo di `beta` — attendi il rifiuto. Viceversa. Entrambi falliscono.

In nessuno di questi controlli è presente uno step SNI: il protocollo agente di Wazuh su 1514 non produce un ClientHello, quindi qualsiasi test che "sovrascrive l'SNI" sta esercitando un percorso di instradamento che l'ingress di produzione non prenderà. Valida invece il discriminatore di indirizzo/porta.
