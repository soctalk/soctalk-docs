# TheHive

[TheHive](https://thehive-project.org/) ist optional (Opt-in). Wenn es pro Mandant konfiguriert ist, exportiert SocTalk Abschlüsse mit `escalate`-Disposition als TheHive-Fälle. Der Untersuchungsverlauf (Observables, KI-Begründung, Entscheidung der menschlichen Prüfung) wird zum ersten Observable-Set und zur Timeline des Falls.

Das mentale Modell findest du unter [KI-Pipeline → Abschluss](/de-de/ai-pipeline). Zur Außerbetriebnahme eines Mandanten mit aktiviertem TheHive siehe [Mandanten-Lebenszyklus → Außerbetriebnahme](/de-de/tenant-lifecycle#decommission-vs-purge).

## Hosting-Modell

In V1 hat das `soctalk-tenant`-Chart kein TheHive-Subchart (`dependencies: []`). Die Optionen sind:

- **Kundenverwaltetes TheHive**: der Kunde betreibt sein eigenes TheHive anderswo; der MSSP liefert die URL und einen API-Schlüssel pro Mandant.
- **Kein TheHive**: Eskalationen verbleiben ausschließlich in der SocTalk-UI. Standard.

Ein Pfad für ein „gebündeltes TheHive-Subchart“ wurde in früheren Entwürfen dieser Seite als geplante Option beschrieben, ist aber **in diesem Release nicht implementiert**. Es gibt kein von SocTalk verwaltetes Cassandra-StatefulSet und kein TheHive-Deployment für den Mandanten.

## Konfigurieren (MSSP-UI)

Mandantendetail → Einstellungen → TheHive. Felder:

| Feld | Hinweise |
|---|---|
| Enable | Standardmäßig aus |
| URL | `https://thehive.<customer>.example` für kundenverwaltet; `http://thehive.tenant-<slug>.svc:9000` für gebündelt |
| Organisation | TheHive-Organisations-Slug (mandantenfähige TheHive-Instanzen) |
| API key | TheHive-API-Schlüssel des Kunden mit `case:create`, `observable:create`, `task:create` |
| Verify TLS | Standardmäßig an; für selbstsigniertes Dev-TheHive ausschalten |

**In V1 gibt es keine API zum Ändern der TheHive-Integrationseinstellungen.** Der TheHive-Aufruf lebt im **Runs-Worker pro Mandant** (der die MCP-Bindings hält), nicht im zentralen API-Pod. Das Setzen von `THEHIVE_*`-Umgebungsvariablen auf `soctalk-system-api` hat daher keine Auswirkung auf den Worker. Um TheHive in V1 zu konfigurieren, setze die Umgebungsvariablen auf dem `soctalk-runs-worker`-Deployment des Mandanten im Namespace `tenant-<slug>` (und rendere neu via `helm upgrade` des Mandanten-Charts oder `kubectl set env` gefolgt von `rollout restart`). Eine saubere API-gesteuerte Konfigurationsoberfläche steht auf der Roadmap.

## Was exportiert wird

In V1 erfolgt der TheHive-Export **synchron zum Graph-Node-Zeitpunkt** über den `thehive_worker`-Node, der die API von TheHive per MCP aufruft. Heute erstellt dies den Fall (Titel + Schweregrad gespiegelt vom SocTalk-Verdict) und die Observables. Die reichhaltigere Oberfläche, aus `next_actions` abgeleitete Tasks, Timeline-Spiegelung von Worker-Begründungen / Entscheidungen der menschlichen Prüfung, **asynchrone Outbox + Retry**: wird in früheren Entwürfen als Design-Ziel beschrieben, ist aber **in diesem Release nicht implementiert**. Ist TheHive nicht erreichbar, protokolliert der Worker-Node den Fehler und der Fall wird in SocTalk ohne exportiertes Gegenstück fortgeführt. Es gibt keine Retry-Schleife, keine Outbox, kein persistiertes „last error“-Feld und keine Dashboard-Oberfläche für fehlgeschlagene Exporte, Fehler sind nur in den strukturierten Logs des Orchestrators sichtbar.

Zuordnung der Observable-Typen (gemäß V1-Implementierung):

| SocTalk-Typ | TheHive `dataType` |
|---|---|
| `ip` | `ip` |
| `fqdn` | `fqdn` |
| `url` | `url` |
| `hash_md5`, `hash_sha1`, `hash_sha256` | `hash` |
| `email` | `mail` |
| `filename` | `filename` |
| `user` | `other` (mit `tags: user`) |
| `process` | `other` (mit `tags: process`) |
| `registry_key` | `registry` |

## Gebündeltes TheHive: nicht in diesem Release

Das `soctalk-tenant`-Chart bündelt in V1 TheHive nicht als Subchart, `Chart.yaml` listet `dependencies: []`. Betreiber, die eine TheHive-Instanz pro Mandant wünschen, betreiben sie selbst (manuelles `helm install` im Mandanten-Namespace oder kundenverwaltet anderswo). Ein gebündeltes Subchart mit chart-verwalteten Admin-Secrets wird in früheren Entwürfen als Design-Ziel beschrieben, steht aber auf der Roadmap.

## Kundenverwaltetes TheHive: Hinweise

- Das TheHive des Kunden muss von der SocTalk-Control-Plane aus erreichbar sein (Egress zur TheHive-URL des Kunden).
- Der Kunde erstellt den API-Schlüssel mit den oben aufgeführten Mindest-Scopes. SocTalk benötigt keinen Admin-Scope.
- Wenn das TheHive des Kunden Quell-IP-Allowlists erzwingt, nimm die Egress-NAT-IP der SocTalk-Control-Plane in die Allowlist auf.

## Status / Zustand

In diesem Release gibt es **keine Hintergrund-Health-Ping-Schleife** für TheHive, SocTalk berührt TheHive nur, wenn eine Untersuchung etwas zu exportieren hat. Fehler während dieses Aufrufs werden ausschließlich in der strukturierten Ausgabe des Orchestrators protokolliert; es gibt kein persistiertes Fehlerfeld und keinen Outbox-basierten Retry. Die MSSP-UI zeigt keinen separaten Indikator „TheHive erreichbar“ an.

Um den Zustand von TheHive zu überwachen, nutze deine übliche externe Sonde (Prometheus-Blackbox-Exporter gegen TheHives `/api/status` usw.), das liegt in der Verantwortung des MSSP und ist in diesem Release nicht Teil von SocTalk.

## API-Schlüssel rotieren

1. Erzeuge im TheHive des Kunden einen neuen API-Schlüssel mit denselben Scopes.
2. Patche das Secret im Mandanten-Namespace, das die TheHive-Credentials hält, und rolle den Runs-Worker neu: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Widerrufe den alten Schlüssel in TheHive.

Ein Live-Reload-Pfad (Überwachung der gemounteten Secret-Datei) ist geplant.

## Quell-Verweise

| Konzept | Datei |
|---|---|
| TheHive-Worker / Export | [`src/soctalk/workers/thehive.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/thehive.py) |
| Settings-Schema | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
| MCP-Tool-Bridge | [`src/soctalk/chat/mcp_tools.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/chat/mcp_tools.py) |
