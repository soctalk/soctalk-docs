# Wazuh-Agent-Ingress und Zertifikatsanmeldung


## Problem

Jeder Mandant verfügt über einen dedizierten Wazuh-Manager, der im Namespace `tenant-<slug>` läuft. Wazuh-Agents werden auf den Endpunkten des Kunden installiert (außerhalb des MSSP-Clusters) und müssen sich mit dem Wazuh-Manager **ihres Mandanten** verbinden über:

- **1514/TCP**: Agent-Event-Stream (verschlüsselt mit Wazuhs nativem Protokoll über TLS)
- **1515/TCP**: Agent-Anmeldung / `authd` (Registrierung über gemeinsames Geheimnis)

Randbedingungen:

- Viele Mandanten auf einem Cluster → 1514/1515 können nicht auf einem einzelnen NodePort exponiert werden (Port-Kollision).
- Agents dürfen nur den Manager *ihres* Mandanten erreichen (nicht den eines anderen Mandanten).
- Kundenendpunkte befinden sich in unbekannten Netzwerken (Firmen-LAN, Cloud-VMs, Laptops): Konnektivität am häufigsten über das öffentliche Internet.
- TLS-Zertifikate müssen mandantenspezifisch sein (Vertrauenskette pro Kunde eingegrenzt).

## Gewähltes Muster: mandantenspezifische Adresse am MSSP-Edge

Jeder Mandant erhält einen dedizierten DNS-Namen (`acme.soc.mssp.example.com`), der auf einen mandantenspezifischen L4-Endpoint am MSSP-Edge aufgelöst wird. Das Routing zum richtigen Wazuh-Manager erfolgt über die Zieladresse, nicht über die Inspektion des Hostnamens.

**Warum kein SNI-basiertes L4-Routing.** Wazuhs Agent-Protokoll auf 1514/TCP ist ein proprietärer, AES-verschlüsselter Stream, kein Standard-TLS, sodass Verbindungen kein SNI-ClientHello mitführen. Ein L4-Proxy, der auf `req.ssl_sni` verzweigt, sieht keines, und der Agent-Verkehr fällt auf das Standard-Backend zurück. Der Anmeldekanal 1515/TCP handelt zwar TLS aus, aber das Routing muss denselben Diskriminator wie 1514 verwenden, sonst laufen die beiden Ports auseinander.

Zwei Implementierungen der mandantenspezifischen Adressierung werden unterstützt:

1. **LoadBalancer-Service pro Mandant (empfohlenes Muster; im Chart noch nicht verdrahtet).** Der aktuelle `wazuh`-Subchart erstellt den `Service` des Wazuh-Managers nur als `ClusterIP`: in diesem Release gibt es **keine automatische LoadBalancer- oder DNS-Bereitstellung**. Um einen Mandanten heute aus dem öffentlichen Internet routbar zu machen, müssen Sie entweder: selbst einen externen LoadBalancer-Service darüberlegen (manuelles `kubectl apply`), jeden Mandanten hinter ein Edge-HAProxy / NGINX mit mandantenspezifischem SNI oder Port-Mapping stellen oder die weiter unten beschriebene Topologie mit mandantenspezifischem Port verwenden. Cloud-LB + DNS pro Mandant ist das dokumentierte Ziel; dorthin zu gelangen erfordert manuelle Verdrahtung auf MSSP-Seite.
2. **Mandantenspezifischer Port an einer einzelnen Edge-IP (Rückfalloption).** Wenn eindeutige IPs knapp sind, allozieren Sie einen Portbereich an einer Edge-IP und weisen Sie `(1514, 1515)`-Offsets pro Mandant zu (z. B. acme → 15140/15141, beta → 15142/15143). DNS verwendet `SRV`-Records oder die `manager_address:port`-Konfiguration des Agents zur Verteilung. Betrieblich unhandlich, funktioniert aber.

### Topologie

```
Customer endpoint (Wazuh agent)
        │
        │ TCP 1514 to acme.soc.mssp.example.com
        │ (Wazuh agent protocol; not standard TLS)
        ▼
DNS resolves to the LoadBalancer IP for tenant-acme
        │
        ▼
┌───────────────────────────────────┐
│ MSSP cluster ingress for          │
│ tenant-acme/wazuh-manager         │
│ (cloud LB IP or MetalLB-assigned) │
└─────────────┬──────────────────────┘
              │ cluster-internal forward
              ▼
  tenant-acme namespace
  ┌─────────────────┐
  │ wazuh-manager   │
  │ Service: 1514   │
  │ Pod with        │
  │ tenant-specific │
  │ TLS cert (1515) │
  └─────────────────┘
```

### DNS

Ein `A`/`AAAA`-Record pro Mandant: `<slug>.soc.mssp.example.com → <tenant LB IP>` ist das Zieldesign. **In V1 gibt SocTalk KEINE DNS-Records aus**: der Betreiber verwaltet DNS manuell (external-dns / Provider-Konsole), sobald der mandantenspezifische LB außerhalb des Systems bereitgestellt wurde. Ein von SocTalk gesteuerter DNS-Emissionspfad (external-dns-Annotationen oder direkte Provider-Integration) steht auf der Roadmap.

Wildcard-DNS funktioniert für das LoadBalancer-Muster nicht, weil jeder Mandant seine eigene IP hat. Es funktioniert nur unter der Rückfall-Topologie (mandantenspezifischer Port), bei der jeder Name auf dieselbe Edge-IP aufgelöst wird.

### TLS-Zertifikate

Jeder Mandant erhält ein Zertifikat, dessen SAN `<slug>.soc.mssp.example.com` abdeckt. Optionen:

- **Zertifikat pro Mandant über cert-manager + Let's Encrypt** (empfohlen für MVP): cert-manager-`Certificate`-CR pro Mandant, ausgestellt von einem DNS-01- oder HTTP-01-`ClusterIssuer`: Zertifikat im Namespace `tenant-<slug>` als `Secret/wazuh-tls` gespeichert: automatisch erneuert.
- **Wildcard-Zertifikat für `*.soc.mssp.example.com`**: ein Zertifikat deckt alle Mandanten ab. Einfacher, bedeutet aber, dass der Wazuh-Manager jedes Mandanten das Zertifikat für den Agent jedes anderen Mandanten präsentieren kann, während es zu Ausfällen des Proxys auf MSSP-Seite kommt: für dieses Release ein akzeptables Risiko, da das Routing die eigentliche Durchsetzung darstellt.
- **Vom MSSP bereitgestellte interne CA**: für MSSPs, die ihre eigene PKI betreiben, kann cert-manager aus einem clusterinternen `Issuer` ausstellen, der von der MSSP-CA gestützt wird.

Der Installationsleitfaden dokumentiert alle drei; die Pilotvorgabe ist Let's Encrypt pro Mandant.

### LoadBalancer-Bereitstellung

Der MSSP betreibt eine der folgenden Optionen:

| Umgebung | LoadBalancer-Quelle |
|---|---|
| Managed Cloud (EKS, GKE, AKS, …) | Der Load-Balancer-Controller der Cloud weist pro `Service` vom Typ `LoadBalancer` eine öffentliche IP zu. |
| Bare-Metal oder On-Prem | MetalLB (L2- oder BGP-Modus) mit einem Adresspool oder kube-vip. |
| Single-IP-Edge mit Port-Mapping | Betreiben Sie einen externen L4-Proxy (HAProxy, Envoy, nginx-stream), der `(IP, port)`-Paare an den Mandanten-`Service` weiterleitet. Verwenden Sie dies nur unter der Rückfall-Topologie mit mandantenspezifischem Port. |

Das Zieldesign sieht vor, dass der `Service` des `soctalk-tenant`-Charts so annotiert wird, dass Cloud-Controller und MetalLB eine Pool-/IP-Klassen-Auswahl anwenden können (z. B. `metallb.universe.tf/address-pool: wazuh-agents`), und der SocTalk-Controller die resultierende LB-IP festhält und den mandantenspezifischen DNS-Record schreibt. **In V1 ist keines davon verdrahtet**: der Wazuh-Manager-Service ist nur `ClusterIP`, und der Controller pollt nicht auf die Zuweisung der LB-IP.

Wenn Sie eine einzelne Edge-IP verwenden müssen (Rückfalloption), sieht ein HAProxy-Referenz-Mapping so aus:

```
# Per-port routing — each tenant has its own 1514/1515 pair at the edge.
frontend wazuh-15140
    mode tcp
    bind *:15140
    default_backend tenant-acme-events
frontend wazuh-15141
    mode tcp
    bind *:15141
    default_backend tenant-acme-enroll
frontend wazuh-15142
    mode tcp
    bind *:15142
    default_backend tenant-beta-events

backend tenant-acme-events
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1514
backend tenant-acme-enroll
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1515
backend tenant-beta-events
    mode tcp
    server wazuh wazuh-manager.tenant-beta.svc.cluster.local:1514
```

Verzweigen Sie für Wazuh 1514 nicht auf `req.ssl_sni`. Wazuhs Agent-Protokoll ist kein Standard-TLS und erzeugt dort niemals ein ClientHello. SNI ist nur auf 1515 (Anmeldung) verfügbar, was unzureichend ist, Events würden weiterhin einen funktionierenden Diskriminator benötigen.

## Ablauf der Agent-Anmeldung

Wazuhs `authd`-Registrierung auf 1515/TCP erfordert ein gemeinsames Geheimnis. Jeder Mandant hat sein eigenes `authd`-Geheimnis, gespeichert in `Secret/wazuh-<slug>-wazuh-creds` (Schlüssel: `AUTHD_PASS`) im Mandanten-Namespace. Anmeldung:

1. **MSSP-Betreiber** onboardet einen neuen Kunden. SocTalk generiert das gemeinsame `authd`-Geheimnis zum Zeitpunkt der Mandantenbereitstellung.
2. **MSSP-Betreiber** stellt dem Endpunkt-Administrator des Kunden Folgendes bereit:
   - Hostname des Wazuh-Managers des Mandanten (`acme.soc.mssp.example.com`)
   - Ports (1514 Events, 1515 Anmeldung)
   - Gemeinsames `authd`-Geheimnis (über einen sicheren Kanal: Secrets-Management-Plattform, verschlüsselte E-Mail, was auch immer der MSSP verwendet)
   - Wazuh-Agent-Installer (Standard-Upstream-Paket)
3. **Endpunkt-Administrator des Kunden** installiert den Wazuh-Agent mit dem Hostnamen und meldet sich an:
   ```bash
   /var/ossec/bin/agent-auth \
       -m acme.soc.mssp.example.com \
       -P "<authd-shared-secret>"
   ```
4. Der Agent registriert sich beim Manager des Mandanten und erhält sein eigenes Zertifikat pro Agent.
5. Nachfolgende Verbindungen auf 1514 sind mTLS pro Agent.

Das Routing auf 1515 verwendet dieselbe mandantenspezifische Adresse wie 1514 (LB-IP oder Edge-Port). Das gemeinsame `authd`-Geheimnis ist mandantengebunden: ein Agent, der das Geheimnis von `acme` verwendet, kann sich nur beim Manager von `acme` registrieren, die Adressierung setzt dies durch, und das Geheimnis wird vom Manager verifiziert.

## Firewall-/Netzwerkanforderungen

MSSP-seitig:
- Öffentliche IPs für den Edge-Proxy (eine IP oder pro Region eine IP für MSSPs mit geografisch verteilten MSSP-Regionen).
- Der Edge-Proxy erlaubt eingehenden Verkehr 1514/TCP, 1515/TCP von 0.0.0.0/0 (oder kundenspezifische CIDRs, falls der MSSP dies bevorzugt).
- Die clusterinterne Firewall (NodePort-Bereich oder internes CIDR) erlaubt Edge-Proxy → Wazuh-Manager im Mandanten-Namespace.

Kundenseitig:
- Agents erlauben ausgehenden Verkehr 1514/1515/TCP zum Edge-Hostnamen des MSSP.
- Kein eingehender Verkehr vom MSSP zu den Kundenendpunkten (Wazuh ist pull-los: Events entstehen beim Agent).

## Zertifikatswiderruf / Agent-Entfernung

> **UI-Status:** der unten beschriebene Agents-Tab pro Mandant ist geplant. Bis er ausgeliefert wird, verwenden Sie die Umgehungslösung am Ende dieses Abschnitts.

Um einen bestimmten Agent zu widerrufen (geplante UX):
1. MSSP-Betreiber öffnet den Mandanten in der MSSP-UI → Agents-Tab → widerruft.
2. SocTalk ruft die Wazuh-Manager-API auf, um die Registrierung des Agents zu entfernen.
3. Der Endpunkt-Administrator des Kunden deinstalliert den Agent (optional, zur Bereinigung).

**Heute** widerrufen Sie direkt über das eingebettete Wazuh-Dashboard (Mandantenliste → **Open SOC** → Agents) oder über die Wazuh-Manager-API:

```bash
kubectl -n tenant-<slug> exec deploy/wazuh-manager -- \
  /var/ossec/bin/manage_agents -r <agent-id>
```

Um alle Agents eines Mandanten zu widerrufen (z. B. Kunden-Offboarding):
1. Rotieren Sie das gemeinsame `authd`-Geheimnis des Mandanten (Neuanmeldung für neue Agents erforderlich).
2. Löschen Sie alle bestehenden Agent-Registrierungen über die Wazuh-API.
3. Die Mandanten-Außerbetriebnahme baut den Manager letztlich ab.

## Alternative Konnektivitätsmuster (dokumentiert, nicht gebaut)

### Kundenverwaltetes VPN / Tunnel

Wenn die Netzwerkrichtlinie eines Kunden es Agents untersagt, Telemetrie über das öffentliche Internet zu senden:
- Der Kunde stellt einen WireGuard-/IPsec-Tunnel zum privaten Netzwerk des MSSP bereit.
- Der MSSP routet den Tunnelverkehr zum selben Edge-Proxy (oder direkt zum Cluster über interne Adressen).
- Die Agent-Konfiguration verweist auf einen internen Hostnamen.

Nicht in der Tooling dieses Releases implementiert; als Setup-Muster für MSSPs dokumentiert, die es benötigen.

### Tailscale / Overlay-Netzwerk

Ähnlich wie 6.1; MSSP und Kunde treten einem Tailscale-Netzwerk bei, der Agent erreicht `acme.soc.mssp.ts.net` direkt. Gut für kleine Kunden; dokumentiert.

### MSSP-Edge pro Region

Für MSSPs mit geografischer Trennung (EU, US, APAC) betreiben Sie mehrere Edge-Proxys in verschiedenen Regionen. Jeder Mandant wird seiner nächstgelegenen Region zugewiesen, und das DNS spiegelt dies wider (`acme.soc.eu.mssp.example.com`, `acme.soc.us.mssp.example.com`). Das Design unterstützt dies, weil das Routing vom Edge-Proxy zum Mandanten-Namespace nur eine clusterinterne DNS-Abfrage ist. Automatisierte Multi-Region-Verteilung steht auf der Roadmap.

## Runbook: Onboarding des ersten Agents eines Kunden

> **UI-Status:** das dedizierte Panel „Agent Onboarding" in der Mandantendetailansicht ist geplant, aber noch nicht im aktuellen Build vorhanden. Das folgende Runbook beschreibt die Ziel-UX; die Umgehungslösung darunter ist der derzeitige Weg.

**Geplante UX:**

1. Der MSSP-Betreiber erstellt einen Mandanten in der [MSSP-UI](/de-de/mssp-ui) → SocTalk stellt den Stack bereit, generiert das `authd`-Geheimnis.
2. Der MSSP-Betreiber navigiert zur Mandantendetailansicht → Abschnitt „Agent Onboarding".
3. Der Abschnitt zeigt an:
   - Mandanten-Hostname: `acme.soc.mssp.example.com`
   - Ports: 1514/TCP (Events), 1515/TCP (Anmeldung)
   - Gemeinsames `authd`-Geheimnis (maskiert; Kopieren-in-Zwischenablage + einmalige Anzeige)
   - Beispiel-`agent-auth`-Befehl
   - Firewall-Anforderungen
4. Der MSSP-Betreiber kopiert in einen sicheren Kanal und teilt dies mit dem Endpunkt-Administrator des Kunden.
5. Der Endpunkt-Administrator des Kunden installiert + meldet sich an.
6. Der MSSP-Betreiber beobachtet die Mandantendetailansicht → Agents-Tab und sieht den Agent innerhalb von ~30 Sekunden erscheinen.

**Derzeitige Umgehungslösung:**

1. Erstellen Sie den Mandanten in der [MSSP-UI](/de-de/mssp-ui) → Mandanten → **+ New Tenant**.
2. Sobald die Lebenszyklus-Events `workloads_ready` anzeigen, rufen Sie das gemeinsame `authd`-Geheimnis aus Kubernetes ab:
   ```bash
   kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
     -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
   ```
3. Berechnen Sie den Hostnamen des Wazuh-Managers des Mandanten aus dem Wildcard-Muster der Installation (`<slug>.soc.<mssp-domain>`).
4. Teilen Sie beides über einen sicheren Kanal mit dem Endpunkt-Administrator des Kunden; dieser führt `agent-auth` wie oben gezeigt aus.
5. Bestätigen Sie, dass der Agent im eingebetteten Wazuh-Dashboard erscheint (Mandanten → **Open SOC** → Agents).

## Testen (Vorabvalidierung + Pilot-Validierung)

Vorabvalidierung:
- Die `Service`-Vorlage pro Mandant rendert korrekt für beide Werte von `tenant.wazuhIngress.mode` (`loadbalancer` und `edge-haproxy`).
- cert-manager-Zertifikatsausstellung pro Mandant für den Agent-Anmeldekanal (1515).
- End-to-End in `k3d` mit zwei Mandanten, MetalLB stellt zwei LB-IPs bereit (`loadbalancer`-Modus): führen Sie für jeden Mandanten `agent-auth -m <lb-ip> -P <secret>` aus einem Host-Pod aus und bestätigen Sie, dass der Agent im Wazuh-Indexer dieses Mandanten erscheint und nicht im anderen.
- Dasselbe End-to-End im `edge-haproxy`-Modus: HAProxy rendert ein `(IP, port-pair)` pro Mandant, Agents melden sich mit `-m <edge-ip> -p <tenant-port>` an, und der Event-Stream landet im richtigen Indexer.
- Negativ: ein Agent, der auf die Adresse von Mandant A mit dem `authd`-Geheimnis von Mandant B zeigt, wird vom Manager abgelehnt.

Pilot-Validierung (späteres Release):
- Ein echter Kundenendpunkt meldet sich über das öffentliche Internet sauber an.
- Cross-Tenant-Test: melden Sie einen `acme`-Agent mit dem `authd`-Geheimnis von `beta` gegen die Adresse von `beta` an, erwarten Sie eine Ablehnung. Umgekehrt ebenso. Beide schlagen fehl.

In keiner dieser Prüfungen gibt es einen SNI-Schritt: Wazuhs Agent-Protokoll auf 1514 erzeugt kein ClientHello, sodass jeder Test, der „SNI überschreibt", einen Routing-Pfad ausübt, den der produktive Ingress nicht nehmen wird. Validieren Sie stattdessen den Adress-/Port-Diskriminator.
