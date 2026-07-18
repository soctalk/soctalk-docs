# 响应 Playbook

## 从裁决到行动

SocTalk 的 [AI 分诊流水线](/zh-cn/ai-pipeline)的存在是为了回答关于告警的一个问题：这是不是真的，以及案件应当如何处理。智能体循环会对告警进行富化、收集上下文、开展调查，并推理得出一个裁决，运行以一个处置结果收尾。处置结果是最终决定，是以下三者之一：升级给人工、作为误报自动关闭，或请求更多证据。这个决定是整条上游流水线的产物，也是[分诊策略](/zh-cn/triage-policies)发挥作用的地方——把分诊中必须保证确定性的部分固定下来，同时让模型去推理其余含糊不清的部分。

处置结果本身不会改变外部世界的任何东西。它不会开工单、不会呼叫值班人员、不会把案件交给 SOAR，也不会把一台失陷的笔记本电脑从网络上摘除。响应 Playbook 就是对处置结果采取行动的那一层。它严格在分诊提交之后运行，读取分诊所产出的内容，并将其转化为具体的步骤。

它所读取的是一个称为处置信封（disposition envelope）的单一类型化对象。SocTalk 会在处置结果变为最终态的那一刻、在同一个数据库事务内组装这个信封，它承载着响应可能依据的一切。其中包括：生效处置（effective disposition），即安全底线（safety floor）表态之后的最终决定；模型的裁决及其置信度；告警的严重程度；它的规则组和规则 id；它被映射到的 ATT&CK 技术和战术；所涉及的实体和 IOC；以及在此过程中触发了哪些安全底线否决。这个信封是分诊与响应之间的契约，也正是 Playbook 交给其下游任何系统的确切载荷。

![响应 Playbook 如何消费分诊处置结果并对其采取行动](/diagrams/response-playbook-loop.svg)

下文的一切都是那张图的右半部分：Playbook 如何匹配信封、它能采取哪些行动，以及那些危险的行动如何始终留在人工把关之后。相关代码位于 [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response)。

## 哪些自动运行，哪些需要审批

行动按其对你环境的影响程度分为两类。在案件上写一条备注或向 webhook 发送一条通知，是可以自动执行的安全操作，因为它最糟糕也不过是增加些噪声，所以这些行动会立即运行，无需任何人审批。隔离一台端点或禁用一个账户则是另一回事，所以这些行动绝不会自动触发。当一个 Playbook 要求执行此类行动时，它不会直接运行，而是在案件上提出一个提案，由分析师审查并批准后才会发生任何事。模型在分诊过程中绝不会自行采取遏制行动，Playbook 在响应过程中也不能自行采取遏制行动。在这两种情况下，任何触及活动系统的操作都必须有人签字确认。

有三条规则存在于代码中而非 Playbook 数据里，任何 Playbook 都无法削弱它们。关闭是攻击者最想触发的方向，所以在关闭路径上，Playbook 只能注记或审计，绝不能采取外部行动。分发终止开关（dispatch kill switch）通过 API 进程上的 `SOCTALK_RESPONSE_DISPATCH_KILL` 或租户上的 `response_dispatch_kill` 标志设置，它会在不做灰度的情况下停止每一个响应，是当某个连接器在事件处理中途开始异常时应当求助的控制手段。此外，只有当处置结果确实在案件上生效时，响应才会触发。如果分析师在运行仍在进行时就关闭或合并了调查，那么不会有任何分发针对一个从未发生过的状态执行。

## 三种能力

Playbook 通过名称引用某种能力，且不能引用其他任何东西。当 Playbook 被校验时，未知的名称会被拒绝。目前发布了三种能力。

`annotate_investigation` 在案件上写入一条系统备注。它只触及 SocTalk，自动运行，并且是唯一允许在关闭时执行的行动。

`notify_webhook` 将签名后的信封投递到租户所配置的 webhook。这是移交给外部 SOAR 的交接点。SocTalk 对信封签名并发送，此后发生的一切由接收方负责。它同样自动运行。

`external_action` 是那个需要审批的能力。它将一个具名行动连同签名后的信封一起发送到运维方配置的某个端点，而这正是真正的工作——隔离端点或禁用账户——发生在 SocTalk 之外、置于一个稳定契约之后的地方。若没有分析师先行批准，它绝不会运行。

有一个细节让 `external_action` 保持安全。Playbook 作者命名的是一个端点和一个行动，而绝非一个 URL。运维方在 `response_action_endpoints` 租户策略中将该端点名称映射到真实的 URL 和签名密钥，因此作者可以请求在 `edr` 端点上进行隔离，却无法选择请求实际发往何处。每个请求都经过 HMAC 签名，并且会拒绝访问私有或链路本地地址。

## 模式（schema）

响应 Playbook 是数据，一个解释器可以运行任意数量的 Playbook。下面教程所构建的 Playbook 长这样：

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active or shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx), not names
  mitre_tactics: ["Lateral Movement"]   # tactic strings as your source emits them
response:
  on_escalate:
    - capability: external_action
      when: { ">=": [{ "var": "severity" }, 10] }
      params: { endpoint: edr, action: isolate_endpoint }
    - capability: notify_webhook
    - capability: annotate_investigation
      params: { body: "endpoint isolation proposed for lateral-movement alert" }
  on_close:
    - capability: annotate_investigation
      params: { body: "auto-closed as false positive" }
```

`applies_to` 块决定 Playbook 拥有哪些告警。它按规则组、规则 id、ATT&CK 技术 id 或 ATT&CK 战术进行匹配，这四者之间是 OR 关系，因此其中任何一个命中即为匹配。空的 `applies_to` 会匹配每一条告警，这没问题，因为处置列表已经决定了 Playbook 何时真正触发。ATT&CK 匹配遵循一条规则。技术按其规范 id（如 `T1021`）匹配，而绝不按名称匹配，因为人类可读的名称并不稳定。战术则按告警来源发出的任意字符串匹配，而 Wazuh 发送的是像 `Lateral Movement` 这样的名称，而非 `TA` 引用。

在 `response` 之下，`on_escalate` 最多可容纳八个在案件升级时采取的行动，`on_close` 最多可容纳四个用于自动关闭的注记层级行动。每个行动由一个能力名称、一个可选的 `when` 条件，以及供该能力读取的一组 `params` 组成。这些 params 是透传的。`external_action` 从中取出 `endpoint` 和 `action` 并转发其余部分，它不需要在 params 中命名目标主机，因为完整的签名信封随每个请求一同传递，实体就搭载在其中。

## 条件

`when` 条件是作者所能编写的唯一逻辑，它运行在与分诊护栏相同的那个小型沙箱化语言中。它是一棵由单运算符节点组成的树，作用于一组固定的字段之上，没有属性访问、没有函数调用，也无法命名契约之外的任何东西。运算符包括 `var`，比较运算符 `==`、`!=`、`<`、`<=`、`>` 和 `>=`，逻辑运算符 `and`、`or`、`!` 和 `!!`，以及 `in`。行动只有在其条件成立时才触发，而作用于缺失数据的条件只会被视为 false，而非报错。

条件可读取的字段全部来自信封。有生效的 `disposition` 和模型在底线更改它之前所提出的 `worker_disposition`；`floor_vetoed`，用于表明是否有底线否决改变了结果；`verdict_confidence` 和 `severity`；告警的 `rule.groups` 和 `rule.ids`；以及 ATT&CK 字段，`mitre.techniques` 保存规范的 `Txxxx` id，`mitre.tactics` 保存来源的战术字符串。后四者是列表，所以你用 `in` 来测试它们。写 `{"in": ["T1021", {"var": "mitre.techniques"}]}` 会在告警携带技术 T1021 时触发该行动。引用契约未声明的字段或运算符，会在 Playbook 保存时就将其拒绝，远早于它可能运行之时。

## 在无代码编辑器中构建一个

管理员在某个租户被固定（pinned）时，可从 **Response Playbooks** 页面创作响应 Playbook，无需编写任何 YAML。本节将端到端地演示如何根据上面的模式构建 `isolate-lateral-movement-endpoint` 这个 Playbook。它会在高严重程度的横向移动升级上提议隔离一台端点、通知 SOC，并对案件做注记。

打开 **"+ New response playbook"**（或导航至 `/response-playbooks/editor`）。编辑器是两栏。文档表单在左侧，右侧是一张实时流程图，它在每次编辑时重新渲染，展示处置结果扇出到各个行动，其中需要审批的行动会先经过一个审批步骤路由。

![空白的无代码编辑器](/screenshots/response-playbook-editor-01-blank.png)

从身份标识开始。给 Playbook 一个 slug 形式的 id 和一个优先级，其中数字越小在多重匹配时越优先。

![身份标识](/screenshots/response-playbook-editor-02-identity.png)

接下来，决定它拥有哪些告警。这四个匹配器之间是 OR 关系。这个 Playbook 拥有规则组 `sudo` 和 `su`，更有用的是拥有 ATT&CK 技术 `T1021`（Remote Services）以及战术 `Lateral Movement`，因此无论是哪条规则触发的，它都会在任何映射到横向移动的告警上触发。技术字段接受 id 而非名称，战术字段接受你的来源发出的字符串。

![匹配器，包括 ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

现在是隔离行动。在升级时，添加 `external_action`，即标记为"需要审批"的那个。在其 params 中命名运维方所配置的端点和行动（即 `isolate_endpoint`），你绝不输入 URL。添加一个条件，使它只在高严重程度的升级上触发。

![带条件的隔离行动](/screenshots/response-playbook-editor-04-isolate.png)

添加另外两个补全这次响应且自动运行的行动。一个 `notify_webhook` 将案件移交给 SOC 的 SOAR，一个 `annotate_investigation` 留下审计轨迹。

![自动运行的通知与注记行动](/screenshots/response-playbook-editor-05-tier0.png)

在构建过程中阅读流程图。右栏投射整个文档。处置信封扇出到每个行动，隔离行动在能够运行之前先经过一个审批步骤路由，其余两个则显示为自动运行。

![流程图，其中隔离行动经过审批路由](/screenshots/response-playbook-editor-06-flow.png)

用 **Create (shadow)** 保存会将其持久化。表单与存储的文档是同一件产物，"Preview JSON" 会精确显示所保存的内容。保存时的校验是失败即关闭（fail-closed）。id 必须是一个 slug，每个能力都必须是经过审核的名称之一，`on_close` 只能注记，条件必须引用已声明的契约。未知的引用会在你创作时就被拒绝，而绝不会在运行时被悄悄丢弃。

![列表中已完成的 Playbook，可供激活](/screenshots/response-playbook-editor-07-list.png)

## 先影子运行，再激活

一个创作出来的 Playbook 会经历四种状态：draft、shadow、active 和 retired。

在 shadow 状态下，Playbook 会被匹配，其行动也会像 active 状态一样被完全选中，其"本会触发"的行动会写入审计轨迹，但不会有任何东西入队。这让你在它做任何事之前，就获得关于它针对实时流量会做什么的真实证据。

用 Response Playbooks 页面上的 **Activate** 操作激活它，会将其开启，而且与分诊策略不同，它会实时生效。SocTalk 在每个案件被裁定时评估响应 Playbook，因此一个激活的 Playbook 会应用于紧接着的下一个处置结果，无需等待任何灰度。停用则会立即将其退回到 shadow。

当一个需要审批的行动在真实的升级上出现时，它会作为一个提案落在案件上。分析师能确切看到会运行什么以及针对哪台主机，而批准它正是触发隔离的动作。该行动只运行一次，它得到的响应会被记录，重复投递绝不会让它运行两次。

## 接线（wiring）

有几个部件承载了这一切。API 进程上的 `SOCTALK_RESPONSE_PLAYBOOK_DIR` 是一个在启动时加载的 YAML Playbook 目录，这是面向偏好将 Playbook 作为代码管理的运维方的 git 托管路径。在 UI 中创作的 Playbook 则存放在数据库里，以仅追加（append-only）的历史形式保存，并按作用域隔离，使一个租户只会看到属于自己的部分，同时 SocTalk 会将它们与文件 Playbook 合并，从而让租户自己的 Playbook 覆盖同 id 的文件 Playbook。`response_webhook_url` 连同可选的 `response_webhook_secret`，为一个租户设置 `notify_webhook` 的目标。而租户上的 `response_action_endpoints` 将端点名称映射到它们的 url 和密钥以供 `external_action` 使用，这就是运维方在 Playbook 始终只命名一个端点的同时保持对目标控制权的方式。

每一次匹配、审批、行动和拒绝都会被记录，每一个运行的行动都会连同它所得到的响应一起记录下 Playbook 的 id 和版本。一个未通过校验的 Playbook 会被整体拒绝且绝不生效，因此一次糟糕的编辑最终会表现为"那个 Playbook 未激活"，而不是一次错误的行动。
