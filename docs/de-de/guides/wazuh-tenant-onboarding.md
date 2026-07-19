---
description: Wazuh-MSSP-Kunden-Onboarding von Anfang bis Ende — einen isolierten Mandanten-SOC bereitstellen, Agents registrieren, Zugänge vergeben und die erste Woche als Baseline etablieren.
---

# Onboarding eines Kunden-Mandanten in einen mandantenfähigen Wazuh-SOC: eine MSSP-Checkliste

Das „Onboarding“ eines Kunden in einen mandantenfähigen Wazuh-Dienst besteht aus vier Aufgaben, nicht aus einer: Bereitstellung eines isolierten Stacks pro Kunde, Registrierung der Agents des Kunden bei *ihrem* Manager und bei keinem anderen, Vergabe von Zugängen, die die Grenze zwischen MSSP und Kunde respektieren, und Etablierung der Baseline in der ersten Betriebswoche. Dieser Leitfaden führt durch den gesamten Ablauf auf SocTalk, wo jeder Kunde einen dedizierten Wazuh-Manager, -Indexer und ein eigenes Dashboard in einem eigenen Kubernetes-Namespace hinter einer gemeinsamen MSSP Control Plane erhält.

## Entscheidungen vor dem Klick auf „New Tenant“

**Profil.** Das Profil wird zum Onboarding-Zeitpunkt festgelegt — ein späterer Wechsel bedeutet Decommission + Neuanlage — entscheiden Sie also zuerst:

- `poc` — Evaluierungen und kurzlebige Piloten. `local-path`-Storage ohne echte Persistenzgarantie, niedrige Ressourcen-Requests, keine Backup-Hooks. Dies ist außerdem der **Standard, wenn Sie keines angeben** — für einen zahlenden Kunden der falsche Standard.
- `persistent` — produktive Kunden-SOCs. Verwendet die Standard-StorageClass Ihrer Installation, produktionsgerecht dimensionierte Requests; Backup-Hooks werden berücksichtigt, sofern konfiguriert.
- `provided` — der Kunde betreibt bereits Wazuh (BYO-SIEM). SocTalk installiert nur seinen Adapter und den Runs-Worker im Mandanten-Namespace und erreicht den Indexer (`:9200`) und die Manager-API (`:55000`) des Kunden über das Netzwerk. Das externe Verbindungsmaterial *und* die LLM-Zugangsdaten pro Mandant sind zum Onboarding-Zeitpunkt erforderlich — fehlen sie, liefert die API 422.

**Dimensionierung.** Planen Sie grob 6–8 GB RAM und ~1,5 vCPU pro `persistent`-Mandant; der Wazuh-Indexer pro Mandant ist in der Regel der Engpass und bestimmt den Plattenbedarf (50-GB-PVC als Standard, 30 Tage Hot-Retention, noch kein Hot→Cold-Tiering). SocTalk ist bis ~50 Mandanten auf einem 3-Knoten-Cluster mit Knoten à 16 vCPU / 64 GB getestet; alles jenseits von ~5 Mandanten auf einem einzelnen Host gilt als unvalidiert. Details unter [Dimensionierung](/de-de/reference/sizing).

**LLM pro Mandant.** Die Triage läuft auf einer LLM-Konfiguration pro Mandant: Anthropic oder ein beliebiger OpenAI-kompatibler Endpunkt (Azure OpenAI, vLLM, Ollama, LiteLLM). Ein Kunde kann zur Abrechnungsisolation einen eigenen API-Schlüssel mitbringen — als Kubernetes Secret in seinem Namespace gemountet, mit dem dokumentierten V1-Vorbehalt, dass der Schlüssel zusätzlich im Klartext in der SocTalk-Datenbank liegt ([Secrets](/de-de/reference/secrets)) — oder Sie richten den Mandanten auf einen vollständig lokalen Ollama-Endpunkt aus, für einen Betrieb ohne Cloud und ohne Kosten pro Token (kalkulieren Sie langsame CPU-Inferenz ein). Siehe [LLM-Provider](/de-de/integrate/llm-providers).

## Provisionierung: was tatsächlich passiert

Erstellen Sie den Mandanten über die [MSSP-UI](/de-de/mssp-ui) (Tenants → **+ New Tenant**) oder die API. Der Mandant durchläuft eine serverseitig erzwungene State Machine — `pending → provisioning → active`, darüber hinaus `degraded`, `suspended`, `decommissioning`, `archived` und `purged`; ungültige Übergänge werden mit einem 409 abgelehnt.

Der Controller führt neun geordnete, idempotente Phasen aus, von denen jede ein Lifecycle-Event emittiert, das Sie auf der Mandanten-Detailseite verfolgen können: Preflight-Checks, Erzeugung der Secrets pro Mandant (`authd`, JWT, Postgres), Anlage des Namespace (`tenant-<slug>` mit Labels, ResourceQuota und LimitRange passend zum Profil), Anwenden der Secrets, die `soctalk-tenant`-Helm-Installation (die auch den Benutzer `tenant_admin` automatisch anlegt), die Installation des Wazuh-Charts, ein Readiness-Poll, das Schreiben der Integrationskonfiguration und der Übergang zu `active`.

Schlägt eine Phase fehl, landet der Mandant in `degraded`, mit dem fehlgeschlagenen Schritt in der Event-Zeile festgehalten. Beheben Sie die Ursache (hängendes PVC, zu knapp bemessene Quota, Image-Pull) und klicken Sie auf **Retry Provisioning** — der Retry setzt bei Phase 1 wieder auf, und jede Phase ist idempotent, Wiederholungen sind also sicher. Retry ist nur *aus* `degraded` gültig, nicht aus `pending`. Runbooks für festhängende Zustände finden Sie unter [Täglicher Betrieb](/de-de/operations).

## Agent-Registrierung: Endpunkte in den richtigen Mandanten bringen

Jeder Mandant erhält einen dedizierten DNS-Namen (`acme.soc.mssp.example.com`), der auf einen L4-Endpunkt pro Mandant für 1514/TCP (Events) und 1515/TCP (Registrierung) auflöst. Das Routing erfolgt nach Zieladresse, nicht per SNI — Wazuhs Agent-Protokoll auf 1514 ist kein Standard-TLS und präsentiert nie ein ClientHello.

**Ehrlicher V1-Vorbehalt:** Das Chart erstellt den Service des Wazuh-Managers nur als `ClusterIP`. Es gibt in diesem Release **keine automatische LoadBalancer- oder DNS-Provisionierung** — die Edge verdrahten Sie selbst: ein manuell angewendeter LoadBalancer-Service pro Mandant, ein Edge-HAProxy mit Portpaaren pro Mandant an einer einzigen IP oder ein Mesh-VPN-Pfad. DNS-Einträge werden ebenfalls vom Operator verwaltet.

Die Registrierung selbst ist per Design mandantenbezogen. Rufen Sie das geteilte `authd`-Secret des Mandanten ab:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Übergeben Sie Hostname, Ports und Secret über einen sicheren Kanal an den Endpoint-Administrator des Kunden; dieser führt `agent-auth -m <hostname> -P "<secret>"` aus. Ein Agent mit dem Secret von Mandant A kann sich nur beim Manager von Mandant A registrieren. Ein dedizierter Agents-Tab und ein Agent-Onboarding-Panel stehen auf der Roadmap; heute prüfen Sie Agents im eingebetteten Wazuh-Dashboard (Tenants → **Open SOC** → Agents). Vollständige Topologie- und Firewall-Anforderungen: [Wazuh-Agent-Ingress](/de-de/reference/wazuh-ingress).

## Personen: wer ein Login bekommt

Die Provisionierung hat bereits einen `tenant_admin` angelegt. Diese Rolle ist Self-Service: Sie verwaltet die Benutzer der eigenen Organisation und die eigenen LLM-Einstellungen über das Kundenportal. Stakeholdern, die Sichtbarkeit benötigen, aber nie handeln sollen, weisen Sie `customer_viewer` zu — schreibgeschützte Dashboards und Untersuchungen, keine Prüf-Queue, kein Chat.

Jeder angelegte Benutzer erhält ein einmaliges temporäres Passwort, das nur ein einziges Mal angezeigt und bei der ersten Anmeldung zwingend geändert wird. Eine Audience-Wall trennt die beiden Seiten: Mandantenrollen können nie MSSP-Berechtigungen halten und umgekehrt, durchgesetzt am Capability Guard — ein Kunden-Login kann mandantenübergreifende Oberflächen also strukturell nicht erreichen. Beachten Sie: In diesem Release gibt es keinen Self-Service-Ablauf für vergessene Passwörter — Zurücksetzungen erfolgen ausschließlich durch Administratoren. Vollständiger Katalog: [Benutzer und Rollen](/de-de/users-and-roles).

## Die erste Woche

- **Heartbeat.** Beobachten Sie `soctalk_tenant_adapter_heartbeat_age_seconds` unter `/metrics` — in V1 ist das die einzige aktiv aktualisierte Gauge, und sie versetzt den Mandantenzustand *nicht* automatisch in `degraded`; richten Sie das Alerting also selbst ein.
- **Prüf-Queue.** Neue Mandanten erzeugen Prüfaufkommen, während sich die Baselines einpendeln; jede AI-Eskalation wartet auf einen Menschen in der Dashboard-Queue — einen Auto-Approve-Bypass gibt es nicht.
- **Engagement-Fenster.** Hat der Kunde einen Pentest geplant, deklarieren Sie das Engagement-Fenster (Quelle, Host, Technik, Zeitraum) vor dessen Beginn, damit genehmigte Aktivität markiert und auditiert statt eskaliert wird — und Tester-Aktivität außerhalb des Scopes weiterhin eine menschliche Prüfung erzwingt.
- **Grundlagen zu Suspend/Decommission.** Suspend ändert den DB-Zustand und stoppt neue Untersuchungen, skaliert Workloads aber **nicht** herunter — die Notabschaltung ist ein manuelles Runbook. Decommission baut die Data Plane ab und behält die Mandantenzeile samt Audit-Historie in `archived`; einen `:purge`-API-Endpunkt gibt es noch nicht.

## Onboarding-Checkliste

- [ ] Profil gewählt (`persistent` für Produktion; `provided` braucht SIEM-URLs + LLM-Zugangsdaten vorab)
- [ ] Cluster-Reserve geprüft (~6–8 GB RAM, ~1,5 vCPU pro `persistent`-Mandant)
- [ ] LLM pro Mandant entschieden (eigener Schlüssel / Installations-Default / lokales Ollama)
- [ ] Mandant angelegt; Lifecycle-Events haben `active` erreicht
- [ ] Edge manuell verdrahtet: LB- oder Edge-Proxy-Endpoint + DNS-Eintrag für `<slug>.soc.<domain>`
- [ ] `authd`-Secret abgeholt und über einen sicheren Kanal geteilt
- [ ] Erster Agent registriert und im Wazuh-Dashboard des Mandanten sichtbar
- [ ] `tenant_admin` übergeben; `customer_viewer`-Konten nach Bedarf angelegt
- [ ] Heartbeat-Alarmierung auf `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Jeder geplante Pentest als Engagement-Fenster deklariert

## Weiterführende Themen

- [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle) — State Machine, Phasen, Wiederherstellungspfade
- [Wazuh-Agent-Ingress](/de-de/reference/wazuh-ingress) — Edge-Topologien, Zertifikate, Widerruf
- [Benutzer und Rollen](/de-de/users-and-roles) — der vollständige Rollenkatalog und die Audience-Wall
- [Täglicher Betrieb](/de-de/operations) — die Runbook-Seite zu allem oben Genannten
- [Launchpad](/de-de/launchpad) — üben Sie den gesamten Ablauf in einem ~15–25-minütigen Multi-VM-Pilot
