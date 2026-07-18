# FAQ

Fragen vor Installation oder Kauf, die sich nicht sauber in die Installations- oder Referenzabschnitte einordnen lassen.

## Was ist SocTalk?

Eine mandantenfähige SOC-Plattform für MSPs und MSSPs. Eine Control Plane orchestriert kundenspezifische Wazuh-Stacks; eine AI-Pipeline triagiert Warnungen und schlägt Aktionen vor; menschliche Analysten genehmigen Eskalationen. Vollständig Open Source.

## Was ist Open Source und was kommerziell?

**Alles im Repository [`soctalk/soctalk`](https://github.com/soctalk/soctalk) steht unter Apache 2.0** — die Control Plane, die AI-Pipeline, die Wazuh-Integration, die Charts und die Demo-VM. Es gibt keine Aufteilung in "Community vs. Enterprise"-Funktionen.

Für MSPs, die die Plattform nicht selbst betreiben möchten, existiert ein Managed-Hosting-Dienst (SocTalk Cloud). Der gehostete Dienst verwendet denselben Code wie die offene Distribution.

## Kann ich es ohne Kubernetes-Cluster evaluieren?

Ja — das [Demo-VM-Image](/de-de/quickstart-vm) ist eine Single-Box-Installation. Starte es auf KVM, VMware, Hyper-V, Azure oder konvertiere es aus dem Raw-Format. Fünf Minuten bis zu einer laufenden mandantenfähigen Installation mit einem onboardeten `demo`-Mandanten.

## Kann ich es dauerhaft auf einem einzelnen Knoten betreiben?

Ja, für sehr kleine Deployments (1–2 Kunden, geringes Warnungsvolumen). Die Demo-VM verwendet das `poc`-Profil, das von ephemerem Speicher ausgeht und nicht für dauerhafte Last dimensioniert ist. Für den echten Kundeneinsatz:

- Erhöhe die VM-Ressourcen (16 GB RAM + 200 GB SSD für ~3 kleine Mandanten).
- Verwende beim Onboarding von Mandanten das `persistent`-Profil.
- Richte Backups ein (siehe [Backup und Wiederherstellung](/de-de/backup-restore)).

Für mehr als ~3 Mandanten solltest du einen Multi-Node-Cluster einplanen.

## Funktioniert es air-gapped?

Ja, mit ein paar zusätzlichen Schritten:

- **Container-Images**: Spiegle `ghcr.io/soctalk/*` in deine interne Registry. Das Chart akzeptiert `image.registry: your.registry.example/soctalk`.
- **Helm-Chart**: Führe `helm pull oci://ghcr.io/soctalk/charts/soctalk-system` einmal aus, hoste es in einer internen OCI-Registry und richte die Installationen darauf aus.
- **LLM**: Verwende einen lokalen OpenAI-kompatiblen Endpunkt (vLLM, Ollama-Proxy, On-Prem-Bedrock-Proxy). Siehe [LLM-Anbieter](/de-de/integrate/llm-providers).
- **Cortex-Analyzer**: Jeder Analyzer, der Internet benötigt, funktioniert nicht. Verwende nur On-Prem-Analyzer (MaxMind GeoIP, internes MISP) oder deaktiviere Cortex.
- **GitHub Releases**: Lade das [VM-Image](/de-de/downloads) auf einem verbundenen Host herunter und übertrage es per Sneakernet.

Der [`scripts/dev-up.sh`](https://github.com/soctalk/soctalk/blob/main/scripts/dev-up.sh)-Ablauf läuft ohne Internet, sobald die Images gespiegelt sind.

## Wie hoch sind die LLM-Kosten pro Mandant?

Stark variabel, abhängig von:

- Warnungsvolumen (eine Untersuchung pro Warnung, die die Korrelation übersteht)
- Token-Budget pro Lauf (`case_runs.tokens_budget`, Modell-Standard 200.000)
- Modellauswahl (`fast_model` + `reasoning_model`)
- Wie oft das Verdikt `needs_more_info` lautet (löst einen erneuten Lauf aus)

Größenordnung mit dem Standardbudget von 200.000 Token pro Lauf und typischer Nutzung: 30 Warnungen/Tag × ~60k Token/Untersuchung × 5 $/Mtok Eingabe ≈ 9 $/Tag pro Mandant bei einem günstigen OpenAI-kompatiblen Setup. Sinkt um das 5- bis 10-Fache mit einem günstigeren Fast-Modell. Siehe [Observability — Kosten pro Mandant](/de-de/observability#per-tenant-cost) zur Messung.

## Können verschiedene Kunden verschiedene LLM-Modelle verwenden?

Ja — Override pro Mandant zum Onboarding-Zeitpunkt. Das installationsweite Modell ist der Standard; Mandanten können abweichen, indem sie ihr eigenes angeben. Siehe [LLM-Anbieter — Overrides pro Mandant](/de-de/integrate/llm-providers#per-tenant-overrides).

## Kann ein Kunde seinen eigenen LLM-Schlüssel mitbringen?

Ja — der Override pro Mandant gilt auch für den API-Schlüssel. Der maßgebliche Speicher ist `IntegrationConfig.llm_api_key_plain` in Postgres; der Controller materialisiert ihn in ein `Secret/tenant-llm-key` im Namespace **des Mandanten** (nicht `soctalk-system`), das der Runs-Worker einbindet. Nützlich zur Abrechnungsisolation.

## Sendet SocTalk Kundendaten an Anthropic / OpenAI?

Nur das, worüber die AI-Pipeline nachdenkt: den Warnungstext, die extrahierten Observables und die Worker-Ausgaben. Die Laufzeitumgebung exfiltriert keine ruhenden Daten — nur das, was im aktuellen Untersuchungszustand enthalten ist. Wenn du eine strengere Haltung benötigst, verwende einen On-Prem-LLM-Endpunkt (vLLM, Ollama). Siehe [LLM-Anbieter — Wechsel zu Anthropic / Laufzeit-Schalter](/de-de/integrate/llm-providers#runtime-only-knobs-env-not-chart).

## Ersetzt es meine Analysten?

Nein. SocTalk ist als **Copilot** positioniert, nicht als Ersatz. Der Verdikt-Knoten entscheidet `escalate | close | needs_more_info`; eine Eskalation durchläuft immer ein Gate für die [menschliche Prüfung](/de-de/human-review). Ohne den Menschen bräuchte ein MSSP mit hohem Volumen weiterhin Analysten, um die Entscheidungen zu bearbeiten, die SocTalk an sie weiterleitet.

Der Nutzen liegt in der Kompression — dasselbe Analystenteam kann das 5- bis 10-Fache des Warnungsvolumens bewältigen, weil Routinefälle automatisch geschlossen werden und nur die unklaren Fälle die menschliche Prüfung erreichen.

## Funktioniert es ohne Wazuh?

Die aktuelle Data Plane ist ausschließlich Wazuh-basiert. Die MCP-Tool-Oberfläche (`wazuh.*`, `cortex.*`, `thehive.*`, `misp.*`) ist steckbar, sodass andere SIEMs machbare Ergänzungen sind. Heute wird keines davon ausgeliefert.

## Wie sieht die Härtung für den Produktivbetrieb aus?

- Postgres Row-Level Security mit `FORCE ROW LEVEL SECURITY` als Absicherung der mandantenübergreifenden Datenisolation.
- Cilium NetworkPolicy, die jeden `tenant-<slug>`-Namespace isoliert.
- TLS durchgängig (cert-manager-verwaltet für die Produktion; selbstsigniert für den Wizard).
- Der gesamte Control-Plane-Zustand liegt in Postgres mit Append-only-Semantik des Audit-Logs.
- Der Bootstrap-Admin wird nur erstellt, wenn er explizit in den Values konfiguriert ist (oder über ein vorbereitetes Secret); rotiere ihn nach der ersten Anmeldung mit `soctalk-auth set-password`.

Siehe [Sicherheitsmodell](/de-de/reference/security-model) für die vollständige Haltung.

## Kann ich es auf EKS / AKS / GKE betreiben?

Ja — das Chart zielt auf Standard-Kubernetes 1.30+. Binde die StorageClass, den Ingress-Controller und den cert-manager-DNS-01-Solver deiner Cloud ein. Der [Installationsleitfaden](/de-de/install) ist K3s-fokussiert, weil das die Standarddistribution ist; das Chart selbst ist davon unabhängig.

## Skaliert es auf N Kunden?

Getestet bis zu ~50 Mandanten auf einem 3-Node-Cluster (16 vCPU / 64 GB / Node). Der Engpass ist üblicherweise der Wazuh-Indexer pro Mandant (jeder Indexer ist ein Java-Prozess mit eigenem Heap) und nicht die SocTalk-Control-Plane. Plane ~6–8 GB RAM und ~1,5 vCPU pro Mandant im `persistent`-Profil ein — siehe [Sizing](/de-de/reference/sizing).

## Was ist mit Compliance (SOC 2, HIPAA, PCI)?

Die Haltung der Plattform unterstützt Audits im Stil von SOC 2 — Append-only-Audit-Log, RBAC, Verschlüsselung im Ruhezustand (Postgres + Wazuh-Indexer), Verschlüsselung während der Übertragung. Sie wird **nicht** mit einer SOC-2-Attestierung ausgeliefert; das ist die Verantwortung des MSSP für sein eigenes Hosting.

Für HIPAA / PCI hält die Data Plane (Wazuh) oft Daten im Geltungsbereich vor. Behandle dieses PVC als im Geltungsbereich und sichere es entsprechend (siehe [Backup und Wiederherstellung](/de-de/backup-restore)).

## Was steht auf der Roadmap?

GitHub Issues und das Projects-Board von [`soctalk/soctalk`](https://github.com/soctalk/soctalk) sind die maßgebliche Quelle. In den Docs erwähnte Punkte mit hoher Wirkung für zukünftige Releases:

- Proxy-Auth-Modus als Chart-Values-Schalter verfügbar gemacht (heute: Override per Umgebungsvariable).
- Fleet-Upgrade-API (heute: manuelle `helm upgrade`-Schleife).
- Lizenz-Issuer (offline signierte Installations-Credentials).
- Onboarding-Helfer für kundenverwaltetes VPN (heute: nur dokumentiertes Muster).
- Agents-Tab pro Mandant in der Mandantendetailansicht.

## Wie kann ich beitragen?

Siehe die Seite [Beitragen](/de-de/contribute).

## Wo bekomme ich Hilfe?

- Issues: https://github.com/soctalk/soctalk/issues
- Discussions: https://github.com/soctalk/soctalk/discussions
- Security: siehe SECURITY.md im Repository
