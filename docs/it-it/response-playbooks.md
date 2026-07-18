# Playbook di risposta

## Da un verdetto a un'azione

La [pipeline di triage AI](/it-it/ai-pipeline) di SocTalk esiste per rispondere a una sola domanda su un alert: è reale e cosa deve accadere al caso. Il loop agentico arricchisce l'alert, raccoglie contesto, indaga e ragiona fino a un verdetto, e la run termina con una disposizione. La disposizione è la decisione finale, una tra escalation a un essere umano, chiusura automatica come falso positivo, o richiesta di ulteriori evidenze. Quella decisione è il prodotto dell'intera pipeline a monte, ed è il punto in cui le [policy di triage](/it-it/triage-policies) svolgono il loro lavoro, mantenendo deterministiche le parti del triage che devono essere garantite e lasciando che il modello ragioni sul resto ambiguo.

Una disposizione di per sé non cambia nulla nel mondo esterno. Non apre un ticket, non allerta il reperibile, non consegna il caso a un SOAR, né stacca dalla rete un laptop compromesso. Un playbook di risposta è il livello che agisce sulla disposizione. Viene eseguito rigorosamente dopo che il triage ha confermato, legge ciò che il triage ha prodotto e lo trasforma in passi concreti.

Ciò che legge è un singolo oggetto tipizzato chiamato disposition envelope. SocTalk assembla l'envelope nel momento in cui la disposizione diventa definitiva, all'interno della stessa transazione di database, e trasporta tutto ciò su cui una risposta potrebbe basarsi. Ovvero la disposizione effettiva, cioè la decisione finale dopo che il safety floor ha detto la sua; il verdetto del modello e la sua confidenza; la severità dell'alert; i suoi rule group e rule id; le tecniche e le tattiche ATT&CK a cui è stato mappato; le entità e gli IOC coinvolti; e quali veti del safety floor sono scattati lungo il percorso. L'envelope è il contratto tra triage e risposta, ed è anche l'esatto payload che un playbook consegna a qualsiasi sistema a valle di esso.

![Come un playbook di risposta consuma la disposizione di triage e vi agisce](/diagrams/response-playbook-loop.svg)

Tutto ciò che segue è il lato destro di quell'immagine: come un playbook fa il match dell'envelope, quali azioni può intraprendere e come quelle pericolose restano dietro un essere umano. Il codice risiede in [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response).

## Cosa viene eseguito da solo e cosa richiede approvazione

Le azioni si dividono in due gruppi in base a quanto possono incidere sul tuo ambiente. Scrivere una nota sul caso o inviare una notifica a un webhook è sicuro da fare in autonomia, perché il peggio che possono fare è aggiungere rumore, quindi queste vengono eseguite immediatamente senza che nessuno le approvi. Isolare un endpoint o disabilitare un account è tutt'altra cosa, quindi queste non scattano mai da sole. Quando un playbook ne richiede una, non la esegue. Solleva una proposta sul caso, e un analista la revisiona e la approva prima che accada qualcosa. Il modello non intraprende mai un'azione di contenimento da solo durante il triage, e un playbook non può intraprenderne una da solo durante la risposta. In entrambi i casi una persona dà il via libera a qualsiasi cosa raggiunga un sistema in produzione.

Tre regole risiedono nel codice anziché nei dati del playbook, e nessun playbook può indebolirle. Una chiusura è la direzione che un attaccante vorrebbe più di tutte innescare, quindi sul percorso di chiusura un playbook può solo annotare o effettuare audit, mai intraprendere un'azione esterna. Il kill switch di dispatch, impostato con `SOCTALK_RESPONSE_DISPATCH_KILL` sul processo API o con il flag `response_dispatch_kill` su un tenant, ferma ogni risposta senza rollout, ed è il controllo a cui ricorrere quando un connettore inizia a comportarsi male nel mezzo di un incidente. E una risposta scatta solo se la disposizione ha effettivamente avuto effetto sul caso. Se un analista ha chiuso o unito l'indagine mentre la run era ancora in corso, nulla viene inviato contro uno stato che non è mai avvenuto.

## Le tre capability

Un playbook fa riferimento a una capability per nome e non può nominare nient'altro. Un nome sconosciuto viene rifiutato quando il playbook viene validato. Oggi vengono fornite tre capability.

`annotate_investigation` scrive una nota di sistema sul caso. Tocca solo SocTalk, viene eseguita da sola ed è l'unica azione consentita in una chiusura.

`notify_webhook` invia l'envelope firmato al webhook configurato del tenant. Questo è il passaggio di consegne verso un SOAR esterno. SocTalk firma l'envelope e lo invia, e il ricevente è responsabile di tutto ciò che accade dopo. Anche questa viene eseguita da sola.

`external_action` è quella che richiede approvazione. Invia un'azione denominata insieme all'envelope firmato a un endpoint configurato dall'operatore, ed è qui che il lavoro vero, isolare un endpoint o disabilitare un account, risiede al di fuori di SocTalk dietro un contratto stabile. Non viene mai eseguita senza che un analista l'abbia prima approvata.

Un dettaglio mantiene `external_action` sicura. L'autore di un playbook nomina un endpoint e un'azione, mai una URL. L'operatore mappa quel nome di endpoint a una URL reale e a un segreto di firma nella policy tenant `response_action_endpoints`, così un autore può chiedere di isolare sull'endpoint `edr` ma non può scegliere dove la richiesta effettivamente vada. Ogni richiesta è firmata via HMAC e rifiuta di raggiungere un indirizzo privato o link-local.

## Lo schema

Un playbook di risposta è dato, e un unico interprete ne esegue un numero qualsiasi. Il playbook che il tutorial qui sotto costruisce si presenta così:

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active or shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx), not names
  mitre_tactics: ["Lateral Movement"]   # tactic strings as your source emits them
response:
  on_escalate:
    - capability: external_action
      when: { ">=": [{ "var": "severity" }, 10] }
      params: { endpoint: edr, action: isolate_endpoint }
    - capability: notify_webhook
    - capability: annotate_investigation
      params: { body: "endpoint isolation proposed for lateral-movement alert" }
  on_close:
    - capability: annotate_investigation
      params: { body: "auto-closed as false positive" }
```

Il blocco `applies_to` decide quali alert il playbook possiede. Fa il match su rule group, rule id, id di tecnica ATT&CK o tattiche ATT&CK, e i quattro sono in OR tra loro, quindi il colpire di uno qualsiasi di essi è un match. Un `applies_to` vuoto fa match su ogni alert, il che va bene, perché le liste di disposizione decidono già quando un playbook scatta davvero. Il matching ATT&CK segue una regola. Le tecniche sono confrontate tramite il loro id canonico come `T1021`, mai per nome, perché i nomi leggibili dall'uomo sono instabili. Le tattiche sono confrontate con qualunque stringa l'alert source emetta, e Wazuh invia nomi come `Lateral Movement` anziché riferimenti `TA`.

Sotto `response`, `on_escalate` contiene fino a otto azioni da intraprendere quando il caso va in escalation, e `on_close` contiene fino a quattro azioni di livello annotazione per una chiusura automatica. Ogni azione è un nome di capability, una condizione `when` opzionale e un insieme di `params` che la capability legge. I params sono pass-through. `external_action` estrae da essi `endpoint` e `action` e inoltra il resto, e non ha bisogno che l'host di destinazione sia nominato nei params, perché l'intero envelope firmato viaggia con ogni richiesta e le entità sono contenute al suo interno.

## Condizioni

Una condizione `when` è l'unica logica che un autore scrive, e viene eseguita nello stesso piccolo linguaggio sandboxed dei guardrail di triage. È un albero di nodi a singolo operatore su un insieme fisso di campi, senza accesso ad attributi, senza chiamate di funzione e senza alcun modo di nominare qualcosa al di fuori del contratto. Gli operatori sono `var`, i confronti `==`, `!=`, `<`, `<=`, `>` e `>=`, i logici `and`, `or`, `!` e `!!`, e `in`. Un'azione scatta solo quando la sua condizione è verificata, e una condizione su dati assenti è semplicemente falsa anziché un errore.

I campi che una condizione può leggere provengono tutti dall'envelope. C'è la `disposition` effettiva e la `worker_disposition` che il modello ha proposto prima che il floor la modificasse; `floor_vetoed`, che indica se un veto del floor ha alterato l'esito; `verdict_confidence` e `severity`; i `rule.groups` e i `rule.ids` dell'alert; e i campi ATT&CK, `mitre.techniques` che contiene gli id canonici `Txxxx` e `mitre.tactics` che contiene le stringhe di tattica della source. Gli ultimi quattro sono liste, quindi li testi con `in`. Scrivere `{"in": ["T1021", {"var": "mitre.techniques"}]}` fa scattare l'azione quando l'alert porta la tecnica T1021. Fare riferimento a un campo o a un operatore che il contratto non dichiara fa rifiutare il playbook al momento del salvataggio, ben prima che possa mai essere eseguito.

## Costruirne uno nell'editor no-code

Gli admin creano playbook di risposta dalla pagina **Response Playbooks** mentre un tenant è pinnato, senza YAML richiesto. Questa guida ripercorre la costruzione del playbook `isolate-lateral-movement-endpoint` dallo schema qui sopra, dall'inizio alla fine. Propone di isolare un endpoint su un'escalation di lateral movement ad alta severità, notifica il SOC e annota il caso.

Apri **"+ New response playbook"** (oppure naviga a `/response-playbooks/editor`). L'editor è a due colonne. Il form del documento è a sinistra, e un diagramma di flusso live è a destra che si ri-renderizza a ogni modifica, mostrando la disposizione che si dirama verso le azioni, con quelle che richiedono approvazione instradate prima attraverso un passo di approvazione.

![L'editor no-code vuoto](/screenshots/response-playbook-editor-01-blank.png)

Inizia con l'identità. Assegna al playbook uno slug id e una priorità, dove un numero più basso vince su un match multiplo.

![Identità](/screenshots/response-playbook-editor-02-identity.png)

Poi, decidi quali alert possiede. I quattro matcher sono in OR. Questo playbook possiede i rule group `sudo` e `su` e, più utilmente, la tecnica ATT&CK `T1021` (Remote Services) e la tattica `Lateral Movement`, così scatta su qualsiasi alert mappato a lateral movement, qualunque regola l'abbia sollevato. Il campo tecnica accetta id, non nomi, e il campo tattica accetta la stringa che la tua source emette.

![Matcher, incluso ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

Ora l'azione di isolamento. In escalation, aggiungi `external_action`, quella contrassegnata "needs approval". Nomina l'endpoint che l'operatore ha configurato e l'azione, che è `isolate_endpoint`, nei suoi params, e non inserisci mai una URL. Aggiungi una condizione così scatta solo su un'escalation ad alta severità.

![L'azione di isolamento con una condizione](/screenshots/response-playbook-editor-04-isolate.png)

Aggiungi le due azioni che completano la risposta e vengono eseguite da sole. Un `notify_webhook` consegna il caso al SOAR del SOC, e un `annotate_investigation` lascia una traccia di audit.

![Le azioni di notifica e annotazione, che vengono eseguite da sole](/screenshots/response-playbook-editor-05-tier0.png)

Leggi il flusso mentre costruisci. La colonna di destra proietta l'intero documento. La disposition envelope si dirama verso ogni azione, l'azione di isolamento viene instradata attraverso un passo di approvazione prima di poter essere eseguita, e le altre due sono mostrate mentre vengono eseguite da sole.

![Il diagramma di flusso, con l'azione di isolamento instradata attraverso l'approvazione](/screenshots/response-playbook-editor-06-flow.png)

Salvare con **Create (shadow)** lo persiste. Il form e il documento memorizzato sono lo stesso artefatto, e "Preview JSON" mostra esattamente ciò che viene salvato. La validazione al salvataggio è fail-closed. L'id deve essere uno slug, ogni capability deve essere uno dei nomi verificati, `on_close` può solo annotare, e le condizioni devono fare riferimento al contratto dichiarato. Un riferimento sconosciuto viene rifiutato mentre stai creando, mai scartato silenziosamente a runtime.

![Il playbook completato nella lista, pronto per l'attivazione](/screenshots/response-playbook-editor-07-list.png)

## Shadow, poi attivare

Un playbook creato attraversa quattro stati: draft, shadow, active e retired.

In shadow, il playbook viene matchato e le sue azioni sono selezionate esattamente come farebbe uno attivo, e le sue azioni would-fire vengono scritte nella traccia di audit, ma nulla viene messo in coda. Questo ti dà evidenza reale di ciò che farebbe contro il traffico live prima che faccia qualcosa.

Attivarlo, con l'azione **Activate** sulla pagina Response Playbooks, lo accende, e a differenza di una policy di triage ha effetto live. SocTalk valuta i playbook di risposta man mano che ogni caso viene deciso, così un playbook attivo si applica alla disposizione immediatamente successiva senza rollout da attendere. Disattivarlo lo riporta subito a shadow.

Quando un'azione che richiede approvazione emerge su un'escalation reale, arriva come proposta sul caso. L'analista vede esattamente cosa verrebbe eseguito e contro quale host, e approvarla è ciò che innesca l'isolamento. L'azione viene eseguita una volta, la risposta ricevuta viene registrata, e una consegna ripetuta non la esegue mai due volte.

## Il cablaggio

Alcuni pezzi reggono tutto questo. `SOCTALK_RESPONSE_PLAYBOOK_DIR` sul processo API è una directory di playbook YAML caricati all'avvio, che è il percorso gestito da git per gli operatori che preferiscono i playbook come codice. I playbook creati nella UI risiedono invece nel database, conservati come storia append-only e con scope così che un tenant veda sempre e solo i propri, e SocTalk li unisce con i playbook da file in modo che il playbook di un tenant sovrascriva quello da file con lo stesso id. `response_webhook_url`, con un `response_webhook_secret` opzionale, imposta la destinazione di `notify_webhook` su un tenant. E `response_action_endpoints` su un tenant mappa i nomi di endpoint alla loro url e al loro segreto per `external_action`, che è il modo in cui l'operatore mantiene il controllo delle destinazioni mentre un playbook ne nomina sempre e solo una.

Ogni match, approvazione, azione e rifiuto viene loggato, e ogni azione eseguita registra l'id e la versione del playbook insieme alla risposta ricevuta. Un playbook che fallisce la validazione viene rifiutato per intero e non ha mai effetto, così una modifica errata finisce come "quel playbook non è attivo" anziché come un'azione sbagliata.
