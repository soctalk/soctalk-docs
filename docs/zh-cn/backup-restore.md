# 备份与恢复

MSSP 备份什么、多久备份一次，以及如何恢复。SocTalk 保存三层状态；每一层都有各自的备份与恢复路径。

本页对 [日常运维 — 数据库恢复](/zh-cn/operations#database-restore-disaster-recovery) 做了扩展，两者是同一套流程，只是运维页以运行手册（runbook）的粒度记录。用本页来规划策略；用运维页来对照具体操作命令。

## 备份哪些内容

### 1. Postgres（控制平面）

`soctalk-system-postgres-0` 保存：

- 租户行 + 生命周期事件
- 用户、会话、角色
- 调查、案例、运行记录、提案
- 设置（LLM、集成、品牌）
- 仅追加的 `audit_log` 和事件溯源的 `case_events`
- 待执行器消费的 outbox 行

**丢失容忍度：零**。丢失 Postgres = 丢失审计历史，且没有可恢复的调查。

### 2. `soctalk-system` 中的 Kubernetes Secret

| Secret（chart 渲染后的名称） | 内容 |
|---|---|
| `soctalk-system-llm-api-key` | LLM 提供商 API key（安装范围内的默认值） |
| `soctalk-system-bootstrap-admin` | 初始管理员邮箱 + 密码（若 values 中设置了 `install.bootstrapAdmin.password`） |
| `soctalk-system-jwt-signing-key` | 会话令牌签名密钥 |
| `soctalk-system-adapter-signing-key` | 适配器令牌签名密钥 |
| `soctalk-system-postgres-admin-creds` | Postgres `soctalk_admin`（迁移）凭据 |
| `soctalk-system-postgres-app-creds` | Postgres `soctalk_app`（运行时）凭据 |
| `soctalk-system-postgres-mssp-creds` | Postgres `soctalk_mssp`（跨租户查询）凭据 |
| `soctalk-slack-creds` | Slack 令牌（由环境变量提供；非 chart 渲染） |
| `soctalk-thehive-creds` | TheHive API key（由环境变量提供） |
| `soctalk-cortex-creds` | Cortex API key（由环境变量提供） |

重新生成的 Secret 集合是可恢复的，但进行中的会话会中断，集成凭据需要重新粘贴。

### 3. 各租户的 PVC

对于每个 `tenant-<slug>` 命名空间：

| PVC | 内容 |
|---|---|
| `wazuh-indexer-data` | 所有 Wazuh 告警和事件历史 |
| `wazuh-manager-data` | Wazuh 代理注册信息 + manager 状态 |
| `cortex-data` | Cortex Elasticsearch（若启用了 Cortex） |
| `thehive-data` | TheHive Cassandra（若启用了 TheHive） |

`poc` 配置档的租户使用 `local-path`，它**没有真正的持久化保证**——节点重启可能丢失数据。`persistent` 配置档的租户使用安装时标记为默认的 StorageClass；请按照该 provisioner 的文档进行备份。

## 频率

| 层 | 建议频率 | 保留期 |
|---|---|---|
| Postgres 逻辑备份（`pg_dump`） | 每日 | 30 天 |
| Postgres WAL 归档 | 持续 | 7 天 |
| Kubernetes Secret 快照 | 每周 + 每次轮换时 | 90 天 |
| 各租户 PVC | 与你的客户 SLA 匹配（合规工作通常为每日） | 按合同约定 |

合规客户（PCI、HIPAA、SOC 2）通常要求更长的保留期。请将上表视为下限。

## Postgres 备份

### pg_dump（逻辑备份）

针对运行中的数据库执行，无停机时间。恢复速度比物理备份慢，但压缩效果好且可移植。

```bash
kubectl -n soctalk-system exec soctalk-system-postgres-0 -- \
  pg_dump -U soctalk_app -d soctalk -Fc -Z 9 \
  > soctalk-$(date +%Y%m%d).pgdump
```

将其管道传输到你惯用的异地存储（S3、GCS、Azure Blob）。

### WAL 归档（时间点恢复）

**本次发布未通过 chart 接线。** `soctalk-system` chart 未暴露 `postgres.archiveCommand` value，因此 PITR 需要在 chart 捆绑的 StatefulSet 之外部署 Postgres。有两条路径：

1. **在外部运行 Postgres**（托管的 RDS / Cloud SQL / Azure Database for PostgreSQL）。按照提供商的文档配置 WAL 归档 / PITR。**在 V1 中，将 chart 指向外部 Postgres 尚未通过 values 接线**——chart 会把捆绑 StatefulSet 的连接细节硬编码进角色凭据 Secret。目前这意味着要么运行你自己的 helm overlay 来给 API Deployment 的 `DATABASE_URL` 环境变量打补丁，要么在安装后修改 `soctalk-system-postgres-app-creds` / `-mssp-creds` / `-admin-creds`。`postgres.external` 这个 values 开关已列入路线图。
2. **在你自己的 helm overlay 中使用 Sidecar 归档器**（例如作为 sidecar 的 [`spilo`](https://github.com/zalando/spilo) 或 [`wal-g`](https://github.com/wal-g/wal-g)）。这不在 chart 的范围内；它作为独立的 Deployment 运行，将 WAL 流式传输到对象存储。

无论哪种方式，SocTalk 一侧都保持不变——数据平面将 Postgres 视为外部依赖。在 chart 一侧接线 `archiveCommand` 已列入未来发布的跟踪计划。

## 恢复（Postgres）

参见 [运行手册](/zh-cn/operations#database-restore-disaster-recovery)。概要：

1. 将 API 缩容到零，使得没有任何东西在写入（V1 chart 将编排器捆绑进 API pod——单个 Deployment）。
2. 对转储执行 `pg_restore`（先清空数据库）。
3. 若使用 WAL：将 WAL 回放到期望的时间点。
4. 将 API 重新扩容。

恢复后，API pod（在 V1 chart 中内嵌了编排器）可能需要踢一下才能重新拾取待处理的运行：

```bash
kubectl -n soctalk-system rollout restart deploy soctalk-system-api
```

## Secret 备份

由于涉及密钥材料，K8s Secret 很难安全地备份。有两种模式：

### Sealed Secrets（推荐）

每个集群安装一次 [Bitnami sealed-secrets](https://github.com/bitnami-labs/sealed-secrets)。将你的 Secret 转换为 `SealedSecret` 资源；把它们提交到 git。集群的控制器会在安装时对其解密。丢失某个 Secret 可从 git 恢复。

### 搭配 restic / kopia 的 Velero

[Velero](https://velero.io) 会将 Kubernetes 资源（包括 Secret）以及 PVC 备份到对象存储。对 PVC 使用 [in-tree CSI 快照器](https://velero.io/docs/main/csi/)，对 Secret 使用标准的资源备份。

```bash
velero backup create soctalk-system-daily \
  --include-namespaces soctalk-system \
  --snapshot-volumes \
  --schedule "0 2 * * *"
```

## 各租户 PVC 备份

`persistent` 配置档的租户使用真实的 StorageClass；请使用该 provisioner 的快照工具：

- **Longhorn**：内置的定时备份到 S3
- **Rook/Ceph**：RBD 快照或 `cephfs-mirror`
- **CSI 云卷（EBS/Persistent Disk/Azure Disk）**：原生快照 API

对于 Velero 用户，`velero backup create tenant-<slug>-daily --include-namespaces tenant-<slug> --snapshot-volumes` 可一次性覆盖 PVC 和 K8s 对象。

## 各租户恢复

1. 下线现有租户（若有）——这会删除命名空间。
2. 从快照将 PVC 恢复到一个全新的命名空间。
3. 通过 `POST /api/mssp/tenants/onboard` 使用相同的 slug 和配置档接入一个租户——provisioning 在命名空间层面是幂等的，因此 Helm 安装会采纳恢复后的 PVC。
4. 验证 Wazuh 能看到现有代理（若 PVC 恢复干净，则无需重新注册）。

如果只有数据平面损坏（而 SocTalk 控制平面完好），更简单的路径是先执行 `helm rollback tenant-<slug>`，然后就地恢复 PVC。

## 恢复演练

每季度进行一次恢复演练。选择一个非生产集群或一个临时静默的租户。将时长限定在 4 小时。记录失败之处并更新本页。

演练能发现的常见故障：

- WAL 缺口（节点故障期间归档落后了）
- 自上次备份以来已轮换的 Secret
- 集群与快照之间的 StorageClass 不匹配
- 网络策略阻止了恢复后的 pod 连接到新的 Postgres

## 本页未涵盖的内容

- 集群范围的灾难恢复（控制平面节点丢失等）——那属于 Kubernetes 运维，并非 SocTalk 特有。请参见你所用发行版的文档。
- LLM 提供商凭据恢复——不在范围内；用你常规的密钥轮换运行手册来管理。
- 客户侧端点备份——那是客户的责任，而非 MSSP 的责任。
