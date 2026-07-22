# Observability

Metriken und Logs für einen MSSP, der SocTalk betreibt. Zwei Konsumenten im Blick: Dashboards für die Kapazitätsplanung und Dashboards für die Kosten pro Mandant.

## Prometheus-Endpoint

`GET /metrics` auf dem `soctalk-system-api` Service stellt die Metriken der Installation im Prometheus-Expositionsformat bereit. Absichtlich nicht authentifiziert; schränke ihn über eine NetworkPolicy oder einen Ingress mit `auth-basic`/IP-Allowlist ein, falls er nicht weltweit lesbar sein soll.

## Stand der Instrumentierung in V1

Der Metrikkatalog unten beschreibt die **definierte** Metrikoberfläche (in `src/soctalk/core/observability/metrics.py`). In V1 wird nur `soctalk_tenant_adapter_heartbeat_age_seconds` sichtbar durch Code aktualisiert (im Handler des Adapter-Heartbeats). Die anderen Metriken sind zwar definiert, aber **noch nicht an den Aufrufstellen instrumentiert**: sie werden als Null/leer exportiert. Behandle die Tabelle als Designziel, bis die Laufzeit-Hooks eintreffen.

## Zähler pro Mandant (definierte Oberfläche)

Alle mit `tenant_id` gelabelt. Die Kardinalität ist durch die Anzahl der Mandanten in der Installation begrenzt.

| Metrik | Typ | Bedeutung | In V1 instrumentiert? |
|---|---|---|---|
| `soctalk_tenant_events_ingested_total` | counter | Vom Wazuh-Adapter des Mandanten empfangene Warnungen | noch nicht |
| `soctalk_tenant_investigations_opened_total` | counter | Geöffnete Untersuchungen | noch nicht |
| `soctalk_tenant_investigations_closed_total{disposition}` | counter | Geschlossen nach Disposition | noch nicht |
| `soctalk_tenant_pending_reviews` | gauge | Prüfungen, die auf ein menschliches Gate warten | noch nicht |
| `soctalk_tenant_llm_tokens_total{direction}` | counter | LLM-Tokens ein/aus, der Kostentreiber | noch nicht |
| `soctalk_tenant_adapter_heartbeat_age_seconds` | gauge | Sekunden seit dem letzten Heartbeat des Adapters | **ja** (aktualisiert durch `/api/internal/adapter/heartbeat`). **Der automatische Übergang in den degradierten Zustand ist nicht implementiert**; nutze dies als eigene Alerting-Eingabe |

## Zähler auf Installationsebene (definierte Oberfläche)

| Metrik | Typ | Bedeutung | In V1 instrumentiert? |
|---|---|---|---|
| `soctalk_install_tenants_total{state}` | gauge | Mandantenanzahl nach Zustand | noch nicht |
| `soctalk_api_request_duration_seconds{method,path_template,status}` | histogram | API-Latenz nach Template-Pfad | noch nicht |
| `soctalk_helm_op_duration_seconds{op,outcome}` | histogram | Dauer von Helm-Operationen | noch nicht |

`path_template` wäre das FastAPI-Routen-Template (z. B. `/api/mssp/tenants/{id}`), sodass die Kardinalität begrenzt bleibt.

## Empfohlene Grafana-Dashboards

### Gesundheit der MSSP-Control-Plane

- Pod-Bereitschaft (Wazuh-Stil: grüne/gelbe/rote Kacheln pro Deployment)
- `soctalk_api_request_duration_seconds` p50/p95/p99 nach `path_template`
- `soctalk_install_tenants_total`, gestapelt nach Zustand, Flottengesundheit auf einen Blick
- `soctalk_tenant_adapter_heartbeat_age_seconds` pro Mandant als Heatmap, einen sich verschlechternden Kunden erkennen, bevor er anruft

### Kosten pro Mandant

- `rate(soctalk_tenant_llm_tokens_total[1h])`, gestapelt nach Mandant, die größten Ausgeber in dieser Stunde
- Tägliche Gesamt-Tokens × der $/Mtok deines Anbieters = Kostenprognose
- Burn-down gegenüber dem Token-Budget pro Lauf (`case_runs.tokens_budget`, Modellstandard 200.000; der Env-Fallback-Standard `SOCTALK_CASE_RUN_TOKEN_BUDGET` von 15.000 greift nur, wenn die Zeile keinen Wert hat), wie oft sprengt ein einzelner Lauf das Budget?

### Service-Ebene

- `rate(soctalk_tenant_investigations_opened_total[5m])`: Eingangsrate
- `rate(soctalk_tenant_investigations_closed_total{disposition="escalate"}[1h])`: Eskalationsrate (diese findet sich auch auf der Seite [Analytics](/de-de/mssp-ui#analytics))
- `soctalk_tenant_pending_reviews`: Menschen hinter / vor der Warteschlange

## Logs

Standardmäßig JSON auf stderr, via `structlog`. Die API und der Orchestrator sind konfigurierbar über:

| Env-Variable | Standard | Wirkung |
|---|---|---|
| `SOCTALK_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SOCTALK_LOG_FILE` | nicht gesetzt | Falls gesetzt, stderr in Datei spiegeln |
| `SOCTALK_LOG_FORMAT` | `json` | `json` oder `console` (menschenlesbar für die Entwicklung) |

Jede Logzeile enthält `tenant_id` und `case_id`, sofern zutreffend, sodass sich das stderr eines einzelnen SocTalk-Pods nachgelagert nach Mandant aufteilen lässt.

Worker-Pods (runs-worker pro Mandant) geben dieselbe Struktur aus. Aggregiere sie in deiner üblichen Log-Pipeline (Loki, Elasticsearch, CloudWatch).

## Tracing

OpenTelemetry-Instrumentierung ist in diesem Release **nicht** verdrahtet. Spans für die Verarbeitung von API-Anfragen, die Ausführung von LangGraph-Knoten und LLM-Aufrufe sind als geplantes Feature vorgesehen; heute ist die einzige Oberfläche für „Warum hat dieser Fall 90 Sekunden gedauert" strukturierte Logs + die Prometheus-Histogramme oben.

## Alerting-Beispiele

PromQL-Snippets für gängige Alerts:

### Mandant zu lange degradiert

```promql
soctalk_tenant_adapter_heartbeat_age_seconds > 1800
```

Alert: Mandant ist seit über 30 Min. still. Rufbereitschaft benachrichtigen.

### Anstieg der API-Fehler

```promql
sum by (path_template) (
  rate(soctalk_api_request_duration_seconds_count{status=~"5.."}[5m])
) > 0.5
```

### LLM-Budget-Verbrauch

```promql
sum by (tenant_id) (
  rate(soctalk_tenant_llm_tokens_total[1h])
) > 5000000
```

Passe den Schwellenwert an die erwartete Normalrate deiner Installation an. Ein Anstieg bedeutet meist, dass ein Modell in `needs_more_info` festhängt.

## Was hier nicht enthalten ist

- **Verteilte Traces von HIL-Entscheidungen**: Menschen sind nicht in OTel-Traces; das Audit-Log ist die Quelle der Wahrheit dafür, wer was entschieden hat.
- **End-to-End-SLOs pro Kunde**: Analytics erledigt dies in der UI; PromQL dafür steht auf der Roadmap als kanonische Dashboards (heute sind sie installationsdefiniert).
- **Synthetisches Monitoring**: außerhalb des Geltungsbereichs von SocTalk selbst. Nutze deinen üblichen externen Probe-Dienst gegen die SOC-URL des Kunden.
