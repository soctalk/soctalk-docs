---
title: "Multi-Tenant-Wazuh für MSSPs: Architekturmuster, die Mandanten wirklich isolieren"
description: "Multi-Tenant-Wazuh als MSSP betreiben: Manager pro Mandant auf Kubernetes, Postgres RLS, Netzwerkisolation, Agent-Enrollment und Dimensionierung pro Mandant."
---

# Multi-Tenant-Wazuh für MSSPs: Architekturmuster, die Mandanten wirklich isolieren

Wazuh bietet keine native Multi-Tenancy. Es gibt kein "Tenant"-Objekt im Manager, keine Grenze pro Kunde im Regelwerk und keine kundenbezogene Eingrenzung des `authd`-Enrollments. Jeder MSSP, der auf Wazuh standardisiert, baut Mandantenfähigkeit am Ende selbst darum herum, und das gewählte Muster bestimmt die Isolationsgarantien, die Onboarding-Geschwindigkeit und die Kostenuntergrenze pro Kunde.

Dieser Leitfaden beschreibt, was ein MSSP von einem Multi-Tenant-Wazuh-Deployment braucht, die drei Muster, die Teams in der Praxis ausprobieren, und was produktionsreife Isolation über das SIEM hinaus erfordert. Es ist die Architektur, die SocTalk als Open Source (Apache 2.0) implementiert; die durchgehend verlinkten Referenzseiten gehen bei jeder Schicht eine Ebene tiefer.

## Was ein MSSP braucht und Wazuh nicht liefert

Drei Anforderungen tauchen in jedem MSSP-Deployment-Gespräch auf:

1. **Isolation, die Sie in einem Security-Review des Kunden verteidigen können.** Ein Dashboard-Filter allein überzeugt niemanden; "Kunde A kann die Warnungen von Kunde B nicht lesen" muss auf der Datenschicht, der Netzwerkschicht und der Agent-Enrollment-Schicht gelten.
2. **Onboarding-Geschwindigkeit.** Wenn das Provisionieren eines neuen Kunden-SOC eine Woche Handarbeit bedeutet, skaliert das Muster nicht über eine Handvoll Kunden hinaus.
3. **Kostenkontrolle pro Mandant.** Sie müssen wissen, was ein Kunde an RAM, CPU und Festplatte kostet, das begrenzen können und verhindern, dass ein lauter Mandant die anderen aushungert.

## Die drei Muster, die MSSPs ausprobieren

### Muster 1: gemeinsamer Manager, Trennung auf Index-Ebene

Ein Wazuh-Manager, die Agents aller Kunden dagegen registriert, Trennung erst nachgelagert: OpenSearch-Dashboards-Multi-Tenancy für Dashboard-Objekte, Index-Patterns und Security-Rollen für die Eingrenzung des Lesezugriffs. Dieses Muster beschreiben die meisten Threads zu Wazuh-Multi-Tenancy, weil es das einzige ist, das sich bauen lässt, ohne die Wazuh-eigenen Werkzeuge zu verlassen.

Das Problem: Die Trennung greift erst beim Lesen und zieht keine Grenze um die Daten selbst. Der Manager bleibt gemeinsam: ein Regelwerk, ein `authd`-Secret, eine API, ein Upgrade-Fenster für alle. Eine falsch konfigurierte Rolle legt alle Kunden gleichzeitig offen, und kundenspezifische Regelpakete oder Aufbewahrungsrichtlinien sind unmöglich, ohne die übrigen zu beeinflussen.

### Muster 2: Manager pro Mandant auf VMs

Eine VM (oder ein VM-Satz) pro Kunde, mit dediziertem Manager und Indexer. Die Isolation ist real: getrennte Prozesse, Festplatten und Zugangsdaten. Hier landen MSSPs, nachdem das Muster mit gemeinsamem Manager ihnen Probleme bereitet hat. Der Preis ist operativ: Onboarding heißt Maschinen provisionieren, Upgrades heißen jede VM anfassen, und die Ressourcenuntergrenze pro Mandant ist eine volle VM ohne gemeinsames Scheduling, das ungenutzte Kapazität zurückholen könnte. Das funktioniert bei 5 Kunden und schmerzt bei 30.

### Muster 3: Manager pro Mandant auf Kubernetes, hinter einer Control Plane

Jeder Kunde erhält einen dedizierten Wazuh-Manager, -Indexer und ein Dashboard im eigenen Kubernetes-Namespace, mit einer ResourceQuota und LimitRange, die den Fußabdruck begrenzen. Eine Control Plane verantwortet den Lebenszyklus: Onboarding rendert ein Helm-Release pro Mandant, der Abbau entfernt es, und der Mandantenzustand liegt in einer Datenbank statt in einer Tabellenkalkulation. Die Isolation kommt aus der Namespace-Grenze plus NetworkPolicy; die Dichte aus dem Scheduler, der Mandanten auf gemeinsame Knoten packt.

### Die Muster im Vergleich

| | Gemeinsamer Manager + Index-Trennung | Manager pro Mandant auf VMs | Manager pro Mandant auf Kubernetes |
|---|---|---|---|
| Isolationsgrenze | Lesefilter auf gemeinsamen Daten | Maschinengrenze | Namespace + NetworkPolicy + Quota |
| Wirkungsradius einer Kompromittierung | Alle Kunden | Ein Kunde | Ein Kunde |
| Regeln / Aufbewahrung / Upgrades pro Mandant | Nein | Ja | Ja |
| Kunden-Onboarding | Schnell (Konfigurationsänderung) | Langsam (Maschinen provisionieren) | Schnell, wenn automatisiert (Helm-Release) |
| Dichte / Kosten pro Mandant | Am besten | Am schlechtesten | Gut (vom Scheduler gepackt, per Quota begrenzt) |
| Erforderliche Betriebskompetenz | Wazuh + OpenSearch Security | Flotten-/VM-Automatisierung | Kubernetes |
| Flottenbetrieb ab 30 Mandanten | Entfällt (ein Stack) | Schmerzhaft | Mit einer Control Plane beherrschbar |

Von den dreien ist Muster 3 das, das sowohl echte Isolation als auch Onboarding-Geschwindigkeit liefern kann, aber nur, wenn die Control Plane existiert. Namespaces allein sind kaum mehr als eine Namenskonvention; eine Sicherheitsgrenze muss darauf aufgebaut werden. Der Rest dieses Leitfadens behandelt, was diese Grenze real macht.

## Produktionsreife Isolation ist mehr als das SIEM

Ein Wazuh-Stack pro Mandant isoliert die SIEM-Daten. Eine MSSP-Plattform hat darüber hinaus mandantenübergreifenden Zustand, von Fällen und Prüfwarteschlangen bis zu Audit-Logs und Integrationskonfigurationen, und diese Schicht braucht ihre eigene Durchsetzung.

### Datenschicht: Postgres Row-Level Security, erzwungen und getestet

Mit Filterung per `WHERE tenant_id = ?` auf Anwendungsebene lässt eine einzige vergessene Klausel Daten zwischen Mandanten durchsickern. Die Datenbank sollte die Mandantentrennung selbst durchsetzen. Das Muster:

- Jede mandantenbezogene Tabelle trägt RLS-Policies, die an eine transaktionsweite Einstellung `app.current_tenant_id` gebunden sind. Ein nicht gesetzter Kontext liefert **null Zeilen**; der Fehlerfall ist ein leeres Ergebnis, niemals die Daten eines anderen Mandanten.
- `FORCE ROW LEVEL SECURITY` auf jeder mandantenbezogenen Tabelle, sodass selbst der Tabelleneigentümer (die Migrationsrolle) der Policy unterliegt. Standardmäßig nimmt Postgres Eigentümer aus; eine Migration, die Mandantendaten liest, könnte sonst still Mandantengrenzen überschreiten.
- Eine Aufteilung in drei Rollen: ein Migrationseigentümer, eine der RLS unterworfene Laufzeitrolle und eine abgetrennte `BYPASSRLS`-Rolle, die auditierten mandantenübergreifenden Pfaden vorbehalten ist. Keine Anwendung verbindet sich als Superuser.
- Isolationstests in der CI: Endpoint-Proben, rohes SQL unter der App-Rolle, Worker ohne Kontext, Proben mit der Eigentümerrolle, mandantenübergreifende Event-Streams. SocTalk führt sieben solcher Tests aus, alle müssen bestehen; keiner ist optional.
- Idempotenzschlüssel mit dem Scope `UNIQUE (tenant_id, idempotency_key)`, sodass die Alert-Pipelines zweier Kunden dieselbe externe Alert-ID ausgeben können, ohne zu kollidieren.

Vollständige Policy-Vorlagen, Rollen-DDL und die Testsuite: [Postgres RLS](/de-de/reference/postgres-rls).

### Netzwerkschicht: NetworkPolicy pro Namespace

Die Namespace-Grenze bedeutet nichts ohne ein durchsetzendes CNI; das Standard-Flannel von K3s setzt NetworkPolicy überhaupt nicht durch. Die Zielhaltung ist eine Default-Deny-Basis pro Mandanten-Namespace mit expliziten Freigaben: Verkehr innerhalb des Namespace, DNS, Zugriff der Control Plane auf die Data-Plane-Ports des Mandanten und Agent-Ingress auf 1514/1515. Verkehr zwischen Mandanten und allgemeiner Egress der Mandanten sind blockiert.

SocTalk nutzt Cilium als unterstütztes CNI (NetworkPolicy-Durchsetzung, FQDN-basierter Egress für per Hostname adressierte LLM-Endpoints, Hubble-Flow-Observability zum Untersuchen von Isolationsfragen). Beachten Sie den V1-Vorbehalt: Die vollständig FQDN-gepinnte Egress-Allowlist pro Mandant ist das Designziel, das aktuelle Chart rendert einfachere Policies, mit permissivem Egress der Control Plane und breitem TCP/443-Egress für den Worker pro Mandant. Die gerenderten Templates liegen im Repo; lesen Sie [NetworkPolicy-Design](/de-de/reference/network-policy) für die ausgelieferten Policies und die Zielarchitektur.

### Agent-Enrollment: Endpunkte und Secrets pro Mandant

Der subtilste Fehlerfall: Der Agent von Kunde A registriert sich beim Manager von Kunde B. Das Agent-Protokoll von Wazuh auf 1514/TCP ist ein proprietärer verschlüsselter Stream, kein Standard-TLS. Es gibt kein SNI zum Routen, daher brechen L4-Proxys, die Hostnamen inspizieren, still. Das Routing muss über die Zieladresse laufen: Jeder Mandant bekommt einen eigenen DNS-Namen (`acme.soc.mssp.example.com`), der auf einen L4-Endpoint pro Mandant auflöst, mit einem Port-pro-Mandant-Fallback, wenn IPs knapp sind.

Enrollment-Secrets sind mandantenbezogen: Das `authd`-Shared-Secret jedes Mandanten liegt in dessen Namespace, sodass ein Agent mit dem Secret von Mandant A sich nur beim Manager von A registrieren kann: Die Adressierung routet ihn dorthin, und der Manager prüft das Secret. In V1 sind LoadBalancer- und DNS-Provisionierung manuelle Verkabelung durch den MSSP, nicht automatisiert. Details und das Enrollment-Runbook: [Wazuh-Agent-Ingress](/de-de/reference/wazuh-ingress).

## Kapazität: was ein Mandant kostet

Die Zahlen, nach denen MSSPs zuerst fragen, aus der Dimensionierungsarbeit von SocTalk:

- **Fußabdruck pro Mandant (voller Stack):** ~8 GB RAM Request (~16 GB Limit), ~2,2 vCPU Request, ~120 GB Festplatte. Die dauerhafte Nutzung folgt den Requests; Limits sind Burst-Obergrenzen.
- **Der Engpass ist meist der Wazuh-Indexer pro Mandant.** Jeder ist ein Java-Prozess mit eigenem Heap. Planen Sie ~6–8 GB RAM und ~1,5 vCPU pro Produktionsmandant ein.
- **Die Festplatte wird von der Ingest-Rate getrieben:** grob 5 GB/Tag Index bei dauerhaft 10 Warnungen/Sekunde; das Standard-Indexer-PVC hat 50 GB mit 30 Tagen Hot Retention.
- **Getestete Skalierung:** bis zu ~50 Mandanten auf einem 3-Knoten-Cluster (16 vCPU / 64 GB pro Knoten). Größere Profile für eine Einzelinstallation sind dokumentiert, aber in diesem Release nicht validiert; planen Sie ohne eigene Tests nicht über diese Zahl auf einer Installation hinaus.

Referenz-Host-Profile und die Formel für maximale Mandanten pro Knoten: [Dimensionierung](/de-de/reference/sizing) und die [Skalierungs-FAQ](/de-de/faq#does-it-scale-to-n-customers).

## Wie SocTalk dieses Muster paketiert

SocTalk ist eine Open-Source-Implementierung (Apache 2.0, keine Aufteilung in Community/Enterprise) von Muster 3: eine Control Plane, ein `soctalk-tenant`-Helm-Release pro Kunde, auf Ihrem eigenen Kubernetes 1.30+, egal ob K3s, EKS, AKS oder GKE.

```mermaid
flowchart TB
    subgraph cp["soctalk-system namespace (control plane)"]
        api["API + orchestrator"]
        ctrl["Provisioning controller"]
        pg[("Postgres: RLS, FORCE, 3 roles")]
        api --> pg
        ctrl --> pg
    end
    subgraph ta["tenant-acme namespace"]
        ma["Wazuh manager"]
        ia["Wazuh indexer"]
        wa["runs-worker + adapter"]
    end
    subgraph tb["tenant-beta namespace"]
        mb["Wazuh manager"]
        ib["Wazuh indexer"]
        wb["runs-worker + adapter"]
    end
    ctrl -- "Helm: soctalk-tenant" --> ta
    ctrl -- "Helm: soctalk-tenant" --> tb
    agA["Customer A agents"] -- "acme.soc.mssp.example.com : 1514/1515" --> ma
    agB["Customer B agents"] -- "beta.soc.mssp.example.com : 1514/1515" --> mb
```

Das Onboarding durchläuft eine neunphasige Provisionierungssequenz (Preflight, Secret-Erzeugung, Namespace mit Quotas, Helm-Installationen, Readiness-Polling); jede Phase emittiert ein Lifecycle-Event und ist aus `degraded` idempotent wiederholbar. Der Mandantenzustand ist eine serverseitig durchgesetzte Zustandsmaschine (`pending → provisioning → active`, mit den Zuständen suspended, decommissioning, archived und purged; ungültige Übergänge liefern 409). Drei Onboarding-Profile decken Demos (`poc`), Produktion (`persistent`) und BYO-Wazuh ab (`provided`, wobei SocTalk sich mit dem bestehenden Stack eines Kunden verbindet, statt einen zu deployen). Der Decommission-Vorgang baut die Data Plane ab, behält aber die Mandantenzeile und die Audit-Historie.

Der vollständige Lebenszyklus, von Zuständen und Phasen bis zu Quotas und Wiederherstellungspfaden, steht in [Mandanten-Lebenszyklus](/de-de/tenant-lifecycle). Zum Ausprobieren: Der [Installationsleitfaden](/de-de/install) deckt einen Produktionscluster in etwa einer Stunde ab, und die [Demo-VM](/de-de/quickstart-vm) startet eine funktionierende Multi-Tenant-Installation mit einem Demo-Mandanten in etwa fünf Minuten.
