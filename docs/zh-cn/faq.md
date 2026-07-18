# 常见问题

安装前 / 购买前的问题，这些不太适合归入安装或参考文档。

## 什么是 SocTalk？

一个为 MSP 和 MSSP 打造的多租户 SOC 平台。单一控制平面编排各客户专属的 Wazuh 栈；AI 流水线对告警进行分诊并提出处置建议；人工分析师审批升级。完全开源。

## 哪些是开源的，哪些是商业的？

**[`soctalk/soctalk`](https://github.com/soctalk/soctalk) 仓库中的一切均采用 Apache 2.0 许可** —— 包括控制平面、AI 流水线、Wazuh 集成、charts 以及演示 VM。不存在"社区版 vs 企业版"的功能割裂。

针对不愿自行运行该平台的 MSP，我们提供托管服务（SocTalk Cloud）。托管服务使用与开源发行版相同的代码。

## 我可以在没有 Kubernetes 集群的情况下评估它吗？

可以 —— [演示 VM 镜像](/zh-cn/quickstart-vm)是单机安装。将其启动于 KVM、VMware、Hyper-V、Azure，或从 raw 格式转换。五分钟即可得到一套运行中的多租户安装，并已完成一个 `demo` 租户的接入。

## 我可以长期在单节点上运行它吗？

对于极小规模的部署可以（1–2 个客户，低告警量）。演示 VM 使用 `poc` 配置文件，该文件假定为临时存储，且未针对持续负载进行规格设计。用于真实客户场景时：

- 提升 VM 资源（16 GB 内存 + 200 GB SSD 可支撑约 3 个小型租户）。
- 接入租户时使用 `persistent` 配置文件。
- 添加备份（参见[备份与恢复](/zh-cn/backup-restore)）。

超过约 3 个租户时，请规划多节点集群。

## 它能在气隙（air-gapped）环境中工作吗？

可以，需额外几个步骤：

- **容器镜像**：将 `ghcr.io/soctalk/*` 镜像到你的内部 registry。chart 接受 `image.registry: your.registry.example/soctalk`。
- **Helm chart**：执行一次 `helm pull oci://ghcr.io/soctalk/charts/soctalk-system`，托管到内部 OCI registry，并将安装指向它。
- **LLM**：使用本地的 OpenAI 兼容端点（vLLM、Ollama 代理、本地部署的 Bedrock 代理）。参见 [LLM 提供方](/zh-cn/integrate/llm-providers)。
- **Cortex 分析器**：任何需要联网的分析器都无法工作。仅使用本地部署的分析器（MaxMind GeoIP、内部 MISP），或禁用 Cortex。
- **GitHub Releases**：在一台联网主机上下载 [VM 镜像](/zh-cn/downloads)，再通过移动介质拷入。

一旦镜像完成镜像同步，[`scripts/dev-up.sh`](https://github.com/soctalk/soctalk/blob/main/scripts/dev-up.sh) 流程即可在无网络的情况下运行。

## 每个租户的 LLM 成本是多少？

差异极大，取决于：

- 告警量（每条通过关联的告警对应一次调查）
- 每次运行的 token 预算（`case_runs.tokens_budget`，模型默认 200,000）
- 模型选择（`fast_model` + `reasoning_model`）
- 裁决判定为 `needs_more_info` 的频率（会触发重新运行）

在默认的每次运行 200,000-token 预算和典型使用下的量级估算：30 条告警/天 × 每次调查约 60k token × $5/Mtok 输入 ≈ 在经济型 OpenAI 兼容配置上每个租户每天约 $9。若采用更便宜的快速模型，可下降 5–10 倍。测量方法参见[可观测性 —— 每租户成本](/zh-cn/observability#per-tenant-cost)。

## 不同客户能否使用不同的 LLM 模型？

可以 —— 在接入时按租户覆盖。全安装范围的模型为默认值；租户通过指定自己的模型来选择退出。参见 [LLM 提供方 —— 每租户覆盖](/zh-cn/integrate/llm-providers#per-tenant-overrides)。

## 客户能否自带 LLM 密钥？

可以 —— 每租户覆盖同样适用于 API 密钥。权威存储是 Postgres 中的 `IntegrationConfig.llm_api_key_plain`；控制器将其实体化为**该租户**命名空间（而非 `soctalk-system`）中的 `Secret/tenant-llm-key`，由 runs-worker 挂载。这对计费隔离很有用。

## SocTalk 会将客户数据发送给 Anthropic / OpenAI 吗？

只发送 AI 流水线进行推理所需的内容：告警正文、提取出的可观测项以及 worker 输出。运行时不会外泄静态数据 —— 仅涉及当前调查状态中的内容。如需更严格的姿态，请使用本地部署的 LLM 端点（vLLM、Ollama）。参见 [LLM 提供方 —— 切换到 Anthropic / 运行时旋钮](/zh-cn/integrate/llm-providers#runtime-only-knobs-env-not-chart)。

## 它会取代我的分析师吗？

不会。SocTalk 定位为**副驾（copilot）**，而非替代品。裁决节点决定 `escalate | close | needs_more_info`；升级始终会经过[人工审查](/zh-cn/human-review)关卡。没有人工，一个高告警量的 MSSP 仍然需要分析师来处理 SocTalk 路由给他们的决策。

其价值在于压缩 —— 同一支分析师团队可以处理 5–10 倍的告警量，因为常规案件会自动关闭，只有不明确的案件才会到达人工审查。

## 它能在没有 Wazuh 的情况下工作吗？

当前的数据平面仅支持 Wazuh。MCP 工具面（`wazuh.*`、`cortex.*`、`thehive.*`、`misp.*`）是可插拔的，因此接入其他 SIEM 在技术上可行。但目前尚无任何现成实现。

## 生产环境加固姿态如何？

- Postgres 行级安全（Row-Level Security），并以 `FORCE ROW LEVEL SECURITY` 作为跨租户数据隔离的兜底。
- Cilium NetworkPolicy 隔离每个 `tenant-<slug>` 命名空间。
- 处处启用 TLS（生产环境由 cert-manager 管理；向导环境使用自签名证书）。
- 所有控制平面状态均存于 Postgres，并采用仅追加（append-only）的审计日志语义。
- 引导管理员仅在 values 中显式配置时（或通过预置的 Secret）才会创建；首次登录后请使用 `soctalk-auth set-password` 进行轮换。

完整姿态参见[安全模型](/zh-cn/reference/security-model)。

## 我可以在 EKS / AKS / GKE 上运行它吗？

可以 —— chart 面向标准 Kubernetes 1.30+。接入你所在云的 StorageClass、ingress 控制器以及 cert-manager 的 DNS-01 solver。[安装指南](/zh-cn/install)以 K3s 为主，因为那是默认发行版；chart 本身并不在意用哪个发行版。

## 它能扩展到 N 个客户吗？

已在 3 节点集群（16 vCPU / 64 GB / 节点）上测试至约 50 个租户。瓶颈通常是每个租户的 Wazuh indexer（每个 indexer 都是拥有自己堆的 Java 进程），而非 SocTalk 控制平面。请为每个 `persistent` 配置文件的租户规划约 6–8 GB 内存和约 1.5 vCPU —— 参见[规格设计](/zh-cn/reference/sizing)。

## 合规性如何（SOC 2、HIPAA、PCI）？

平台的姿态支持 SOC 2 风格的审计 —— 仅追加的审计日志、RBAC、静态加密（Postgres + Wazuh indexer）、传输加密。但它**不**附带 SOC 2 认证；这是 MSSP 对其托管环境应承担的责任。

对于 HIPAA / PCI，数据平面（Wazuh）通常持有在合规范围内的数据。请将该 PVC 视为在合规范围内，并据此进行备份（参见[备份与恢复](/zh-cn/backup-restore)）。

## 路线图上有什么？

GitHub Issues 和 [`soctalk/soctalk`](https://github.com/soctalk/soctalk) 的 Projects 看板是唯一可信来源。文档中提及的、作为未来版本的高影响力事项：

- 将代理认证模式（Proxy auth mode）暴露为 chart values 旋钮（目前：env var 覆盖）。
- 舰队升级 API（目前：手动 `helm upgrade` 循环）。
- 许可证签发方（离线签名的安装凭据）。
- 客户自管 VPN 接入辅助工具（目前：仅有文档化的模式）。
- 租户详情页上的每租户 Agents 标签页。

## 我如何贡献？

参见[贡献](/zh-cn/contribute)页面。

## 我从哪里获得帮助？

- Issues：https://github.com/soctalk/soctalk/issues
- Discussions：https://github.com/soctalk/soctalk/discussions
- Security：参见仓库中的 SECURITY.md
