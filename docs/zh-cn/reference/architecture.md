# 架构

> **V1 部署说明。** 下方的实体列表命名对若干表使用了遗留的 "case_*" 前缀；实际的 V1 schema 名称为：`cases`、`investigation_runs`、`investigation_events`、`investigation_iocs`、`investigation_assets`、`investigation_links`、`investigation_outbox`、`proposals`。为向后兼容，`cases` 表名保持不变，但每个调查的子表都统一使用 `investigation_*` 前缀。其中，cases / investigation_runs / investigation_events 表由当前的编排器（orchestrator）使用；`proposals` 与 `investigation_outbox` 已存在于 schema 中，但消费它们的执行器（executor）一侧仍在路线图上。请将本页理解为架构意图；确切的 schema 请查阅 [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py)。

## 1. 核心实体

最小化的形态。完整的列清单存在于迁移文件中；此处仅列出承载关键作用的字段。

```
alerts               raw ingest from adapter; AI-triaged
cases                investigation unit; one run at a time
case_runs            a single AI execution span against a case
case_events          ordered event inbox per case (immutable)
proposals            AI-proposed actions awaiting human gate
execution_log        append-only audit of all meaningful actions
notes                markdown / evidence blocks
iocs                 typed artifacts; carry external_context
case_iocs, case_assets   bridge tables
case_links           related-case edges (shared IOC / asset / rule)
case_outbox          outbound work for executors and exports
```

每一行承载内容的记录都带有 `tenant_id`、`visibility` 和
`created_at`。RLS 按租户维度生效。

## 2. 可见性模型

分类（枚举）：

```
mssp_only         default; internal reasoning, raw tool output, hypotheses
customer_safe     approved for customer view
system            lifecycle and state-change events, always visible
tool_output       classified per-tool at registration time
```

规则：

1. `visibility` 是每一行用户可见记录上的一列（消息、笔记、
   proposals、tool_output 记录、时间线条目、事实面板字段）。
2. 插入时的默认值为 `mssp_only`。提升为 `customer_safe` 是一个
   显式操作。
3. 客户门户查询在 RLS 策略层过滤，而非在
   渲染层。客户查看者会话即使通过原始 SQL 也无法读取 `mssp_only` 行。
4. Proposals 具有字段级可见性：`{action, outcome}` 可以是
   `customer_safe`，而 `{rationale, blast_radius}` 保持 `mssp_only`。
   渲染为两个投影。
5. 每一次可见性提升都会产生一条带有执行者
   与理由的 `execution_log` 条目。

默认拒绝提升（Default-deny-promotion）：策略可以降低可见性，但在没有
经授权主体的显式操作前不得提升。

## 3. Run 生命周期

状态：

```
active           run consuming events and taking steps
waiting_on_gate  a proposal is pending; run does not mutate state
halted_budget    budget exceeded; requires analyst resume
paused           analyst-paused
completed        case closed
failed           unrecoverable error; requires analyst resume or restart
```

转换：

```
active → waiting_on_gate     on proposal created (status = proposed)
waiting_on_gate → active     on proposal approved/rejected (new event)
active → halted_budget       on budget exceeded
halted_budget → active       on analyst resume (grants new budget)
active → paused              on analyst pause
paused → active              on analyst resume
active → completed           on case close
* → failed                   on uncaught error, preserved for diagnosis
```

不变式：

- 每个 case 至多有一个处于 `active | waiting_on_gate |
  halted_budget | paused` 状态的 run。通过
  `case_runs(case_id) WHERE status IN (...)` 上的部分唯一索引强制执行。
- run 上的预算计数器：`tokens_used`、`dollars_used`、
  `tool_calls_used`、`wall_clock_ms`。在服务端强制执行；在 75% 时
  软告警，在 100% 时硬性停止。
- 处于 `waiting_on_gate` 的 run 不处理收件箱事件，除了
  闸门解析事件（proposal.approved / .rejected）。

## 4. 事件收件箱、排序、合并与幂等性

一个 case 的所有传入工作都落入 `case_events`：

```
event_id              uuid PK
case_id               FK
run_id                FK nullable
seq                   bigint, case-scoped monotonic (sequence)
kind                  enum (alert_ingested, tool_result,
                            proposal_approved, proposal_rejected,
                            analyst_message, analyst_correction,
                            budget_warning, external_signal, ...)
payload               jsonb
causation_event_id    uuid nullable (which event caused this one)
correlation_id        uuid (spans a causally-related fan-out)
idempotency_key       text unique per case
created_at            timestamptz
```

规则：

1. `seq` 在插入时由 case 作用域的序列发放。消费者严格
   按 `seq` 顺序读取。
2. `idempotency_key` 在每个 `case_id` 内唯一。重复插入会被
   静默丢弃（返回已存在的行）。
3. 合并：在插入前，匹配 `(case_id, kind,
   payload.signature, window)` 的事件会合并为单行。签名是
   随 kind 而定的（alert：IOC + 规则 + 资产的指纹；tool_result：
   tool_id + 参数哈希）。
4. `causation_event_id` 为重放（replay）链接因 → 果。
   `correlation_id` 将来自单个外部触发或分析师操作的事件分组。
5. 事件是不可变的。更新以后续事件的形式表达。

突发示例：5 分钟内 100 条相似的主机告警合并为一条
`alert_ingested` 事件，携带 `asset_ids: [...]` 列表。run
只处理它一次。

## 5. Proposal 生命周期与执行契约

状态：

```
draft        being composed by the AI
proposed     submitted to human gate
approved     human approved (with typed reason if required)
rejected     human rejected (reason required)
executing    outbox picked up; executor running
executed     action complete, result recorded
rolled_back  post-execution reversal (rare, analyst-initiated)
failed       executor error
```

幂等性：

```
proposal.idempotency_key = sha256(case_id || action_type ||
                                   canonical_json(params))
```

在活动窗口内（默认 15 分钟）的重复 proposals 会在插入时被
拒绝。保证 AI 即使在重跑（re-run）下也不会重复触发。

闸门行为：

- 在 `proposed` 时：run 转换为 `waiting_on_gate`。
- 在 `approved` 时：向 `case_outbox` 插入一行，带
  `kind = 'execute_proposal'`、`idempotency_key = proposal.idempotency_key`。
  向 `case_events` 发出 `proposal_approved`。run 恢复。
- 在 `rejected` 时：向 `case_events` 发出带理由的
  `proposal_rejected`。run 恢复。不产生 outbox 行。

执行：

- 独立的执行器（executor）worker 消费 `case_outbox` 并执行
  操作。
- 成功时：向 `case_events` 记录 `execute_proposal_result`，
  将 proposal 更新为 `executed`，写入 `execution_log` 条目。
- 失败时：记录错误，将 proposal 更新为 `failed`，写入
  `execution_log` 条目。run 可以提议重试。
- 通过 `idempotency_key` 实现恰好一次（exactly-once）：具有重复键的 outbox 行
  会被拒绝。执行器 worker 以租约（lease）领取行（例如，
  `FOR UPDATE SKIP LOCKED`）。

AI run 不会内联执行副作用。所有内容都
经由 outbox。

## 6. 执行日志 schema 与不变式

仅追加（Append-only），与会话分离：

```
log_id              uuid PK
case_id             FK
run_id              FK nullable
actor_kind          enum (ai, human, system, executor)
actor_id            text
kind                enum (tool_call, proposal_state_change,
                          approval, override, visibility_promotion,
                          correction_applied, policy_bound,
                          export_emitted, ...)
subject_type        enum (case, proposal, ioc, asset, note, ...)
subject_id          text
before              jsonb nullable
after               jsonb nullable
versions            jsonb (model_id, prompt_version, template_version,
                           policy_version at time of action)
ts                  timestamptz default now()
```

不变式：

1. 不允许应用角色执行 UPDATE 或 DELETE。仅允许 INSERT + SELECT。
   在 Postgres 角色授权层强制执行。
2. 每一次 proposal 状态变更、每一次工具调用、每一次批准、
   分析师对 AI 决策的每一次覆盖、每一次可见性变更、
   每一次纠正、每一次 outbox 分派都会写入一行。
3. `versions` 捕获产生该操作的技术栈。这是可复现性
   与事后校准（post-hoc calibration）所必需的。
4. 会话是事件子集的渲染视图；它不是
   审计。销毁或压实（compacting）会话不会销毁审计。

## 7. 事实面板权威性与纠正流程

结构化的 case 状态（假设、IOC、资产、时间线摘要、
置信度、活动指令）是 `case_events` 之上的 reducer 输出。
它绝不由会话直接变更。

规则：

1. 会话消息不写入结构化状态。
2. AI 对结构化状态的更新通过 AI 发出的事件进行
   （`hypothesis_updated`、`ioc_added`、`asset_linked`）。
3. 分析师在事实面板中的编辑会发出 `analyst_correction` 事件。
   reducer 应用它们。AI 将该纠正作为下一个
   收件箱事件消费，并从纠正后的状态重新推理。
4. 事实面板与 `case_events` 最终一致。系统维护一个
   物化投影（表或视图）；读取可以
   直接命中它。
5. 禁止对执行日志进行直接纠正；纠正
   以新事件加上一个指向被纠正事件的指针来表达。

## 8. 工具能力分类法

每个工具在注册时都带有一个能力类别、一个默认审批
策略和一个成本模型。

能力类别：

```
read_local               inspect SocTalk state only
read_external_silent     no target footprint (feeds, cached intel, vector)
read_external_attributed trace at target (SIEM query, EDR read)
write_sandbox            footprint without target mutation (detonation)
write_external           target state change (block, isolate, notify)
```

每个类别的默认审批策略：

```
read_local                → autonomous
read_external_silent      → autonomous
read_external_attributed  → analyst_approve
write_sandbox             → analyst_approve
write_external            → typed_reason
```

每个工具的成本模型：`{tokens_est, dollars_est, wall_ms_est, footprint}`。
run 预算跟踪其总和。

## 9. 策略优先级

策略按此顺序合并，靠后的覆盖靠前的：

```
1. install default       (shipped in chart, read-only in v1)
2. tenant override       (MSSP sets per customer)
3. case template         (phishing, ransomware, etc.)
4. case-local override   (set for this one case by analyst)
```

对每个策略键（工具审批、自动关闭、可见性提升、
响应模板、预算），有效值是定义它的最深作用域。

不变式：

1. 在 install 作用域下，可见性提升绝不会默认设置为
   `permissive`。默认是“需要显式提升”。
2. 租户策略不能覆盖 install 级别的硬性上限（例如，
   `max_tokens_per_case`）。
3. case 本地覆盖的作用域限定于该 case，不会延续到
   未来的 case。

## 10. 自动关闭 / 重开语义

针对高置信度误报的自动关闭：

```
Trigger:
  AI assessment = fp, confidence ≥ policy.auto_close_threshold
  AND policy.auto_close_enabled is true for the tenant
  AND no active directive prevents auto-close

Action:
  case.status = 'auto_closed_fp'
  case.reopen_window_until = now() + policy.reopen_window
  case.reopen_signature = {
    ioc_fingerprints: [...],
    asset_ids: [...],
    time_window: {start, end}
  }
  run transitions to completed
  execution_log row written
```

重开：

```
Trigger:
  new case_events row with kind ∈ {alert_ingested, external_signal}
  whose signature intersects a case's reopen_signature
  where case.status = 'auto_closed_fp'
    AND now() < case.reopen_window_until

Action:
  case.status = 'active'
  emit reopened event into case_events
  new run created
  execution_log row written
  conversation receives a system message noting the reopen
```

熔断开关（Kill switch）：
- 每个租户的 `IntegrationConfig.auto_close_enabled`（默认：开）。
- 每种 case 类型的 `CaseTemplate.auto_close_disabled`。

## 11. TheHive 导出契约（基于 outbox，单向）

当租户启用了 `thehive_export_enabled` 时，将 cases、IOC 和选定的笔记
向外镜像到 TheHive。绝不接受入站变更。

Outbox 行（在 `case_outbox` 中）：

```
id                  uuid PK
kind                'export.thehive.case' | 'export.thehive.ioc' | ...
external_system     'thehive'
external_ref        TheHive object id (filled on first successful mirror)
object_type         case | ioc | note
object_id           internal subject id
idempotency_key     sha256(object_type || object_id || state_hash)
payload             jsonb
export_status       pending | in_flight | succeeded | failed | skipped
attempts            int
last_error          text nullable
next_attempt_at     timestamptz
created_at, updated_at
```

规则：

1. 被镜像对象上的状态变更会入队一行带有
   全新 `idempotency_key` 的导出行（其中纳入了状态哈希）。
2. Worker 以 `FOR UPDATE SKIP LOCKED` 领取。成功时，记录
   `external_ref`（按需在 TheHive 一侧创建或更新）并
   写入 execution_log。
3. 来自 TheHive 的入站 webhook 仅对只读
   仪表盘 case 接受（非 v1）。任何接受入站状态的尝试都会被
   显式拒绝并记录。
4. 无对账循环（reconciliation loop）——TheHive 是下游镜像，真相之源
   是 SocTalk。
5. 失败的导出以指数退避重试直至上限；永久性
   失败会在集成健康面板上显现。

## 12. 强制测试与不变式

测试套件（单元 + 集成）必须覆盖：

1. **执行日志不可变性。** 从应用角色对 `execution_log`
   执行 UPDATE 和 DELETE 会在 Postgres 层失败。
2. **每个 case 单个活动 run。** 并发尝试创建
   第二个活动 run 会因唯一约束违反而失败。
3. **Proposal 幂等性。** 在窗口内提交两个具有相同
   幂等键的 proposals：第二个会被拒绝。
4. **闸门暂停行为。** 带有 `proposed` proposal 的 run 不会
   从其收件箱消费非闸门事件。
5. **Outbox 恰好一次。** 两个 worker 领取同一个 outbox 行
   会导致一个成功、一个空操作（no-op）。
6. **可见性强制。** 客户查看者会话即使使用原始 SQL，也无法从任何表
   select `mssp_only` 行。
7. **可见性提升已记录。** 每一次从 `mssp_only`
   到 `customer_safe` 的提升都会产生一条 `execution_log` 行。
8. **纠正流程。** 分析师纠正事件会产生一个新事件，
   reducer 应用它；事实面板投影反映该
   纠正。
9. **自动关闭重开。** 在窗口内匹配某个 reopen_signature 的事件
   会重开该 case 并启动一个新 run。
10. **TheHive 导出幂等性。** 对状态未变化的对象
    重跑导出是一个空操作（相同 idempotency_key）。
11. **工具审批策略。** 没有 typed_reason 批准的 `write_external`
    工具调用无法到达执行器。
12. **策略优先级。** 对同一策略键，case 本地覆盖优先于租户，
    租户优先于 install。

## 13. 本规范范围之外

- 组件模型、可视化行为、命令栏解析 → 会话 UI 工作流。
- 战役关联、评分、跨租户机制 → 战役（campaigns）工作流。
- 提示词库、LLM 工具注册表内容、模型版本策略
  → 待我们着手时的独立 LLM 运行时工作流（LLM runtime）。
