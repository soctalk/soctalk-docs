# 攻击模拟器与 linux-ep

一对演示工具，用于生成逼真的 Wazuh 告警，让 MSSP 运营人员能够看到 SocTalk 的 [AI 流水线](/zh-cn/ai-pipeline)真正开展工作。强烈建议在评估和现场演示中使用——没有告警，智能体就没有可分诊的对象。

两者均随 FOSS 发行版一同提供。源码：

- [`attack-simulator/`](https://github.com/soctalk/soctalk/tree/main/attack-simulator) —— 脚本与规则包
- [`charts/linux-ep/`](https://github.com/soctalk/soctalk/tree/main/charts/linux-ep) —— 运行模拟器的 Kubernetes chart

## linux-ep chart

`linux-ep` 会启动 N 个 Linux 端点 pod，每个 pod 会：

1. 安装 Wazuh agent 并向租户的 Wazuh manager 注册。
2. 按可配置的间隔对自身运行脚本化的 MITRE ATT&CK 技术。
3. 限制每个 pod 每日模拟告警数量（默认每 UTC 日 30 条），以控制 LLM 开销。

这些 pod 会注册为 `linux-ep-0`、`linux-ep-1`……，因此 SocTalk UI 会在告警流中显示逼真的主机名。

### 安装

```bash
helm install linux-ep oci://ghcr.io/soctalk/charts/linux-ep \
  --version 0.2.0 \
  --namespace tenant-demo \
  --set wazuh.managerHost=wazuh-demo-wazuh-manager \
  --set wazuh.credsSecret.name=wazuh-demo-wazuh-creds \
  --set replicas=2 \
  --set simulator.enabled=true \
  --set simulator.dailyAlertCap=30
```

对于[演示 VM 镜像](/zh-cn/quickstart-vm)，模拟器默认关闭，以避免在无人值守时耗尽 LLM 预算；请通过 `simulator.enabled=true` 显式启用它。

### Helm 值（关键项）

| Key | Default | Effect |
|---|---|---|
| `replicas` | 1 | 端点 pod 的数量 |
| `wazuh.managerHost` | ""（必填） | 租户的 Wazuh manager Service 主机名（例如 `wazuh-demo-wazuh-manager`） |
| `wazuh.credsSecret.name` | ""（必填） | 包含 `authd` 注册密码的现有 Secret（通常为 `wazuh-<slug>-wazuh-creds`） |
| `wazuh.credsSecret.authdPasswordKey` | `AUTHD_PASS` | Secret 中 `authd` 密码对应的 key |
| `simulator.enabled` | `false` | 总开关。默认关闭——保持关闭可让 pod 处于空闲状态（无合成告警） |
| `simulator.attackDelay` | 10 | pod 启动（agent 已注册）后到首个 TTP 之间的秒数 |
| `simulator.attackInterval` | 120 | 后续各 TTP 之间的秒数 |
| `simulator.dailyAlertCap` | 30 | 每个 pod 每 UTC 日 `SOCTALK_ATTACK` 发送的上限。设为 0 则禁用该上限 |
| `image.repository` | `ghcr.io/soctalk/soctalk-linux-ep` | — |
| `securityContext.privileged` | `true` | 涉及内核操作的 TTP（进程命名空间、文件权限调整）所必需 |

### 成本说明

每条模拟告警都会启动一次 AI 调查，从而消耗 LLM tokens（典型值：在默认模型下每个案例约 50k 输入 / 10k 输出）。以 2 个 pod × 每日 30 条告警 = 每日 60 次调查计算。请根据你的演示预算调整 `dailyCapPerPod`。

## 模拟的技术

来自 MITRE ATT&CK Enterprise 矩阵的 25 个 Linux TTP。完整列表位于 [`attack-simulator/scripts/linux-techniques.txt`](https://github.com/soctalk/soctalk/blob/main/attack-simulator/scripts/linux-techniques.txt)；此处按战术汇总：

| Tactic | TTP IDs (selected) |
|---|---|
| **初始访问 / 持久化** | T1098（账户操纵）、T1547.001（引导/登录脚本） |
| **权限提升** | T1548.003（sudo 滥用） |
| **防御规避** | T1027（混淆命令：base64 解码 + 运行）、T1070（指标清除） |
| **凭据访问** | T1110（暴力破解）、T1003.008（访问 `/etc/passwd` + `/etc/shadow`） |
| **发现** | T1046（网络服务发现）、T1082（系统信息）、T1083（文件/目录发现）、T1057（进程发现） |
| **横向移动** | T1021.004（SSH） |
| **收集** | T1560.001（用于外泄暂存的数据归档） |
| **命令与控制** | T1105（入站工具传输） |
| **数据外泄** | T1041（经由 C2 通道） |
| **影响** | T1485（数据销毁）、T1486（数据加密）、T1496（资源劫持） |
| **执行 / 计划任务** | T1053.003（计划任务 / cron） |

每个脚本会发出一行标记为 `SOCTALK_ATTACK <TTP>: <description>` 的 syslog，以便 Wazuh 有可匹配的内容。

## Wazuh 规则包

[`charts/wazuh/templates/manager-local-rules.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/wazuh/templates/manager-local-rules.yaml) 提供了 100200-100299 范围内的自定义规则：

- **100200** —— chain-root：匹配任意 `SOCTALK_ATTACK` syslog 行
- **100210 – 100225** —— 每个 TTP 一条规则：按 MITRE 技术分配严重性（级别 10–14）和标签
- **100299** —— 针对未映射 TTP 的兜底规则（严重性 8）

产生的告警携带 MITRE `attack.tactic`、`attack.technique` 以及人类可读的描述，因此 SocTalk 的 [`wazuh_worker`](/zh-cn/ai-pipeline) 拥有结构化的上下文可供推理。

## 运行单次攻击

在 chart 之外，你可以针对任何装有 Wazuh agent 的主机运行单个技术：

```bash
ssh ops@<linux-ep-pod>
sudo /opt/scripts/run-attack.sh T1110
sudo /opt/scripts/run-attack.sh T1027.001
```

`run-attack.sh` 是入口点——它会分发到每个 TTP 对应的脚本。适用于希望按需触发特定告警的现场演示。

## 移除模拟器

对于不希望模拟器告警稀释真实遥测的正式客户安装：

```bash
helm uninstall linux-ep -n tenant-<slug>
```

该命令会移除端点 pod。自定义的 Wazuh 规则包会保留在原处，但在没有 `SOCTALK_ATTACK` syslog 行命中它时是无害的。

## 本工具未涵盖的内容

- **Windows 端点模拟** —— 本次发行仅支持 Linux。已列入路线图。
- **macOS 端点模拟** —— 同上。
- **对手仿真活动** —— 仅支持单个 TTP；我们不会将多个 TTP 串联成多阶段场景。
- **Atomic Red Team 集成** —— `attack-simulator` 为手工编写；它不直接消费 Atomic 的 YAML。兼容性已列入路线图。
