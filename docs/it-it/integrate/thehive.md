# TheHive

[TheHive](https://thehive-project.org/) è opt-in. Quando configurato per singolo tenant, SocTalk esporta le chiusure con disposizione `escalate` come casi TheHive. La cronologia dell'indagine (observable, motivazione AI, decisione di revisione umana) diventa il primo insieme di observable e la timeline del caso.

Per il modello concettuale vedi [Pipeline AI → Chiusura](/it-it/ai-pipeline). Per la dismissione di un tenant con TheHive abilitato, vedi [Ciclo di vita del tenant → Dismissione](/it-it/tenant-lifecycle#decommission-vs-purge).

## Modello di hosting

In V1 la chart `soctalk-tenant` non ha una subchart TheHive (`dependencies: []`). Le scelte sono:

- **TheHive gestito dal cliente**: il cliente esegue il proprio TheHive altrove; l'MSSP fornisce l'URL e una chiave API per singolo tenant.
- **Nessun TheHive**: le escalation restano solo nella UI di SocTalk. Predefinito.

Un percorso con "subchart TheHive integrata" è stato descritto nelle bozze precedenti di questa pagina come opzione pianificata, ma **non è implementato in questa release**. Non esiste alcun StatefulSet Cassandra o Deployment TheHive gestito da SocTalk per il tenant.

## Configurazione (UI MSSP)

Dettaglio tenant → Impostazioni → TheHive. Campi:

| Campo | Note |
|---|---|
| Enable | Disattivato per impostazione predefinita |
| URL | `https://thehive.<customer>.example` per il gestito dal cliente; `http://thehive.tenant-<slug>.svc:9000` per quello integrato |
| Organisation | Slug dell'organizzazione TheHive (istanze TheHive multi-tenant) |
| API key | Chiave API TheHive del cliente con `case:create`, `observable:create`, `task:create` |
| Verify TLS | Attivo per impostazione predefinita; disattivalo per TheHive di sviluppo con certificato self-signed |

**In V1 non esiste alcuna API per modificare le impostazioni di integrazione di TheHive.** La chiamata a TheHive risiede nel **runs-worker per singolo tenant** (che detiene i binding MCP), non nel pod API centrale, quindi impostare le variabili d'ambiente `THEHIVE_*` su `soctalk-system-api` non ha alcun effetto sul worker. Per configurare TheHive in V1, imposta le variabili d'ambiente sul Deployment `soctalk-runs-worker` del tenant nel namespace `tenant-<slug>` (e ri-renderizza tramite `helm upgrade` della chart del tenant, oppure `kubectl set env` seguito da `rollout restart`). Una superficie di configurazione pulita basata su API è nella roadmap.

## Cosa viene esportato

In V1, l'esportazione verso TheHive avviene **in modo sincrono al momento del nodo del grafo** tramite il nodo `thehive_worker` che chiama l'API di TheHive attraverso MCP. Attualmente questo crea il caso (titolo + severità rispecchiati dal verdetto di SocTalk) e gli observable. La superficie più ricca, task derivati da `next_actions`, mirroring nella timeline delle motivazioni dei worker / delle decisioni di revisione umana, **outbox asincrono + retry**: è descritta nelle bozze precedenti come obiettivo di progettazione ma **non è implementata in questa release**. Se TheHive non è raggiungibile, il nodo worker registra l'errore e il caso prosegue in SocTalk senza una controparte esportata. Non esiste un ciclo di retry, né un outbox, né un campo persistito di "ultimo errore", né una superficie dashboard per le esportazioni fallite: i fallimenti sono visibili solo nei log strutturati dell'orchestratore.

Mappatura dei tipi di observable (secondo l'implementazione V1):

| Tipo SocTalk | `dataType` TheHive |
|---|---|
| `ip` | `ip` |
| `fqdn` | `fqdn` |
| `url` | `url` |
| `hash_md5`, `hash_sha1`, `hash_sha256` | `hash` |
| `email` | `mail` |
| `filename` | `filename` |
| `user` | `other` (con `tags: user`) |
| `process` | `other` (con `tags: process`) |
| `registry_key` | `registry` |

## TheHive integrata: non in questa release

La chart `soctalk-tenant` in V1 non integra TheHive come subchart, `Chart.yaml` elenca `dependencies: []`. Gli operatori che desiderano un'istanza TheHive per singolo tenant la eseguono autonomamente (`helm install` manuale nel namespace del tenant, oppure gestita dal cliente altrove). Una subchart integrata con secret di amministrazione gestiti dalla chart è descritta nelle bozze precedenti come obiettivo di progettazione, ma è nella roadmap.

## TheHive gestito dal cliente: note

- Il TheHive del cliente deve essere raggiungibile dal control plane di SocTalk (egress verso l'URL di TheHive del cliente).
- Il cliente crea la chiave API con gli scope minimi elencati sopra. SocTalk non necessita di scope amministrativo.
- Se il TheHive del cliente applica allowlist di IP sorgente, inserisci in allowlist l'IP NAT di egress del control plane di SocTalk.

## Stato / integrità

In questa release **non esiste alcun ciclo di health-ping in background** per TheHive: SocTalk contatta TheHive solo quando un'indagine ha qualcosa da esportare. I fallimenti durante quella chiamata sono registrati solo nell'output strutturato dell'orchestratore; non esiste un campo di errore persistito né un retry basato su outbox. La UI MSSP non espone un indicatore separato di "TheHive raggiungibile".

Per monitorare l'integrità di TheHive, usa la tua consueta sonda esterna (Prometheus blackbox exporter contro l'`/api/status` di TheHive, ecc.): è una responsabilità lato MSSP, non parte di SocTalk in questa release.

## Rotazione della chiave API

1. Nel TheHive del cliente, genera una nuova chiave API con gli stessi scope.
2. Applica una patch al Secret nel namespace del tenant che contiene le credenziali di TheHive e riavvia il runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revoca la vecchia chiave in TheHive.

Un percorso di live-reload (osservazione del file Secret montato) è pianificato.

## Riferimenti al codice sorgente

| Concetto | File |
|---|---|
| Worker / esportazione TheHive | [`src/soctalk/workers/thehive.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/thehive.py) |
| Schema delle impostazioni | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
| Bridge dello strumento MCP | [`src/soctalk/chat/mcp_tools.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/chat/mcp_tools.py) |
