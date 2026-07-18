# Launchpad 事件模式

`launchpad up --headless` 和 `launchpad down --headless` 会向 stdout **每行流式输出一个 JSON 事件**。这是自动化接入面：可从 CI、脚本或驱动型 TUI 中对这些事件进行断言。

所有事件共享相同的顶层结构。仅与该事件类型相关的字段会被填充。

```json
{
  "ev":       "<kind>",        // discriminator; see below
  "time":     "2026-07-02T16:05:14.089Z",
  "phase":    "<phase>",       // only on ev=phase
  "vm_key":   "mssp",          // scopes VM-level events
  "step":     "install",       // sub-phase within a VM
  "percent":  60,              // 0-100
  "message":  "...",           // human-readable
  "level":    "info",          // for vm_log
  "gate_id":  "...",           // for gate_open / gate_resolved
  "instructions": "...",       // for gate_open
  "copy_text":    "...",       // for gate_open
  "ipv4":     "100.x.x.x",     // for vm_ready
  "ipv6":     "...",
  "ssh_user": "ops",
  "ssh_port": 22,
  "fields":   { "capabilities": ["vm.plan"] },  // free-form; used by plugin_ready
  "error":    { "category":"...", "code":"...", "message":"...", "hint":"..." }
}
```

## 事件类型

| `ev`             | 触发时机                                                                              | 是否终结？ |
|------------------|---------------------------------------------------------------------------------------|-----------|
| `phase`          | 编排器切换阶段时。                                                                     | 否        |
| `plugin_ready`   | 供给插件已启动并返回其 `hello` 握手。                                                  | 否        |
| `vm_plan`        | 对插件*将会*创建内容的每 VM 试运行描述。                                               | 否        |
| `vm_progress`    | 每 VM 子步骤进度（含 `step` + `percent`）。                                            | 否        |
| `vm_ready`       | 插件已创建并验证该 VM。                                                                | 否        |
| `vm_log`         | 来自插件（进度中继）或 launchpad 驱动的安装 shell 的日志行。                           | 否        |
| `gate_open`      | 到达手动闸门；需要操作员确认。                                                         | 否        |
| `gate_resolved`  | 操作员（或 `--auto-resolve-gates`）关闭了闸门。                                        | 否        |
| `error`          | 致命错误。`error.category` + `error.code` 是稳定标识符。                               | **是**    |
| `complete`       | 整个流程干净地运行完毕。                                                               | **是**    |

`error` 与 `complete` 是两个终结事件。每次 launchpad 运行都恰好发出其中一个。

## 阶段顺序（up）

```
initializing → planning → provisioning → installing → complete
```

在 `provisioning` 内部，每个 VM 会以 `vm_progress` 发出 `lookup → prepare → image_cache|image_download → tailscale → cloud_init → disk → boot → wait_ready` 这些步骤。`installing` 期间的 `install` 步骤会将底层安装程序的 stdout 以 `vm_log` 流式输出。

## 阶段顺序（down）

```
tearing_down → torn_down → complete
```

`vm.destroy` 会按供给的逆序对每个 VM 调用（租户在先，MSSP 在最后）。每个 VM 的发出都是一个 `step=destroy` 的 `vm_progress`。

## 错误分类法

`error.category` 是 launchpad 及所有第一方插件承诺遵守的十个稳定标识符之一：

| 类别                | 含义                                                                | 可重试 |
|---------------------|---------------------------------------------------------------------|-----------|
| `auth`              | 凭据缺失、无效或缺少作用域。                                         | 否        |
| `validation`        | 配置或输入格式错误。                                                 | 否        |
| `not_found`         | 被引用的实体不存在。                                                 | 否        |
| `already_exists`    | 幂等创建失败，因为实体已存在。                                       | 否        |
| `provider_unavailable` | 上游提供方（Tailscale、Hetzner 等）不可达。                       | 是        |
| `quota`             | 提供方侧配额耗尽。                                                   | 否        |
| `timeout`           | 等待超过了策略的截止期限。                                           | 是        |
| `internal`          | 插件/编排器缺陷——意外的错误路径。                                    | 否        |
| `network`           | 本地网络 / TLS / DNS。                                               | 是        |
| `cancelled`         | Ctrl-C 或 SIGTERM。                                                  | 否        |

`error.code` 是该类别下带插件命名空间的标识符（例如 `qemu.image.sha256_mismatch`）。类别是稳定的；代码可能会新增。

## 从 bash 消费

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

要基于完成状态对 CI 作业设置门控：

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates > run.log
grep -q '"ev":"complete"' run.log || {
  jq -r 'select(.ev == "error") | "\(.error.category)/\(.error.code): \(.error.message)"' < run.log
  exit 1
}
```

## 版本兼容性

- 字段新增不会破坏兼容性。
- 字段移除会提升 launchpad 主版本号。
- `error.category` 的取值是永久的。`ev` 的取值是永久的。
- `error.code` 的取值可能在同一类别内被重命名（它们是插件作用域的）。
