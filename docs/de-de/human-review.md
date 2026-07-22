# Menschliche Prüfung (HIL)

Wie ein MSSP-Analyst KI-vorgeschlagene Aktionen bearbeitet, die auf ein menschliches Gate warten.

Im Code existieren zwei Backends: die **Dashboard-Warteschlange** (immer aktiv) und **Slack Zwei-Wege** (opt-in). Das Dashboard-Backend ist in dieser Version das einzige, das in die Laufzeit des V1-Charts eingebunden ist; das Slack-Zwei-Wege-Backend existiert im Code, wird aber vom V1-Installationspfad noch nicht aktiviert.

Zur Modellseite, wenn die KI an die menschliche Prüfung übergibt, siehe [KI-Pipeline → Gate für menschliche Prüfung](/de-de/ai-pipeline#human-review-gate).

## Entscheidungszustände

Jede Prüfung folgt unabhängig vom Backend demselben Drei-Entscheidungs-Vertrag:

| Entscheidung | Wirkung in dieser Version |
|---|---|
| `approve` | Die ausstehende Zeile der Prüfung wird als abgeschlossen markiert und der `feedback`-Text an den Audit-Trail angehängt. Der Fall wird durch approve **nicht** automatisch wieder aufgenommen oder geschlossen; das ist heute analystenseitige Nachverfolgung. |
| `reject` | Der Fall wird als Falsch-Positiv geschlossen (`auto_closed_fp`). Terminal; der Graph wird nicht erneut mit dem `feedback` des Menschen aufgerufen. |
| `more_info` | Die Prüfungszeile wird mit der Fragenliste auf `info_requested` aktualisiert. Der Graph wird **nicht** automatisch erneut aufgerufen; der Analyst nimmt den Fall manuell wieder auf. |

Entscheidungen schreiben reine Anhänge-Audit-Zeilen, die mit der Identität des Menschen, dem Zeitstempel und einer freitextlichen Begründung versehen sind. Nach dem Absenden sind sie nie mehr editierbar.

## Dashboard-Backend

Die [Prüfungs-Warteschlange](/de-de/mssp-ui#reviews-human-in-the-loop) unter `/review` zeigt jede ausstehende Prüfung über alle Mandanten hinweg. Karten zeigen:

- Titel der Untersuchung + Mandant
- KI-Verdict-Chip (`AI: Escalate / Close / Needs More Info`)
- Schweregrad
- Warnungsanzahl + Frist (falls eine SLA konfiguriert ist)

Ein Klick auf **Review** öffnet das Untersuchungsdetail, gescrollt zum Vorschlags-Panel. Das Panel zeigt:

- Die Begründung der KI (vollständiges Markdown)
- Die beobachtbaren Belege (IPs, Hashes, Benutzer) mit Reputation/Anreicherung aus Cortex / MISP
- Drei Schaltflächen: **Approve**, **Reject**, **Needs more info**
- Ein Textfeld für die Begründung (erforderlich bei Reject / Needs more info)

Beim Absenden wird die ausstehende Prüfungszeile in der Datenbank aktualisiert (`approve` / `reject` / `more_info` plus das `feedback` oder `questions` des Operators). **In V1 gibt es keinen Vorschlags-Outbox**: frühere Entwürfe beschrieben einen per Idempotenzschlüssel indizierten Outbox, der von nachgelagerten Executors (TheHive-Fallerstellung, Slack-Benachrichtigung) konsumiert wird, doch diese Pipeline ist in dieser Version nicht implementiert. Prüferentscheidungen enden bei der Prüfungszeile + dem Audit-Log; jede nachgelagerte Wirkung (z. B. TheHive-Fallerstellung) erfolgt nur, wenn der KI-Worker sie während des Graph-Laufs inline erstellt hat.

## Slack-Zwei-Wege-Backend

Slacks Socket Mode wird verwendet, damit SocTalk keinen öffentlichen Webhook-Endpoint benötigt; die SocTalk-Installation initiiert einen ausgehenden WebSocket zu Slack.

### Voraussetzungen

- Eine Slack-App in Ihrem Workspace mit aktiviertem Socket Mode
- Ein App-Level-Token mit `connections:write`
- Ein Bot-Token mit `chat:write`, `chat:write.public`, `channels:read`
- Ein Channel, in den der Bot eingeladen ist

### SocTalk konfigurieren

In der MSSP-UI → Settings → Slack:

- **Enable Slack** → an
- **Bot token** → `xoxb-…`
- **App token** → `xapp-…`
- **Channel** → `#soc-reviews` (oder ein beliebiger anderer)
- **Notify on escalation** → an (sendet jedes Escalate-Verdict)
- **Notify on verdict** → optional (sendet auch Close-Verdicts; hohes Volumen)

Die gesamte Slack-Konfiguration (Tokens, Channel, Benachrichtigungs-Toggles) ist in V1 nur über die Umgebung möglich; die veraltete Route `PUT /api/settings` wird vom V1-Chart nicht eingebunden. Siehe [Slack, Konfigurieren](/de-de/integrate/slack#configure) für das Muster zur Einschleusung von Umgebungsvariablen.

### Operator-Erfahrung

Wenn die KI eine menschliche Prüfung anfordert, postet SocTalk eine Karte in den konfigurierten Channel:

```text
[Critical] T1110 brute-force technique simulated on linux-ep-1 (Demo Tenant)
AI verdict: Escalate (confidence: medium)
Observables: 198.51.100.7 (Cortex: malicious, 8/12), sshd, alice@linux-ep-1
[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Die Schaltflächen senden über Socket Mode zurück; die SocTalk-Installation zeichnet die Entscheidung anhand des Idempotenzschlüssels des Vorschlags auf. Derselbe Vorschlag in der Dashboard-Warteschlange wird in Echtzeit aktualisiert; eine Genehmigung in Slack schließt die Dashboard-Karte.

Klickt der Analyst auf **Reject** oder **Needs more info**, öffnet sich ein Slack-Dialog für die Begründung (erforderlich).

Der Link **View in UI →** verlinkt direkt auf das Untersuchungsdetail mit vorgescrolltem Vorschlags-Panel.

### Mandantenübergreifendes Routing

In dieser Version gehen alle Prüfungen an den einen installationsweiten Channel, der unter Settings → Slack konfiguriert ist. Ein mandantenspezifisches Slack-Channel-Routing ist **nicht** implementiert; ein Feld `slack_channel_override` im Onboard-Payload wurde in früheren Docs erwähnt, doch die Laufzeit ignoriert es. Mandantenspezifisches Routing steht auf der Roadmap.

### Ausgehende (Ein-Weg-)Benachrichtigungen

Dieselben Slack-Anmeldeinformationen würden in einer künftigen Version Ein-Weg-Webhook-Benachrichtigungen (Fallschließungen, Verdict-Entscheidungen) antreiben. Der Webhook-Notifier-Code existiert in `src/soctalk/notifications/slack_webhook.py`, ist aber nur im veralteten Einstiegspunkt eingebunden; die `app_v1` des V1-Charts ruft ihn nicht auf. In keiner Version existiert ein `notify_on_capacity`-Toggle.

## Ergebnisabrechnung

Prüfungsentscheidungen schreiben eine Audit-Zeile. Die Metrik `soctalk_tenant_pending_reviews` ist im Observability-Code **definiert**, wird in V1 aber **nicht aktiv aktualisiert**: sie bleibt bei 0. Die Erfassung der tatsächlichen Tiefe der Prüfungs-Warteschlange steht auf der Roadmap. Ein geplanter Zähler `human_review_decisions_total` (pro Analyst) ist ebenfalls noch nicht instrumentiert.

## Umgehung: KI-only-Modus

Ein Modus ohne menschliches Gate im Sinne von „jedes Escalate automatisch genehmigen“ ist in dieser Version **nicht** implementiert. Der Verdict-Knoten leitet `escalate` immer durch `human_review`. Das Entfernen des menschlichen Gates steht auf der Roadmap als expliziter Toggle, der ausschließlich auf `platform_admin` beschränkt ist und dessen Begründung auditiert wird, nicht als stiller Standard.

## Quellverweise

| Konzept | Datei |
|---|---|
| HIL-Backend-Schnittstelle | [`src/soctalk/hil/backends/__init__.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Slack-Zwei-Wege-Backend | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Dashboard-Backend | [`src/soctalk/hil/backends/dashboard.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Slack-Ein-Weg-Webhook | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Enum für Vorschlagsstatus | [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) |
