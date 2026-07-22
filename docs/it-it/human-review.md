# Revisione umana (HIL)

Come un analista MSSP elabora le azioni proposte dall'AI in attesa di un gate umano.

Nel codebase esistono due backend: la **coda della dashboard** (sempre attiva) e **Slack bidirezionale** (opt-in). Il backend della dashboard è l'unico integrato nel runtime del chart V1 in questa release; il backend Slack bidirezionale esiste nel codice ma non è ancora attivato dal percorso di installazione V1.

Per il lato modello, quando l'AI passa la mano alla revisione umana, vedi [Pipeline AI → Gate di revisione umana](/it-it/ai-pipeline#human-review-gate).

## Stati decisionali

Ogni revisione ha lo stesso contratto a tre decisioni indipendentemente dal backend:

| Decisione | Effetto in questa release |
|---|---|
| `approve` | La riga pending della revisione viene marcata come completata e il testo `feedback` viene aggiunto all'audit trail. Il caso **non** viene automaticamente ripreso o chiuso da approve, oggi questo è un follow-up lato analista. |
| `reject` | Il caso viene chiuso come falso positivo (`auto_closed_fp`). Terminale, il grafo non viene reinvocato con il `feedback` dell'operatore. |
| `more_info` | La riga della revisione viene aggiornata a `info_requested` con la lista delle domande. Il grafo **non** viene automaticamente reinvocato; l'analista riprende manualmente il caso. |

Le decisioni scrivono righe di audit in sola aggiunta, marcate con l'identità dell'operatore, il timestamp e una motivazione in testo libero. Non sono mai modificabili dopo l'invio.

## Backend della dashboard

La [Coda di revisione](/it-it/mssp-ui#reviews-human-in-the-loop) su `/review` mostra ogni revisione pending attraverso tutti i tenant. Le card visualizzano:

- Titolo dell'indagine + tenant
- Chip del verdict AI (`AI: Escalate / Close / Needs More Info`)
- Severità
- Numero di alert + scadenza (se è configurato un SLA)

Cliccando su **Review** si apre il dettaglio dell'indagine, con lo scroll posizionato sul pannello della proposta. Il pannello mostra:

- La motivazione dell'AI (markdown completo)
- L'evidenza osservabile (IP, hash, utenti) con reputazione/arricchimento da Cortex / MISP
- Tre pulsanti: **Approve**, **Reject**, **Needs more info**
- Un'area di testo per la motivazione (obbligatoria per Reject / Needs more info)

L'invio aggiorna la riga della revisione pending nel database (`approve` / `reject` / `more_info` più il `feedback` o le `questions` dell'operatore). **In V1 non esiste alcun outbox delle proposte**: le bozze precedenti descrivevano un outbox indicizzato per idempotency-key consumato dagli executor a valle (creazione di casi in TheHive, notifica Slack), ma quella pipeline non è implementata in questa release. Le decisioni del revisore si fermano alla riga della revisione + audit log; qualsiasi effetto a valle (ad esempio la creazione di un caso in TheHive) avviene solo se il worker AI lo ha creato inline durante l'esecuzione del grafo.

## Backend Slack bidirezionale

Viene usato il Socket Mode di Slack in modo che SocTalk non abbia bisogno di un endpoint webhook pubblico, l'installazione di SocTalk avvia un WebSocket in uscita verso Slack.

### Prerequisiti

- Un'app Slack nel tuo workspace con Socket Mode abilitato
- Un token a livello di app con `connections:write`
- Un token bot con `chat:write`, `chat:write.public`, `channels:read`
- Un canale in cui il bot è stato invitato

### Configurare SocTalk

Nella MSSP UI → Settings → Slack:

- **Enable Slack** → on
- **Bot token** → `xoxb-…`
- **App token** → `xapp-…`
- **Channel** → `#soc-reviews` (o quello che preferisci)
- **Notify on escalation** → on (invia ogni verdict di escalation)
- **Notify on verdict** → opzionale (invia anche i verdict di chiusura; volume elevato)

Tutta la configurazione Slack (token, canale, toggle di notifica) è solo tramite ambiente in V1, la vecchia route `PUT /api/settings` non è montata dal chart V1. Vedi [Slack, Configurazione](/it-it/integrate/slack#configure) per il pattern di iniezione delle variabili d'ambiente.

### Esperienza dell'operatore

Quando l'AI richiede una revisione umana, SocTalk pubblica una card sul canale configurato:

```text
[Critical] T1110 brute-force technique simulated on linux-ep-1 (Demo Tenant)
AI verdict: Escalate (confidence: medium)
Observables: 198.51.100.7 (Cortex: malicious, 8/12), sshd, alice@linux-ep-1
[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

I pulsanti rispondono attraverso il Socket Mode; l'installazione di SocTalk registra la decisione indicizzata per la idempotency key della proposta. La stessa proposta nella coda della dashboard si aggiorna in tempo reale, approvare in Slack chiude la card della dashboard.

Se l'analista clicca su **Reject** o **Needs more info**, si apre una finestra di dialogo Slack per la motivazione (obbligatoria).

Il link **View in UI →** rimanda in deep-link al dettaglio dell'indagine con il pannello della proposta già scrollato.

### Routing multi-tenant

In questa release, tutte le revisioni vanno all'unico canale a livello di installazione configurato in Settings → Slack. Il routing per-tenant del canale Slack **non** è implementato; un campo `slack_channel_override` nel payload di onboarding era menzionato in documenti precedenti ma il runtime lo ignora. Il routing per-tenant è nella roadmap.

### Notifiche in uscita (unidirezionali)

Le stesse credenziali Slack alimenterebbero notifiche webhook unidirezionali (chiusure di casi, decisioni di verdict) in una release futura. Il codice del notificatore webhook esiste in `src/soctalk/notifications/slack_webhook.py` ma è integrato solo nell'entry point legacy; l'`app_v1` del chart V1 non lo invoca. Non esiste alcun toggle `notify_on_capacity` in nessuna release.

## Contabilizzazione degli esiti

Le decisioni di revisione scrivono una riga di audit. Il gauge `soctalk_tenant_pending_reviews` è **definito** nel codice di osservabilità ma **non viene aggiornato attivamente** in V1, resta a 0. Il tracciamento della profondità reale della coda di revisione è nella roadmap. È previsto anche un contatore `human_review_decisions_total` (per-analista) ma non è ancora strumentato.

## Bypass: modalità solo-AI

Una modalità "auto-approva ogni escalation" senza gate umano **non** è implementata in questa release. Il nodo del verdict instrada sempre `escalate` attraverso `human_review`. La rimozione del gate umano è nella roadmap come toggle esplicito riservato solo a `platform_admin`, con la motivazione soggetta ad audit, non come default silenzioso.

## Riferimenti al codice sorgente

| Concetto | File |
|---|---|
| Interfaccia dei backend HIL | [`src/soctalk/hil/backends/__init__.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Backend Slack bidirezionale | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Backend della dashboard | [`src/soctalk/hil/backends/dashboard.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Webhook Slack unidirezionale | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Enum dello stato della proposta | [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) |
