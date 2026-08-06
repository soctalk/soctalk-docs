---
description: "将 SocTalk AI 分诊接入你已有的 Wazuh：从 OS 软件包安装、上线一个 provided profile 租户，看着第一条告警变成一个已分诊、已上报的案件。"
---

# 将 SocTalk 接入既有的 Wazuh

大多数 Wazuh 用户并非从零起步。往往已经有一个 manager 在监视代理、一个 indexer 保存着数月的告警，还有一个团队日常调查所依赖的 dashboard。SocTalk 的 `provided` 租户 profile 正是为这种情况而设计：SocTalk 只安装自己的组件，通过网络连接到你的 Wazuh，并开始对你部署已经产出的告警进行分诊。你的 Wazuh 不做任何改动，代理无需重新注册，也没有数据迁移。

本指南在单台 Linux 主机上走完整条路径，从 OS 软件包一直到第一次 AI 分诊后的上报，并针对 SocTalk v0.2.0 搭配 Wazuh 4.12.0 做了端到端验证。凡是本版本仍有毛刺之处，指南都会指出并给出变通做法。

如果你希望由 SocTalk 替你部署并管理 Wazuh，那属于 `poc` 或 `persistent` profile，参见[上线客户租户](/zh-cn/guides/wazuh-tenant-onboarding)。

## 开始之前你需要什么

你既有的 Wazuh 必须能从 SocTalk 主机通过两个端口访问：indexer 的 OpenSearch API（`:9200`）和 manager 的 REST API（`:55000`）。SocTalk 会分别对二者进行认证，因此请准备好两组凭据：

- 一个允许检索 `wazuh-alerts-*` 的 indexer 用户（内置的 `admin` 可用，不过采用只读用户是更好的做法），
- 一个 manager API 用户，例如内置的 `wazuh-wui`。

Wazuh 侧使用自签名证书是常态，且受支持；你会在上线时传入 `verify_ssl: false`。你还需要一个租户级 LLM API 密钥。`provided` profile 在上线时就要求提供该密钥，因为自带 SIEM 的租户没有安装环境共享的兜底：若缺少密钥，上线请求会以 422 被拒绝。

SocTalk 主机本身需要通常的基本条件：基于 systemd 的 Linux（经过验证的组合是 Ubuntu 24.04 和 Rocky 9）、控制平面加一个 provided 租户至少 4 vCPU 和 8 GB 内存，以及空闲的 80/443/6443 端口。由于该租户不运行自己的 Wazuh，provided 租户比 `persistent` 租户轻量得多。

## 从 OS 软件包安装 SocTalk

从[发布页面](https://github.com/soctalk/soctalk/releases)下载适配你发行版的软件包并安装；完整的版本矩阵见[从 OS 软件包安装](/zh-cn/os-packages)。

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

软件包在 `/etc/soctalk/soctalk.env.example` 提供了一份环境模板。复制它，填入你的 MSSP 身份、管理员凭据、主机名和 LLM 密钥，并保持仅 root 可读：

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

然后无人值守地运行安装程序：

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

请显式传入 `--skip-consent`（或 `-y`）。在 v0.2.0 中，即使已设置每一个 `SOCTALK_*` 变量，同意提示在非交互式终端上仍会触发，而在没有 TTY 时安装会以 `/dev/tty: No such device or address` 中止。

若主机上没有 k3s 和 Helm，安装程序会将它们装好，安装固定到该发布版本的 `soctalk-system` chart，完成后打印 URL 和登录信息。当 `soctalk-system` 命名空间中的三个 pod（`api`、`app-ui`、`postgres`）就绪时，即表示控制平面已启动：

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## 上线前的一个开关：网络策略

这是 v0.2.0 里的一处尖角，先讲清楚，免得你在上线途中撞上：`provided` 租户会为外部 SIEM 主机渲染一条 Cilium FQDN 出站策略，但 `soctalk install` 搭建的 k3s 运行的是 flannel，它没有 Cilium CRD。因此在原生的 v0.2.0 安装上预配 provided 租户会在 Helm 步骤失败，报出

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

租户随即落入 `degraded`。这在 v0.2.0 之后已修复（[soctalk#107](https://github.com/soctalk/soctalk/issues/107)）：chart 现在会以该 CRD 是否实际存在为条件来决定是否创建该对象，并为 IP 字面量的 SIEM 主机添加普通的 `NetworkPolicy` 出站规则，因此原生 flannel 安装能干净地完成预配。在 v0.2.0 上，单主机安装的变通做法是在上线前禁用租户网络策略：

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

要清楚这一取舍：这会关闭此后预配的租户的命名空间隔离 NetworkPolicy，这在专用的单租户级实验或试点主机上可以接受，但在共享的多租户生产集群上并不是你想要的。如果你用 Cilium 作为 CNI，以上均不适用，你应当保持策略开启。

如果你已经完成上线，而租户带着上述错误停在 `degraded`，请设置该开关，然后在租户页面上点击 **Retry Provisioning**；重试是幂等的，会干净地续跑。

还有一点专门针对单机实验：那种"既有"的 Wazuh 常常就跑在你安装 SocTalk 的同一台主机上的 Docker 里，并通过主机自身的 IP 访问。k3s 通过其内置控制器强制执行 NetworkPolicy，而一个 pod 访问节点自身 IP 上某个 Docker 发布的端口，属于一种发夹（hairpin），即使出站规则允许，策略层也无法干净地路由它。症状是 adapter 记录 `ingest_failed: All connection attempts failed`，而同一个 Wazuh 从主机访问却一切正常。按上面的方法禁用租户网络策略即可解决。位于另一台主机上的 Wazuh 属于普通的出站路径，不会遇到这个问题。

## 上线租户

在 MSSP UI 中进入 Tenants，然后点击 **+ New Tenant**，选择 `provided` profile，向导会要求填写外部连接材料。通过 API 完成同样的操作只需向上线端点发一次 POST。请注意路径：`POST /api/mssp/tenants/onboard` 是理解 profile 和外部 SIEM 材料的向导端点。而普通的 `POST /api/mssp/tenants` 只做身份创建，会静默忽略那些字段，结果给你留下一个永远不会预配的 `poc` 租户。

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

响应体中带有 `"profile": "provided"` 的 202 即确认走对了路径。选 slug 要谨慎：slug 会被已归档的租户永久占用，因此一个下线的测试租户不会释放它的名字供再次使用。

预配 provided 租户很快，因为没有 Wazuh chart 需要安装；控制器会跳过该阶段，转而记录一条 `wazuh_skipped_provided` 生命周期事件。在验证过的运行中，租户从 `pending` 到 `active` 用时不到二十秒。

## 验证连接

租户命名空间应当恰好包含两个工作负载，即 adapter 和 runs-worker，没有任何 Wazuh pod：

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

你的连接材料会落入一个命名空间本地的 Secret，名为 `tenant-external-siem-creds`，其中保存 `INDEXER_USERNAME`、`INDEXER_PASSWORD`、`WAZUH_API_USERNAME` 和 `WAZUH_API_PASSWORD`，若你提供了则还有 `WAZUH_API_TOKEN`。adapter 从其环境读取 indexer URL，从该 Secret 读取凭据。由于它会持续轮询告警索引，其日志会在几秒内告诉你连接是否成功：

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

这里出现 401 表示 indexer 凭据有误；TLS 错误表示 `verify_ssl` 与你的证书情况不匹配；超时则表示 SocTalk 主机无法访问 indexer 端口。

凭据可在不重新上线的情况下轮换。`PATCH /api/mssp/tenants/{id}/external-siem` 接受上线字段的任意子集，重写该 Secret，并滚动 adapter pod 以便其获取最新材料：

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## 第一条分诊后的告警

从这里开始，流水线的行为与面向 SocTalk 托管的 Wazuh 时完全一致：adapter 转发达到或超过最低严重级别（默认 rule level 10，可用 `SOCTALK_ADAPTER_MIN_SEVERITY` 配置）的新告警，控制平面把重要的部分提升为调查，租户的 runs-worker 用租户自己的 LLM 密钥执行 AI 分诊。

诚实的测试方式是让你既有的 Wazuh 产生一条真实的高严重级别告警，例如针对某个被监视代理的一连串 SSH 登录失败随后成功。如果你不愿意触碰生产端点，那么直接把一份合成告警文档索引到 `wazuh-alerts-4.x-<date>` 并将 `rule.level` 设为 12，也会走通完全相同的路径，因为 adapter 是从索引而非从 manager 读取的。

在验证过的运行中，一条 SSH 暴力破解后成功登录的告警从 indexer 文档到完成分诊约用一分钟：由 adapter 转发、被提升、由 supervisor 跨多次 LLM 调用进行调查，最终以 0.95 的置信度关闭为 `escalate`，落入 [MSSP 审查队列](/zh-cn/mssp-ui#reviews-human-in-the-loop)交由人工处理。本次运行的总花费约为三十美分，计入租户的 Anthropic 密钥，并对照 [AI 流水线](/zh-cn/ai-pipeline)中所述的每次运行 token 预算进行跟踪。

## 当前的限制

下面两条注意事项都在 v0.2.0 上得到验证，并已在其后的发布版本中修复，因此在更新的构建上你可以跳过这些变通做法。请查阅你所用版本的发布说明。

- **富化触达外部 Wazuh（仅 v0.2.0）。** 在 v0.2.0 上，runs-worker 的 Wazuh MCP 工具并未接到 provided 租户的 manager API 上，因此分诊只在告警负载本身上运行，无法实时透视代理状态或日志历史。此问题在 v0.2.0 之后已修复（[soctalk#109](https://github.com/soctalk/soctalk/issues/109)）：worker 现在会把随附的 `mcp-server-wazuh` MCP 服务器连接到租户自己的 Wazuh，因此分诊图会在调查过程中查询代理、进程、端口、漏洞和 manager 日志，方式与 SocTalk 托管的租户相同。
- **在原生 flannel 安装上预配（仅 v0.2.0）。** 前文描述的 Cilium 出站策略问题，以及相应的网络策略变通做法。此问题在 v0.2.0 之后已修复（[soctalk#107](https://github.com/soctalk/soctalk/issues/107)）。
