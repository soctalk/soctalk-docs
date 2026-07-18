# 故障排查

症状 → 诊断 → 修复。针对最常见故障模式的运维手册。

| 症状 | 首先检查 | 修复 |
|---|---|---|
| `helm install soctalk-system` 在 pre-install 钩子中失败 | `kubectl logs -n soctalk-system job/<release>-preinstall-check` | 按照[安装](/zh-cn/install#cluster-prerequisites)指南安装缺失的集群前置组件（CNI、cert-manager、StorageClass） |
| API pod 启动时出现 `CrashLoopBackOff` | `kubectl logs -n soctalk-system deploy/soctalk-system-api` | 最常见原因：`DATABASE_URL` Secret 错误、Postgres 尚未就绪，或 Alembic 迁移失败。请先检查 Postgres pod |
| `helm install` 成功但 MSSP UI 返回 502 | Ingress 控制器日志；确认 ingress Service 的 `endpoints` 已填充 | OIDC 代理未部署或未注入受信任的请求头。请检查受信任代理的 CIDR |
| 创建租户返回 500 | API 日志显示 `ProvisionError` | 通常是 `helm install tenant-*` 失败。请检查 `helm status tenant-<slug>`。最常见的是命名空间和资源配额问题 |
| 租户卡在 `provisioning` 超过 15 分钟 | `kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp` | 参见运维文档中的[租户卡在预配阶段](/zh-cn/operations#tenant-stuck-in-provisioning) |
| 租户进入 `degraded` 状态 | 租户命名空间中的适配器日志 | NetworkPolicy 出站规则、适配器 pod 崩溃，或 DNS 解析错误 |
| 出现跨租户数据可见 | 运行隔离测试套件 | **P1 事件。** RLS 是最后一道防线；一旦失效，说明存在应用层 bug 或 Postgres 角色配置错误 |
| 某个租户的 LLM 调用失败 | Worker 日志：查找来自 LLM 提供方的 401/403 | runs-worker 从 `tenant-<slug>` 命名空间中的 `Secret/tenant-llm-key` 读取密钥。权威来源是 Postgres 中的 `IntegrationConfig.llm_api_key_plain`——通过 `PATCH /api/mssp/tenants/{id}/llm`（UI：租户详情 → Settings → LLM）轮换，该操作会重写 Secret 并重启 runs-worker |
| Wazuh agent 无法连接 | 从 agent 主机可达租户的 LB IP（或边缘 HAProxy 的 IP+端口）；`<slug>.soc.mssp.*` 的 DNS 解析指向它；1514/1515 在任何中间防火墙上均已开放 | 参见 [Wazuh Ingress](/zh-cn/reference/wazuh-ingress)。1514 是 Wazuh 的专有协议——没有可供检查的 SNI；路由按目标地址或端口进行。请确认 agent 所指向的地址正是该租户的 `Service`（`type: LoadBalancer` 或 HAProxy 端口） |
| Postgres StatefulSet 无法启动（PVC Pending） | `kubectl describe pvc -n soctalk-system` | 没有默认 StorageClass、该 class 不支持 RWO，或集群磁盘空间不足 |
| ingress 控制器发出 `PolicyViolation` 消息 | NetworkPolicy 允许规则 | 确保 ingress 命名空间已标记为 `kubernetes.io/metadata.name=ingress-system` |
| Cilium Hubble 显示租户与 `soctalk-system` 之间存在 DROPPED 流量 | NetworkPolicies + Cilium 身份 | 适配器出站策略缺失或 `namespaceSelector` 错误 |
| 客户用户登录时在 `/api/tenant/*` 上返回 403 | JWT 声明 | 确保该用户行已设置 `tenant_id` 且 `role=customer_viewer` |
| MSSP 用户的模拟操作未出现在客户审计中 | 审计查询 | 确认写入时已填充 `acting_as` 列；客户审计视图的连接条件为 `tenant_id = own AND acting_as IS NOT NULL` |
| 隔离测试在 CI 中失败（FORCE RLS 下管理员仍能看到行） | 迁移是否已应用？ | 重新运行 `alembic upgrade head`；确保每个租户范围的表都已应用 `FORCE ROW LEVEL SECURITY` |
| 租户的 `soctalk-adapter` / `soctalk-runs-worker` 出现 ImagePullBackOff | `kubectl -n tenant-<slug> describe pod` 显示无法拉取 `ghcr.io/soctalk/soctalk-adapter:0.1.13-fixes`（或类似镜像） | 已知问题：`render.py` 默认使用的标签可能不在公共 ghcr 中。安装时覆盖：在 `soctalk-system` 的 values 中设置 `tenantProvisioning.adapterImageTag: latest` 和 `tenantProvisioning.runsWorkerImageTag: latest`。这些会渲染到 API Deployment 上的 `SOCTALK_TENANT_ADAPTER_IMAGE_TAG` / `SOCTALK_TENANT_RUNS_WORKER_IMAGE_TAG` 环境变量，供预配渲染读取 |

## 收集诊断数据包

在向支持团队升级问题时，请收集：

```bash
# SocTalk 系统级状态
kubectl get all,events,networkpolicies,resourcequotas \
  -n soctalk-system -o yaml > soctalk-system.yaml
kubectl -n soctalk-system logs deploy/soctalk-system-api --tail=500 > api.log
# （V1 chart 将编排器打包进 API pod——没有单独的 Deployment）

# 特定租户
kubectl get all,events,networkpolicies,resourcequotas,limitranges \
  -n tenant-<slug> -o yaml > tenant.yaml
kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=500 > adapter.log

# Helm 状态
helm status -n soctalk-system soctalk-system > helm-system.txt
helm status -n tenant-<slug> tenant-<slug> > helm-tenant.txt

# 该租户的 SocTalk 版本 + 生命周期事件
# soctalk-cli debug-bundle 曾在早期草稿中记录过；尚未实现。
# 请通过上面的 kubectl/helm 步骤手动采集数据。

tar czf soctalk-debug-$(date +%s).tgz *.yaml *.log *.txt
```

**在向外部分享前，请检查该 tarball 是否包含客户数据。** 日志中可能包含告警片段。
