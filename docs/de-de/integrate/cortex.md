# Cortex

[Cortex](https://thehive-project.org/) bietet die Analyse von Observables (Reputation, Sandbox-Detonation, Whois usw.) über seine „Analyzer"-Plugins. Der [`cortex_worker`](/de-de/ai-pipeline)-Node von SocTalk sendet Observables während der Anreicherung durch Cortex.

## Hosting-Modell

Das `soctalk-tenant`-Chart in V1 hat kein Cortex-Subchart (`dependencies: []`). Es gibt folgende Möglichkeiten:

- **Kundenverwaltetes Cortex**: der Kunde betreibt sein eigenes; der MSSP stellt URL + API-Key bereit.
- **Kein Cortex**: die AI-Pipeline versucht trotzdem die `ENRICH`-Route (der Supervisor weiß nicht, dass Cortex fehlt); jeder `cortex_worker`-Aufruf schlägt fehl und der Fehler wird protokolliert. In V1 gibt es kein Statusfeld pro Observable; der Worker kehrt einfach ohne Anreicherung zurück und der Supervisor fährt fort.

Ein „gebündeltes Cortex-Subchart" wurde in früheren Entwürfen als geplante Option beschrieben, ist aber **in diesem Release nicht implementiert**.

## Konfigurieren (MSSP-UI)

Mandantendetails → Einstellungen → Cortex.

| Feld | Hinweise |
|---|---|
| Enable | Standardmäßig deaktiviert |
| URL | `https://cortex.<customer>.example` für kundenverwaltet; `http://cortex.tenant-<slug>.svc:9001` für gebündelt |
| API key | Cortex-API-Key des Kunden mit `analyze:any` |
| Verify TLS | Standardmäßig aktiviert |
| Default TLP | Standard `2` (Amber). Wird verwendet, wenn SocTalk Observables ohne TLP übermittelt |

**In V1 gibt es keine API zum Ändern der Cortex-Integrationseinstellungen.** Cortex-Aufrufe finden im **mandantenspezifischen runs-worker** statt, nicht im zentralen API-Pod, sodass Umgebungsvariablen auf `soctalk-system-api` wirkungslos sind. Um Cortex in V1 zu konfigurieren, setze die Umgebungsvariablen auf dem `soctalk-runs-worker`-Deployment des Mandanten im Namespace `tenant-<slug>` (`helm upgrade` des Mandanten-Charts oder `kubectl set env` + `rollout restart`). Rotiere den API-Key, indem du das Secret im Mandanten-Namespace patchst und den runs-worker neu startest. Eine saubere, API-gesteuerte Konfigurationsoberfläche ist in der Roadmap.

## Analyzer-Auswahl

Für jedes Observable versucht der Worker den **ersten Analyzer-Namen** in einer fest codierten `ANALYZER_MAP` (in [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) für den Typ des Observables, ohne zu prüfen, ob dieser Analyzer tatsächlich auf der Cortex-Instanz installiert ist. Wenn der Analyzer nicht installiert ist (oder fehlschlägt), wird der Fehler protokolliert und der Worker kehrt ohne die Anreicherung zurück. In V1 gibt es kein Fallback auf einen zweiten Analyzer; installiere den in `ANALYZER_MAP` genannten kanonischen Analyzer für jeden Observable-Typ, der dir wichtig ist. Die Bereitstellung der Analyzer-Präferenzreihenfolge als Chart-Wert ist in der Roadmap.

## Kosten

Cortex selbst ist kostenlos; die Analyzer-Anbieter berechnen Gebühren für Abfragen. SocTalk misst Cortex-Aufrufe nicht direkt, miss sie beim Anbieter:

- VirusTotal: Kontingent pro Key
- AbuseIPDB: Kontingent pro Key
- Hybrid Analysis: Kontingent pro Key

Der Observable-Durchsatz pro Mandant ist über `soctalk_tenant_events_ingested_total` (jedes ingestierte Event löst ca. 1–5 Observable-Extraktionen aus) unter [Observability](/de-de/observability#per-tenant-counters-defined-surface) sichtbar.

## Worker-Verhalten

Der `cortex_worker`-Node hat eine fest codierte `ANALYZER_MAP` (in [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)), die jeden Observable-Typ einer kleinen Liste von Analyzer-Namen zuordnet. Für jedes Observable übermittelt der Worker an den **ersten** Analyzer in dieser Liste, ohne die Verfügbarkeit zu prüfen; wenn dieser Analyzer nicht installiert ist oder fehlschlägt, wird die Anreicherung des Observables als fehlgeschlagen aufgezeichnet.

Ablauf:

1. Liest die aktuelle Observable-Liste des Falls aus dem State.
2. Schlägt für jedes Observable die Analyzer-Liste in `ANALYZER_MAP` für dessen Typ nach.
3. Übermittelt an den ersten zugeordneten Analyzer über den `/api/observable`-Endpoint von Cortex.
4. Fragt `/api/job/{id}/report` ab, bis der Job abgeschlossen ist oder ein Timeout pro Job auslöst.
5. Hängt das Verdikt (`safe`, `info`, `suspicious`, `malicious`) und den Report-Body an den Fall-State an. Fehlgeschlagene Jobs protokollieren den Fehler und fahren fort.

Fehlgeschlagene Cortex-Aufrufe lassen den Run nicht fehlschlagen, der Worker protokolliert den Fehler und kehrt ohne Anreicherung für dieses Observable zum Supervisor zurück. Der Verdict-Node schließt auf Basis des jeweils verfügbaren Kontexts.

## Gebündeltes Cortex: nicht in diesem Release

Das `soctalk-tenant`-Chart bündelt Cortex nicht als Subchart. Betreibe Cortex selbst (kundenverwaltet), wenn du Analyzer-Anreicherung möchtest. Ein SocTalk-verwaltetes Cortex ist in der Roadmap.

## API-Key rotieren

1. Generiere in Cortex einen neuen Key mit `analyze:any`.
2. Patche das Secret im Mandanten-Namespace, das die Cortex-Anmeldedaten hält, und starte den runs-worker neu: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Widerrufe den alten Key in Cortex.

## Was hier nicht enthalten ist

- Entwicklung eigener Analyzer, nicht im Umfang; siehe [TheHive-Project/Cortex-Analyzers](https://github.com/TheHive-Project/Cortex-Analyzers).
- TLP/PAP-Overrides pro Observable, geplant; heute gilt der Mandanten-Standard für jede Übermittlung.

## Quellverweise

| Konzept | Datei |
|---|---|
| Worker-Node + ANALYZER_MAP | [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py) |
| Einstellungsschema | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
