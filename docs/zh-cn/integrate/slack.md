# Slack

SocTalk 通过两种方式与 Slack 通信。两者使用相同的 Slack 应用凭据，但覆盖不同的运维需求：

| 后端 | 方向 | V1 chart 接线 |
|---|---|---|
| **Webhook 通知** | 单向（发出） | 代码仅在旧版入口点（`src/soctalk/main.py`）中接线。V1 chart 的 `app_v1` **不会**挂载它。请将下文的通知视为计划中的接线；目前发送消息需要在 V1 之外同时运行旧版编排器 |
| **Socket Mode HIL** | 双向 | 代码已存在（`src/soctalk/hil/backends/slack.py`）；同样未接入 V1 |

V1 安装路径中唯一可用的 HIL 界面是仪表盘审查队列。下文的 Slack 页面描述的是两个后端在 V1 中都发布后的计划接线。有关分析师侧的审查工作流，请参阅 [人工审查（HIL）](/zh-cn/human-review)。

## 创建 Slack 应用

1. https://api.slack.com/apps → **Create New App** → From scratch。
2. 名称：`SocTalk`（或你的安装名称）。工作区：你的 SOC 团队使用的那个。
3. **OAuth & Permissions** → 添加 Bot Token Scopes：
   - `chat:write`
   - `chat:write.public`（允许机器人在其非成员的频道中发送消息）
   - `channels:read`
   - 对于交互式审查：`commands`（仅当你还需要斜杠命令时）和 `app_mentions:read`。
4. **Install App** → Install to Workspace。复制 **Bot User OAuth Token**（`xoxb-…`）。
5. （仅限 HIL）**Socket Mode** → 启用。生成一个具有 `connections:write` scope 的 **App-Level Token**（`xapp-…`）。
6. （仅限 HIL）**Interactivity & Shortcuts** → 启用。启用 Socket Mode 后，你无需输入 Request URL。
7. （仅限 HIL）**Event Subscriptions** → 启用；订阅 `interactive_message_actions` 和 `block_actions`。
8. 将机器人邀请到你的审查频道：`/invite @SocTalk`。

## Webhook 通知

对于单向通知，你只需要一个 Incoming Webhook URL，而不需要上面完整的应用配置流程。可以任选其一：

- 在工作区中安装一个独立的 **Incoming Webhooks** 应用并获取 URL。
- 或使用你上面创建的应用的 Incoming Webhooks 功能。

### 配置

MSSP UI → Settings → Slack：

| 字段 | 说明 |
|---|---|
| Webhook URL | `https://hooks.slack.com/services/T…/B…/…` |
| Channel | 可选的频道覆盖；否则 webhook 发送到其默认频道 |
| Notify on escalation | 默认开启。当裁决以 `escalate` 关闭时发送消息 |
| Notify on verdict | 默认关闭。同时对每个 `close` 处置发送消息——消息量很大 |

**在 V1 中没有用于修改 Slack 集成设置的 API**——V1 chart 不会挂载旧版的 `PUT /api/settings` 路由。Slack 配置仅通过环境变量进行：在 `soctalk-system-api` Deployment 上以环境变量形式提供 `SLACK_WEBHOOK_URL`、`SLACK_CHANNEL`、`SLACK_NOTIFY_ON_ESCALATION` 和 `SLACK_NOTIFY_ON_VERDICT`。

Slack 通知仅覆盖升级和裁决事件（不存在 `notify_on_capacity` 开关）。

令牌（webhook URL、bot token、app token）**无法**通过此端点写入——请将它们作为环境变量在编排器 Deployment 上提供（`SLACK_WEBHOOK_URL`、`SLACK_BOT_TOKEN`、`SLACK_APP_TOKEN`），或通过 Secret 挂载的环境变量提供。轮换时请修补该 Secret 并滚动重启编排器。

### 消息格式

升级示例：

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1
AI verdict: Escalate · confidence: medium · 1 malicious observable
View → https://mssp.your-mssp.example/investigations/abc123
```

极简的 Block Kit；无按钮（那些是 HIL 后端的职责）。

## Socket Mode HIL

> **状态：** Slack 双向 HIL 后端在代码中已存在（`src/soctalk/hil/backends/slack.py`），但在本次发布中**未接入 V1 chart 的运行时**。位于 `/review` 的仪表盘审查队列是唯一可用的 HIL 界面。请将下文的 Slack HIL 设置视为计划中的设计。

用于分析师审查工作流。使用同一个 Slack 应用，外加 App-Level Token。SocTalk 的 HIL 后端会向 Slack 打开一个出站 WebSocket——无需公开端点；可在 NAT 后工作。

### 配置

UI 开关（Channel、Enable HIL、notify_on_*）位于 MSSP UI → Settings → Slack。令牌本身在本次发布中仅通过环境变量提供：

```yaml
env:
  - name: SLACK_BOT_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: bot_token } }
  - name: SLACK_APP_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: app_token } }
```

按租户的 Slack 频道路由在本次发布中**尚未实现**——无论案例属于哪个租户，配置的安装范围 `slack_channel` 都会接收每一条审查和通知。按租户路由已在路线图中。

### 发送的内容

当 AI 请求人工审查时，SocTalk 会向配置的频道发送一张卡片：

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1

AI verdict: Escalate (confidence: medium)
Observables:
  · 198.51.100.7 (Cortex: malicious, 8/12 analyzers)
  · sshd (process)
  · alice@linux-ep-1 (user)

[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

按钮会触发 `block_actions` 事件；SocTalk HIL 后端处理这些事件并将决定写回案例状态。Reject 和 Needs-more-info 会打开一个模态框以填写理由（必填）。

未来的发布会将仪表盘和 Slack 接线以共享审查状态。在 V1 中，这两个后端尚未共享状态——如果启用了 Slack HIL，Slack 操作不会关闭仪表盘卡片，反之亦然。

## 轮换令牌

1. 在 Slack 应用的 OAuth & Permissions 中，**Reinstall app** 以轮换 bot token。复制新的 `xoxb-…`。
2. （HIL）**Basic Information → App-Level Tokens** → 撤销 + 重新生成。复制新的 `xapp-…`。
3. 修补该 Secret：
   ```bash
   kubectl -n soctalk-system patch secret soctalk-slack-creds \
     -p '{"data":{"bot_token":"'$(echo -n xoxb-NEW | base64)'","app_token":"'$(echo -n xapp-NEW | base64)'"}}'
   ```
4. 滚动重启编排器：`kubectl -n soctalk-system rollout restart deploy/soctalk-system-api`。
5. HIL 后端会在 pod 就绪后约 10 秒内使用新令牌重新连接。

## 故障排查

| 症状 | 检查 |
|---|---|
| 机器人不发送消息 | `kubectl -n soctalk-system logs deploy/soctalk-system-api | grep slack`。常见原因：机器人未被邀请到目标频道 |
| HIL 按钮返回 "this action is no longer valid" | 该提案已由另一路径（仪表盘或已过期）决定。刷新卡片 |
| 机器人能发送消息但从不响应按钮点击 | Socket Mode 未启用，或 App-Level Token 缺少 `connections:write`。重新创建 app token |
| 卡片到达时被截断 | Block Kit 将单条消息限制为 50 个 block。SocTalk 会将较长的可观测项列表分批放入多张卡片；你应能看到一个 "X observables shown of Y" 页脚 |

## 隐私

Slack 消息中包含可观测项（IP、用户名、文件哈希）。如果你的工作区有合规约束，请基于按租户设置对该集成进行门控，或仅使用 webhook 通知（其中不含可观测项主体）。

## 源码指引

| 概念 | 文件 |
|---|---|
| Slack webhook 通知器 | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Slack HIL 后端 | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Block Kit 模板 | [`src/soctalk/notifications/slack_templates/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/notifications) |
