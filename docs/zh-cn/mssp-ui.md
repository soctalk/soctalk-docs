# MSSP UI 导览

MSSP 操作员登录后看到的界面。在阅读[日常运维](/zh-cn/operations)之前先通读本页一次，这样运维手册才更易理解。

## 作用域：MSSP 全局 vs 单个租户

每个 MSSP 用户都有两种操作作用域：

- **所有租户** —— 跨租户队列与聚合视图。这是 `mssp_admin` 的默认作用域。右上角会显示一个 **All tenants** 标签。
- **单个租户** —— MSSP 管理员已打开某个客户的 SOC（标签显示为 `Tenant: <name>`）。所有视图都限定在该租户；标签旁的 **Clear** 按钮可切回 MSSP 全局。

作用域也决定导航栏的内容。在 MSSP 全局作用域下，导航栏中会显示 Tenants；在租户作用域下则会隐藏，因为其位置被租户详情界面取代。

## 导航栏

左侧导航栏在每个页面上都常驻显示。自上而下为：

| Icon       | Page              | 显示内容 |
|------------|-------------------|---------------|
| SocTalk    | `/`               | 主页 / 仪表盘 |
| Dashboard  | `/`               | MSSP KPI 磁贴 + 调查吞吐量图表 |
| Tenants    | `/tenants`        | 所有客户 SOC（仅 MSSP 全局作用域） |
| Investigations | `/investigations` | 活动案件的跨租户队列 |
| Reviews    | `/review`         | 人工介入（human-in-the-loop）提案队列 |
| Chat       | `/chat`           | 与 SocTalk 智能体的操作员对话 |
| Analytics  | `/analytics`      | 跨租户的服务级趋势 |
| Audit Log  | `/audit`          | 仅追加的事件日志 |
| Settings   | `/settings`       | LLM 提供方、集成开关 |
| Live / Offline | —              | 实时连接指示器（WebSocket 健康状况） |

每个页面右上角是用户标签（`email`、`role`）和一个 **Log out** 按钮。

## 仪表盘

![MSSP dashboard](/screenshots/mssp-dashboard.png)

顶行的 KPI 磁贴（Open Investigations、Pending Reviews、Avg Time to Triage、Avg Time to Verdict）以及第二行的运营计数器（Created Today、Closed Today、Escalations、Auto-Closed、Malicious IOCs）。

磁贴下方：

- **Investigation Throughput (24h)** —— 展示已创建 / 手动关闭 / 自动关闭 / 已升级 / 积压的柱线组合图。
- **Verdicts Today** —— 当日 AI 裁决的实时累计。
- **Active Investigations** —— 进行中案件的简短列表，每一项都可深度链接进入。

该图表是容量规划中最受关注的组件；如果积压（红线）持续上升而吞吐量保持平稳，说明该 MSSP 资源不足，或者模型将过多案件转交给了人工审查。

## 租户（Tenants）

### 租户列表

![Tenants list](/screenshots/tenants-list.png)

每个客户占一行。列包括：Display Name、Slug、Profile（`poc` 或 `persistent`）、State（`pending | provisioning | active | degraded | suspended | decommissioning | archived | purged`）、Created、Actions。

**+ New Tenant** 按钮会打开入驻表单。Profile 在创建时即固定；日后切换需要先下线（decommission）再重建。

### 租户详情

![Tenant detail](/screenshots/tenant-detail.png)

三个部分：

1. **Identity** —— 租户 ID、profile、创建 / 状态变更时间戳。Slug 显示在标题栏内的 display name 下方。
2. **Actions** —— Suspend / Resume / Retry Provisioning / Decommission。**本版本中的 Suspend 会将租户状态翻转为 `suspended`**，使编排器停止为其调度新的调查；它**不会**对工作负载进行缩容。若需彻底切断，请遵循[日常运维 → 紧急停用](/zh-cn/operations#emergency-disable-a-tenant-immediately)。**Retry Provisioning** 仅对处于 `degraded` 状态的租户有效 —— API 会拒绝对处于 `pending` 状态的租户执行 `:retry`（`pending → provisioning` 在首次尝试时自动完成）。
3. **Lifecycle Events** —— 配置状态机的时间顺序日志：`preflight_ok → secrets_minted → namespace_ready → secrets_applied → helm_applied (soctalk-tenant chart) → helm_applied (Wazuh chart) → workloads_ready → integration_config_written → active`。两行 `helm_applied` 可通过事件负载（chart 标识）区分。当某个租户卡住时，此表会告诉你是哪一步失败了。

该页面在其他方面为只读；每个租户的 SOC（Wazuh、Cortex、TheHive）通过租户列表上的 **Open SOC** 操作在独立窗口中打开。

## 调查（Investigations）

### 列表

![Investigations list](/screenshots/investigations-list.png)

跨租户队列。过滤器：status（Pending / Active / Awaiting Enrichment / Awaiting Verdict / Awaiting Human / Escalated / Closed）和 phase（Triage / Enrichment / Analysis / Verdict / Escalation / Closed）。每一行显示 Tenant、Title、Status、Phase、Severity（Critical / High / Medium / Low）、告警数量、Malicious IOC 数量、Verdict、Created、Actions。

点击 **View**（或标题）打开详情页。

### 详情

![Investigation detail](/screenshots/investigation-detail.png)

布局：

- **Header** —— 标题、状态徽章（Active/Closed、当前 Phase、Severity）。
- **KPI tiles** —— Alerts、Observables（总数/恶意/可疑）、Time to Triage、Time to Verdict。
- **Details** —— ID、Created、Updated。
- **Event Timeline** —— 该案件的时间顺序事件收件箱（不可变，仅追加）。
- **Agent Run** —— 相对于配置的每次运行预算（`case_runs.tokens_budget`，模型默认 200,000）的 token 消耗，以及处置状态（`pending | active | failed | completed`）。
- **Observable Summary** —— 按 Malicious / Suspicious / Clean 细分的总计。

**Ask AI** 悬浮按钮会打开一个针对该案件上下文运作的侧边对话。

## 审查（人工介入，human-in-the-loop）

![Review queue](/screenshots/review-queue.png)

等待人工闸门的 AI 提案的跨租户队列。每一行显示提案标题、告警数量、截止时间、severity、AI 裁决标签（`AI: Escalate / Close / Needs More Info`），以及一个 **Review** 按钮。

审查会提交决定（`approve | reject | more_info`），从而更新数据库中待处理的审查行。在 V1 中**没有基于 outbox 的下游流水线**；决定止步于审查行 + 审计日志。任何 TheHive 案件创建或 Slack 通知都必须在 AI 图运行过程中内联发生。

代码中存在一个 Slack 双向 HIL 后端（`src/soctalk/hil/backends/slack.py`），但它**尚未接入 V1 chart 的运行时**。仪表盘队列是当前唯一可用的 HIL 界面。

## 聊天（Chat）

聊天页面会打开与 SocTalk 智能体的操作员对话。它具备作用域感知能力：在 MSSP 全局作用域下，你可以跨租户提问；在租户作用域下，对话则绑定到某个客户的数据。它适用于不值得保存为查询的临时问题（"给我看看本周针对租户 X 的暴力破解尝试"）。

## 分析（Analytics）

![Analytics](/screenshots/analytics.png)

趋势型的跨租户视图，按时间分桶（默认窗口 Window：30 天）。报表包括：

- **Alert Volume**
- **p95 TTV**（裁决用时，AI）
- **p95 TTR**（审查用时，人工闸门）
- **Escalation Rate**
- **Top worsening tenants** —— 按相对于上一窗口的 p95 TTV 增量排序
- **Activity heatmap** —— 星期几 × 每日小时，告警数（可切换到其他维度）

用它进行容量规划、模型版本评估和 SLA 审查。

## 审计日志

![Audit log](/screenshots/audit-log.png)

MSSP 全局的仅追加审计。按 Event Type（Review Requested / Review Completed / Tenant Onboarded / Decommissioned / Key Rotated / …）过滤。列包括：Timestamp、Event Type、Investigation（深度链接）、Version（事件溯源的行版本）、Data（可展开的 JSON 负载）。

对于合规导出，直接访问 API：

```bash
curl 'https://mssp.your-mssp.example/api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

## 设置（Settings）

![Settings](/screenshots/settings.png)

MSSP 全局设置页面。**在 V1 中此页面显示的是硬编码的占位值** —— `GET /api/settings` 返回一个静态只读负载，并不反映安装环境的实际配置。该页面仅供参考；它**不是**查看实时安装设置的窗口，**Save Changes** 按钮也是空操作。一个能反映从环境派生状态的真正设置界面已在路线图上。每租户 LLM 变更是 V1 中唯一真正生效的设置界面 —— 参见 [LLM 详情页](#llm-detail-page)。

各部分：

- **LLM** —— Provider（`openai-compatible | anthropic`）、Fast Model、Reasoning Model、Temperature、Max Tokens、可选的 Base URL + Organization。API 密钥保存在环境变量 / Kubernetes Secrets 中，绝不会保存在此表单里。
- **Wazuh SIEM** —— 启用开关、URL、凭据。
- **Cortex** —— 启用开关、URL、凭据。
- **TheHive** —— 启用开关、URL、organisation、凭据。
- **Slack** —— webhook + 交互式后端配置。

**Bring your own LLM key →** 链接会跳转到每租户 LLM 密钥轮换（每租户的 LLM 密钥会覆盖安装范围内的密钥）。

### LLM 详情页

![LLM settings detail](/screenshots/settings-llm.png)

可从 Settings → **Bring your own LLM key →** 进入的独立页面。在 V1 中，这**仅用于每租户 BYOK 密钥录入** —— 表单接收**当前作用域租户**的 API 密钥，并通过 `PUT /api/tenant/llm/api-key`（租户侧端点；MSSP 管理员也可使用 `PUT /api/mssp/tenants/{tenant_id}/llm/api-key`）提交。父级 Settings 页面上显示的其他 LLM 字段（provider、model、temperature）都是占位值；它们在此处同样不可编辑。轮换流程请参见[日常运维 → 轮换每租户 LLM 密钥](/zh-cn/operations#rotate-per-tenant-llm-key)。

## 另见

- [日常运维](/zh-cn/operations) —— 这些页面对应的运维手册部分（审查、调查、下线、轮换）。
- [Wazuh Ingress](/zh-cn/reference/wazuh-ingress) —— 从租户详情发起的 agent 入驻流程。
- [安全模型](/zh-cn/reference/security-model) —— 每个 MSSP 角色（`platform_admin`、`mssp_admin`、`analyst`、`customer_viewer`）被允许执行的操作。
