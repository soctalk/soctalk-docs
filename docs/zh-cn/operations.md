# 日常运维

MSSP 运维人员针对已上线的 SocTalk 安装执行的任务。如果你尚未阅读，请先阅读 [MSSP UI 导览](/zh-cn/mssp-ui)——它列出了下文引用的每个页面。

## 调查队列

打开 **Investigations** 可在同一视图中查看每个租户的活跃案件。筛选条件：租户、严重程度。点击某一行可查看案件时间线、对话及提案。

![调查列表](/screenshots/investigations-list.png)

## 提案审查队列

**Reviews** 是跨租户的 AI 提案队列，等待人工处理。批准 / 拒绝 / 索取更多信息，都会更新数据库中的审查行（以及审计日志）。V1 中**没有发件箱（outbox）**——执行器 / 下游通知管线已列入路线图。

![审查队列](/screenshots/review-queue.png)

## 租户卡在 `provisioning`

**症状：** 某个新客户的租户行停留在 `provisioning` 状态超过 15 分钟。

1. 检查 Helm 发行版状态：
   ```bash
   helm status tenant-<slug> -n tenant-<slug>
   ```
2. 检查 pod 事件：
   ```bash
   kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp | tail -30
   ```
3. 常见原因：
   - `StorageClass` 缺失或 provisioner 宕机 → PVC 卡在 `Pending`。请配置存储；`kubectl describe pvc` 会显示原因。
   - ResourceQuota 对于 Wazuh indexer 的请求量过小。通过 `helm upgrade` 并使用新的取值来提高该租户的 ResourceQuota。
   - 镜像拉取失败 → 检查镜像仓库认证和防火墙。

如果某次配置尝试无法恢复，请下线并重试：

```bash
# 从 MSSP UI：租户详情 → Decommission → force=true
# 或通过 API：
curl -X POST https://mssp.../api/mssp/tenants/<id>:decommission?force=true
```

## 租户处于 `degraded` 状态

`degraded` 由配置控制器在配置失败时设置，或通过 API 显式设置。**本版本中没有基于适配器心跳时长的自动降级循环**；`soctalk_tenant_adapter_heartbeat_age_seconds` 指标供你自行告警使用。

1. 检查适配器 pod：
   ```bash
   kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=200
   ```
2. 检查 NetworkPolicy 出站（适配器需要访问 `soctalk-system` API）：
   ```bash
   hubble observe --from-pod tenant-<slug>/soctalk-adapter-<pod>
   ```
3. 重启适配器：
   ```bash
   kubectl -n tenant-<slug> rollout restart deploy/soctalk-adapter
   ```

如果数据平面健康但适配器仍无法访问 `soctalk-system`，请检查 `adapter-egress` NetworkPolicy。

## 轮换每租户的 LLM 密钥

1. MSSP 管理员 → 客户详情 → Settings → LLM → 粘贴新密钥 → Save（或 `PATCH /api/mssp/tenants/{id}/llm`）。
2. SocTalk 的权威存储是 Postgres 中的 `IntegrationConfig.llm_api_key_plain`。配置控制器会将该值物化到租户命名空间中的 `Secret/tenant-llm-key`（由 runs-worker Deployment 挂载），并可选择将一个引用镜像到 `soctalk-system/<tenant-id>-llm` 以供审计。
3. SocTalk 会尽力（best-effort）重启 `tenant-<slug>` 中的 `soctalk-runs-worker` Deployment，使新密钥在下一次调查取用时生效。

## 轮换数据平面引导密钥

本版本中没有 `soctalk-cli rotate-*` 命令——该路径见于早期草稿。当前做法：

- **Wazuh 管理员密码：** 修补（patch）租户命名空间中相应的 Secret，然后重启受影响的 pod。chart 在 pod 启动时的引导重跑会拾取新凭据。TheHive 和 Cortex 是外部集成，而非捆绑的子 chart，因此它们的凭据在各自系统中轮换，并通过集成配置更新（参见 /zh-cn/integrate/thehive、/zh-cn/integrate/cortex）。
- **Wazuh `authd` 共享密钥：** 修补 `tenant-<slug>` 中的 `Secret/wazuh-authd-secret`，重启 Wazuh manager。所有现有 agent 必须使用新密钥重新注册；请通过你惯常的安全渠道分发。

用于这些轮换的封装 CLI 已列入路线图。

## 分析

**Analytics** 按租户汇总分诊量、提案结果、MTTR 及预算消耗。可用于容量规划、模型评估及 SLA 审查。

![分析](/screenshots/analytics.png)

## 审计日志审查

MSSP 范围的审计日志位于 **UI → Audit 选项卡**。可按租户、执行者、操作或时间戳筛选。若需合规导出，请使用 API：

```bash
curl 'https://mssp.../api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

![审计日志](/screenshots/audit-log.png)

## 数据库恢复（灾难恢复）

备份由 MSSP 在外部管理（Velero、集群快照、外部 `pg_dump`）。恢复步骤：

1. 停止 SocTalk API：
   ```bash
   kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=0
   ```
   （V1 chart 将编排器捆绑在 API pod 中——没有单独的 `soctalk-system-orchestrator` Deployment。）
2. 从你的备份恢复 Postgres 数据。
3. 重启 API：`kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=2`（或你惯用的副本数）。

租户数据平面的 PVC 遵循相同模式：按命名空间恢复，然后 `helm upgrade` 租户发行版以重新挂载。

## 紧急情况：立即禁用某个租户

本版本中，UI 的 **Suspend** 操作会将租户状态翻转为 `suspended`，并阻止编排器调度新的调查——**但它不会缩减工作负载**。若要真正切断，请执行以下步骤（缩减所有 deployment，并作为双保险应用一条 deny-all NetworkPolicy）：

```bash
# 1. 将租户命名空间中的所有工作负载缩减到零。这是
#    决定性的停止——pod 会消失。
kubectl -n tenant-<slug> get deploy,statefulset -o name \
  | xargs -I {} kubectl -n tenant-<slug> scale {} --replicas=0

# 2. 双保险的 deny-all，以便任何重新起来的东西（例如，
#    来自卡住的 operator 的协调）都被沙箱隔离。
kubectl -n tenant-<slug> apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: emergency-deny-all }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
EOF
```

要恢复，请删除该 NetworkPolicy，将工作负载扩容回其原始副本数，并在 UI 中调用 **Resume**。本版本中 **Resume** 同样只更新数据库状态——它不会为你恢复副本数。

## 疑似跨租户数据泄露

如果你怀疑存在跨租户访问：

1. 检查最近的 RLS 测试套件运行；它们在每个版本的 CI 中都通过。
2. 直接探查数据库：
   ```bash
   kubectl -n soctalk-system exec -it statefulset/soctalk-system-postgres -- \
     psql -U soctalk_app -d soctalk \
     -c "SET app.current_tenant_id='<tenant-a>'; SELECT tenant_id FROM events LIMIT 5;"
   ```
3. 如果确认存在泄露，请提交 P1 事件工单。RLS 加上 `FORCE ROW LEVEL SECURITY` 是最后一道防线；未修补的泄露表明存在应用程序 bug 或 Postgres 角色配置错误。

## 常见错误

- 以 `soctalk_app` 身份运行迁移。迁移需要 `soctalk_admin` 凭据；在 `soctalk_app` 下会失败。
- 直接在 Helm 中编辑 `soctalk-tenant` 取值。这会绕过 SocTalk 的数据库状态；请通过 API 操作。
- 手动创建 `tenant-*` 命名空间。所需的标签不会存在，SocTalk 也不会识别该命名空间。请使用租户创建流程。
