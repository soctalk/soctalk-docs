# 试点安装的容量规划配置

## 参考配置

本版本提供两种参考主机规格。

### small-dev

适用场景：开发、演示、单租户 POC。

| 资源 | 数值 |
|---|---|
| CPU | 4 vCPU |
| RAM | 16 GB |
| 磁盘 | 100 GB SSD |
| 最大租户数 | **1–2** |
| SocTalk 控制平面预留 | ~2 GB RAM，1 vCPU |
| 每租户预算 | ~6–8 GB RAM，1–1.5 vCPU |

此规格下启动时间较慢；适用 `<30 min to OSS stack healthy` SLO。

### pilot-prod

适用场景：面向真实试点客户的 MSSP，3–5 个租户。

| 资源 | 数值 |
|---|---|
| CPU | 8 vCPU |
| RAM | 32 GB |
| 磁盘 | 500 GB SSD |
| 最大租户数 | **3–5** |
| SocTalk 控制平面预留 | ~3 GB RAM，1–2 vCPU |
| 每租户预算 | ~5–7 GB RAM，1–1.5 vCPU |

启动时间适用 `<15 min to OSS stack healthy` SLO。

## 每租户资源占用（估算）

这些是租户 chart 中 `ResourceQuota` 与 `LimitRange` 的起点值。预发布验证会测量实际值；实际值将在最终 values 中替换这些估算值。

| 组件 | RAM request | RAM limit | CPU request | CPU limit | 磁盘 (PVC) |
|---|---|---|---|---|---|
| Wazuh manager | 512 MB | 1 GB | 200 m | 500 m | 20 GB |
| Wazuh indexer (OpenSearch fork) | 2 GB (heap 1 GB) | 4 GB (heap 2 GB) | 500 m | 2000 m | 50 GB |
| Wazuh dashboard | 512 MB | 1 GB | 100 m | 500 m | |
| Filebeat | 128 MB | 256 MB | 50 m | 200 m | |
| TheHive | 1 GB | 2 GB | 300 m | 1000 m | |
| Cassandra (TheHive backing) | 2 GB | 4 GB | 500 m | 1500 m | 30 GB |
| Cortex | 768 MB | 1.5 GB | 200 m | 800 m | |
| Cortex ElasticSearch | 1 GB | 2 GB | 300 m | 1000 m | 20 GB |
| SocTalk adapter | 128 MB | 256 MB | 50 m | 200 m | |
| **每租户合计（limits）** | **~8 GB request，~16 GB limit** | | **~2.2 vCPU request，~7.7 vCPU limit** | | **~120 GB** |

注意：limits 是突发上限；持续使用量更接近 requests。在一台 8-vCPU / 32 GB / 500 GB 主机上运行 3 个租户意味着：
- RAM：~24 GB 的 requests（可容纳），~48 GB 的 limits（需要谨慎调优超额分配）。
- CPU：~6.6 vCPU 的 requests（连同控制平面可容纳），突发时共享总量。
- 磁盘：~360 GB 的租户 PVC（可容纳，并为控制平面 + SocTalk 数据库留有余量）。

这就是 `pilot-prod` 将租户数上限设为 5 的原因；超过 5 个后，即便考虑超额分配，内存 limits 也会开始逼近节点容量。

## 每节点最大租户数公式

近似计算：

```
max_tenants = floor((node_total_RAM - control_plane_RAM - safety_margin) / per_tenant_RAM_request)
```

- `control_plane_RAM`：2 GB（small-dev）或 3 GB（pilot-prod），用于 SocTalk + Postgres + ingress 控制器 + Cilium + cert-manager。
- `safety_margin`：节点 RAM 的 10%，用于 K8s 系统 pod、CNI、DNS、监控。
- `per_tenant_RAM_request`：8 GB 基线。

对于 32 GB 的 pilot-prod：`floor((32 - 3 - 3.2) / 8) = floor(25.8 / 8) = 3` 个无需超额分配即可保障的租户。启用超额分配后，在典型告警量下 4–5 个租户是安全的。

## 磁盘容量的主要驱动因素

磁盘消耗的主要来源是 Wazuh indexer（存储已索引的事件）。摄取速率决定增长：

| 告警速率 | 每日索引大小（粗略） | 保留 30 天 | 保留 90 天 |
|---|---|---|---|
| 持续 10 alerts/sec | ~5 GB/day | 150 GB | 450 GB |
| 持续 1 alert/sec | ~500 MB/day | 15 GB | 45 GB |
| 100 alerts/day | ~10 MB/day | 300 MB | 900 MB |

chart 中租户 PVC 大小默认为 Wazuh indexer 的 **50 GB**；MSSP 可针对高流量客户按租户覆盖此值。

保留策略默认在 indexer 中保留 30 天热数据；更早的数据将被删除或归档（尚未实现热→冷分层；后续版本会加入）。

## 容量规划闸门

### 预置检查

当 MSSP 操作员创建新租户时，SocTalk 控制器会运行一次合理性检查：

```
available_RAM = node.allocatable.memory - sum(ns.resourceQuota.requests.memory for ns in existing_tenant_namespaces) - control_plane_reserve
if (new_tenant.resourceQuota.requests.memory > available_RAM):
    refuse with "insufficient cluster capacity for new tenant"
    or
    prompt MSSP: "this will overcommit; proceed? [y/N]"
```

本版本中此闸门较为宽松（仅告警而非硬性失败），因为 MSSP 可能会有意为轻量使用的客户进行超额分配。

### 每租户 LimitRange 强制约束

每个租户命名空间都有一个 `LimitRange`：

```yaml
apiVersion: v1
kind: LimitRange
metadata: { name: tenant-limits, namespace: tenant-acme }
spec:
  limits:
    - type: Container
      default:
        memory: "2Gi"
        cpu: "500m"
      defaultRequest:
        memory: "256Mi"
        cpu: "100m"
      max:
        memory: "6Gi"
        cpu: "2"
```

防止某个配置错误的 pod 请求 30 GB 而使节点资源枯竭。

## 更大规模的配置

已记录但在本版本中尚未验证：

| 配置 | CPU | RAM | 磁盘 | 最大租户数 |
|---|---|---|---|---|
| **mid-host** | 16 vCPU | 64 GB | 1 TB | 10–15 |
| **large-host** | 32 vCPU | 128 GB | 2 TB | 25–30 |
| **multi-node cluster** | 3 nodes × large | | - | 50+（建议改用后续版本的多实例安装） |

对于增长超出 `pilot-prod` 容量的 MSSP 的建议：
- ：增加第二台主机，运行第二个 SocTalk 实例（schema 支持此方式，工具链为手动操作）。
- 后续版本：在 Cloud 层实现多实例安装自动化。
- 后续版本：集群化 K3s，并在各节点间进行合理调度。

## 测量计划（预发布验证）

该 spike 会产出真实数据以替换 §2 中的估算值：

1. 在 `k3d`（dev-harness）上部署带有一个租户的 `soctalk-tenant`。
2. 空闲测量：获取一次 `kubectl top pod -n tenant-acme` 快照。
3. 负载测试：以 10 alerts/sec 注入 10 分钟；测量峰值。
4. 停止负载；约 5 分钟后测量以获取"温空闲"数据。
5. 并行运行三个租户重复上述步骤，以观察相互干扰。
6. 用测得的值更新本文档的表格。
