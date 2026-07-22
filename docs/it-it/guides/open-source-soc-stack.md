---
description: "Costruisci uno stack SOC open source con Wazuh, TheHive, Cortex e MISP: cosa fa ogni strumento, il costo reale dell'integrazione e quando conviene pacchettizzarlo."
---

# Costruire uno stack SOC open source con Wazuh, TheHive, Cortex e MISP: assemblato vs integrato

Esiste uno stack SOC free e open source canonico, e da anni è composto più o meno dagli stessi quattro nomi: Wazuh per la detection, TheHive per la gestione dei casi, Cortex per l'analisi degli observable, MISP per la threat intelligence. Tutti e quattro sono progetti maturi con anni di uso in produzione alle spalle, e insieme coprono gran parte di ciò che vende una suite SOC commerciale. Il punto critico è la parola *insieme*. L'integrazione tra gli strumenti è un progetto che costruisci e di cui poi diventi proprietario.

Questa guida spiega cosa fa ciascun pezzo, quanto costa davvero assemblarli, come cambiano i requisiti quando gestisci la sicurezza di più di un'organizzazione e dove si colloca SocTalk, che sta *sopra* questo stack e non al suo posto.

## Lo stack SOC FOSS classico

**[Wazuh](https://wazuh.com/)** è il livello SIEM/XDR: un agent su ogni endpoint, un manager che applica le regole di detection al flusso di eventi e un indexer (basato su OpenSearch) che archivia e interroga i risultati. Include di serie file-integrity monitoring, rilevamento delle vulnerabilità, analisi dei log e un ampio ruleset predefinito. È il posto dove nascono gli alert.

**[TheHive](https://thehive-project.org/)** è il livello di gestione dei casi: una piattaforma di incident response in cui gli alert diventano casi, i casi contengono task e observable e i team di analisti collaborano con un audit trail. Se Wazuh è dove nascono gli alert, TheHive è dove le indagini vivono e muoiono.

**Cortex** è il compagno di TheHive per l'analisi degli observable. Gli passi un IP, un hash, un dominio o un URL, e i suoi plugin analyzer interrogano in parallelo servizi di reputazione e sandbox, da VirusTotal e AbuseIPDB fino a Hybrid Analysis e decine di altri, e riportano un verdetto. Trasforma "ecco un hash" in "ecco cosa il mondo sa di questo hash".

**[MISP](https://www.misp-project.org/)** è la piattaforma di threat intelligence: aggrega, correla e condivide indicatori di compromissione tra feed e community di condivisione. Verificare un observable su MISP ti dice se appartiene a una campagna o a un attore noto, un contesto che nessuno degli altri tre strumenti possiede da solo.

Sono quattro strumenti che coprono quattro compiti distinti, tutti open source, e sulla carta un SOC completo.

## Il costo reale dell'integrazione

Ognuno di questi strumenti si installa in un pomeriggio. È lì che finiscono i tutorial da home lab e comincia il lavoro vero, perché nessuno di loro parla con gli altri, così come installati, nella forma che serve a un SOC di produzione.

Il collante è a carico tuo. Gli alert di Wazuh non diventano casi in TheHive senza un forwarder che scrivi o adotti e che poi mantieni a ogni cambio di API su entrambi i lati. Gli analyzer di Cortex richiedono API key per ciascun provider, gestione dei rate limit e una decisione su quale analyzer eseguire per ogni tipo di observable. MISP richiede feed configurati, job di sincronizzazione pianificati e indicatori soggetti a falsi positivi curati prima di osare automatizzare su di essi.

Poi c'è la superficie operativa: quattro prodotti significano quattro sistemi di autenticazione e calendari di rotazione delle API key, quattro cadenze di aggiornamento che a ogni release possono rompere il tuo collante, quattro strategie di backup e, da quando TheHive è passato a Cassandra/Elasticsearch come base, un footprint di datastore non banale solo per la gestione dei casi. Aggiungi TLS tra ogni coppia, monitoraggio per ciascun servizio e la questione di chi riceve il page quando il forwarder da Wazuh a TheHive smette silenziosamente di inoltrare.

Gli strumenti in sé non hanno colpe; è semplicemente ciò che comporta comporre progetti indipendenti. Il livello di integrazione equivale a un quinto prodotto, con la differenza che nessuno te lo consegna, lo documenta o lo aggiorna al posto tuo.

## Organizzazione singola vs MSSP: il bivio dei requisiti

Per una singola organizzazione la tassa descritta sopra è sostenibile. Costruisci lo stack una volta, il collante serve un solo tenant e un ingegnere capace può mantenerlo in salute come lavoro part-time.

Per un MSP o MSSP i requisiti divergono nettamente:

- **L'isolamento non è negoziabile.** Gli alert, i casi e gli indicatori del cliente A devono essere dimostrabilmente invisibili al cliente B, per contratto e spesso per obblighi normativi. Con strumenti single-tenant condivisi diventa un esercizio di configurazione per ogni strumento, con modalità di guasto per ogni strumento.
- **Gli stack per cliente moltiplicano la tassa.** Dieci clienti su stack dedicati significano dieci manager e indexer Wazuh da deployare, aggiornare e salvare in backup, più dieci copie del tuo collante.
- **L'onboarding deve essere ripetibile.** Il cliente numero undici dovrebbe richiedere un comando, non una settimana di archeologia sul wiki. Gli stack costruiti a mano derivano, e la deriva prima o poi emerge come incidente.
- **Un unico pannello di controllo.** Gli analisti che coprono venti clienti non possono ruotare tra venti dashboard.

Questo è il divario tra "lo stack SOC FOSS funziona" e "lo stack SOC FOSS funziona come business".

## Dove si colloca SocTalk: un control plane sopra lo stack

[SocTalk](https://github.com/soctalk/soctalk) lascia al loro posto tutti e quattro gli strumenti. È un control plane multi-tenant e un livello di triage AI con licenza Apache 2.0 costruito *attorno* a questo stack, per MSP e MSSP che lo eseguono sul proprio Kubernetes:

- **Wazuh è il data plane.** Ogni cliente ottiene un manager e un indexer Wazuh dedicati in un namespace isolato, provisionati dal control plane, oppure porti un Wazuh esistente tramite il profilo `provided`. Gli agent si registrano tramite ingress instradato per hostname con secret a livello di tenant.
- **Il livello di triage AI sta tra Wazuh e i tuoi analisti.** Un funnel di ingest deterministico deduplica, coalizza e correla gli alert prima che qualsiasi modello venga eseguito; un loop agentico LangGraph indaga su ciò che sopravvive; le escalation passano sempre da un gate di revisione umana. I dettagli sono in [Come funziona](/it-it/how-it-works).
- **TheHive, Cortex e MISP sono integrazioni**, consultate durante la run: Cortex per la reputazione degli observable, MISP per il contesto di threat intelligence, TheHive come destinazione di export per i casi in escalation.
- **La macchina multi-tenant è il prodotto**: isolamento dei namespace con Cilium NetworkPolicy, row-level security di Postgres come rete di protezione sui dati, una state machine per il ciclo di vita dei tenant e configurazione LLM per tenant.

**Conosci la superficie di integrazione della V1 prima di pianificare intorno ad essa:**

- L'[export verso TheHive](/it-it/integrate/thehive) è opt-in e **sincrono**: il worker chiama l'API di TheHive al momento del nodo di grafo, creando caso e observable. Non c'è outbox, non c'è loop di retry e non c'è un subchart TheHive incluso; se TheHive non è raggiungibile, il fallimento viene registrato nei log e il caso prosegue solo in SocTalk.
- [Cortex](/it-it/integrate/cortex) è **solo customer-managed** nella V1. Esegui Cortex per conto tuo e SocTalk lo chiama. Nessun subchart incluso; la selezione degli analyzer usa una mappa hard-coded e le chiamate fallite non sono fatali per la run.
- Le lookup **MISP** girano nel `misp_worker` della pipeline contro la tua istanza MISP; un subchart MISP incluso è rinviato a una release futura.
- Il codice per le notifiche **Slack** e per l'approvazione bidirezionale esiste nel repository ma **non è collegato al runtime del chart V1**. Oggi la coda di revisione della dashboard è la superficie human-in-the-loop funzionante.

SocTalk pacchettizza il piano Wazuh multi-tenant e il livello di triage, e *si connette alle* istanze TheHive/Cortex/MISP che gestisci tu. La comodità dei subchart inclusi resta nella roadmap; questa release non la comprende.

## Quando costruire lo stack da soli e quando deployare SocTalk

Entrambe le strade sono open source, quindi la scelta si basa su criteri operativi:

**Costruisci in autonomia lo stack a quattro strumenti quando** sei una singola organizzazione con tempo di ingegneria disponibile, vuoi il massimo controllo su ogni componente, il tuo volume di alert è gestibile con il numero di analisti che hai e il multi-tenant è irrilevante. Lo stack classico più il tuo collante è un pattern consolidato, e capirai ogni cavo perché lo hai saldato tu.

**Valuta SocTalk quando** sei un MSP/MSSP che ha bisogno di stack Wazuh per cliente ripetibili dietro un unico control plane, di isolamento dei tenant dimostrabile e di un triage AI che comprime il volume di alert prima che gli analisti lo vedano, e preferisci gestire una piattaforma amministrata con Helm invece di N stack costruiti a mano. Kubernetes resta a carico tuo, e nella V1 gestisci ancora in autonomia i tuoi TheHive, Cortex e MISP se li vuoi.

Il modo più rapido per valutare è la [VM demo](/it-it/quickstart-vm): un'immagine, un wizard nel browser, circa cinque minuti per arrivare a un'installazione multi-tenant funzionante con un tenant demo già a bordo. Da lì, [Come funziona](/it-it/how-it-works) spiega la pipeline, e le pagine [TheHive](/it-it/integrate/thehive) e [Cortex](/it-it/integrate/cortex) documentano esattamente cosa fanno e cosa non fanno le integrazioni della V1, così puoi pianificare il resto del tuo stack di conseguenza.
