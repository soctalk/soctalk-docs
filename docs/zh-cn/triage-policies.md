# 分诊策略

一个对 `sudo` 告警进行分诊的 LLM 既是出色的分析师，也是靠不住的保证。同样的问题问它两次，你可能得到两种答案。告诉它在做决定前务必先调取变更记录，它会照做——通常如此，但并非总是。然而分诊中有一部分并不是判断题。证据步骤*必须*在裁决生效前运行。对 PCI 资产的关闭*必须*暂停以待人工处理。铺天盖地的 agent 健康噪声*根本不应该*耗费一次模型调用。对于这些，你要的不是推理，而是一条规则。

**分诊策略**就是这样一条以数据形式写就的规则。它并不取代 agent——它在 **agentic loop**（负责富化、调查并推理得出裁决的 supervisor-and-tools 循环）外围包裹起若干确定性的关卡。它们无一例外都遵守同一条法则：

> **LLM 提议，确定性关卡处置。**

模型仍可自由推理。由一个纯函数决定其输出是否生效，而它只会在你能*证明*的边缘情况下才介入——一条与活动相矛盾的授权记录、告警上的一个 IOC、一个与本案共享实体的活跃事件。含糊不清的中间地带则直接交给模型，因为那本就属于它的领域。

![分诊策略在 agentic loop 内部如何被评估](/diagrams/triage-policy-loop.svg)

自上而下地阅读它：一条告警在注册表中被解析，在策略的关卡下运行 agentic loop，最终落到一个**处置**（disposition）上——即对该案件的最终决定（自动关闭、升级给人工，或索取更多证据）。每一次自动关闭之下都垫着一层**安全底线**（safety floor）：一组不可被覆盖的、代码级的否决，任何策略都无法削弱它，其完整定义见[下文](#the-safety-floor)。这些编号关卡就是全部的作用面，下一节将逐一讲解它们。

使这一切安全的唯一属性是：一条**由租户编写**的分诊策略只能让分诊更**严格**，绝不会更宽松——它的护栏只会抬高标准，而每次关闭之下的硬底线无法被削弱。（经审核的内置策略和运营方管理的*文件*策略属于受信任的代码，不受该约束限制。）代码位于 [`src/soctalk/triage_policy/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/triage_policy)。


## 分诊策略在何处发挥作用

一条分诊策略在四个点上治理一次运行——即上图中的编号关卡。

1. **解析器（Resolver）。** 一个入口节点将告警与注册表进行匹配，并将生效的分诊策略写入运行状态。如果告警属于某个已知的运营类别且不带任何安全指标，该运行可以在此处确定性地关闭，而根本无需调用模型。
2. **决策前关卡（Pre-decision gate）。** 策略可以要求在裁决合法之前先执行确定性步骤（例如收集授权上下文）。如果 supervisor 过早地提出裁决，该关卡会先将其改道至所要求的步骤。策略还可以限制每个阶段中哪些 supervisor 动作是合法的，而该限制会在调用前施加于模型的结构化输出之上，因此非法动作甚至无法被采样出来。
3. **裁决后守卫（Post-verdict guard）。** 模型起草裁决之后，由一个纯函数决定它是否提交。它可以覆盖草案（将关闭抬升为升级）、中断它（保留草案但改道至人工签署），或让它照原样通过。每一次覆盖都会被记录。
4. **安全底线（Safety floor）。** 一组不可被覆盖的检查守护着每一条自动关闭路径。它*不是*单个步骤——IOC/授权否决在裁决后守卫内部运行，而 kill-switch、volume-cap 和活跃事件否决则在关闭于 worker、server 和 ingest 三个平面提交时再次运行。图中为清晰起见将其画成一个节点；无论它在何处运行，分诊策略中的任何东西都无法削弱它。

## 安全底线

底线在代码中强制执行，而非在策略数据中，并且它适用于案件可能自动关闭的每一个平面：worker 的处置、提交该处置的 server，以及 ingest 快速路径（记忆化关闭和基于规则的自动关闭）。当以下任一情形成立时，关闭会被否决，案件转而被提升或升级：

| 否决 | 触发时机 |
|---|---|
| 存在 IOC | 在裁决路径上，指恶意富化裁决或 MISP 命中；在 ingest 快速路径上，指告警上任何原始 IOC。 |
| 授权被矛盾 | 存在记录，但并不覆盖该活动（已过期、超出时间窗、范围不符、被策略禁止）。 |
| 未经核实的 IOC | 一次 router 层级的关闭，其观测项从未被任何富化检查过。 |
| 活跃事件 | 另一个活跃调查与本案共享一个可关联（attach-eligible）的实体。 |
| Kill switch | 自动关闭已被关停，按租户或全安装范围。 |
| Volume cap | 该租户的自动关闭滚动计数已耗尽。 |

任何一次运行上实际生效的关卡集合，等于底线加上活跃策略额外添加的内容。分诊策略只能让事情更严格。这正是租户编写的策略之所以可以安全放行的原因：一条配置错误或怀有恶意的策略无法变成抑制检测的通道。

kill switch 和 volume cap 值得记住它们的名字。API 进程上的 `SOCTALK_AUTO_CLOSE_KILL`，或某租户上的 `auto_close_kill` 策略标志，会将每一次自动关闭翻转为提升，无需任何 rollout——这正是你在事件进行中会伸手去够的那个控制开关。`auto_close_volume_cap`（默认为每 24 小时 500 次）意味着一个失控的关闭循环会降级为“由人工来看这些”，而不是大规模抑制。

## 内置分诊策略

产品随附两条。两者都是经审核的代码且为只读。

**`dual-use-privileged-exec`** 处理诸如 `sudo` 和 `su` 之类的主机认证活动，对于这类活动，同一个事件在有覆盖性变更记录时是例行管理，而没有时则是一起事件。它要求在任何裁决之前先执行 `gather_authorization_context` 步骤，从 supervisor 的合法动作中移除 `CLOSE`（这样廉价的 router 层就无法短路一个其全部要点恰恰在于良性与恶意看起来完全一致的案件），并要求对任何触及 PCI 分类资产的关闭进行人工签署。

**`agent-health-operational`** 处理 Wazuh agent 的自监控噪声，例如规则 202 “Agent event queue is flooded”。这是一种基础设施状况，而非安全事件，因此该策略根本不调用模型就确定性地将其关闭，这也使得结果保持一致，而不是每次运行各不相同。告警上任何安全指标（一项 MITRE 技术、一个 IOC、一个恶意信号、一个未经证实的类别，或一个严重的 Wazuh 级别——12 级及以上）都会否决这次确定性关闭，并将告警送去完整分诊。

你可以在 MSSP 仪表盘的 **Triage Policies** 页面上看到这两者，其每一道关卡与护栏都展开呈现。

## 模式（Schema）

一条分诊策略即数据。一个通用解释器可运行其中任意数量的策略。

```yaml
id: regulated-privileged-exec
version: 2
tenant: acme                       # a tenant slug or id; authored policies are always scoped
status: shadow                     # active | shadow
priority: 70                       # lower wins on a multi-match; authored/file >= 60
applies_to:
  rule_groups: [sudo]
  rule_ids: []
  authorization_tracks: [account]
required_steps: [gather_authorization_context]
decision_modules: [authorization_engine]
legal_actions:
  decide:  [VERDICT]               # an unlisted phase is unconstrained
close_signoff_data_classes: [pci]
guardrails:
  - when:
      "and":
        - "==": [{ "var": "authz.class" }, "contradicted"]
        - "==": [{ "var": "verdict" }, "close"]
    effect: override
    to: escalate
    reason: acted outside the terms of an authorization
```

将该条件理解为：如果授权类别得出的结果为 `contradicted`，且模型起草了一个 `close`，则将其抬升为 `escalate`。每个节点都是作用于其参数之上的单个运算符，而 `var` 从状态契约中读取一个字段。

| 字段 | 含义 |
|---|---|
| `applies_to` | 该策略治理哪些告警。按规则组、规则 id，或告警活动的授权轨道进行匹配——三者取或（OR）。 |
| `required_steps` | 在裁决合法之前必须运行的确定性节点。 |
| `decision_modules` | 声明该策略所依赖的经审核引擎（目前为：`authorization_engine`），会针对已知模块进行校验。运行时的咨询目前由 `required_steps`（例如 `gather_authorization_context`）驱动，而非由该字段驱动。 |
| `legal_actions` | 每个阶段允许的 supervisor 动作（在所要求的步骤运行完之前为 `triage`，之后为 `decide`）。未列出的阶段不受约束。 |
| `close_signoff_data_classes` | 对处于这些类别之一的资产上的提交型关闭，将被中断以待人工签署。 |
| `guardrails` | 声明式的覆盖或中断规则。见下文。 |
| `priority` | 注册表顺序。内置策略占据 10 和 50；任何编写的或从文件加载的策略必须为 60 或更高，因此它永远无法压过内置策略的保护。 |

某些能力受策略来源的约束：

- **确定性处置**（`agent-health-operational` 用来在无模型情况下关闭的那种机制）是**仅限内置的**——铸造一个新的自动关闭类别是一项代码审查决定，而非配置。
- **编写的策略不得在 `legal_actions` 中授予 `CLOSE`**。授予它相较于不受约束的阶段并无任何额外作用（基线本已允许 router 关闭），却会让非法动作重映射迫使每一次提议都变成一次无裁决的自动关闭，而这次关闭仅立足于粗粒度的底线之上。终局决定改为经由 `VERDICT` 路由；校验会拒绝任何阶段中的 `CLOSE`。内置策略和文件策略仍可列出完整的动作集。

## 护栏条件

条件是作者唯一需要编写的逻辑，它们在一门小型的沙箱化语言中、在一份有文档记录的状态契约之上运行。没有属性访问，没有函数调用，没有任何办法命名契约之外的东西。一个条件是由单运算符节点构成的一棵树。

运算符：`var`、各类比较运算（`==`、`!=`、`<`、`<=`、`>`、`>=`）、逻辑运算 `and` / `or` / `!` / `!!`，以及 `in`。

条件可以读取的字段：

| 字段 | 它是什么 |
|---|---|
| `authz.class` | `covered`、`contradicted` 或 `absent`，由引擎导出。 |
| `authz.in_scope`、`authz.sanctioned_or_routine`、`authz.actor_genuine`、`authz.policy_allowed` | 四个*预期性组件*（expectedness components）——授权引擎给出的布尔值，用于判断活动是否落在获批范围内、是否经过许可或属例行、是否由真实的行为主体执行，以及是否被策略允许。 |
| `verdict` | 模型的草案决定。 |
| `verdict_confidence` | 其置信度，`0.0` 到 `1.0`。 |
| `asset.data_classification`、`asset.environment`、`asset.criticality` | 活动所涉资产经信任解析后的属性。 |
| `enrichment.ioc` | 是否存在恶意信号。 |
| `correlation.active_incident` | 是否有活跃事件与之重叠。 |

`effect` 要么是 `override`，要么是 `interrupt`。抑制是无法表达的：`close` 不是合法的目标，而覆盖只能沿着阶梯 `close < needs_more_info < escalate` 向上抬升一个决定，绝不能向下。一个引用了未声明字段或未知运算符的条件，会在策略被校验时（即它有机会运行之前）就被拒绝。请注意，`enrichment.ioc` 和 `correlation.active_incident` 也由硬底线独立于任何护栏来强制执行——在一次已发布的 worker 运行中，`correlation.active_incident` 通常只在提交时的底线处才被填充，因此对这些情形应倚靠底线，而不要在护栏中再次推导它们。

## 在无代码编辑器中编写一条

管理员在某租户被固定（pinned）时，可从 **Triage Policies** 页面编写分诊策略——无需任何 YAML。本节完整走一遍从头到尾构建一条真实、非平凡的策略。这个例子 `prod-privileged-exec-strict` 治理处于账户授权轨道上的特权执行告警：它要求授权证据、收窄 agent 可执行的动作，并添加只升不降（raise-only）的护栏外加一道 PCI 关闭门。

打开 **“+ New triage policy”**（或 `/triage-policies/editor`）。编辑器分为两栏——左侧是文档**表单**（form），右侧是实时的**决策流投影**（decision-flow projection）外加一个 **“Try it” 模拟器**，二者在每次编辑时都会重新渲染。

![空白的无代码编辑器](/screenshots/triage-policy-editor-01-blank.png)

**1 — 身份（Identity）。** 给策略一个 slug id 和一个**优先级**（priority）：一个受底线限制的整数（`≥ 60`），双重匹配时数值较低者胜出，因此编写的策略永远无法压过内置的保护。

![身份：slug 与优先级](/screenshots/triage-policy-editor-02-identity.png)

**2 — 它拥有哪些告警？** 三个匹配器取或（OR）。此处该策略拥有规则组 `sudo, su, sudoers`、规则 id `5402, 5501`，位于 `account` 轨道上。

![匹配器](/screenshots/triage-policy-editor-03-matchers.png)

**3 — 调查要求。** 要求 `gather_authorization_context` 步骤，声明对 `authorization_engine` 模块的依赖，并将 `decide` 阶段收窄为仅 `VERDICT`。请注意 `CLOSE` 并未提供——编写的策略无法授予它。

![调查要求](/screenshots/triage-policy-editor-04-requirements.png)

**4 — 关闭签署。** 对 `pci` 或 `phi` 分类资产上的提交型关闭，会被留置以待人工处理。

![关闭签署](/screenshots/triage-policy-editor-05-signoff.png)

**5 — 护栏。** 护栏在安全底线之后按顺序运行，首个匹配者胜出。每个条件都可以编写成 JSON——即带 `and`/`or` 组的沙箱化 `{"op": [{"var": "field"}, value]}` 方言……

![以 JSON 编写一个条件](/screenshots/triage-policy-editor-06-guardrail-json.png)

……或者在可视化构建器中编写，它与 JSON 之间可双向往返。该护栏在授权被**矛盾**（contradicted）*且*资产为**关键**（critical）时触发，并将决定抬升为 `escalate`。

![可视化构建器中的同一条件](/screenshots/triage-policy-editor-07-guardrail-visual.png)

另有两条护栏使该策略完整：一条低置信度覆盖至 `needs_more_info`，以及一个将 PCI 关闭留置以待人工审查的 `interrupt`。顺序很重要——首个匹配的护栏进行处置。

![全部三条护栏](/screenshots/triage-policy-editor-08-guardrails-all.png)

**6 — 读懂流程，然后模拟。** 右栏将整份文档投影到流水线上：匹配器 → 阶段 → LLM 草案 → **安全底线（始终开启）** → 护栏 → 签署 → 提交。

![决策流投影](/screenshots/triage-policy-editor-09-decision-flow.png)

**“Try it”** 面板预览编辑器所能建模的护栏 + 底线逻辑——它是完整的 worker/server/ingest 强制执行路径的一个子集，用于编写时的反馈。给它喂入一个授权被矛盾、资产为关键的案例，结果是 `escalate`——但它来自**安全底线**，而非本策略。这正是被可视化呈现出来的核心不变量：被矛盾的授权是一条不可覆盖的底线否决，而策略的护栏只是在其之上*向上抬升*。

![Try-it 模拟器展示底线的升级](/screenshots/triage-policy-editor-10-try-it.png)

`Create (shadow)` 保存它。表单和被存储的文档是同一件产物——“View as JSON” 会精确显示出被持久化的内容。

![完成后的策略](/screenshots/triage-policy-editor-11-complete.png)

保存时的校验是失败即关闭（fail-closed）的，并施加与文件策略相同的规则外加几条更严格的规则：id 必须是一个 slug，被引用的步骤、决策模块和合法动作阶段必须是运行时确实认识的，`CLOSE` 不得被授予，且定义有大小上限。一个未知的引用会在编写时就被拒绝，而不是在运行时被悄悄忽略。每一个被保存的修订版本都以只追加（append-only）的历史形式保留。

## 先 shadow，再激活

一条编写的策略有四种状态——**draft**、**shadow**、**active**、**retired**。强烈建议进行 shadow 评估，但并非强制：策略可以直接从 draft 激活。

在 **shadow** 状态下，该策略会像一条活跃策略一样被完全一致地匹配并评估其护栏，其“本会触发”的决定会被写入审计轨迹——但它不改变任何处置。这在它做出任何决定之前，就为你提供了它针对实时流量将会如何行动的真实证据。

**激活**它（Triage Policies 页面上的 **Activate** 操作）使它开始治理。由于 worker 是一个独立进程，其注册表在启动时加载一次，激活不能只是翻转一个数据库标志——它会在下一次 `tenant.reconcile` 时将定义物化（materialize）到该租户的 worker ConfigMap 中，而 **worker rollout 才是激活的关卡**：策略只有在一个全新的 worker 读取到它时才开始治理。编辑一条活跃策略会使其保持活跃并以新定义重新滚动；停用则将其退回到 shadow。

![编写型策略的生命周期：先 shadow，再激活以治理](/diagrams/triage-policy-lifecycle.svg)

偏好以代码方式管理策略的运营方仍可走 git 路径：将一个 YAML 文件写入挂载的目录，然后滚动 worker。同一个注册表既加载编写并激活的策略，也加载手写的文件策略。

## 接线（The wiring）

由两个环境变量来承载它：

- runs-worker 上的 `SOCTALK_TRIAGE_POLICY_DIR` 是注册表在启动时从中加载的目录。
- controller 上的 `SOCTALK_TENANT_TRIAGE_POLICIES_DIR` 是运营方挂载的目录，provisioning 路径从中读取、校验，并将其渲染进每个租户的 chart values 中作为一个挂载的 ConfigMap。

在 chart 供给（chart-provisioned）路径上，策略是租户的 chart values（`runsWorker.triagePolicies`，渲染为 `soctalk-triage-policies` ConfigMap），而一次内容变更会在 pod 模板上打上一个校验和（checksum），使得一次编辑会自动滚动 worker。rollout 就是激活的关卡：因为注册表每个进程只加载一次，一条策略只有在一个全新的 worker 读取到它时才开始治理。

每一次加载、跳过和拒绝都会被记录。一个因任何原因未通过校验的文件（模式错误、一个未知字段、一个格式错误的条件、一个会压过内置策略的优先级）会被整体拒绝，绝不治理任何东西，因此一次糟糕的 rollout 会降级为“那条策略未激活”，而绝不会降级为错误的强制执行。
