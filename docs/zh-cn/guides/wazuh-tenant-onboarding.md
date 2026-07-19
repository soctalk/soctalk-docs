---
description: "Wazuh MSSP 客户上线全流程：预配隔离的租户 SOC、注册代理、分发访问权限，并为第一周运营建立基线。"
---

# 将客户租户接入多租户 Wazuh SOC：MSSP 检查清单

将客户"上线"到多租户 Wazuh 服务可拆解为四项工作：为每个客户预配一套隔离的独立栈、把客户的代理注册到*他们自己*的 manager 而不是其他任何租户的、分发符合 MSSP/客户边界的访问权限，以及为运营的第一周建立基线。本指南在 SocTalk 上走完整条路径。在 SocTalk 中，每个客户都在自己的 Kubernetes 命名空间里拥有专属的 Wazuh manager、indexer 和 dashboard，统一置于一个 MSSP 控制平面之后。

## 点击 New Tenant 之前要做的决定

**Profile。**Profile 在上线时即固定，之后想切换只能先下线再重建。请先决定：

- `poc`：用于评估和短期试点。使用 `local-path` 存储，没有真正的持久化保证，资源请求较低，不带备份钩子。这也是**未指定时的默认值**；`local-path` 存储不提供持久化保证，因此生产客户需要 `persistent`。
- `persistent`：生产客户 SOC。使用安装环境的默认 StorageClass，资源请求按生产规格设定，若已配置备份钩子则会生效。
- `provided`：客户已自行运行 Wazuh（BYO-SIEM）。SocTalk 只在租户命名空间内安装自己的 adapter 和 runs-worker，通过网络访问客户的 indexer（`:9200`）和 Manager API（`:55000`）。外部连接材料*以及*租户级 LLM 凭据必须在上线时提供；缺失时 API 会返回 422。

**容量规划。**每个 `persistent` 租户按大约 6–8 GB 内存和约 1.5 vCPU 规划；租户级 Wazuh indexer 通常是瓶颈，也决定磁盘用量（默认 50 GB PVC，热数据保留 30 天，目前尚无热→冷分层）。SocTalk 已在 3 节点集群（每节点 16 vCPU / 64 GB）上测试到约 50 个租户；单台主机上超过约 5 个租户的场景应视为未经验证。详见[容量规划](/zh-cn/reference/sizing)。

**租户级 LLM。**分诊运行在租户级 LLM 配置之上：可选 Anthropic 或任何 OpenAI 兼容端点（Azure OpenAI、vLLM、Ollama、LiteLLM）。客户可以自带 API 密钥以实现计费隔离。密钥以 Kubernetes Secret 的形式挂载在其命名空间中，但有一个已在文档中说明的 V1 注意事项：它同时以明文保存在 SocTalk 数据库中（[密钥管理](/zh-cn/reference/secrets)）。你也可以将租户指向完全本地的 Ollama 端点，实现无云端、无按 token 计费的部署形态（需为较慢的 CPU 推理预留时间）。参见 [LLM 提供商](/zh-cn/integrate/llm-providers)。

## 预配：九个有序阶段

从 [MSSP UI](/zh-cn/mssp-ui)（Tenants → **+ New Tenant**）或 API 创建租户。租户随即进入由服务端强制执行的状态机：`pending → provisioning → active`，其后还有 `degraded`、`suspended`、`decommissioning`、`archived` 和 `purged`。非法的状态转换会被拒绝并返回 409。

控制器依次运行九个有序且幂等的阶段，每个阶段都会发出一条生命周期事件，可在租户详情页上查看：预检、租户级密钥生成（`authd`、JWT、Postgres）、命名空间创建（`tenant-<slug>`，附带标签以及与 profile 匹配的 ResourceQuota 和 LimitRange）、密钥应用、`soctalk-tenant` Helm 安装（同时自动预配 `tenant_admin` 用户）、Wazuh chart 安装、就绪轮询、集成配置写入，最后转换到 `active`。

若某个阶段失败，租户会落入 `degraded` 状态，失败步骤记录在事件行中。修复原因（卡住的 PVC、配额不足、镜像拉取失败）后点击 **Retry Provisioning**。重试从阶段 1 重新开始，且每个阶段都是幂等的，因此重跑是安全的。重试只能*从* `degraded` 发起，不能从 `pending` 发起。卡住状态的处理手册见[日常运维](/zh-cn/operations)。

## 代理注册：让端点进入正确的租户

每个租户都有专属 DNS 名称（`acme.soc.mssp.example.com`），解析到租户级 L4 端点，承载 1514/TCP（事件）和 1515/TCP（注册）。路由按目标地址而非 SNI 进行，因为 Wazuh 的 1514 代理协议不是标准 TLS，从不发送 ClientHello。

**V1 注意事项：**chart 只会把 Wazuh manager 的 Service 创建为 `ClusterIP`。**本版本没有自动的 LoadBalancer 或 DNS 预配**。边缘接入需要你自己搭建：手动应用的租户级 LoadBalancer Service、在单一 IP 上按租户分配端口对的边缘 HAProxy，或 mesh-VPN 路径。DNS 记录同样由运维人员自行管理。

注册流程在设计上就是按租户隔离的。获取租户的 `authd` 共享密钥：

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

通过安全渠道把主机名、端口和密钥交给客户的端点管理员；对方执行 `agent-auth -m <hostname> -P "<secret>"`。持有租户 A 密钥的代理只能注册到租户 A 的 manager。专门的 Agents 标签页和代理上线面板已在路线图上；目前请在内嵌的 Wazuh dashboard 中核对代理（Tenants → **Open SOC** → Agents）。完整的拓扑与防火墙要求见 [Wazuh 代理接入](/zh-cn/reference/wazuh-ingress)。

## 人员：谁需要登录账号

预配阶段已经生成了一个 `tenant_admin`。该角色是自助式的：可在客户门户中管理本组织的用户和自己的 LLM 设置。对于需要可见性但绝不应执行操作的干系人，分配 `customer_viewer`：只读的仪表盘和调查，没有审查队列，没有聊天。

每个新建用户都会收到一次性临时密码，仅显示一次，并在首次登录时强制修改。受众墙隔离了两侧：租户角色永远不能持有 MSSP 能力，反之亦然，这在能力守卫处强制执行，因此客户登录在结构上无法触达跨租户界面。本版本没有自助找回密码流程；重置由管理员强制执行。完整目录见[用户与角色](/zh-cn/users-and-roles)。

## 第一周

- **心跳。**在 `/metrics` 上关注 `soctalk_tenant_adapter_heartbeat_age_seconds`。在 V1 中它是唯一持续更新的指标，且*不会*自动将租户状态降级，因此需要你自行对它设置告警。
- **审查队列。**新租户在基线稳定前会产生审查流量；每一次 AI 上报都要在仪表盘队列中等待人工处理；不存在自动批准的旁路。
- **交战窗口。**如果客户排期了渗透测试，请在开始前声明交战窗口（来源、主机、技术、时间），使经授权的活动被标记并留痕审计，而不是被上报。测试人员超出范围的活动仍会强制进入人工审查。
- **暂停/下线基础。**Suspend 只切换数据库状态并停止新的调查，**不会**缩减工作负载；紧急切断是一份手动运行手册。Decommission 会拆除数据平面，保留租户记录及审计历史于 `archived` 状态；目前还没有 `:purge` API 端点。

## 上线检查清单

- [ ] 已选定 profile（生产用 `persistent`；`provided` 需要预先提供 SIEM URL 和 LLM 凭据）
- [ ] 已确认集群余量（每个 `persistent` 租户约 6–8 GB 内存、约 1.5 vCPU）
- [ ] 已确定租户级 LLM（BYO 密钥 / 安装默认 / 本地 Ollama）
- [ ] 租户已创建；生命周期事件已到达 `active`
- [ ] 已手动接好边缘：LB 或边缘代理端点，以及 `<slug>.soc.<domain>` 的 DNS 记录
- [ ] 已获取 `authd` 密钥并通过安全渠道分发
- [ ] 首个代理已注册并可在该租户的 Wazuh dashboard 中看到
- [ ] `tenant_admin` 已交接；按需创建了 `customer_viewer` 账号
- [ ] 已对 `soctalk_tenant_adapter_heartbeat_age_seconds` 配置心跳告警
- [ ] 已将排期中的渗透测试声明为交战窗口

## 深入阅读

- [租户生命周期](/zh-cn/tenant-lifecycle)：状态机、阶段、恢复路径
- [Wazuh 代理接入](/zh-cn/reference/wazuh-ingress)：边缘拓扑、证书、吊销
- [用户与角色](/zh-cn/users-and-roles)：完整角色目录与受众墙
- [日常运维](/zh-cn/operations)：以上一切的运行手册视角
- [Launchpad](/zh-cn/launchpad)：用约 15–25 分钟的多虚拟机试点演练整个流程
