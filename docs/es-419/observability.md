# Observabilidad

Métricas y logs para un MSSP que ejecuta SocTalk. Dos consumidores en mente: dashboards de planificación de capacidad y dashboards de costos por tenant.

## Endpoint de Prometheus

`GET /metrics` en el Service `soctalk-system-api` expone las métricas de la instalación en formato de exposición de Prometheus. Sin autenticación por diseño — restríngelo mediante una NetworkPolicy o un Ingress con `auth-basic`/lista de IP permitidas si no quieres que sea legible por todo el mundo.

## Estado de la instrumentación en V1

El catálogo de métricas a continuación describe la superficie de métricas **definida** (en `src/soctalk/core/observability/metrics.py`). En V1 solo `soctalk_tenant_adapter_heartbeat_age_seconds` es actualizada de forma visible por el código (en el manejador del heartbeat del adaptador). Las demás métricas están definidas pero **aún no instrumentadas en los puntos de llamada** — se exportarán como cero/vacías. Trata la tabla como el objetivo de diseño hasta que aterricen los hooks de runtime.

## Contadores por tenant (superficie definida)

Todos etiquetados con `tenant_id`. La cardinalidad está acotada por el número de tenants en la instalación.

| Métrica | Tipo | Significado | ¿Instrumentada en V1? |
|---|---|---|---|
| `soctalk_tenant_events_ingested_total` | counter | Alertas recibidas del adaptador Wazuh del tenant | todavía no |
| `soctalk_tenant_investigations_opened_total` | counter | Investigaciones abiertas | todavía no |
| `soctalk_tenant_investigations_closed_total{disposition}` | counter | Cerradas por disposición | todavía no |
| `soctalk_tenant_pending_reviews` | gauge | Revisiones esperando en una compuerta humana | todavía no |
| `soctalk_tenant_llm_tokens_total{direction}` | counter | Tokens de LLM de entrada/salida — el impulsor del costo | todavía no |
| `soctalk_tenant_adapter_heartbeat_age_seconds` | gauge | Segundos desde el último heartbeat del adaptador | **sí** (actualizada por `/api/internal/adapter/heartbeat`). **La transición de degradación automática no está implementada**; úsala como tu propia entrada de alertas |

## Contadores a nivel de instalación (superficie definida)

| Métrica | Tipo | Significado | ¿Instrumentada en V1? |
|---|---|---|---|
| `soctalk_install_tenants_total{state}` | gauge | Conteo de tenants por estado | todavía no |
| `soctalk_api_request_duration_seconds{method,path_template,status}` | histogram | Latencia de la API por ruta de plantilla | todavía no |
| `soctalk_helm_op_duration_seconds{op,outcome}` | histogram | Duraciones de operaciones de Helm | todavía no |

`path_template` sería la plantilla de ruta de FastAPI (p. ej. `/api/mssp/tenants/{id}`), de modo que la cardinalidad se mantiene acotada.

## Dashboards de Grafana sugeridos

### Salud del plano de control MSSP

- Disponibilidad de pods (estilo Wazuh: mosaicos verde/amarillo/rojo por Deployment)
- `soctalk_api_request_duration_seconds` p50/p95/p99 por `path_template`
- `soctalk_install_tenants_total` apilado por estado — salud de la flota de un vistazo
- Mapa de calor de `soctalk_tenant_adapter_heartbeat_age_seconds` por tenant — detecta a un cliente que se está degradando antes de que llame

### Costo por tenant

- `rate(soctalk_tenant_llm_tokens_total[1h])` apilado por tenant — los que más gastan esta hora
- Total diario de tokens × el $/Mtok de tu proveedor = proyección de costo
- Consumo restante frente al presupuesto de tokens por ejecución (`case_runs.tokens_budget`, valor por defecto del modelo 200,000; el valor por defecto de respaldo de la variable de entorno `SOCTALK_CASE_RUN_TOKEN_BUDGET` de 15,000 solo aplica cuando la fila no tiene valor) — ¿con qué frecuencia una sola ejecución revienta el presupuesto?

### A nivel de servicio

- `rate(soctalk_tenant_investigations_opened_total[5m])` — tasa de ingreso
- `rate(soctalk_tenant_investigations_closed_total{disposition="escalate"}[1h])` — tasa de escalamiento (esto también vive en la página de [Analítica](/es-419/mssp-ui#analytics))
- `soctalk_tenant_pending_reviews` — humanos por detrás / por delante de la cola

## Logs

JSON a stderr por defecto, vía `structlog`. La API y el orquestador son configurables mediante:

| Variable de entorno | Por defecto | Efecto |
|---|---|---|
| `SOCTALK_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SOCTALK_LOG_FILE` | sin definir | Si se define, refleja stderr a un archivo |
| `SOCTALK_LOG_FORMAT` | `json` | `json` o `console` (legible por humanos para desarrollo) |

Cada línea de log incluye `tenant_id` y `case_id` si aplica, de modo que el stderr de un solo pod de SocTalk se puede separar por tenant aguas abajo.

Los pods worker (runs-worker por tenant) emiten la misma forma. Agrégalos en tu pipeline de logs habitual (Loki, Elasticsearch, CloudWatch).

## Trazado

La instrumentación de OpenTelemetry **no** está cableada en este release. Los spans para el manejo de peticiones de la API, la ejecución de nodos de LangGraph y las llamadas al LLM se rastrean como una funcionalidad planificada; hoy la única superficie de "por qué este caso tardó 90 segundos" son los logs estructurados + los histogramas de Prometheus de arriba.

## Ejemplos de alertas

Fragmentos de PromQL para alertas comunes:

### Tenant degradado por demasiado tiempo

```promql
soctalk_tenant_adapter_heartbeat_age_seconds > 1800
```

Alerta: el tenant ha estado en silencio por más de 30 min. Avisa al on-call.

### Pico de errores de la API

```promql
sum by (path_template) (
  rate(soctalk_api_request_duration_seconds_count{status=~"5.."}[5m])
) > 0.5
```

### Consumo del presupuesto de LLM

```promql
sum by (tenant_id) (
  rate(soctalk_tenant_llm_tokens_total[1h])
) > 5000000
```

Ajusta el umbral a la tasa normal esperada de tu instalación. Un pico normalmente significa que un modelo está en bucle sobre `needs_more_info`.

## Lo que no está aquí

- **Trazas distribuidas de decisiones HIL** — los humanos no están en las trazas de OTel; el log de auditoría es la fuente de verdad de quién decidió qué.
- **SLOs de extremo a extremo por cliente** — Analítica hace esto en la UI; el PromQL para ellos está en el roadmap como dashboards canónicos (hoy son definidos por la instalación).
- **Monitoreo sintético** — fuera del alcance de SocTalk en sí. Usa tu servicio de sondas externas habitual contra la URL del SOC del cliente.
