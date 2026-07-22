# Architektur

> **Hinweis zum V1-Deployment.** Die Benennung der Entitätsliste unten verwendet für mehrere Tabellen veraltete Präfixe im Stil "case_*"; die tatsächlichen Schemanamen in V1 lauten: `cases`, `investigation_runs`, `investigation_events`, `investigation_iocs`, `investigation_assets`, `investigation_links`, `investigation_outbox`, `proposals`. Der Tabellenname `cases` bleibt aus Gründen der Abwärtskompatibilität unverändert, aber alle untergeordneten Tabellen pro Untersuchung verwenden das Präfix `investigation_*`. Von diesen werden die Tabellen cases / investigation_runs / investigation_events vom aktuellen Orchestrator verwendet; `proposals` und `investigation_outbox` sind im Schema vorhanden, aber die Executor-Seite, die sie konsumiert, steht auf der Roadmap. Lies diese Seite als architektonische Absicht; für das exakte Schema konsultiere [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py).

## 1. Kernentitäten

Minimale Form. Vollständige Spaltenlisten stehen in der Migration; hier werden nur
tragende Felder benannt.

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

Jede inhaltstragende Zeile führt `tenant_id`, `visibility` und
`created_at`. RLS gilt pro Mandant.

## 2. Sichtbarkeitsmodell

Klassen (enum):

```
mssp_only         default; internal reasoning, raw tool output, hypotheses
customer_safe     approved for customer view
system            lifecycle and state-change events, always visible
tool_output       classified per-tool at registration time
```

Regeln:

1. `visibility` ist eine Spalte in jeder für Benutzer sichtbaren Zeile (Nachrichten, Notizen,
   Proposals, tool_output-Datensätze, Timeline-Einträge, Felder des Fakten-Panels).
2. Standardwert beim Einfügen ist `mssp_only`. Die Heraufstufung auf `customer_safe` ist eine
   explizite Operation.
3. Abfragen des Kundenportals filtern auf der Ebene der RLS-Policy, nicht beim
   Rendern. Eine Kunden-Viewer-Sitzung kann `mssp_only`-Zeilen nicht lesen, auch nicht
   per rohem SQL.
4. Proposals haben Sichtbarkeit auf Feldebene: `{action, outcome}` kann
   `customer_safe` sein, während `{rationale, blast_radius}` `mssp_only` bleibt.
   Gerendert als zwei Projektionen.
5. Jede Sichtbarkeits-Heraufstufung erzeugt einen `execution_log`-Eintrag mit dem
   Akteur und der Begründung.

Default-Deny-Promotion: Policies dürfen die Sichtbarkeit herabstufen, aber nicht
ohne eine explizite Aktion durch einen autorisierten Principal heraufstufen.

## 3. Run-Lebenszyklus

Zustände:

```
active           run consuming events and taking steps
waiting_on_gate  a proposal is pending; run does not mutate state
halted_budget    budget exceeded; requires analyst resume
paused           analyst-paused
completed        case closed
failed           unrecoverable error; requires analyst resume or restart
```

Übergänge:

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

Invarianten:

- Höchstens ein Run pro Case im Zustand `active | waiting_on_gate |
  halted_budget | paused`. Erzwungen über einen partiellen Unique-Index auf
  `case_runs(case_id) WHERE status IN (...)`.
- Budget-Zähler auf dem Run: `tokens_used`, `dollars_used`,
  `tool_calls_used`, `wall_clock_ms`. Serverseitig erzwungen; sanfte Warnung
  bei 75 %, harter Halt bei 100 %.
- Ein `waiting_on_gate`-Run verarbeitet keine Inbox-Ereignisse außer
  Gate-Auflösungsereignissen (proposal.approved / .rejected).

## 4. Event-Inbox, Reihenfolge, Coalescing, Idempotenz

Alle eingehende Arbeit für einen Case landet in `case_events`:

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

Regeln:

1. `seq` wird beim Einfügen von einer case-scoped Sequenz vergeben. Konsumenten lesen
   strikt in `seq`-Reihenfolge.
2. `idempotency_key` ist pro `case_id` eindeutig. Ein doppeltes Einfügen wird
   stillschweigend verworfen (die vorhandene Zeile wird zurückgegeben).
3. Coalescing: Vor dem Einfügen werden Ereignisse, die auf `(case_id, kind,
   payload.signature, window)` passen, zu einer einzigen Zeile zusammengeführt. Die Signatur ist
   kind-spezifisch (alert: Fingerprint von IOC + Regel + Asset; tool_result:
   tool_id + params-Hash).
4. `causation_event_id` verknüpft Ursache → Wirkung für das Replay.
   `correlation_id` gruppiert Ereignisse aus einem einzelnen externen Auslöser oder
   einer Analysten-Aktion.
5. Ereignisse sind unveränderlich. Aktualisierungen werden als Folgeereignisse ausgedrückt.

Burst-Beispiel: 100 ähnliche Host-Warnungen in 5 Minuten werden zu einem
`alert_ingested`-Ereignis zusammengefasst, das eine `asset_ids: [...]`-Liste trägt. Der Run
verarbeitet es einmal.

## 5. Proposal-Lebenszyklus und Ausführungsvertrag

Zustände:

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

Idempotenz:

```
proposal.idempotency_key = sha256(case_id || action_type ||
                                   canonical_json(params))
```

Doppelte Proposals innerhalb eines aktiven Fensters (Standard 15 Minuten) werden
beim Einfügen abgelehnt. Garantiert, dass die AI selbst bei einem Re-Run nicht doppelt auslösen kann.

Gate-Verhalten:

- Bei `proposed`: Der Run wechselt zu `waiting_on_gate`.
- Bei `approved`: Zeile in `case_outbox` einfügen mit
  `kind = 'execute_proposal'`, `idempotency_key = proposal.idempotency_key`.
  `proposal_approved` in `case_events` ausgeben. Der Run wird fortgesetzt.
- Bei `rejected`: `proposal_rejected` mit Begründung in
  `case_events` ausgeben. Der Run wird fortgesetzt. Keine Outbox-Zeile.

Ausführung:

- Ein separater Executor-Worker konsumiert `case_outbox` und führt die
  Aktion aus.
- Bei Erfolg: `execute_proposal_result` in `case_events` aufzeichnen,
  Proposal → `executed` aktualisieren, `execution_log`-Eintrag schreiben.
- Bei Fehlschlag: Fehler aufzeichnen, Proposal → `failed` aktualisieren,
  `execution_log`-Eintrag schreiben. Der Run kann einen Retry vorschlagen.
- Exactly-once über `idempotency_key`: Outbox-Zeilen mit doppelten Schlüsseln
  werden abgelehnt. Executor-Worker beanspruchen Zeilen mit einem Lease (z. B.
  `FOR UPDATE SKIP LOCKED`).

Der AI-Run führt keine Seiteneffekte inline aus. Alles läuft
über die Outbox.

## 6. Schema und Invarianten des Execution-Logs

Append-only, getrennt von der Konversation:

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

Invarianten:

1. Kein UPDATE oder DELETE aus App-Rollen erlaubt. Nur INSERT + SELECT.
   Erzwungen auf der Ebene der Postgres-Rollen-Grants.
2. Jede Proposal-Zustandsänderung, jeder Tool-Aufruf, jede Freigabe,
   jedes Override einer AI-Entscheidung durch einen Analysten, jede Sichtbarkeitsänderung,
   jede Korrektur, jede Outbox-Auslieferung schreibt eine Zeile.
3. `versions` erfasst den Stack, der die Aktion erzeugt hat. Erforderlich für
   Reproduzierbarkeit und nachträgliche Kalibrierung.
4. Die Konversation ist eine gerenderte Ansicht einer Teilmenge von Ereignissen; sie ist kein
   Audit. Das Zerstören oder Verdichten der Konversation zerstört nicht das Audit.

## 7. Autorität des Fakten-Panels und Korrekturfluss

Der strukturierte Case-Zustand (Hypothesen, IOCs, Assets, Timeline-Zusammenfassung,
Konfidenz, aktive Direktiven) ist ein Reducer-Output über `case_events`.
Er wird niemals direkt durch die Konversation mutiert.

Regeln:

1. Konversationsnachrichten schreiben keinen strukturierten Zustand.
2. AI-Aktualisierungen des strukturierten Zustands erfolgen über von der AI ausgegebene Ereignisse
   (`hypothesis_updated`, `ioc_added`, `asset_linked`).
3. Analysten-Bearbeitungen im Fakten-Panel geben `analyst_correction`-Ereignisse aus.
   Der Reducer wendet sie an. Die AI konsumiert die Korrektur als nächstes
   Inbox-Ereignis und schließt aus dem korrigierten Zustand neu.
4. Das Fakten-Panel ist eventually consistent mit `case_events`. Eine
   materialisierte Projektion (Tabelle oder View) wird gepflegt; Lesevorgänge können
   direkt darauf zugreifen.
5. Direkte Korrekturen am Execution-Log sind verboten; Korrekturen
   drücken sich als neue Ereignisse plus einen Zeiger auf das korrigierte Ereignis aus.

## 8. Taxonomie der Tool-Fähigkeiten

Jedes Tool wird mit einer Fähigkeitsklasse, einer Standard-Freigabe-Policy
und einem Kostenmodell registriert.

Fähigkeitsklassen:

```
read_local               inspect SocTalk state only
read_external_silent     no target footprint (feeds, cached intel, vector)
read_external_attributed trace at target (SIEM query, EDR read)
write_sandbox            footprint without target mutation (detonation)
write_external           target state change (block, isolate, notify)
```

Standard-Freigabe-Policy pro Klasse:

```
read_local                → autonomous
read_external_silent      → autonomous
read_external_attributed  → analyst_approve
write_sandbox             → analyst_approve
write_external            → typed_reason
```

Kostenmodell pro Tool: `{tokens_est, dollars_est, wall_ms_est, footprint}`.
Das Run-Budget verfolgt die Summe.

## 9. Policy-Präzedenz

Policies werden in dieser Reihenfolge zusammengeführt, niedrigere überschreibt höhere:

```
1. install default       (shipped in chart, read-only in v1)
2. tenant override       (MSSP sets per customer)
3. case template         (phishing, ransomware, etc.)
4. case-local override   (set for this one case by analyst)
```

Für jeden Policy-Schlüssel (Tool-Freigabe, Auto-Close, Sichtbarkeits-Heraufstufung,
Antwortvorlagen, Budget) ist der effektive Wert der tiefste Scope,
der ihn definiert.

Invarianten:

1. Die Sichtbarkeits-Heraufstufung wird im Install-Scope standardmäßig niemals auf
   `permissive` gesetzt. Der Standard ist "explizite Heraufstufung erforderlich".
2. Eine Tenant-Policy kann eine Hard-Cap auf Install-Ebene nicht überschreiben (z. B.
   `max_tokens_per_case`).
3. Case-lokale Overrides sind auf den Case beschränkt und bleiben nicht für
   zukünftige Cases bestehen.

## 10. Auto-Close-/Reopen-Semantik

Auto-Close für Falsch-Positive mit hoher Konfidenz:

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

Reopen:

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

Kill-Switch:
- `IntegrationConfig.auto_close_enabled` pro Mandant (Standard: an).
- `CaseTemplate.auto_close_disabled` pro Case-Typ.

## 11. TheHive-Export-Vertrag (outbox-basiert, einseitig)

Spiegelt Cases, IOCs und ausgewählte Notizen ausgehend zu TheHive, wenn der
Mandant `thehive_export_enabled` gesetzt hat. Akzeptiert niemals eingehende Änderungen.

Outbox-Zeile (in `case_outbox`):

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

Regeln:

1. Eine Zustandsänderung an einem gespiegelten Objekt reiht eine Export-Zeile mit einem
   frischen `idempotency_key` ein (bezieht den State-Hash ein).
2. Der Worker beansprucht mit `FOR UPDATE SKIP LOCKED`. Bei Erfolg zeichnet er
   `external_ref` auf (erstellt oder aktualisiert auf der TheHive-Seite nach Bedarf) und
   schreibt execution_log.
3. Eingehende Webhooks von TheHive werden nur für schreibgeschützte
   Dashboard-Cases akzeptiert (nicht v1). Jeder Versuch, eingehenden Zustand zu akzeptieren, wird
   explizit abgelehnt und protokolliert.
4. Keine Reconciliation-Schleife, TheHive ist ein nachgelagerter Spiegel, die Quelle
   der Wahrheit ist SocTalk.
5. Fehlgeschlagene Exporte werden mit exponentiellem Backoff bis zu einer Obergrenze erneut versucht; ein permanenter
   Fehlschlag erscheint im Health-Panel der Integrationen.

## 12. Verpflichtende Tests und Invarianten

Die Testsuite (Unit + Integration) muss abdecken:

1. **Unveränderlichkeit des Execution-Logs.** UPDATE und DELETE gegen
   `execution_log` aus der App-Rolle scheitern auf der Postgres-Ebene.
2. **Einzelner aktiver Run pro Case.** Nebenläufige Versuche, einen
   zweiten aktiven Run zu erstellen, scheitern mit einer Verletzung des Unique-Constraints.
3. **Proposal-Idempotenz.** Beim Einreichen von zwei Proposals mit demselben
   Idempotenzschlüssel innerhalb des Fensters wird das zweite abgelehnt.
4. **Gate-Pause-Verhalten.** Ein Run mit einem `proposed`-Proposal
   konsumiert keine Nicht-Gate-Ereignisse aus seiner Inbox.
5. **Outbox Exactly-once.** Zwei Worker, die dieselbe Outbox-Zeile beanspruchen,
   führen dazu, dass einer erfolgreich ist, einer keine Wirkung hat.
6. **Sichtbarkeits-Durchsetzung.** Eine Kunden-Viewer-Sitzung kann keine
   `mssp_only`-Zeilen aus irgendeiner Tabelle selektieren, selbst mit rohem SQL.
7. **Sichtbarkeits-Heraufstufung protokolliert.** Jede Heraufstufung von `mssp_only`
   auf `customer_safe` erzeugt eine `execution_log`-Zeile.
8. **Korrekturfluss.** Ein Analysten-Korrekturereignis erzeugt ein neues Ereignis,
   das der Reducer anwendet; die Projektion des Fakten-Panels spiegelt die
   Korrektur wider.
9. **Auto-Close-Reopen.** Ein Ereignis, das innerhalb des Fensters auf eine reopen_signature passt,
   öffnet den Case erneut und startet einen neuen Run.
10. **TheHive-Export-Idempotenz.** Das erneute Ausführen eines Exports für ein Objekt,
    dessen Zustand sich nicht geändert hat, ist ein No-op (gleicher idempotency_key).
11. **Tool-Freigabe-Policy.** Ein `write_external`-Tool-Aufruf ohne eine
    typed_reason-Freigabe kann den Executor nicht erreichen.
12. **Policy-Präzedenz.** Ein case-lokales Override gewinnt über den Tenant, der
    über den Install für denselben Policy-Schlüssel gewinnt.

## 13. Außerhalb dieser Spezifikation

- Komponentenmodelle, visuelles Verhalten, Parsing der Befehlsleiste → der Workstream der Konversations-UI.
- Kampagnen-Korrelation, Scoring, mandantenübergreifende Mechanik → der Kampagnen-Workstream.
- Prompt-Bibliothek, Inhalte der LLM-Tool-Registry, Modellversions-Policy
  → der separate LLM-Runtime-Workstream (LLM-Runtime), wenn wir dort ankommen.
