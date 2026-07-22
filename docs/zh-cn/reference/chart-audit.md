# 租户 Helm Chart 审计


> **审计方法论**：本文档记录的是基于 chart 检查得出的预期分类。发布前验证中必须执行实际的 `helm template` 运行，并将结果与分类进行 diff 对比。在真实渲染结果中发现的、此处未列出的任何对象都将成为一道审查门禁。

## 审计范围

待审计的 chart：

| 上游 | 上游来源 | 目标版本 |
|---|---|---|
| Wazuh | `wazuh/wazuh-kubernetes` Helm chart（社区版）或官方 OCI chart | 支持单 manager HA 的最新稳定 4.x |
| linux-ep | SocTalk L2 端点 agent 子 chart（组件键 `components.linuxep`） | `0.2.0` |
| MISP | **推迟到后续版本** | |

`soctalk-tenant` chart 恰好内置（vendor）两个子 chart：`wazuh` 和 `linux-ep`。对于每一个，我们都将其 manifest 模板（如有需要则附带补丁）以子 chart 依赖的形式内置于 `charts/soctalk-tenant/`：版本锁定是严格的。`Chart.yaml` 采用精确 semver，并在可用时（OCI）附带 digest。

TheHive 和 Cortex 是**外部集成**，通过网络访问并按租户配置（参见 /zh-cn/integrate/thehive 与 /zh-cn/integrate/cortex）。它们不是内置的子 chart，因此不在本次 chart 审计的范围内。

## 分类规则

对于每个渲染出的对象，按如下方式分类：

- **NS-OK**：位于 `tenant-<slug>` 内部的命名空间级对象。安全、预期之内。
- **CLUSTER-PREREQ**：集群级对象，必须由 `soctalk-system` chart 一次性安装，或作为 MSSP 集群管理员的职责记录在案。租户 chart 不得为每个租户重复安装这些对象。
- **FORBIDDEN**：即使上游声明了，我们也拒绝在租户 chart 中允许的对象类型或能力（例如授予 Wazuh 特权访问的集群级 `ClusterRoleBinding`）。必须通过补丁移除。
- **PATCH**：保留该对象但对其进行修改（例如去掉 `hostPath` 卷、移除特权 `securityContext`、降低默认资源请求）。

## 各上游 chart 的预期分类

### Wazuh

Wazuh chart 通常渲染出：

| 对象 | 预期分类 | 备注 |
|---|---|---|
| `Deployment` / `StatefulSet`（manager、indexer、dashboard） | NS-OK | 核心栈 Pod |
| `Service`（manager API、indexer、dashboard、agent ingress 1514/1515） | NS-OK | |
| `ConfigMap`（ossec.conf、indexer.yml、dashboard.yml） | NS-OK | |
| `Secret`（管理员密码、双向 TLS 证书） | NS-OK | 在预置时按租户注入 |
| `PersistentVolumeClaim`（indexer 数据、manager 数据） | NS-OK | 大小通过租户 values 设置 |
| `ServiceAccount` | NS-OK | 每租户一个 SA |
| `Role` + `RoleBinding`（如使用领导者选举） | NS-OK | 仅限命名空间级 |
| `NetworkPolicy`（chart 提供） | PATCH | 替换为 SocTalk 渲染的 NP 以保持一致的姿态；不允许上游默认值覆盖 default-deny |
| `StorageClass` 引用 | CLUSTER-PREREQ | MSSP 必须提供动态供给器；`storageClassName` 是一个 values 输入项 |
| `Ingress` | PATCH 或禁用 | Wazuh 在 1514 上的 agent 协议不是标准 TLS，因此 HTTP/HTTPS `Ingress` 并不适用。移除所有 `Ingress` 资源。对于 agent-ingress `Service`，chart 应渲染与 `tenant.wazuhIngress.mode` 相匹配的变体：为每租户 LB IP 渲染 `LoadBalancer` Service（默认），或在安装使用集群内 HAProxy 回退方案时渲染 `ClusterIP` Service。参见 [Wazuh Ingress](/zh-cn/reference/wazuh-ingress)。 |
| `PodSecurityPolicy` / `SecurityContextConstraints` | 存在时为 CLUSTER-PREREQ；否则为 forbidden | PSP 已弃用；如存在则移除。OpenShift SCC 不在本版本范围内 |
| `CustomResourceDefinition` | 在租户 chart 中 **FORBIDDEN** | 如果 chart 试图安装 CRD，则移至 `soctalk-system` chart 或作为前置条件记录在案 |
| `ClusterRole` / `ClusterRoleBinding` | 在租户 chart 中 **FORBIDDEN** | 绝不从租户命名空间安装集群级 RBAC |
| 特权 / host-network / hostPath Pod | **FORBIDDEN**；通过补丁移除 | Wazuh manager 在标准运行中不需要这些；indexer 同样不需要。如果某个子 chart 需要 `hostPath` 存放日志，则打补丁改为 `emptyDir` + PVC |
| `PodDisruptionBudget` | NS-OK | 可选；取决于 Wazuh HA 模式。单 manager 拓扑可跳过 |

**预期补丁**：
1. 从渲染输出中移除任何 `ClusterRole`/`ClusterRoleBinding`。
2. 移除任何集群级资源（`ValidatingWebhookConfiguration` 等）。
3. 渲染 agent-ingress `Service` 以匹配 `tenant.wazuhIngress.mode`（为每租户 LB IP 使用 `LoadBalancer`，为集群内 HAProxy 回退方案使用 `ClusterIP`）。
4. 移除 `Ingress` 资源。Wazuh dashboard 通过单独的 SocTalk 托管路径暴露；1514 上的 agent 协议不是 HTTP，因此 K8s `Ingress` 不适用。
5. 确保所有 Pod 都设置了 `securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }`；如上游设置为其他值则打补丁。
6. 将镜像锁定到 digest，而非 `latest`。

### linux-ep

L2 端点 agent 子 chart（`components.linuxep`）。它渲染出的清单很窄：该 chart 仅发出一个 `StatefulSet`，并通过 `secretKeyRef` 消费一个既有 Secret，而非渲染其自身的凭据对象。

| 对象 | 预期分类 | 备注 |
|---|---|---|
| `StatefulSet`（端点 agent） | NS-OK | 该子 chart 渲染的唯一工作负载；命名空间级 |
| `Secret`（注册 / agent 凭据） | 被消费，非渲染 | 通过 `secretKeyRef` 引用；在预置时按租户播种，位于本子 chart 之外 |
| `ClusterRole` / `ClusterRoleBinding` | 在租户 chart 中 **FORBIDDEN** | 绝不从租户命名空间安装集群级 RBAC |

**当前状态与预期补丁**：
1. 该子 chart 默认在 agent pod 上设置 `securityContext.privileged: true`。这是仅用于 PoC 的行为，且是一项真实风险，必须在任何生产使用之前将其收窄（去掉 privileged，设置 `allowPrivilegeEscalation: false`）。
2. 确认渲染输出中不出现 `ClusterRole`/`ClusterRoleBinding`。
3. 将镜像锁定到 digest，而非 `latest`。

### 外部集成（不在审计范围内）

TheHive 和 Cortex 是**外部集成**，而非内置的子 chart，因此不在本次 chart 审计的范围内。SocTalk 按租户通过网络访问它们；不存在需要分类的命名空间内 TheHive/Cortex 对象。请通过 /zh-cn/integrate/thehive 与 /zh-cn/integrate/cortex 配置它们。

## 集群前置条件清单（并入安装指南 + `soctalk-system` chart 前置检查）

审计之后，以下内容**不在租户 chart 范围内**，且必须在 `soctalk-tenant` 应用到任何命名空间之前就存在于集群中：

| 前置条件 | 原因 | 来源 |
|---|---|---|
| K3s 1.30+（或兼容的 K8s 1.30+） | 基线加上 `ValidatingAdmissionPolicy` v1 | MSSP 职责 |
| 强制执行 NP 的 CNI（Cilium 为主，Calico 为备） | 隔离强制执行 | MSSP 职责 |
| cert-manager | Ingress 的 TLS、每租户 Wazuh 证书签发 | MSSP 职责；安装指南提供 `helm install` 配方 |
| Ingress 控制器（K3s 中默认 Traefik，ingress-nginx 常见） | MSSP UI + 客户 UI + 每租户 WebUI 路由 | MSSP 职责 |
| 动态 `StorageClass`（local-path、longhorn、云厂商 CSI 等） | PVC 供给 | MSSP 职责 |
| 若使用 CSI 快照则需 `VolumeSnapshotClass` | 备份/恢复 runbook（仅文档） | 可选 |

`soctalk-system` chart 包含一个预安装钩子（`helm.sh/hook: pre-install`），用于验证：
- 强制执行 NP 的 CNI 处于活动状态（探测 Cilium 或 Calico 标记）
- cert-manager CRD 已存在
- 已设置默认 `StorageClass`

若有任何一项缺失，钩子会快速失败并给出可操作的错误消息。

## 打补丁策略

两条路径：

1. **values 驱动的覆盖**：优先使用上游 chart 中可禁用不需要对象的 values（例如 `ingress.enabled: false`、当上游的策略比我们的更宽松时使用 `networkPolicy.enabled: false`、将 `rbac.create: true` 限定为仅命名空间级）。
2. **Kustomize 风格的 overlay**（Helm 的 `kustomize` 集成或 post-render 钩子），用于无法通过 values 禁用的对象：移除 `ClusterRole`、去掉 `hostPath` 卷、设置 `securityContext`。

我们将上游 chart 作为 `charts/` 下的同级 chart（`charts/wazuh`、`charts/linux-ep`）以相对路径引用，而非作为 `helm repo` 引用（helm 会在构建时将它们复制进包中）。这使我们能够：
- 锁定到精确版本（不会有上游意外更新）
- 按需应用补丁，而不依赖上游 PR 被接受
- 将我们的捆绑包签名为单一制品（cosign 落地后的后续版本）

如果打补丁后上游仍无法满足我们的需求，回退方案是编写 SocTalk 原生模板，用我们自己的 manifest 调用相同的容器镜像。发布前验证针对每个 chart 决定是否采用此方案。

## 已知的未知项（由发布前验证解决）

需要实际 `helm template` 运行 + 检查才能确认的项：

- [ ] **Wazuh**：所选 chart 版本是否需要 CRD 以实现 operator 驱动的部署？如果需要，将 CRD 移至 `soctalk-system` chart。
- [ ] **linux-ep**：端点 agent 是否需要必须被打补丁移除或收窄的主机级访问（hostPath、主机网络）？
- [ ] **所有 chart**：是否有任何 `Job` 或 `CronJob` 使用超出命名空间范围的 `ServiceAccount` 运行？打补丁改为命名空间本地 SA。
- [ ] **所有 chart**：是否有任何 `initContainer` 带有 `privileged: true` 或 `hostPath` 挂载？打补丁或替换。
- [ ] **所有 chart**：默认的 `resources.requests` 和 `limits`：与容量规划配置进行对比；在需要时通过 values 覆盖。

每个未决项都会成为一条发布前验证清单条目。本次 spike 的产出是一张填好的分类表以及维护在 `charts/wazuh` / `charts/linux-ep` 下的已打补丁 chart。

## 输出制品（发货前产出）

本次 spike 产出：

1. **已分类的对象清单**（用实际渲染出的对象填充第 3 节的表格）。
2. **已打补丁的 chart 捆绑包**，以锁定版本维护在 `charts/wazuh/` 和 `charts/linux-ep/` 下。
3. **集群前置条件清单**，并入安装指南。
4. 每个子 chart 的 **values schema 片段**（SocTalk 将按租户提供的输入项）。

本次 spike 的完成是 Helm chart 实现的前置条件。
