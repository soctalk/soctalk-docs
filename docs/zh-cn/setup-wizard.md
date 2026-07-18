# 安装向导

随[演示 VM 镜像](/zh-cn/quickstart-vm)一同提供的基于浏览器的首次启动配置工具。它**不是**生产环境安装的一部分——生产用户需自行手写 `values.yaml` 并运行 `helm install`。

该向导的职责是：

1. 使用每次启动生成的安装令牌对操作员进行身份验证。
2. 收集安装 `soctalk-system` 所需的最小配置。
3. 写入 `/etc/soctalk/values.yaml`、`/etc/soctalk/llm.key` 以及一个租户接入 env 文件。
4. 退出并移交给 `soctalk-firstboot.service`，由后者运行 `helm install` 并接入一个演示租户。

源码位于 [`setup-wizard/`](https://github.com/soctalk/soctalk/tree/main/setup-wizard)（Go，约 600 行）。

## 如何访问

VM 上的 `:8443` 端口。仅支持 TLS；向导在首次启动时生成一个自签名 ECDSA P-256 证书，覆盖 VM 的本地 IP、`localhost` 和 `soctalk.local`。绑定端口为 `:8443`（而非 `:443`），以免与 k3s 捆绑的 Traefik 冲突。

```text
https://<vm-ip>:8443/
```

## 安装令牌

向导在首次启动时生成一个 256 位安装令牌，并将其写入 `/var/log/soctalk-setup-token`（模式 `0600`，属主为 root）。使用以下命令获取：

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

每次重启向导时令牌都会轮换。除重启该单元外，没有 API 可以恢复丢失的令牌；重启会轮换并重新打印令牌。

## 两阶段表单

1. **身份验证**——粘贴安装令牌。
2. **配置**——填写下方各字段。

令牌输入页提交至 `POST /auth`；配置页提交至 `POST /submit`。二者均使用 HMAC 绑定的 CSRF cookie（`SameSite=Strict`、`HttpOnly`、`Secure`）。

### 阶段 1——身份验证

![安装向导——令牌输入](/screenshots/setup-wizard-token.png)

### 阶段 2——配置

![安装向导——已填写的配置表单](/screenshots/setup-wizard-config-filled.png)

### 身份标识

| 字段 | 类型 | 备注 |
|---|---|---|
| MSSP／组织名称 | 文本，≤120 字符 | 成为 chart values 中的 `install.msspName` |
| 主机名 | 可选 FQDN，≤253 字符 | 留空 → 默认为 `soctalk.local`；chart 拒绝在 `spec.rules[0].host` 上使用 IP 地址 |
| 管理员邮箱 | 邮箱 | 成为引导性 `mssp_admin`（V1 chart 初始化创建此角色，而非 `platform_admin`） |
| 管理员密码 | 密码，≥12 字符 | 作为 `install.bootstrapAdmin.password` 写入 values 文件。chart 的初始化以 `must_change=false` 创建该用户，因此首次登录可立即进行 |

### LLM

| 字段 | 类型 | 备注 |
|---|---|---|
| 提供商 | 下拉选择（`anthropic`、`openai`） | **本版本中仅作展示。**向导会收集该值，但不会将其写入 chart values；将应用 chart 的默认值（`openai-compatible`）。若要固定指定某个提供商，请在 `soctalk-firstboot.service` 运行前编辑 `/etc/soctalk/values.yaml` 以设置 `defaults.llm.provider`，或在安装后执行 `helm upgrade`。将其接入向导已列入未来版本的跟踪计划 |
| API 密钥 | 密码 | 写入 `/etc/soctalk/llm.key`（模式 `0600`）——**不会**写入 values 文件。安装程序据此创建一个 Kubernetes Secret（`soctalk-system-llm-api-key`），同时包含 `anthropic-api-key` 和 `openai-api-key` 两个数据字段，因此 chart 的运行时可以使用 values 所指定的任一提供商 |

### 演示租户接入

向导还会写入 `/etc/soctalk/onboard.env`：

```text
ADMIN_EMAIL='<email>'
ADMIN_PW='<password>'
INGRESS_HOST='<hostname or soctalk.local>'
TENANT_SLUG=demo
TENANT_NAME='<org name> — Demo'
```

`soctalk-firstboot.sh` 在 `helm install` 成功后读取该文件，通过 `POST /api/auth/login` 登录，并以 `{slug: demo, profile: poc, display_name: <name>}` 调用 `POST /api/mssp/tenants/onboard`。租户接入是**异步的**：API 立即返回 202；配置控制器在后台启动 Wazuh 技术栈。首次启动安装程序在退出前不会等待租户达到 `active` 状态。

## 向导写入的内容

| 路径 | 模式 | 内容 |
|---|---|---|
| `/etc/soctalk/values.yaml` | 0640 | 渲染后的 chart values（`install.*`、`ingress.*`、`postgres.*`） |
| `/etc/soctalk/llm.key` | 0600 | LLM API 密钥，单行 |
| `/etc/soctalk/onboard.env` | 0600 | 演示租户接入 env 文件 |
| `/var/lib/soctalk-wizard.done` | 0644 | 哨兵文件——防止向导在后续启动时再次触发 |

## systemd 单元

```text
[Unit]
After=cloud-init.target network-online.target
ConditionPathExists=!/var/lib/soctalk-firstboot.done
ConditionPathExists=!/var/lib/soctalk-wizard.done
ConditionPathExists=!/etc/soctalk/values.yaml

[Install]
WantedBy=cloud-init.target
```

它挂接的是 `cloud-init.target`（而非 `multi-user.target`），以避免经由 `After=cloud-final.service` 产生排序环路。允许 cloud-init 的 user-data 直接落地 `/etc/soctalk/values.yaml`——如果它这样做，向导便永不启动，`soctalk-firstboot.service` 会径直进行 `helm install`。

## 加固

该单元使用 systemd 的标准加固措施：`ProtectSystem=strict`、`ProtectHome=true`、`PrivateTmp=true`、`NoNewPrivileges=true`、`RestrictNamespaces=true`、`MemoryDenyWriteExecute=true`。写入被限制在 `/etc/soctalk`、`/var/lib` 和 `/var/log` 内。向导通过 `AmbientCapabilities=CAP_NET_BIND_SERVICE` 绑定特权端口 `:8443`。

成功提交后，向导写入哨兵文件并退出。systemd 的 `ConditionPathExists=!sentinel` 可防止它在启动时重新运行。

## 防滥用

- 在每个需身份验证的端点上设置**令牌关卡**。使用恒定时间比较。
- 在每个改变状态的 POST 上通过 HMAC 绑定的双提交 cookie 实施 **CSRF** 防护。
- **速率限制**：每个源 IP 的两次身份验证尝试之间至少间隔 30 秒；一小时内失败 10 次会将该 IP 封禁一小时。（Codex 将此标记为 NAT 之后一个微不足道的 DoS 隐患——共享 NAT 之后的操作员可能会看到合法的安装被阻断。重启该单元即可清除。）
- **仅支持自签名 TLS**。向导从不提供明文 HTTP 服务。客户只需接受一次自签名证书；生产用户则根本不应接触到该向导。

## 提交之后会发生什么

向导返回 `{poll: "/status", status: "accepted"}`，并在 3 秒的宽限窗口后退出（以便客户的轮询器能抓取到成功响应）。随后：

1. `soctalk-firstboot.service` 注意到 `values.yaml` 已存在，随即启动。
2. `systemctl start k3s`（k3s 已由 Packer 安装但未启动，因此向导有空闲的 `:8443` 端口可用）。
3. 创建 `soctalk-system` 命名空间 + LLM Secret。
4. `helm upgrade --install soctalk-system /opt/soctalk/charts/soctalk-system --values /etc/soctalk/values.yaml --wait --timeout 15m`。
5. 修补 `kube-system → soctalk-system` 的 NetworkPolicy，以便 Traefik 能访问 soctalk-system 的 Service。
6. 通过 Traefik 轮询 `/api/auth/me`（使用 Host 头技巧），最长 10 分钟。返回 200 或 401 都表示“Traefik 正在路由”；该循环两者皆接受。
7. 以引导管理员身份登录，调用 `POST /api/mssp/tenants/onboard`。
8. 写入 `/var/lib/soctalk-firstboot.done`。

跟踪 `/var/log/soctalk-firstboot.log`（或 `journalctl -u soctalk-firstboot -f`）以观察进展。

## 重置／重新运行

若要在成功安装后重新运行向导：

```bash
sudo rm /var/lib/soctalk-firstboot.done /var/lib/soctalk-wizard.done /etc/soctalk/values.yaml
sudo systemctl restart soctalk-setup-wizard
```

此操作具有破坏性——现有的 helm release 仍然拥有 `soctalk-system` 命名空间。若要进行干净的重置，请先执行 `helm uninstall soctalk-system -n soctalk-system`。
