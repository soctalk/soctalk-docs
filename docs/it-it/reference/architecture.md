# Architettura

> **Nota sul deployment V1.** La nomenclatura degli elenchi di entità qui sotto usa i prefissi legacy "case_*" per diverse tabelle; i nomi effettivi dello schema V1 sono: `cases`, `investigation_runs`, `investigation_events`, `investigation_iocs`, `investigation_assets`, `investigation_links`, `investigation_outbox`, `proposals`. Il nome della tabella `cases` resta invariato per retrocompatibilità, ma tutte le tabelle figlie per-indagine usano il prefisso `investigation_*`. Di queste, le tabelle cases / investigation_runs / investigation_events sono utilizzate dall'orchestratore attuale; `proposals` e `investigation_outbox` sono presenti nello schema ma il lato executor che le consuma è sulla roadmap. Leggi questa pagina come intento architetturale; consulta [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) per lo schema esatto.

## 1. Entità principali

Forma minima. Gli elenchi completi delle colonne risiedono nella migrazione; qui
sono nominati solo i campi portanti.

```
alerts               raw ingest from adapter; AI-triaged
cases                investigation unit; one run at a time
case_runs            a single AI execution span against a case
case_events          ordered event inbox per case (immutable)
proposals            AI-proposed actions awaiting human gate
execution_log        append-only audit of all meaningful actions
notes                markdown / evidence blocks
iocs                 typed artifacts; carry external_context
case_iocs, case_assets   bridge tables
case_links           related-case edges (shared IOC / asset / rule)
case_outbox          outbound work for executors and exports
```

Ogni riga che trasporta contenuto porta con sé `tenant_id`, `visibility` e
`created_at`. Le RLS si applicano per Tenant.

## 2. Modello di visibilità

Classi (enum):

```
mssp_only         default; internal reasoning, raw tool output, hypotheses
customer_safe     approved for customer view
system            lifecycle and state-change events, always visible
tool_output       classified per-tool at registration time
```

Regole:

1. `visibility` è una colonna presente su ogni riga visibile all'utente (messaggi, note,
   proposte, record tool_output, voci della timeline, campi del pannello dei fatti).
2. Il valore predefinito all'inserimento è `mssp_only`. La promozione a `customer_safe` è
   un'operazione esplicita.
3. Le query del portale cliente filtrano a livello di policy RLS, non in fase di
   rendering. Una sessione customer-viewer non può leggere le righe `mssp_only` nemmeno
   tramite SQL grezzo.
4. Le proposte hanno visibilità a livello di campo: `{action, outcome}` può essere
   `customer_safe` mentre `{rationale, blast_radius}` resta `mssp_only`.
   Reso come due proiezioni.
5. Ogni promozione di visibilità emette una voce `execution_log` con l'attore
   e la motivazione.

Default-deny-promotion: le policy possono declassare la visibilità ma non possono
elevarla senza un'azione esplicita da parte di un principal autorizzato.

## 3. Ciclo di vita del run

Stati:

```
active           run consuming events and taking steps
waiting_on_gate  a proposal is pending; run does not mutate state
halted_budget    budget exceeded; requires analyst resume
paused           analyst-paused
completed        case closed
failed           unrecoverable error; requires analyst resume or restart
```

Transizioni:

```
active → waiting_on_gate     on proposal created (status = proposed)
waiting_on_gate → active     on proposal approved/rejected (new event)
active → halted_budget       on budget exceeded
halted_budget → active       on analyst resume (grants new budget)
active → paused              on analyst pause
paused → active              on analyst resume
active → completed           on case close
* → failed                   on uncaught error, preserved for diagnosis
```

Invarianti:

- Al massimo un run per case negli stati `active | waiting_on_gate |
  halted_budget | paused`. Applicato tramite un indice univoco parziale su
  `case_runs(case_id) WHERE status IN (...)`.
- Contatori di budget sul run: `tokens_used`, `dollars_used`,
  `tool_calls_used`, `wall_clock_ms`. Applicati lato server; avviso soft
  al 75%, arresto hard al 100%.
- Un run in `waiting_on_gate` non elabora eventi dell'inbox tranne gli
  eventi di risoluzione del gate (proposal.approved / .rejected).

## 4. Event inbox, ordinamento, coalescenza, idempotenza

Tutto il lavoro in ingresso per un case atterra in `case_events`:

```
event_id              uuid PK
case_id               FK
run_id                FK nullable
seq                   bigint, case-scoped monotonic (sequence)
kind                  enum (alert_ingested, tool_result,
                            proposal_approved, proposal_rejected,
                            analyst_message, analyst_correction,
                            budget_warning, external_signal, ...)
payload               jsonb
causation_event_id    uuid nullable (which event caused this one)
correlation_id        uuid (spans a causally-related fan-out)
idempotency_key       text unique per case
created_at            timestamptz
```

Regole:

1. `seq` è assegnato da una sequenza con ambito per case all'inserimento. I consumatori leggono
   rigorosamente in ordine di `seq`.
2. `idempotency_key` è univoco per `case_id`. L'inserimento duplicato viene
   scartato silenziosamente (restituisce la riga esistente).
3. Coalescenza: prima dell'inserimento, gli eventi che corrispondono a `(case_id, kind,
   payload.signature, window)` si fondono in un'unica riga. La firma è
   specifica per kind (alert: fingerprint di IOC + rule + asset; tool_result:
   tool_id + hash dei params).
4. `causation_event_id` collega causa → effetto per il replay.
   `correlation_id` raggruppa gli eventi da un singolo trigger esterno o
   azione dell'analista.
5. Gli eventi sono immutabili. Gli aggiornamenti si esprimono come eventi successivi.

Esempio di burst: 100 alert simili sullo stesso host in 5 minuti coalescono in un unico
evento `alert_ingested` che trasporta una lista `asset_ids: [...]`. Il run
lo elabora una sola volta.

## 5. Ciclo di vita della proposta e contratto di esecuzione

Stati:

```
draft        being composed by the AI
proposed     submitted to human gate
approved     human approved (with typed reason if required)
rejected     human rejected (reason required)
executing    outbox picked up; executor running
executed     action complete, result recorded
rolled_back  post-execution reversal (rare, analyst-initiated)
failed       executor error
```

Idempotenza:

```
proposal.idempotency_key = sha256(case_id || action_type ||
                                   canonical_json(params))
```

Le proposte duplicate all'interno di una finestra attiva (default 15 minuti) vengono
rifiutate all'inserimento. Garantisce che l'AI non possa fare doppio invio nemmeno in
caso di ri-esecuzione.

Comportamento del gate:

- Su `proposed`: il run passa a `waiting_on_gate`.
- Su `approved`: inserisce una riga in `case_outbox` con
  `kind = 'execute_proposal'`, `idempotency_key = proposal.idempotency_key`.
  Emette `proposal_approved` in `case_events`. Il run riprende.
- Su `rejected`: emette `proposal_rejected` con motivazione in
  `case_events`. Il run riprende. Nessuna riga di outbox.

Esecuzione:

- Un executor worker separato consuma `case_outbox` ed esegue
  l'azione.
- In caso di successo: registra `execute_proposal_result` in `case_events`,
  aggiorna la proposta → `executed`, scrive una voce `execution_log`.
- In caso di errore: registra l'errore, aggiorna la proposta → `failed`, scrive una voce
  `execution_log`. Il run può proporre un nuovo tentativo.
- Exactly-once tramite `idempotency_key`: le righe di outbox con chiavi duplicate
  vengono rifiutate. Gli executor worker rivendicano le righe con un lease (es.,
  `FOR UPDATE SKIP LOCKED`).

Il run AI non esegue side effect inline. Tutto passa
attraverso l'outbox.

## 6. Schema e invarianti dell'execution log

Append-only, separato dalla conversazione:

```
log_id              uuid PK
case_id             FK
run_id              FK nullable
actor_kind          enum (ai, human, system, executor)
actor_id            text
kind                enum (tool_call, proposal_state_change,
                          approval, override, visibility_promotion,
                          correction_applied, policy_bound,
                          export_emitted, ...)
subject_type        enum (case, proposal, ioc, asset, note, ...)
subject_id          text
before              jsonb nullable
after               jsonb nullable
versions            jsonb (model_id, prompt_version, template_version,
                           policy_version at time of action)
ts                  timestamptz default now()
```

Invarianti:

1. Nessun UPDATE o DELETE è consentito dai ruoli dell'app. Solo INSERT + SELECT.
   Applicato a livello di role-grant di Postgres.
2. Ogni cambio di stato di una proposta, ogni chiamata a tool, ogni approvazione,
   ogni override dell'analista di una decisione dell'AI, ogni cambio di visibilità,
   ogni correzione, ogni dispatch di outbox scrive una riga.
3. `versions` cattura lo stack che ha prodotto l'azione. Necessario per
   la riproducibilità e la calibrazione a posteriori.
4. La conversazione è una vista renderizzata di un sottoinsieme di eventi; non è
   audit. Distruggere o compattare la conversazione non distrugge l'audit.

## 7. Autorità del pannello dei fatti e flusso di correzione

Lo stato strutturato del case (ipotesi, IOC, asset, riepilogo della timeline,
confidenza, direttive attive) è l'output di un reducer su `case_events`.
Non viene mai mutato direttamente dalla conversazione.

Regole:

1. I messaggi della conversazione non scrivono stato strutturato.
2. Gli aggiornamenti dell'AI allo stato strutturato avvengono tramite eventi emessi dall'AI
   (`hypothesis_updated`, `ioc_added`, `asset_linked`).
3. Le modifiche dell'analista nel pannello dei fatti emettono eventi `analyst_correction`.
   Il reducer le applica. L'AI consuma la correzione come evento successivo
   dell'inbox e ri-ragiona a partire dallo stato corretto.
4. Il pannello dei fatti è eventualmente consistente con `case_events`. Viene
   mantenuta una proiezione materializzata (tabella o view); le letture possono
   colpirla direttamente.
5. Le correzioni dirette all'execution log sono vietate; le correzioni
   si esprimono come nuovi eventi più un puntatore a quello corretto.

## 8. Tassonomia delle capability dei tool

Ogni tool è registrato con una classe di capability, una policy di approvazione
predefinita e un modello di costo.

Classi di capability:

```
read_local               inspect SocTalk state only
read_external_silent     no target footprint (feeds, cached intel, vector)
read_external_attributed trace at target (SIEM query, EDR read)
write_sandbox            footprint without target mutation (detonation)
write_external           target state change (block, isolate, notify)
```

Policy di approvazione predefinita per classe:

```
read_local                → autonomous
read_external_silent      → autonomous
read_external_attributed  → analyst_approve
write_sandbox             → analyst_approve
write_external            → typed_reason
```

Modello di costo per-tool: `{tokens_est, dollars_est, wall_ms_est, footprint}`.
Il budget del run traccia la somma.

## 9. Precedenza delle policy

Le policy sono unite in questo ordine, quelle più in basso sovrascrivono quelle più in alto:

```
1. install default       (shipped in chart, read-only in v1)
2. tenant override       (MSSP sets per customer)
3. case template         (phishing, ransomware, etc.)
4. case-local override   (set for this one case by analyst)
```

Per ogni chiave di policy (approvazione tool, auto-close, promozione di visibilità,
template di risposta, budget), il valore effettivo è quello dello scope più profondo
che lo definisce.

Invarianti:

1. La promozione di visibilità non viene mai impostata su `permissive` per default a
   livello di scope install. Il default è "promozione esplicita richiesta".
2. Una policy di tenant non può sovrascrivere un hard cap a livello install (es.,
   `max_tokens_per_case`).
3. Gli override case-local sono limitati al case e non persistono su
   case futuri.

## 10. Semantica di auto-close / riapertura

Auto-close per FP ad alta confidenza:

```
Trigger:
  AI assessment = fp, confidence ≥ policy.auto_close_threshold
  AND policy.auto_close_enabled is true for the tenant
  AND no active directive prevents auto-close

Action:
  case.status = 'auto_closed_fp'
  case.reopen_window_until = now() + policy.reopen_window
  case.reopen_signature = {
    ioc_fingerprints: [...],
    asset_ids: [...],
    time_window: {start, end}
  }
  run transitions to completed
  execution_log row written
```

Riapertura:

```
Trigger:
  new case_events row with kind ∈ {alert_ingested, external_signal}
  whose signature intersects a case's reopen_signature
  where case.status = 'auto_closed_fp'
    AND now() < case.reopen_window_until

Action:
  case.status = 'active'
  emit reopened event into case_events
  new run created
  execution_log row written
  conversation receives a system message noting the reopen
```

Kill switch:
- `IntegrationConfig.auto_close_enabled` per tenant (default: on).
- `CaseTemplate.auto_close_disabled` per tipo di case.

## 11. Contratto di export verso TheHive (basato su outbox, unidirezionale)

Rispecchia case, IOC e note selezionate in uscita verso TheHive quando il
tenant ha `thehive_export_enabled`. Non accetta mai modifiche in ingresso.

Riga di outbox (in `case_outbox`):

```
id                  uuid PK
kind                'export.thehive.case' | 'export.thehive.ioc' | ...
external_system     'thehive'
external_ref        TheHive object id (filled on first successful mirror)
object_type         case | ioc | note
object_id           internal subject id
idempotency_key     sha256(object_type || object_id || state_hash)
payload             jsonb
export_status       pending | in_flight | succeeded | failed | skipped
attempts            int
last_error          text nullable
next_attempt_at     timestamptz
created_at, updated_at
```

Regole:

1. Un cambio di stato su un oggetto rispecchiato accoda una riga di export con una
   `idempotency_key` fresca (che incorpora lo state hash).
2. Il worker rivendica con `FOR UPDATE SKIP LOCKED`. In caso di successo, registra
   `external_ref` (creando o aggiornando sul lato TheHive secondo necessità) e
   scrive execution_log.
3. I webhook in ingresso da TheHive sono accettati solo per case dashboard read-only
   (non in v1). Qualsiasi tentativo di accettare stato in ingresso viene
   esplicitamente rifiutato e loggato.
4. Nessun loop di riconciliazione, TheHive è un mirror a valle, la sorgente
   di verità è SocTalk.
5. Gli export falliti vengono ritentati con backoff esponenziale fino a un cap; il
   fallimento permanente emerge sul pannello di salute delle integrazioni.

## 12. Test e invarianti obbligatori

La suite di test (unit + integration) deve coprire:

1. **Immutabilità dell'execution log.** UPDATE e DELETE contro
   `execution_log` dal ruolo dell'app falliscono a livello Postgres.
2. **Singolo run attivo per case.** I tentativi concorrenti di creare un
   secondo run attivo falliscono con una violazione di unique-constraint.
3. **Idempotenza delle proposte.** Sottomettendo due proposte con la stessa
   idempotency key all'interno della finestra: la seconda viene rifiutata.
4. **Comportamento di gate-pause.** Un run con una proposta `proposed` non
   consuma eventi non-gate dal suo inbox.
5. **Outbox exactly-once.** Due worker che rivendicano la stessa riga di outbox
   producono un successo e un no-op.
6. **Applicazione della visibilità.** Una sessione customer-viewer non può selezionare
   righe `mssp_only` da alcuna tabella, nemmeno con SQL grezzo.
7. **Promozione di visibilità loggata.** Ogni promozione da `mssp_only`
   a `customer_safe` produce una riga `execution_log`.
8. **Flusso di correzione.** Un evento di correzione dell'analista produce un nuovo evento
   che il reducer applica; la proiezione del pannello dei fatti riflette la
   correzione.
9. **Riapertura da auto-close.** Un evento che corrisponde a una reopen_signature entro
   la finestra riapre il case e avvia un nuovo run.
10. **Idempotenza dell'export verso TheHive.** Rieseguire un export per un oggetto
    il cui stato non è cambiato è un no-op (stessa idempotency_key).
11. **Policy di approvazione dei tool.** Una chiamata a un tool `write_external` senza
    un'approvazione typed_reason non può raggiungere l'executor.
12. **Precedenza delle policy.** L'override case-local vince sul tenant che
    vince sull'install per la stessa chiave di policy.

## 13. Fuori da questa specifica

- Modelli dei componenti, comportamento visivo, parsing della command-bar → il workstream della UI di conversazione.
- Correlazione delle campagne, scoring, meccaniche cross-tenant → il workstream delle campagne.
- Libreria dei prompt, contenuti del registry dei tool LLM, policy di versione dei modelli
  → separare il workstream del runtime LLM (LLM runtime) quando ci arriveremo.
