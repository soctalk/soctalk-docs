---
description: "Wazuh-MSSP-Kundenonboarding von Anfang bis Ende: isolierten Mandanten-SOC bereitstellen, Agents registrieren, Zugänge vergeben und die erste Woche als Baseline erfassen."
---

# Onboarding eines Kunden-Mandanten in einen mandantenfähigen Wazuh-SOC: eine MSSP-Checkliste

Das „Onboarding“ eines Kunden in einen mandantenfähigen Wazuh-Dienst zerfällt in vier Aufgaben: einen isolierten Stack pro Kunde bereitstellen, die Agents des Kunden in *seinem* Manager registrieren und in keinem anderen, Zugänge vergeben, die die Grenze zwischen MSSP und Kunde respektieren, und die erste Betriebswoche als Baseline erfassen. Dieser Leitfaden geht den gesamten Weg auf SocTalk durch, wo jeder Kunde einen eigenen Wazuh-Manager, -Indexer und ein eigenes Dashboard in einem eigenen Kubernetes-Namespace hinter einer gemeinsamen MSSP Control Plane erhält.

## Entscheidungen, bevor Sie auf New Tenant klicken

**Profil.** Das Profil wird beim Onboarding festgelegt; ein späterer Wechsel bedeutet Decommission und Neuanlage. Entscheiden Sie zuerst:

- `poc`: Evaluierungen und kurzlebige Piloten. `local-path`-Storage ohne echte Persistenzgarantie, niedrige Ressourcen-Requests, keine Backup-Hooks. Dies ist außerdem der **Standard, wenn Sie kein Profil angeben**; `local-path`-Storage bietet keine Persistenzgarantie, daher brauchen Produktionskunden `persistent`.
- `persistent`: produktive Kunden-SOCs. Nutzt die Standard-StorageClass Ihrer Installation und produktionsgerecht dimensionierte Requests; Backup-Hooks werden berücksichtigt, sofern konfiguriert.
- `provided`: der Kunde betreibt bereits Wazuh (BYO-SIEM). SocTalk installiert nur seinen Adapter und den Runs-Worker im Mandanten-Namespace und erreicht den Indexer (`:9200`) und die Manager-API (`:55000`) des Kunden über das Netzwerk. Das externe Verbindungsmaterial *und* die LLM-Zugangsdaten pro Mandant sind beim Onboarding erforderlich; die API antwortet mit 422, wenn sie fehlen.

**Dimensionierung.** Planen Sie grob 6–8 GB RAM und ca. 1,5 vCPU pro `persistent`-Mandant; der Wazuh-Indexer pro Mandant ist in der Regel der Engpass und bestimmt den Plattenbedarf (50-GB-PVC als Standard, 30 Tage Hot-Retention, noch kein Hot→Cold-Tiering). SocTalk ist bis ca. 50 Mandanten auf einem 3-Node-Cluster mit Nodes zu 16 vCPU / 64 GB getestet; alles jenseits von ca. 5 Mandanten auf einem einzelnen Host gilt als nicht validiert. Details unter [Dimensionierung](/de-de/reference/sizing).

**LLM pro Mandant.** Die Triage läuft auf einer LLM-Konfiguration pro Mandant: Anthropic oder ein beliebiger OpenAI-kompatibler Endpoint (Azure OpenAI, vLLM, Ollama, LiteLLM). Ein Kunde kann für die Abrechnungstrennung einen eigenen API-Schlüssel mitbringen. Der Schlüssel wird als Kubernetes Secret in seinem Namespace gemountet, mit der dokumentierten V1-Einschränkung, dass er zusätzlich im Klartext in der SocTalk-Datenbank liegt ([Secrets](/de-de/reference/secrets)). Alternativ können Sie den Mandanten auf einen vollständig lokalen Ollama-Endpoint zeigen lassen, für einen Betrieb ohne Cloud und ohne Kosten pro Token (rechnen Sie mit langsamer CPU-Inferenz). Siehe [LLM-Anbieter](/de-de/integrate/llm-providers).

## Bereitstellung: die neun geordneten Phasen

Legen Sie den Mandanten über die [MSSP-UI](/de-de/mssp-ui) an (Tenants → **+ New Tenant**) oder über die API. Der Mandant durchläuft eine serverseitig erzwungene State Machine, `pending → provisioning → active`, mit `degraded`, `suspended`, `decommissioning`, `archived` und `purged` darüber hinaus. Ungültige Übergänge werden mit einem 409 abgelehnt.

Der Controller führt neun geordnete, idempotente Phasen aus, von denen jede ein Lifecycle-Event ausgibt, das Sie auf der Mandanten-Detailseite verfolgen können: Preflight-Checks, Erzeugen der Secrets pro Mandant (`authd`, JWT, Postgres), Anlegen des Namespace (`tenant-<slug>` mit Labels, ResourceQuota und LimitRange passend zum Profil), Anwenden der Secrets, die `soctalk-tenant`-Helm-Installation (die auch den Benutzer `tenant_admin` automatisch anlegt), die Installation des Wazuh-Charts, ein Readiness-Poll, das Schreiben der Integrationskonfiguration und der Übergang zu `active`.

Schlägt eine Phase fehl, landet der Mandant in `degraded`, mit dem fehlgeschlagenen Schritt in der Event-Zeile. Beheben Sie die Ursache (hängendes PVC, zu knapp bemessene Quota, Image-Pull) und klicken Sie auf **Retry Provisioning**. Der Retry setzt bei Phase 1 wieder auf, und jede Phase ist idempotent, Wiederholungen sind also sicher. Ein Retry ist nur *aus* `degraded` gültig, nicht aus `pending`. Runbooks für festhängende Zustände finden Sie unter [Täglicher Betrieb](/de-de/operations).

## Agent-Registrierung: Endpunkte in den richtigen Mandanten bringen

Jeder Mandant erhält einen eigenen DNS-Namen (`acme.soc.mssp.example.com`), der auf einen L4-Endpoint pro Mandant für 1514/TCP (Events) und 1515/TCP (Registrierung) auflöst. Das Routing erfolgt über die Zieladresse statt über SNI, da das Agent-Protokoll von Wazuh auf 1514 kein Standard-TLS ist und nie ein ClientHello präsentiert.

**V1-Einschränkung:** Das Chart legt den Service des Wazuh-Managers nur als `ClusterIP` an. In diesem Release gibt es **keine automatische LoadBalancer- oder DNS-Bereitstellung**. Die Edge verdrahten Sie selbst: ein LoadBalancer-Service pro Mandant, den Sie manuell anwenden, ein Edge-HAProxy mit Portpaaren pro Mandant an einer einzigen IP oder ein Mesh-VPN-Pfad. DNS-Einträge werden ebenfalls vom Betreiber verwaltet.

Die Registrierung selbst ist per Design mandantengebunden. Rufen Sie das geteilte `authd`-Secret des Mandanten ab:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Übergeben Sie Hostname, Ports und Secret über einen sicheren Kanal an den Endpoint-Admin des Kunden; dieser führt `agent-auth -m <hostname> -P "<secret>"` aus. Ein Agent mit dem Secret von Mandant A kann sich nur beim Manager von Mandant A registrieren. Ein eigener Agents-Tab und ein Agent-Onboarding-Panel stehen auf der Roadmap; heute prüfen Sie Agents im eingebetteten Wazuh-Dashboard (Tenants → **Open SOC** → Agents). Vollständige Topologie- und Firewall-Anforderungen: [Wazuh-Agent-Ingress](/de-de/reference/wazuh-ingress).

## Personen: wer ein Login bekommt

Die Bereitstellung hat bereits einen `tenant_admin` angelegt. Diese Rolle ist Self-Service: Sie verwaltet die Benutzer der eigenen Organisation und die eigenen LLM-Einstellungen über das Kundenportal. Stakeholdern, die Sichtbarkeit brauchen, aber nie handeln sollen, weisen Sie `customer_viewer` zu: schreibgeschützte Dashboards und Untersuchungen, keine Prüfungswarteschlange, kein Chat.

Jeder angelegte Benutzer erhält ein einmaliges temporäres Passwort, das nur einmal angezeigt wird und bei der ersten Anmeldung zwingend geändert werden muss. Eine Audience-Wall trennt die beiden Seiten: Mandantenrollen können nie MSSP-Fähigkeiten halten und umgekehrt, durchgesetzt am Capability-Guard, sodass ein Kunden-Login mandantenübergreifende Oberflächen strukturell nicht erreichen kann. Einen Self-Service-Ablauf für vergessene Passwörter gibt es in diesem Release nicht; Zurücksetzungen erzwingt ein Admin. Vollständiger Katalog: [Benutzer und Rollen](/de-de/users-and-roles).

## Die erste Woche

- **Heartbeat.** Beobachten Sie `soctalk_tenant_adapter_heartbeat_age_seconds` auf `/metrics`. In V1 ist das die einzige aktiv aktualisierte Gauge, und sie stuft den Mandantenzustand *nicht* automatisch herab, alarmieren Sie also selbst darauf.
- **Prüfungswarteschlange.** Neue Mandanten erzeugen Prüfaufkommen, während sich die Baselines einpendeln; jede AI-Eskalation wartet auf einen Menschen in der Dashboard-Warteschlange; einen Auto-Approve-Bypass gibt es nicht.
- **Engagement-Fenster.** Hat der Kunde einen Pentest geplant, deklarieren Sie das Engagement-Fenster (Quelle, Host, Technik, Zeit) vor dessen Beginn, damit genehmigte Aktivität markiert und auditiert statt eskaliert wird. Tester-Aktivität außerhalb des Scopes erzwingt weiterhin einen menschlichen Blick.
- **Grundlagen zu Suspend/Decommission.** Suspend ändert den DB-Zustand und stoppt neue Untersuchungen, skaliert Workloads aber **nicht** herunter; die Notabschaltung ist ein manuelles Runbook. Decommission baut die Data Plane ab und behält die Mandantenzeile samt Audit-Historie in `archived`; einen `:purge`-API-Endpoint gibt es noch nicht.

## Onboarding-Checkliste

- [ ] Profil gewählt (`persistent` für Produktion; `provided` braucht SIEM-URLs + LLM-Zugangsdaten vorab)
- [ ] Cluster-Reserven geprüft (ca. 6–8 GB RAM, ca. 1,5 vCPU pro `persistent`-Mandant)
- [ ] LLM pro Mandant entschieden (BYO-Schlüssel / Installationsstandard / lokales Ollama)
- [ ] Mandant angelegt; Lifecycle-Events haben `active` erreicht
- [ ] Edge manuell verdrahtet: LB- oder Edge-Proxy-Endpoint + DNS-Eintrag für `<slug>.soc.<domain>`
- [ ] `authd`-Secret abgerufen und über einen sicheren Kanal geteilt
- [ ] Erster Agent registriert und im Wazuh-Dashboard des Mandanten sichtbar
- [ ] `tenant_admin` übergeben; `customer_viewer`-Konten nach Bedarf angelegt
- [ ] Heartbeat-Alarmierung auf `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Geplanter Pentest als Engagement-Fenster deklariert

## Vertiefung

- [Mandanten onboarden](/de-de/tenant-onboarding): die Schritt-für-Schritt-Anleitung des Assistenten und der Phasen unten
- [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle): State Machine, Phasen, Wiederherstellungspfade
- [Wazuh-Agent-Ingress](/de-de/reference/wazuh-ingress): Edge-Topologien, Zertifikate, Widerruf
- [Benutzer und Rollen](/de-de/users-and-roles): der vollständige Rollenkatalog und die Audience-Wall
- [Täglicher Betrieb](/de-de/operations): die Runbook-Seite zu allem oben Genannten
- [Launchpad](/de-de/launchpad): den gesamten Ablauf in einem Multi-VM-Pilot von ca. 15–25 Minuten durchspielen
