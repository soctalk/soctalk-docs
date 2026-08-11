---
description: "Collega il triage AI di SocTalk a un Wazuh che già gestisci: installa dal pacchetto OS, effettua l'onboarding di un tenant con profilo provided e osserva il primo alert diventare un caso triato ed escalato."
---

# Collegare SocTalk a un Wazuh esistente

La maggior parte delle installazioni Wazuh non parte da zero. C'è già un manager che sorveglia gli agent, un indexer che conserva mesi di alert e una dashboard da cui il team indaga già. Il profilo tenant `provided` di SocTalk è pensato esattamente per questa situazione: SocTalk installa soltanto i propri componenti, si collega via rete al tuo Wazuh e inizia a triare gli alert che il tuo deployment già produce. Nulla del tuo Wazuh cambia, nessun agent si ri-registra e nessun dato viene migrato.

Questa guida percorre l'intero cammino su un singolo host Linux, dal pacchetto OS alla prima escalation triata dall'AI, ed è stata verificata dall'inizio alla fine su SocTalk v0.2.0 con Wazuh 4.12.0. Dove questa release ha spigoli vivi, la guida lo dice e fornisce la soluzione alternativa.

Se invece vuoi che sia SocTalk a fare il deploy e a gestire Wazuh per te, quello è il profilo `poc` o `persistent`; vedi [Onboarding di un tenant cliente](/it-it/guides/wazuh-tenant-onboarding).

## Cosa ti serve prima di iniziare

Il tuo Wazuh esistente deve essere raggiungibile dall'host SocTalk su due porte: l'API OpenSearch dell'indexer (`:9200`) e la REST API del manager (`:55000`). SocTalk si autentica a ciascuna separatamente, quindi tieni pronte entrambe le coppie di credenziali:

- un utente indexer autorizzato a cercare in `wazuh-alerts-*` (l'`admin` integrato funziona, anche se un utente in sola lettura è prassi migliore),
- un utente della Manager API come l'integrato `wazuh-wui`.

I certificati self-signed lato Wazuh sono la norma e sono supportati; al momento dell'onboarding passerai `verify_ssl: false`. Ti serve inoltre una API key LLM per tenant. Il profilo `provided` la richiede all'onboarding, perché un tenant bring-your-own-SIEM non ha alcun fallback condiviso dall'installazione: la richiesta di onboarding viene rifiutata con un 422 se la chiave manca.

L'host SocTalk stesso richiede il footprint consueto: un Linux basato su systemd (Ubuntu 24.04 e Rocky 9 sono la coppia verificata), 4 vCPU e 8 GB di RAM come minimo per il control plane più un tenant provided, e le porte 80/443/6443 libere. Poiché il tenant non esegue alcun Wazuh proprio, un tenant provided è molto più leggero di uno `persistent`.

## Installa SocTalk dal pacchetto OS

Scarica il pacchetto per la tua distro dalla [pagina delle release](https://github.com/soctalk/soctalk/releases) e installalo; la matrice completa dei formati è su [Installazione da un pacchetto OS](/it-it/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.1/soctalk_0.2.1_amd64.deb
sudo apt-get install -y ./soctalk_0.2.1_amd64.deb
```

Il pacchetto include un template di ambiente in `/etc/soctalk/soctalk.env.example`. Copialo, inserisci l'identità del tuo MSSP, le credenziali admin, l'hostname e la chiave LLM, e mantienilo accessibile solo a root:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Poi esegui l'installer in modalità non interattiva:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Passa `--skip-consent` (o `-y`) esplicitamente. In v0.2.0 il prompt di consenso scatta ancora su un terminale non interattivo anche quando ogni variabile `SOCTALK_*` è impostata, e senza una TTY l'installazione si interrompe con `/dev/tty: No such device or address`.

L'installer avvia k3s e Helm se l'host ne è privo, installa il chart `soctalk-system` fissato alla versione della release e, al termine, stampa l'URL e le credenziali di accesso. Tre pod nel namespace `soctalk-system` (`api`, `app-ui`, `postgres`) indicano che il control plane è attivo:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

## Un interruttore prima dell'onboarding: le network policy

Ecco lo spigolo vivo di v0.2.0, in anticipo così non ci sbatti a metà onboarding: un tenant `provided` genera una policy di egress FQDN Cilium per gli host del SIEM esterno, ma il k3s che `soctalk install` configura esegue flannel, che non ha alcuna CRD Cilium. Il provisioning di un tenant provided su un'installazione v0.2.0 stock fallisce quindi allo step Helm con

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

e il tenant finisce in `degraded`. Questo è risolto dopo la v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): il chart ora condiziona quell'oggetto all'esistenza effettiva della CRD e aggiunge una `NetworkPolicy` di egress semplice per host SIEM con IP letterale, così un'installazione flannel stock effettua il provisioning senza intoppi. Su v0.2.0 la soluzione alternativa su un'installazione a singolo host è disabilitare le network policy dei tenant prima dell'onboarding:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo /usr/local/bin/k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Sii consapevole del compromesso: questo disattiva le NetworkPolicy di isolamento del namespace per i tenant provisionati in seguito, cosa accettabile su un host di lab o pilot dedicato a una singola classe di tenant e non ciò che vuoi su un cluster di produzione multi-tenant condiviso. Se usi Cilium come tuo CNI, nulla di tutto questo si applica e dovresti lasciare le policy attive.

Se hai già effettuato l'onboarding e il tenant resta in `degraded` con l'errore precedente, imposta l'interruttore e premi **Retry Provisioning** nella pagina del tenant; i retry sono idempotenti e riprendono in modo pulito.

Un'ultima cosa specifica di un lab su singola macchina, dove il Wazuh "esistente" spesso gira in Docker sullo stesso host su cui hai installato SocTalk, raggiunto tramite l'IP dell'host stesso. k3s applica le NetworkPolicy attraverso il suo controller integrato, e un pod che raggiunge l'IP del nodo per una porta pubblicata da Docker è un hairpin che il livello delle policy non instrada in modo pulito nemmeno quando una regola di egress lo consente. Il sintomo è l'adapter che logga `ingest_failed: All connection attempts failed` mentre lo stesso Wazuh risponde correttamente dall'host. Disabilitare le network policy dei tenant come sopra risolve. Un Wazuh su un host separato è un normale percorso in uscita e non incontra questo problema.

## Onboarding del tenant

Nella UI MSSP, Tenants, poi **+ New Tenant**, scegli il profilo `provided` e la procedura guidata inserisce uno step External SIEM che un tenant PoC o persistent non ha.

![Lo step Profile della procedura New Tenant con Provided selezionato, descritto come porta il tuo Wazuh; il breadcrumb ora include uno step External SIEM](/screenshots/existing-wazuh-profile.png)

È in quello step che punti SocTalk al tuo Wazuh. L'indexer (OpenSearch, porta 9200) e la Manager API (porta 55000) si autenticano con credenziali separate, e un tenant provided fornisce la propria chiave LLM perché la chiave di installazione condivisa dell'MSSP non si applica a questo profilo.

![Lo step External SIEM della procedura guidata: URL e credenziali dell'indexer, URL e credenziali della Manager API, un token API pre-generato opzionale, una checkbox Verify TLS certificates da deselezionare per i self-signed e la chiave LLM per tenant richiesta](/screenshots/existing-wazuh-siem-form.png)

La stessa operazione tramite API è un unico POST all'endpoint di onboard. Nota il path: `POST /api/mssp/tenants/onboard` è l'endpoint della procedura guidata che comprende i profili e il materiale del SIEM esterno. Il semplice `POST /api/mssp/tenants` è una creazione di sola identità; su v0.2.0 ignora silenziosamente quei campi e ti lascia un tenant `poc` che non effettua mai il provisioning, quindi invia sempre un onboard provided a `/onboard`.

```bash
# autenticati una volta; il cookie jar trasporta la sessione MSSP
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

Un 202 con `"profile": "provided"` nel body conferma il path corretto. Scegli lo slug con attenzione: gli slug restano riservati dai tenant archiviati, quindi un tenant di test dismesso non libera il proprio nome per il riutilizzo.

Il provisioning di un tenant provided è rapido perché non c'è alcun chart Wazuh da installare; il controller salta quella fase e registra invece un evento di lifecycle `wazuh_skipped_provided`. Nella run verificata il tenant è passato da `pending` ad `active` in meno di venti secondi.

## Verifica la connessione

Il namespace del tenant dovrebbe contenere esattamente due workload, l'adapter e il runs-worker, e nessun pod Wazuh:

```bash
sudo /usr/local/bin/k3s kubectl -n tenant-orion-soc get pods
```

Il tuo materiale di connessione finisce in un Secret locale al namespace chiamato `tenant-external-siem-creds` che contiene `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` e `WAZUH_API_PASSWORD`, più `WAZUH_API_TOKEN` quando ne fornisci uno. L'adapter legge l'URL dell'indexer dal proprio ambiente e le credenziali da quel Secret. Il suo log ti dice entro pochi secondi se la connessione funziona, perché fa polling continuo dell'indice degli alert:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

La pagina di dettaglio del tenant mostra la stessa cosa senza dover leggere i log. Il pannello External SIEM riporta gli URL dell'indexer e dell'API che hai fornito, e la riga di stato dell'ingest dell'adapter segnala `reachable` con un conteggio degli alert inoltrati non appena i primi alert iniziano a fluire.

![La pagina di dettaglio del tenant Orion Labs: profilo provided, stato active, un pannello External SIEM con gli URL dell'indexer e dell'API e uno stato di ingest dell'adapter reachable con tre alert inoltrati](/screenshots/existing-wazuh-tenant-detail.png)

Un 401 nel log dell'adapter significa che le credenziali dell'indexer sono errate; un errore TLS significa che `verify_ssl` non corrisponde alla situazione del tuo certificato; un timeout significa che l'host SocTalk non riesce a raggiungere la porta dell'indexer.

Le credenziali ruotano senza ri-onboarding. `PATCH /api/mssp/tenants/{id}/external-siem` accetta qualunque sottoinsieme dei campi di onboard, riscrive il Secret e riavvia il pod dell'adapter così che raccolga il materiale aggiornato:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## Il primo alert triato

Da qui in avanti il workflow di ingest, promozione, esecuzione delle run e revisione si comporta come per un Wazuh gestito da SocTalk (la profondità dell'arricchimento differisce su v0.2.0, vedi Limitazioni attuali): l'adapter inoltra i nuovi alert pari o superiori alla severità minima (rule level 10 di default, configurabile con `SOCTALK_ADAPTER_MIN_SEVERITY`), il control plane promuove ciò che conta in indagini, e il runs-worker del tenant esegue il triage AI con la chiave LLM del tenant stesso.

Il modo onesto di testare è far produrre al tuo Wazuh esistente un vero alert ad alta severità, per esempio una raffica di login SSH falliti contro un agent monitorato seguita da un successo. Se preferisci non toccare gli endpoint di produzione, indicizzare un documento di alert sintetico direttamente in `wazuh-alerts-4.x-<date>` con un `rule.level` di 12 esercita il percorso identico, dato che l'adapter legge dall'indice invece che dal manager.

Nella run verificata, un alert SSH brute-force-then-success è passato da documento indexer a triage completato in circa un minuto: inoltrato dall'adapter, promosso, indagato dal supervisor attraverso diverse chiamate LLM e chiuso come `escalate` con confidenza 0,95, finendo nella [coda di revisione MSSP](/it-it/mssp-ui#reviews-human-in-the-loop) per un umano. La spesa totale per la run è stata di circa trenta centesimi sulla chiave Anthropic del tenant, tracciata rispetto al budget di token per run descritto in [Pipeline AI](/it-it/ai-pipeline). Dopo qualche alert di test di questo tipo, la coda di revisione li tiene affiancati.

![La coda di revisione umana con tre casi Critical, ciascuno contrassegnato AI: Escalate e con un'azione Review disponibile](/screenshots/existing-wazuh-review-queue.png)

Ogni riga porta il verdetto dell'AI e apre l'indagine completa, così un analista conferma o corregge sulla base delle evidenze invece di avviare da sé il triage.


Un avvertimento se ripubblichi l'indexer su un indirizzo o una porta diversi per raggiungere SocTalk, ad esempio tramite NodePort, port-forward o reverse proxy. Verifica le credenziali **attraverso l'URL esatto che configurerai**, non contro la `:9200` dell'indexer. Su un banco di prova costruito così abbiamo visto lo stesso indexer, gli stessi pod e le stesse credenziali rispondere `200` su `:9200` e `401` attraverso la porta ripubblicata, riproducibile con un semplice `curl` dall'host e quindi del tutto estraneo a SocTalk. Non ne abbiamo cercato la causa; la lezione pratica è che il percorso ripubblicato è una cosa a sé e va verificato a parte:

```bash
curl -sk -u '<indexer-user>:<indexer-password>' https://<host>:<port>/
```


Se restituisce 401 mentre la porta propria dell'indexer restituisce 200, correggi l'esposizione prima dell'onboarding: SocTalk riprodurrà fedelmente il 401.

## Limitazioni attuali

Entrambi i caveat qui sotto sono stati verificati su v0.2.0 e sono risolti nella release successiva, quindi su una build più recente puoi saltare le soluzioni alternative. Controlla le note di rilascio della tua versione.

- **Arricchimento verso il Wazuh esterno (solo v0.2.0).** Su v0.2.0 il tooling MCP Wazuh del runs-worker non era collegato alla Manager API di un tenant provided, quindi il triage girava sul solo payload dell'alert, senza pivot in tempo reale sullo stato degli agent o sullo storico dei log. Risolto dopo la v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): il worker ora collega il server MCP `mcp-server-wazuh` integrato al Wazuh del tenant stesso, così il grafo di triage interroga agent, processi, porte, vulnerabilità e log del manager durante un'indagine allo stesso modo di un tenant gestito da SocTalk. **Risolto nella v0.2.1** ([soctalk#147](https://github.com/soctalk/soctalk/issues/147)): le porte vengono lette dagli URL forniti e qualsiasi porta funziona.
- **Provisioning su un'installazione flannel stock (solo v0.2.0).** Il problema della policy di egress Cilium descritto in precedenza, con la sua soluzione alternativa basata sulle network policy. Risolto dopo la v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
- **Porte SIEM non standard (solo v0.2.0).** La NetworkPolicy di egress del tenant ricava l'*host* del SIEM esterno dagli URL forniti, ma fissa le *porte* a 9200 e 55000. Un Wazuh raggiungibile su porte diverse viene bloccato a livello di rete mentre il tenant arriva comunque ad `active`, il Secret con le credenziali viene scritto e l'adapter continua a inviare heartbeat: l'unico sintomo è `ingest_failed: All connection attempts failed` nel log dell'adapter. Verificato a parità di cluster variando solo le porte: un indexer pubblicato su NodePort `:31437` non si è mai connesso, mentre lo stesso Wazuh su `:9200` si è connesso e autenticato. Finché non arriva la correzione ([soctalk#147](https://github.com/soctalk/soctalk/issues/147)), esponi indexer e Manager API a SocTalk sulle porte 9200 e 55000. Dopo, le porte vengono lette dagli URL forniti e qualsiasi porta funziona.
