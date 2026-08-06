---
description: "将 SocTalk AI 分诊接入你已经在运行的 Wazuh：从 OS 软件包安装、以 provided profile 上线租户，并观察第一条告警如何变成一个已分诊、已上报的案例。"
---

# 将 SocTalk 接入已有的 Wazuh

大多数 Wazuh 用户并非从零起步。通常已经有一个 manager 在监控代理、一个 indexer 保存着数月的告警，以及团队日常调查所用的 dashboard。SocTalk 的 `provided` 租户 profile 正是为这种情形而设计：SocTalk 只安装它自己的组件，通过网络连接到你的 Wazuh，并开始对你现有部署已经产生的告警进行分诊。你的 Wazuh 不发生任何改动，代理无需重新注册，数据也不迁移。

本指南在单台 Linux 主机上走完整条路径，从 OS 软件包一直到第一次 AI 分诊后的上报，并已针对 SocTalk v0.2.0 搭配 Wazuh 4.12.0 做过端到端验证。凡是本版本仍有粗糙之处，指南都会明确指出并给出变通办法。

如果你希望由 SocTalk 来部署并托管 Wazuh，那属于 `poc` 或 `persistent` profile；参见[接入客户租户](/zh-cn/guides/wazuh-tenant-onboarding)。

## 开始之前你需要准备什么

你已有的 Wazuh 必须能从 SocTalk 主机通过两个端口访问：indexer 的 OpenSearch API（`:9200`）和 manager 的 REST API（`:55000`）。SocTalk 对二者分别认证，因此请把两组凭据都准备好：

- 一个可以搜索 `wazuh-alerts-*` 的 indexer 用户（内置的 `admin` 可用，但用只读用户是更好的做法），
- 一个 manager API 用户，例如内置的 `wazuh-wui`。

Wazuh 一侧使用自签名证书是常态，也受支持；上线时你会传入 `verify_ssl: false`。你还需要一个租户级的 LLM API 密钥。`provided` profile 在上线时就要求提供它，因为自带 SIEM 的租户没有安装级的共享回退：如果缺少密钥，上线请求会被拒绝并返回 422。

SocTalk 主机本身需要通常的资源占用：基于 systemd 的 Linux（Ubuntu 24.04 和 Rocky 9 是经过验证的组合）、控制平面加一个 provided 租户至少需要 4 vCPU 和 8 GB 内存，以及空闲的 80/443/6443 端口。由于租户自身不运行任何 Wazuh，provided 租户远比 `persistent` 租户轻量。

## 从 OS 软件包安装 SocTalk

从[发布页面](https://github.com/soctalk/soctalk/releases)下载对应你发行版的软件包并安装；完整的规格矩阵见[从 OS 软件包安装](/zh-cn/os-packages)。

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

软件包在 `/etc/soctalk/soctalk.env.example` 提供了一个环境变量模板。复制它，填入你的 MSSP 身份、管理员凭据、主机名和 LLM 密钥，并保持仅 root 可读：

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

然后以无人值守方式运行安装程序：

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

请显式传入 `--skip-consent`（或 `-y`）。在 v0.2.0 中，即使每个 `SOCTALK_*` 变量都已设置，同意提示仍会在非交互式终端上触发，而在没有 TTY 的情况下安装会中止并报 `/dev/tty: No such device or address`。

安装程序会在主机缺少时拉起 k3s 和 Helm，安装固定到该发布版本的 `soctalk-system` chart，并在完成时打印 URL 和登录信息。`soctalk-system` 命名空间中出现三个 pod（`api`、`app-ui`、`postgres`）即表示控制平面已就绪：

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## 上线前的一个开关：网络策略

这里是 v0.2.0 中一处棘手之处，先讲清楚以免你在上线中途撞上：`provided` 租户会为外部 SIEM 主机渲染一条 Cilium FQDN 出站策略，但 `soctalk install` 所搭建的 k3s 运行的是 flannel，它没有 Cilium 的 CRD。因此在原生 v0.2.0 安装上预配 provided 租户会在 Helm 步骤失败，报

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

租户随即落入 `degraded`。这在 v0.2.0 之后已修复（[soctalk#107](https://github.com/soctalk/soctalk/issues/107)）：chart 现在会以该 CRD 是否真实存在为条件来决定是否创建该对象，并为 IP 字面量形式的 SIEM 主机添加普通的 `NetworkPolicy` 出站规则，因此原生 flannel 安装也能干净地完成预配。在 v0.2.0 上，单主机安装的变通办法是在上线前禁用租户网络策略：

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

请清楚这一取舍：这会关闭之后预配的租户的命名空间隔离 NetworkPolicy，在专用的单一租户类别实验或试点主机上可以接受，但在共享的多租户生产集群上并不是你想要的。如果你以 Cilium 作为 CNI，则以上都不适用，你应当保持策略开启。

如果你已经上线，且租户带着上述错误停在 `degraded`，请设置该开关并在租户页面上按 **Retry Provisioning**；重试是幂等的，会干净地恢复。

还有一点专属于单机实验场景：那种“已有”的 Wazuh 往往就跑在你安装 SocTalk 的同一台主机上的 Docker 里，通过主机自身的 IP 访问。k3s 通过其内置控制器强制执行 NetworkPolicy，而 pod 访问节点自身 IP 上某个 Docker 发布端口属于一次发夹（hairpin），即便有出站规则允许，策略层也无法干净地路由。症状是 adapter 记录 `ingest_failed: All connection attempts failed`，而同一个 Wazuh 从主机访问却完全正常。按上面的方式禁用租户网络策略即可解决。位于另一台主机上的 Wazuh 属于普通的出站路径，不会遇到这个问题。

## 上线租户

在 MSSP UI 中，进入 Tenants，然后点 **+ New Tenant**，选择 `provided` profile，向导便会插入一个 External SIEM 步骤，这是 PoC 或 persistent 租户所没有的。

![New Tenant 向导的 Profile 步骤，已选中 Provided，描述为自带 Wazuh；面包屑导航现在包含一个 External SIEM 步骤](/screenshots/existing-wazuh-profile.png)

正是在这一步，你把 SocTalk 指向你的 Wazuh。indexer（OpenSearch，端口 9200）和 manager API（端口 55000）使用各自独立的凭据认证，而 provided 租户提供自己的 LLM 密钥，因为 MSSP 的安装共享密钥不适用于此 profile。

![External SIEM 向导步骤：indexer URL 与凭据、manager API URL 与凭据、一个可选的预先铸造的 API token、一个针对自签名证书需要取消勾选的 Verify TLS certificates 复选框，以及必填的租户级 LLM 密钥](/screenshots/existing-wazuh-siem-form.png)

同样的操作通过 API 只需向上线端点发一次 POST。请注意路径：`POST /api/mssp/tenants/onboard` 是理解 profile 和外部 SIEM 材料的向导端点。普通的 `POST /api/mssp/tenants` 只是身份创建；在 v0.2.0 上它会静默忽略那些字段，给你留下一个永远不会预配的 `poc` 租户，所以务必把 provided 上线请求发往 `/onboard`。

```bash
# authenticate once; the cookie jar carries the MSSP session
curl -sk -c cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/auth/login" \
  -d '{"email": "<admin-email>", "password": "<admin-password>"}'

curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/mssp/tenants/onboard" -d '{
  "slug": "orion-soc",
  "display_name": "Orion Labs",
  "profile": "provided",
  "llm_provider": "anthropic",
  "llm_base_url": "https://api.anthropic.com",
  "llm_model": "claude-sonnet-4-6",
  "llm_api_key": "sk-ant-...",
  "external_siem": {
    "indexer_url": "https://198.51.100.20:9200",
    "indexer_username": "admin",
    "indexer_password": "...",
    "api_url": "https://198.51.100.20:55000",
    "api_username": "wazuh-wui",
    "api_password": "...",
    "verify_ssl": false
  }
}'
```

返回体中带有 `"profile": "provided"` 的 202 就确认走对了路径。选择 slug 时要谨慎：slug 会被已归档的租户一直占用，因此一个已下线的测试租户不会释放其名称供重用。

预配 provided 租户很快，因为没有 Wazuh chart 要安装；控制器会跳过该阶段，转而记录一条 `wazuh_skipped_provided` 生命周期事件。在验证过的那次运行中，租户从 `pending` 到 `active` 用时不到二十秒。

## 验证连接

租户命名空间中应当恰好包含两个工作负载，即 adapter 和 runs-worker，没有任何 Wazuh pod：

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

你的连接材料会落入一个名为 `tenant-external-siem-creds` 的命名空间本地 Secret，其中保存 `INDEXER_USERNAME`、`INDEXER_PASSWORD`、`WAZUH_API_USERNAME` 和 `WAZUH_API_PASSWORD`，若你提供了 API token 还会有 `WAZUH_API_TOKEN`。adapter 从其环境读取 indexer URL，从该 Secret 读取凭据。它的日志会在数秒内告诉你连接是否成功，因为它会持续轮询告警索引：

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

租户详情页无需查看日志就能显示同样的信息。External SIEM 面板会回显你提供的 indexer 和 API URL，而 Adapter ingest 状态行会在第一批告警流入后报告 `reachable` 并附上已转发的告警计数。

![Orion Labs 租户详情页：profile 为 provided、状态为 active、一个显示 indexer 和 API URL 的 External SIEM 面板，以及 Adapter ingest 状态为 reachable 且已转发三条告警](/screenshots/existing-wazuh-tenant-detail.png)

adapter 日志中出现 401 表示 indexer 凭据不对；TLS 错误表示 `verify_ssl` 与你的证书情况不匹配；超时表示 SocTalk 主机无法访问 indexer 端口。

凭据可以在不重新上线的情况下轮换。`PATCH /api/mssp/tenants/{id}/external-siem` 接受上线字段的任意子集，重写 Secret，并滚动 adapter pod 以使其获取新材料：

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## 第一条被分诊的告警

从这里开始，摄取、提升、运行执行和审查工作流与 SocTalk 托管的 Wazuh 完全一致（在 v0.2.0 上富化的深度有所不同，参见当前限制）：adapter 转发达到或超过最低严重级别的新告警（默认规则等级 10，可通过 `SOCTALK_ADAPTER_MIN_SEVERITY` 配置），控制平面把重要的告警提升为调查，租户的 runs-worker 用租户自己的 LLM 密钥执行 AI 分诊。

诚实的测试方式是让你已有的 Wazuh 产生一条真实的高严重级别告警，例如针对某个被监控代理的一连串失败的 SSH 登录随后一次成功登录。如果你不愿触碰生产端点，直接把一份合成告警文档索引进 `wazuh-alerts-4.x-<date>`、把 `rule.level` 设为 12，就能触发完全相同的路径，因为 adapter 是从索引而非 manager 读取的。

在验证过的那次运行中，一条 SSH 暴力破解后成功登录的告警从 indexer 文档到分诊完成大约用了一分钟：由 adapter 转发、被提升、经 supervisor 跨多次 LLM 调用调查，最后以 0.95 的置信度关闭为 `escalate`，落入 [MSSP 审查队列](/zh-cn/mssp-ui#reviews-human-in-the-loop)交由人工处理。该次运行的总花费约为三十美分，计入租户的 Anthropic 密钥，并对照 [AI 流水线](/zh-cn/ai-pipeline)中描述的每次运行 token 预算进行追踪。经过几条这样的测试告警后，审查队列会把它们并排陈列。

![Human Review Queue 中有三个 Critical 案例，每个都标记为 AI: Escalate 并提供一个 Review 操作](/screenshots/existing-wazuh-review-queue.png)

每一行都携带 AI 裁决，并可展开完整的调查，因此分析师是在证据基础上确认或推翻，而不是自己从头开始分诊。

## 当前限制

下面两条注意事项都在 v0.2.0 上得到验证，并在其之后的发布版本中修复，因此在更新的构建上你可以跳过这些变通办法。请查阅你所用版本的发布说明。

- **触达外部 Wazuh 的富化（仅 v0.2.0）。**在 v0.2.0 上，runs-worker 的 Wazuh MCP 工具未接入 provided 租户的 manager API，因此分诊只在告警负载本身之上运行，无法实时下钻到代理状态或日志历史。已在 v0.2.0 之后修复（[soctalk#109](https://github.com/soctalk/soctalk/issues/109)）：worker 现在会把捆绑的 `mcp-server-wazuh` MCP 服务器连接到租户自己的 Wazuh，因此分诊图在调查过程中会像 SocTalk 托管租户那样查询代理、进程、端口、漏洞和 manager 日志。
- **在原生 flannel 安装上的预配（仅 v0.2.0）。**即前文描述的 Cilium 出站策略问题及其网络策略变通办法。已在 v0.2.0 之后修复（[soctalk#107](https://github.com/soctalk/soctalk/issues/107)）。
