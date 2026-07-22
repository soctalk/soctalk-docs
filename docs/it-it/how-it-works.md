# Come funziona

## Il problema

Un SOC annega negli alert. Una singola scansione può generarne migliaia, la maggior parte di ciò che viene escalato si rivela benigno e gli analisti si esauriscono svuotando una coda che è per lo più rumore. La parte difficile non è rilevare le cose. È decidere, in modo rapido e sicuro, quali tra le cose che sono scattate contano davvero.

## Tre generazioni di triage SOC

Gli strumenti di triage hanno attraversato tre generazioni e ciascuna ha risolto il problema della precedente lasciando però un proprio punto cieco.

La prima generazione sono le **regole**: regole di firma e correlazione in un SIEM, e automazione deterministica in un SOAR. È veloce, verificabile e prevedibile, ed è per questo che gira ancora sotto tutto il resto. È anche grossolana. Una regola scatta su tutto ciò che la soddisfa, quindi è rumorosa, e un umano deve comunque leggere quasi tutto. È un rilevatore di fumo: affidabile, ma non sa distinguere un incendio vero da un toast bruciato.

La seconda generazione ha aggiunto il **machine learning**: classificatori supervisionati, rilevamento delle anomalie e analytics del comportamento utente che imparano com'è il normale e assegnano un punteggio a ciò che non lo è. Questo ordina la coda e fa emergere i casi anomali, ma richiede dati etichettati, va incontro a drift man mano che l'ambiente cambia e ti consegna un punteggio anziché una ragione. È un filtro antispam: ordina il mucchio, ma ti dà un numero, non una spiegazione.

La terza generazione sono i **language model**, che sanno ragionare su un alert nel suo contesto e spiegarsi in linguaggio naturale. La prima ondata di strumenti SOC basati su AI li ha usati nel modo più ovvio, puntando un modello su ogni alert, prompt in ingresso e verdict in uscita. Il problema è che un modello che legge un singolo alert isolato non ha memoria di ciò che un analista ha già deciso, nessun quadro dello stato dell'organizzazione stessa (quindi non sa distinguere una modifica autorizzata da un attacco che appare identico), nessuna garanzia di non chiudere con sicurezza su un indicatore reale e nessuna percezione degli altri alert attorno. Eseguire un modello di frontiera su ogni alert grezzo è inoltre costoso, e il costo spinge i team verso modelli più deboli proprio nei casi in cui il giudizio conta di più. È un analista brillante al suo primo giorno: ragiona bene su qualsiasi singolo alert, ma non ricorda nulla di ieri e non gli sono stati consegnati il calendario delle modifiche o l'elenco degli asset.

![L'evoluzione del triage SOC: regole, machine learning, language model e la generazione agentica che SocTalk rappresenta](/diagrams/soc-evolution.svg)

Ogni generazione è davvero valida in qualcosa, e nessuna di esse è sbagliata. Il problema è che la maggior parte dei prodotti ne sceglie una e ci si appoggia.

## Cosa fa SocTalk in modo diverso

SocTalk è la generazione agentica. Dove la prima ondata puntava un modello su un singolo alert, SocTalk esegue un loop agentico attorno al modello: il modello dirige un'indagine deterministica, ragiona sull'intero caso correlato e restituisce un verdict che guida un'azione governata, con un umano a fare da gate su tutto ciò che è pericoloso. Tutto gira all'interno di guardrail deterministici. Mantiene nel codice le garanzie dell'era delle regole e salta deliberatamente il centro opaco. Il collasso del rumore che il machine learning si era proposto di ottenere viene invece fatto in modo deterministico, tramite coalescing, correlazione e chiusura basata su regole, così che nulla nel percorso decisionale sia una black box addestrata. Il modello viene speso solo sui casi ambigui. Poi vengono aggiunte due cose che nessuna delle generazioni precedenti aveva: la pipeline ricorda ciò che gli analisti decidono, e un umano fa da gate su tutto ciò che tocca un sistema vivo.

Detto altrimenti, il modello è un componente, non l'intero sistema. Il rumore viene collassato prima che qualsiasi modello venga eseguito. Al modello viene fornito un contesto organizzativo reale. Le decisioni critiche per la sicurezza stanno dietro un **safety floor**, un piccolo insieme di veti rigidi scritti nel codice che né una regola né il modello possono disattivare, come un interruttore automatico che stacca la corrente qualunque cosa stia chiedendo il cablaggio. Le decisioni degli analisti vengono ricordate. E il verdict guida un'azione governata, il livello SOAR del sistema, con un umano che approva tutto ciò che è pericoloso. Il risultato è che il modello ragiona sul centro ambiguo, e le parti che devono essere garantite restano garantite.

![La pipeline di triage di SocTalk: un imbuto di ingest deterministico, una run agentica in cui il modello viene consultato in soli due ruoli, e un'azione governata](/diagrams/triage-pipeline.svg)

## Due piani e una finestra di assestamento

La pipeline si articola su due piani, o fasi, e sapere quale è quale spiega gran parte del design.

L'**ingest plane** è lato server e completamente deterministico. Quando un adapter (il collector lato tenant che inoltra gli alert di Wazuh e simili) invia un batch di eventi, questi vengono deduplicati, coalescati, correlati, deconflittati e in molti casi risolti senza che alcun modello venga mai eseguito. Nessun modello tocca questo piano.

Il **graph plane** è il loop agentico, uno per tenant, che gira come proprio processo. È dove il modello ragiona, e consulta il modello in soli due ruoli: il routing e il verdict finale. Molti casi richiedono ancora meno, chiudendosi su una policy deterministica senza alcuna chiamata al modello. Il loop non tiene alcun database proprio: il caso gli viene consegnato quando la run inizia e il suo risultato viene restituito quando la run finisce, e il suo enrichment avviene tramite chiamate a tool verso il SIEM e i servizi di threat intel.

Tra i due si trova una **finestra di assestamento** opzionale. Quando un tenant ne configura una, una run promossa viene trattenuta per un breve ritardo così che una raffica di alert correlati possa prima accumularsi, e il modello guarda l'intero incidente una volta sola anziché ogni frammento man mano che arriva. Un alert ad alta severità aggira l'attesa.

L'azione sul verdict avviene di nuovo sul server, in modo deterministico, dopo il completamento della run. Questo tiene il modello fuori dal loop che tocca i sistemi esterni.

## In entrata: l'imbuto deterministico

Molti alert vengono risolti prima ancora che un modello venga consultato, il che aiuta a mantenere la pipeline economica e veloce, ed è tutto codice deterministico.

**Coalescing e deduplicazione fanno collassare la tempesta.** La deduplicazione scarta un evento riprodotto che porta un ID già visto. Il coalescing raggruppa poi alert ripetuti dalla stessa regola sullo stesso asset entro una finestra di cinque minuti in un unico caso, così che una raffica dello stesso rilevamento diventi un caso solo anziché migliaia. Il modello, e l'analista, vedono un caso per incidente anziché il flusso grezzo a piena portata. ([correlazione e coalescing nell'IR core](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/triage.py))

**La correlazione mantiene un incidente in un caso.** Con la correlazione delle entità abilitata, un nuovo alert che condivide un'entità forte (un identificatore affidabile come un host o un hash di file) con un'indagine attiva vi si aggancia come evidenza anziché avviare una nuova run priva di contesto. Una sorgente che inizia a dominare la correlazione, come un IP di uno scanner che tocca tutto, viene declassata così da non poter trascinare alert non correlati in un unico caso. La correlazione gira prima dei percorsi di chiusura, così che un alert dall'aria benigna che appartiene a un incidente vivo non venga silenziosamente soppresso.

**La deconfliction degli engagement tiene i test autorizzati fuori dalla coda.** Quando è abilitata, una finestra dichiarata di pentest o red team viene abbinata per sorgente, host, tecnica e tempo. L'attività al suo interno viene segnalata e sottoposta ad audit ma mai chiusa automaticamente, e l'attività dei tester che esce dal perimetro viene forzata a una revisione umana anziché chiusa. Vedi [Utenti e ruoli](/it-it/users-and-roles) per come gli engagement vengono dichiarati e revisionati.

**La chiusura deterministica gestisce i casi ovvi.** I falsi positivi a bassa severità e ad alta confidenza si chiudono per regola, e una forma benigna ricorrente può chiudersi facendo riferimento a una decisione precedente, entrambi senza un modello. Le bande di chiusura dei falsi positivi e il percorso di chiusura operativa escludono deliberatamente tutto ciò che è mappato a una tecnica ATT&CK (un ID standard di tecnica di attacco), così che un alert mappato a una tecnica non venga chiuso come rumore di routine.

**Il safety floor di ingest protegge tutto questo.** Nessuna chiusura deterministica può scattare su un indicatore noto (un observable sospetto come un IP o un hash di file malevolo), un incidente attivo o un kill switch (un'impostazione dell'operatore che ferma l'azione automatica), e un tetto di volume agisce da interruttore automatico così che una regola fuori controllo degradi a "guardano gli umani" anziché a una soppressione di massa.

Tutto ciò che sopravvive all'imbuto viene promosso: diventa un'indagine, schedulata per una run di triage.

## La run di triage: due ruoli del modello, e molto determinismo

La run è un loop agentico, ma l'impronta del modello al suo interno è piccola e deliberata.

Il loop si apre con un gate deterministico. Se l'alert corrisponde a una [triage policy](/it-it/triage-policies) la cui disposition (l'esito da applicare: chiudi, escala o chiedi maggiori informazioni) è garantita e non contrastata, viene risolto lì, e il modello non viene mai consultato.

Per tutto il resto, un **supervisor** decide cosa fare dopo. Questo è il primo dei due ruoli del modello, e il suo intero compito è il routing: indagare, arricchire, contestualizzare, decidere o chiudere. Non svolge di per sé alcun lavoro di dominio, e può richiedere diversi turni di routing prima di decidere.

Il lavoro a cui indirizza è deterministico. Gli **step di enrichment** estraggono il contesto di host e processo dal SIEM, verificano la reputazione degli observable tramite gli analyzer di Cortex e cercano il contesto di threat intel in MISP. Sono chiamate a tool ed euristiche, non chiamate al modello. Un fraintendimento comune sul triage con AI è che sia il modello a fare l'enrichment. Qui non lo fa: l'enrichment è orchestrazione deterministica di tool, e il modello si limita a leggere i risultati.

Lungo il percorso la run raccoglie il suo [authorization context](/it-it/authorization): i fatti sullo stato dell'organizzazione (ticket di modifica, manutenzione approvata, contesto di account e asset) che dicono se questa attività fosse autorizzata. L'authorization è ciò che permette alla pipeline di separare una modifica autorizzata da un attacco che produce un alert byte per byte identico, una distinzione che nessuna quantità di lookup di reputazione può fare.

Quando il supervisor ne ha abbastanza, passa la mano al **verdict**, il secondo ruolo del modello. Questo è l'unico punto in cui un modello di ragionamento pesa tutto ciò che la run ha raccolto e propone una disposition: chiudi, escala o chiedi maggiori informazioni.

Poi il determinismo riprende il comando. Il verdict è una proposta, non un commit. Un guard di [triage policy](/it-it/triage-policies) può solo mai innalzare la decisione del modello, mai abbassarla: una chiusura proposta su un segnale malevolo o su un record di authorization contraddetto viene trasformata in un'escalation, e il vocabolario del guard rende la soppressione impossibile da esprimere. Se una chiusura proposta tocca un asset sensibile, viene trattenuta per il via libera di un umano. Il modello propone; il codice deterministico dispone.

## Le garanzie: un safety floor in tre punti

La regola per cui l'authorization, e il modello, non possono mai chiudere su un segnale malevolo noto, un indicatore non verificato o un caso correlato attivo non è affidata alla formulazione del prompt. È imposta nel codice, in tre punti indipendenti sul percorso di chiusura:

- **All'ingest**, prima di ogni chiusura deterministica, ancorata a un indicatore noto, un incidente attivo, un kill switch e il tetto di volume.
- **Durante la run**, quando il modello propone una chiusura, ancorata a un indicatore noto, un indicatore non verificato e un record di authorization contraddetto. Questo è l'unico floor che consulta affatto l'authorization.
- **Sul server**, quando la chiusura viene committata, ancorata al kill switch, a un altro caso attivo che condivide le stesse entità e al tetto di volume.

Ogni percorso di chiusura ha il proprio floor nel suo punto: una chiusura deterministica di ingest supera il primo, e una chiusura proposta dal modello supera il secondo e poi il terzo. L'authorization può abbassare il sospetto a quel floor intermedio, ma non può mai convincere nessuno di essi a lasciar correre un indicatore noto o un caso correlato attivo. Vedi [Authorization](/it-it/authorization) per come l'evidenza a copertura abbassa il sospetto senza mai scavalcare un segnale malevolo.

## Agire sul verdict

Una volta completata la run, il server committa la disposition e vi agisce, in modo deterministico e in un'unica transazione.

Un'escalation atterra nella coda di [revisione umana](/it-it/human-review) con l'evidenza reale allegata. Quando la run si è arenata specificamente perché l'authorization era assente, la revisione porta una domanda di authorization tipizzata, e la risposta dell'analista viene salvata come fatto riutilizzabile, così che la stessa attività non venga richiesta di nuovo finché quell'authorization vale. Quella memoria "chiedi una volta sola" è descritta nella pagina [Authorization](/it-it/authorization).

Un verdict guida anche i [response playbook](/it-it/response-playbooks). Questo è il livello SOAR del sistema, lo stesso tipo di automazione deterministica e governata che un analista SOAR riconoscerebbe, salvo che è guidato da un verdict ragionato anziché da una regola fragile, ed è dove si manifesta la postura dell'"azione governata". Le azioni sicure, scrivere una nota o notificare un webhook, girano da sole. Le azioni che toccano un sistema vivo, isolare un endpoint o disabilitare un account, non girano mai da sole: vengono sollevate come proposta e un analista le approva prima. Una chiusura può solo mai annotare, un kill switch di dispatch ferma subito le azioni di risposta attive (gli audit shadow possono comunque registrare cosa sarebbe scattato), e l'intero dispatch avviene lato server, mai dal loop del modello.

Un ultimo tocco deterministico gestisce il tempismo. Se nuova evidenza correlata è arrivata mentre la run era in corso e il caso è ancora aperto, viene avviata una run di follow-up sul quadro ora completo, così che un alert arrivato in ritardo non resti abbandonato fuori dal caso a cui appartiene.

## Cosa rende tutto questo diverso

Messe insieme, alcune proprietà distinguono tutto questo dal puntare un modello su ogni alert:

- **Molti alert non raggiungono mai un modello.** Dedup, coalescing, deconfliction e chiusura deterministica ne risolvono molti all'ingest, così che il modello venga speso sui casi ambigui.
- **Una run consulta il modello in soli due ruoli**, il routing e il verdict finale, e molti casi si chiudono in modo deterministico senza alcuna chiamata al modello. L'enrichment è orchestrazione deterministica di tool, non classificazione del modello per singolo alert.
- **Un incidente è un caso.** Coalescing e correlazione danno al modello l'intero quadro correlato, non un alert solitario privato del suo contesto.
- **Il modello propone, il codice dispone.** Un guard e un safety floor in tre punti rendono strutturalmente impossibile per il modello chiudere su un indicatore noto, un record di authorization contraddetto o un caso correlato attivo.
- **La pipeline ragiona sull'authorization.** Sa distinguere una modifica autorizzata da un attacco che le somiglia in modo identico, un giudizio che reputazione e firme non possono fare da sole.
- **Ricorda.** La decisione di authorization di un analista diventa memoria riutilizzabile, così che la coda smetta di porre una domanda già risposta finché quell'authorization vale.

## Dove andare dopo

Ogni fase ha la propria pagina e il proprio codice:

- [Authorization](/it-it/authorization), il ragionamento sullo stato dell'organizzazione e la memoria "chiedi una volta sola".
- [Triage Policies](/it-it/triage-policies), i guardrail deterministici sulla run.
- [Response Playbooks](/it-it/response-playbooks), trasformare un verdict in azione governata.
- [Revisione umana](/it-it/human-review), la coda di revisione e il percorso decisionale dell'analista.
- [AI pipeline](/it-it/ai-pipeline), il grafo agentico più in dettaglio.
- [Architettura](/it-it/reference/architecture), il deployment e il modello dati.

Il codice della pipeline si trova sotto [`src/soctalk/core/ir/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/core/ir) (ingest plane), [`src/soctalk/graph/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/graph) e [`src/soctalk/supervisor/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/supervisor) (graph plane), e [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response) (response).
