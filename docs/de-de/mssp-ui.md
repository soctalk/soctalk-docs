# MSSP-UI-Rundgang

Was ein MSSP-Operator nach der Anmeldung sieht. Lies dies einmal vor [Täglicher Betrieb](/de-de/operations), damit die Runbooks Sinn ergeben.

## Geltungsbereich: MSSP-weit vs. einzelner Mandant

Jeder MSSP-Benutzer hat zwei Arbeitsbereiche:

- **Alle Mandanten**: mandantenübergreifende Warteschlangen und aggregierte Ansichten. Dies ist die Voreinstellung für `mssp_admin`. In der oberen rechten Ecke wird ein **Alle Mandanten**-Chip angezeigt.
- **Einzelner Mandant**: der MSSP-Admin hat das SOC eines Kunden geöffnet (der Chip zeigt `Tenant: <name>`). Alle Ansichten sind auf diesen Mandanten beschränkt; die Schaltfläche **Löschen** neben dem Chip wechselt zurück zur MSSP-weiten Ansicht.

Der Geltungsbereich steuert auch die Navigationsleiste. Im MSSP-weiten Bereich siehst du Mandanten in der Leiste; im Mandantenbereich ist sie ausgeblendet, weil die Mandanten-Detailbildschirme ihren Platz einnehmen.

## Navigationsleiste

Die linke Leiste ist auf jeder Seite dauerhaft vorhanden. Von oben nach unten:

| Icon       | Seite             | Was sie zeigt |
|------------|-------------------|---------------|
| SocTalk    | `/`               | Startseite / Dashboard |
| Dashboard  | `/`               | MSSP-KPI-Kacheln + Diagramm zum Untersuchungsdurchsatz |
| Tenants    | `/tenants`        | Alle Kunden-SOCs (nur im MSSP-weiten Bereich) |
| Investigations | `/investigations` | Mandantenübergreifende Warteschlange aktiver Fälle |
| Reviews    | `/review`         | Human-in-the-loop-Vorschlagswarteschlange |
| Chat       | `/chat`           | Operator-Chat mit dem SocTalk-Agenten |
| Analytics  | `/analytics`      | Service-Level-Trends über Mandanten hinweg |
| Audit Log  | `/audit`          | Anfüge-basiertes Ereignisprotokoll |
| Settings   | `/settings`       | LLM-Provider, Integrations-Schalter |
| Live / Offline | —              | Echtzeit-Verbindungsanzeige (WebSocket-Zustand) |

Oben rechts auf jeder Seite befinden sich der Benutzer-Chip (`email`, `role`) und eine Schaltfläche **Abmelden**.

Die Anwendungs-UI wird in sieben Sprachen lokalisiert ausgeliefert, in der App über den Sprachauswähler umschaltbar, der jede Option unter ihrem eigenen nativen Namen auflistet: English, Português (Brasil), Español (Latinoamérica), 中文（简体）, Français, Deutsch, Italiano.

## Dashboard

![MSSP-Dashboard](/screenshots/mssp-dashboard.png)

KPI-Kacheln in der obersten Zeile (Offene Untersuchungen, Ausstehende Prüfungen, Durchschnittliche Zeit bis zur Triage, Durchschnittliche Zeit bis zum Verdict) und eine zweite Zeile mit operativen Zählern (Heute erstellt, Heute geschlossen, Eskalationen, Automatisch geschlossen, Bösartige IOCs).

Unter den Kacheln:

- **Untersuchungsdurchsatz (24h)**: Balken-/Liniendiagramm für erstellt / manuell geschlossen / automatisch geschlossen / eskaliert / Rückstand.
- **Verdicts heute**: laufende Zählung der KI-Verdicts des Tages.
- **Aktive Untersuchungen**: kurze Liste laufender Fälle mit einem Deep Link zu jedem.

Das Diagramm ist das meistbeobachtete Widget für die Kapazitätsplanung; wenn der Rückstand (rote Linie) ansteigt, während der Durchsatz flach bleibt, ist der MSSP unterversorgt oder das Modell scheitert an zu vielen Fällen, die an die menschliche Prüfung durchgereicht werden.

## Mandanten

### Mandantenliste

![Mandantenliste](/screenshots/tenants-list.png)

Eine Zeile pro Kunde. Spalten: Anzeigename, Slug, Profil (`poc` oder `persistent`), Zustand (`pending | provisioning | active | degraded | suspended | decommissioning | archived | purged`), Erstellt, Aktionen.

Die Schaltfläche **+ New Tenant** öffnet das Onboarding-Formular. Das Profil ist zum Erstellungszeitpunkt festgelegt; ein späterer Wechsel erfordert Decommission + Neuerstellung.

### Mandantendetail

![Mandantendetail](/screenshots/tenant-detail.png)

Drei Abschnitte:

1. **Identität**: Mandanten-ID, Profil, Zeitstempel für Erstellung / Zustandsänderung. Der Slug erscheint unter dem Anzeigenamen in der Kopfzeile.
2. **Aktionen**: Suspend / Resume / Retry Provisioning / Decommission. **Suspend versetzt in diesem Release den Zustand des Mandanten auf `suspended`**, sodass der Orchestrator keine neuen Untersuchungen mehr einplant; es skaliert die Workloads **nicht**. Für eine definitive Abschaltung folge [Täglicher Betrieb → Notabschaltung](/de-de/operations#emergency-disable-a-tenant-immediately). **Retry Provisioning** funktioniert nur bei Mandanten im Zustand `degraded`: die API lehnt `:retry` bei Mandanten im Zustand `pending` ab (`pending → provisioning` erfolgt beim ersten Versuch automatisch).
3. **Lifecycle-Ereignisse**: chronologisches Protokoll der Provisioning-Zustandsmaschine: `preflight_ok → secrets_minted → namespace_ready → secrets_applied → helm_applied (soctalk-tenant chart) → helm_applied (Wazuh chart) → workloads_ready → integration_config_written → active`. Die beiden `helm_applied`-Zeilen sind über die Ereignis-Payload (Chart-Identität) unterscheidbar. Wenn ein Mandant hängen bleibt, zeigt dir diese Tabelle, welcher Schritt fehlgeschlagen ist.

Ansonsten ist die Seite schreibgeschützt; das mandantenspezifische SOC öffnet sich über die Aktion **Open SOC** in der Mandantenliste in einem eigenen Fenster. Wazuh ist die In-Namespace-Data-Plane; TheHive und Cortex sind externe Integrationen, keine gebündelten mandantenspezifischen Komponenten.

## Untersuchungen

### Liste

![Untersuchungsliste](/screenshots/investigations-list.png)

Mandantenübergreifende Warteschlange. Filter: Status (Pending / Active / Awaiting Enrichment / Awaiting Verdict / Awaiting Human / Escalated / Closed) und Phase (Triage / Enrichment / Analysis / Verdict / Escalation / Closed). Jede Zeile zeigt Mandant, Titel, Status, Phase, Schweregrad (Critical / High / Medium / Low), Warnungsanzahl, Anzahl bösartiger IOCs, Verdict, Erstellt, Aktionen.

Klicke auf **View** (oder den Titel), um die Detailseite zu öffnen.

### Detail

![Untersuchungsdetail](/screenshots/investigation-detail.png)

Layout:

- **Header**: Titel, Status-Badges (Active/Closed, aktuelle Phase, Schweregrad).
- **KPI-Kacheln**: Warnungen, Observables (gesamt/bösartig/verdächtig), Zeit bis zur Triage, Zeit bis zum Verdict.
- **Details**: ID, Erstellt, Aktualisiert.
- **Ereignis-Zeitleiste**: chronologischer Ereignis-Posteingang für den Fall (unveränderlich, nur anfügend).
- **Agent Run**: Token-Verbrauch gegenüber dem konfigurierten Budget pro Lauf (`case_runs.tokens_budget`, Modell-Voreinstellung 200.000) und Disposition (`pending | active | failed | completed`).
- **Observable-Zusammenfassung**: Summen aufgeschlüsselt nach Bösartig / Verdächtig / Sauber.

Die schwebende Schaltfläche **Ask AI** öffnet eine Seitenkonversation, die im Kontext dieses Falls arbeitet.

## Prüfungen (Human-in-the-loop)

![Prüfungswarteschlange](/screenshots/review-queue.png)

Die mandantenübergreifende Warteschlange von KI-Vorschlägen, die auf ein menschliches Gate warten. Jede Zeile zeigt den Vorschlagstitel, die Warnungsanzahl, die Frist, den Schweregrad, den KI-Verdict-Chip (`AI: Escalate / Close / Needs More Info`) und eine Schaltfläche **Review**.

Beim Prüfen wird die Entscheidung (`approve | reject | more_info`) gebucht, was die ausstehende Prüfungszeile in der Datenbank aktualisiert. In V1 gibt es **keine outbox-basierte nachgelagerte Pipeline**; die Entscheidung endet bei der Prüfungszeile + dem Audit-Log. Jegliche TheHive-Fallerstellung oder Slack-Benachrichtigung muss inline während des KI-Graph-Laufs erfolgen.

Ein Slack-Zwei-Wege-HIL-Backend existiert im Code (`src/soctalk/hil/backends/slack.py`), ist aber **nicht in die Laufzeitumgebung des V1-Charts eingebunden**. Die Dashboard-Warteschlange ist heute die einzige funktionierende HIL-Oberfläche.

## Chat

Die Chat-Seite öffnet eine Operator-Konversation mit dem SocTalk-Agenten. Bereichsbewusst: Im MSSP-weiten Bereich kannst du mandantenübergreifend fragen; im Mandantenbereich ist die Konversation an die Daten eines Kunden gebunden. Nützlich für Ad-hoc-Fragen ("zeige mir die Brute-Force-Versuche dieser Woche bei Mandant X"), die keine gespeicherte Abfrage rechtfertigen.

## Analytics

![Analytics](/screenshots/analytics.png)

Trendorientierte mandantenübergreifende Ansicht, in Zeitfenster gruppiert (Voreinstellung Fenster: 30 Tage). Berichte:

- **Warnungsvolumen**
- **p95 TTV** (Time-to-Verdict, KI)
- **p95 TTR** (Time-to-Review, menschliches Gate)
- **Eskalationsrate**
- **Sich am stärksten verschlechternde Mandanten**: sortiert nach p95-TTV-Delta gegenüber dem vorherigen Fenster
- **Aktivitäts-Heatmap**: Wochentag × Tagesstunde, Warnungen (auf andere Dimensionen umschaltbar)

Nutze dies für Kapazitätsplanung, Modellversions-Bewertung und SLA-Prüfung.

### Entscheidungsanalytik

Wenn du die Analytics-Seite auf einen einzelnen Mandanten fixierst, werden die mandantenübergreifenden Trends oben durch eine Reihe entscheidungsorientierter Oberflächen für diesen Kunden ersetzt:

- **Konfidenzverteilung**: wie die Konfidenz der KI-Entscheidungen über triagierte Warnungen verteilt ist, nach Konfidenz gruppiert.
- **Entscheidungstrends**: wie sich der Mix der Entscheidungen (schließen, eskalieren usw.) im Zeitverlauf bewegt.
- **Durchschnittliche Konfidenz nach Entscheidung**: mittlere Konfidenz aufgeschlüsselt nach Entscheidungstyp.

## Audit-Log

![Audit-Log](/screenshots/audit-log.png)

MSSP-weites, nur anfügbares Audit. Filtere nach Ereignistyp (Review Requested / Review Completed / Tenant Onboarded / Decommissioned / Key Rotated / …). Spalten: Zeitstempel, Ereignistyp, Untersuchung (Deep Link), Version (Event-Sourced-Zeilenversion), Daten (aufklappbare JSON-Payload).

Für Compliance-Exporte greife direkt auf die API zu:

```bash
curl 'https://mssp.your-mssp.example/api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

## Einstellungen

![Einstellungen](/screenshots/settings.png)

MSSP-weite Einstellungsseite. **In V1 zeigt diese Seite fest kodierte Stub-Werte an**: `GET /api/settings` gibt eine statische, schreibgeschützte Payload zurück, die nicht die tatsächliche Konfiguration der Installation widerspiegelt. Die Seite ist rein informativ; sie ist **kein** Fenster in die Live-Installationseinstellungen, und die Schaltfläche **Save Changes** ist eine No-Op. Eine echte Einstellungsoberfläche, die den aus Umgebungsvariablen abgeleiteten Zustand widerspiegelt, steht auf der Roadmap. Die mandantenspezifische LLM-Mutation ist die einzige Einstellungsoberfläche, die in V1 tatsächlich funktioniert, siehe [LLM-Detailseite](#llm-detail-page).

Abschnitte:

- **LLM**: Provider (`openai-compatible | anthropic`), Fast Model, Reasoning Model, Temperature, Max Tokens, optional Base URL + Organization. API-Schlüssel liegen in der Umgebung / in Kubernetes Secrets, niemals in diesem Formular.
- **Wazuh SIEM**: Aktivierungsschalter, URL, Zugangsdaten.
- **Cortex**: Aktivierungsschalter, URL, Zugangsdaten. Externe Integration, kein gebündeltes Subchart; die URL zeigt auf die Cortex-Instanz des Mandanten (siehe /de-de/integrate/cortex).
- **TheHive**: Aktivierungsschalter, URL, Organisation, Zugangsdaten. Externe Integration, kein gebündeltes Subchart; die URL zeigt auf die TheHive-Instanz des Mandanten (siehe /de-de/integrate/thehive).
- **Slack**: Webhook- + interaktive Backend-Konfiguration.

Der Link **Bring your own LLM key →** führt zur mandantenspezifischen LLM-Schlüsselrotation (mandantenspezifische LLM-Schlüssel überschreiben den installationsweiten).

### LLM-Detailseite

![LLM-Einstellungsdetail](/screenshots/settings-llm.png)

Eigenständige Seite, erreichbar über Settings → **Bring your own LLM key →**. In V1 ist dies **ausschließlich die mandantenspezifische BYOK-Schlüsseleingabe**: das Formular nimmt den API-Schlüssel für den **aktuell im Geltungsbereich befindlichen Mandanten** entgegen und übermittelt ihn über `PUT /api/tenant/llm/api-key` (den mandantenseitigen Endpoint; MSSP-Admins können auch `PUT /api/mssp/tenants/{tenant_id}/llm/api-key` verwenden). Die anderen auf der übergeordneten Einstellungsseite angezeigten LLM-Felder (Provider, Modell, Temperature) sind Stub-Werte; sie sind auch hier nicht editierbar. Siehe [Täglicher Betrieb → Mandantenspezifischen LLM-Schlüssel rotieren](/de-de/operations#rotate-per-tenant-llm-key) für das Rotationsverfahren.

## Siehe auch

- [Täglicher Betrieb](/de-de/operations), die Runbook-Seite dieser Seiten (Prüfung, Untersuchungen, Decommission, Rotation).
- [Wazuh Ingress](/de-de/reference/wazuh-ingress), der Agent-Onboarding-Ablauf aus dem Mandantendetail.
- [Sicherheitsmodell](/de-de/reference/security-model), was jede MSSP-Rolle (`platform_admin`, `mssp_admin`, `analyst`, `customer_viewer`) tun darf.
