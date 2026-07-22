# 安装

面向 MSSP 集群管理员。涵盖集群前置条件、`soctalk-system` chart 安装以及首个客户的接入。

**第一次尝试？请改用[演示 VM](/zh-cn/quickstart-vm)。** 它是单镜像安装，带有基于浏览器的向导——通往可运行系统的路径要快得多。本页面介绍的是生产路径：K3s + Cilium + cert-manager + 你自己的 ingress 控制器。

**只用 1-3 个租户做评估？** [Launchpad](/zh-cn/launchpad) 端到端地自动化多租户试点（VM + Tailscale + 本安装程序 + 租户接入）。等你要搭建正式环境时再回到这里。

## 在云端 Ubuntu VM 上快速安装（一条命令）

对于运行在裸 Ubuntu 24.04 VM（云端或本地）上的单节点 MSSP 控制平面，[演示 VM](/zh-cn/quickstart-vm) 内置的同一份 `install.sh` 可以作为一条命令的安装程序使用。它会引导安装 k3s + Helm，从 GHCR 拉取 soctalk-system OCI chart，并一步到位地写入管理员 / LLM 密钥。

通过环境变量设置安装配置（任意子集即可，其余会提示输入）——当 `SOCTALK_MSSP_NAME`、`SOCTALK_ADMIN_EMAIL`、`SOCTALK_ADMIN_PASSWORD` **三者全部**存在时，安装程序会跳过其同意提示，从而使无人值守的 `curl | bash` 流程无需 `-y` 也能工作：

```bash
export SOCTALK_MSSP_NAME="Acme MSSP"
export SOCTALK_ADMIN_EMAIL="admin@acme.example"
export SOCTALK_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SOCTALK_HOSTNAME="soctalk.acme.example"      # what the dashboard URL will be
export SOCTALK_LLM_PROVIDER="anthropic"             # or openai-compatible
export SOCTALK_LLM_API_KEY="sk-..."                 # OR --llm-key-file <path>

curl -sfL https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh | bash
```

值得了解的标志：`--yes` / `-y`（环境变量不完整时假定为 yes）、`--demo`（随机管理员密码 + 自动接入一个演示租户——最快的“先给我看看”路径；无需任何环境变量）、`--chart-version <v>`（锁定特定的 chart 发行版本）、`--chart-dir <path>` / `--values-file <path>`（离线 / 隔离网络）。完整参考：`install.sh --help`。

该脚本会将 `SOCTALK_HOSTNAME` 传播到 chart 的 `ingress.hostnames.mssp`，chart 进而派生出 `SOCTALK_PUBLIC_ORIGIN`（CSRF）和 `SOCTALK_L1_PUBLIC_URL`（租户云代理用于 `/register` 的 URL）。无需在 api Deployment 上手动摆弄环境变量。

如果你需要更精细的控制——非默认的 ingress 控制器、独立的客户主机名、cert-manager `ClusterIssuer` 等——请改用下方的 Helm 路径。

## 集群前置条件

在安装 `soctalk-system` 之前，每个 K3s 集群安装一次这些组件。SocTalk 要求 Kubernetes 1.30+，因为系统 chart 会为租户命名空间操作安装一个原生的 `ValidatingAdmissionPolicy` 护栏。

### K3s 搭配 Cilium

```bash
# Production K3s: disable flannel + kube-proxy + traefik so Cilium (CNI)
# and your chosen ingress controller take over. The demo VM image uses
# the *bundled* Traefik instead — that's intentional for a zero-config
# single-box install but not what you want for production.
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC=" \
  --flannel-backend=none \
  --disable-network-policy \
  --disable-kube-proxy \
  --disable=traefik \
" sh -

# Install Cilium.
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium --version 1.15.x \
  --namespace kube-system \
  --set kubeProxyReplacement=true \
  --set k8sServiceHost=<node-ip> \
  --set k8sServicePort=6443 \
  --set hubble.relay.enabled=true \
  --set hubble.ui.enabled=true

# Verify.
cilium status
```

### cert-manager

```bash
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager --create-namespace \
  --version v1.14.x \
  --set installCRDs=true
```

配置一个适合你所在环境的 `ClusterIssuer`（Let's Encrypt、内部 CA，或用于开发的自签名证书）。

SocTalk 的默认 values 会为客户 UI 请求一个通配符主机（`*.customers.your-mssp.example`），而 Let's Encrypt 只会通过 DNS-01 签发通配符证书。请对托管你的区域的提供商使用 DNS-01 求解器。以 Cloudflare 为例：

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata: { name: letsencrypt-prod }
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: ops@your-mssp.example
    privateKeySecretRef: { name: letsencrypt-prod }
    solvers:
      - selector:
          dnsZones:
            - your-mssp.example
        dns01:
          cloudflare:
            email: ops@your-mssp.example
            apiTokenSecretRef:
              name: cloudflare-api-token
              key: api-token
```

cert-manager 为 Route 53、Cloud DNS、Azure DNS、RFC 2136 等提供了求解器配方。请选择适合你区域提供商的那一个。

> 如果你不需要通配符客户主机名（即你逐个枚举客户主机），则可以改用 HTTP-01，配置为 `solvers: [- http01: { ingress: { class: traefik } }]`。`soctalk-system` values 默认为 `className: traefik`；ACME 求解器的 `ingress.class`（HTTP-01）或 DNS 提供商必须与 chart 的 ingress class 匹配。对于 ingress-nginx，请在两侧都设置 `class: nginx`。

### Ingress 控制器

K3s 没有随我们一起附带 Traefik（我们在上面已禁用它）。请安装你偏好的 ingress：

```bash
# Option A: Traefik v3
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n ingress-system --create-namespace

# Option B: ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-system --create-namespace
```

为 NetworkPolicy 给 ingress 命名空间打标签：

```bash
kubectl label namespace ingress-system managed-by=ingress
```

### 认证模式

API 在启动时读取 `SOCTALK_AUTH_MODE`（`internal | proxy`）。`soctalk-system` chart 以 `internal` 模式部署：SocTalk 自行负责登录、会话和密码存储，bootstrap Job 会向一个 Secret 中写入一个初始管理员（参见[运行 bootstrap](#run-the-bootstrap)）。

`proxy` 模式——在 SocTalk 前面架设 OAuth2-Proxy / Keycloak / Dex 并信任上游身份标头——运行时已支持，但尚未作为 chart values 的开关暴露出来。请将其视为未来版本的事项；如果你运营着中心化 SSO 并想现在试点它，请在安装后直接在 API Deployment 上设置该环境变量。

完整细节：[内部认证](/zh-cn/reference/internal-auth)。

### StorageClass

任何动态制备器都可以工作。对于 K3s 默认情况，`local-path` 已预装。对于生产环境，请使用 Longhorn、Rook/Ceph 或云提供商的 CSI。请确保其中一个被标记为 `storageclass.kubernetes.io/is-default-class=true`。

## 安装 SocTalk

### 准备 values

创建 `soctalk-system-values.yaml`：

```yaml
install:
  msspId: "<uuid>"         # generate: uuidgen | tr A-Z a-z
  msspName: "Your MSSP"
  installId: "<uuid>"
  installLabel: "pilot-prod"

image:
  registry: ghcr.io/soctalk
  tag: "0.2.0"

ingress:
  enabled: true
  className: traefik          # chart default; set to "nginx" for ingress-nginx
  tls:
    issuerRef: letsencrypt-prod
    secretName: soctalk-tls
  hostnames:
    mssp: mssp.your-mssp.example
    customer: "*.customers.your-mssp.example"

# Auth knobs the chart accepts today. See the Authentication mode
# section above for proxy mode (not yet wired through values).
auth:
  cookieSecure: true          # production TLS: keep true; HTTP-only dev: false

# Trusted headers and proxy CIDRs are read by the API only in proxy
# mode (which today requires a manual env-var override after install).
# Defaults shown for reference; safe to omit when running internal mode.
oidc:
  trustedHeaderUser: X-Forwarded-User
  trustedHeaderEmail: X-Forwarded-Email
  trustedHeaderGroups: X-Forwarded-Groups
  trustedProxyCIDRs:
    - 10.42.0.0/16   # your pod CIDR / ingress CIDR

postgres:
  enabled: true
  storage: { size: 20Gi }

# Required if you want a working sign-in on first install. The chart's
# db-init container creates this user inline; without it, no admin
# exists and `soctalk-auth set-password` (which only updates existing
# users) has nothing to update.
install:
  bootstrapAdmin:
    email: "ops@your-mssp.example"
    password: "changeMe-please-rotate"   # rotate via `soctalk-auth set-password` after first sign-in
    displayName: "MSSP Admin"
    # Production alternative: leave password empty and set
    # existingSecret to a pre-provisioned Secret with key `password`
    # so the credential never passes through helm values.
    # existingSecret: "my-bootstrap-admin"
```

### 安装

```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version 0.2.0 \
  --namespace soctalk-system --create-namespace \
  -f soctalk-system-values.yaml
```

chart 的预安装 Job 会校验集群前置条件，若缺少任何一项则会快速失败。

### 迁移与 bootstrap 自动运行

两者都在 API pod 的 init 命令中、FastAPI 应用启动之前发生：

1. 等待 Postgres 接受连接。
2. `alembic upgrade head` 以迁移到最新的 schema。
3. 绑定每个角色的密码（`soctalk_app`、`soctalk_mssp`）。
4. 根据 `install.msspId` / `install.msspName` 写入 Organization 行。
5. 如果 values 中设置了 `install.bootstrapAdmin.email` 和 `install.bootstrapAdmin.password`，则以 `mssp_admin` 身份 upsert 该用户，`must_change=false` 并使用所提供的密码。

因此，如果你把 bootstrap 管理员凭据放进了 values，**API 启动时管理员就已创建完毕**——无需再运行额外的 Job。

该 chart **不**附带单独的 Alembic Job；本页面上一版本描述过一个并不存在的 Job。迁移与 API pod 的生命周期绑定。观察它们：

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

升级时，删除 API pod 会重新运行迁移（alembic 是幂等的，因此在未更改的 DB 上重新运行是空操作）。

如果你在 values 中**没有**提供 `install.bootstrapAdmin.password`，请在安装后设置管理员密码：

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password <admin-email>
```

在 `proxy` 认证模式下，密码相关端点不会被挂载。**首次已认证请求时的 JIT 用户制备在 V1 中未实现**——你必须在任何经代理认证的请求能够成功之前，手动写入首个 MSSP 用户（例如通过对 API pod 执行 `kubectl exec`，并针对 `users` 表直接执行 SQL `INSERT`）。真正的 JIT 路径已在规划中。

## 验证安装

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace soctalk-system
```

用 bootstrap 管理员在 `https://mssp.your-mssp.example` 登录。你应该会进入 MSSP 仪表盘：

![MSSP dashboard](/screenshots/mssp-dashboard.png)

要浏览从此往后你会看到的每一个界面，请阅读 [MSSP UI 导览](/zh-cn/mssp-ui)。

## 接入首个客户

在 MSSP UI 中进入 **Tenants → New tenant**。接入表单会收集：slug、显示名称、profile（`poc` | `persistent` | `provided`）、联系邮箱、品牌信息，以及可选的 LLM base URL + 模型覆盖项。客户查看者（customer-viewer）邀请**不**在该表单中——那是在租户到达 `active` 之后配置的。制备是异步运行的；刷新详情页即可看到新的生命周期事件出现在事件表中。（实时事件流已在规划中；`/api/events/stream` 已存在，但本版本中仅发送 ping。）如果你选择 `provided`（BYO Wazuh），表单还会额外要求外部 indexer + Manager API URL 和凭据，以及每租户的 LLM 密钥——参见[租户生命周期 / provided](/zh-cn/tenant-lifecycle#provided)。

![Tenants list](/screenshots/tenants-list.png)

租户到达 `active` 之后：

1. 通过 **Customer → Settings → LLM** 更新该租户的 LLM API 密钥。
2. 按照 [Wazuh Ingress](/zh-cn/reference/wazuh-ingress) 配置 Wazuh 代理 ingress。
3. 将客户 UI 的 URL 和初始 `customer_viewer` 邀请分享给最终客户。

然后验证：

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# Tenant namespace exists and data plane is Ready
kubectl -n tenant-<slug> get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace tenant-<slug> --verdict DROPPED
```

## 下一步

- [日常运维](/zh-cn/operations)，了解 day-2 任务。
- [升级](/zh-cn/upgrades)，了解安装级别和每租户的升级。
- [Wazuh Ingress](/zh-cn/reference/wazuh-ingress)，了解客户代理接入。
