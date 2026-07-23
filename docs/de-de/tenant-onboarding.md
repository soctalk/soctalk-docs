---
description: "Onboarden Sie einen Kunden-Mandanten in SocTalk von Anfang bis Ende: ein Profil wählen, den Create-Customer-Assistenten ausführen, die Provisionierung bis active verfolgen, die Endpunkte des Kunden anbinden und den Zugang übergeben."
---

# Mandanten onboarden

Beim Onboarding wird aus einem Kunden ein isolierter Mandanten-SOC auf Ihrer Control Plane. Jeder Mandant erhält seinen eigenen Kubernetes-Namespace (`tenant-<slug>`) mit eigenen Secrets, eigenem Ressourcenbudget und (für die Profile `poc` und `persistent`) einem dedizierten Wazuh manager, indexer und dashboard. Diese Seite geht den vollständigen Weg durch, den ein MSSP-Admin in der UI zurücklegt, von der ersten Entscheidung bis zu dem Moment, in dem die Analysten des Kunden ihren SOC öffnen können.

Für den konzeptionellen Überblick (Dimensionierung, die vier Aufgaben, das Baselining der ersten Woche) siehe die [Onboarding-Checkliste](/de-de/guides/wazuh-tenant-onboarding). Für den Zustandsautomaten und die Interna der Profile siehe [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle). Diese Seite ist die operatorseitige Durchsprache.

## Bevor Sie beginnen

- Ihre Control Plane ist installiert und Sie können sich als MSSP-Admin anmelden. Falls sie noch nicht läuft, folgen Sie zuerst der [Produktionsinstallation](/de-de/install) oder dem [Demo-VM-Schnellstart](/de-de/quickstart-vm).
- Sie haben das Profil des Mandanten festgelegt. Es ist für die Lebensdauer des Mandanten fest, lesen Sie also den nächsten Abschnitt, bevor Sie auf **New tenant** klicken.
- Nur für einen `provided`-Mandanten: Sammeln Sie das vorhandene Wazuh-Verbindungsmaterial des Kunden out-of-band ein, bevor Sie den Assistenten öffnen: die Indexer-URL mit Basic-Auth-Benutzer und -Passwort, die Manager-API-URL mit Benutzer und Passwort sowie die mandantenspezifischen LLM-Zugangsdaten. Der Assistent blockiert darauf, sodass das vorherige Sammeln das Parken eines halb ausgefüllten Formulars vermeidet. Siehe [Externe Wazuh-Zugangsdaten koordinieren](/de-de/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Ein Profil wählen

Das Profil wird einmal gewählt und ist fest. Ein späterer Wechsel bedeutet Außerbetriebnahme und erneutes Onboarding, wählen Sie also bewusst.

- **`poc`** ist für Evaluierungen und kurzlebige Pilotprojekte. Das Mandanten-Chart installiert Wazuh plus einen linux-ep-Simulator mit `local-path`-Speicher und knappen Ressourcenbudgets. Dies ist außerdem der Standard, falls Sie keines angeben, und `local-path` bietet keine Persistenzgarantie, weshalb es die falsche Wahl für einen echten Kunden ist.
- **`persistent`** ist für produktive Kunden-SOCs. Dieselbe Wazuh-inklusive Form wie `poc`, aber für Dauerlast auf der Standard-StorageClass des Clusters dimensioniert, mit vollen Chart-Ressourcenbereichen und dort berücksichtigten Backup-Hooks, wo konfiguriert.
- **`provided`** ist für einen Kunden, der bereits Wazuh betreibt (Bring your own SIEM). Das Chart installiert nur den SocTalk-Adapter und runs-worker; SocTalk erreicht den Indexer und die Manager-API des Kunden über das Netzwerk. Das externe Verbindungsmaterial und die mandantenspezifischen LLM-Zugangsdaten sind zum Onboarding-Zeitpunkt erforderlich.

Planen Sie ungefähr 6 bis 8 GB RAM und etwa 1,5 vCPU pro `persistent`-Mandant ein; der mandantenspezifische Wazuh-Indexer ist meist der Flaschenhals. Kapazitätsdetails finden Sie unter [Sizing](/de-de/reference/sizing), und jedes Profil wird unter [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle#profiles) ausführlich behandelt.

## Den Assistenten „Create Customer" ausführen

Klicken Sie im MSSP-Dashboard in der linken Leiste auf **Tenants**, dann oben in der Liste auf **New tenant**. Dies öffnet den Assistenten **Create Customer**. Für `poc` und `persistent` sind es vier Schritte (Identity, Profile, Branding, Review) und für `provided` fünf, wobei ein Schritt External SIEM zwischen Profile und Branding erscheint.

### Schritt 1: Identity

- **Display name**, zum Beispiel `Acme Corp`.
- **Slug**: kurz, kleingeschrieben, mit Bindestrichen getrennt, 3 bis 32 Zeichen, validiert gegen `[a-z0-9-]+`. Der Slug wird zum Namespace `tenant-<slug>` und in nachgelagerte Identifier eingesetzt, wählen Sie ihn also sorgfältig. In einem Tailnet-Piloten muss er dem Tailscale-Tag des Mandanten entsprechen.
- **Contact email**.

### Schritt 2: Profile

Wählen Sie eines aus `poc`, `persistent` oder `provided`. Derselbe Schritt trägt eine Aufklappoption **LLM (advanced)**, um den installationsweit geteilten LLM-Provider, die Base-URL, den Schlüssel und optional die Fast- und Thinking-Modell-IDs zu überschreiben. Lassen Sie sie bei `poc` und `persistent` eingeklappt, um die Installationsstandards zu übernehmen. Bei `provided` sind die LLM-Zugangsdaten erforderlich und blockieren den Schritt, da es für dieses Profil keinen installationsweiten Fallback gibt.

Das Ändern des Profils nach der Provisionierung erfordert Außerbetriebnahme und erneutes Onboarding, bestätigen Sie die Wahl also, bevor Sie fortfahren.

### Schritt 3: External SIEM (nur provided)

Dieser Schritt ist ausgeblendet, es sei denn, Sie haben `provided` gewählt. Füllen Sie zwei Endpoint-plus-Zugangsdaten-Paare aus:

- **Wazuh Indexer URL**, zum Beispiel `https://wazuh.acme.example:9200`, mit dem Indexer-Benutzer und -Passwort für Basic Auth.
- **Wazuh Manager API URL**, zum Beispiel `https://wazuh.acme.example:55000`, mit dem API-Benutzer und -Passwort zum Ausstellen von JWTs.

Beide müssen von der Mandanten-VM aus erreichbar sein. Der Controller wandelt die URLs in eine Cilium-FQDN-Egress-Allow-List auf dem Mandanten-Namespace um; der Adapter erreicht Wazuh niemals direkt aus dem MSSP-Cluster. Prüfen Sie die Manager-Zugangsdaten, bevor Sie absenden:

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (a long base64 string)
```

Wenn das ein Token zurückgibt, lösen sich die Chat-Tools des Mandanten auf, sobald die Mandanten-Data-Plane läuft.

### Schritt 4 (oder 3 für poc und persistent): Branding

Optional. Ein Anzeigename und ein kleines Logo, die im Mandanten-Header erscheinen. Sie können diesen Schritt vollständig überspringen.

### Letzter Schritt: Review

Bestätigen Sie alles und klicken Sie auf **Create**. Die API antwortet mit `202` und führt Sie zur Mandantenliste zurück. Der neue Mandant startet in `pending` und bewegt sich über `provisioning` in Richtung `active`.

## Die Provisionierung bis active verfolgen

Öffnen Sie die Mandanten-Detailseite und aktualisieren Sie sie, um der Tabelle **Lifecycle Events** zu folgen. Der Controller durchläuft neun geordnete, idempotente Phasen, die jeweils ein Ereignis erzeugen:

1. `preflight_ok`: Cluster-Voraussetzungen und Namenskonflikte bestehen.
2. `secrets_minted`: mandantenspezifische Secrets erzeugt (`authd`, JWT-Signierung, Postgres).
3. `namespace_ready`: `tenant-<slug>` mit Labels, ResourceQuota und LimitRange erstellt.
4. `secrets_applied`: Secrets als Kubernetes-Secret-Objekte in den Namespace eingebracht.
5. `helm_applied` (tenant chart): Das `soctalk-tenant`-Chart installiert den Adapter, runs-worker und das Ingress. Der `tenant_admin`-Benutzer wird als Teil dieses Schritts automatisch bereitgestellt.
6. `helm_applied` (Wazuh chart): Das eigenständige Wazuh-Chart installiert den manager, indexer und das dashboard. Die Payload des Ereignisses gibt an, welches Chart angewendet wurde. Diese Phase läuft nicht für `provided`-Mandanten.
7. `workloads_ready`: Alle Data-Plane-Pods melden Ready.
8. `integration_config_written`: mandantenspezifische Integrationskonfigurationen (LLM, TheHive-URLs) in die Datenbank geschrieben.
9. `active`: Der Mandant wechselt nach `active` und ist einsatzbereit.

Wenn der Mandant `active` erreicht, verwenden Sie **Open SOC** aus der Mandantenliste, um sein Dashboard zu betreten.

Falls es hängt, wird die fehlgeschlagene Phase in der Ereignistabelle benannt:

- **In `pending` steckengeblieben**: Der Controller wurde vor Phase 1 neu geplant. Ein Retry ist direkt aus `pending` nicht zulässig; warten Sie, bis der Versuch nach `degraded` übergeht, und klicken Sie dann auf **Retry Provisioning**. Die Provisionierung wird ab Phase 1 fortgesetzt.
- **Länger als 15 Minuten in `provisioning`**: meist ein hängender Pod (ImagePullBackOff, eine PVC im Zustand `Pending` oder eine zu kleine ResourceQuota). Siehe [Täglicher Betrieb](/de-de/operations#tenant-stuck-in-provisioning).
- **In `degraded`**: Eine Provisionierungsphase ist fehlgeschlagen. Lesen Sie die Ereigniszeile, um zu sehen, welche, dann **Retry Provisioning**, was ein gültiger Übergang von `degraded` ist. Mehr Details unter [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle#recovery-paths).

## Die Endpunkte des Kunden anbinden

Endpunkt-Enrollment bedeutet, die Maschinen des Kunden dazu zu bringen, an den Wazuh manager des richtigen Mandanten zu melden. Es gilt für `poc`- und `persistent`-Mandanten, die Wazuh innerhalb ihres Namespace betreiben. Ein `provided`-Mandant sendet seine Endpunkte bereits an das eigene Wazuh des Kunden, sodass es hier nichts anzubinden gibt; springen Sie zum nächsten Abschnitt.

Der Wazuh manager jedes Mandanten lauscht auf 1514/TCP (Ereignisse) und 1515/TCP (Enrollment). In diesem Release erstellt das Chart diesen manager nur als `ClusterIP`-Service: Es gibt keine automatische LoadBalancer- oder DNS-Bereitstellung, sodass Sie den Edge selbst verdrahten (ein mandantenspezifischer LoadBalancer-Service, ein Edge-HAProxy mit mandantenspezifischen Port-Paaren an einer einzigen IP oder ein Mesh-VPN-Pfad) und den DNS-Eintrag verwalten. Vollständige Topologie und Firewall-Anforderungen stehen unter [Wazuh-Agent-Ingress](/de-de/reference/wazuh-ingress).

Das Enrollment wird über das `authd`-Shared-Secret des managers auf den Mandanten begrenzt. Rufen Sie es ab:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Übergeben Sie den manager-Hostnamen, die zwei Ports und dieses Secret über einen sicheren Kanal an den Endpunkt-Admin des Kunden. Dieser bindet jeden Endpunkt an mit:

```bash
agent-auth -m <tenant-manager-hostname> -P "<authd-secret>"
```

Ein Agent, der das Secret eines Mandanten hält, kann sich nur beim manager dieses Mandanten registrieren, was das Enrollment isoliert hält. Bestätigen Sie im eingebetteten Wazuh dashboard, dass die Agents angekommen sind: Tenants, dann **Open SOC**, dann Agents.

Falls die Data Plane des Mandanten stattdessen auf separater Infrastruktur läuft (das Remote-Pilot-Modell, bei dem eine Mandanten-VM über ein Tailnet beitritt), wird diese VM über einen `:issue-agent`-Cloud-Agent-Flow bei der Control Plane registriert, was etwas anderes ist als das obige Endpunkt-Enrollment. Dieser Pfad wird durchgehend in der [MSSP-Pilot-Durchsprache](/de-de/mssp-pilot#_4-tenant-side-stand-up-the-data-plane) behandelt.

## Zugang übergeben

Der `tenant_admin`-Benutzer wird während Phase 5 automatisch erstellt, sodass der Mandant einen Administrator hat, sobald er `active` erreicht. Um diesem Administrator eine nutzbare Anmeldeinformation zu geben, erzwingen Sie von der MSSP-Seite aus ein Passwort-Reset (der Akteur muss `mssp_admin` oder `platform_admin` sein):

```bash
curl -X POST 'https://<mssp-host>/api/mssp/users/<user-id>/password/reset' \
  -b jar -H 'Origin: https://<mssp-host>'
```

Die Antwort liefert ein einmaliges `temporary_password` mit dem Flag `must_change=true` zurück, und das Reset widerruft alle bestehenden Sitzungen dieses Benutzers. Teilen Sie dieses Passwort zusammen mit der Portal-URL des Kunden über einen Ende-zu-Ende-verschlüsselten Kanal wie einen gemeinsam genutzten Passwortmanager, niemals über eine unverschlüsselte E-Mail oder einen öffentlichen Chat-Kanal. Der Mandanten-Admin wählt bei der ersten Anmeldung ein neues Passwort.

Von da an ist der Mandant self-service: Der `tenant_admin` meldet sich am Kundenportal an, öffnet **Users** und stellt die eigenen Logins der Organisation bereit (zum Beispiel `customer_viewer` für Read-only-Stakeholder). MSSP-Personal und Mandantenbenutzer sitzen auf gegenüberliegenden Seiten einer Audience-Grenze, die der Capability-Guard erzwingt, sodass ein Mandanten-Login strukturell keine mandantenübergreifenden Oberflächen erreichen kann. Rollen und diese Grenze werden unter [Benutzer und Rollen](/de-de/users-and-roles) beschrieben.

## Verifizieren

- Der Mandant zeigt `active` in der Mandantenliste, und **Open SOC** lädt sein Dashboard.
- Bestätigen Sie für `poc` und `persistent`, dass die angebundenen Endpunkte unter Open SOC, dann Agents erscheinen und dass Ereignisse von ihnen im Wazuh dashboard des Mandanten landen.
- Bestätigen Sie für `provided`, dass der `soctalk-adapter`-Pod Ready ist, und führen Sie dann eine Wazuh-gestützte Abfrage im SocTalk-Chat aus (fragen Sie zum Beispiel nach jüngsten Alerts auf einem bekannten Host). Sie löst sich auf, sobald der Adapter die External-SIEM-Endpunkte des Kunden erreichen kann; falls nicht, prüfen Sie die Erreichbarkeit gemäß [Externe Wazuh-Zugangsdaten koordinieren](/de-de/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants) erneut.

## Siehe auch

- [Onboarding-Checkliste](/de-de/guides/wazuh-tenant-onboarding) für den konzeptionellen Überblick und die Baseline der ersten Woche.
- [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle) für den Zustandsautomaten, die Profile, Kontingente und Wiederherstellungspfade.
- [MSSP-UI-Tour](/de-de/mssp-ui#tenants) für die Mandantenliste und die Detailseiten.
- [MSSP-Pilot: selbst durchführen](/de-de/mssp-pilot) für den vollständigen Tailnet-basierten Rollout einschließlich der mandantenseitigen Data Plane.
