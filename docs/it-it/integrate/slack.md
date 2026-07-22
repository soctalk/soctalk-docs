# Slack

SocTalk comunica con Slack in due modi. Entrambi usano le stesse credenziali dell'app Slack ma coprono esigenze operative diverse:

| Backend | Direzione | Cablaggio nel chart V1 |
|---|---|---|
| **Notifiche webhook** | unidirezionale (in uscita) | Codice cablato solo nell'entry point legacy (`src/soctalk/main.py`). L'`app_v1` del chart V1 **non** lo monta. Considera le notifiche descritte sotto come il cablaggio pianificato; oggi, la pubblicazione richiede l'esecuzione dell'orchestratore legacy insieme a V1 |
| **HIL in Socket Mode** | bidirezionale | Codice presente (`src/soctalk/hil/backends/slack.py`); anch'esso non cablato in V1 |

L'unica superficie HIL funzionante nel percorso di installazione V1 è la coda di revisione della dashboard. Le pagine Slack qui sotto descrivono il cablaggio pianificato per quando entrambi i backend saranno rilasciati in V1. Per il flusso di revisione lato analista consulta [Revisione umana (HIL)](/it-it/human-review).

## Crea l'app Slack

1. https://api.slack.com/apps → **Create New App** → From scratch.
2. Nome: `SocTalk` (o il nome della tua installazione). Workspace: quello usato dal tuo team SOC.
3. **OAuth & Permissions** → aggiungi i Bot Token Scopes:
   - `chat:write`
   - `chat:write.public` (consente al bot di pubblicare in canali di cui non è membro)
   - `channels:read`
   - Per la revisione interattiva: `commands` (solo se vuoi anche gli slash command) e `app_mentions:read`.
4. **Install App** → Install to Workspace. Copia il **Bot User OAuth Token** (`xoxb-…`).
5. (solo HIL) **Socket Mode** → abilita. Genera un **App-Level Token** con lo scope `connections:write` (`xapp-…`).
6. (solo HIL) **Interactivity & Shortcuts** → abilita. Con Socket Mode abilitato, non è necessario inserire un Request URL.
7. (solo HIL) **Event Subscriptions** → abilita; sottoscrivi `interactive_message_actions` e `block_actions`.
8. Invita il bot nel tuo canale di revisione: `/invite @SocTalk`.

## Notifiche webhook

Per le notifiche unidirezionali ti serve solo un URL Incoming Webhook, non l'intera procedura dell'app descritta sopra. In alternativa:

- Installa un'app **Incoming Webhooks** separata nel workspace e recupera l'URL.
- Oppure usa la funzionalità Incoming Webhooks dell'app che hai creato sopra.

### Configurazione

MSSP UI → Settings → Slack:

| Campo | Note |
|---|---|
| Webhook URL | `https://hooks.slack.com/services/T…/B…/…` |
| Channel | Override facoltativo del canale; altrimenti il webhook pubblica sul suo canale predefinito |
| Notify on escalation | Attivo per impostazione predefinita. Pubblica quando un verdetto si chiude come `escalate` |
| Notify on verdict | Disattivato per impostazione predefinita. Pubblica anche ogni disposizione `close`: volume elevato |

**In V1 non esiste alcuna API per modificare le impostazioni dell'integrazione Slack**: il chart V1 non monta la route legacy `PUT /api/settings`. La configurazione di Slack avviene solo tramite ambiente: fornisci `SLACK_WEBHOOK_URL`, `SLACK_CHANNEL`, `SLACK_NOTIFY_ON_ESCALATION` e `SLACK_NOTIFY_ON_VERDICT` come variabili d'ambiente sul Deployment `soctalk-system-api`.

Le notifiche Slack coprono solo gli eventi di escalation e di verdetto (non esiste alcun toggle `notify_on_capacity`).

I token (webhook URL, bot token, app token) **non** sono scrivibili tramite questo endpoint, forniscili come variabili d'ambiente sul Deployment dell'orchestratore (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) oppure tramite env montate da Secret. Ruotali applicando una patch al Secret e riavviando l'orchestratore.

### Formato dei messaggi

Esempio di escalation:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1
AI verdict: Escalate · confidence: medium · 1 malicious observable
View → https://mssp.your-mssp.example/investigations/abc123
```

Block Kit minimale; nessun pulsante (quelli sono compito del backend HIL).

## HIL in Socket Mode

> **Stato:** il backend HIL bidirezionale di Slack esiste nel codice (`src/soctalk/hil/backends/slack.py`) ma **non è cablato nel runtime del chart V1 in questa release**. La coda di revisione della dashboard su `/review` è l'unica superficie HIL funzionante. Considera la configurazione dell'HIL Slack qui sotto come il progetto pianificato.

Per il flusso di revisione dell'analista. La stessa app Slack, più l'App-Level Token. Il backend HIL di SocTalk apre una WebSocket in uscita verso Slack, nessun endpoint pubblico necessario; funziona dietro NAT.

### Configurazione

Il toggle nella UI (Channel, Enable HIL, notify_on_*) si trova in MSSP UI → Settings → Slack. I token stessi sono disponibili solo tramite ambiente in questa release:

```yaml
env:
  - name: SLACK_BOT_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: bot_token } }
  - name: SLACK_APP_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: app_token } }
```

Il routing per-tenant del canale Slack **non è implementato in questa release**: lo `slack_channel` configurato a livello di installazione riceve ogni revisione e notifica indipendentemente dal tenant a cui appartiene il caso. Il routing per-tenant è in roadmap.

### Cosa viene pubblicato

Quando l'AI richiede una revisione umana, SocTalk pubblica una card sul canale configurato:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1

AI verdict: Escalate (confidence: medium)
Observables:
  · 198.51.100.7 (Cortex: malicious, 8/12 analyzers)
  · sshd (process)
  · alice@linux-ep-1 (user)

[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

I pulsanti generano eventi `block_actions`; il backend HIL di SocTalk li elabora e riscrive la decisione nello stato del caso. Reject e Needs-more-info aprono un modal per la motivazione (obbligatoria).

Una release futura collegherà la dashboard e Slack in modo da condividere lo stato di revisione. In V1 i due backend non condividono ancora lo stato, se l'HIL Slack fosse abilitato, l'azione da Slack non chiuderebbe la card della dashboard e viceversa.

## Ruota i token

1. In OAuth & Permissions dell'app Slack, **Reinstall app** per ruotare il bot token. Copia il nuovo `xoxb-…`.
2. (HIL) **Basic Information → App-Level Tokens** → revoca + rigenera. Copia il nuovo `xapp-…`.
3. Applica la patch al Secret:
   ```bash
   kubectl -n soctalk-system patch secret soctalk-slack-creds \
     -p '{"data":{"bot_token":"'$(echo -n xoxb-NEW | base64)'","app_token":"'$(echo -n xapp-NEW | base64)'"}}'
   ```
4. Riavvia l'orchestratore: `kubectl -n soctalk-system rollout restart deploy/soctalk-system-api`.
5. Il backend HIL si riconnette con i nuovi token entro ~10 s dalla disponibilità del pod.

## Risoluzione dei problemi

| Sintomo | Verifica |
|---|---|
| Il bot non pubblica | `kubectl -n soctalk-system logs deploy/soctalk-system-api | grep slack`. Causa comune: il bot non è stato invitato nel canale di destinazione |
| I pulsanti HIL restituiscono "this action is no longer valid" | La proposta è stata decisa da un altro percorso (dashboard o scaduta). Aggiorna la card |
| Il bot pubblica ma non reagisce mai ai clic sui pulsanti | Socket Mode non abilitato, oppure App-Level Token privo di `connections:write`. Ricrea l'app token |
| Le card arrivano troncate | Block Kit limita un singolo messaggio a 50 blocchi. SocTalk suddivide gli elenchi lunghi di observable in più card; dovresti vedere un footer "X observables shown of Y" |

## Privacy

Il messaggio Slack include gli observable (IP, nomi utente, hash di file). Se il tuo workspace ha vincoli di conformità, limita l'integrazione tramite le impostazioni per-tenant oppure usa solo le notifiche webhook (che non contengono il corpo degli observable).

## Riferimenti nel codice

| Concetto | File |
|---|---|
| Notifier webhook Slack | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Backend HIL Slack | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Template Block Kit | [`src/soctalk/notifications/slack_templates/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/notifications) |
