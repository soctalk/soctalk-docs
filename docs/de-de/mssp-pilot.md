# MSSP-Pilot: Selbst durchführen

::: tip Die meisten Piloten sollten Launchpad verwenden
[**Launchpad**](/de-de/launchpad) automatisiert diesen gesamten Rollout, gleiche Installation, gleiche Charts, gleicher Tailscale-Ablauf, in einem einzigen Befehl (~15-25 Min., größtenteils Warten auf Downloads, statt ~2 Stunden von Hand). **Fang dort an.** Greife zu dieser Selbst-durchführen-Anleitung, wenn du jeden Schritt verstehen willst, einen Launchpad-Lauf debuggst oder deine Umgebung Launchpad nicht ausführen kann, air-gapped, on-prem Split-Horizon-DNS, ein nicht unterstützter Unterbau oder ein bestehender Cluster.
:::

Ein praktischer Weg für MSSPs, die SocTalk mit 1-3 ihrer Kunden evaluieren. Zwei On-Premise-Umgebungen (eine MSSP-Control-Plane, eine pro Mandant), verbunden über ein firewallfreundliches Mesh-VPN. Endzustand: eine funktionierende mandantenfähige SocTalk-Installation, der AI-SOC-Analyst, der Fragen zu den echten Wazuh-Daten jedes Mandanten beantwortet, und ein Screenshot, den du deinen Stakeholdern zeigen kannst.

**Keine Produktivinstallation.** Kein HA, kein echtes TLS, dein Tailnet-Hostname steht stellvertretend für den Ingress. Wenn du für die Produktion bereit bist, siehe [Installation](/de-de/install).

**Du willst SocTalk zuerst allein ausprobieren?** Beginne mit [Quickstart VM](/de-de/quickstart-vm): eine Box, ein Mandant, ~10 Minuten.

::: tip Praktische Zeit
| Seite | Praktisch | Gesamtdauer |
|---|---|---|
| MSSP (einmalig) | ~45 Min. | ~60 Min. |
| Je Mandant (1-3 davon) | ~30 Min. pro Mandant | ~45 Min. pro Mandant |
| Demo + Verifizierung | ~10 Min. | ~10 Min. |
:::

## Was im Geltungsbereich liegt

- 1 MSSP-Control-Plane + 1-3 Mandanten
- Beide Umgebungen **on-premise**, jeder Hypervisor, der Ubuntu 24.04 ausführt (vSphere / Proxmox / Hyper-V / KVM / VirtualBox / Bare Metal)
- [Tailscale](https://tailscale.com) als Mesh-VPN. Headscale, NetBird oder jedes WireGuard-Mesh funktioniert auf dieselbe Weise; Tailscale ist das, was die untenstehenden Befehle syntaktisch voraussetzen.
- Die L1-SocTalk-Control-Plane des MSSP + der L2-SocTalk-Cloud-Agent auf jedem Mandanten
- Wazuh **bereits installiert** ODER **per Chart installiert** pro Mandant; beides wird unterstützt

<!-- screenshot: arch-overview.svg, architecture diagram (MSSP VM left, tenant VMs right, tailnet wrapping both, cloud-agent shown on each tenant, optional dotted-line to existing Wazuh) -->

## 0. Bevor du beginnst

Sammle Folgendes. Du wirst in den nächsten 90 Minuten nach all dem gefragt:

- [ ] Hypervisor + Admin-Login für die MSSP-Seite
- [ ] Hypervisor + Admin-Login pro Mandant (einer pro Pilotkunde)
- [ ] Ein Tailscale-Konto ([registrieren](https://login.tailscale.com/start); der kostenlose Tarif reicht für einen Piloten problemlos aus)
- [ ] Ein LLM-API-Schlüssel (Anthropic oder OpenAI). Für eine air-gapped oder souveränitätssensible Option siehe [Ollama-Integration](/de-de/integrate/ollama).
- [ ] Ein Kontakt pro Mandant (Name, E-Mail, bestehendes Wazuh vorhanden? ja/nein)
- [ ] Falls ein Mandant bereits Wazuh hat: **zwei** Sätze von Zugangsdaten, einer für den Wazuh Indexer (`:9200`, Basic Auth) und einer für die Wazuh Manager API (`:55000`, Benutzer mit JWT-Ausstellungsrecht)

## 1. Das Tailnet einrichten

Die MSSP-Control-Plane und jeder Mandant treten demselben Tailnet bei. Das Tailnet liefert stabile Hostnamen (sodass der Cloud-Agent einen Namen anwählt, keine IP) und ACLs (sodass Mandanten sich nicht gegenseitig erreichen können).

### 1.1 Tags

Definiere in der Tailscale-Admin-UI unter **Access Controls** → **Tags** ein Tag für den MSSP und eines pro Mandant:

```json
"tagOwners": {
  "tag:mssp":         ["autogroup:admin"],
  "tag:tenant-acme":  ["autogroup:admin"],
  "tag:tenant-globex":["autogroup:admin"]
}
```

Füge ein Tag pro Pilotmandant hinzu. Über Tags verhindert die ACL, dass Mandanten sich gegenseitig erreichen.

### 1.2 ACL

Füge diese Passage in **Access Controls** → **Access Controls (JSON)** ein. Passe die Liste der Mandanten-Tags an deinen Piloten an.

```json
"acls": [
  {
    "action": "accept",
    "src":    ["autogroup:admin"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  },
  {
    "action": "accept",
    "src":    ["tag:mssp"],
    "dst":    ["tag:tenant-acme:*", "tag:tenant-globex:*"]
  },
  {
    "action": "accept",
    "src":    ["tag:tenant-acme", "tag:tenant-globex"],
    "dst":    ["tag:mssp:443", "tag:mssp:80"]
  }
]
```

Die erste Regel lässt **deine Operator-Geräte** (deinen Laptop, jeden admin-eigenen, ungetaggten Knoten im Tailnet) die MSSP-UI erreichen. Ohne sie blockiert Tailscales Default-Deny deinen eigenen Browser. Die zweite Regel lässt den MSSP jeden Mandanten für Chat-Tool-Aufrufe erreichen (Wazuh API, Observability). Die dritte lässt den Cloud-Agent jedes Mandanten den HTTPS-Endpoint des MSSP erreichen, um sich zu registrieren und Events zu streamen. Mandanten können sich nicht gegenseitig erreichen.

Überprüfe es im ACL-Preview-Bereich, bevor du speicherst. Bestätige, dass `tag:tenant-acme` `tag:tenant-globex` auf keinem Port erreichen kann.

<!-- screenshot: tailscale-acl-preview.png, ACL preview showing tenant-to-tenant denied, MSSP→tenant + tenant→MSSP allowed -->

### 1.3 Auth-Schlüssel

Generiere unter **Settings** → **Keys**:

- Einen **wiederverwendbaren** Auth-Schlüssel mit dem Tag `tag:mssp` für die MSSP-Control-Plane.
- Einen **ephemeren** Auth-Schlüssel pro Mandant mit dem Tag `tag:tenant-<slug>`. Setze die TTL auf deine Pilotlaufzeit (z. B. 90 Tage).

Notiere diese an einem sicheren Ort; du fügst sie ein, wenn jede VM dem Tailnet beitritt.

### 1.4 Netzwerkanforderungen

Tailscale benötigt von jedem Knoten nur ausgehenden (niemals eingehenden) Datenverkehr:

- **Direkter Pfad** (wenn beide Peers NAT-Traversal beherrschen): WireGuard über UDP auf einem zufälligen hohen Port. Die meisten Netzwerke erlauben dies bereits.
- **DERP-Fallback** (wenn NAT-Traversal fehlschlägt, z. B. strenge Firewalls oder Double-NAT): TCP/443 zu Tailscales DERP-Relays. Die meisten Piloten nutzen diesen Pfad, da er wie normaler HTTPS-Datenverkehr aussieht.

Wenn deine Firewall ausgehendes HTTPS erlaubt, ist alles in Ordnung. Keine Änderungen an eingehenden Regeln irgendwo.

## 2. MSSP-Seite: die Control Plane aufsetzen

Die MSSP-Control-Plane ist eine einzelne SocTalk-VM, dieselbe, die [Quickstart VM](/de-de/quickstart-vm) installiert. Wir verwenden dieses Tutorial als Basis und ergänzen den Tailnet-Beitritt.

### 2.1 Bereitstellen und installieren

Folge [Quickstart VM](/de-de/quickstart-vm) **Schritte 1 bis 5** (herunterladen, booten, Setup-Token holen, Assistenten öffnen, anmelden). Wenn der Assistent nach dem **Hostname** fragt, lass ihn vorerst leer. Du setzt ihn in §2.3 auf den Tailnet-Hostnamen.

Halte an, wenn du das MSSP-Dashboard erreicht hast. **Hinweis:** Der Quickstart-Ablauf onboardet beim ersten Boot automatisch einen Mandanten namens `demo`. Du wirst bereits einen Mandanten in deiner Liste sehen; das ist zu erwarten. Du kannst ihn entweder belassen (und ihn in §5 ignorieren) oder ihn vom Dashboard aus außer Betrieb nehmen, bevor du deine echten Pilotmandanten hinzufügst:

```text
Tenants → demo → Decommission
```

Beides ist in Ordnung; sei dir dessen nur bewusst, damit du nicht verwirrt bist, wenn `list all tenants` in §5 mehr als deine Pilotanzahl zurückgibt.

<!-- screenshot: mssp-dashboard-after-install.png, MSSP dashboard immediately after wizard install, showing the auto-onboarded demo tenant -->

### 2.2 Die Box härten

::: danger Vor dem nächsten Schritt erforderlich
Die herunterladbaren Disk-Images werden mit einem zur Build-Zeit angelegten SSH-Benutzer `ubuntu:packer` ausgeliefert. **Verbinde die VM nicht mit deinem Tailnet, bevor du sie abgeriegelt hast.** Siehe [SSH-Zugang + Zugangsdaten](/de-de/quickstart-vm#ssh-access-credentials) für die vollständige Erklärung und die Härtungsbefehle.

Minimum:
```bash
sudo passwd -l ubuntu
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```
:::

### 2.3 Tailscale installieren, dem Tailnet beitreten

Melde dich per SSH als `ops` an (der Benutzer, den der cloud-init-Seed während deiner [Quickstart VM](/de-de/quickstart-vm)-Installation angelegt hat; **nicht** der zur Build-Zeit angelegte `ubuntu`-Benutzer, den §2.2 gerade gesperrt hat):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-mssp-... --advertise-tags=tag:mssp --hostname=soctalk-mssp
```

Bestätige den zugewiesenen Tailnet-Hostnamen:

```bash
tailscale status | head -1
# example: 100.64.10.5   soctalk-mssp        ops          linux   active; direct
```

Dein MSSP-Hostname lautet `soctalk-mssp.<your-tailnet>.ts.net`. Notiere ihn; alles Folgende verwendet ihn.

### 2.4 SocTalks Ingress an den Tailnet-Hostnamen binden

Bearbeite die bereitgestellten Werte, um den Hostnamen zu setzen:

```bash
sudo nano /etc/soctalk/values.yaml
```

Ändere `ingress.hostnames.mssp` und `ingress.hostnames.customer` auf deinen Tailnet-Hostnamen (z. B. `soctalk-mssp.taila1b2c3.ts.net`), dann deploye erneut:

```bash
sudo helm upgrade soctalk-system /opt/soctalk/charts/soctalk-system \
  -n soctalk-system -f /etc/soctalk/values.yaml
```

Feldreferenz für `values.yaml`: siehe [Setup-Assistent](/de-de/setup-wizard); der Assistent schreibt dieselbe Datei.

### 2.5 Verifizieren

Von jedem anderen Tailnet-Gerät aus (dein Operator-Laptop funktioniert; die ACL aus §1.2 erlaubt `autogroup:admin → tag:mssp:443`):

```bash
curl -k https://soctalk-mssp.<your-tailnet>.ts.net/health/ready
# expected: 200 OK
```

Melde dich am Dashboard unter `https://soctalk-mssp.<your-tailnet>.ts.net/` mit den Admin-Zugangsdaten aus §2.1 an. Du solltest auf der mandantenübergreifenden MSSP-Flottenansicht landen: der KPI-Streifen am oberen Rand (Ausstehende Prüfungen / Feststeckende Fälle / Beeinträchtigte Mandanten / Wiederholte IOCs), die Untersuchungs-Warteschlange pro Mandant und die Mandanten-Zustandstabelle.

![MSSP-Dashboard: mandantenübergreifende Flottenansicht](/screenshots/mssp-dashboard.png)

## 3. Jeden Mandanten onboarden: die Agent-Registrierung ausstellen

Für jeden Mandanten in deinem Piloten machst du dies im MSSP-Dashboard und übergibst dann das Ergebnis an den Mandanten-Operator.

### 3.1 Den Assistenten „Create Customer" ausführen

Klicke im MSSP-Dashboard in der linken Leiste auf **Tenants**, dann auf **New tenant**. Dies öffnet den Assistenten **Create Customer**. Die vollständige Schritt-für-Schritt-Anleitung (Identity, Profile, der nur für `provided` sichtbare Schritt External SIEM, Branding, Review) ist einmalig unter [Mandanten onboarden](/de-de/tenant-onboarding#run-the-create-customer-wizard) dokumentiert. Dieser Abschnitt behandelt nur das, was für den Tailnet-Piloten spezifisch ist.

::: warning Der Slug muss deinem Tailnet-Tag entsprechen
Setze im Schritt Identity den **Slug** so, dass er deinem Tailnet-Tag aus §1.1 entspricht (sodass `tag:tenant-acme` → Slug `acme`). Spätere Schritte setzen den Slug direkt in `tag:tenant-<slug>` für den Auth-Schlüssel (§3.3) und den `tailscale up`-Befehl des Mandanten (§4.2 / §4.7a) ein; eine Nichtübereinstimmung bedeutet, dass der Mandantenknoten ein Tag ankündigt, das deine ACLs aus §1.2 nicht gewähren.
:::

::: tip Provided-Zugangsdaten vorab sammeln
Für einen Mandanten mit `provided`-Profil verlangt der Schritt External SIEM des Assistenten die bestehenden Wazuh-Zugangsdaten des Mandanten, und diese Endpunkte müssen von der Mandanten-VM aus erreichbar sein, die du in §4 aufsetzt. Sammle sie zuerst out-of-band von deinem Mandantenkontakt ein; siehe [§3.4](#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).
:::

Wenn der Assistent fertig ist, startet der Mandant in `pending` und durchläuft `provisioning → active`; sieh auf der Mandanten-Detailseite zu, wie sich die Lebenszyklus-Events ansammeln.

### 3.2 Den Agent-Registrierungsbefehl ausstellen

::: warning Noch kein UI-Button
Zum Zeitpunkt der Erstellung stellt die Mandanten-Detailseite nur die Lebenszyklus-Aktionen bereit (Suspend / Resume / Retry Provisioning / Decommission). Der `:issue-agent`-Ablauf ist nur über die API verfügbar; steuere ihn von einer Shell auf der MSSP-VM aus. Ein dedizierter **Issue Agent**-Button steht auf der Roadmap.
:::

![Mandanten-Detail: nur Lebenszyklus-Aktionen, kein Issue-Agent-Button](/screenshots/mssp-tenant-detail.png)

Melde dich von der MSSP-VM aus einmal an, um ein Session-Cookie zu erhalten, dann sende ein POST gegen den `:issue-agent`-Endpoint des Mandanten:

```bash
# Replace <mssp-host> with your MSSP UI hostname (e.g. soctalk-mssp.<tailnet>.ts.net)
# Replace <tenant-id> with the UUID from the tenant detail URL or from GET /api/mssp/tenants
MSSP=https://<mssp-host>
TENANT=<tenant-id>

curl -sk -c jar -X POST "$MSSP/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"<mssp-admin-email>","password":"<password>"}'

curl -sk -b jar -X POST "$MSSP/api/mssp/tenants/$TENANT:issue-agent" \
  -H "Origin: $MSSP" \
  -H 'Content-Type: application/json' | jq .
```

Der Body der 201-Antwort enthält einen `helm_install_hint`, den du direkt in die Shell des Mandanten einfügst. Er sieht so aus:

```bash
helm install soctalk-agent-acme \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token>
```

::: warning Verwende die API-Ausgabe wortwörtlich
Die obige `0.1.x`-Chart-Version und der Bootstrap-Token dienen nur zur Veranschaulichung; die echten Werte stammen aus deiner `:issue-agent`-Antwort. Tippe den helm-Befehl nicht neu ab; kopiere das Feld `helm_install_hint`.
:::

::: warning TTL des Bootstrap-Tokens
Der Bootstrap-Token läuft ab (Standard: 24 h). Wenn der Mandant den Befehl nicht vorher ausführt, stelle ihn erneut gegen denselben `:issue-agent`-Endpoint aus. Ein erneutes Ausstellen widerruft jeden nicht verbrauchten vorherigen Token.
:::

### 3.3 An den Mandantenkontakt übergeben

Der Mandanten-Operator benötigt **zwei** Dinge:

1. Den **helm-Befehl** aus §3.2 (oben). Kopiere ihn als einen Block.
2. Den **mandanten-getaggten Tailscale-Auth-Schlüssel**, den du in §1.3 generiert hast.

Sende diese über einen gemeinsam genutzten Passwortmanager (1Password, Bitwarden, Vaultwarden, überall mit Ende-zu-Ende-Verschlüsselung). Füge weder das eine noch das andere in einen öffentlichen Slack-Kanal ein und versende sie nicht unverschlüsselt per E-Mail.

::: info Demnächst verfügbar
Das [SocTalk Launchpad](https://github.com/soctalk/soctalk) (in Konzeption) wird ein einziges signiertes Bündel erzeugen, das der Mandant in seinen Setup-Assistenten einfügt und so diese Übergabe automatisiert. Vorerst ist es ein manuelles Kopieren und Einfügen.
:::

### 3.4 Koordination externer Wazuh-Zugangsdaten für `provided`-Mandanten

::: tip Überspringe diesen Abschnitt, wenn du in §3.1 `poc` oder `persistent` gewählt hast
Diese Profile sind eigenständig: Das Chart installiert sein eigenes Wazuh; auf der MSSP-Seite gibt es nichts weiter zu tun. Springe zu §4.
:::

Für Mandanten mit `provided`-Profil hat der Assistent die External-SIEM-Zugangsdaten **bereits** in §3.1 Schritt 3 erfasst, sodass der Adapter konfiguriert ist, sobald der Mandant `active` erreicht. Die einzige Out-of-band-Arbeit liegt vor §3.1: die Zugangsdaten überhaupt erst vom Mandanten zu bekommen.

Ablauf:

1. **Vor §3.1** frage deinen Mandantenkontakt nach:
   - Wazuh Indexer URL + Benutzer + Passwort (Basic Auth, vom Adapter für `_search` verwendet)
   - Wazuh Manager API URL + Benutzer + Passwort (verwendet, um JWTs auszustellen)
   - Einer Erreichbarkeitsentscheidung: Ist ihr Wazuh im selben Tailnet wie die Mandanten-VM, die du in §4 aufsetzen wirst? Falls nicht, müssen sie `--advertise-routes` aus §4.2 verwenden (siehe §4.7a für das Menü).
2. Sie folgen §4.7a auf ihrer Seite, um die Erreichbarkeit zu bestätigen.
3. Sie senden dir beide Endpoint-plus-Zugangsdaten-Paare (gemeinsam genutzter Passwortmanager).
4. Du führst §3.1 mit **Provided** in Schritt 2 aus und fügst die Zugangsdaten in Schritt 3 ein.

Wenn sich die Erreichbarkeitssituation des Mandanten nach §3.1 ändert (z. B. verlagern sie Wazuh auf einen anderen Host), aktualisiere das External-SIEM-Panel auf der Mandanten-Detailseite. Der Controller übernimmt die Änderung beim nächsten Reconcile (~30 s).

## 4. Mandantenseite: die Data Plane aufsetzen

Dieser Abschnitt ist für Mandanten-IT-Kontakte eigenständig. **Wenn du ein Mandanten-Operator bist und dein MSSP dir einen helm-Befehl + einen Tailscale-Auth-Schlüssel geschickt hat, kannst du hier beginnen.** Überfliege §0 für den Kontext, folge dann diesem Abschnitt.

### 4.1 Eine Linux-VM bereitstellen

Du benötigst eine Ubuntu-24.04-LTS-VM, mindestens 4 vCPU / 8 GB RAM / 60 GB Disk, mit ausgehendem Internet. Stelle sie über deinen normalen IT-Prozess bereit. Jeder Hypervisor, der Ubuntu ausführt, funktioniert (vSphere, Proxmox, Hyper-V, KVM, VirtualBox, Bare Metal). Wenn du lieber ein vorgefertigtes SocTalk-Image verwenden möchtest, siehe [Quickstart VM Schritt 1](/de-de/quickstart-vm#_1-download) für die Disk-Image-Links und die Importschritte pro Hypervisor; komm hierher zu §4.2 zurück.

### 4.2 Die Box härten

::: warning
Wenn du das vorgefertigte SocTalk-Image verwendet hast, folge [SSH-Zugang + Zugangsdaten](/de-de/quickstart-vm#ssh-access-credentials), bevor du dich mit deinem Tailnet verbindest. Wenn du eine generische Ubuntu-VM über deine IT-Pipeline bereitgestellt hast, gilt deine Standard-OS-Härtung bereits.
:::

### 4.3 Tailscale installieren, dem Tailnet beitreten

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --auth-key=tskey-auth-tenant-... --advertise-tags=tag:tenant-<slug> --hostname=soctalk-tenant-<slug>
```

Verwende den Auth-Schlüssel aus der Übergabe deines MSSP (§3.3). Verifiziere:

```bash
tailscale ping soctalk-mssp.<tailnet>.ts.net
# expected: pong from the MSSP control plane
```

Wenn `ping` fehlschlägt, prüfe die Maschinenliste in der Tailscale-Admin-UI. Stelle sicher, dass die MSSP-Maschine online ist und die ACL-Vorschau zeigt, dass dein Mandanten-Tag `tag:mssp` erreichen kann.

### 4.4 k3s + Helm installieren

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode=644" sh -
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

Verifiziere, dass k3s hochgekommen ist:

```bash
kubectl get nodes
# expected: one node, status Ready
```

### 4.5 Mandantenseitige NetworkPolicies deaktivieren

::: danger Vor dem nächsten Schritt erforderlich
Das `soctalk-cloud-agent`-Chart und das Mandanten-Chart werden mit NetworkPolicies ausgeliefert, die Cilium-FQDN-Policies voraussetzen. Vanilla-k3s hat keine Cilium-CRDs, sodass die Policies legitimen Egress vom Agent zum MSSP blockieren. Deaktiviere die NetworkPolicies des Charts vor der helm-Installation in §4.6.

Der einfachste Weg: Füge `--set networkPolicies.enabled=false` zu deinem helm-Befehl hinzu.

Wenn dein Mandanten-Cluster Netzwerkisolation benötigt, schichte sie auf der Host-Firewall (die Tailnet-ACL aus §1.2 bietet bereits MSSP↔Mandant-Isolation).
:::

### 4.6 Den helm-Befehl von deinem MSSP ausführen

Füge den Befehl aus §3.2 ein und hänge gemäß §4.5 `--set networkPolicies.enabled=false` an:

```bash
helm install soctalk-agent-<slug> \
  oci://ghcr.io/soctalk/charts/soctalk-cloud-agent \
  --version 0.1.x \
  --namespace soctalk-agent --create-namespace \
  --set-string controlPlaneUrl=https://soctalk-mssp.<tailnet>.ts.net \
  --set-string bootstrapToken=<one-time-token> \
  --set networkPolicies.enabled=false
```

::: tip Selbstsigniertes MSSP-Zertifikat? Setze insecureTLS
Wenn deine MSSP-Installation noch kein echtes TLS-Zertifikat für den Tailnet-Hostnamen bereitgestellt hat (chart-seitiger cert-manager nicht verdrahtet, oder du bist hinter Tailscale und behandelst es als Vertrauensgrenze), hänge `--set insecureTLS=true` an den helm-Befehl an. Der Agent überspringt dann die Zertifikatsprüfung bei `controlPlaneUrl`; Tailscale übernimmt ohnehin die Transportverschlüsselung. Standardmäßig aus; setze dies nur, wenn du dem zugrunde liegenden Netzwerk vertraust.
:::

Der Cloud-Agent installiert sich im Namespace `soctalk-agent`, wählt die Control Plane über das Tailnet an, registriert sich, und von dort aus steuert der MSSP-Controller die Mandanten-Chart-Installation auf demselben Cluster.

Beobachte, wie der Agent hochkommt:

```bash
kubectl -n soctalk-agent logs deploy/soctalk-cloud-agent -f
# look for: agent_registered installation_id=...
```

Wenn `agent_registered` in den Logs erscheint, hat der Agent erfolgreich mit dem MSSP kommuniziert.

### 4.7 Wazuh: bestehend oder frisch?

::: code-group
```text [4.7a: Tenant has existing Wazuh]
Required: TWO endpoint + credential pairs.

1. Wazuh Indexer, typically https://<host>:9200
   - User + password with read access to wazuh-alerts-*
2. Wazuh Manager API, typically https://<host>:55000
   - User + password with permission to mint JWTs

Both must be reachable from this tenant VM. The Manager API must ALSO
be reachable from the MSSP via the tailnet; the L1 chat agent dials
it directly when answering questions about your alerts.

If your existing Wazuh runs on a SEPARATE host from this tenant VM
(common), pick one of these:

a) Install Tailscale on the Wazuh host too, join the same tailnet
   tagged tag:tenant-<slug>. Simplest; gives the MSSP a stable
   tailnet hostname to dial.

b) Advertise the Wazuh subnet from this tenant VM. On this VM:

     sudo tailscale up --auth-key=... --advertise-tags=tag:tenant-<slug> \
       --hostname=soctalk-tenant-<slug> \
       --advertise-routes=<wazuh-subnet>/<mask>

   Then approve the route in the Tailscale admin UI under
   Machines → this host → Edit route settings.

Without (a) or (b), the MSSP can reach this VM but cannot reach
your Wazuh Manager, and chat tool calls against your tenant will
fail.

Hand both endpoint + credential pairs (plus the chosen reachability
option) back to your MSSP. They paste the credentials at step 3 of
the Create Customer wizard (§3.1), which configures the SocTalk
tenant chart to use your Wazuh in "provided" mode. If the MSSP has
already onboarded you as `provided` and your reachability story
changes later, they update the External SIEM panel on the tenant
detail page instead (§3.4).
```

```text [4.7b: No existing Wazuh]
The SocTalk tenant chart installs Wazuh + one linux-ep agent
simulator automatically (the `poc` profile). No tenant action needed
beyond waiting ~5 minutes for the Wazuh stack to come up.

Watch progress:
  kubectl -n tenant-<slug> get pods -w
```
:::

### 4.8 Checkpoints: zwei Zustände, die es zu beobachten gilt

Der Mandant durchläuft zwei unterschiedliche Bereitschaftszustände. Verwechsle sie nicht:

#### 4.8a Cloud-Agent registriert (~1 Minute nach §4.6)

Melde dich wieder am MSSP-Dashboard an. Dein Mandant wechselt innerhalb von 1-2 Minuten nach erfolgreichem §4.6 auf **Online**. Das bedeutet, **der Cloud-Agent hat den MSSP erreicht und sich registriert**: Der Vertrauens-Handshake ist abgeschlossen.

Es bedeutet **noch nicht**, dass der Wazuh-Stack des Mandanten läuft oder die Chat-Tools Abfragen gegen diesen Mandanten auflösen.

![MSSP-Dashboard: Mandant auf Online gewechselt](/screenshots/mssp-dashboard-tenant-online.png)

#### 4.8b Mandanten-Data-Plane vollständig bereit (~5-7 weitere Minuten)

Nach der Agent-Registrierung steuert der MSSP-Controller die Mandanten-Chart-Installation auf dem Cluster des Mandanten:

- **`poc`-Profil**: Wazuh + linux-ep-Simulator kommen hoch. Gesamtdauer ~5-7 Minuten.
- **`provided`-Profil**: Der SocTalk-Adapter kommt sofort hoch. Wazuh-Chat-Tool-Aufrufe werden aufgelöst, sobald der Adapter die External-SIEM-Endpoints erreicht, die der MSSP in §3.1 Schritt 3 angegeben hat. Falls nicht, prüfe die Erreichbarkeit gemäß §3.4.

Beobachte von der Mandanten-VM aus:

```bash
kubectl -n tenant-<slug> get pods -w
# poc profile: wait until wazuh-manager-0, wazuh-indexer-0, linux-ep-N all Ready
# provided profile: wait until soctalk-adapter is Ready
```

Erst nach §4.8b ist der Mandant bereit für die Demo in §5. Wenn §4.8a auslöst, aber §4.8b nie abschließt, siehe [Pilot-Fehlerbehebung](#_7-pilot-troubleshooting).

## 5. Der Demo-Moment

Der stakeholder-gerichtete Moment. Reproduziere diese Abfragen wortwörtlich; die Formulierung bestimmt, welches Tool das LLM wählt.

Melde dich am MSSP-Dashboard an. Öffne den Tab **Chat**.

**Abfrage 1. Bestätige, dass der Mandant erreichbar ist.**

```text
list all tenants
```

Erwartet: ein `list_tenants`-Tool-Badge, dann eine Antwort, die deine Pilotmandanten nach Slug + Anzeigename auflistet.

![Chat: list_tenants-Tool-Badge + Antwort](/screenshots/chat-list-tenants.png)

**Abfrage 2. Zeige Warnungen von einem bestimmten Mandanten.**

```text
show me the 5 most recent alerts at <tenant-slug> with rule ids
```

Erwartet: ein `recent_alerts`-Tool-Badge mit einem `@ <tenant-slug>`-Chip, dann eine natürlichsprachliche Zusammenfassung, die Regel-IDs, Schweregrade und Zeitstempel auflistet.

::: tip Dies ist der Stakeholder-Screenshot
Der `@ <tenant-slug>`-Chip auf dem Tool-Badge ist der Beweis: SocTalks AI-SOC-Analyst greift auf die weitergeleiteten Wazuh-Warnungen des Mandanten zu und beantwortet eine Frage zu echten Daten. Halte diesen Bildschirm fest.
:::

![Chat: recent_alerts @ acme mit Regel-IDs + LLM-Analyse](/screenshots/chat-wazuh-alerts.png)

::: info Warum `recent_alerts` und nicht `get_wazuh_alert_summary`?
Das `poc`-Profil des Piloten liefert Wazuh in den Mandanten-Cluster, und der SocTalk-Adapter leitet Warnungen (vorbehaltlich eines Mindestschweregrads, konfigurierbar über `SOCTALK_ADAPTER_MIN_SEVERITY`) an die MSSP-Datenbank weiter. `recent_alerts` liest aus diesem weitergeleiteten Stream und funktioniert daher unabhängig davon, ob der MSSP die Wazuh-API des Mandanten direkt erreichen kann. `get_wazuh_alert_summary` ist das Live-Integrations-Gegenstück, nützlich für das `provided`-Profil, wenn der MSSP die Wazuh-URL + Zugangsdaten des Mandanten in **Integrations** hält.
:::

Wenn die Warnungsliste leer ist (das Mandanten-Wazuh hat noch keinen Datenverkehr gesehen), generiere Testwarnungen. Der per Chart installierte Wazuh-Pfad (§4.7b) liefert einen oder mehrere `linux-ep-N`-Pods mit dem Angriffssimulator; löse ihn auf dem ersten bereiten Replica über einen Label-Selektor aus:

```bash
# On the tenant VM, against any linux-ep pod
kubectl -n tenant-<slug> exec -it \
  "$(kubectl -n tenant-<slug> get pod -l app=linux-ep -o jsonpath='{.items[0].metadata.name}')" \
  -- /opt/scripts/run-attack.sh
```

Warte 30-60 Sekunden und führe die Chat-Abfrage erneut aus. Für den Pfad mit bestehendem Wazuh (§4.7a) löse Warnungen so aus, wie du es normalerweise auf deinem eigenen Wazuh tun würdest, z. B. ein paar falsche Passwörter per SSH auf einem überwachten Host.

## 6. Tag 2: wie es weitergeht

- **Echtes Kunden-Wazuh hinzufügen.** Onboarde weitere Mandanten, indem du §3 und §4 wiederholst. Dasselbe Muster; jeder neue Mandant braucht ein frisches Tailscale-Tag, einen ACL-Eintrag, einen ephemeren Auth-Schlüssel und eine Agent-Ausstellung.
- **Die Produktivinstallation planen.** Wenn du bereit bist, über den Piloten hinauszugehen, siehe [Installation](/de-de/install) für den Pfad mit K3s + Cilium + cert-manager + echtem Ingress.
- **Mandanten-Lebenszyklus-Ops.** [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle) behandelt das Aussetzen, Fortsetzen und Außerbetriebnehmen von Mandanten vom MSSP-Dashboard aus.
- **Upgrades.** [Upgrades](/de-de/upgrades) behandelt das Vorwärtsrollen von soctalk-system und dem Cloud-Agent.
- **Backups.** [Backup & Wiederherstellung](/de-de/backup-restore) für zustandsbehaftete Daten.

### Was NICHT im Piloten enthalten ist

- Hochverfügbarkeit (ein einzelner k3s-Knoten auf jeder Seite)
- Echtes TLS (der Tailnet-Hostname verwendet selbstsignierte Zertifikate; die Produktion benötigt cert-manager + echten Ingress)
- Multi-Region
- Skalierung pro Mandant über ~50 Wazuh-Agents pro Mandant hinaus
- Ingress pro Mandant (dieser Pilot verwendet für alles den Tailnet-Hostnamen)

Wenn du auf die Produktion migrierst, kann deine MSSP-Produktkonfiguration (Mandantenliste, Chat-Verlauf, LLM-Schlüssel) mit Planung übernommen werden. Sprich mit dem Team, bevor du diesen Piloten außer Betrieb nimmst.

## 7. Pilot-Fehlerbehebung

Symptomgetriebene Tabelle für Fehler, die spezifisch für die Piloten-Topologie sind. Generische SocTalk-Probleme werden in [Fehlerbehebung](/de-de/troubleshooting) behandelt.

| Symptom | Wahrscheinliche Ursache | Prüfung |
|---|---|---|
| Mandant hängt im MSSP-Dashboard auf „Pending" | Bootstrap-Token abgelaufen, bevor §4.6 lief | Erneut vom MSSP-Dashboard ausstellen (§3.2); Tokens gelten standardmäßig 24 h |
| `tailscale ping soctalk-mssp.<tailnet>.ts.net` schlägt vom Mandanten fehl | ACL zu eng, oder MSSP-Maschine offline | ACL-Vorschau in der Tailscale-Admin-UI prüfen; MSSP `tailscale status` prüfen |
| Agent-Logs zeigen `connection refused` zu `controlPlaneUrl` | MSSP-seitiges `helm upgrade` aus §2.4 hat nicht gegriffen | Auf MSSP-VM: `kubectl -n soctalk-system get ingress`; bestätigen, dass der Hostname übereinstimmt |
| Agent-Logs zeigen `403 Forbidden` vom MSSP | Bootstrap-Token bereits verwendet (einmalig) | Erneut aus §3.2 ausstellen |
| `kubectl -n soctalk-agent get pods` zeigt `ImagePullBackOff` | Mandanten-Cluster kann nicht von `ghcr.io` pullen (Unternehmensproxy) | k3s registries.yaml mit Proxy konfigurieren; oder auf der Mandanten-VM vorab pullen |
| Chat sagt „keine Wazuh-Warnungen", aber Mandant hat Warnungen | Fall mit bestehendem Wazuh: Manager API vom MSSP-Tailnet nicht erreichbar | Von MSSP-VM: `curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"` (GET; sollte einen JWT zurückgeben) |
| Das Tool `get_wazuh_alert_summary` gibt einen Fehler zurück | Fall mit bestehendem Wazuh: Indexer-Zugangsdaten falsch | Von Mandanten-VM: `curl -ku <user>:<pw> https://<wazuh-indexer>:9200/wazuh-alerts-*/_search?size=1` |
| Adapter-Heartbeat funktioniert, aber Agent erreicht nie „Online" | NetworkPolicies in §4.5 aktiviert gelassen | `kubectl -n soctalk-agent get networkpolicies`; sollte leer sein |
| `helm install` mit values-schema-Fehler abgelehnt | Chart-Versions-Schieflage zwischen Control Plane und Agent-Chart | Die vom issue-agent-Endpoint ausgegebene Chart-Version verwenden, nicht „latest" |

## 8. Den Piloten außer Betrieb nehmen

Wenn der Pilot endet:

1. **Mandantenseite, je Mandant**: `helm uninstall soctalk-agent-<slug> -n soctalk-agent`. Schalte die Mandanten-VM aus und archiviere (oder zerstöre) sie.
2. **Tailscale-Admin-UI**: Widerrufe den Auth-Schlüssel jedes Mandanten unter **Settings → Keys**; entferne jedes Mandanten-Tag aus **Access Controls**.
3. **MSSP-Dashboard**: Für jeden Mandanten **Decommission** von der Mandanten-Detailseite aus (Zustandsübergänge zu `decommissioning` → `archived`).
4. **MSSP-VM**: Archivieren oder zerstören, wenn nicht auf die Produktion migriert wird. Bei Migration siehe [Installation](/de-de/install) für den Produktions-Cluster-Pfad.

Bewahre diese Artefakte für die Nachbetrachtung des Piloten auf:

- Das Audit-Log von jeder Mandanten-Detailseite (herunterladbar)
- Deine ausgefüllte `values.yaml` aus §2.4
- Die Tailscale-ACL-Passage aus §1.2
- Screenshots aus §5
