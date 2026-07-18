# 内部认证

## 1. 范围

为 SocTalk 的第一方 UI 增加一条自包含的登录路径，使运维人员无需上游 OIDC 代理即可运行。现有的授权机制（角色、`tenant_id`、位于 `src/soctalk/core/tenancy/decorators.py:120` 的装饰器、Postgres RLS）保持不变。本规范仅新增一个身份来源，它产生的 `UserIdentity` 结构与 `src/soctalk/core/tenancy/auth.py:67` 中已经消费的结构相同。

两种模式，在进程启动时选择，并在 `/health/live` 和 `/health/ready` 上呈现：

```
SOCTALK_AUTH_MODE = internal | proxy
```

- `internal`（新装的默认值）：SocTalk 自行管理登录、会话与密码存储。入口交接（ingress-handoff）中间件被禁用。
- `proxy`：保留现有的入口交接行为。内部端点返回 404。

不存在混合模式。联合身份（JIT 预配、OIDC SP 等）是一个独立的规范。

## 2. 数据模型

新增两张表。其余一切复用现有模型。

### `password_credentials`

| column               | type        | notes                                       |
| ---                  | ---         | ---                                         |
| user_id              | uuid PK, FK | 引用 `users.id`，删除时级联                  |
| password_hash        | text NOT NULL | argon2id，包含参数的完整哈希字符串         |
| must_change          | bool        | 由管理员重置时设置                          |
| updated_at           | timestamptz |                                             |
| last_used_at         | timestamptz | 最近一次成功登录                            |
| consecutive_failures | int         | 成功后重置                                  |
| locked_until         | timestamptz | 除非锁定生效，否则为 null                    |

### `sessions`

以数据库为后端的会话。Cookie 携带一个不透明的 session_id；数据库行是唯一可信来源。

| column          | type        | notes                                |
| ---             | ---         | ---                                  |
| id              | uuid PK     | 也是 cookie 的值                      |
| user_id         | uuid FK     |                                      |
| tenant_context  | uuid        | 登录时捕获的 `current_tenant`         |
| created_at      | timestamptz |                                      |
| last_seen_at    | timestamptz | 受节流更新（约 60 秒）                 |
| absolute_expiry | timestamptz | 硬上限，12 小时                       |
| idle_expiry     | timestamptz | 随活动滑动，30 分钟                   |
| revoked_at      | timestamptz | 非空则禁用该会话                      |
| ip_created      | inet        | 可观测性                             |
| user_agent      | text        | 可观测性                             |

索引：`(user_id, revoked_at)`。

### 复用

- `users`（`src/soctalk/core/tenancy/models.py:156`）——保持不变。
- `audit_log`（`src/soctalk/core/tenancy/models.py:291`）——接收 `auth.*` 动作（见 §9）。

不新增审计表。不新增签名密钥表（会话是不透明的数据库行，而非 JWT；`src/soctalk/core/tenancy/auth.py:167` 处现有的 HMAC 签名与此无关）。

## 3. 端点

全部位于 `/api/auth/*` 之下。JSON 格式。改变状态的路由按 §6 加以保护。

| method | path                                          | purpose                                |
| ---    | ---                                           | ---                                    |
| POST   | `/api/auth/login`                             | 邮箱 + 密码，设置会话 cookie            |
| POST   | `/api/auth/logout`                            | 撤销当前会话                            |
| GET    | `/api/auth/me`                                | 返回当前身份负载                        |
| POST   | `/api/auth/password/change`                   | 旧密码 + 新密码，需认证                  |
| POST   | `/api/mssp/users/{id}/password/reset`         | 管理员强制重置，设置 `must_change`       |

管理员重置端点在服务端生成一个强随机密码，并在响应体中一次性返回；管理员通过带外方式将其交给用户。基于邮件的自助重置被推迟（§12）。

在 `AUTH_MODE=proxy` 下，本表中的每个端点都返回 404。

## 4. Cookie 与会话

### Cookie

名称：`soctalk_session`。

属性：

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- 省略 `Domain`（仅限主机）
- `Max-Age` 与会话的 `absolute_expiry` 一致

值：会话 UUID 的 url-safe base64 编码。cookie 中不含任何声明（claims）。

### 生命周期

- `absolute_expiry = created_at + 12h`。硬上限。
- `idle_expiry = last_seen_at + 30m`。随活动向前滑动。
- 修改密码时：该用户的所有其他会话都被撤销；发起修改的那个会话被保留，使用户在当前设备上保持登录。
- `/api/auth/logout` 仅撤销当前会话。
- 管理员重置会撤销目标用户的所有会话。

## 5. 密码策略

- 通过 `argon2-cffi` 使用 argon2id。
- 参数：`time_cost=3`、`memory_cost=65536`（64 MiB）、`parallelism=4`、`hash_len=32`、`salt_len=16`。
- 存储的哈希字符串包含其参数；当参数漂移时，透明地进行验证并重新哈希（verify-and-rehash）。
- 最小长度：12。无组成规则。
- 锁定：15 分钟内连续失败 10 次会设置 `locked_until = now() + 15m`。计数器在成功登录后重置。
- `must_change`：由管理员重置时设置。在访问任何其他端点之前，强制用户走完修改密码流程。

## 6. CSRF

会话 cookie 上的 `SameSite=Lax` 已经阻止跨站 POST。对于改变状态的方法（`POST`、`PATCH`、`DELETE`、`PUT`），中间件还额外强制执行：

- 若存在 `Origin`，它必须匹配已配置的某个第一方来源。配置是一个列表/模式，而非单一值，因为部署同时服务 MSSP 主机（`mssp.example.com`）和一个按租户划分的通配符客户主机（`*.customers.example.com`）。单来源固定会对来自未被固定的那个 UI 的每个 POST 返回 403。
- 否则，若存在 `Referer`，其来源组件必须匹配同一份允许列表。
- 否则以 403 拒绝。

允许列表来源于 chart values 中已配置的 UI 主机名（`ingress.hostnames.mssp`、`ingress.hostnames.customer`），因此运维人员无需单独维护它。

## 7. 中间件

当 `SOCTALK_AUTH_MODE=internal` 时，新中间件 `internal_session_middleware` 取代 `ingress_handoff_middleware`。

每个请求：

1. 读取 `soctalk_session` cookie。
2. 查找会话行。若缺失、已撤销、超过 `absolute_expiry` 或超过 `idle_expiry`，则拒绝。
3. 更新 `last_seen_at`（受节流——最多每 60 秒写一次）。
4. 加载用户，并构造与该路径产生的相同的 `UserIdentity` 结构。像今天一样设置 `request.state.user_identity`，使装饰器和 RLS 上下文辅助函数保持不变。

限速：登录尝试按 IP 和按邮箱在每 15 分钟内限速，在数据库查找之前应用。beta 阶段使用进程内计数器；当需要横向扩展时改用 Redis。

## 8. UI/UX

两个第一方 UI 获得认证相关功能：MSSP 控制台（`frontend/mssp`）和客户门户（`frontend/customer`）。两者都是与同一 API 通信的 SvelteKit 应用。

### 登录页

两个应用都新增 `/login`：

- 居中卡片。两个字段（Email、Password）。单个主按钮，标签为 "Sign in."。
- 客户门户从租户的 `BrandingConfig` 读取应用名称和 logo，使页面契合 MSSP 的品牌。MSSP 控制台使用安装级别的默认品牌。
- 初始焦点在 Email 上。Enter 提交。使用标准字段名，以便浏览器密码管理器可以干净地自动填充。
- 错误状态（不进行用户枚举）：
  - 凭据无效 → "Email or password is incorrect."
  - 账户被锁定 → "This account is temporarily locked. Try again at {unlock_time}."
  - 服务器错误 → "Something went wrong. Try again."
- 下方有一行小的辅助文字："Contact your administrator if you've lost access."。本规范中没有自助重置链接。

### 强制修改（`must_change`）

当针对一个 `must_change=true` 的凭据登录成功时，服务端响应会将修改密码标示为下一步。UI 直接导航到 `/account/password`——不会闪现仪表盘。

在 `must_change` 处于设置状态时，除 `/account/password` 和 `POST /api/auth/logout` 之外的任何路由都会重定向回 `/account/password`。一个小的琥珀色横幅显示 "Your administrator requires you to set a new password before continuing."。

### 密码修改页

`/account/password`：

- 三个字段：Current password、New password、Confirm new password。
- 仅对 ≥12 长度规则提供内联校验器。没有组成强度计。
- 成功后，显示一条确认信息以及提示 "Other devices have been signed out. You're still signed in here."。
- 可从账户菜单进入，并在 `must_change` 期间为强制项。

### 账户菜单

在两个应用的页眉中，认证后可见：

- 用户邮箱。
- 角色标签（"MSSP admin"、"Analyst"、"Customer viewer" 等）。
- 指向 "Change password." 的链接。
- "Sign out"——`POST /api/auth/logout`，然后导航到 `/login` 并附带一条闪现消息 "You have been signed out."。

### 管理员重置（MSSP 控制台）

在 MSSP 控制台的用户详情页上：

- "Reset password" 按钮，按权限限定给 `platform_admin` 和 `mssp_admin`。
- 确认弹窗说明："Generates a one-time password, revokes all of this user's active sessions, and forces them to change it at next login."。
- 确认后，服务端一次性返回生成的密码。UI 将其呈现在一个可复制到剪贴板的字段中，并带有 "Copy and close."。弹窗关闭后，该密码不再可检索——管理员以带外方式共享它。

### 会话过期

- 对于返回给已认证会话的任何 401，SPA 都会导航到 `/login?expired=1&next=<current-url>`。
- 登录页读取 `expired=1` 并显示 "Your session expired. Please sign in again."。UI 中不区分绝对过期与空闲过期。
- 成功登录后，若 `next` 存在且同源，SPA 会导航到 `next`；否则导航到该 UI 的默认落地路由。

### 空状态与错误状态

- 首次加载且无会话 → 重定向到 `/login`（无闪现）。
- 已认证时访问登录页 → 重定向到默认落地路由（不要把用户困在一个他们不需要的表单上）。
- 登录期间发生网络错误 → 保留表单，内联渲染 "Couldn't reach the server. Check your connection and try again."。

### 无障碍

- 所有输入都有关联的 `<label>` 元素。错误使用 `role="alert"`，以便屏幕阅读器读出它们。
- 焦点顺序自然（email → password → submit）。
- 无 CAPTCHA。锁定加上 IP/邮箱限速已经能覆盖 MSSP 规模下的滥用；CAPTCHA 会破坏屏幕阅读器流程并增加运维开销。
- 移动端主操作的最小触摸目标为 44×44px。

## 9. 审计

向现有的 `audit_log` 发出以下 `action` 值：

- `auth.login.success`
- `auth.login.failure`（`details.reason` 取值于 `{bad_password, unknown_email, locked}`）
- `auth.logout`
- `auth.password.changed`
- `auth.password.reset.admin`（管理员触发的对另一用户的重置）
- `auth.lockout.triggered`

`actor_id` 是执行操作用户的 id，对于锁定触发则为 `system:auth`。`tenant_id` 从执行操作的用户复制而来。

## 10. 从 `proxy` 迁移到 `internal`

1. 应用创建 §2.1 和 §2.2 的迁移。现有的 `users` 行不受影响。
2. 部署新的应用版本。`SOCTALK_AUTH_MODE=proxy` 保留现有行为。
3. 对每个预期使用内部登录的用户，运维人员运行 `soctalk auth set-password <email>`（新的 CLI；写入一行 `password_credentials` 并发出 `auth.password.reset.admin`）。
4. 运维人员将 `SOCTALK_AUTH_MODE=internal` 翻转并重启。入口交接中间件从管道中移除。

回滚：把标志翻回并重启。

## 11. 测试

必备的后端测试套件（postgres-rls §9 风格）：

1. 登录顺利路径创建一行带有正确 `tenant_context` 的会话，并设置 cookie。
2. 错误密码使 `consecutive_failures` 递增；连续十次触发 `locked_until`；此后即使密码正确，尝试也被拒绝。
3. `must_change` 会阻止所有非密码端点，直到一次成功的修改。
4. 修改密码会撤销该用户的所有其他会话，但保留当前会话。
5. 登出仅撤销当前会话。
6. 管理员重置会撤销目标用户的所有会话并强制 `must_change`。
7. `AUTH_MODE=proxy`：`/api/auth/*` 和管理员重置端点返回 404。入口交接路径仍然可用。
8. CSRF：带有外来 `Origin` 的改变状态请求被以 403 拒绝。
9. 超过 `absolute_expiry` 或 `idle_expiry` 的会话被拒绝；行不会被自动删除（保留用于审计）。

针对每个 UI 的 Playwright 冒烟测试套件：

1. 使用有效凭据登录会落到默认路由并显示账户菜单。
2. 使用错误凭据登录显示通用错误，且不进行枚举。
3. 登录时的 `must_change` 会落到修改页且无法导航到别处。
4. 修改密码成功并保持登录。
5. 管理员重置弹窗一次性呈现生成的密码；关闭弹窗后将其隐藏。
6. 受保护路由上的过期会话会路由到 `/login?expired=1`，带有闪现消息并保留 `next`。

## 12. 已推迟

不属于本规范。按可能加回的顺序排列：

1. `password_reset_tokens`——基于邮件的自助密码重置。
2. MFA（TOTP + 恢复码），并在登录和账户流程中配以相应的 UI 步骤。
3. 会话清单（`GET /api/auth/sessions`、撤销特定会话、全部登出），并在账户页中配一个 "Devices" 面板。
4. 冒名登录（mssp_admin → 租户用户会话），并在冒名期间于 UI 中显示清晰的横幅。
5. OIDC SP / 联合身份（独立规范）。
6. OIDC 颁发者（独立规范；仅在出现具体消费者时）。
7. 签名密钥轮换 + JWKS（仅在我们对外颁发无状态令牌后才需要）。
