# Tour dell'interfaccia MSSP

Cosa vede un operatore MSSP dopo l'accesso. Leggi questa pagina una volta prima di [Operazioni quotidiane](/it-it/operations) affinché i runbook abbiano senso.

## Ambito: intero MSSP vs singolo tenant

Ogni utente MSSP ha due ambiti operativi:

- **Tutti i tenant** — code cross-tenant e viste aggregate. È l'impostazione predefinita per `mssp_admin`. L'angolo in alto a destra mostra un chip **Tutti i tenant**.
- **Singolo tenant** — l'amministratore MSSP ha aperto il SOC di un cliente (il chip riporta `Tenant: <name>`). Tutte le viste sono ristrette a quel tenant; il pulsante **Cancella** accanto al chip riporta all'ambito dell'intero MSSP.

L'ambito determina anche la barra di navigazione. Nell'ambito dell'intero MSSP vedi Tenant nella barra; nell'ambito tenant è nascosto perché le schermate di dettaglio del tenant ne prendono il posto.

## Barra di navigazione

La barra di sinistra è persistente su ogni pagina. Dall'alto verso il basso:

| Icona      | Pagina            | Cosa mostra |
|------------|-------------------|---------------|
| SocTalk    | `/`               | Home / dashboard |
| Dashboard  | `/`               | Riquadri KPI dell'MSSP + grafico del throughput delle indagini |
| Tenant     | `/tenants`        | Tutti i SOC dei clienti (solo ambito dell'intero MSSP) |
| Indagini   | `/investigations` | Coda cross-tenant dei casi attivi |
| Revisioni  | `/review`         | Coda delle proposte human-in-the-loop |
| Chat       | `/chat`           | Chat dell'operatore con l'agente SocTalk |
| Analytics  | `/analytics`      | Tendenze a livello di servizio tra i tenant |
| Audit Log  | `/audit`          | Log eventi append-only |
| Impostazioni | `/settings`     | Provider LLM, toggle delle integrazioni |
| Live / Offline | —             | Indicatore di connessione in tempo reale (stato WebSocket) |

In alto a destra su ogni pagina c'è il chip utente (`email`, `role`) e un pulsante **Esci**.

La UI dell'applicazione è distribuita localizzata in sette lingue, commutabili in-app dal selettore di lingua, che elenca ciascuna opzione sotto il proprio nome nativo: English, Português (Brasil), Español (Latinoamérica), 中文（简体）, Français, Deutsch, Italiano.

## Dashboard

![Dashboard MSSP](/screenshots/mssp-dashboard.png)

Riquadri KPI nella riga superiore (Indagini aperte, Revisioni in attesa, Tempo medio al Triage, Tempo medio al Verdetto) e una seconda riga di contatori operativi (Create oggi, Chiuse oggi, Escalation, Chiuse automaticamente, IOC malevoli).

Sotto i riquadri:

- **Throughput delle indagini (24h)** — grafico a barre+linea di casi creati / chiusi manualmente / chiusi automaticamente / in escalation / backlog.
- **Verdetti oggi** — conteggio progressivo dei verdetti AI della giornata.
- **Indagini attive** — breve elenco dei casi in corso con un collegamento diretto a ciascuno.

Il grafico è il widget più osservato per la pianificazione della capacità; se il backlog (linea rossa) tende a salire mentre il throughput resta piatto, l'MSSP è sotto-dimensionato oppure il modello lascia passare troppi casi alla revisione umana.

## Tenant

### Elenco dei tenant

![Elenco dei tenant](/screenshots/tenants-list.png)

Una riga per cliente. Colonne: Nome visualizzato, Slug, Profilo (`poc` o `persistent`), Stato (`pending | provisioning | active | degraded | suspended | decommissioning | archived | purged`), Creato, Azioni.

Il pulsante **+ Nuovo Tenant** apre il modulo di onboarding. Il profilo è fissato al momento della creazione; cambiarlo in seguito richiede decommissione + ricreazione.

### Dettaglio del tenant

![Dettaglio del tenant](/screenshots/tenant-detail.png)

Tre sezioni:

1. **Identità** — ID del tenant, profilo, timestamp di creazione / cambio di stato. Lo slug appare sotto il nome visualizzato nell'intestazione.
2. **Azioni** — Sospendi / Riprendi / Riprova provisioning / Decommissiona. **In questa release Sospendi porta lo stato del tenant a `suspended`** così l'orchestratore smette di pianificare nuove indagini; **non** ridimensiona i workload. Per un blocco definitivo, segui [Operazioni quotidiane → Disabilitazione di emergenza](/it-it/operations#emergency-disable-a-tenant-immediately). **Riprova provisioning** funziona solo sui tenant in `degraded` — l'API rifiuta `:retry` sui tenant in `pending` (`pending → provisioning` è automatico al primo tentativo).
3. **Eventi del ciclo di vita** — log cronologico della macchina a stati del provisioning: `preflight_ok → secrets_minted → namespace_ready → secrets_applied → helm_applied (soctalk-tenant chart) → helm_applied (Wazuh chart) → workloads_ready → integration_config_written → active`. Le due righe `helm_applied` sono distinguibili tramite il payload dell'evento (identità della chart). Quando un tenant si blocca, questa tabella ti dice quale passo è fallito.

Per il resto la pagina è di sola lettura; il SOC per-tenant si apre in una finestra propria tramite l'azione **Apri SOC** nell'elenco dei tenant. Wazuh è il data plane in-namespace; TheHive e Cortex sono integrazioni esterne, non componenti bundle per-tenant.

## Indagini

### Elenco

![Elenco delle indagini](/screenshots/investigations-list.png)

Coda cross-tenant. Filtri: stato (Pending / Active / Awaiting Enrichment / Awaiting Verdict / Awaiting Human / Escalated / Closed) e fase (Triage / Enrichment / Analysis / Verdict / Escalation / Closed). Ogni riga mostra Tenant, Titolo, Stato, Fase, Gravità (Critical / High / Medium / Low), numero di Alert, numero di IOC malevoli, Verdetto, Creato, Azioni.

Fai clic su **Visualizza** (o sul titolo) per aprire la pagina di dettaglio.

### Dettaglio

![Dettaglio dell'indagine](/screenshots/investigation-detail.png)

Layout:

- **Intestazione** — titolo, badge di stato (Active/Closed, Fase corrente, Gravità).
- **Riquadri KPI** — Alert, Osservabili (totali/malevoli/sospetti), Tempo al Triage, Tempo al Verdetto.
- **Dettagli** — ID, Creato, Aggiornato.
- **Timeline degli eventi** — inbox cronologica degli eventi del caso (immutabile, append-only).
- **Esecuzione dell'agente** — spesa di token rispetto al budget per esecuzione configurato (`case_runs.tokens_budget`, valore predefinito del modello 200.000) e disposizione (`pending | active | failed | completed`).
- **Riepilogo osservabili** — totali suddivisi in Malevoli / Sospetti / Puliti.

Il pulsante flottante **Chiedi all'AI** apre una conversazione laterale che opera sul contesto di questo caso.

## Revisioni (human-in-the-loop)

![Coda di revisione](/screenshots/review-queue.png)

La coda cross-tenant delle proposte AI in attesa di un gate umano. Ogni riga mostra il titolo della proposta, il numero di alert, la scadenza, la gravità, il chip del verdetto AI (`AI: Escalate / Close / Needs More Info`) e un pulsante **Revisiona**.

La revisione registra la decisione (`approve | reject | more_info`) che aggiorna la riga della revisione in attesa nel database. In V1 **non esiste alcuna pipeline downstream basata su outbox**; la decisione si ferma alla riga della revisione + audit log. Qualsiasi creazione di caso in TheHive o notifica Slack deve avvenire inline durante l'esecuzione del grafo AI.

Un backend HIL bidirezionale per Slack esiste nel codice (`src/soctalk/hil/backends/slack.py`) ma **non è collegato al runtime della chart V1**. La coda della dashboard è l'unica superficie HIL funzionante oggi.

## Chat

La pagina di chat apre una conversazione dell'operatore con l'agente SocTalk. Consapevole dell'ambito: nell'ambito dell'intero MSSP puoi porre domande tra i tenant; nell'ambito tenant la conversazione è vincolata ai dati di un solo cliente. Utile per domande ad hoc ("mostrami i tentativi di brute-force di questa settimana sul tenant X") che non meritano una query salvata.

## Analytics

![Analytics](/screenshots/analytics.png)

Vista cross-tenant orientata alle tendenze, suddivisa per intervalli temporali (Finestra predefinita: 30 giorni). Report:

- **Volume di alert**
- **p95 TTV** (time-to-verdict, AI)
- **p95 TTR** (time-to-review, gate umano)
- **Tasso di escalation**
- **Tenant in maggiore peggioramento** — ordinati per delta del p95 TTV rispetto alla finestra precedente
- **Heatmap di attività** — giorno-della-settimana × ora-del-giorno, alert (commutabile su altre dimensioni)

Usa questa vista per la pianificazione della capacità, la valutazione delle versioni del modello e la revisione degli SLA.

### Analytics decisionali

Fissare la pagina Analytics su un singolo tenant sostituisce le tendenze cross-tenant qui sopra con un insieme di superfici orientate alle decisioni per quel cliente:

- **Distribuzione della confidenza** — come la confidenza delle decisioni AI si distribuisce tra gli alert sottoposti a triage, suddivisa per confidenza.
- **Tendenze delle decisioni** — come il mix di decisioni (chiudi, escala, e così via) si muove nel tempo.
- **Confidenza media per decisione** — confidenza media suddivisa per tipo di decisione.

## Audit log

![Audit log](/screenshots/audit-log.png)

Audit append-only a livello dell'intero MSSP. Filtra per Tipo di evento (Review Requested / Review Completed / Tenant Onboarded / Decommissioned / Key Rotated / …). Colonne: Timestamp, Tipo di evento, Indagine (collegamento diretto), Versione (versione della riga event-sourced), Dati (payload JSON espandibile).

Per le esportazioni di conformità, chiama direttamente l'API:

```bash
curl 'https://mssp.your-mssp.example/api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

## Impostazioni

![Impostazioni](/screenshots/settings.png)

Pagina delle impostazioni a livello dell'intero MSSP. **In V1 questa pagina mostra valori segnaposto hard-coded** — `GET /api/settings` restituisce un payload statico di sola lettura che non riflette la configurazione effettiva dell'installazione. La pagina è solo informativa; **non** è una finestra sulle impostazioni live dell'installazione, e il pulsante **Salva modifiche** non ha alcun effetto. Una vera superficie delle impostazioni che rispecchi lo stato derivato dall'ambiente è in roadmap. La mutazione LLM per-tenant è l'unica superficie delle impostazioni che funziona realmente in V1 — vedi [Pagina di dettaglio LLM](#llm-detail-page).

Sezioni:

- **LLM** — Provider (`openai-compatible | anthropic`), Fast Model, Reasoning Model, Temperature, Max Tokens, Base URL + Organization opzionali. Le chiavi API vivono nell'ambiente / nei Kubernetes Secret, mai in questo modulo.
- **Wazuh SIEM** — toggle di abilitazione, URL, credenziali.
- **Cortex** — toggle di abilitazione, URL, credenziali. Integrazione esterna, non un subchart bundle; l'URL punta all'istanza Cortex del tenant (vedi /it-it/integrate/cortex).
- **TheHive** — toggle di abilitazione, URL, organizzazione, credenziali. Integrazione esterna, non un subchart bundle; l'URL punta all'istanza TheHive del tenant (vedi /it-it/integrate/thehive).
- **Slack** — configurazione del webhook + del backend interattivo.

Il collegamento **Bring your own LLM key →** porta alla rotazione della chiave LLM per-tenant (le chiavi LLM per-tenant hanno la precedenza su quella a livello di installazione).

### Pagina di dettaglio LLM

![Dettaglio impostazioni LLM](/screenshots/settings-llm.png)

Pagina autonoma raggiungibile da Impostazioni → **Bring your own LLM key →**. In V1 questa è **solo l'inserimento della chiave BYOK per-tenant** — il modulo prende la chiave API per il **tenant attualmente in ambito** e la invia tramite `PUT /api/tenant/llm/api-key` (l'endpoint lato tenant; gli amministratori MSSP possono usare anche `PUT /api/mssp/tenants/{tenant_id}/llm/api-key`). Gli altri campi LLM (provider, modello, temperature) mostrati nella pagina Impostazioni padre sono valori segnaposto; nemmeno qui sono modificabili. Vedi [Operazioni quotidiane → Ruota la chiave LLM per-tenant](/it-it/operations#rotate-per-tenant-llm-key) per la procedura di rotazione.

## Vedi anche

- [Operazioni quotidiane](/it-it/operations) — il lato runbook di queste pagine (revisione, indagini, decommissione, rotazione).
- [Wazuh Ingress](/it-it/reference/wazuh-ingress) — il flusso di onboarding degli agenti dal dettaglio del tenant.
- [Modello di sicurezza](/it-it/reference/security-model) — cosa può fare ciascun ruolo MSSP (`platform_admin`, `mssp_admin`, `analyst`, `customer_viewer`).
