# 可观测性

面向运行 SocTalk 的 MSSP 的指标与日志。设计时考虑了两类消费者：容量规划仪表盘和按租户的成本仪表盘。

## Prometheus 端点

`soctalk-system-api` Service 上的 `GET /metrics` 以 Prometheus exposition 格式暴露本次安装的指标。按设计不做身份验证——如果你不希望它对全网可读，请通过 NetworkPolicy 或带 `auth-basic`/IP 允许列表的 Ingress 对其加以约束。

## V1 埋点状态

下方的指标目录描述的是**已定义**的指标面（位于 `src/soctalk/core/observability/metrics.py`）。在 V1 中，只有 `soctalk_tenant_adapter_heartbeat_age_seconds` 会被代码实际更新（在适配器心跳处理器中）。其他指标虽已定义，但**尚未在调用点埋点**——它们会导出为零值/空值。请把该表当作设计目标，直到运行时钩子落地为止。

## 按租户计数器（已定义面）

全部带 `tenant_id` 标签。基数受本次安装中的租户数量约束。

| 指标 | 类型 | 含义 | V1 是否已埋点？ |
|---|---|---|---|
| `soctalk_tenant_events_ingested_total` | counter | 从该租户的 Wazuh 适配器收到的告警 | 尚未 |
| `soctalk_tenant_investigations_opened_total` | counter | 已开启的调查 | 尚未 |
| `soctalk_tenant_investigations_closed_total{disposition}` | counter | 按处置结果关闭的调查 | 尚未 |
| `soctalk_tenant_pending_reviews` | gauge | 等待人工闸口的审查 | 尚未 |
| `soctalk_tenant_llm_tokens_total{direction}` | counter | LLM 输入/输出 token——成本驱动因素 | 尚未 |
| `soctalk_tenant_adapter_heartbeat_age_seconds` | gauge | 距适配器上次心跳的秒数 | **是**（由 `/api/internal/adapter/heartbeat` 更新）。**尚未实现自动降级转换**；请把它作为你自己的告警输入 |

## 安装级计数器（已定义面）

| 指标 | 类型 | 含义 | V1 是否已埋点？ |
|---|---|---|---|
| `soctalk_install_tenants_total{state}` | gauge | 按状态统计的租户数 | 尚未 |
| `soctalk_api_request_duration_seconds{method,path_template,status}` | histogram | 按模板路径统计的 API 延迟 | 尚未 |
| `soctalk_helm_op_duration_seconds{op,outcome}` | histogram | Helm 操作耗时 | 尚未 |

`path_template` 会是 FastAPI 的路由模板（例如 `/api/mssp/tenants/{id}`），因此基数保持受约束。

## 推荐的 Grafana 仪表盘

### MSSP 控制平面健康

- Pod 就绪状态（Wazuh 风格：每个 Deployment 一个绿/黄/红色块）
- 按 `path_template` 划分的 `soctalk_api_request_duration_seconds` p50/p95/p99
- 按状态堆叠的 `soctalk_install_tenants_total`——一眼看清整个机队健康状况
- 按租户的 `soctalk_tenant_adapter_heartbeat_age_seconds` 热力图——在客户来电前就发现正在劣化的客户

### 按租户成本

- 按租户堆叠的 `rate(soctalk_tenant_llm_tokens_total[1h])`——本小时消耗最多的租户
- 每日总 token 数 × 你的提供商的 $/Mtok = 成本预测
- 对照每次运行的 token 预算做燃尽（`case_runs.tokens_budget`，模型默认 200,000；`SOCTALK_CASE_RUN_TOKEN_BUDGET` 环境变量回退默认值 15,000 仅在该行没有值时生效）——单次运行有多频繁地超出预算？

### 服务级

- `rate(soctalk_tenant_investigations_opened_total[5m])`——入口速率
- `rate(soctalk_tenant_investigations_closed_total{disposition="escalate"}[1h])`——升级速率（这一项也出现在[分析](/zh-cn/mssp-ui#analytics)页面上）
- `soctalk_tenant_pending_reviews`——人工处理落后于/领先于队列的程度

## 日志

默认通过 `structlog` 以 JSON 格式输出到 stderr。API 和编排器可通过以下方式配置：

| 环境变量 | 默认值 | 效果 |
|---|---|---|
| `SOCTALK_LOG_LEVEL` | `INFO` | `DEBUG`、`INFO`、`WARNING`、`ERROR` |
| `SOCTALK_LOG_FILE` | 未设置 | 若设置，则把 stderr 镜像到文件 |
| `SOCTALK_LOG_FORMAT` | `json` | `json` 或 `console`（供开发使用的人类可读格式） |

每一条日志行都包含 `tenant_id`，如适用还包含 `case_id`，因此单个 SocTalk pod 的 stderr 在下游可按租户拆分。

Worker pod（按租户的 runs-worker）发出相同的结构。在你常用的日志管道（Loki、Elasticsearch、CloudWatch）中对其做聚合。

## 链路追踪

本次发布**未**接入 OpenTelemetry 埋点。针对 API 请求处理、LangGraph 节点执行和 LLM 调用的 span 是一项计划中的功能；如今回答“这个案件为什么花了 90 秒”的唯一途径是结构化日志加上上述 Prometheus 直方图。

## 告警示例

常见告警的 PromQL 片段：

### 租户降级过久

```promql
soctalk_tenant_adapter_heartbeat_age_seconds > 1800
```

告警：租户已静默超过 30 分钟。呼叫值班人员。

### API 错误激增

```promql
sum by (path_template) (
  rate(soctalk_api_request_duration_seconds_count{status=~"5.."}[5m])
) > 0.5
```

### LLM 预算烧穿

```promql
sum by (tenant_id) (
  rate(soctalk_tenant_llm_tokens_total[1h])
) > 5000000
```

请把阈值调整为你的安装的预期正常速率。激增通常意味着某个模型在 `needs_more_info` 上打转。

## 这里不包含的内容

- **HIL 决策的分布式追踪**——人类不在 OTel 追踪中；关于谁决定了什么，审计日志才是唯一可信来源。
- **按客户的端到端 SLO**——分析在 UI 中做了这件事；面向它们的 PromQL 作为规范化仪表盘列在路线图上（如今这些是由各安装自行定义的）。
- **合成监控**——不在 SocTalk 自身的范围内。请对客户 SOC URL 使用你常用的外部探测服务。
