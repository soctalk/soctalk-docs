# REST API

SocTalk API 是一个 FastAPI 应用。其完整接口面由代码生成为 OpenAPI schema，并
**在 `/api/` 下** 提供服务（ingress 将 `/api/*` 路由到 API，其余全部路由到 Web 控制台）：

- **OpenAPI JSON**：`https://mssp.your-mssp.example/api/openapi.json`
- **Swagger UI**：`https://mssp.your-mssp.example/api/docs`
- **ReDoc**：`https://mssp.your-mssp.example/api/redoc`

OpenAPI 接口面是唯一可信来源。其快照随本文档一起发布，位于
[`/openapi.json`](/openapi.json)，下方的目录 **由该 schema 生成** —— 因此不会与
代码产生偏差。

::: tip 重新生成目录
端点目录由 `npm run gen:api` 生成，它读取
`docs/public/openapi.json`。请先从 API 代码刷新 schema：

```bash
# in the soctalk repo
python scripts/dump_openapi.py <soctalk-docs>/docs/public/openapi.json
# in soctalk-docs
npm run gen:api
```

`GENERATED` 标记之间的所有内容都会被覆盖；标记周围的散文则由人工维护。
:::

## 端点目录

**Auth** 列由每个路由的 `require_role` / `require_tenant_role` 守卫推导得出。
标签为 `session cookie` 表示处理器接受 *任意* 已认证会话 —— 但租户范围内的角色
仍受行级安全（row-level security）限制，只能访问自己的数据，因此 `tenant_admin`
即使在未加限制的 MSSP 式路由上，也只能看到自己租户的行。

<!-- BEGIN GENERATED:endpoints (do not edit — npm run gen:api) -->

_97 个操作，涵盖 23 个分组，由 OpenAPI schema 生成（API 版本 `0.1.0`）。认证由路由的 `require_role` / `require_tenant_role` 守卫推导得出。_

### `auth`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `POST` | `/api/auth/assume-tenant` | Assume Tenant | 会话 cookie（登录）/ 无 |
| `POST` | `/api/auth/login` | Login | 会话 cookie（登录）/ 无 |
| `POST` | `/api/auth/logout` | Logout | 会话 cookie（登录）/ 无 |
| `GET` | `/api/auth/me` | Me | 会话 cookie（登录）/ 无 |
| `POST` | `/api/auth/password/change` | Password Change | 会话 cookie（登录）/ 无 |

### `auth-admin`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `POST` | `/api/mssp/users/{user_id}/password/reset` | Admin Reset | 会话 —— 角色：mssp_admin / platform_admin |

### `chat`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/chat/conversations` | List Conversations | 会话 cookie |
| `POST` | `/api/chat/conversations` | Create Conversation | 会话 cookie |
| `GET` | `/api/chat/conversations/{conv_id}` | Get Conversation | 会话 cookie |
| `DELETE` | `/api/chat/conversations/{conv_id}` | Delete Conversation | 会话 cookie |
| `POST` | `/api/chat/conversations/{conv_id}/messages` | Post Message | 会话 cookie |
| `POST` | `/api/chat/conversations/{conv_id}/messages/{msg_id}/confirm` | Confirm Action | 会话 cookie |
| `POST` | `/api/chat/conversations/{conv_id}/stop` | Stop Conversation | 会话 cookie |

### `health`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/health/live` | Live | 无（公开） |
| `GET` | `/health/ready` | Ready | 无（公开） |

### `internal-adapter`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/internal/adapter/checkpoint` | Get Checkpoint | 服务 JWT（适配器令牌） |
| `PUT` | `/api/internal/adapter/checkpoint` | Put Checkpoint | 服务 JWT（适配器令牌） |
| `GET` | `/api/internal/adapter/config` | Fetch Config | 服务 JWT（适配器令牌） |
| `POST` | `/api/internal/adapter/events` | Ingest Events | 服务 JWT（适配器令牌） |
| `POST` | `/api/internal/adapter/heartbeat` | Heartbeat | 服务 JWT（适配器令牌） |

### `internal-worker`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `POST` | `/api/internal/worker/runs/{run_id}/complete` | Complete Run | 服务 JWT（worker 令牌） |
| `POST` | `/api/internal/worker/runs/{run_id}/heartbeat` | Heartbeat Run | 服务 JWT（worker 令牌） |
| `POST` | `/api/internal/worker/runs/claim` | Claim Run | 服务 JWT（worker 令牌） |

### `investigations-bridge`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/investigations` | List Investigations | 会话 cookie |
| `GET` | `/api/investigations/{investigation_id}` | Get Investigation | 会话 cookie |
| `POST` | `/api/investigations/{investigation_id}/cancel` | Post Cancel Investigation | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/investigations/{investigation_id}/events` | Get Events | 会话 cookie |

### `ir-alerts`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/alerts` | List Alerts | 会话 —— 角色：analyst / mssp_admin / platform_admin |

### `ir-integrations`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/integrations` | Get Integrations | 会话 —— 角色：mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/integrations` | Patch Integrations | 会话 —— 角色：mssp_admin / platform_admin |

### `ir-mssp`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/investigations` | List Cases Mssp | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}` | Get Case Mssp | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/investigations/{investigation_id}/events` | List Case Events Mssp | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/investigations/{investigation_id}/facts` | Patch Case Facts | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/investigations/{investigation_id}/messages` | Post Analyst Message | 会话 —— 角色：analyst / mssp_admin / platform_admin |

### `ir-proposals`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/proposals` | List Pending Proposals | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/proposals/{proposal_id}/approve` | Approve Proposal Route | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/proposals/{proposal_id}/reject` | Reject Proposal Route | 会话 —— 角色：analyst / mssp_admin / platform_admin |

### `ir-tenant`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/tenant/investigations` | List Cases Tenant | 租户会话（customer_viewer / tenant_admin） |
| `GET` | `/api/tenant/investigations/{investigation_id}` | Get Case Tenant | 租户会话（customer_viewer / tenant_admin） |

### `l2-agent`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `POST` | `/api/agent/heartbeat` | Heartbeat | L2 agent 安装令牌（bearer） |
| `POST` | `/api/agent/jobs:claim` | Claim Job | L2 agent 安装令牌（bearer） |
| `POST` | `/api/agent/jobs/{job_id}/complete` | Complete Job | L2 agent 安装令牌（bearer） |
| `POST` | `/api/agent/jobs/{job_id}/events` | Post Event | L2 agent 安装令牌（bearer） |
| `POST` | `/api/agent/register` | Register | L2 agent 安装令牌（bearer） |

### `legacy-stubs`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/analytics/ai-behavior` | Analytics Ai Behavior | 会话 cookie |
| `GET` | `/api/analytics/human-review` | Analytics Human Review | 会话 cookie |
| `GET` | `/api/analytics/kpis` | Analytics Kpis | 会话 cookie |
| `GET` | `/api/analytics/outcomes` | Analytics Outcomes | 会话 cookie |
| `GET` | `/api/analytics/summary` | Analytics Summary | 会话 cookie |
| `GET` | `/api/audit` | Audit List | 会话 cookie |
| `GET` | `/api/audit/event-types` | Audit Event Types | 会话 cookie |
| `GET` | `/api/audit/investigation/{investigation_id}` | Audit Investigation | 会话 cookie |
| `GET` | `/api/audit/stats` | Audit Stats | 会话 cookie |
| `GET` | `/api/events/stream` | Events Stream | 会话 cookie |
| `GET` | `/api/review/{review_id}` | Review Detail | 会话 cookie |
| `POST` | `/api/review/{review_id}/approve` | Review Approve | 会话 cookie |
| `POST` | `/api/review/{review_id}/expire` | Review Expire | 会话 cookie |
| `POST` | `/api/review/{review_id}/reject` | Review Reject | 会话 cookie |
| `POST` | `/api/review/{review_id}/request-info` | Review Request Info | 会话 cookie |
| `GET` | `/api/review/pending` | Review Pending | 会话 cookie |
| `GET` | `/api/settings` | Settings Get | 会话 cookie |

### `metrics-bridge`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/metrics/hourly` | Hourly | 会话 cookie |
| `GET` | `/api/metrics/overview` | Overview | 会话 cookie |

### `mssp-analytics`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/analytics/heatmap` | Heatmap | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/analytics/ranking` | Ranking | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/analytics/trends` | Trends | 会话 —— 角色：analyst / mssp_admin / platform_admin |

### `mssp-dashboard`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/dashboard/open-by-tenant` | Open By Tenant | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/pending-reviews` | Pending Reviews | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/repeated-iocs` | Repeated Iocs | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/stuck-investigations` | Stuck Investigations | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/dashboard/tenant-health` | Tenant Health | 会话 —— 角色：analyst / mssp_admin / platform_admin |

### `mssp-tenant-branding`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `PATCH` | `/api/mssp/tenants/{tenant_id}/branding` | Update Tenant Branding | 会话 —— 角色：mssp_admin / platform_admin |

### `mssp-tenant-llm`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/tenants/{tenant_id}/llm` | Get Tenant Llm | 会话 —— 角色：mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/llm` | Update Tenant Llm | 会话 —— 角色：mssp_admin / platform_admin |
| `DELETE` | `/api/mssp/tenants/{tenant_id}/llm/api-key` | Clear Tenant Llm Api Key | 会话 —— 角色：mssp_admin / platform_admin |

### `mssp-tenants`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/mssp/tenants` | List Tenants | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants` | Create Tenant | 会话 —— 角色：mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}` | Get Tenant | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:decommission` | Decommission Tenant | 会话 —— 角色：mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:issue-agent` | Issue Agent | 会话 —— 角色：mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:resume` | Resume Tenant | 会话 —— 角色：mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry` | Retry Provisioning | 会话 —— 角色：mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:retry-install` | Retry Install | 会话 —— 角色：mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/{tenant_id}:suspend` | Suspend Tenant | 会话 —— 角色：mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/adapter-status` | Get Tenant Adapter Status | 会话 —— 角色：mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/events` | List Events | 会话 —— 角色：analyst / mssp_admin / platform_admin |
| `GET` | `/api/mssp/tenants/{tenant_id}/external-siem` | Get Tenant External Siem | 会话 —— 角色：mssp_admin / platform_admin |
| `PATCH` | `/api/mssp/tenants/{tenant_id}/external-siem` | Update Tenant External Siem | 会话 —— 角色：mssp_admin / platform_admin |
| `POST` | `/api/mssp/tenants/onboard` | Onboard Tenant | 会话 —— 角色：mssp_admin / platform_admin |

### `public-tenant`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/public/mssp-by-slug/{slug}` | Mssp By Slug | 无（公开） |
| `GET` | `/api/public/scope-by-slug/{slug}` | Scope By Slug | 无（公开） |
| `GET` | `/api/public/tenant-by-slug/{slug}` | Tenant By Slug | 无（公开） |

### `tenant-branding`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/tenant/branding` | Get Own Branding | 租户会话（customer_viewer / tenant_admin） |

### `tenant-llm`

| 方法 | 路径 | 摘要 | 认证 |
|---|---|---|---|
| `GET` | `/api/tenant/llm` | Tenant Get Llm | 租户会话（tenant_admin） |
| `PUT` | `/api/tenant/llm/api-key` | Tenant Put Llm Key | 租户会话（tenant_admin） |
| `DELETE` | `/api/tenant/llm/api-key` | Tenant Clear Llm Key | 租户会话（tenant_admin） |

<!-- END GENERATED:endpoints -->

## 认证方案

浏览器使用由 `POST /api/auth/login` 设置的会话 cookie。编程式客户端可以采用以下
两种方式之一：

1. 驱动登录流程（推荐用于短生命周期脚本）：
   ```bash
   curl -c jar -X POST https://mssp.../api/auth/login \
     -H 'Content-Type: application/json' \
     -d '{"email":"admin@example","password":"..."}'
   curl -b jar https://mssp.../api/mssp/tenants
   ```
2. 签发长生命周期 API 令牌（计划中；尚未在 UI 中暴露）。目前，唯一的非 cookie
   调用方是每租户的 **adapter** 和 **runs-worker** pod，它们使用 API 签发并轮换的
   租户范围令牌向 `/api/internal/*` 认证（参见 [内部端点](#internal-endpoints)）。

在 `SOCTALK_AUTH_MODE=proxy` 下，API 信任上游的 `X-Forwarded-User` /
`X-Forwarded-Email` / `X-Forwarded-Groups` 头，并且 **整个** 会话认证接口面都会被
卸载 —— `/api/auth/*`（`login`、`logout`、`me`、`assume-tenant`、`password/change`）
**以及** `/api/mssp/users/{id}/password/reset` 都返回 404（而非 405）。身份接口面
由你的 IdP 掌控。

## CSRF

CSRF 是 **全局** 强制执行的，而非按前缀执行：`internal_session_middleware` 会对
**每一个** 携带会话 cookie 的状态变更请求（`POST` / `PUT` / `PATCH` / `DELETE`）
校验 `Origin` / `Referer` 头。这是 **头部校验**，而非双重提交 cookie 令牌（该模式
曾出现在早期草稿中，但运行时使用的是头部校验）。可接受的来源来自
`SOCTALK_PUBLIC_ORIGIN`（以及用于 slug 通配符客户主机的 `SOCTALK_PUBLIC_ORIGIN_BASE`），
它们由 chart 从 `ingress.hostnames` 派生。**不** 携带会话 cookie 的请求（例如
adapter/worker 的 bearer 令牌调用，或登录请求本身）不受此限制。浏览器会自动发送
`Origin`；非浏览器客户端可以采用以下两种方式之一：

- 将 `Origin` 匹配到某个可接受的主机名，或
- 设置 `Host: <accepted-hostname>` + `Origin: https://<accepted-hostname>`，
  无论实际的 TCP 目标是什么（[`firstboot.sh`](https://github.com/soctalk/soctalk/blob/main/infra/packer/scripts/firstboot.sh) 的初始入驻步骤就使用了这个技巧）。

## 常见流程

### 入驻租户

```bash
curl -b jar -X POST https://mssp.../api/mssp/tenants/onboard \
  -H 'Content-Type: application/json' \
  -d '{
    "slug": "acme-corp",
    "display_name": "Acme Corp",
    "profile": "persistent"
  }'
```

`profile` 会在服务端针对 `^(poc|persistent|provided)$` 进行校验。各值的语义参见
[租户生命周期 / profiles](/zh-cn/tenant-lifecycle#profiles)。对于 `provided`
（BYO-Wazuh），载荷还额外要求一个 `external_siem` 对象（indexer URL、Manager API
URL、basic-auth 凭据）以及一个每租户的 `llm_api_key`；如有缺失，服务端会返回 422
并附带字段级错误。

返回 202 及新租户 ID。观察 `GET /api/mssp/tenants/{id}` 以获取状态转换，或轮询
`GET /api/mssp/tenants/{id}/events` 以获取生命周期事件列表。（`/api/events/stream`
存在，但在本版本中仅发出 keep-alive ping。）

### 获取审计日志

```bash
curl -b jar 'https://mssp.../api/audit?start_date=2026-01-01T00:00:00Z&end_date=2026-02-01T00:00:00Z&event_type=review.completed&page=1&page_size=50'
```

审计路由是顶级路由（`/api/audit`），而不在 `/api/mssp/` 之下。过滤条件：
`start_date` / `end_date`（ISO 8601）、`event_type`、`aggregate_type` 以及
`investigation_id`。结果通过 `page` / `page_size` 进行偏移分页。

### 提交人工审查裁决

审查路由为每种裁决暴露一个端点（没有单一的 `/decision` 路径）。请选择对应的那个：

```bash
# Approve — payload field is `feedback` (free-text), not `rationale`
curl -b jar -X POST https://mssp.../api/review/<review-id>/approve \
  -H 'Content-Type: application/json' \
  -d '{"feedback":"Confirmed brute-force pattern."}'

# Reject — closes the case as auto_closed_fp; `feedback` is optional
curl -b jar -X POST https://mssp.../api/review/<review-id>/reject \
  -d '{"feedback":"Looks like a known scanner; benign."}'

# Need more info — payload is `questions: list[str]` (each renders as a bullet)
curl -b jar -X POST https://mssp.../api/review/<review-id>/request-info \
  -d '{"questions":["What is the source IP geo?","Any prior alerts on this user?"]}'

# Expire — retire a pending review without a verdict (optional reason)
curl -b jar -X POST https://mssp.../api/review/<review-id>/expire \
  -d '{"reason":"superseded by newer investigation"}'
```

如果审查不再处于 `pending` 状态，这四个端点都会返回 409。

对于 IR 提案（case 管理接口面），对应的端点位于
`/api/mssp/proposals/{id}/approve` 和 `/api/mssp/proposals/{id}/reject`。

### 流式接收事件

```bash
curl -N -b jar 'https://mssp.../api/events/stream'
```

Server-Sent Events。**在本版本中，该流仅发出 keep-alive ping**（大约每 25 秒
一个 `ping`）—— 广播领域事件（调查更新、租户生命周期等）尚在路线图上。目前请将该
端点视为一个线路级连通性测试。

## 生成 Python 客户端

该 schema 可以干净地生成代码，因此从 Python 调用 API 最快的方式是用
[openapi-python-client](https://github.com/openapi-generators/openapi-python-client)
生成一个带类型的客户端，而不是手写请求。下面是一个端到端示例，读取调查记录。

### 1. 生成并安装客户端

```bash
pip install openapi-python-client
openapi-python-client generate \
  --url https://mssp.your-mssp.example/api/openapi.json --meta setup
pip install ./soc-talk-v1-client   # package name derives from the schema title
```

### 2. 消费调查记录

```python
import httpx
from soc_talk_v1_client import Client
from soc_talk_v1_client.api.investigations_bridge import (
    list_investigations_api_investigations_get as list_investigations,
    get_investigation_api_investigations_investigation_id_get as get_investigation,
)

BASE = "https://mssp.your-mssp.example"

# 1. Log in for a session cookie (the investigations routes take a session).
with httpx.Client(base_url=BASE) as h:
    h.post("/api/auth/login",
           json={"email": "admin@example", "password": "..."}).raise_for_status()
    session = h.cookies["soctalk_session"]

# 2. Drive the generated, typed client with that cookie.
client = Client(base_url=BASE, cookies={"soctalk_session": session})

page = list_investigations.sync(client=client, page=1, page_size=5)  # -> InvestigationList
print(f"{page.total} investigations")
for inv in page.items:                                               # -> Investigation
    print(inv.id, inv.status, inv.max_severity, inv.title)

detail = get_investigation.sync(client=client, investigation_id=str(page.items[0].id))
print(detail.phase, detail.alert_count, detail.verdict_decision)
```

这些端点函数以 FastAPI 从路由派生的 operationId 命名
（`list_investigations_api_investigations_get`）—— 如上所示，在导入时为它们起别名以
提升可读性。`sync()` 返回反序列化后的模型（`InvestigationList`，其 `.items` 为
`Investigation`）；如果你需要状态码，`sync_detailed()` 会返回带状态码的原始
`Response`。

一个可运行的版本 —— 生成、登录、列出并读取 —— 作为代码生成冒烟测试
[`tests/e2e/smoke_openapi_client.py`](https://github.com/soctalk/soctalk/blob/main/tests/e2e/smoke_openapi_client.py)
一起发布，部署流水线会针对实时 API 运行它，因此一旦 schema 无法再生成可用的
客户端，构建就会失败。

## 内部端点（`/api/internal/*`）

由每租户的 adapter 和 runs-worker 使用（参见上方目录中的 `internal-adapter` 和
`internal-worker` 分组）。不供人类调用 —— 列出它们只是为了让 MSSP 能看清这些 pod
在做什么。

每次调用都携带一个租户范围的令牌，该令牌由 API 在预配时签发，并在其过期前
**自动续期**（adapter 令牌有效期 7 天，worker 令牌 30 天；控制平面会在该窗口内
提前重新签发）。令牌与租户绑定 —— adapter 只能对自己租户的 URL 进行操作。

## 速率限制

在本版本中，API 本身不对每个路由施加速率限制。如有需要，请使用 ingress 层进行
全局速率限制（Traefik 中间件、ingress-nginx 注解）。

## 版本管理

OpenAPI 文档携带应用版本。我们力求在一个 minor 版本内只做增量变更；破坏性变更仅在
major 版本升级时发生。[发布说明](https://github.com/soctalk/soctalk/releases)
会列出每一项影响 API 的变更。

## 源码指引

所有路由都位于 `src/soctalk/core/api/` 下。

| 概念 | 文件 |
|---|---|
| Auth 路由 + 会话中间件 | [`core/api/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/auth.py), [`core/auth/middleware.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/auth/middleware.py) |
| MSSP 租户生命周期 | [`core/api/tenants.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/tenants.py) |
| 每租户 LLM 配置 | [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py) |
| 调查 / IR / 提案 | [`core/api/investigations_bridge.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/investigations_bridge.py), [`core/api/ir.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/ir.py) |
| 审计 / 审查 / 分析 / 设置 / 事件（存根） | [`core/api/legacy_stubs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/legacy_stubs.py) |
| Chat | [`core/api/chat.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/chat.py) |
| Worker（内部）路由 | [`core/api/worker_runs.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/worker_runs.py) |
| Adapter（内部）路由 | [`core/api/adapter.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/adapter.py) |
| OpenAPI 生成器 | [`scripts/dump_openapi.py`](https://github.com/soctalk/soctalk/blob/main/scripts/dump_openapi.py) |
