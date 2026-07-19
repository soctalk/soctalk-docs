---
description: Wazuh MSSP 客户接入端到端指南——预配隔离的租户 SOC、注册代理、分发访问权限，并为第一周运营建立基线。
---

# 将客户租户接入多租户 Wazuh SOC：MSSP 检查清单

将客户"接入"多租户 Wazuh 服务实际上是四项工作，而不是一项：预配按客户隔离的独立堆栈、把客户的代理注册到*他们自己的* manager（而不是任何其他人的）、分发遵守 MSSP/客户边界的访问权限，以及为第一周的运营建立基线。本指南在 SocTalk 上完整走通这条路径——每个客户都在自己的 Kubernetes 命名空间中获得专属的 Wazuh manager、indexer 和 dashboard，统一置于一个 MSSP 控制平面之后。

## 在点击 New Tenant 之前需要做的决定

**Profile。**Profile 在接入时即固定——之后切换意味着先下线再重建——所以要先做决定：

- `poc` ——用于评估和短期试点。使用 `local-path` 存储，没有真正的持久化保证，资源请求较低，没有备份钩子。这也是**未指定时的默认值**，而对付费客户来说这是错误的默认值。
- `persistent` ——用于生产环境的客户 SOC。使用你的安装环境的默认 StorageClass，按生产规模配置资源请求，若已配置则遵从备份钩子。
- `provided` ——客户已自行运行 Wazuh（BYO-SIEM）。SocTalk 仅在租户命名空间中安装其 adapter 和 runs-worker，并通过网络访问客户的 indexer（`:9200`）和 Manager API（`:55000`）。外部连接材料*以及*租户级 LLM 凭据在接入时是必填项——缺失时 API 返回 422。

**容量规划。**每个 `persistent` 租户大致按 6–8 GB 内存和约 1.5 vCPU 规划；租户级 Wazuh indexer 通常是瓶颈并决定磁盘用量（默认 50 GB PVC，30 天热数据保留，暂无热→冷分层）。SocTalk 已在由 16 vCPU / 64 GB 节点组成的 3 节点集群上测试到约 50 个租户；单台主机上超过约 5 个租户的场景应视为未经验证。详见[容量规划](/zh-cn/reference/sizing)。

**租户级 LLM。**分诊运行在按租户独立的 LLM 配置上：Anthropic 或任何 OpenAI 兼容端点（Azure OpenAI、vLLM、Ollama、LiteLLM）。客户可以自带 API 密钥以实现计费隔离——以 Kubernetes Secret 形式挂载到其命名空间，并附带已在文档中说明的 V1 注意事项：该密钥同时以明文保存在 SocTalk 数据库中（[Secrets](/zh-cn/reference/secrets)）——你也可以将租户指向完全本地的 Ollama 端点，实现不出云、无按 token 计费的形态（需为较慢的 CPU 推理预留时间预算）。参见 [LLM 提供商](/zh-cn/integrate/llm-providers)。

## 预配：实际发生了什么

从 [MSSP UI](/zh-cn/mssp-ui)（Tenants → **+ New Tenant**）或通过 API 创建租户。租户进入由服务端强制执行的状态机——`pending → provisioning → active`，此后还有 `degraded`、`suspended`、`decommissioning`、`archived` 和 `purged`；非法状态转换会被以 409 拒绝。

控制器按顺序运行九个幂等阶段，每个阶段都会发出可在租户详情页上查看的生命周期事件：预检、租户级密钥铸造（`authd`、JWT、Postgres）、命名空间创建（`tenant-<slug>`，带有标签以及与 profile 对应的 ResourceQuota 和 LimitRange）、密钥应用、`soctalk-tenant` Helm 安装（同时自动预配 `tenant_admin` 用户）、Wazuh chart 安装、就绪轮询、集成配置写入，以及向 `active` 的状态转换。

如果某个阶段失败，租户会落入 `degraded`，失败步骤记录在事件行中。修复根因（卡住的 PVC、配额不足、镜像拉取失败）后点击 **Retry Provisioning** ——重试会从阶段 1 重新开始，且每个阶段都是幂等的，因此重复运行是安全的。重试仅在*处于* `degraded` 状态时有效，`pending` 状态下不可重试。卡死状态的运维手册见[日常运维](/zh-cn/operations)。

## 代理注册：把端点接入正确的租户

每个租户都获得一个专属 DNS 名称（`acme.soc.mssp.example.com`），解析到租户级 L4 端点，承载 1514/TCP（事件）和 1515/TCP（注册）。路由基于目标地址而非 SNI——Wazuh 的 1514 代理协议不是标准 TLS，永远不会发送 ClientHello。

**V1 的坦诚说明：**chart 创建的 Wazuh manager Service 仅为 `ClusterIP`。**本版本没有自动的 LoadBalancer 或 DNS 预配**——边缘接入需要你自行搭建：手动应用一个租户级 LoadBalancer Service、在单个 IP 上按租户分配端口对的边缘 HAProxy，或者一条 mesh-VPN 路径。DNS 记录同样由运维人员自行管理。

注册本身在设计上就是租户级隔离的。获取该租户的 `authd` 共享密钥：

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

通过安全渠道将主机名、端口和密钥交给客户的端点管理员；对方运行 `agent-auth -m <hostname> -P "<secret>"`。持有租户 A 密钥的代理只能注册到租户 A 的 manager。专门的 Agents 标签页和 Agent Onboarding 面板已在路线图上；目前请在内嵌的 Wazuh dashboard 中核验代理（Tenants → **Open SOC** → Agents）。完整拓扑和防火墙要求见 [Wazuh 代理入口](/zh-cn/reference/wazuh-ingress)。

## 人员：谁获得登录账号

预配阶段已经铸造了一个 `tenant_admin`。该角色是自助式的：可在客户门户中管理本组织的用户和自己的 LLM 设置。对于需要可见性但绝不应执行操作的干系人，分配 `customer_viewer` ——只读的 dashboard 和调查，没有审查队列，没有聊天。

每个新建用户都会收到一次性临时密码，仅显示一次，并强制在首次登录时修改。受众墙隔离两侧：租户角色永远无法持有 MSSP 能力，反之亦然，由能力守卫强制执行，因此客户登录在结构上不可能触达跨租户界面。注意本版本没有自助找回密码流程——重置由管理员强制执行。完整目录见[用户与角色](/zh-cn/users-and-roles)。

## 第一周

- **心跳。**关注 `/metrics` 上的 `soctalk_tenant_adapter_heartbeat_age_seconds` ——在 V1 中它是唯一主动更新的指标，并且*不会*自动将租户状态降级，因此需要你自行为其配置告警。
- **审查队列。**新租户在基线稳定之前会产生审查流量；每一次 AI 上报都要在 dashboard 队列中等待人工处理——不存在自动批准的旁路。
- **交战窗口。**如果客户排期了渗透测试，请在开始前声明交战窗口（来源、主机、技术、时间），使经授权的活动被标记并审计而非被上报——而超出范围的测试人员活动仍会强制触发人工审查。
- **暂停/下线基础。**暂停只翻转数据库状态并停止新的调查，但**不会**缩容工作负载——紧急切断是一份手动运维手册。下线会拆除数据平面，并将租户行及审计历史保留在 `archived` 状态；目前还没有 `:purge` API 端点。

## 接入检查清单

- [ ] 已选择 profile（生产环境用 `persistent`；`provided` 需要预先提供 SIEM URL 和 LLM 凭据）
- [ ] 已确认集群余量（每个 `persistent` 租户约 6–8 GB 内存、约 1.5 vCPU）
- [ ] 已确定租户级 LLM（自带密钥 / 安装默认 / 本地 Ollama）
- [ ] 租户已创建；生命周期事件到达 `active`
- [ ] 已手动接好边缘入口：LB 或 edge-proxy 端点 + `<slug>.soc.<domain>` 的 DNS 记录
- [ ] 已获取 `authd` secret 并通过安全渠道共享
- [ ] 第一个 agent 已注册并在租户的 Wazuh dashboard 中可见
- [ ] 已移交 `tenant_admin`；按需创建 `customer_viewer` 账户
- [ ] 已对 `soctalk_tenant_adapter_heartbeat_age_seconds` 配置心跳告警
- [ ] 已将计划中的渗透测试声明为 engagement 窗口

## 深入阅读

- [租户生命周期](/zh-cn/tenant-lifecycle) ——状态机、阶段、恢复路径
- [Wazuh 代理入口](/zh-cn/reference/wazuh-ingress) ——边缘拓扑、证书、吊销
- [用户与角色](/zh-cn/users-and-roles) ——完整角色目录与受众墙
- [日常运维](/zh-cn/operations) ——上述所有内容的运维手册视角
- [Launchpad](/zh-cn/launchpad) ——在约 15–25 分钟的多虚拟机试点中演练整个流程
