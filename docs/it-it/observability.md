# Observability

Metriche e log per un MSSP che esegue SocTalk. Due destinatari in mente: dashboard di capacity planning e dashboard di costo per singolo tenant.

## Endpoint Prometheus

`GET /metrics` sul Service `soctalk-system-api` espone le metriche dell'installazione nel formato di esposizione Prometheus. Non autenticato per scelta progettuale; limitalo tramite NetworkPolicy oppure un Ingress con `auth-basic`/allowlist di IP se non vuoi che sia leggibile da chiunque.

## Stato dell'strumentazione in V1

Il catalogo delle metriche qui sotto descrive la superficie di metriche **definita** (in `src/soctalk/core/observability/metrics.py`). In V1 solo `soctalk_tenant_adapter_heartbeat_age_seconds` viene aggiornata in modo visibile dal codice (nel gestore dell'heartbeat dell'adapter). Le altre metriche sono definite ma **non ancora strumentate nei punti di chiamata**: verranno esportate come zero/vuote. Considera la tabella come l'obiettivo di progettazione finché non arrivano gli hook a runtime.

## Contatori per singolo tenant (superficie definita)

Tutti etichettati con `tenant_id`. La cardinalità è limitata dal numero di tenant nell'installazione.

| Metrica | Tipo | Significato | Strumentata in V1? |
|---|---|---|---|
| `soctalk_tenant_events_ingested_total` | counter | Alert ricevuti dall'adapter Wazuh del tenant | non ancora |
| `soctalk_tenant_investigations_opened_total` | counter | Indagini aperte | non ancora |
| `soctalk_tenant_investigations_closed_total{disposition}` | counter | Chiuse per disposizione | non ancora |
| `soctalk_tenant_pending_reviews` | gauge | Revisioni in attesa di un gate umano | non ancora |
| `soctalk_tenant_llm_tokens_total{direction}` | counter | Token LLM in ingresso/uscita, il driver di costo | non ancora |
| `soctalk_tenant_adapter_heartbeat_age_seconds` | gauge | Secondi trascorsi dall'ultimo heartbeat dell'adapter | **sì** (aggiornata da `/api/internal/adapter/heartbeat`). **La transizione auto-degraded non è implementata**; usala come input per il tuo alerting |

## Contatori a livello di installazione (superficie definita)

| Metrica | Tipo | Significato | Strumentata in V1? |
|---|---|---|---|
| `soctalk_install_tenants_total{state}` | gauge | Conteggio dei tenant per stato | non ancora |
| `soctalk_api_request_duration_seconds{method,path_template,status}` | histogram | Latenza API per template di path | non ancora |
| `soctalk_helm_op_duration_seconds{op,outcome}` | histogram | Durate delle operazioni Helm | non ancora |

`path_template` sarebbe il template di route FastAPI (ad es. `/api/mssp/tenants/{id}`), così la cardinalità resta limitata.

## Dashboard Grafana suggerite

### Salute del control plane MSSP

- Prontezza dei pod (stile Wazuh: tile verde/giallo/rosso per ogni Deployment)
- `soctalk_api_request_duration_seconds` p50/p95/p99 per `path_template`
- `soctalk_install_tenants_total` impilato per stato, salute della flotta a colpo d'occhio
- Heatmap di `soctalk_tenant_adapter_heartbeat_age_seconds` per singolo tenant, individua un cliente in degrado prima che chiami

### Costo per singolo tenant

- `rate(soctalk_tenant_llm_tokens_total[1h])` impilato per tenant, chi spende di più in questa ora
- Token totali giornalieri × il $/Mtok del tuo provider = proiezione di costo
- Burn-down rispetto al budget di token per esecuzione (`case_runs.tokens_budget`, default del modello 200.000; il fallback dell'env `SOCTALK_CASE_RUN_TOKEN_BUDGET` con default 15.000 si applica solo quando la riga non ha valore): quanto spesso una singola esecuzione sfora il budget?

### A livello di servizio

- `rate(soctalk_tenant_investigations_opened_total[5m])`: tasso di ingresso
- `rate(soctalk_tenant_investigations_closed_total{disposition="escalate"}[1h])`: tasso di escalation (presente anche nella pagina [Analytics](/it-it/mssp-ui#analytics))
- `soctalk_tenant_pending_reviews`: umani indietro / avanti rispetto alla coda

## Logs

JSON su stderr per impostazione predefinita, tramite `structlog`. L'API e l'orchestratore sono configurabili tramite:

| Variabile d'ambiente | Default | Effetto |
|---|---|---|
| `SOCTALK_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SOCTALK_LOG_FILE` | non impostata | Se impostata, replica stderr su file |
| `SOCTALK_LOG_FORMAT` | `json` | `json` o `console` (leggibile dall'uomo, per lo sviluppo) |

Ogni riga di log include `tenant_id` e `case_id` se applicabili, così lo stderr di un singolo pod SocTalk è suddivisibile per tenant a valle.

I pod worker (runs-worker per singolo tenant) emettono la stessa forma. Aggregali nella tua consueta pipeline di log (Loki, Elasticsearch, CloudWatch).

## Tracing

La strumentazione OpenTelemetry **non** è cablata in questa release. Gli span per la gestione delle richieste API, l'esecuzione dei nodi LangGraph e le chiamate LLM sono tracciati come funzionalità pianificata; oggi l'unica superficie per capire "perché questo caso ha impiegato 90 secondi" sono i log strutturati + gli histogram Prometheus qui sopra.

## Esempi di alerting

Snippet PromQL per alert comuni:

### Tenant in degrado da troppo tempo

```promql
soctalk_tenant_adapter_heartbeat_age_seconds > 1800
```

Alert: il tenant è silenzioso da oltre 30 min. Chiama il reperibile.

### Picco di errori API

```promql
sum by (path_template) (
  rate(soctalk_api_request_duration_seconds_count{status=~"5.."}[5m])
) > 0.5
```

### Consumo del budget LLM

```promql
sum by (tenant_id) (
  rate(soctalk_tenant_llm_tokens_total[1h])
) > 5000000
```

Adatta la soglia al tasso normale atteso della tua installazione. Un picco di solito significa che un modello sta iterando in loop su `needs_more_info`.

## Cosa non è incluso qui

- **Trace distribuite delle decisioni HIL**: gli umani non sono nelle trace OTel; l'audit log è la fonte di verità su chi ha deciso cosa.
- **SLO end-to-end per cliente**: Analytics lo fa nella UI; il PromQL relativo è nella roadmap come dashboard canoniche (oggi sono definite per installazione).
- **Monitoraggio sintetico**: fuori ambito per SocTalk stesso. Usa il tuo consueto servizio di probe esterno contro l'URL del SOC del cliente.
