# Installation

Für MSSP-Cluster-Administratoren. Behandelt die Cluster-Voraussetzungen, die Installation des `soctalk-system`-Charts und das Onboarding des ersten Kunden.

**Probierst du es zum ersten Mal aus? Verwende stattdessen die [Demo-VM](/de-de/quickstart-vm).** Es handelt sich um eine Ein-Image-Installation mit einem browserbasierten Assistenten, ein deutlich schnellerer Weg zu einem laufenden System. Diese Seite beschreibt den Produktivpfad: K3s + Cilium + cert-manager + deinem eigenen Ingress-Controller.

**Evaluierst du mit 1-3 Mandanten?** [Launchpad](/de-de/launchpad) automatisiert den mandantenfähigen Pilot durchgängig (VMs + Tailscale + diesen Installer + Mandanten-Onboarding). Komm hierher zurück, wenn du das Echtsystem aufbaust.

## Schnellinstallation auf einer Cloud-Ubuntu-VM (ein Befehl)

Für eine Single-Node-MSSP-Control-Plane auf einer nackten Ubuntu-24.04-VM (Cloud oder On-Prem) ist dasselbe `install.sh`, das die [Demo-VM](/de-de/quickstart-vm) mitbringt, als Ein-Befehl-Installer erreichbar. Es bootstrappt k3s + Helm, holt das soctalk-system-OCI-Chart von GHCR und legt die Admin-/LLM-Secrets in einem Schritt an.

Setze die Installationskonfiguration über Umgebungsvariablen (beliebige Teilmenge; der Rest wird abgefragt), wenn **alle drei** von `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL`, `SOCTALK_ADMIN_PASSWORD` vorhanden sind, überspringt der Installer seine Einwilligungsabfrage, sodass unbeaufsichtigte `curl | bash`-Abläufe ohne `-y` funktionieren:

```bash
export SOCTALK_MSSP_NAME="Acme MSSP"
export SOCTALK_ADMIN_EMAIL="admin@acme.example"
export SOCTALK_ADMIN_PASSWORD="$(openssl rand -base64 24)"
export SOCTALK_HOSTNAME="soctalk.acme.example"      # what the dashboard URL will be
export SOCTALK_LLM_PROVIDER="anthropic"             # or openai-compatible
export SOCTALK_LLM_API_KEY="sk-..."                 # OR --llm-key-file <path>

curl -sfL https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh | bash
```

Erwähnenswerte Flags: `--yes` / `-y` (Ja annehmen, wenn die Umgebung unvollständig ist), `--demo` (zufälliges Admin-Passwort + automatisches Onboarding eines Demo-Mandanten, der schnellste "zeig es mir einfach"-Weg; keine Umgebungsvariablen erforderlich), `--chart-version <v>` (ein bestimmtes Chart-Release fixieren), `--chart-dir <path>` / `--values-file <path>` (offline / air-gapped). Vollständige Referenz: `install.sh --help`.

Das Skript propagiert `SOCTALK_HOSTNAME` in das `ingress.hostnames.mssp` des Charts, und das Chart leitet daraus wiederum `SOCTALK_PUBLIC_ORIGIN` (CSRF) und `SOCTALK_L1_PUBLIC_URL` (die URL, die der Mandanten-Cloud-Agent für `/register` verwendet) ab. Kein manuelles Herumbasteln an Umgebungsvariablen auf dem api-Deployment erforderlich.

Wenn du feinere Kontrolle benötigst, nicht standardmäßiger Ingress-Controller, separater Kunden-Hostname, cert-manager-`ClusterIssuer` usw., verwende stattdessen den Helm-Pfad weiter unten.

## Cluster-Voraussetzungen

Installiere diese einmal pro K3s-Cluster vor `soctalk-system`. SocTalk erwartet Kubernetes 1.30+, weil das System-Chart einen nativen `ValidatingAdmissionPolicy`-Guard für Operationen an Mandanten-Namespaces installiert.

### K3s mit Cilium

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

Konfiguriere einen für deine Umgebung passenden `ClusterIssuer` (Let's Encrypt, interne CA oder selbstsigniert für die Entwicklung).

Die Standardwerte von SocTalk fordern einen Wildcard-Host für Kunden-UIs an (`*.customers.your-mssp.example`), und Let's Encrypt stellt Wildcards nur über DNS-01 aus. Verwende einen DNS-01-Solver mit dem Anbieter, der deine Zone hostet. Beispiel für Cloudflare:

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

cert-manager bietet Solver-Rezepte für Route 53, Cloud DNS, Azure DNS, RFC 2136 und weitere. Wähle das für deinen Zonen-Anbieter passende aus.

> Wenn du keine Wildcard-Kunden-Hostnamen benötigst (d. h. du zählst die Kunden-Hosts einzeln auf), kannst du stattdessen HTTP-01 mit `solvers: [- http01: { ingress: { class: traefik } }]` verwenden. Die `soctalk-system`-Werte setzen standardmäßig `className: traefik`; die `ingress.class` (HTTP-01) des ACME-Solvers oder der DNS-Anbieter muss zur Ingress-Klasse des Charts passen. Setze für ingress-nginx auf beiden Seiten `class: nginx`.

### Ingress-Controller

K3s liefert bei uns Traefik nicht mit (wir haben es oben deaktiviert). Installiere deinen bevorzugten Ingress:

```bash
# Option A: Traefik v3
helm repo add traefik https://traefik.github.io/charts
helm install traefik traefik/traefik -n ingress-system --create-namespace

# Option B: ingress-nginx
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm install ingress-nginx ingress-nginx/ingress-nginx -n ingress-system --create-namespace
```

Kennzeichne den Ingress-Namespace für NetworkPolicy:

```bash
kubectl label namespace ingress-system managed-by=ingress
```

### Authentifizierungsmodus

Die API liest `SOCTALK_AUTH_MODE` (`internal | proxy`) beim Start. Das `soctalk-system`-Chart wird im Modus `internal` bereitgestellt: SocTalk verantwortet Login, Sessions und Passwortspeicherung, und der Bootstrap-Job legt einen initialen Admin in einem Secret an (siehe [Bootstrap ausführen](#run-the-bootstrap)).

Der Modus `proxy`: SocTalk mit OAuth2-Proxy / Keycloak / Dex vorschalten und Upstream-Identity-Headern vertrauen, wird von der Laufzeit unterstützt, ist aber noch nicht als Chart-Values-Stellschraube verfügbar. Behandle ihn als Element eines zukünftigen Releases; wenn du zentrales SSO betreibst und es jetzt pilotieren möchtest, setze die Umgebungsvariable nach der Installation direkt auf dem API-Deployment.

Vollständige Details: [Interne Authentifizierung](/de-de/reference/internal-auth).

### StorageClass

Jeder dynamische Provisioner funktioniert. Für K3s-Standard ist `local-path` vorinstalliert. Verwende für die Produktion Longhorn, Rook/Ceph oder einen Cloud-Provider-CSI. Stelle sicher, dass einer als `storageclass.kubernetes.io/is-default-class=true` markiert ist.

## SocTalk installieren

### Werte vorbereiten

Erstelle `soctalk-system-values.yaml`:

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

### Installieren

```bash
helm install soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version 0.2.0 \
  --namespace soctalk-system --create-namespace \
  -f soctalk-system-values.yaml
```

Der Pre-Install-Job des Charts überprüft die Cluster-Voraussetzungen und bricht sofort ab, wenn welche fehlen.

### Migrationen und Bootstrap laufen automatisch

Beides geschieht innerhalb des Init-Befehls des API-Pods, bevor die FastAPI-Anwendung startet:

1. Warten, bis Postgres Verbindungen annimmt.
2. `alembic upgrade head`, um auf das neueste Schema zu migrieren.
3. Pro-Rolle-Passwörter binden (`soctalk_app`, `soctalk_mssp`).
4. Die Organization-Zeile aus `install.msspId` / `install.msspName` anlegen.
5. Wenn `install.bootstrapAdmin.email` und `install.bootstrapAdmin.password` in den Werten gesetzt sind, den Benutzer als `mssp_admin` mit `must_change=false` und dem angegebenen Passwort per Upsert anlegen.

Wenn du also die Bootstrap-Admin-Zugangsdaten in die Werte einträgst, **kommt die API mit bereits erstelltem Admin hoch**: kein zusätzlicher Job auszuführen.

Das Chart liefert **keinen** separaten Alembic-Job; die vorherige Ausgabe dieser Seite beschrieb einen, den es nicht gab. Migrationen sind an den Lebenszyklus des API-Pods gebunden. So beobachtest du sie:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Bei einem Upgrade führt das Löschen des API-Pods die Migration erneut aus (alembic ist idempotent, sodass ein erneuter Lauf auf einer unveränderten DB ein No-op ist).

Wenn du `install.bootstrapAdmin.password` NICHT in den Werten angegeben hast, setze das Admin-Passwort nach der Installation:

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password <admin-email>
```

Im Auth-Modus `proxy` sind die Passwort-Endpunkte nicht eingebunden. **JIT-Benutzerbereitstellung bei der ersten authentifizierten Anfrage ist in V1 nicht implementiert**: du musst den ersten MSSP-Benutzer manuell anlegen (z. B. per `kubectl exec` auf dem API-Pod und direktem SQL-`INSERT` gegen die `users`-Tabelle), bevor irgendeine proxy-authentifizierte Anfrage erfolgreich sein kann. Ein echter JIT-Pfad ist auf der Roadmap.

## Installation überprüfen

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace soctalk-system
```

Melde dich unter `https://mssp.your-mssp.example` mit dem Bootstrap-Admin an. Du solltest auf dem MSSP-Dashboard landen:

![MSSP dashboard](/screenshots/mssp-dashboard.png)

Für einen Rundgang durch jeden Bildschirm, den du von hier an siehst, lies die [MSSP-UI-Tour](/de-de/mssp-ui).

## Ersten Kunden onboarden

Gehe in der MSSP-UI zu **Mandanten → Neuer Mandant**. Das Onboarding-Formular erfasst: Slug, Anzeigename, Profil (`poc` | `persistent` | `provided`), Kontakt-E-Mail, Branding sowie optionale LLM-Basis-URL + Modell-Overrides. Customer-Viewer-Einladungen sind **nicht** im Formular, das wird konfiguriert, nachdem der Mandant `active` erreicht hat. Die Bereitstellung läuft asynchron; aktualisiere die Detailseite, um neue Lebenszyklus-Ereignisse in der Ereignistabelle erscheinen zu sehen. (Ein Live-Ereignis-Stream ist auf der Roadmap; `/api/events/stream` existiert, sendet in diesem Release aber nur Pings.) Wenn du `provided` (BYO Wazuh) wählst, verlangt das Formular zusätzlich die externen Indexer- + Manager-API-URLs und -Zugangsdaten sowie einen mandantenspezifischen LLM-Schlüssel, siehe [Mandanten-Lebenszyklus / provided](/de-de/tenant-lifecycle#provided).

![Tenants list](/screenshots/tenants-list.png)

Nachdem der Mandant `active` erreicht hat:

1. Aktualisiere den LLM-API-Schlüssel des Mandanten über **Kunde → Einstellungen → LLM**.
2. Konfiguriere den Wazuh-Agent-Ingress gemäß [Wazuh Ingress](/de-de/reference/wazuh-ingress).
3. Teile die Kunden-UI-URL und die initiale `customer_viewer`-Einladung mit dem Endkunden.

Dann überprüfe:

```bash
# All soctalk-system pods Ready
kubectl -n soctalk-system get pods
# Tenant namespace exists and data plane is Ready
kubectl -n tenant-<slug> get pods
# No cross-tenant traffic (Hubble)
hubble observe --namespace tenant-<slug> --verdict DROPPED
```

## Weiter

- [Täglicher Betrieb](/de-de/operations) für Day-2-Aufgaben.
- [Upgrades](/de-de/upgrades) für Upgrades auf Installationsebene und pro Mandant.
- [Wazuh Ingress](/de-de/reference/wazuh-ingress) für das Onboarding von Kunden-Agenten.
