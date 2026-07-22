# Instalação

Para administradores de cluster MSSP. Cobre os pré-requisitos do cluster, a instalação do chart `soctalk-system` e o onboarding do primeiro cliente.

**Testando pela primeira vez? Use a [VM de demonstração](/pt-br/quickstart-vm) em vez disso.** É uma instalação de imagem única com um assistente baseado em navegador — um caminho muito mais rápido para um sistema em execução. Esta página é o caminho de produção: K3s + Cilium + cert-manager + seu próprio ingress controller.

**Avaliando com 1-3 tenants?** O [Launchpad](/pt-br/launchpad) automatiza o piloto multi-tenant de ponta a ponta (VMs + Tailscale + este instalador + onboarding de tenants). Volte aqui quando estiver montando o ambiente real.

## Instalação rápida em uma VM Ubuntu na nuvem (um único comando)

Para um control plane MSSP de nó único em uma VM Ubuntu 24.04 pura (na nuvem ou on-premises), o mesmo `install.sh` que a [VM de demonstração](/pt-br/quickstart-vm) já embute está disponível como um instalador de um único comando. Ele faz o bootstrap de k3s + Helm, baixa o chart OCI soctalk-system do GHCR e semeia os secrets de admin / LLM em uma única etapa.

Defina a configuração de instalação via variáveis de ambiente (qualquer subconjunto; o restante é solicitado) — quando **as três** variáveis `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL`, `SOCTALK_ADMIN_PASSWORD` estiverem presentes, o instalador pula o prompt de consentimento, de modo que fluxos `curl | bash` não assistidos funcionem sem `-y`:

```bash
export SOCTALK_MSSP_NAME="Acme MSSP"
export SOCTALK_ADMIN_EMAIL="admin@acme.example"
export SOCTALK_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SOCTALK_HOSTNAME="soctalk.acme.example"      # what the dashboard URL will be
export SOCTALK_LLM_PROVIDER="anthropic"             # or openai-compatible
export SOCTALK_LLM_API_KEY="sk-..."                 # OR --llm-key-file <path>

curl -sfL https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh | bash
```

Flags que vale a pena conhecer: `--yes` / `-y` (assume-yes quando as variáveis de ambiente estão parciais), `--demo` (senha de admin aleatória + faz onboarding automático de um tenant de demonstração — o caminho "só me mostre" mais rápido; nenhuma variável de ambiente necessária), `--chart-version <v>` (fixa uma release específica do chart), `--chart-dir <path>` / `--values-file <path>` (offline / air-gapped). Referência completa: `install.sh --help`.

O script propaga `SOCTALK_HOSTNAME` para o `ingress.hostnames.mssp` do chart e o chart, por sua vez, deriva `SOCTALK_PUBLIC_ORIGIN` (CSRF) e `SOCTALK_L1_PUBLIC_URL` (a URL que o cloud-agent do tenant usa para `/register`). Nenhum ajuste manual de variáveis de ambiente no Deployment da api é necessário.

Se você precisar de um controle mais fino — ingress controller não padrão, hostname de cliente separado, `ClusterIssuer` do cert-manager, etc. — use o caminho via Helm abaixo.

## Pré-requisitos do cluster

Instale-os uma vez por cluster K3s antes do `soctalk-system`. O SocTalk espera Kubernetes 1.30+ porque o chart do sistema instala um guard nativo `ValidatingAdmissionPolicy` para operações de namespace de tenant.

### K3s com Cilium

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

Configure um `ClusterIssuer` apropriado para o seu ambiente (Let's Encrypt, CA interna ou autoassinado para dev).

Os valores padrão do SocTalk solicitam um host wildcard para as UIs de cliente (`*.customers.your-mssp.example`), e o Let's Encrypt só emite wildcards via DNS-01. Use um solver DNS-01 com o provedor que hospeda sua zona. Exemplo para Cloudflare:

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

O cert-manager tem receitas de solver para Route 53, Cloud DNS, Azure DNS, RFC 2136 e outros. Escolha a que corresponde ao provedor da sua zona.

> Se você não precisa de hostnames wildcard de cliente (ou seja, você enumera os hosts de cliente individualmente), pode usar HTTP-01 com `solvers: [- http01: { ingress: { class: traefik } }]` em vez disso. Os valores do `soctalk-system` usam por padrão `className: traefik`; o `ingress.class` (HTTP-01) do solver ACME ou o provedor DNS deve corresponder à classe de ingress do chart. Para ingress-nginx, defina `class: nginx` em ambos os lados.

### Ingress controller

O K3s não vem com o Traefik na nossa configuração (nós o desabilitamos acima). Instale o ingress de sua preferência:

```bash
# Option A: Traefik v3
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n ingress-system --create-namespace

# Option B: ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-system --create-namespace
```

Rotule o namespace de ingress para a NetworkPolicy:

```bash
kubectl label namespace ingress-system managed-by=ingress
```

### Modo de autenticação

A API lê `SOCTALK_AUTH_MODE` (`internal | proxy`) na inicialização. O chart `soctalk-system` faz deploy em modo `internal`: o SocTalk é dono do login, das sessões e do armazenamento de senhas, e o Job de bootstrap semeia um admin inicial em um Secret (veja [Executar o bootstrap](#run-the-bootstrap)).

O modo `proxy` — colocar o SocTalk atrás de OAuth2-Proxy / Keycloak / Dex e confiar nos headers de identidade upstream — é suportado pelo runtime, mas ainda não está exposto como um knob nos values do chart. Trate-o como um item de release futura; se você opera SSO central e quer pilotá-lo agora, defina a variável de ambiente diretamente no Deployment da API após a instalação.

Detalhes completos: [Autenticação interna](/pt-br/reference/internal-auth).

### StorageClass

Qualquer provisionador dinâmico funciona. Para o padrão do K3s, o `local-path` vem pré-instalado. Para produção, use Longhorn, Rook/Ceph ou um CSI de provedor de nuvem. Garanta que um deles esteja marcado como `storageclass.kubernetes.io/is-default-class=true`.

## Instalar o SocTalk

### Preparar os values

Crie `soctalk-system-values.yaml`:

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

### Instalar

```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version 0.2.0 \
  --namespace soctalk-system --create-namespace \
  -f soctalk-system-values.yaml
```

O Job de pré-instalação do chart verifica os pré-requisitos do cluster e falha rápido se algum estiver faltando.

### Migrações e bootstrap são executados automaticamente

Ambos acontecem dentro do comando de init do pod da API antes de o app FastAPI iniciar:

1. Aguarda o Postgres aceitar conexões.
2. `alembic upgrade head` para migrar ao schema mais recente.
3. Vincula as senhas por role (`soctalk_app`, `soctalk_mssp`).
4. Semeia a linha da Organization a partir de `install.msspId` / `install.msspName`.
5. Se `install.bootstrapAdmin.email` e `install.bootstrapAdmin.password` estiverem definidos nos values, faz upsert do usuário como `mssp_admin` com `must_change=false` e a senha fornecida.

Portanto, se você colocar as credenciais de admin de bootstrap nos values, **a API sobe com o admin já criado** — nenhum Job adicional para executar.

O chart **não** entrega um Job Alembic separado; a edição anterior desta página descrevia um que não existia. As migrações estão atreladas ao ciclo de vida do pod da API. Para acompanhá-las:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Em um upgrade, deletar o pod da API reexecuta a migração (o alembic é idempotente, então reexecutar em um DB inalterado é uma no-op).

Se você NÃO forneceu `install.bootstrapAdmin.password` nos values, defina a senha do admin após a instalação:

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password <admin-email>
```

No modo de autenticação `proxy`, os endpoints de senha não são montados. **O provisionamento JIT de usuário na primeira requisição autenticada não está implementado na V1** — você deve semear o primeiro usuário MSSP manualmente (por exemplo, via `kubectl exec` no pod da API e um `INSERT` SQL direto na tabela `users`) antes que qualquer requisição autenticada por proxy possa ter sucesso. Um caminho JIT real está no roadmap.

## Verificar a instalação

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace soctalk-system
```

Faça login em `https://mssp.your-mssp.example` com o admin de bootstrap. Você deve chegar ao dashboard MSSP:

![MSSP dashboard](/screenshots/mssp-dashboard.png)

Para um tour por cada tela que você verá daqui em diante, leia o [Tour da UI MSSP](/pt-br/mssp-ui).

## Onboarding do primeiro cliente

Na UI MSSP, vá em **Tenants → New tenant**. O formulário de onboarding coleta: slug, nome de exibição, perfil (`poc` | `persistent` | `provided`), e-mail de contato, branding e URL base + overrides de modelo de LLM opcionais. Convites de customer-viewer **não** estão no formulário — isso é configurado depois que o tenant atinge `active`. O provisionamento roda de forma assíncrona; atualize a página de detalhes para ver novos eventos de ciclo de vida aparecerem na tabela de eventos. (Um stream de eventos ao vivo está no roadmap; `/api/events/stream` existe, mas emite apenas pings nesta release.) Se você escolher `provided` (BYO Wazuh), o formulário exige adicionalmente as URLs e credenciais do indexer externo + Manager API, além de uma chave de LLM por tenant — veja [ciclo de vida do tenant / provided](/pt-br/tenant-lifecycle#provided).

![Tenants list](/screenshots/tenants-list.png)

Depois que o tenant atinge `active`:

1. Atualize a chave da API de LLM do tenant via **Customer → Settings → LLM**.
2. Configure o ingress de agentes Wazuh conforme [Ingress do Wazuh](/pt-br/reference/wazuh-ingress).
3. Compartilhe a URL da UI do cliente e o convite inicial de `customer_viewer` com o cliente final.

Então verifique:

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# Tenant namespace exists and data plane is Ready
kubectl -n tenant-<slug> get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace tenant-<slug> --verdict DROPPED
```

## Próximos passos

- [Operações diárias](/pt-br/operations) para tarefas de day-2.
- [Upgrades](/pt-br/upgrades) para upgrades no nível de instalação e por tenant.
- [Ingress do Wazuh](/pt-br/reference/wazuh-ingress) para onboarding de agentes de cliente.
