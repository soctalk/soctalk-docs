# Triage Policies

Un LLM che esegue il triage di un alert `sudo` è un analista brillante e una garanzia scarsa. Poni la stessa domanda due volte e puoi ottenere due risposte. Digli di recuperare sempre il change record prima di decidere e lo farà, di solito, quasi sempre. Ma una parte del triage non è una questione di giudizio. Uno step di raccolta prove *deve* essere eseguito prima che un verdict conti. Una chiusura su un asset PCI *deve* fermarsi per un umano. Un'ondata di rumore da agent-health *non dovrebbe* costare nemmeno una chiamata al modello. Per questi casi non vuoi ragionamento. Vuoi una regola.

Una **triage policy** è quella regola, scritta come dati. Non sostituisce l'agente; avvolge alcune barriere deterministiche attorno all'**agentic loop** (il ciclo supervisore-e-strumenti che arricchisce, indaga e ragiona fino a un verdict). Ognuna di esse obbedisce alla stessa legge:

> **L'LLM propone. Una barriera deterministica dispone.**

Il modello resta libero di ragionare. Una funzione pura decide se il suo output ha effetto, e interviene solo sui casi limite che puoi *dimostrare*: un record di autorizzazione che contraddice l'attività, un IOC sull'alert, un incident attivo che condivide un'entità con questo. La zona grigia ambigua passa direttamente al modello, dove è giusto che sia.

![Come una triage policy viene valutata all'interno dell'agentic loop](/diagrams/triage-policy-loop.svg)

Leggila dall'alto verso il basso: un alert viene risolto rispetto al registry, esegue l'agentic loop sotto le barriere della policy e approda a una **disposition**: la decisione finale sul caso (chiusura automatica, escalation a un umano o richiesta di ulteriori prove). Sotto ogni chiusura automatica c'è un **safety floor**: un insieme di veti a livello di codice non sovrascrivibili che nessuna policy può indebolire, definiti per intero [più avanti](#the-safety-floor). Le barriere numerate sono l'intera superficie, e la prossima sezione le esamina una per una.

L'unica proprietà che rende tutto questo sicuro: una triage policy **redatta dal tenant** può rendere il triage **più severo**, mai più permissivo; i suoi guardrail possono solo alzare l'asticella, e il floor rigido sotto ogni chiusura non può essere indebolito. (Le policy *file* integrate e vagliate, gestite dall'operatore, sono codice fidato e non sono vincolate da tale limite.) Il codice risiede in [`src/soctalk/triage_policy/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/triage_policy).


## Dove agisce una triage policy

Una triage policy governa una singola run in quattro punti, le barriere numerate nel diagramma sopra.

1. **Resolver.** Un nodo di ingresso confronta l'alert con il registry e scrive la triage policy attiva nello stato della run. Se l'alert appartiene a una classe operativa nota priva di indicatori di sicurezza, la run può chiudersi deterministicamente qui senza mai chiamare il modello.
2. **Pre-decision gate.** Una policy può richiedere step deterministici (per esempio, la raccolta del contesto di autorizzazione) prima che un verdict sia lecito. Se il supervisore propone un verdict troppo presto, la barriera lo reindirizza prima allo step richiesto. Una policy può anche limitare quali azioni del supervisore sono lecite in ciascuna fase, e tale restrizione viene applicata all'output strutturato del modello prima della chiamata, così un'azione illecita non può nemmeno essere campionata.
3. **Post-verdict guard.** Dopo che il modello ha redatto un verdict, una funzione pura decide se esso viene confermato. Può sovrascrivere la bozza (elevare una chiusura a escalation), interromperla (mantenere la bozza ma instradarla verso l'approvazione umana) oppure lasciarla valida. Ogni override viene registrato.
4. **Safety floor.** Un insieme di controlli non sovrascrivibili che protegge ogni percorso di chiusura automatica. *Non* è un singolo step; i veti IOC/autorizzazione vengono eseguiti all'interno del post-verdict guard, mentre i veti kill-switch, volume-cap e active-incident vengono eseguiti di nuovo quando una chiusura viene confermata sui piani worker, server e ingest. Il diagramma lo rappresenta come un unico nodo per chiarezza; nulla in una triage policy può indebolirlo, ovunque venga eseguito.

## Il safety floor

Il floor è applicato nel codice, non nei dati della policy, e vale su ogni piano dove un caso può chiudersi automaticamente: la disposition del worker, il server che la conferma e le fast-path di ingest (chiusura memoizzata e auto-close basata su regole). Una chiusura viene posta sotto veto e il caso viene invece promosso o portato in escalation quando vale una qualsiasi di queste condizioni:

| Veto | Quando scatta |
|---|---|
| IOC presente | Sul percorso del verdict, un verdetto di enrichment malevolo o un match MISP; sulle fast-path di ingest, qualsiasi IOC grezzo sull'alert. |
| Autorizzazione contraddetta | Esistono record ma non coprono l'attività (scaduti, fuori finestra, ambito errato, vietati dalla policy). |
| IOC non verificato | Una chiusura di tier router con observable che nessun enrichment ha mai controllato. |
| Incident attivo | Un'altra indagine attiva condivide con questa un'entità idonea al collegamento. |
| Kill switch | L'auto-close è disattivata, per tenant o a livello dell'intera installazione. |
| Volume cap | Il conteggio mobile delle chiusure automatiche del tenant è esaurito. |

L'insieme effettivo di barriere su una qualsiasi run è il floor più ciò che la policy attiva aggiunge. Una triage policy può solo rendere le cose più severe. È questo che rende sicuro consentire policy redatte dal tenant: una policy mal configurata o ostile non può diventare un canale per sopprimere le detection.

Il kill switch e il volume cap meritano di essere conosciuti per nome. `SOCTALK_AUTO_CLOSE_KILL` sul processo API, oppure il flag di policy `auto_close_kill` su un tenant, trasforma ogni chiusura automatica in una promozione senza bisogno di alcun rollout, ed è il controllo a cui ricorrere nel mezzo di un incident. `auto_close_volume_cap` (default 500 ogni 24 ore) fa sì che un loop di chiusure fuori controllo degradi a "gli umani guardano queste" invece che a una soppressione di massa.

## Triage policy integrate

Due sono fornite con il prodotto. Entrambe sono codice vagliato e di sola lettura.

**`dual-use-privileged-exec`** gestisce attività di autenticazione host come `sudo` e `su`, dove lo stesso evento è amministrazione ordinaria sotto un change record che la copre e un incident senza di esso. Richiede lo step `gather_authorization_context` prima di qualsiasi verdict, rimuove `CLOSE` dalle azioni lecite del supervisore (così che il tier router economico non possa cortocircuitare un caso il cui punto centrale è proprio che benigno e ostile sembrano identici), e richiede l'approvazione umana su qualsiasi chiusura che tocchi un asset classificato PCI.

**`agent-health-operational`** gestisce il rumore di auto-monitoraggio degli agenti Wazuh, come la regola 202 "Agent event queue is flooded." Questa è una condizione infrastrutturale, non un evento di sicurezza, quindi la policy la chiude deterministicamente senza alcuna chiamata al modello, il che rende anche l'esito coerente invece che variabile da una run all'altra. Qualsiasi indicatore di sicurezza sull'alert (una tecnica MITRE, un IOC, un segnale malevolo, una classe non attestata o un livello Wazuh critico (12+)) pone il veto sulla chiusura deterministica e invia l'alert al triage completo.

Puoi vedere entrambe, con ogni barriera e guardrail espansi, nella pagina **Triage Policies** della dashboard MSSP.

## Lo schema

Una triage policy è composta da dati. Un unico interprete generico esegue un numero qualsiasi di esse.

```yaml
id: regulated-privileged-exec
version: 2
tenant: acme                       # a tenant slug or id; authored policies are always scoped
status: shadow                     # active | shadow
priority: 70                       # lower wins on a multi-match; authored/file >= 60
applies_to:
  rule_groups: [sudo]
  rule_ids: []
  authorization_tracks: [account]
required_steps: [gather_authorization_context]
decision_modules: [authorization_engine]
legal_actions:
  decide:  [VERDICT]               # an unlisted phase is unconstrained
close_signoff_data_classes: [pci]
guardrails:
  - when:
      "and":
        - "==": [{ "var": "authz.class" }, "contradicted"]
        - "==": [{ "var": "verdict" }, "close"]
    effect: override
    to: escalate
    reason: acted outside the terms of an authorization
```

Leggi quella condizione così: se la classe di autorizzazione risulta `contradicted` e il modello ha redatto un `close`, elevalo a `escalate`. Ogni nodo è un singolo operatore sui suoi argomenti, e `var` legge un campo dallo state contract.

| Campo | Significato |
|---|---|
| `applies_to` | Quali alert la policy governa. Il match avviene sui rule group, sui rule id o sull'authorization track dell'attività dell'alert; i tre sono in OR. |
| `required_steps` | Nodi deterministici che devono essere eseguiti prima che un verdict sia lecito. |
| `decision_modules` | Dichiara gli engine vagliati su cui la policy fa affidamento (oggi: `authorization_engine`), validati rispetto ai moduli noti. La consultazione a runtime è attualmente guidata da `required_steps` (per esempio `gather_authorization_context`), non da questo campo. |
| `legal_actions` | Le azioni del supervisore consentite per fase (`triage` finché gli step richiesti non sono stati eseguiti, poi `decide`). Una fase non elencata è priva di vincoli. |
| `close_signoff_data_classes` | Una chiusura in fase di commit su un asset in una di queste classi viene interrotta per l'approvazione umana. |
| `guardrails` | Regole dichiarative di override o interrupt. Vedi sotto. |
| `priority` | Ordine nel registry. Le policy integrate occupano 10 e 50; qualsiasi policy redatta o caricata da file deve essere 60 o superiore, così non può mai superare le protezioni di una integrata. |

Alcune capacità sono vincolate dalla provenienza di una policy:

- Le **disposition deterministiche** (il meccanismo che `agent-health-operational` usa per chiudere senza modello) sono **riservate alle integrate**: coniare una nuova classe di auto-close è una decisione di code review, non di configurazione.
- Le **policy redatte non possono concedere `CLOSE`** in `legal_actions`. Concederlo non aggiunge nulla rispetto a una fase priva di vincoli (la baseline consente già la chiusura del router) ma permetterebbe al remap delle azioni illecite di forzare ogni proposta a un'auto-close priva di verdict, appoggiata solo sul floor grossolano. Le decisioni terminali passano invece attraverso `VERDICT`; la validazione rifiuta `CLOSE` in qualsiasi fase. Le policy integrate e da file possono comunque elencare l'intero set di azioni.

## Condizioni dei guardrail

Le condizioni sono l'unica logica che un autore scrive, ed eseguono in un piccolo linguaggio in sandbox su uno state contract documentato. Non c'è accesso ad attributi, nessuna chiamata di funzione, nessun modo di nominare alcunché al di fuori del contract. Una condizione è un albero di nodi a operatore singolo.

Operatori: `var`, i confronti (`==`, `!=`, `<`, `<=`, `>`, `>=`), i logici `and` / `or` / `!` / `!!` e `in`.

I campi che una condizione può leggere:

| Campo | Che cos'è |
|---|---|
| `authz.class` | `covered`, `contradicted` o `absent`, derivato dall'engine. |
| `authz.in_scope`, `authz.sanctioned_or_routine`, `authz.actor_genuine`, `authz.policy_allowed` | I quattro *componenti di expectedness*: i booleani dell'authorization engine che indicano se l'attività è rientrata in un ambito approvato, era sanzionata o di routine, è stata eseguita da un attore genuino ed era permessa dalla policy. |
| `verdict` | La decisione in bozza del modello. |
| `verdict_confidence` | La sua confidenza, da `0.0` a `1.0`. |
| `asset.data_classification`, `asset.environment`, `asset.criticality` | Attributi risolti per trust dell'asset dell'attività. |
| `enrichment.ioc` | Se è presente un segnale malevolo. |
| `correlation.active_incident` | Se un incident attivo si sovrappone. |

Un `effect` è `override` oppure `interrupt`. La soppressione non è esprimibile: `close` non è un target valido, e un override può solo elevare una decisione lungo la scala `close < needs_more_info < escalate`, mai abbassarla. Una condizione che fa riferimento a un campo non dichiarato o a un operatore sconosciuto viene rifiutata quando la policy viene validata, prima ancora che possa essere eseguita. Nota che `enrichment.ioc` e `correlation.active_incident` sono applicati anche dal floor rigido indipendentemente da qualsiasi guardrail; in una run del worker in produzione `correlation.active_incident` è di solito popolato solo al floor in fase di commit, quindi affidati al floor per questi anziché riderivarli in un guardrail.

## Redigerne una nell'editor no-code

Gli admin redigono le triage policy dalla pagina **Triage Policies** mentre un tenant è fissato, senza alcun YAML richiesto. Questa guida percorre la costruzione di una policy reale e non banale dall'inizio alla fine. L'esempio, `prod-privileged-exec-strict`, governa gli alert di esecuzione privilegiata su un authorization track di tipo account: richiede prove di autorizzazione, restringe ciò che l'agente può fare e aggiunge guardrail solo-in-aumento più una barriera di chiusura PCI.

Apri **“+ New triage policy”** (oppure `/triage-policies/editor`). L'editor è a due colonne, il **form** del documento a sinistra, e a destra una **proiezione del decision-flow** live più un **simulatore “Try it”** che si ridisegnano a ogni modifica.

![L'editor no-code vuoto](/screenshots/triage-policy-editor-01-blank.png)

**1. Identità.** Assegna alla policy uno slug id e una **priority**: un intero con floor-gating (`≥ 60`) dove il valore più basso vince su un doppio match, così che una policy redatta non possa mai superare le protezioni integrate.

![Identità: slug e priority](/screenshots/triage-policy-editor-02-identity.png)

**2. Quali alert governa?** I tre matcher sono in OR. Qui la policy governa i rule group `sudo, su, sudoers`, i rule id `5402, 5501`, sul track `account`.

![Matcher](/screenshots/triage-policy-editor-03-matchers.png)

**3. Requisiti di indagine.** Richiedi lo step `gather_authorization_context`, dichiara l'affidamento al modulo `authorization_engine` e restringi la fase `decide` al solo `VERDICT`. Nota che `CLOSE` non è offerto, le policy redatte non possono concederlo.

![Requisiti di indagine](/screenshots/triage-policy-editor-04-requirements.png)

**4. Approvazione della chiusura.** Una chiusura in fase di commit su un asset classificato `pci` o `phi` viene trattenuta per un umano.

![Approvazione della chiusura](/screenshots/triage-policy-editor-05-signoff.png)

**5. Guardrail.** I guardrail vengono eseguiti dopo il safety floor, in ordine, vince il primo match. Ogni condizione può essere redatta come JSON, il dialetto in sandbox `{"op": [{"var": "field"}, value]}` con gruppi `and`/`or`…

![Redazione di una condizione come JSON](/screenshots/triage-policy-editor-06-guardrail-json.png)

…oppure nel visual builder, che effettua il round-trip con il JSON. Questo guardrail scatta quando l'autorizzazione è **contraddetta** *e* l'asset è **critico**, ed eleva la decisione a `escalate`.

![La stessa condizione nel visual builder](/screenshots/triage-policy-editor-07-guardrail-visual.png)

Altri due completano la policy: un override a bassa confidenza verso `needs_more_info` e un `interrupt` che trattiene una chiusura PCI per la revisione umana. L'ordine conta; il primo guardrail che matcha dispone.

![Tutti e tre i guardrail](/screenshots/triage-policy-editor-08-guardrails-all.png)

**6. Leggi il flusso, poi simula.** La colonna di destra proietta l'intero documento sulla pipeline: matcher → fasi → bozza LLM → **safety floor (sempre attivo)** → guardrail → approvazione → commit.

![Proiezione del decision-flow](/screenshots/triage-policy-editor-09-decision-flow.png)

Il pannello **“Try it”** anteprima la logica guardrail + floor che l'editor può modellare, un sottoinsieme del percorso completo di enforcement worker/server/ingest, per un feedback in fase di redazione. Fornisci un caso con autorizzazione contraddetta e asset critico e l'esito è `escalate`, ma proviene dal **safety floor**, non da questa policy. È l'invariante centrale reso visibile: l'autorizzazione contraddetta è un veto del floor non sovrascrivibile, e i guardrail della policy possono solo *elevare* al di sopra di esso.

![Il simulatore Try-it che mostra l'escalation del floor](/screenshots/triage-policy-editor-10-try-it.png)

`Create (shadow)` la salva. Il form e il documento memorizzato sono lo stesso artefatto; “View as JSON” mostra esattamente ciò che viene persistito.

![La policy completata](/screenshots/triage-policy-editor-11-complete.png)

La validazione al salvataggio è fail-closed e applica le stesse regole delle policy da file più alcune più severe: l'id deve essere uno slug, gli step referenziati, i decision module e le fasi delle azioni lecite devono essere quelli che il runtime conosce davvero, `CLOSE` non può essere concesso e la definizione ha un limite di dimensione. Un riferimento sconosciuto viene rifiutato in fase di redazione anziché ignorato silenziosamente a runtime. Ogni revisione salvata viene conservata come storico append-only.

## Shadow, poi attiva

Una policy redatta ha quattro stati, **draft**, **shadow**, **active**, **retired**. La valutazione in shadow è fortemente raccomandata ma non obbligatoria: una policy può essere attivata direttamente da draft.

In **shadow**, la policy viene matchata e i suoi guardrail valutati esattamente come farebbe una attiva, e le decisioni che avrebbe preso vengono scritte nell'audit trail, ma non cambia alcuna disposition. Questo ti dà prove reali di ciò che farebbe contro il traffico live prima che decida qualunque cosa.

**Attivarla** (l'azione **Activate** nella pagina Triage Policies) la fa entrare in vigore. Poiché il worker è un processo separato il cui registry si carica una sola volta all'avvio, l'attivazione non può limitarsi a cambiare un flag nel database; materializza la definizione nel ConfigMap del worker del tenant al successivo `tenant.reconcile`, e il **rollout del worker è la barriera di attivazione**: la policy inizia a governare solo quando un worker fresco la legge. Modificare una policy attiva la mantiene attiva e riavvia il rollout con la nuova definizione; disattivarla la riporta a shadow.

![Il ciclo di vita della policy redatta: shadow, poi attivazione per governare](/diagrams/triage-policy-lifecycle.svg)

Gli operatori che preferiscono gestire le policy come codice possono comunque seguire il percorso git: scrivere un file YAML nella directory montata e riavviare i worker. Lo stesso registry carica sia le policy redatte-e-attivate sia le policy da file scritte a mano.

## Il cablaggio

Due variabili d'ambiente lo trasportano:

- `SOCTALK_TRIAGE_POLICY_DIR` sul runs-worker è la directory da cui il registry carica all'avvio.
- `SOCTALK_TENANT_TRIAGE_POLICIES_DIR` sul controller è la directory montata dall'operatore che il percorso di provisioning legge, valida e renderizza nei chart value di ciascun tenant come ConfigMap montato.

Sul percorso provisionato via chart, le policy sono chart value del tenant (`runsWorker.triagePolicies`, renderizzate come il ConfigMap `soctalk-triage-policies`), e una modifica del contenuto imprime un checksum sul pod template così che una modifica riavvii il worker automaticamente. Il rollout è la barriera di attivazione: poiché il registry si carica una sola volta per processo, una policy inizia a governare solo quando un worker fresco la legge.

Ogni caricamento, skip e rifiuto viene loggato. Un file che fallisce la validazione per qualsiasi motivo (schema errato, un campo sconosciuto, una condizione malformata, una priority che supererebbe una integrata) viene rifiutato per intero e non governa mai nulla, così un rollout difettoso degrada a "quella policy non è attiva", mai a un enforcement errato.
