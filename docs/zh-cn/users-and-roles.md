# 用户与角色

角色如何运作、谁能做什么，以及管理员如何创建用户、分发客户门户和轮换密码。要通过截图逐步了解配置流程与用户生命周期，请参阅 [用户管理：操作演练](/zh-cn/manage-users)。协议层面的参考请参阅 [内部认证](/zh-cn/reference/internal-auth)，按资源划分的角色矩阵请参阅 [安全模型](/zh-cn/reference/security-model)。

## 访问权限如何裁定

访问权限正在转向能力（capability）模型。每个角色都是一组具名能力的集合，为其构建或重构的界面（操作与审查流程、聊天、面向交战活动的租户自助服务、授权事实以及用户管理）请求它们所需的能力，而非某个特定角色。在这些路由上，新增一个角色只需定义其能力集合即可，调用点无需改动。其他路由仍直接按角色或受众设门槛，包括 MSSP 租户管理、LLM 与品牌化配置、管理员密码重置，以及若干仪表盘、分析和调查路由。这些路由在角色变更时需要手动更新。请将基于能力的访问视为发展方向，而非当今的普适现状。

角色按层级（tier）组织，业务双方存在相同的操作层级：

- **operate（操作）**：处理队列。查看和分诊调查、审查 AI 的裁决、做出决定、批准标准冲击范围（standard-blast）提案、使用聊天。
- **authorize risk（授权风险）**：operate 能做的一切，外加声明渗透测试交战活动、维护授权事实，以及为写入外部系统的高冲击范围（high-blast）操作签核。
- **configure（配置）**：manager 能做的一切，外加该角色所控制的设置，以及用户管理。

较高的层级拥有其下层级的每一项能力。租户侧在 operate 之下再增加一个层级，即一个只读的相关方（`customer_viewer`），只能查看而不能操作；MSSP 侧没有对应角色，因为其最低角色（`analyst`）已经具备操作能力。

受众（audience）是叠加在层级之上的另一道墙。MSSP 角色只拥有 MSSP 能力，租户角色只拥有租户能力；两组能力从不重叠。能力护栏会同时检查能力与受众，因此 MSSP 能力永远无法满足某个租户路由，反之亦然。例如，这正是为什么 `platform_admin` 拥有每一项 MSSP 能力，却不拥有任何一项租户能力。

## 角色目录

**MSSP 侧**（服务提供方的员工；`tenant_id` 为 null）：

| 角色 | 层级 | 可执行操作 |
|---|---|---|
| `platform_admin` | configure（超级） | 全安装范围内的每一项 MSSP 能力。 |
| `mssp_admin` | configure | 配置系统、管理用户，外加以下全部。 |
| `mssp_manager` | authorize risk | 声明交战活动、维护授权事实、为高冲击范围操作签核，外加 operate。 |
| `analyst` | operate | 分诊调查、审查裁决、做出决定、聊天。通过固定（pin）一个租户，一次处理一个客户（见下文的“模拟”）；对设置为只读。 |

**租户侧**（某客户的员工；已设置 `tenant_id`；限定于该单一租户）：

| 角色 | 层级 | 可执行操作 |
|---|---|---|
| `tenant_admin` | configure | 管理本组织自己的用户及本组织自己的 LLM 设置，外加以下全部。在租户入驻期间由运行时的 `_mint_tenant_admin_user` 流程自动配置。 |
| `tenant_manager` | authorize risk | 声明本组织自己的渗透测试交战活动、断言授权事实（这些事实在生效前会进入 MSSP 审查）、为高冲击范围操作签核，外加 operate。 |
| `tenant_analyst` | operate | 处理本租户自己的 SOC：分诊、审查裁决、做出决定、批准标准冲击范围提案、聊天。这是共管 SOC（co-managed-SOC）角色，是 `analyst` 在租户侧的镜像。 |
| `customer_viewer` | view only（仅查看） | 只读相关方。可查看客户自己的 SOC 仪表盘和调查，但不能对其操作，也不能打开审查队列。 |

`tenant_admin` 的“configure”层级范围很窄：相对 manager，它仅增加本组织自己的 LLM 配置和用户管理，除此之外别无其他。品牌化与集成仍归属于 MSSP 侧。

初始管理员由 API pod 的 init 命令内联创建（由 chart values 中的 `install.bootstrapAdmin.email` 和 `install.bootstrapAdmin.password` 驱动），身份为 `mssp_admin` 且 `must_change=false`。[安装向导](/zh-cn/setup-wizard) 会在首次启动期间填入这些值。

## customer-viewer 与 tenant-analyst 的区分

`customer_viewer` 和 `tenant_analyst` 都属于租户侧，但它们是不同的岗位。`customer_viewer` 负责观察：仪表盘和调查状态，仅此而已。它不能裁定审查、使用聊天，也不能列出待审查队列。`tenant_analyst` 负责操作：它在本租户自己的告警上运行客户自己的 SOC。把 viewer 分配给需要可见性的人，把 analyst 分配给实际干活的人。

待审查队列也相应地设了门槛。列出或打开一项审查需要审查权限，该权限由 MSSP 的 `analyst` 及以上角色以及 `tenant_analyst` 及以上角色持有。租户操作者只能看到本租户自己的队列。跨租户审查读取仅限 `platform_admin`、`mssp_admin` 和 `mssp_manager`；MSSP 的 `analyst` 在固定到某个租户后可读取该租户的队列。

## 创建租户用户

`tenant_admin` 为本组织自己配置登录账号。正是这一点让租户角色变得可用；否则，一个租户将只拥有入驻时创建的那个唯一管理员。

在客户 UI 中，打开侧边栏的 **Users**（仅 `tenant_admin` 可见），然后点击 **Add user**：输入邮箱、选择角色并提交。面板会返回一个一次性临时密码。复制它并通过带外方式交给用户；它只显示一次，永远无法以明文形式再次取回。用户在首次登录时会被要求更改密码。

同样的操作也可通过 API 完成：

```bash
curl -X POST 'https://<customer-host>/api/tenant/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@customer.example","role":"tenant_analyst"}'
```

注意事项：

- 可分配的角色为 `customer_viewer`、`tenant_analyst`、`tenant_manager` 和 `tenant_admin`。此处不能分配 MSSP 角色；请求会被拒绝。这就是受众墙。
- 新用户始终被放入调用者自己的租户。租户取自调用者的会话，绝不取自请求体，并且数据库会强制执行这一点，因此租户管理员永远只能在自己的租户中创建用户。
- 重复的邮箱会被拒绝。邮箱在整个安装范围内唯一。
- `GET /api/tenant/users` 列出该租户自己的用户。这两个端点都要求 `tenant_manage_users` 能力，而该能力只有 `tenant_admin` 持有。

客户门户通过每租户主机访问。固定主机名来自 chart values 中的 `ingress.hostnames.customer`，而基于 slug 的每租户主机来自 `ingress.tenantWildcard`。主机名布局请参阅 [安装文档](/zh-cn/install)。

## 创建 MSSP 员工用户

`mssp_admin` 或 `platform_admin` 从 [MSSP UI](/zh-cn/mssp-ui) 的 **Staff Users** 面板，或通过 API，配置 MSSP 员工登录账号。其形态与租户侧一致。

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@your-mssp.example","role":"analyst"}'
```

注意事项：

- 可分配的角色为 `analyst`、`mssp_manager`、`mssp_admin` 和 `platform_admin`。此处不能分配租户角色（受众墙）。仅当调用者本身已是 `platform_admin` 时，才允许分配 `platform_admin`。
- 新用户属于 MSSP 侧（`tenant_id` 为 null）。这些端点只会作用于 MSSP 员工记录行，因此永远无法通过它们触及租户用户。
- 响应携带一个一次性临时密码；用户在首次登录时更改它。重复的邮箱会被拒绝。
- `GET /api/mssp/users` 列出员工。所有这些都要求 `manage_users` 能力，该能力只有 `mssp_admin` 和 `platform_admin` 持有。

`soctalk-auth set-password`（该 CLI）仍存在，用于引导和离线场景：它为已有用户设置密码、清除 `must_change` 并审计该变更，但不会创建用户记录行，也不会撤销会话。

## 更改角色、停用、重新激活

双方暴露相同的生命周期。租户侧由 `tenant_admin` 管理本组织；MSSP 侧由 `mssp_admin`/`platform_admin` 管理员工。

- **更改角色**：从行内选择器中选择一个新角色，或使用 `PATCH /api/tenant/users/{id}`（或 `/api/mssp/users/{id}`）并附带 `{"role": "..."}`。角色变更会撤销该用户的活动会话，使新角色立即生效。
- **停用**：行内的 Deactivate 按钮，或 `POST .../{id}/deactivate`。用户被置为非活动，且所有活动会话被一次性撤销，因此已登录的用户会被立即切断，而不是残留到过期为止。会话中间件也会拒绝非活动用户，从而消除与并发登录之间的竞态。
- **重新激活**：行内的 Reactivate 按钮，或 `PATCH .../{id}` 并附带 `{"active": true}`。

每次变更都适用两道护栏：

- 你不能修改自己的账号（不能自我降级或自我锁定）。
- 你不能移除最后一个活动的管理员：任何会导致某个租户没有活动 `tenant_admin`，或导致该安装没有活动 `mssp_admin`/`platform_admin`（或在存在 `platform_admin` 时没有活动 `platform_admin`）的变更，都会被拒绝。该检查会锁定候选记录行，因此并发的降级操作不可能同时通过。

已有的 `platform_admin` 账号只能由另一个 `platform_admin` 来更改、停用或重置密码。

## 密码重置

**自助服务**：本版本未实现。登录页面没有忘记密码流程，也没有邮件投递。用户需请管理员重置。

**管理员强制重置**：`mssp_admin` 或 `platform_admin` 按 id 重置任意用户的密码：

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

目标可以是 MSSP 用户或租户用户；执行者必须是 `mssp_admin` 或 `platform_admin`。响应包含一个标记为 `must_change=true` 的新 `temporary_password`，且该重置会撤销该用户的所有现有会话。分享该密码；用户在首次登录时选择一个新密码。

不存在租户侧的重置操作，因此 `tenant_admin` 无法从 UI 重置自己某个用户的密码。在该功能上线之前，可由 MSSP 管理员用上述端点重置，或由操作者在数据库记录行上重置。

## 模拟与租户上下文切换

MSSP 侧用户（`platform_admin`、`mssp_admin`、`mssp_manager`、`analyst`）可通过 `POST /api/auth/assume-tenant` 将其会话限定到某个特定租户。租户侧用户则不能；他们已被固定于自己的租户。UI 以 [MSSP UI](/zh-cn/mssp-ui) 右上角的 **Tenant: \<name\>** 徽标呈现这一点：点击某个租户会将会话固定到该客户的视图，而 **Clear** 会退回到跨租户范围。在该范围内执行的状态更改操作，以原始用户身份运行，且会话绑定到该租户。

这不是对另一个用户的模拟；会话身份保持不变。“接管某个特定用户的会话”界面已在计划中。

## 会话

| 会话存储 | Cookie 名称 | 有效期 |
|---|---|---|
| MSSP UI 会话 | `soctalk_session` | 绝对 12 小时 + 空闲 30 分钟 |
| 客户门户会话 | `soctalk_session` | 绝对 12 小时 + 空闲 30 分钟 |
| 向导会话 | `soctalk_session` | 直到向导退出 |

`POST /api/auth/logout` 仅撤销当前会话。停用某个租户用户，以及重置任意用户的密码，会撤销该用户的所有会话。要在不重置密码的情况下撤销某个 MSSP 用户的每一个会话，请直接在 Postgres 中该用户的 `sessions` 记录行上设置 `revoked_at`；目前还没有对应的管理员 API。轮换 JWT 签名密钥不会撤销基于数据库的 cookie 会话；查找依据的是数据库记录行，而非 JWT 签名。

一个只读的会话清单（`GET /api/auth/sessions`）已在计划中。

## SSO / 代理认证

运行时支持 `SOCTALK_AUTH_MODE=proxy`，此时 SocTalk 信任上游 OIDC 代理（OAuth2-Proxy、Keycloak、Dex）来对请求进行认证。身份从 `X-Forwarded-Email` 请求头解析，并按邮箱匹配到某个已有的用户记录行。认证模式本身目前并未作为 chart values 的可调项暴露；请在安装后直接在 `soctalk-system-api` Deployment 上设置该环境变量。受信任的代理 CIDR 由 chart 支持，通过 `oidc.trustedProxyCIDRs` 配置。

在代理模式下，基于密码的认证路由根本不会挂载，因此 `/api/auth/login`、`/api/auth/password/change`、管理员密码重置，以及 `/api/auth/me`、`/api/auth/logout` 和 `/api/auth/assume-tenant` 都不存在。chart 的引导 init 仍会播种 Organization 记录行，并且，如果设置了 `install.bootstrapAdmin.password`，还会播种 `mssp_admin` 用户。即使在代理模式下也请继续设置 `bootstrapAdmin`：首次通过认证的请求时的即时（just-in-time）用户配置尚未实现，因此若没有一个按邮箱匹配到你 IdP 身份的已播种用户，任何经过代理认证的请求都无法解析到用户记录行。

代理模式下的角色分配发生在数据库中的用户创建阶段。运行时信任转发的邮箱作为身份，但不读取组请求头，也不会基于组成员身份自动提权。可配置的 IdP 组到 SocTalk 角色的映射已在计划中。

完整细节：[内部认证](/zh-cn/reference/internal-auth)。

## 审计

用户创建、角色/状态变更和停用会向审计日志写入 `user.create`、`user.update` 和 `user.delete` 记录行（更新时附带变更前/后的角色和活动状态），密码重置也会被审计。请注意，UI 中当前的 `/api/audit` 视图读取的是调查事件流，而非 `audit_log` 表，因此这些用户管理记录行可直接在 `audit_log` 中查询，但尚未在该界面上显示。
