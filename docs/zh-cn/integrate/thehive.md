# TheHive

[TheHive](https://thehive-project.org/) 为可选启用。按租户配置后，SocTalk 会将 `escalate` 处置结果的关闭项导出为 TheHive case。调查历史（观测对象、AI 推理依据、人工审查决策）将成为该 case 的首个观测对象集合与时间线。

有关心智模型，请参见 [AI 流水线 → 关闭](/zh-cn/ai-pipeline)。有关停用已启用 TheHive 的租户，请参见 [租户生命周期 → 停用](/zh-cn/tenant-lifecycle#decommission-vs-purge)。

## 托管模式

在 V1 中，`soctalk-tenant` chart 不包含 TheHive 子 chart（`dependencies: []`）。可选方案为：

- **客户自管 TheHive** —— 客户在别处运行自己的 TheHive；MSSP 提供 URL 与按租户的 API 密钥。
- **不使用 TheHive** —— 升级项仅保留在 SocTalk UI 中。此为默认。

“内置 TheHive 子 chart”路径在本页早期草稿中曾作为计划选项被描述，但**在本版本中并未实现**。不存在由 SocTalk 管理的 Cassandra StatefulSet 或面向租户的 TheHive Deployment。

## 配置（MSSP UI）

租户详情 → 设置 → TheHive。字段：

| 字段 | 说明 |
|---|---|
| Enable | 默认关闭 |
| URL | 客户自管为 `https://thehive.<customer>.example`；内置为 `http://thehive.tenant-<slug>.svc:9000` |
| Organisation | TheHive organisation slug（多租户 TheHive 实例） |
| API key | 客户的 TheHive API 密钥，具备 `case:create`、`observable:create`、`task:create` 权限 |
| Verify TLS | 默认开启；对自签名的开发环境 TheHive 可关闭 |

**在 V1 中没有用于修改 TheHive 集成设置的 API。** TheHive 调用位于**按租户的 runs-worker**（其持有 MCP 绑定）中，而非中央 API pod 中，因此在 `soctalk-system-api` 上设置 `THEHIVE_*` 环境变量对该 worker 无效。要在 V1 中配置 TheHive，请在 `tenant-<slug>` 命名空间下租户的 `soctalk-runs-worker` Deployment 上设置这些环境变量（并通过对租户 chart 执行 `helm upgrade` 重新渲染，或先执行 `kubectl set env` 再执行 `rollout restart`）。一个清晰的、由 API 驱动的配置界面已列入路线图。

## 导出的内容

在 V1 中，TheHive 导出通过 `thehive_worker` 节点经由 MCP 调用 TheHive 的 API，在**图节点执行时同步发生**。目前这会创建 case（标题 + 严重程度镜像自 SocTalk 裁决）与观测对象。更丰富的界面 —— 由 `next_actions` 派生的任务、worker 推理依据 / 人工审查决策的时间线镜像、**异步 outbox + 重试** —— 在早期草稿中被描述为设计目标，但**在本版本中并未实现**。如果 TheHive 不可达，worker 节点会记录该失败，case 会在 SocTalk 中继续处理而不产生导出的对应项。不存在重试循环、不存在 outbox、不存在持久化的“最近错误”字段，也不存在用于失败导出的仪表盘界面 —— 失败仅在编排器的结构化日志中可见。

观测对象类型映射（依据 V1 实现）：

| SocTalk 类型 | TheHive `dataType` |
|---|---|
| `ip` | `ip` |
| `fqdn` | `fqdn` |
| `url` | `url` |
| `hash_md5`, `hash_sha1`, `hash_sha256` | `hash` |
| `email` | `mail` |
| `filename` | `filename` |
| `user` | `other`（带 `tags: user`） |
| `process` | `other`（带 `tags: process`） |
| `registry_key` | `registry` |

## 内置 TheHive：不在本版本中

V1 中的 `soctalk-tenant` chart 不将 TheHive 作为子 chart 内置 —— `Chart.yaml` 中列出 `dependencies: []`。希望获得按租户 TheHive 实例的运维人员需自行运行它（在租户命名空间中手动执行 `helm install`，或在别处由客户自管）。带有 chart 管理的管理员密钥的内置子 chart 在早期草稿中被描述为设计目标，但仍在路线图中。

## 客户自管 TheHive：注意事项

- 客户的 TheHive 必须能从 SocTalk 控制平面访问（可出站至客户的 TheHive URL）。
- 客户使用上文列出的最小权限范围创建 API 密钥。SocTalk 不需要管理员权限范围。
- 如果客户的 TheHive 强制执行源 IP 允许列表，请将 SocTalk 控制平面出站 NAT IP 加入允许列表。

## 状态 / 健康

在本版本中，**没有针对 TheHive 的后台健康探测循环** —— SocTalk 仅在某次调查有内容需要导出时才会触及 TheHive。该调用期间的失败仅记录在编排器的结构化输出中；不存在持久化的错误字段，也不存在基于 outbox 的重试。MSSP UI 不会单独呈现“TheHive 可达”指示器。

要监控 TheHive 健康状况，请使用你惯用的外部探针（例如针对 TheHive 的 `/api/status` 的 Prometheus blackbox exporter 等）—— 这是 MSSP 侧的职责，在本版本中并非 SocTalk 的组成部分。

## 轮换 API 密钥

1. 在客户的 TheHive 中，使用相同的权限范围生成新的 API 密钥。
2. 修补持有 TheHive 凭据的租户命名空间 Secret，并滚动重启 runs-worker：`kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`。
3. 在 TheHive 中吊销旧密钥。

一条实时重载路径（监视已挂载的 Secret 文件）已在计划中。

## 源码指引

| 概念 | 文件 |
|---|---|
| TheHive worker / 导出 | [`src/soctalk/workers/thehive.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/thehive.py) |
| 设置 schema | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
| MCP 工具桥接 | [`src/soctalk/chat/mcp_tools.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/chat/mcp_tools.py) |
