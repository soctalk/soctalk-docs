# Observabilidade

Métricas e logs para um MSSP executando o SocTalk. Dois consumidores em mente: dashboards de planejamento de capacidade e dashboards de custo por tenant.

## Endpoint Prometheus

`GET /metrics` no Service `soctalk-system-api` expõe as métricas da instalação no formato de exposição do Prometheus. Não autenticado por design, restrinja-o via NetworkPolicy ou via um Ingress com `auth-basic`/lista de IPs permitidos se você não quiser que ele seja legível por todos.

## Status de instrumentação na V1

O catálogo de métricas abaixo descreve a superfície de métricas **definida** (em `src/soctalk/core/observability/metrics.py`). Na V1, apenas `soctalk_tenant_adapter_heartbeat_age_seconds` é visivelmente atualizada pelo código (no handler de heartbeat do adaptador). As outras métricas estão definidas, mas **ainda não instrumentadas nos pontos de chamada**: elas serão exportadas como zero/vazias. Trate a tabela como o alvo de design até que os hooks de runtime cheguem.

## Contadores por tenant (superfície definida)

Todos rotulados com `tenant_id`. A cardinalidade é limitada pelo número de tenants na instalação.

| Métrica | Tipo | Significado | Instrumentada na V1? |
|---|---|---|---|
| `soctalk_tenant_events_ingested_total` | counter | Alertas recebidos do adaptador Wazuh do tenant | ainda não |
| `soctalk_tenant_investigations_opened_total` | counter | Investigações abertas | ainda não |
| `soctalk_tenant_investigations_closed_total{disposition}` | counter | Fechadas por disposição | ainda não |
| `soctalk_tenant_pending_reviews` | gauge | Revisões aguardando um gate humano | ainda não |
| `soctalk_tenant_llm_tokens_total{direction}` | counter | Tokens de LLM de entrada/saída, o driver de custo | ainda não |
| `soctalk_tenant_adapter_heartbeat_age_seconds` | gauge | Segundos desde o último heartbeat do adaptador | **sim** (atualizada por `/api/internal/adapter/heartbeat`). **A transição de degradação automática não está implementada**; use isto como sua própria entrada de alerta |

## Contadores no nível da instalação (superfície definida)

| Métrica | Tipo | Significado | Instrumentada na V1? |
|---|---|---|---|
| `soctalk_install_tenants_total{state}` | gauge | Contagem de tenants por estado | ainda não |
| `soctalk_api_request_duration_seconds{method,path_template,status}` | histogram | Latência da API por caminho de template | ainda não |
| `soctalk_helm_op_duration_seconds{op,outcome}` | histogram | Durações das operações Helm | ainda não |

`path_template` seria o template de rota do FastAPI (por exemplo, `/api/mssp/tenants/{id}`), de modo que a cardinalidade permaneça limitada.

## Dashboards Grafana sugeridos

### Saúde do control plane do MSSP

- Prontidão de pods (estilo Wazuh: tiles verde/amarelo/vermelho por Deployment)
- `soctalk_api_request_duration_seconds` p50/p95/p99 por `path_template`
- `soctalk_install_tenants_total` empilhado por estado, saúde da frota em relance
- Heatmap de `soctalk_tenant_adapter_heartbeat_age_seconds` por tenant, identifique um cliente em degradação antes que ele ligue

### Custo por tenant

- `rate(soctalk_tenant_llm_tokens_total[1h])` empilhado por tenant, quem mais gasta nesta hora
- Total diário de tokens × o $/Mtok do seu provedor = projeção de custo
- Burn-down em relação ao orçamento de tokens por execução (`case_runs.tokens_budget`, padrão do modelo 200.000; o fallback da variável de ambiente `SOCTALK_CASE_RUN_TOKEN_BUDGET`, padrão 15.000, só se aplica quando a linha não tem valor), com que frequência uma única execução estoura o orçamento?

### Nível de serviço

- `rate(soctalk_tenant_investigations_opened_total[5m])`: taxa de entrada
- `rate(soctalk_tenant_investigations_closed_total{disposition="escalate"}[1h])`: taxa de escalonamento (isto também está na página [Analytics](/pt-br/mssp-ui#analytics))
- `soctalk_tenant_pending_reviews`: humanos atrás / à frente da fila

## Logs

JSON para stderr por padrão, via `structlog`. A API e o orquestrador são configuráveis via:

| Variável de ambiente | Padrão | Efeito |
|---|---|---|
| `SOCTALK_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SOCTALK_LOG_FILE` | não definida | Se definida, espelha o stderr para arquivo |
| `SOCTALK_LOG_FORMAT` | `json` | `json` ou `console` (legível por humanos para dev) |

Cada linha de log inclui `tenant_id` e `case_id` quando aplicável, de modo que o stderr de um único pod do SocTalk é separável por tenant a jusante.

Os pods worker (runs-worker por tenant) emitem o mesmo formato. Agregue-os no seu pipeline de logs habitual (Loki, Elasticsearch, CloudWatch).

## Tracing

A instrumentação OpenTelemetry **não** está conectada nesta release. Spans para o tratamento de requisições da API, execução de nós do LangGraph e chamadas de LLM estão previstos como um recurso planejado; hoje, a única superfície para "por que este caso levou 90 segundos" são os logs estruturados + os histogramas do Prometheus acima.

## Exemplos de alerta

Trechos de PromQL para alertas comuns:

### Tenant degradado por tempo demais

```promql
soctalk_tenant_adapter_heartbeat_age_seconds > 1800
```

Alerta: o tenant está em silêncio há mais de 30 min. Acione o on-call.

### Pico de erros da API

```promql
sum by (path_template) (
  rate(soctalk_api_request_duration_seconds_count{status=~"5.."}[5m])
) > 0.5
```

### Consumo do orçamento de LLM

```promql
sum by (tenant_id) (
  rate(soctalk_tenant_llm_tokens_total[1h])
) > 5000000
```

Ajuste o limiar para a taxa normal esperada da sua instalação. Um pico geralmente significa que um modelo está em loop em `needs_more_info`.

## O que não está aqui

- **Traces distribuídos de decisões HIL**: humanos não aparecem em traces do OTel; o log de auditoria é a fonte da verdade sobre quem decidiu o quê.
- **SLOs ponta a ponta por cliente**: o Analytics faz isso na UI; o PromQL para eles está no roadmap como dashboards canônicos (hoje eles são definidos por instalação).
- **Monitoramento sintético**: fora do escopo do SocTalk em si. Use seu serviço de sondagem externo habitual contra a URL do SOC do cliente.
