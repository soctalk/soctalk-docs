# Install

For MSSP cluster admins. Covers cluster prerequisites, the `soctalk-system` chart install, and onboarding the first customer.

**Trying it for the first time? Use the [demo VM](/quickstart-vm) instead.** It's a single-image install with a browser-based wizard — much faster path to a running system. This page is the production path: K3s + Cilium + cert-manager + your own ingress controller.

**Evaluating with 1-3 tenants?** [Launchpad](/launchpad) automates the multi-tenant pilot end-to-end (VMs + Tailscale + this installer + tenant onboard). Come back here when you're building the real thing.

## Quick install on a cloud Ubuntu VM (one-command)

For a single-node MSSP control plane on a bare Ubuntu 24.04 VM (cloud or on-prem), the same `install.sh` the [demo VM](/quickstart-vm) bakes in is reachable as a one-command installer. It bootstraps k3s + Helm, pulls the soctalk-system OCI chart from GHCR, and seeds the admin / LLM secrets in one step.

Set the install config via env (any subset; the rest is prompted) — when **all three** of `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL`, `SOCTALK_ADMIN_PASSWORD` are present the installer skips its consent prompt so unattended `curl | bash` flows work without `-y`:

```bash
export SOCTALK_MSSP_NAME="Acme MSSP"
export SOCTALK_ADMIN_EMAIL="admin@acme.example"
export SOCTALK_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SOCTALK_HOSTNAME="soctalk.acme.example"      # what the dashboard URL will be
export SOCTALK_LLM_PROVIDER="anthropic"             # or openai-compatible
export SOCTALK_LLM_API_KEY="sk-..."                 # OR --llm-key-file <path>

curl -sfL https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh | bash
```

Flags worth knowing about: `--yes` / `-y` (assume-yes when env is partial), `--demo` (random admin password + auto-onboards a demo tenant — fastest "just show me" path; no env required), `--chart-version <v>` (pin a specific chart release), `--chart-dir <path>` / `--values-file <path>` (offline / air-gapped). Full reference: `install.sh --help`.

The script propagates `SOCTALK_HOSTNAME` into the chart's `ingress.hostnames.mssp` and the chart in turn derives `SOCTALK_PUBLIC_ORIGIN` (CSRF) and `SOCTALK_L1_PUBLIC_URL` (the URL the tenant cloud-agent uses for `/register`). No manual env-var fiddling on the api Deployment required.

If you need finer control — non-default ingress controller, separate customer hostname, cert-manager `ClusterIssuer`, etc. — use the Helm path below instead.

## Cluster prerequisites

Install these once per K3s cluster before `soctalk-system`. SocTalk expects Kubernetes 1.30+ because the system chart installs a native `ValidatingAdmissionPolicy` guard for tenant namespace operations.

### K3s with Cilium

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

Configure a `ClusterIssuer` appropriate for your environment (Let's Encrypt, internal CA, or self-signed for dev).

The default SocTalk values request a wildcard host for customer UIs (`*.customers.your-mssp.example`), and Let's Encrypt only issues wildcards over DNS-01. Use a DNS-01 solver with the provider that hosts your zone. Example for Cloudflare:

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

cert-manager has solver recipes for Route 53, Cloud DNS, Azure DNS, RFC 2136, and others. Pick the one for your zone provider.

> If you do not need wildcard customer hostnames (i.e., you enumerate customer hosts individually), you can use HTTP-01 with `solvers: [- http01: { ingress: { class: traefik } }]` instead. The `soctalk-system` values default to `className: traefik`; the ACME solver's `ingress.class` (HTTP-01) or DNS provider must match the chart's ingress class. For ingress-nginx, set `class: nginx` on both sides.

### Ingress controller

K3s does not ship Traefik with us (we disabled it above). Install your preferred ingress:

```bash
# Option A: Traefik v3
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n ingress-system --create-namespace

# Option B: ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-system --create-namespace
```

Label the ingress namespace for NetworkPolicy:

```bash
kubectl label namespace ingress-system managed-by=ingress
```

### Authentication mode

The API reads `SOCTALK_AUTH_MODE` (`internal | proxy`) at startup. The `soctalk-system` chart deploys in `internal` mode: SocTalk owns login, sessions, and password storage, and the bootstrap Job seeds an initial admin into a Secret (see [Run the bootstrap](#run-the-bootstrap)).

`proxy` mode — front SocTalk with OAuth2-Proxy / Keycloak / Dex and trust upstream identity headers — is supported by the runtime but not yet exposed as a chart values knob. Treat it as a future-release item; if you operate central SSO and want to pilot it now, set the env var directly on the API Deployment after install.

Full details: [Internal auth](/reference/internal-auth).

### StorageClass

Any dynamic provisioner works. For K3s default, `local-path` is pre-installed. For production, use Longhorn, Rook/Ceph, or a cloud-provider CSI. Ensure one is marked `storageclass.kubernetes.io/is-default-class=true`.

## Install SocTalk

### Prepare values

Create `soctalk-system-values.yaml`:

```yaml
install:
  msspId: "<uuid>"         # generate: uuidgen | tr A-Z a-z
  msspName: "Your MSSP"
  installId: "<uuid>"
  installLabel: "pilot-prod"

image:
  registry: ghcr.io/soctalk
  tag: "0.1.4"

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

### Install

```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version 0.1.4 \
  --namespace soctalk-system --create-namespace \
  -f soctalk-system-values.yaml
```

The chart's pre-install Job verifies cluster prerequisites and fails fast if any are missing.

### Migrations and bootstrap run automatically

Both happen inside the API pod's init command before the FastAPI app starts:

1. Wait for Postgres to accept connections.
2. `alembic upgrade head` to migrate to the latest schema.
3. Bind per-role passwords (`soctalk_app`, `soctalk_mssp`).
4. Seed the Organization row from `install.msspId` / `install.msspName`.
5. If `install.bootstrapAdmin.email` and `install.bootstrapAdmin.password` are set in values, upsert the user as `mssp_admin` with `must_change=false` and the supplied password.

So if you put the bootstrap admin credentials in values, **the API comes up with the admin already created** — no extra Job to run.

The chart does **not** ship a separate Alembic Job; the previous edition of this page described one that didn't exist. Migrations are tied to the API pod's lifecycle. Watching them:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

On an upgrade, deleting the API pod re-runs the migration (alembic is idempotent, so re-running on an unchanged DB is a no-op).

If you did NOT supply `install.bootstrapAdmin.password` in values, set the admin password after install:

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password <admin-email>
```

In `proxy` auth mode, password endpoints are not mounted. **JIT user provisioning on first authenticated request is not implemented in V1** — you must seed the first MSSP user manually (e.g., via `kubectl exec` on the API pod and direct SQL `INSERT` against the `users` table) before any proxy-authenticated request can succeed. A real JIT path is on the roadmap.

## Verify the install

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace soctalk-system
```

Sign in at `https://mssp.your-mssp.example` with the bootstrap admin. You should land on the MSSP dashboard:

![MSSP dashboard](/screenshots/mssp-dashboard.png)

For a tour of every screen you'll see from here on, read the [MSSP UI Tour](/mssp-ui).

## Onboard the first customer

In the MSSP UI go to **Tenants → New tenant**. The onboarding form collects: slug, display name, profile (`poc` | `persistent` | `provided`), contact email, branding, and optional LLM base URL + model overrides. Customer-viewer invites are **not** in the form — that's configured after the tenant reaches `active`. Provisioning runs asynchronously; refresh the detail page to see new lifecycle events appear in the events table. (A live event stream is on the roadmap; `/api/events/stream` exists but emits pings only in this release.) If you pick `provided` (BYO Wazuh), the form additionally requires the external indexer + Manager API URLs and credentials plus a per-tenant LLM key — see [tenant lifecycle / provided](/tenant-lifecycle#provided).

![Tenants list](/screenshots/tenants-list.png)

After the tenant reaches `active`:

1. Update the tenant's LLM API key via **Customer → Settings → LLM**.
2. Configure Wazuh agent ingress per [Wazuh Ingress](/reference/wazuh-ingress).
3. Share the customer UI URL and initial `customer_viewer` invite with the end-customer.

Then verify:

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# Tenant namespace exists and data plane is Ready
kubectl -n tenant-<slug> get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace tenant-<slug> --verdict DROPPED
```

## Next

- [Daily Operations](/operations) for day-2 tasks.
- [Upgrades](/upgrades) for install-level and per-tenant upgrades.
- [Wazuh Ingress](/reference/wazuh-ingress) for customer agent onboarding.
