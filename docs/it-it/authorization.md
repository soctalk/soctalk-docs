# Autorizzazione

## Questa attività era autorizzata?

La maggior parte di ciò che un SOC escala non è malevolo. Si tratta di una persona reale o di un sistema che svolge un lavoro reale che casualmente assomiglia a un attacco: un amministratore che usa un account break-glass alle 3 del mattino, una pipeline di deploy che tocca un file di configurazione, uno scanner che perlustra una subnet durante un pentest autorizzato. Se un alert sia benigno spesso non dipende dall'alert in sé, ma dallo stato dell'organizzazione che lo circonda. Due alert identici byte per byte possono avere disposizioni opposte a seconda soltanto del fatto che un change ticket, una finestra di manutenzione o una baseline approvata coprano l'attività.

L'autorizzazione è il livello che fornisce a SocTalk quel contesto sullo stato dell'organizzazione. Lega record tipizzati (change ticket, baseline permanenti, blocchi delle modifiche, divieti e fatti sulle entità relativi ad asset e account) all'attività presente in un alert, e ragiona sul fatto che un singolo record la copra interamente. Non fa che abbassare il sospetto trovando evidenze di copertura. Non lo alza mai, e non prevale mai su un segnale malevolo.

Non è un passaggio separato aggiunto al triage. È contesto che il loop agentico raccoglie mentre indaga, e si risolve in uno di tre stati che plasmano il verdict. Tutto ciò che avviene a valle passa comunque per il livello minimo di sicurezza, che l'autorizzazione non può mai indebolire.

![Dove si colloca l'autorizzazione nel flusso di triage](/diagrams/authorization-in-triage.svg)

## Coperto, contraddetto, assente

L'autorizzazione di ogni alert si risolve in uno di tre stati, e la differenza tra gli ultimi due è tutta la partita:

- **Coperto.** Un singolo record copre interamente l'attività: il giusto soggetto, target, azione, finestra temporale, validità di calendario e approvazioni. Il sospetto viene abbassato.
- **Contraddetto.** Ci sono record registrati ma nessuno di essi copre l'attività, oppure un divieto ad alta priorità proibisce l'azione. Un change ticket esiste ma è scaduto, oppure è per un host diverso, oppure il blocco delle modifiche che richiedeva non è mai stato oggetto di deroga. Questo è un rilievo, non un'assenza, ed escala a un umano.
- **Assente.** Non esiste alcun record del tipo giusto registrato. L'assenza non è mai trattata come autorizzazione. SocTalk chiede maggiori informazioni invece di presumere che l'attività fosse approvata.

Tenere distinti assente e contraddetto è importante. Un ticket obsoleto o errato non deve mai essere interpretato come "quasi autorizzato". È l'opposto: la documentazione che avrebbe dovuto coprire questa attività non lo fa, e ciò merita l'attenzione di un umano.

## Da dove provengono i fatti di autorizzazione

I fatti raggiungono l'archivio in tre modi, a livelli crescenti di attendibilità:

- **I tenant asseriscono fatti sul proprio ambiente.** Un cliente dichiara una finestra di manutenzione o una baseline permanente dall'area Autorizzazione. I fatti asseriti dal tenant restano in sospeso e non influenzano il triage finché un analista MSSP non li approva.
- **I sistemi inviano fatti tramite l'API di ingest.** Script di provisioning, hook CI e connettori inviano fatti tipizzati con una credenziale per-tenant. L'attendibilità viene apposta a partire dalla credenziale, mai dal payload, perché chi può inviare un fatto può sopprimere un rilevamento.
- **Gli analisti rispondono a una domanda di autorizzazione.** Quando il triage si arena specificamente perché l'autorizzazione è assente, l'analista risponde una volta e la risposta diventa un record riutilizzabile. È il flusso descritto di seguito.

## Registrare un fatto dalla console: un esempio pratico

I fatti non devono per forza provenire da un connettore o da un'indagine. Un analista MSSP o un amministratore del tenant può registrarne uno direttamente, e il form della console è costruito attorno al modello del fatto, così l'unica cosa che si può inviare è un fatto valido.

Prendiamo un caso comune. Il service account `svc-deploy` di Acme eseguirà comandi privilegiati su `db-01` durante la manutenzione di venerdì, approvata dal change ticket CHG-1001. Se non dichiarato, il `sudo` che quei comandi attivano assomiglia esattamente al tipo di uso di privilegi che un SOC escala. Registrare il change ticket come una concessione è ciò che dice a SocTalk che l'attività è coperta.

Apri l'area **Autorizzazione**. Sul lato MSSP, scegli prima il cliente dal selettore di tenant; un amministratore del tenant vede direttamente la propria organizzazione. L'elenco mostra ogni fatto registrato con un riepilogo in linguaggio naturale, la sua fonte e il suo livello di attendibilità, la sua validità e il suo stato di revisione.

![L'elenco dei fatti di autorizzazione: un change ticket coperto, un'asserzione del tenant in sospeso in attesa di revisione e un blocco delle modifiche](/screenshots/authz-facts-list.png)

Scegli **New fact** per aprire l'editor guidato. Scegli prima il **kind** (concessione, divieto, blocco delle modifiche o contesto entità) e il **track** (account, per l'attività su host descritta come soggetto, target e azione; oppure FIM, per le modifiche ai file descritte come un percorso e un tipo di modifica). Il form mostra quindi solo i campi legali per quella combinazione, così non puoi costruire un fatto che il motore rifiuterebbe: una concessione da change ticket richiede una data di fine, un divieto FIM non può portare un'azione di account, un blocco di account ha come ambito l'ambiente anziché la classe di configurazione. Una riga **Reads as** riformula il fatto in linguaggio naturale mentre digiti, e la fonte e il livello di attendibilità vengono apposti automaticamente anziché digitati a mano.

![L'editor guidato New fact, compilato per la concessione da change ticket, con l'anteprima dal vivo in linguaggio naturale](/screenshots/authz-new-fact.png)

Per il caso della manutenzione: kind **Grant**, track **Account**, soggetto `svc-deploy`, target `db-01`, azione `sudo-exec`, classe di concessione **Change ticket**, riferimento `CHG-1001`, valido fino alla fine della finestra. **Create fact** lo scrive, e compare nell'elenco con attendibilità asserita dall'analista. Da quel momento fino alla scadenza, un alert per quell'account, quell'azione e quell'host si risolve in coperto e il suo sospetto cala; dopo la scadenza lo stesso alert è di nuovo assente, e SocTalk torna a chiedere anziché presumere.

Un amministratore del tenant registra i fatti nello stesso modo, con una differenza: un'asserzione del tenant arriva **awaiting review** al livello di attendibilità più basso e non influenza il triage finché un analista MSSP non la approva da questo stesso elenco (la riga in sospeso qui sopra). Gli analisti che preferiscono lavorare in blocco, o pilotare l'archivio dall'automazione, possono passare l'editor a **Advanced: edit JSON** e inviare il fatto grezzo; la stessa validazione si applica in entrambi i casi.

## Rispondere a una domanda di autorizzazione

Quando un'indagine non può essere decisa perché l'autorizzazione è assente, e non c'è alcun segnale malevolo, la revisione porta con sé una domanda di autorizzazione tipizzata anziché una generica richiesta di maggiori informazioni. All'analista viene chiesta una sola cosa: questa attività era autorizzata?

![La domanda di autorizzazione tipizzata su una revisione, con un'azione di salvataggio](/screenshots/authz-ask-question.png)

Il pannello dichiara l'esatta attività in questione e offre un'unica azione, distinta dall'approvare o rifiutare. Se l'attività era autorizzata, l'analista imposta per quanto tempo l'autorizzazione deve valere e sceglie **Confirm authorized, save reusable authorization**. Questo scrive una concessione durevole asserita dall'analista, con ambito circoscritto esattamente a quell'attività (questo account, questa azione, questo host) con la scadenza scelta.

![L'autorizzazione riutilizzabile salvata, e la revisione rimossa dalla coda](/screenshots/authz-ask-saved.png)

La concessione salvata è il punto centrale. La volta successiva in cui la stessa attività produce un alert, ora un record la copre, quindi la domanda non viene posta di nuovo. Chiedi una volta, ricorda. L'autorizzazione ha come ambito l'esatta attività e porta con sé una scadenza, così non si allarga silenziosamente né dura per sempre, e compare nell'area Autorizzazione dove può essere revisionata o revocata in qualsiasi momento.

Una regola è deliberata: un fatto viene creato solo da questa risposta esplicita. SocTalk non apprende mai un'autorizzazione da una semplice chiusura o rifiuto. Un analista che svuota la coda non è la stessa cosa di un analista che dichiara che un'attività è autorizzata, e trattarla in questo modo lascerebbe che la pressione della coda avvelenasse silenziosamente l'archivio.

## Engagement

Un fatto risponde a una domanda permanente: questo account è autorizzato a fare questo su questo host? Alcune autorizzazioni non sono affatto permanenti, sono circoscritte a una finestra di tempo durante la quale un'attività altrimenti sospetta è attesa. Un pentest autorizzato, un'esercitazione red-team o una finestra di manutenzione sono un'autorizzazione che si apre e poi si chiude. SocTalk modella questo come un engagement, e un engagement è semplicemente un tipo di autorizzazione: una finestra di autorizzazione circoscritta e limitata nel tempo durante la quale l'attività che descrive è attesa anziché allarmante.

Gli engagement risiedono nella stessa area Autorizzazione del tenant in cui vivono i fatti, in una loro scheda Engagement dedicata. Il vecchio percorso `/engagements` funziona ancora e rimanda direttamente a quella scheda, dal momento che gli engagement sono stati integrati nell'area Autorizzazione unificata anziché mantenuti come superficie separata. Dichiararne uno è un form strutturato: un nome e un tipo, l'inizio e la fine della finestra, e l'ambito che copre come IP di source validati, host in-scope e ID di tecnica ATT&CK.

![Dichiarare un engagement: una finestra di pentest circoscritta con ambito per source, host e tecnica ATT&CK](/screenshots/authz-engagement.png)

Un engagement funziona però in modo diverso da un fatto. Non è soggetto a gating: un utente autorizzato dal tenant lo dichiara, e può revocarlo, direttamente, senza alcun passaggio di revisione MSSP. Ciò che un engagement fa è deconfliggere l'attività per source, target e finestra temporale validati. L'attività degli alert che ricade all'interno di un engagement dichiarato, una source in-scope che agisce su un target in-scope durante la finestra, viene attribuita al tester: SocTalk registra l'osservazione, toglie l'alert dalla coda aperta e salta il triage LLM per esso. Non viene mai chiuso automaticamente né marcato come falso positivo, la riga dell'osservazione resta interrogabile e conteggiata. L'attività del tester che ricade al di fuori dell'ambito dichiarato viene segnalata per un esame più attento anziché lasciata passare. Quando la finestra si chiude, la deconflittazione non si applica più e l'attività viene nuovamente sottoposta a triage in modo normale.

## I guardrail

L'autorizzazione è una superficie di soppressione, quindi i suoi limiti sono applicati nel codice, non lasciati alla formulazione del prompt:

- **L'assenza non chiude mai automaticamente.** L'assenza di un record di copertura significa che decide un umano, mai una chiusura automatica.
- **L'autorizzazione non prevale mai su un segnale malevolo.** Un fatto "autorizzato" salvato non può chiudere un alert che porta con sé anche un hit su un IOC, un enrichment malevolo o una correlazione con un incidente attivo. La correlazione viene eseguita prima della soppressione, e il livello minimo di sicurezza pone il veto su quei casi indipendentemente da qualsiasi fatto. Un'autorizzazione riutilizzabile abbassa il sospetto di routine; non rende il sistema cieco a un attacco reale che riutilizza la stessa attività.
- **La memoria è tipizzata e governata.** I fatti portano con sé una fonte, un livello di attendibilità, un ambito e una scadenza. Non sono mai memoria di prompt in forma libera, e i fatti ampi o privilegiati sono pensati per passare attraverso una revisione.
- **L'attendibilità è organizzata in livelli.** I record verificati dai connettori prevalgono su quelli asseriti dai sistemi, che prevalgono su quelli asseriti dagli analisti, che prevalgono sulla telemetria di routine, che prevale su quelli asseriti dai tenant. Un record ad attendibilità superiore corrobora o prevale su uno ad attendibilità inferiore.

## Dove compare

Il contesto di autorizzazione viene reso nel ragionamento dell'AI in ogni indagine che lo porta con sé, così il modello soppesa esso stesso le evidenze di copertura anziché ricevere un sì o un no già pronto. I fatti salvati, il loro stato di revisione e la loro scadenza sono elencati nell'area **Autorizzazione** della UI, dove un analista può revocare qualsiasi fatto. Vedi [Utenti e ruoli](/it-it/users-and-roles) per sapere chi può asserire, revisionare e rispondere, e [Revisione umana](/it-it/human-review) per la coda di revisione su cui viaggia la domanda di autorizzazione.
