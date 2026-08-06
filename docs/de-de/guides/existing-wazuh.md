---
description: "SocTalk-KI-Triage an ein bereits betriebenes Wazuh anbinden: aus dem OS-Paket installieren, einen Mandanten mit provided-Profil onboarden und verfolgen, wie die erste Warnung zu einem triagierten, eskalierten Fall wird."
---

# SocTalk mit einem bestehenden Wazuh verbinden

Die meisten Wazuh-Betriebe fangen nicht bei null an. Es gibt bereits einen Manager, der Agents überwacht, einen Indexer mit Warnungen aus mehreren Monaten und ein Dashboard, aus dem das Team längst seine Untersuchungen führt. Das `provided`-Mandantenprofil von SocTalk ist genau für diese Situation gebaut: SocTalk installiert nur seine eigenen Komponenten, verbindet sich über das Netzwerk mit Ihrem Wazuh und beginnt, die Warnungen zu triagieren, die Ihre Umgebung ohnehin schon erzeugt. An Ihrem Wazuh ändert sich nichts, keine Agents registrieren sich neu, und es werden keine Daten migriert.

Dieser Leitfaden geht den gesamten Weg auf einem einzelnen Linux-Host durch, vom OS-Paket bis zur ersten KI-triagierten Eskalation, und wurde von Anfang bis Ende gegen SocTalk v0.2.0 mit Wazuh 4.12.0 verifiziert. Wo dieses Release noch Kanten hat, sagt der Leitfaden das offen und liefert den Workaround.

Wenn SocTalk Wazuh stattdessen für Sie bereitstellen und verwalten soll, ist das das `poc`- oder `persistent`-Profil; siehe [Onboarding eines Kunden-Mandanten](/de-de/guides/wazuh-tenant-onboarding).

## Was Sie vor dem Start brauchen

Ihr bestehendes Wazuh muss vom SocTalk-Host aus auf zwei Ports erreichbar sein: der OpenSearch-API des Indexers (`:9200`) und der REST API des Managers (`:55000`). SocTalk authentifiziert sich bei beiden getrennt, halten Sie also beide Zugangsdatenpaare bereit:

- einen Indexer-Benutzer, der `wazuh-alerts-*` durchsuchen darf (der eingebaute `admin` funktioniert, ein rein lesender Benutzer ist aber die bessere Praxis),
- einen Manager-API-Benutzer wie den eingebauten `wazuh-wui`.

Selbstsignierte Zertifikate auf der Wazuh-Seite sind die Regel und werden unterstützt; beim Onboarding übergeben Sie dann `verify_ssl: false`. Außerdem brauchen Sie einen LLM-API-Schlüssel pro Mandant. Das `provided`-Profil verlangt ihn beim Onboarding, denn ein BYO-SIEM-Mandant hat keinen installationsweiten Fallback: Fehlt der Schlüssel, wird die Onboard-Anfrage mit einem 422 abgelehnt.

Der SocTalk-Host selbst braucht den üblichen Fußabdruck: ein Linux mit systemd (Ubuntu 24.04 und Rocky 9 sind das verifizierte Paar), 4 vCPU und 8 GB RAM als Untergrenze für die Control Plane plus einen provided-Mandanten sowie freie Ports 80/443/6443. Da der Mandant kein eigenes Wazuh betreibt, ist ein provided-Mandant deutlich leichter als ein `persistent`-Mandant.

## SocTalk aus dem OS-Paket installieren

Laden Sie das Paket für Ihre Distribution von der [Releases-Seite](https://github.com/soctalk/soctalk/releases) herunter und installieren Sie es; die vollständige Varianten-Matrix steht unter [Installation aus einem OS-Paket](/de-de/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

Das Paket liefert eine Umgebungsvorlage unter `/etc/soctalk/soctalk.env.example` mit. Kopieren Sie sie, tragen Sie Ihre MSSP-Identität, die Admin-Zugangsdaten, den Hostnamen und den LLM-Schlüssel ein und halten Sie die Datei nur für root lesbar:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Führen Sie den Installer anschließend unbeaufsichtigt aus:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Übergeben Sie `--skip-consent` (oder `-y`) explizit. In v0.2.0 erscheint die Zustimmungsabfrage auf einem nicht interaktiven Terminal auch dann, wenn alle `SOCTALK_*`-Variablen gesetzt sind, und ohne TTY bricht die Installation mit `/dev/tty: No such device or address` ab.

Der Installer richtet k3s und Helm ein, falls sie auf dem Host fehlen, installiert das `soctalk-system`-Chart, gepinnt auf die Release-Version, und gibt zum Abschluss URL und Login aus. Drei Pods im Namespace `soctalk-system` (`api`, `app-ui`, `postgres`) bedeuten, dass die Control Plane läuft:

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## Ein Schalter vor dem Onboarding: Netzwerk-Policies

Hier ist die scharfe Kante in v0.2.0, vorab genannt, damit sie Sie nicht mitten im Onboarding trifft: Ein `provided`-Mandant rendert eine Cilium-FQDN-Egress-Policy für die externen SIEM-Hosts, aber das k3s, das `soctalk install` einrichtet, läuft mit flannel und hat damit keine Cilium-CRDs. Die Bereitstellung eines provided-Mandanten auf einer unveränderten v0.2.0-Installation scheitert deshalb im Helm-Schritt mit

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

und der Mandant landet in `degraded`. Das ist nach v0.2.0 behoben ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): Das Chart knüpft dieses Objekt jetzt daran, dass die CRD tatsächlich existiert, und ergänzt eine einfache `NetworkPolicy`-Egress für SIEM-Hosts, die als IP-Literal angegeben sind, sodass eine unveränderte flannel-Installation sauber bereitstellt. Auf v0.2.0 besteht der Workaround bei einer Einzel-Host-Installation darin, die Mandanten-Netzwerk-Policies vor dem Onboarding zu deaktivieren:

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Machen Sie sich den Kompromiss klar: Damit werden die NetworkPolicies zur Namespace-Isolation für alle danach bereitgestellten Mandanten abgeschaltet. Das ist auf einem dedizierten Labor- oder Pilot-Host mit einem einzigen Mandanten akzeptabel, aber nicht das, was Sie auf einem gemeinsam genutzten, mandantenfähigen Produktionscluster wollen. Wenn Sie Cilium als CNI betreiben, trifft nichts davon zu, und Sie sollten die Policies aktiviert lassen.

Wenn Sie das Onboarding bereits durchgeführt haben und der Mandant mit dem obigen Fehler in `degraded` steht, setzen Sie den Schalter und klicken auf der Mandantenseite auf **Retry Provisioning**; Retries sind idempotent und setzen sauber wieder auf.

Noch eine Sache, die speziell für ein Single-Box-Lab gilt, wo das „bestehende“ Wazuh oft in Docker auf genau demselben Host läuft, auf dem Sie SocTalk installiert haben, und über die eigene IP des Hosts erreicht wird. k3s erzwingt NetworkPolicy über seinen mitgelieferten Controller, und ein Pod, der die eigene IP des Nodes für einen von Docker veröffentlichten Port erreicht, ist ein Hairpin, den die Policy-Schicht selbst dann nicht sauber routet, wenn eine Egress-Regel es erlaubt. Das Symptom ist, dass der Adapter `ingest_failed: All connection attempts failed` protokolliert, während dasselbe Wazuh vom Host aus einwandfrei antwortet. Das Deaktivieren der Mandanten-Netzwerk-Policies wie oben behebt es. Ein Wazuh auf einem separaten Host ist ein gewöhnlicher ausgehender Pfad und trifft nicht darauf.

## Den Mandanten onboarden

In der MSSP-UI unter Tenants, dann **+ New Tenant**, wählen Sie das `provided`-Profil, und der Assistent fragt das externe Verbindungsmaterial ab. Dieselbe Operation über die API ist ein einziger POST auf den Onboard-Endpoint. Achten Sie auf den Pfad: `POST /api/mssp/tenants/onboard` ist der Assistenten-Endpoint, der Profile und externes SIEM-Material versteht. Der schlichte `POST /api/mssp/tenants` ist ein reines Identity-Create, das diese Felder stillschweigend ignoriert und Ihnen einen `poc`-Mandanten hinterlässt, der nie provisioniert wird.

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

Ein 202 mit `"profile": "provided"` im Body bestätigt den richtigen Pfad. Wählen Sie den Slug mit Bedacht: Slugs bleiben durch archivierte Mandanten reserviert, ein stillgelegter Test-Mandant gibt seinen Namen also nicht zur Wiederverwendung frei.

Die Bereitstellung eines provided-Mandanten geht schnell, weil kein Wazuh-Chart zu installieren ist; der Controller überspringt diese Phase und protokolliert stattdessen ein Lifecycle-Event `wazuh_skipped_provided`. Im verifizierten Lauf ging der Mandant in unter zwanzig Sekunden von `pending` zu `active`.

## Die Verbindung prüfen

Der Mandanten-Namespace sollte genau zwei Workloads enthalten, den Adapter und den Runs-Worker, und keine Wazuh-Pods:

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

Ihr Verbindungsmaterial landet in einem Namespace-lokalen Secret namens `tenant-external-siem-creds` mit `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` und `WAZUH_API_PASSWORD`, plus `WAZUH_API_TOKEN`, sofern Sie einen angegeben haben. Der Adapter liest die Indexer-URL aus seiner Umgebung und die Zugangsdaten aus diesem Secret. Sein Log zeigt Ihnen binnen Sekunden, ob die Verbindung funktioniert, denn er pollt den Warnungs-Index kontinuierlich:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

Ein 401 an dieser Stelle bedeutet falsche Indexer-Zugangsdaten; ein TLS-Fehler bedeutet, dass `verify_ssl` nicht zu Ihrer Zertifikatslage passt; ein Timeout bedeutet, dass der SocTalk-Host den Indexer-Port nicht erreicht.

Zugangsdaten rotieren ohne erneutes Onboarding. `PATCH /api/mssp/tenants/{id}/external-siem` nimmt eine beliebige Teilmenge der Onboard-Felder entgegen, schreibt das Secret neu und startet den Adapter-Pod durch, damit er das frische Material übernimmt:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## Die erste triagierte Warnung

Von hier an verhält sich die Pipeline exakt wie bei einem von SocTalk verwalteten Wazuh: Der Adapter leitet neue Warnungen ab der Mindestschwere weiter (standardmäßig Rule Level 10, konfigurierbar über `SOCTALK_ADAPTER_MIN_SEVERITY`), die Control Plane befördert das Relevante zu Untersuchungen, und der Runs-Worker des Mandanten führt die KI-Triage mit dem eigenen LLM-Schlüssel des Mandanten aus.

Der ehrliche Test besteht darin, Ihr bestehendes Wazuh eine echte Warnung hoher Schwere erzeugen zu lassen, zum Beispiel eine Serie fehlgeschlagener SSH-Logins gegen einen überwachten Agent, gefolgt von einem erfolgreichen. Wenn Sie Produktions-Endpunkte lieber nicht anfassen, übt das direkte Indexieren eines synthetischen Warnungsdokuments in `wazuh-alerts-4.x-<date>` mit einem `rule.level` von 12 denselben Pfad aus, da der Adapter aus dem Index liest und nicht vom Manager.

Im verifizierten Lauf ging eine Warnung vom Typ SSH-Brute-Force mit anschließendem Erfolg in etwa einer Minute vom Indexer-Dokument zur fertigen Triage: vom Adapter weitergeleitet, befördert, vom Supervisor über mehrere LLM-Aufrufe untersucht und als `escalate` mit einer Konfidenz von 0,95 abgeschlossen, gelandet in der [MSSP-Prüfungswarteschlange](/de-de/mssp-ui#reviews-human-in-the-loop) für einen Menschen. Die Gesamtkosten des Laufs lagen bei rund dreißig Cent gegen den Anthropic-Schlüssel des Mandanten, verbucht gegen das Token-Budget pro Lauf, das in [KI-Pipeline](/de-de/ai-pipeline) beschrieben ist.

## Aktuelle Einschränkungen

Beide unten genannten Vorbehalte wurden auf v0.2.0 verifiziert und sind im darauf folgenden Release behoben, auf einem neueren Build können Sie die Workarounds also überspringen. Prüfen Sie die Release Notes für Ihre Version.

- **Die Anreicherung erreicht das externe Wazuh (nur v0.2.0).** Auf v0.2.0 war das Wazuh-MCP-Tooling des Runs-Workers nicht mit der Manager-API eines provided-Mandanten verdrahtet, die Triage lief also allein auf Basis der Warnungs-Payload, ohne Live-Pivots in Agent-Zustand oder Log-Historie. Nach v0.2.0 behoben ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): Der Worker verbindet jetzt den mitgelieferten MCP-Server `mcp-server-wazuh` mit dem eigenen Wazuh des Mandanten, sodass der Triage-Graph während einer Untersuchung Agents, Prozesse, Ports, Schwachstellen und Manager-Logs abfragt, genauso wie es ein von SocTalk verwalteter Mandant tut.
- **Die Bereitstellung auf einer unveränderten flannel-Installation (nur v0.2.0).** Das weiter oben beschriebene Problem mit der Cilium-Egress-Policy, samt seinem Netzwerk-Policy-Workaround. Nach v0.2.0 behoben ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
