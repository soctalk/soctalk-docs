# Cortex

[Cortex](https://thehive-project.org/) 通过其“分析器”（analyzer）插件提供可观测项分析（信誉查询、沙箱引爆、whois 等）。SocTalk 的 [`cortex_worker`](/zh-cn/ai-pipeline) 节点在富化阶段将可观测项发送给 Cortex 处理。

## 托管模式

V1 中的 `soctalk-tenant` chart 不包含 Cortex 子 chart（`dependencies: []`）。可选方案有：

- **客户自管 Cortex** —— 由客户自行运行；MSSP 提供 URL 和 API key。
- **不使用 Cortex** —— AI 流水线仍会尝试 `ENRICH` 路由（supervisor 并不知道 Cortex 缺失）；每次 `cortex_worker` 调用都会失败，且失败会被记录到日志。V1 中没有针对单个可观测项的状态字段；worker 会直接返回而不做富化，supervisor 继续往下执行。

早期草案中曾把“捆绑式 Cortex 子 chart”描述为一个规划中的选项，但它在**本版本中尚未实现**。

## 配置（MSSP UI）

租户详情 → Settings → Cortex。

| 字段 | 说明 |
|---|---|
| Enable | 默认关闭 |
| URL | 客户自管使用 `https://cortex.<customer>.example`；捆绑式使用 `http://cortex.tenant-<slug>.svc:9001` |
| API key | 客户具备 `analyze:any` 权限的 Cortex API key |
| Verify TLS | 默认开启 |
| Default TLP | 默认 `2`（Amber）。当 SocTalk 提交不携带 TLP 的可观测项时使用 |

**V1 中没有用于修改 Cortex 集成设置的 API。** Cortex 调用位于**按租户部署的 runs-worker** 中，而非中央 API pod，因此在 `soctalk-system-api` 上设置的环境变量不会生效。要在 V1 中配置 Cortex，请在 `tenant-<slug>` 命名空间内该租户的 `soctalk-runs-worker` Deployment 上设置环境变量（对租户 chart 执行 `helm upgrade`，或使用 `kubectl set env` + `rollout restart`）。轮换 API key 时，请修补租户命名空间的 Secret 并滚动重启 runs-worker。一套由 API 驱动的整洁配置界面已列入路线图。

## 分析器选择

对于每个可观测项，worker 会根据该可观测项的类型，尝试硬编码于 `ANALYZER_MAP`（位于 [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)）中的**第一个分析器名称**，而不会检查该分析器是否实际安装在 Cortex 实例上。如果该分析器未安装（或调用失败），失败会被记录到日志，worker 返回且不做该项富化。V1 中不存在回退到第二个分析器的机制；请为你所关心的每一种可观测项类型安装 `ANALYZER_MAP` 中指定的规范分析器。将分析器优先级顺序作为 chart 值暴露出来一事已列入路线图。

## 成本

Cortex 本身是免费的；但分析器提供方会对查询收费。SocTalk 不直接计量 Cortex 调用 —— 请在提供方一侧计量：

- VirusTotal：按 key 配额
- AbuseIPDB：按 key 配额
- Hybrid Analysis：按 key 配额

每个租户的可观测项吞吐量可通过 [Observability](/zh-cn/observability#per-tenant-counters-defined-surface) 中的 `soctalk_tenant_events_ingested_total` 查看（每个被摄入的事件会触发约 1–5 次可观测项提取）。

## Worker 行为

`cortex_worker` 节点包含一个硬编码的 `ANALYZER_MAP`（位于 [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)），它将每种可观测项类型映射到一个简短的分析器名称列表。对于每个可观测项，worker 会向该列表中的**第一个**分析器提交，而不检查其可用性；如果该分析器未安装或调用失败，该可观测项的富化将被记录为失败。

顺序如下：

1. 从状态中读取该 case 当前的可观测项列表。
2. 对于每个可观测项，根据其类型在 `ANALYZER_MAP` 中查找分析器列表。
3. 通过 Cortex 的 `/api/observable` 端点向第一个映射到的分析器提交。
4. 轮询 `/api/job/{id}/report`，直到作业完成或触发按作业设定的超时。
5. 将裁决（`safe`、`info`、`suspicious`、`malicious`）和报告正文追加到 case 状态。失败的作业会记录错误并继续。

失败的 Cortex 调用不会使整个运行失败 —— worker 会记录该失败并返回给 supervisor，该可观测项不做富化。裁决节点会基于当前可用的任何上下文进行推理。

## 捆绑式 Cortex：不在本版本中

`soctalk-tenant` chart 不会将 Cortex 作为子 chart 捆绑。如果你需要分析器富化，请自行运行 Cortex（客户自管）。由 SocTalk 托管的 Cortex 已列入路线图。

## 轮换 API key

1. 在 Cortex 中生成一个具备 `analyze:any` 权限的新 key。
2. 修补持有 Cortex 凭据的租户命名空间 Secret，并滚动重启 runs-worker：`kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`。
3. 在 Cortex 中吊销旧 key。

## 本页未涵盖的内容

- 自定义分析器开发 —— 超出范围；参见 [TheHive-Project/Cortex-Analyzers](https://github.com/TheHive-Project/Cortex-Analyzers)。
- 按可观测项的 TLP/PAP 覆盖 —— 规划中；目前租户默认值适用于每一次提交。

## 源码指引

| 概念 | 文件 |
|---|---|
| Worker 节点 + ANALYZER_MAP | [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py) |
| 设置 schema | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
