# 人工审查（HIL）

MSSP 分析师如何处理等待人工关卡的 AI 提议动作。

代码库中存在两种后端：**仪表盘队列**（始终启用）与 **Slack 双向**（可选启用）。在本次发布中，仪表盘后端是唯一接入 V1 chart 运行时的后端；Slack 双向后端在代码中已存在，但尚未由 V1 安装路径激活。

关于模型侧——即 AI 移交给人工审查的时机——请参阅 [AI 流水线 → 人工审查关卡](/zh-cn/ai-pipeline#human-review-gate)。

## 决策状态

无论采用哪种后端，每次审查都遵循相同的三决策契约：

| 决策 | 本次发布中的效果 |
|---|---|
| `approve` | 审查的待处理行被标记为已完成，`feedback` 文本被追加到审计轨迹中。approve 不会自动恢复或关闭案件——这在今天属于分析师侧的后续操作。 |
| `reject` | 案件被作为误报关闭（`auto_closed_fp`）。属于终态——不会用人工的 `feedback` 重新调用图。 |
| `more_info` | 审查行被更新为 `info_requested`，并附带问题列表。图**不会**被自动重新调用；由分析师手动重新接手该案件。 |

决策会写入仅追加的审计行，并标注人工的身份、时间戳和自由文本理由。提交后永不可编辑。

## 仪表盘后端

位于 `/review` 的[审查队列](/zh-cn/mssp-ui#reviews-human-in-the-loop)展示所有租户中每一条待处理的审查。卡片显示：

- 调查标题 + 租户
- AI 裁决标签（`AI: Escalate / Close / Needs More Info`）
- 严重性
- 告警数量 + 截止时间（若配置了 SLA）

点击 **Review** 会打开调查详情，并滚动到提议面板。该面板显示：

- AI 的理由（完整 markdown）
- 可观察证据（IP、哈希、用户），并附带来自 Cortex / MISP 的信誉/富化信息
- 三个按钮：**Approve**、**Reject**、**Needs more info**
- 一个理由文本框（Reject / Needs more info 时必填）

提交会更新数据库中的待处理审查行（`approve` / `reject` / `more_info`，加上操作员的 `feedback` 或 `questions`）。**V1 中没有提议 outbox**——早期草案曾描述过一个以幂等键为键、由下游执行器（TheHive 案件创建、Slack 通知）消费的 outbox，但该流水线在本次发布中并未实现。审查者的决策止步于审查行 + 审计日志；任何下游效果（例如 TheHive 案件创建）仅在 AI worker 于图运行过程中内联创建时才会发生。

## Slack 双向后端

Slack 使用 Socket Mode，因此 SocTalk 不需要公开的 webhook 端点——SocTalk 安装会主动向 Slack 发起出站 WebSocket 连接。

### 前提条件

- 你工作区中一个启用了 Socket Mode 的 Slack 应用
- 一个具备 `connections:write` 的应用级 token
- 一个具备 `chat:write`、`chat:write.public`、`channels:read` 的 bot token
- 一个已邀请该 bot 加入的频道

### 配置 SocTalk

在 MSSP UI → Settings → Slack 中：

- **Enable Slack** → 开启
- **Bot token** → `xoxb-…`
- **App token** → `xapp-…`
- **Channel** → `#soc-reviews`（或任意频道）
- **Notify on escalation** → 开启（发送每一次升级裁决）
- **Notify on verdict** → 可选（同时发送关闭裁决；量较大）

在 V1 中，所有 Slack 配置（token、频道、通知开关）仅通过环境变量设置——旧版 `PUT /api/settings` 路由未被 V1 chart 挂载。关于环境变量注入模式，请参阅 [Slack — 配置](/zh-cn/integrate/slack#configure)。

### 操作员体验

当 AI 请求人工审查时，SocTalk 会向配置的频道发布一张卡片：

```text
[Critical] T1110 brute-force technique simulated on linux-ep-1 (Demo Tenant)
AI verdict: Escalate (confidence: medium)
Observables: 198.51.100.7 (Cortex: malicious, 8/12), sshd, alice@linux-ep-1
[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

按钮通过 Socket Mode 回传；SocTalk 安装会以提议的幂等键为键记录该决策。仪表盘队列中的同一提议会实时更新——在 Slack 中批准会关闭仪表盘卡片。

如果分析师点击 **Reject** 或 **Needs more info**，会弹出一个用于填写理由的 Slack 对话框（必填）。

**View in UI →** 链接会深度链接到调查详情，并预先滚动到提议面板。

### 多租户路由

在本次发布中，所有审查都发往在 Settings → Slack 中配置的那个全安装级频道。按租户的 Slack 频道路由**尚未**实现；onboard 载荷上的 `slack_channel_override` 字段曾在早期文档中被提及，但运行时会忽略它。按租户路由已列入路线图。

### 出站（单向）通知

在未来的发布中，同一套 Slack 凭据将驱动单向 webhook 通知（案件关闭、裁决决策）。webhook 通知器代码位于 `src/soctalk/notifications/slack_webhook.py`，但仅在旧版入口点中接入；V1 chart 的 `app_v1` 不会调用它。任何发布中都不存在 `notify_on_capacity` 开关。

## 结果核算

审查决策会写入一条审计行。`soctalk_tenant_pending_reviews` 指标在可观测性代码中**已定义**，但在 V1 中**并未被主动更新**——它始终保持为 0。跟踪真实的审查队列深度已列入路线图。计划中的 `human_review_decisions_total` 计数器（按分析师）同样尚未接入埋点。

## 绕过：仅 AI 模式

一种无人工关卡的"对每次升级都自动批准"模式在本次发布中**尚未**实现。裁决节点始终将 `escalate` 路由经过 `human_review`。移除人工关卡已列入路线图，将作为一个仅限 `platform_admin` 的显式开关，并对其理由进行审计——而非作为一个悄无声息的默认行为。

## 源码指引

| 概念 | 文件 |
|---|---|
| HIL 后端接口 | [`src/soctalk/hil/backends/__init__.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Slack 双向后端 | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| 仪表盘后端 | [`src/soctalk/hil/backends/dashboard.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Slack 单向 webhook | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| 提议状态枚举 | [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) |
