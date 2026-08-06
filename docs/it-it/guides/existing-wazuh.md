---
description: "Collega il triage AI di SocTalk a un Wazuh che gestisci già: installa dal pacchetto OS, esegui l'onboarding di un tenant con profilo provided e osserva il primo alert trasformarsi in un caso triaged ed escalato."
---

# Collegare SocTalk a un Wazuh esistente

La maggior parte delle installazioni Wazuh non parte da zero. C'è già un manager che sorveglia gli agent, un indexer che conserva mesi di alert e una dashboard da cui il team indaga già. Il profilo tenant `provided` di SocTalk è pensato esattamente per questa situazione: SocTalk installa solo i propri componenti, si collega al tuo Wazuh via rete e comincia a fare triage sugli alert che il tuo deployment produce già. Nulla del tuo Wazuh cambia, nessun agent si registra di nuovo e nessun dato viene migrato.

Questa guida percorre l'intero cammino su un singolo host Linux, dal pacchetto OS alla prima escalation triaged dall'AI, ed è stata verificata dall'inizio alla fine su SocTalk v0.2.0 con Wazuh 4.12.0. Dove questa release presenta spigoli vivi, la guida lo dice e indica la soluzione alternativa.

Se invece vuoi che sia SocTalk a effettuare il deploy e a gestire Wazuh per te, quello è il profilo `poc` o `persistent`; vedi [Onboarding di un tenant cliente](/it-it/guides/wazuh-tenant-onboarding).

## Cosa ti serve prima di iniziare

Il tuo Wazuh esistente deve essere raggiungibile dall'host SocTalk su due porte: la OpenSearch API dell'indexer (`:9200`) e la REST API del manager (`:55000`). SocTalk si autentica separatamente a ciascuna, quindi tieni pronte entrambe le coppie di credenziali:

- un utente indexer autorizzato a effettuare ricerche su `wazuh-alerts-*` (l'utente `admin` predefinito funziona, anche se un utente in sola lettura è una prassi migliore),
- un utente della manager API come il predefinito `wazuh-wui`.

I certificati self-signed sul lato Wazuh sono la norma e sono supportati; passerai `verify_ssl: false` al momento dell'onboarding. Ti serve anche una API key LLM per tenant. Il profilo `provided` la richiede all'onboarding, perché un tenant con SIEM bring-your-own non ha alcun fallback condiviso dall'installazione: la richiesta di onboarding viene rifiutata con un 422 se la chiave manca.

L'host SocTalk stesso richiede la solita impronta: un Linux basato su systemd (Ubuntu 24.04 e Rocky 9 sono la coppia verificata), 4 vCPU e 8 GB di RAM come soglia minima per il control plane più un tenant provided, e le porte 80/443/6443 libere. Poiché il tenant non esegue alcun Wazuh proprio, un tenant provided è molto più leggero di uno `persistent`.

## Installa SocTalk dal pacchetto OS

Scarica il pacchetto per la tua distro dalla [pagina delle release](https://github.com/soctalk/soctalk/releases) e installalo; la matrice completa dei flavor è su [Installazione da un pacchetto OS](/it-it/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

Il pacchetto include un template di ambiente in `/etc/soctalk/soctalk.env.example`. Copialo, compila la tua identità MSSP, le credenziali admin, l'hostname e la chiave LLM, e tienilo accessibile solo a root:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Poi esegui l'installer in modalità non interattiva:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Passa `--skip-consent` (oppure `-y`) esplicitamente. In v0.2.0 il prompt di consenso scatta ancora su un terminale non interattivo anche quando ogni variabile `SOCTALK_*` è impostata, e senza un TTY l'installazione si interrompe con `/dev/tty: No such device or address`.

L'installer avvia k3s e Helm se l'host ne è privo, installa il chart `soctalk-system` fissato alla versione della release e stampa l'URL e il login al termine. Tre pod nel namespace `soctalk-system` (`api`, `app-ui`, `postgres`) indicano che il control plane è attivo:

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## Un interruttore prima dell'onboarding: le network policy

Ecco lo spigolo vivo di v0.2.0, in anticipo così non ci sbatti a metà onboarding: un tenant `provided` genera una policy di egress Cilium FQDN per gli host SIEM esterni, ma il k3s che `soctalk install` configura usa flannel, che non ha le CRD di Cilium. Il provisioning di un tenant provided su un'installazione v0.2.0 di serie fallisce quindi alla fase Helm con

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

e il tenant finisce in `degraded`. Questo è risolto dopo v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): il chart ora subordina quell'oggetto all'effettiva esistenza della CRD e aggiunge un egress con `NetworkPolicy` semplice per gli host SIEM espressi come IP letterale, così un'installazione flannel di serie effettua il provisioning senza intoppi. Su v0.2.0 la soluzione alternativa su un'installazione a singolo host è disabilitare le network policy dei tenant prima dell'onboarding:

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Sii consapevole del compromesso: questo disattiva le NetworkPolicy di isolamento dei namespace per i tenant di cui viene fatto il provisioning in seguito, cosa accettabile su un host di lab o pilot dedicato a una singola classe di tenant e non ciò che vuoi su un cluster di produzione multi-tenant condiviso. Se usi Cilium come CNI, nulla di tutto questo si applica e dovresti lasciare le policy attive.

Se hai già effettuato l'onboarding e il tenant è in `degraded` con l'errore sopra, imposta l'interruttore e premi **Retry Provisioning** nella pagina del tenant; i retry sono idempotenti e riprendono senza problemi.

Un'ultima cosa specifica di un lab a singola box, dove il Wazuh "esistente" spesso gira in Docker sullo stesso identico host su cui hai installato SocTalk, raggiunto tramite l'IP dell'host stesso. k3s applica le NetworkPolicy attraverso il proprio controller integrato, e un pod che raggiunge l'IP del nodo su cui gira per una porta pubblicata da Docker è un hairpin che il livello di policy non instrada in modo pulito anche quando una regola di egress lo consente. Il sintomo è l'adapter che registra `ingest_failed: All connection attempts failed` mentre lo stesso Wazuh risponde senza problemi dall'host. Disabilitare le network policy dei tenant come sopra risolve. Un Wazuh su un host separato è un normale percorso in uscita e non incappa in questo problema.

## Onboarding del tenant

Nella UI MSSP, Tenants, poi **+ New Tenant**, scegli il profilo `provided` e la procedura guidata chiede il materiale di connessione esterno. La stessa operazione via API è un singolo POST all'endpoint di onboarding. Nota il path: `POST /api/mssp/tenants/onboard` è l'endpoint della procedura guidata che comprende i profili e il materiale SIEM esterno. Il semplice `POST /api/mssp/tenants` è una creazione di sola identità che ignora silenziosamente quei campi, lasciandoti un tenant `poc` di cui non viene mai fatto il provisioning.

```bash
# authenticate once; the cookie jar carries the MSSP session
curl -sk -c cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/auth/login" \
  -d '{"email": "<admin-email>", "password": "<admin-password>"}'

curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/mssp/tenants/onboard" -d '{
  "slug": "orion-soc",
  "display_name": "Orion Labs",
  "profile": "provided",
  "llm_provider": "anthropic",
  "llm_base_url": "https://api.anthropic.com",
  "llm_model": "claude-sonnet-4-6",
  "llm_api_key": "sk-ant-...",
  "external_siem": {
    "indexer_url": "https://198.51.100.20:9200",
    "indexer_username": "admin",
    "indexer_password": "...",
    "api_url": "https://198.51.100.20:55000",
    "api_username": "wazuh-wui",
    "api_password": "...",
    "verify_ssl": false
  }
}'
```

Un 202 con `"profile": "provided"` nel corpo conferma il path corretto. Scegli lo slug con attenzione: gli slug restano riservati dai tenant archiviati, quindi un tenant di test dismesso non libera il proprio nome per il riutilizzo.

Il provisioning di un tenant provided è rapido perché non c'è alcun chart Wazuh da installare; il controller salta quella fase e registra invece un evento di lifecycle `wazuh_skipped_provided`. Nell'esecuzione verificata il tenant è passato da `pending` ad `active` in meno di venti secondi.

## Verifica la connessione

Il namespace del tenant dovrebbe contenere esattamente due workload, l'adapter e il runs-worker, e nessun pod Wazuh:

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

Il tuo materiale di connessione finisce in un Secret locale al namespace chiamato `tenant-external-siem-creds` che contiene `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` e `WAZUH_API_PASSWORD`, più `WAZUH_API_TOKEN` quando ne hai fornito uno. L'adapter legge l'URL dell'indexer dal proprio ambiente e le credenziali da quel Secret. Il suo log ti dice nel giro di secondi se la connessione funziona, perché interroga di continuo l'indice degli alert:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

Un 401 qui significa che le credenziali dell'indexer sono errate; un errore TLS significa che `verify_ssl` non corrisponde alla situazione dei tuoi certificati; un timeout significa che l'host SocTalk non riesce a raggiungere la porta dell'indexer.

Le credenziali ruotano senza ripetere l'onboarding. `PATCH /api/mssp/tenants/{id}/external-siem` accetta qualunque sottoinsieme dei campi di onboarding, riscrive il Secret e riavvia il pod dell'adapter perché raccolga il materiale aggiornato:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## Il primo alert triaged

Da qui in poi la pipeline si comporta esattamente come per un Wazuh gestito da SocTalk: l'adapter inoltra i nuovi alert al di sopra della severità minima (livello di regola 10 di default, configurabile con `SOCTALK_ADAPTER_MIN_SEVERITY`), il control plane promuove ciò che conta a indagini e il runs-worker del tenant esegue il triage AI con la chiave LLM propria del tenant.

Il modo onesto di testare è far produrre al tuo Wazuh esistente un vero alert ad alta severità, per esempio una raffica di login SSH falliti contro un agent monitorato seguita da un successo. Se preferisci non toccare gli endpoint di produzione, indicizzare un documento di alert sintetico direttamente in `wazuh-alerts-4.x-<date>` con un `rule.level` di 12 esercita il percorso identico, dato che l'adapter legge dall'indice invece che dal manager.

Nell'esecuzione verificata, un alert di SSH brute-force seguito da successo è passato da documento nell'indexer a triage completato in circa un minuto: inoltrato dall'adapter, promosso, indagato dal supervisor attraverso diverse chiamate LLM e chiuso come `escalate` con confidenza 0.95, finendo nella [coda di revisione MSSP](/it-it/mssp-ui#reviews-human-in-the-loop) per una persona. La spesa totale per l'esecuzione è stata di circa trenta centesimi sulla chiave Anthropic del tenant, tracciata rispetto al budget di token per run descritto in [Pipeline AI](/it-it/ai-pipeline).

## Limitazioni attuali

Entrambe le avvertenze seguenti sono state verificate su v0.2.0 e sono risolte nella release successiva, quindi su una build più recente puoi saltare le soluzioni alternative. Controlla le note di release per la tua versione.

- **Enrichment che raggiunge il Wazuh esterno (solo v0.2.0).** Su v0.2.0 il tooling MCP Wazuh del runs-worker non era collegato alla manager API di un tenant provided, quindi il triage girava sul solo payload dell'alert, senza pivot in tempo reale nello stato degli agent o nella cronologia dei log. Risolto dopo v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): il worker ora collega il server MCP `mcp-server-wazuh` incluso al Wazuh proprio del tenant, così durante un'indagine il grafo di triage interroga agent, processi, porte, vulnerabilità e log del manager nello stesso modo di un tenant gestito da SocTalk.
- **Provisioning su un'installazione flannel di serie (solo v0.2.0).** Il problema della policy di egress Cilium descritto in precedenza, con la sua soluzione alternativa sulle network policy. Risolto dopo v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
