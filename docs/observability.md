# Observability

Metrics and logs for an MSSP running SocTalk. Two consumers in mind: capacity-planning dashboards and per-tenant cost dashboards.

## Prometheus endpoint

`GET /metrics` on the `soctalk-system-api` Service exposes the install's metrics in Prometheus exposition format. Unauthenticated by design; scope it via NetworkPolicy or an Ingress with `auth-basic`/IP allowlist if you don't want it world-readable.

## V1 instrumentation status

The metrics catalog below describes the **defined** metric surface (in `src/soctalk/core/observability/metrics.py`). In V1 only `soctalk_tenant_adapter_heartbeat_age_seconds` is visibly updated by code (in the adapter heartbeat handler). The other metrics are defined but **not yet instrumented at call sites**: they will export as zero/empty. Treat the table as the design target until the runtime hooks land.

## Per-tenant counters (defined surface)

All labeled with `tenant_id`. Cardinality is bounded by the number of tenants in the install.

| Metric | Type | Meaning | V1 instrumented? |
|---|---|---|---|
| `soctalk_tenant_events_ingested_total` | counter | Alerts received from the tenant's Wazuh adapter | not yet |
| `soctalk_tenant_investigations_opened_total` | counter | Investigations opened | not yet |
| `soctalk_tenant_investigations_closed_total{disposition}` | counter | Closed by disposition | not yet |
| `soctalk_tenant_pending_reviews` | gauge | Reviews waiting on a human gate | not yet |
| `soctalk_tenant_llm_tokens_total{direction}` | counter | LLM tokens in/out, the cost driver | not yet |
| `soctalk_tenant_adapter_heartbeat_age_seconds` | gauge | Seconds since the adapter's last heartbeat | **yes** (updated by `/api/internal/adapter/heartbeat`). **Auto-degraded transition is not implemented**; use this as your own alerting input |

## Install-level counters (defined surface)

| Metric | Type | Meaning | V1 instrumented? |
|---|---|---|---|
| `soctalk_install_tenants_total{state}` | gauge | Tenant count by state | not yet |
| `soctalk_api_request_duration_seconds{method,path_template,status}` | histogram | API latency by template path | not yet |
| `soctalk_helm_op_duration_seconds{op,outcome}` | histogram | Helm operation durations | not yet |

`path_template` would be the FastAPI route template (e.g. `/api/mssp/tenants/{id}`), so cardinality stays bounded.

## Suggested Grafana dashboards

### MSSP control plane health

- Pod readiness (Wazuh-style: green/yellow/red tiles per Deployment)
- `soctalk_api_request_duration_seconds` p50/p95/p99 by `path_template`
- `soctalk_install_tenants_total` stacked by state, at-a-glance fleet health
- Per-tenant `soctalk_tenant_adapter_heartbeat_age_seconds` heatmap, spot a degrading customer before they call

### Per-tenant cost

- `rate(soctalk_tenant_llm_tokens_total[1h])` stacked by tenant, top spenders this hour
- Daily total tokens × your provider's $/Mtok = cost projection
- Burn-down vs the per-run token budget (`case_runs.tokens_budget`, model default 200,000; `SOCTALK_CASE_RUN_TOKEN_BUDGET` env fallback default 15,000 only applies when the row has no value): how often does a single run blow the budget?

### Service-level

- `rate(soctalk_tenant_investigations_opened_total[5m])`: ingress rate
- `rate(soctalk_tenant_investigations_closed_total{disposition="escalate"}[1h])`: escalation rate (this also lives on the [Analytics](/mssp-ui#analytics) page)
- `soctalk_tenant_pending_reviews`: humans behind / ahead of the queue

## Logs

JSON to stderr by default, via `structlog`. The API and orchestrator are configurable via:

| Env var | Default | Effect |
|---|---|---|
| `SOCTALK_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SOCTALK_LOG_FILE` | unset | If set, mirror stderr to file |
| `SOCTALK_LOG_FORMAT` | `json` | `json` or `console` (human-readable for dev) |

Every log line includes `tenant_id` and `case_id` if applicable, so a single SocTalk pod's stderr is splittable by tenant downstream.

Worker pods (per-tenant runs-worker) emit the same shape. Aggregate them in your usual log pipeline (Loki, Elasticsearch, CloudWatch).

## Tracing

OpenTelemetry instrumentation is **not** wired in this release. Spans for API request handling, LangGraph node execution, and LLM calls are tracked as a planned feature; today the only "why did this case take 90 seconds" surface is structured logs + the Prometheus histograms above.

## Alerting examples

PromQL snippets for common alerts:

### Tenant degraded too long

```promql
soctalk_tenant_adapter_heartbeat_age_seconds > 1800
```

Alert: tenant has been silent for over 30 min. Page on-call.

### API errors spike

```promql
sum by (path_template) (
  rate(soctalk_api_request_duration_seconds_count{status=~"5.."}[5m])
) > 0.5
```

### LLM budget burn

```promql
sum by (tenant_id) (
  rate(soctalk_tenant_llm_tokens_total[1h])
) > 5000000
```

Adjust the threshold to your install's expected normal rate. A spike usually means a model is looping on `needs_more_info`.

## What's not in here

- **Distributed traces of HIL decisions**: humans aren't in OTel traces; the audit log is the source of truth for who decided what.
- **End-to-end SLOs by customer**: Analytics does this in the UI; PromQL for them is on the roadmap as canonical dashboards (today they're install-defined).
- **Synthetic monitoring**: out of scope for SocTalk itself. Use your usual external probe service against the customer SOC URL.
