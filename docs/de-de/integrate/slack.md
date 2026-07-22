# Slack

SocTalk kommuniziert auf zwei Arten mit Slack. Beide verwenden dieselben Slack-App-Anmeldedaten, decken aber unterschiedliche betriebliche Anforderungen ab:

| Backend | Richtung | V1-Chart-Verdrahtung |
|---|---|---|
| **Webhook-Benachrichtigungen** | einweg (raus) | Code nur im Legacy-Einstiegspunkt verdrahtet (`src/soctalk/main.py`). Das `app_v1` des V1-Charts bindet ihn **nicht** ein. Behandle die untenstehenden Benachrichtigungen als die geplante Verdrahtung; heute erfordert das Posten, dass der Legacy-Orchestrator zusätzlich zu V1 läuft |
| **Socket Mode HIL** | zweiweg | Code vorhanden (`src/soctalk/hil/backends/slack.py`); ebenfalls nicht in V1 verdrahtet |

Die einzige funktionierende HIL-Oberfläche des V1-Installationspfads ist die Prüfungswarteschlange im Dashboard. Die folgenden Slack-Seiten beschreiben die geplante Verdrahtung für den Zeitpunkt, an dem beide Backends in V1 ausgeliefert werden. Zum analystenseitigen Prüfungs-Workflow siehe [Menschliche Prüfung (HIL)](/de-de/human-review).

## Die Slack-App erstellen

1. https://api.slack.com/apps → **Create New App** → From scratch.
2. Name: `SocTalk` (oder der Name deiner Installation). Workspace: derjenige, den dein SOC-Team nutzt.
3. **OAuth & Permissions** → Bot Token Scopes hinzufügen:
   - `chat:write`
   - `chat:write.public` (erlaubt dem Bot, in Kanälen zu posten, in denen er kein Mitglied ist)
   - `channels:read`
   - Für interaktive Prüfung: `commands` (nur wenn du auch Slash-Befehle möchtest) und `app_mentions:read`.
4. **Install App** → Install to Workspace. Kopiere das **Bot User OAuth Token** (`xoxb-…`).
5. (Nur HIL) **Socket Mode** → aktivieren. Generiere ein **App-Level Token** mit dem Scope `connections:write` (`xapp-…`).
6. (Nur HIL) **Interactivity & Shortcuts** → aktivieren. Mit aktiviertem Socket Mode musst du keine Request URL eingeben.
7. (Nur HIL) **Event Subscriptions** → aktivieren; abonniere `interactive_message_actions` und `block_actions`.
8. Lade den Bot in deinen Prüfungskanal ein: `/invite @SocTalk`.

## Webhook-Benachrichtigungen

Für einweggerichtete Benachrichtigungen benötigst du nur eine Incoming-Webhook-URL, nicht den vollständigen App-Tanz oben. Entweder:

- Installiere eine separate **Incoming Webhooks**-App im Workspace und hole dir die URL.
- Oder nutze die Incoming-Webhooks-Funktion der oben erstellten App.

### Konfigurieren

MSSP-UI → Settings → Slack:

| Feld | Hinweise |
|---|---|
| Webhook URL | `https://hooks.slack.com/services/T…/B…/…` |
| Channel | Optionale Kanal-Überschreibung; andernfalls postet der Webhook in seinen Standardkanal |
| Notify on escalation | Standardmäßig an. Postet, wenn ein Verdict als `escalate` geschlossen wird |
| Notify on verdict | Standardmäßig aus. Postet auch jede `close`-Disposition, hohes Volumen |

**Es gibt in V1 keine API zum Ändern der Slack-Integrationseinstellungen**: das V1-Chart bindet die Legacy-Route `PUT /api/settings` nicht ein. Die Slack-Konfiguration erfolgt ausschließlich über die Umgebung: stelle `SLACK_WEBHOOK_URL`, `SLACK_CHANNEL`, `SLACK_NOTIFY_ON_ESCALATION` und `SLACK_NOTIFY_ON_VERDICT` als Umgebungsvariablen im `soctalk-system-api`-Deployment bereit.

Slack-Benachrichtigungen decken nur Eskalations- und Verdict-Ereignisse ab (es existiert kein `notify_on_capacity`-Schalter).

Tokens (Webhook-URL, Bot-Token, App-Token) sind über diesen Endpoint **nicht** schreibbar, stelle sie als Umgebungsvariablen im Orchestrator-Deployment bereit (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) oder über Secret-gemountete Umgebung. Rotiere sie, indem du das Secret patchst und den Orchestrator neu rollst.

### Nachrichtenformat

Eskalationsbeispiel:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1
AI verdict: Escalate · confidence: medium · 1 malicious observable
View → https://mssp.your-mssp.example/investigations/abc123
```

Minimales Block Kit; keine Buttons (das ist Aufgabe des HIL-Backends).

## Socket Mode HIL

> **Status:** Das zweiweggerichtete Slack-HIL-Backend existiert im Code (`src/soctalk/hil/backends/slack.py`), ist aber **in diesem Release nicht in die Laufzeit des V1-Charts verdrahtet**. Die Prüfungswarteschlange im Dashboard unter `/review` ist die einzige funktionierende HIL-Oberfläche. Behandle das folgende Slack-HIL-Setup als geplantes Design.

Für den Analysten-Prüfungs-Workflow. Dieselbe Slack-App, plus das App-Level Token. Das HIL-Backend von SocTalk öffnet einen ausgehenden WebSocket zu Slack, kein öffentlicher Endpoint nötig; funktioniert hinter NAT.

### Konfigurieren

Der UI-Schalter (Channel, Enable HIL, notify_on_*) befindet sich in MSSP-UI → Settings → Slack. Die Tokens selbst sind in diesem Release nur über die Umgebung verfügbar:

```yaml
env:
  - name: SLACK_BOT_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: bot_token } }
  - name: SLACK_APP_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: app_token } }
```

Das Slack-Kanal-Routing pro Mandant ist **in diesem Release nicht implementiert**: der konfigurierte installationsweite `slack_channel` empfängt jede Prüfung und Benachrichtigung, unabhängig davon, zu welchem Mandanten der Fall gehört. Routing pro Mandant steht auf der Roadmap.

### Was gepostet wird

Wenn die AI eine menschliche Prüfung anfordert, postet SocTalk eine Karte in den konfigurierten Kanal:

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

Buttons lösen `block_actions`-Ereignisse aus; das HIL-Backend von SocTalk verarbeitet sie und schreibt die Entscheidung zurück in den Fallzustand. Reject und Needs-more-info öffnen ein Modal für die Begründung (erforderlich).

Ein zukünftiges Release verdrahtet Dashboard und Slack so, dass sie sich den Prüfungszustand teilen. In V1 teilen sich die beiden Backends den Zustand noch nicht, wäre Slack-HIL aktiviert, würde die Slack-Aktion die Dashboard-Karte nicht verwerfen und umgekehrt.

## Tokens rotieren

1. Klicke in OAuth & Permissions der Slack-App auf **Reinstall app**, um das Bot-Token zu rotieren. Kopiere das neue `xoxb-…`.
2. (HIL) **Basic Information → App-Level Tokens** → widerrufen + neu generieren. Kopiere das neue `xapp-…`.
3. Patche das Secret:
   ```bash
   kubectl -n soctalk-system patch secret soctalk-slack-creds \
     -p '{"data":{"bot_token":"'$(echo -n xoxb-NEW | base64)'","app_token":"'$(echo -n xapp-NEW | base64)'"}}'
   ```
4. Rolle den Orchestrator neu: `kubectl -n soctalk-system rollout restart deploy/soctalk-system-api`.
5. Das HIL-Backend verbindet sich innerhalb von ca. 10 s nach Pod-Bereitschaft mit den neuen Tokens neu.

## Fehlerbehebung

| Symptom | Prüfung |
|---|---|
| Bot postet nicht | `kubectl -n soctalk-system logs deploy/soctalk-system-api | grep slack`. Häufige Ursache: Bot nicht in den Zielkanal eingeladen |
| HIL-Buttons geben "this action is no longer valid" zurück | Der Vorschlag wurde über einen anderen Pfad entschieden (Dashboard oder abgelaufen). Aktualisiere die Karte |
| Bot postet, reagiert aber nie auf Button-Klicks | Socket Mode nicht aktiviert oder App-Level Token fehlt `connections:write`. Erstelle das App-Token neu |
| Karten kommen abgeschnitten an | Block Kit begrenzt eine einzelne Nachricht auf 50 Blöcke. SocTalk stapelt lange Observable-Listen in mehrere Karten; du solltest eine Fußzeile "X observables shown of Y" sehen |

## Datenschutz

Die Slack-Nachricht enthält Observables (IPs, Benutzernamen, Datei-Hashes). Falls dein Workspace Compliance-Auflagen unterliegt, beschränke die Integration über Einstellungen pro Mandant oder nutze reine Webhook-Benachrichtigungen (in diesen sind keine Observable-Inhalte enthalten).

## Quellverweise

| Konzept | Datei |
|---|---|
| Slack-Webhook-Notifier | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Slack-HIL-Backend | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Block-Kit-Vorlagen | [`src/soctalk/notifications/slack_templates/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/notifications) |
