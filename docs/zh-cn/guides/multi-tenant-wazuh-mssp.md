---
title: "面向 MSSP 的多租户 Wazuh：真正隔离租户的架构模式"
description: "MSSP 如何运行多租户 Wazuh：Kubernetes 上的每租户独立 manager、Postgres RLS、网络隔离、代理注册，以及每租户容量规划。"
---

# 面向 MSSP 的多租户 Wazuh：真正隔离租户的架构模式

Wazuh 没有原生的多租户能力。manager 中没有“租户”对象，规则集中没有按客户划分的边界，`authd` 注册也没有按客户的作用域限制。每一家以 Wazuh 为标准的 MSSP 最终都要在它之外自行构建租户体系，而你选择的模式决定了隔离保证、上线速度和每客户的成本下限。

本指南介绍 MSSP 对多租户 Wazuh 部署的实际需求、团队在实践中尝试的三种模式，以及在 SIEM 之外实现生产级隔离还需要什么。这正是 SocTalk 以开源形式（Apache 2.0）实现的架构；文中链接的参考页面会对每一层做更深入的说明。

## MSSP 需要而 Wazuh 不提供的能力

每一次 MSSP 部署讨论都会出现三个需求：

1. **能在客户安全审查中站得住脚的隔离。** 仅靠仪表盘过滤器无法让任何人信服；“客户 A 无法读取客户 B 的告警”必须在数据层、网络层和代理注册层同时成立。
2. **上线速度。** 如果为新客户开通一个 SOC 需要一周的手工操作，这个模式撑不过少数几个客户的规模。
3. **每租户成本控制。** 你需要知道一个客户在 RAM、CPU 和磁盘上的开销，为其设置上限，并阻止一个高噪声租户挤占其他租户的资源。

## MSSP 尝试的三种模式

### 模式一：共享 manager，索引级分离

一个 Wazuh manager，所有客户的代理都注册到它上面，分离在下游完成：用 OpenSearch Dashboards 的多租户功能隔离仪表盘对象，用索引模式和安全角色限定读取范围。这是大多数 Wazuh 多租户讨论帖描述的模式，因为它是唯一不用离开 Wazuh 自带工具就能搭建的方案。

问题在于，这种分离发生在读取时，并没有在数据周围划出边界。manager 本身是共享的：一套规则集、一个 `authd` 密钥、一个 API、所有客户共用一个升级窗口。一个配置错误的角色会同时暴露所有客户，而按客户定制规则包或保留策略在不影响其他客户的前提下根本无法实现。

### 模式二：VM 上的每租户独立 manager

每个客户一台 VM（或一组 VM），运行专属的 manager 和 indexer。隔离是真实的：独立的进程、磁盘和凭据。这是 MSSP 在共享 manager 模式吃过亏之后的落脚点。代价在运维上：上线意味着开通机器，升级意味着逐台处理每个 VM，而每租户的资源下限是一整台 VM，没有共享调度来回收闲置容量。5 个客户时还能运转，到 30 个客户就很痛苦了。

### 模式三：Kubernetes 上的每租户独立 manager，置于控制平面之后

每个客户在自己的 Kubernetes 命名空间中获得专属的 Wazuh manager、indexer 和仪表盘，并由 ResourceQuota 和 LimitRange 限制其资源占用。控制平面负责整个生命周期：上线时为每个租户渲染一个 Helm release，下线时将其移除，租户状态保存在数据库而不是电子表格里。隔离来自命名空间边界加 NetworkPolicy；密度来自调度器将租户打包到共享节点上。

### 三种模式的对比

| | 共享 manager + 索引分离 | VM 上的每租户 manager | Kubernetes 上的每租户 manager |
|---|---|---|---|
| 隔离边界 | 共享数据上的读取侧过滤 | 机器边界 | 命名空间 + NetworkPolicy + 配额 |
| 单次失陷的影响范围 | 所有客户 | 单个客户 | 单个客户 |
| 按租户的规则/保留策略/升级 | 不支持 | 支持 | 支持 |
| 客户上线 | 快（改配置） | 慢（开通机器） | 快，前提是已自动化（Helm release） |
| 密度/每租户成本 | 最优 | 最差 | 良好（调度器打包、配额封顶） |
| 所需运维技能 | Wazuh + OpenSearch 安全 | 机群/VM 自动化 | Kubernetes |
| 30 个以上租户的机群运维 | 不适用（单一栈） | 痛苦 | 有控制平面时可行 |

三种模式中，模式三是唯一为同时实现真实隔离和上线速度而构建的，但前提是控制平面必须存在。仅有命名空间不过是一种命名约定；安全边界必须在其之上构建出来。本指南的其余部分讲的就是如何让这个边界真正成立。

## 生产级隔离不止于 SIEM

每租户独立的 Wazuh 栈隔离的是 SIEM 数据。MSSP 平台还有跨租户的状态，从案例和审查队列到审计日志和集成配置，这一层需要自己的强制隔离机制。

### 数据层：Postgres 行级安全，强制执行并有测试覆盖

如果依赖应用层的 `WHERE tenant_id = ?` 过滤，一个被遗漏的条件就会把数据泄露到其他租户。应该由数据库自身来强制执行租户隔离。具体模式如下：

- 每张租户作用域的表都带有以每事务 `app.current_tenant_id` 设置为键的 RLS 策略。上下文未设置时返回**零行**；失败形态是空结果，绝不会是另一个租户的数据。
- 在每张租户作用域的表上启用 `FORCE ROW LEVEL SECURITY`，使表所有者（迁移角色）也受策略约束。Postgres 默认豁免所有者；否则一个读取租户数据的迁移可能悄无声息地跨越租户。
- 三角色划分：一个迁移所有者角色、一个受 RLS 约束的运行时角色，以及一个专用于经审计的跨租户路径的独立 `BYPASSRLS` 角色。没有任何应用以超级用户身份连接。
- CI 中的隔离测试：端点探测、以应用角色执行的原生 SQL、无上下文的 worker、所有者角色探测、跨租户事件流。SocTalk 运行七项这样的测试，全部必须通过；没有一项是可选的。
- 幂等键以 `UNIQUE (tenant_id, idempotency_key)` 限定作用域，这样两个客户的告警管道即使发出相同的外部告警 ID 也不会冲突。

完整的策略模板、角色 DDL 和测试套件见：[Postgres RLS](/zh-cn/reference/postgres-rls)。

### 网络层：按命名空间的 NetworkPolicy

没有能强制执行策略的 CNI，命名空间边界毫无意义；K3s 默认的 Flannel 完全不执行 NetworkPolicy。目标姿态是每个租户命名空间默认拒绝，再显式放行：命名空间内部流量、DNS、控制平面对该租户数据平面端口的访问，以及 1514/1515 上的代理入站流量。租户之间的流量和租户的一般出站流量均被阻断。

SocTalk 以 Cilium 作为受支持的 CNI（NetworkPolicy 强制执行、面向以主机名寻址的 LLM 端点的基于 FQDN 的出站控制、用于排查隔离问题的 Hubble 流量可观测性）。请注意 V1 的保留说明：完全按 FQDN 固定的每租户出站白名单是设计目标，当前 chart 渲染的是更简单的策略，控制平面出站较为宽松，且每租户 worker 拥有较宽泛的 TCP/443 出站权限。已渲染的模板在仓库中；关于已交付的策略和目标架构，请阅读 [NetworkPolicy 设计](/zh-cn/reference/network-policy)。

### 代理注册：按租户的端点和密钥

最隐蔽的失败形态是：客户 A 的代理注册到了客户 B 的 manager 上。Wazuh 代理协议在 1514/TCP 上是私有的加密流，而不是标准 TLS。没有可供路由的 SNI，因此依赖主机名检查的 L4 代理会静默失效。路由必须基于目标地址：每个租户获得自己的 DNS 名称（`acme.soc.mssp.example.com`），解析到一个每租户的 L4 端点，在 IP 稀缺时以每租户端口作为后备方案。

注册密钥按租户限定作用域：每个租户的 `authd` 共享密钥保存在该租户自己的命名空间中，因此持有租户 A 密钥的代理只能注册到 A 的 manager：寻址把它路由到那里，manager 再校验密钥。在 V1 中，LoadBalancer 和 DNS 的开通是 MSSP 的手工配置，尚未自动化。细节和注册操作手册见：[Wazuh 代理入站](/zh-cn/reference/wazuh-ingress)。

## 容量：一个租户的开销

MSSP 最先问的数字，来自 SocTalk 的容量规划工作：

- **每租户资源占用（完整栈）：** 约 8 GB RAM 请求量（约 16 GB 上限）、约 2.2 vCPU 请求量、约 120 GB 磁盘。持续使用量与请求量相当；上限是突发峰值的天花板。
- **瓶颈通常是每租户的 Wazuh indexer。** 每个 indexer 都是带独立堆内存的 Java 进程。每个生产租户按约 6 至 8 GB RAM 和约 1.5 vCPU 规划。
- **磁盘由摄入速率决定：** 在持续每秒 10 条告警时，索引大约每天增长 5 GB；indexer 的默认 PVC 为 50 GB，热数据保留 30 天。
- **经过测试的规模：** 在 3 节点集群（每节点 16 vCPU / 64 GB）上最多约 50 个租户。更大的单安装规格有文档记录，但未在本版本中验证；未经测试不要在单个安装上规划超过这个数字。

参考主机规格和每节点最大租户数的计算公式见：[容量规划](/zh-cn/reference/sizing)和[扩展性 FAQ](/zh-cn/faq#does-it-scale-to-n-customers)。

## SocTalk 如何将这一模式产品化

SocTalk 是模式三的开源实现（Apache 2.0，无社区版/企业版之分）：一个控制平面，每个客户一个 `soctalk-tenant` Helm release，运行在你自己的 Kubernetes 1.30+ 上，无论是 K3s、EKS、AKS 还是 GKE。

```mermaid
flowchart TB
    subgraph cp["soctalk-system namespace (control plane)"]
        api["API + orchestrator"]
        ctrl["Provisioning controller"]
        pg[("Postgres: RLS, FORCE, 3 roles")]
        api --> pg
        ctrl --> pg
    end
    subgraph ta["tenant-acme namespace"]
        ma["Wazuh manager"]
        ia["Wazuh indexer"]
        wa["runs-worker + adapter"]
    end
    subgraph tb["tenant-beta namespace"]
        mb["Wazuh manager"]
        ib["Wazuh indexer"]
        wb["runs-worker + adapter"]
    end
    ctrl -- "Helm: soctalk-tenant" --> ta
    ctrl -- "Helm: soctalk-tenant" --> tb
    agA["Customer A agents"] -- "acme.soc.mssp.example.com : 1514/1515" --> ma
    agB["Customer B agents"] -- "beta.soc.mssp.example.com : 1514/1515" --> mb
```

上线流程执行一个九阶段的开通序列（预检、密钥生成、带配额的命名空间创建、Helm 安装、就绪状态轮询），每个阶段都会发出生命周期事件，并可从 `degraded` 状态幂等重试。租户状态是服务端强制执行的状态机（`pending → provisioning → active`，另有 suspended、decommissioning、archived 和 purged 状态；非法转换返回 409）。三种上线规格分别覆盖演示（`poc`）、生产（`persistent`）和 BYO-Wazuh（`provided`，即 SocTalk 连接到客户已有的栈而不是部署新栈）。下线会拆除数据平面，但保留租户记录和审计历史。

从状态、阶段到配额和恢复路径的完整生命周期见[租户生命周期](/zh-cn/tenant-lifecycle)。实际运行：[安装指南](/zh-cn/install)介绍如何在大约一小时内搭建生产集群，[演示 VM](/zh-cn/quickstart-vm) 可在大约五分钟内启动一个带演示租户的可用多租户安装。
