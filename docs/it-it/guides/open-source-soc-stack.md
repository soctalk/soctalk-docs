---
description: "Costruisci uno stack SOC open source con Wazuh, TheHive, Cortex e MISP: cosa fa ogni strumento, il costo reale dell'integrazione e quando conviene pacchettizzarlo."
---

# Costruire uno stack SOC open source: Wazuh, TheHive, Cortex e MISP — assemblati vs integrati

Esiste uno stack SOC free-and-open-source canonico, e da anni è composto più o meno dagli stessi quattro nomi: Wazuh per la detection, TheHive per la gestione dei casi, Cortex per l'analisi degli observable, MISP per la threat intelligence. Ogni progetto è davvero bravo nel suo compito, ognuno è collaudato sul campo, e insieme coprono la maggior parte di ciò che vende una suite SOC commerciale. Il problema è la parola *insieme*. Gli strumenti sono eccellenti; l'integrazione tra loro è un progetto che costruisci e di cui poi diventi proprietario.

Questa guida spiega cosa fa ciascun componente, quanto costa davvero assemblarli, come cambiano i requisiti quando gestisci la sicurezza di più di un'organizzazione e dove si colloca SocTalk — che sta *sopra* questo stack, non al suo posto.

## Il classico stack SOC FOSS

**[Wazuh](https://wazuh.com/)** è il livello SIEM/XDR: un agent su ogni endpoint, un manager che applica le regole di detection al flusso di eventi e un indexer (basato su OpenSearch) che memorizza e ricerca i risultati. Include out of the box file-integrity monitoring, rilevamento delle vulnerabilità, analisi dei log e un ampio set di regole predefinite. È il luogo dove nascono gli Alert.

**[TheHive](https://thehive-project.org/)** è il livello di gestione dei casi: una piattaforma di incident response in cui gli Alert diventano casi, i casi contengono attività e observable, e i team di analisti collaborano con un audit trail. Se Wazuh è dove nascono gli Alert, TheHive è dove le indagini vivono e muoiono.

**Cortex** è il compagno di TheHive per l'analisi degli observable. Gli consegni un IP, un hash, un dominio o un URL, e i suoi plugin analyzer si distribuiscono su servizi di reputazione e sandbox — VirusTotal, AbuseIPDB, Hybrid Analysis e decine di altri — riportando un Verdetto. Trasforma "ecco un hash" in "ecco cosa sa il mondo di questo hash".

**[MISP](https://www.misp-project.org/)** è la piattaforma di threat intelligence: aggrega, correla e condivide indicatori di compromissione tra feed e community di condivisione. Verificare un observable su MISP ti dice se appartiene a una campagna o a un attore noti — un contesto che nessuno degli altri tre strumenti possiede da solo.

Quattro strumenti, quattro compiti distinti, tutti open source. Sulla carta, un SOC completo.

## La tassa di integrazione che nessuno mette a budget

Ognuno di questi strumenti si installa in un pomeriggio. È lì che finiscono i tutorial da home lab, ed è lì che comincia il lavoro vero, perché nessuno di loro comunica con gli altri out of the box nella forma di cui un SOC di produzione ha bisogno.

Il collante spetta a te. Gli Alert di Wazuh non diventano casi TheHive senza un forwarder che scrivi o adotti e che poi mantieni attraverso i cambi di API su entrambi i lati. Gli analyzer di Cortex richiedono chiavi API per ogni provider, gestione dei rate limit e una decisione su quale analyzer eseguire per ogni tipo di observable. MISP richiede feed configurati, job di sincronizzazione pianificati e la cura degli indicatori soggetti a falsi positivi prima di osare automatizzare su di essi.

Poi c'è la superficie operativa: quattro prodotti significano quattro sistemi di autenticazione e altrettanti calendari di rotazione delle chiavi API, quattro cadenze di aggiornamento che possono rompere il tuo collante a ogni release, quattro strategie di backup e — da quando TheHive è passato a Cassandra/Elasticsearch come base — un footprint di datastore non banale solo per la gestione dei casi. Aggiungi il TLS tra ogni coppia, il monitoraggio di ciascun servizio e la domanda su chi riceve il page quando il forwarder da Wazuh a TheHive smette silenziosamente di inoltrare.

Niente di tutto questo è una critica agli strumenti. È la natura della composizione di progetti indipendenti: il livello di integrazione è un quinto prodotto, solo che nessuno lo distribuisce, lo documenta o lo aggiorna al posto tuo.

## Singola organizzazione vs MSSP: la biforcazione dei requisiti

Per una singola organizzazione, la tassa di cui sopra è sostenibile. Costruisci lo stack una volta, il collante serve un solo Tenant e un ingegnere capace può mantenerlo in salute come lavoro part-time.

Per un MSP o MSSP, i requisiti si biforcano bruscamente:

- **L'isolamento non è negoziabile.** Gli Alert, i casi e gli indicatori del cliente A devono essere dimostrabilmente invisibili al cliente B — per contratto, e spesso per normativa. Con strumenti single-tenant condivisi questo diventa un esercizio di configurazione per ogni strumento, con modalità di guasto per ogni strumento.
- **Gli stack per cliente moltiplicano la tassa.** Dieci clienti su stack dedicati significano dieci manager e indexer Wazuh da distribuire, aggiornare e salvaguardare con backup — e dieci copie del tuo collante.
- **L'onboarding deve essere ripetibile.** Il cliente numero undici dovrebbe essere un comando, non una settimana di archeologia sul wiki. Gli stack costruiti a mano derivano; la deriva diventa incidente.
- **Un unico pannello di controllo.** Gli analisti che coprono venti clienti non possono ruotare tra venti dashboard.

Questo è il divario tra "lo stack SOC FOSS funziona" e "lo stack SOC FOSS funziona come business".

## Dove si colloca SocTalk: un control plane sopra lo stack, non un sostituto

[SocTalk](https://github.com/soctalk/soctalk) non sostituisce nessuno dei quattro strumenti. È un control plane multi-tenant Apache 2.0 e un livello di Triage AI costruito *attorno* a questo stack, per MSP e MSSP che lo eseguono sul proprio Kubernetes:

- **Wazuh è il data plane.** Ogni cliente riceve un manager e un indexer Wazuh dedicati in un namespace isolato, provisionati dal control plane — oppure porti un Wazuh esistente tramite il profilo `provided`. Gli agent si registrano attraverso un ingress instradato per hostname con secret con scope per Tenant.
- **Il livello di Triage AI sta tra Wazuh e i tuoi analisti.** Un funnel di ingest deterministico deduplica, coalizza e correla gli Alert prima che qualsiasi modello venga eseguito; un loop agentico LangGraph indaga ciò che sopravvive; le escalation passano sempre da un gate di Revisione umana. Dettagli in [Come funziona](/it-it/how-it-works).
- **TheHive, Cortex e MISP sono integrazioni**, consultate durante l'esecuzione: Cortex per la reputazione degli observable, MISP per il contesto di threat intelligence, TheHive come destinazione di export per i casi escalati.
- **La macchina multi-tenant è il prodotto**: isolamento dei namespace con Cilium NetworkPolicy, row-level security di Postgres come rete di sicurezza sui dati, una state machine per il ciclo di vita del Tenant e configurazione LLM per Tenant.

**Sii chiaro sulla superficie di integrazione della V1**, perché è qui che l'onestà batte il marketing:

- L'[export verso TheHive](/it-it/integrate/thehive) è opt-in e **sincrono** — il worker chiama l'API di TheHive al momento del nodo del grafo, creando il caso e gli observable. Non c'è outbox, nessun loop di retry e nessun subchart TheHive incluso; se TheHive è irraggiungibile, il fallimento viene registrato nei log e il caso procede solo in SocTalk.
- [Cortex](/it-it/integrate/cortex) è **solo customer-managed** nella V1 — esegui Cortex per conto tuo e SocTalk lo chiama. Nessun subchart incluso; la selezione degli analyzer usa una mappa hard-coded e le chiamate fallite non sono fatali per l'esecuzione.
- Le ricerche **MISP** girano nel `misp_worker` della pipeline contro la tua istanza MISP; un subchart MISP incluso è rimandato a una release futura.
- Il codice di notifica **Slack** e di approvazione bidirezionale esiste nel repo ma **non è collegato al runtime del chart V1** — la coda di revisione della dashboard è oggi la superficie human-in-the-loop funzionante.

In altre parole: SocTalk pacchettizza il piano Wazuh multi-tenant e il livello di Triage, e *si connette alle* istanze TheHive/Cortex/MISP che gestisci tu. La comodità dei subchart inclusi è roadmap, non release.

## Stack fai-da-te o deploy di SocTalk?

Criteri onesti, dato che entrambe le strade sono open source:

**Costruisci da solo lo stack a quattro strumenti quando** sei una singola organizzazione con tempo di ingegneria a disposizione, vuoi il massimo controllo su ogni componente, il tuo volume di Alert è gestibile per il numero di analisti che hai e la multi-tenancy è irrilevante. Lo stack classico più il tuo collante è un pattern collaudato, e capirai ogni filo perché l'avrai saldato tu.

**Valuta SocTalk quando** sei un MSP/MSSP che ha bisogno di stack Wazuh per cliente ripetibili dietro un unico control plane, isolamento dei Tenant dimostrabile e un Triage AI che comprime il volume di Alert prima che gli analisti lo vedano — e preferisci gestire una sola piattaforma amministrata via Helm piuttosto che N stack costruiti a mano. Kubernetes lo gestisci comunque tu, e nella V1 continui a operare i tuoi TheHive, Cortex e MISP se li vuoi.

Il modo più rapido per valutare è la [VM demo](/it-it/quickstart-vm): un'immagine, un wizard nel browser, circa cinque minuti per un'installazione multi-tenant funzionante con un Tenant demo già onboardato. Da lì, [Come funziona](/it-it/how-it-works) spiega la pipeline, e le pagine [TheHive](/it-it/integrate/thehive) e [Cortex](/it-it/integrate/cortex) documentano esattamente cosa fanno — e cosa non fanno — le integrazioni della V1, così puoi pianificare il resto del tuo stack attorno a esse.
