# 升级

两类 chart 均通过 `helm upgrade` 升级。目前这是一份操作手册；面向整个租户机群的升级 API 已列入路线图。

## 预检清单

在任何升级之前：

1. **阅读目标版本的[发行说明](https://github.com/soctalk/soctalk/releases)**。迁移是仅向前的；意外的 schema 变更无法通过 `helm rollback` 回退。
2. **先升级 `soctalk-system`，再升级各租户。** 正式的兼容性矩阵界面（System → Versions UI、`controller.can_upgrade` 校验）在 [Chart Contract](/zh-cn/reference/chart-contract) 中被描述为架构目标，但**在本版本中尚未实现**。在其交付之前，请遵循发行说明中的“已测试组合”一行，先升级 `soctalk-system`，在你验证完系统侧升级后，再逐个提升各租户版本。
3. **备份。** 对 Postgres 及所有租户 PVC 做快照。参见运维文档中的[数据库恢复章节](/zh-cn/operations#database-restore-disaster-recovery)。
4. 使用 `helm diff` 进行**试运行**：
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## 升级 `soctalk-system`（安装级）

安装时生成的 `soctalk-system-values.yaml` 将 `image.tag` 固定为最初的发行版本。在每次升级时都要覆盖它，以便新 chart 渲染出新镜像。你可以在版本控制中提升该文件的值，也可以在下方每条命令中传入 `--set image.tag=<new-version>`。

迁移在 API pod 的 init 命令内运行（参见 [Install → Migrations and bootstrap](/zh-cn/install#migrations-and-bootstrap-run-automatically)）。`helm upgrade` 会滚动更新 API pod；init 命令会在新应用启动前运行 `alembic upgrade head`。Alembic 是幂等的——对当前 schema 重复运行是一个无操作。

```bash
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 15m
```

观察迁移过程：

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

如果 `--wait` 卡住，最常见的原因是迁移失败——请查看 init 日志。

### 回滚

```bash
helm rollback soctalk-system <revision> -n soctalk-system --wait
```

如果本次升级引入了触及数据的迁移，`helm rollback` 不会回退 schema。此时还需从升级前的备份中恢复 Postgres。

## 升级单个租户的数据平面

```bash
helm upgrade tenant-<slug> oci://ghcr.io/soctalk/charts/soctalk-tenant \
  --version <new-tenant-chart-version> \
  --namespace tenant-<slug> \
  -f /tmp/tenant-<slug>-values.yaml \
  --wait --timeout 15m
```

`/tmp/tenant-<slug>-values.yaml` 是由 SocTalk 渲染的 values 文件。目前没有面向操作员的 CLI 可以导出它；请从该租户的 Helm release secret 中拉取上一次渲染的 values：

```bash
helm get values tenant-<slug> -n tenant-<slug> -a > /tmp/tenant-<slug>-values.yaml
```

本指南此前曾提到过 `soctalk-cli render-values` 命令，但它并不存在——目前唯一的 CLI 工具是 `soctalk-auth`。

### 单租户回滚

```bash
helm rollback tenant-<slug> <revision> -n tenant-<slug> --wait
```

租户数据平面的回滚比系统级回滚更安全：OSS 技术栈（Wazuh、TheHive、Cortex）将各自的数据存储在 PVC 中，而 `helm rollback` 不会触及这些 PVC。

## 机群升级（手动循环）

```bash
# 列出各租户。
kubectl get ns -l tenant=true,managed-by=soctalk \
  -o jsonpath='{.items[*].metadata.name}'

# 逐个升级，中间暂停。
for ns in tenant-acme tenant-beta tenant-gamma; do
  echo "upgrading $ns..."
  helm upgrade ${ns} oci://ghcr.io/soctalk/charts/soctalk-tenant \
    --version <new> -n $ns -f /tmp/${ns}-values.yaml --wait --timeout 15m
  kubectl -n $ns rollout status deploy/soctalk-adapter
  sleep 60   # 在进入下一个之前，让心跳稳定下来。
done
```

未来的某个版本将用一个具备金丝雀感知能力的机群升级 API 取代这个循环。

## 升级顺序

1. 集群前置组件（CNI、cert-manager、ingress）。独立更新这些组件。
2. `soctalk-system` chart。作为安装级升级的一部分运行迁移。
3. `soctalk-tenant` chart，一次一个租户，注意观察是否出现回归。

切勿在 `soctalk-system` 之前升级租户 chart。兼容性矩阵会拒绝超出范围的组合，且 API 会拒绝在版本不匹配的情况下为新租户做资源置备。

## 破坏性变更的租户 chart 升级

如果租户 chart 提升了 Wazuh、TheHive 或 Cortex 的主版本并伴随 schema 变更：

1. 先对租户 PVC 做快照。
2. 在低流量时段进行升级。
3. 升级完成后立即验证告警端到端地正常流转。
4. 一旦数据平面的 schema 迁移过程失败，要做好 `helm rollback` 并恢复 PVC 的准备。

上游 OSS 项目偶尔会发布破坏性变更。[chart 审计](/zh-cn/reference/chart-audit)固定了各子 chart 的精确版本；提升这些版本是显式操作，并会在发布前经过测试。
