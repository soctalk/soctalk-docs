---
description: "SocTalk-KI-Triage mit einem bereits betriebenen Wazuh verbinden: aus dem OS-Paket installieren, einen Mandanten mit provided-Profil onboarden und zusehen, wie die erste Warnung zu einem triagierten, eskalierten Fall wird."
---

# SocTalk mit einem bestehenden Wazuh verbinden

Die meisten Wazuh-Shops starten nicht bei null. Es gibt bereits einen Manager, der Agents überwacht, einen Indexer, der Monate an Warnungen vorhält, und ein Dashboard, aus dem das Team ohnehin schon untersucht. Das `provided`-Mandantenprofil von SocTalk ist genau für diese Situation gebaut: SocTalk installiert nur seine eigenen Komponenten, verbindet sich über das Netzwerk mit Ihrem Wazuh und beginnt, die Warnungen zu triagieren, die Ihr Deployment bereits erzeugt. An Ihrem Wazuh ändert sich nichts, keine Agents registrieren sich neu, und es werden keine Daten migriert.

Dieser Leitfaden geht den gesamten Weg auf einem einzelnen Linux-Host durch, vom OS-Paket bis zur ersten KI-triagierten Eskalation, und wurde durchgängig gegen SocTalk v0.2.0 mit Wazuh 4.12.0 verifiziert. Wo dieses Release Ecken und Kanten hat, sagt der Leitfaden es und nennt den Workaround.

Wenn Sie stattdessen möchten, dass SocTalk Wazuh für Sie bereitstellt und verwaltet, ist das das `poc`- oder `persistent`-Profil; siehe [Onboarding eines Kunden-Mandanten](/de-de/guides/wazuh-tenant-onboarding).

## Was Sie vor dem Start benötigen

Ihr bestehendes Wazuh muss vom SocTalk-Host aus über zwei Ports erreichbar sein: die OpenSearch-API des Indexers (`:9200`) und die REST-API des Managers (`:55000`). SocTalk authentifiziert sich an jedem separat, halten Sie also beide Zugangspaare bereit:

- einen Indexer-Benutzer, der `wazuh-alerts-*` durchsuchen darf (der eingebaute `admin` funktioniert, ein schreibgeschützter Benutzer ist jedoch die bessere Praxis),
- einen Manager-API-Benutzer wie den eingebauten `wazuh-wui`.

Selbstsignierte Zertifikate auf der Wazuh-Seite sind der Normalfall und werden unterstützt; Sie übergeben beim Onboarding `verify_ssl: false`. Sie benötigen außerdem einen LLM-API-Schlüssel pro Mandant. Das `provided`-Profil verlangt ihn beim Onboarding, weil ein Bring-your-own-SIEM-Mandant keinen installationsweiten Rückfall hat: Die Onboard-Anfrage wird mit einem 422 abgelehnt, wenn der Schlüssel fehlt.

Der SocTalk-Host selbst braucht den üblichen Footprint: ein systemd-basiertes Linux (Ubuntu 24.04 und Rocky 9 sind das verifizierte Paar), 4 vCPU und 8 GB RAM als Untergrenze für die Control Plane plus einen provided-Mandanten sowie freie Ports 80/443/6443. Da der Mandant kein eigenes Wazuh betreibt, ist ein provided-Mandant weit leichter als ein `persistent`-Mandant.

## SocTalk aus dem OS-Paket installieren

Laden Sie das Paket für Ihre Distribution von der [Releases-Seite](https://github.com/soctalk/soctalk/releases) herunter und installieren Sie es; die vollständige Flavor-Matrix finden Sie unter [Aus einem OS-Paket installieren](/de-de/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.1/soctalk_0.2.1_amd64.deb
sudo apt-get install -y ./soctalk_0.2.1_amd64.deb
```

Das Paket liefert eine Umgebungsvorlage unter `/etc/soctalk/soctalk.env.example`. Kopieren Sie sie, tragen Sie Ihre MSSP-Identität, Admin-Zugangsdaten, den Hostnamen und den LLM-Schlüssel ein und halten Sie sie root-only:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Führen Sie dann den Installer unbeaufsichtigt aus:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Übergeben Sie `--skip-consent` (oder `-y`) explizit. In v0.2.0 erscheint die Zustimmungsabfrage auf einem nicht-interaktiven Terminal weiterhin, selbst wenn jede `SOCTALK_*`-Variable gesetzt ist, und ohne TTY bricht die Installation mit `/dev/tty: No such device or address` ab.

Der Installer bringt k3s und Helm hoch, falls der Host sie nicht hat, installiert das auf die Release-Version gepinnte `soctalk-system`-Chart und gibt am Ende die URL und den Login aus. Drei Pods im Namespace `soctalk-system` (`api`, `app-ui`, `postgres`) bedeuten, dass die Control Plane läuft:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

## Ein Schalter vor dem Onboarding: Netzwerkrichtlinien

Hier ist die scharfe Kante in v0.2.0, gleich vorweg, damit Sie nicht mitten im Onboarding darauf stoßen: Ein `provided`-Mandant rendert eine Cilium-FQDN-Egress-Richtlinie für die externen SIEM-Hosts, aber das k3s, das `soctalk install` einrichtet, läuft mit flannel, das keine Cilium-CRDs hat. Das Provisioning eines provided-Mandanten auf einer unveränderten v0.2.0-Installation scheitert daher am Helm-Schritt mit

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

und der Mandant landet in `degraded`. Das ist nach v0.2.0 behoben ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): Das Chart macht dieses Objekt nun davon abhängig, dass die CRD tatsächlich existiert, und ergänzt eine schlichte `NetworkPolicy`-Egress-Regel für SIEM-Hosts mit IP-Literalen, sodass eine unveränderte flannel-Installation sauber provisioniert. Auf v0.2.0 besteht der Workaround auf einer Single-Host-Installation darin, die Mandanten-Netzwerkrichtlinien vor dem Onboarding zu deaktivieren:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo /usr/local/bin/k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Seien Sie sich über den Kompromiss im Klaren: Dies schaltet die Namespace-Isolations-NetworkPolicies für danach provisionierte Mandanten ab, was auf einem dedizierten Lab- oder Piloten-Host mit einer einzelnen Mandantenklasse vertretbar ist und nicht das, was Sie auf einem geteilten, mandantenfähigen Produktionscluster wollen. Wenn Sie Cilium als CNI betreiben, trifft nichts davon zu, und Sie sollten die Richtlinien eingeschaltet lassen.

Wenn Sie bereits onboarded haben und der Mandant mit dem obigen Fehler in `degraded` steht, setzen Sie den Schalter und drücken Sie auf der Mandantenseite **Retry Provisioning**; Retries sind idempotent und setzen sauber wieder auf.

Noch eine Sache speziell für ein Single-Box-Lab, wo das „bestehende“ Wazuh oft in Docker auf genau demselben Host läuft, auf dem Sie SocTalk installiert haben, erreichbar über die eigene IP des Hosts. k3s setzt NetworkPolicy über seinen mitgelieferten Controller durch, und ein Pod, der die eigene IP des Nodes für einen von Docker veröffentlichten Port erreicht, ist ein Hairpin, den die Richtlinienschicht selbst dann nicht sauber routet, wenn eine Egress-Regel es erlaubt. Das Symptom ist der Adapter, der `ingest_failed: All connection attempts failed` loggt, während dasselbe Wazuh vom Host aus einwandfrei antwortet. Die Mandanten-Netzwerkrichtlinien wie oben zu deaktivieren, behebt das. Ein Wazuh auf einem separaten Host ist ein gewöhnlicher ausgehender Pfad und stößt nicht auf dieses Problem.

## Den Mandanten onboarden

In der MSSP-UI, Tenants, dann **+ New Tenant**, wählen Sie das `provided`-Profil, und der Assistent fügt einen External-SIEM-Schritt ein, den ein PoC- oder persistent-Mandant nicht hat.

![Der Profil-Schritt des New-Tenant-Assistenten mit ausgewähltem Provided, beschrieben als Bring your own Wazuh; die Breadcrumb enthält nun einen External-SIEM-Schritt](/screenshots/existing-wazuh-profile.png)

Dieser Schritt ist die Stelle, an der Sie SocTalk auf Ihr Wazuh zeigen lassen. Der Indexer (OpenSearch, Port 9200) und die Manager-API (Port 55000) authentifizieren sich mit separaten Zugangsdaten, und ein provided-Mandant bringt seinen eigenen LLM-Schlüssel mit, weil der installationsweite MSSP-Schlüssel für dieses Profil nicht gilt.

![Der External-SIEM-Schritt des Assistenten: Indexer-URL und Zugangsdaten, Manager-API-URL und Zugangsdaten, ein optionales vorab erzeugtes API-Token, eine Checkbox „Verify TLS certificates“ zum Abwählen bei selbstsignierten Zertifikaten und der erforderliche LLM-Schlüssel pro Mandant](/screenshots/existing-wazuh-siem-form.png)

Dieselbe Operation über die API ist ein einzelner POST an den Onboard-Endpoint. Beachten Sie den Pfad: `POST /api/mssp/tenants/onboard` ist der Assistenten-Endpoint, der Profile und externes SIEM-Material versteht. Der schlichte `POST /api/mssp/tenants` ist ein reines Identity-Create; auf v0.2.0 ignoriert er diese Felder stillschweigend und hinterlässt Ihnen einen `poc`-Mandanten, der nie provisioniert, senden Sie ein provided-Onboarding also immer an `/onboard`.

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

Ein 202 mit `"profile": "provided"` im Body bestätigt den richtigen Pfad. Wählen Sie den Slug mit Bedacht: Slugs bleiben von archivierten Mandanten reserviert, ein außer Betrieb genommener Test-Mandant gibt seinen Namen also nicht zur Wiederverwendung frei.

Das Provisioning eines provided-Mandanten geht schnell, weil es kein Wazuh-Chart zu installieren gibt; der Controller überspringt diese Phase und schreibt stattdessen ein `wazuh_skipped_provided`-Lifecycle-Event. Auf dem verifizierten Lauf ging der Mandant in unter zwanzig Sekunden von `pending` auf `active`.

## Die Verbindung prüfen

Der Mandanten-Namespace sollte genau zwei Workloads enthalten, den Adapter und den Runs-Worker, und keine Wazuh-Pods:

```bash
sudo /usr/local/bin/k3s kubectl -n tenant-orion-soc get pods
```

Ihr Verbindungsmaterial landet in einem namespace-lokalen Secret namens `tenant-external-siem-creds`, das `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` und `WAZUH_API_PASSWORD` enthält, plus `WAZUH_API_TOKEN`, wenn Sie eines angegeben haben. Der Adapter liest die Indexer-URL aus seiner Umgebung und die Zugangsdaten aus diesem Secret. Sein Log sagt Ihnen innerhalb von Sekunden, ob die Verbindung funktioniert, weil er den Alerts-Index kontinuierlich pollt:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

Die Mandanten-Detailseite zeigt dasselbe, ohne Logs lesen zu müssen. Das External-SIEM-Panel spiegelt die von Ihnen angegebenen Indexer- und API-URLs wider, und die Zeile „Adapter ingest status“ meldet `reachable` mit einer Zählung weitergeleiteter Warnungen, sobald die ersten Warnungen fließen.

![Die Detailseite des Mandanten Orion Labs: Profil provided, Zustand active, ein External-SIEM-Panel mit den Indexer- und API-URLs und ein Adapter-Ingest-Status von reachable mit drei weitergeleiteten Warnungen](/screenshots/existing-wazuh-tenant-detail.png)

Ein 401 im Adapter-Log bedeutet, dass die Indexer-Zugangsdaten falsch sind; ein TLS-Fehler bedeutet, dass `verify_ssl` nicht zu Ihrer Zertifikatssituation passt; ein Timeout bedeutet, dass der SocTalk-Host den Indexer-Port nicht erreichen kann.

Zugangsdaten lassen sich ohne erneutes Onboarding rotieren. `PATCH /api/mssp/tenants/{id}/external-siem` nimmt jede Teilmenge der Onboard-Felder entgegen, schreibt das Secret neu und rollt den Adapter-Pod, damit er das frische Material aufnimmt:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## Die erste triagierte Warnung

Von hier an verhalten sich der Ingest, die Promotion, die Run-Ausführung und der Prüfungs-Workflow genauso wie bei einem SocTalk-verwalteten Wazuh (die Tiefe der Anreicherung unterscheidet sich auf v0.2.0, siehe Aktuelle Einschränkungen): Der Adapter leitet neue Warnungen ab dem Mindestschweregrad weiter (Rule-Level 10 als Standard, konfigurierbar mit `SOCTALK_ADAPTER_MIN_SEVERITY`), die Control Plane promoviert das Wesentliche in Untersuchungen, und der Runs-Worker des Mandanten führt die KI-Triage mit dem eigenen LLM-Schlüssel des Mandanten aus.

Der ehrliche Weg zum Testen ist, Ihr bestehendes Wazuh eine echte hochschwere Warnung erzeugen zu lassen, etwa einen Schwall fehlgeschlagener SSH-Logins gegen einen überwachten Agent gefolgt von einem Erfolg. Wenn Sie lieber keine Produktions-Endpunkte anfassen möchten, übt das direkte Indexieren eines synthetischen Warnungs-Dokuments in `wazuh-alerts-4.x-<date>` mit einem `rule.level` von 12 denselben Pfad, da der Adapter aus dem Index liest statt aus dem Manager.

Auf dem verifizierten Lauf ging eine SSH-Brute-Force-dann-Erfolg-Warnung in etwa einer Minute vom Indexer-Dokument zur fertigen Triage: vom Adapter weitergeleitet, promoviert, vom Supervisor über mehrere LLM-Aufrufe hinweg untersucht und mit 0,95 Konfidenz als `escalate` geschlossen, wobei sie in der [MSSP-Prüfungswarteschlange](/de-de/mssp-ui#reviews-human-in-the-loop) für einen Menschen landete. Die Gesamtausgabe für den Lauf betrug etwa dreißig Cent gegen den Anthropic-Schlüssel des Mandanten, verbucht gegen das Pro-Run-Token-Budget, das unter [KI-Pipeline](/de-de/ai-pipeline) beschrieben ist. Nach ein paar solchen Testwarnungen hält die Prüfungswarteschlange sie nebeneinander vor.

![Die menschliche Prüfungswarteschlange mit drei kritischen Fällen, jeder markiert mit „AI: Escalate“ und einer angebotenen Review-Aktion](/screenshots/existing-wazuh-review-queue.png)

Jede Zeile trägt das KI-Verdikt und öffnet die vollständige Untersuchung, sodass ein Analyst anhand der Evidenz bestätigt oder überstimmt, statt die Triage selbst zu beginnen.


Ein Hinweis, falls Sie Ihren Indexer unter einer anderen Adresse oder einem anderen Port veröffentlichen, damit SocTalk ihn erreicht, etwa über einen NodePort, ein Port-Forward oder einen Reverse Proxy. Testen Sie die Zugangsdaten **über genau die URL, die Sie konfigurieren werden**, nicht gegen den eigenen `:9200` des Indexers. Auf einem so aufgebauten Prüfstand antworteten derselbe Indexer, dieselben Pods und dieselben Zugangsdaten mit `200` auf `:9200` und mit `401` über den neu veröffentlichten Port — mit einem einfachen `curl` vom Host reproduzierbar und damit unabhängig von SocTalk. Wir sind der Ursache nicht nachgegangen; die praktische Lehre ist, dass der neu veröffentlichte Pfad eine eigene Sache ist und eine eigene Prüfung verdient:

```bash
curl -sk -u '<indexer-user>:<indexer-password>' https://<host>:<port>/
```


Gibt das 401 zurück, während der eigene Port des Indexers 200 liefert, korrigieren Sie die Veröffentlichung vor dem Onboarding: SocTalk gibt den 401 getreu wieder.

## Aktuelle Einschränkungen

Beide Vorbehalte unten wurden auf v0.2.0 verifiziert und sind im darauffolgenden Release behoben, auf einem neueren Build können Sie die Workarounds also überspringen. Prüfen Sie die Release Notes für Ihre Version.

- **Anreicherung, die das externe Wazuh erreicht (nur v0.2.0).** Auf v0.2.0 war das Wazuh-MCP-Tooling des Runs-Workers nicht an die Manager-API eines provided-Mandanten verdrahtet, die Triage lief also allein auf der Warnungs-Payload, ohne Live-Pivots in den Agent-Zustand oder die Log-Historie. Nach v0.2.0 behoben ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): Der Worker verbindet nun den mitgelieferten MCP-Server `mcp-server-wazuh` mit dem eigenen Wazuh des Mandanten, sodass der Triage-Graph während einer Untersuchung Agents, Prozesse, Ports, Schwachstellen und Manager-Logs abfragt, genauso wie es ein SocTalk-verwalteter Mandant tut. **Behoben in v0.2.1** ([soctalk#147](https://github.com/soctalk/soctalk/issues/147)): Die Ports werden aus den angegebenen URLs gelesen, jeder Port funktioniert.
- **Provisioning auf einer unveränderten flannel-Installation (nur v0.2.0).** Das zuvor beschriebene Cilium-Egress-Richtlinien-Problem mit seinem Netzwerkrichtlinien-Workaround. Nach v0.2.0 behoben ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
- **Nicht standardmäßige SIEM-Ports (nur v0.2.0).** Die Egress-NetworkPolicy des Tenants leitet den *Host* des externen SIEM aus den angegebenen URLs ab, legt die *Ports* aber fest auf 9200 und 55000. Ein Wazuh, das über einen anderen Port erreichbar ist, wird auf Netzwerkebene verworfen, während der Tenant dennoch `active` erreicht, das Secret mit den Zugangsdaten geschrieben wird und der Adapter weiterhin Heartbeats sendet: Das einzige Symptom ist `ingest_failed: All connection attempts failed` im Adapter-Log. Im selben Cluster verifiziert, wobei nur die Ports variiert wurden: Ein über NodePort `:31437` veröffentlichter Indexer verband sich nie, während dasselbe Wazuh auf `:9200` sich verband und authentifizierte. Bis der Fix ([soctalk#147](https://github.com/soctalk/soctalk/issues/147)) ausgeliefert ist, stellen Sie Indexer und Manager-API für SocTalk auf den Ports 9200 und 55000 bereit. Danach werden die Ports aus den angegebenen URLs gelesen und jeder Port funktioniert.
