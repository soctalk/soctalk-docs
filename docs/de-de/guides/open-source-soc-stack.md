---
description: "Einen Open-Source-SOC-Stack mit Wazuh, TheHive, Cortex und MISP aufbauen: was jedes Tool leistet, was die Integration wirklich kostet und wann sich Paketierung lohnt."
---

# Einen Open-Source-SOC-Stack aufbauen: Wazuh, TheHive, Cortex und MISP — zusammengestellt vs. integriert

Es gibt einen kanonischen Free-and-Open-Source-SOC-Stack, und er besteht seit Jahren aus ungefähr denselben vier Namen: Wazuh für die Detektion, TheHive für das Case-Management, Cortex für die Observable-Analyse, MISP für Threat Intelligence. Jedes Projekt ist in seinem Job wirklich gut, jedes ist praxiserprobt, und zusammen decken sie das meiste ab, was eine kommerzielle SOC-Suite verkauft. Der Haken ist das Wort *zusammen*. Die Tools sind exzellent; die Integration zwischen ihnen ist ein Projekt, das Sie bauen und danach selbst betreiben.

Dieser Leitfaden behandelt, was jeder Baustein leistet, was das Zusammenstellen tatsächlich kostet, wie sich die Anforderungen ändern, wenn Sie die Sicherheit von mehr als einer Organisation betreiben, und wo SocTalk hineinpasst — nämlich *auf* diesem Stack, nicht an seiner Stelle.

## Der klassische FOSS-SOC-Stack

**[Wazuh](https://wazuh.com/)** ist die SIEM/XDR-Schicht: ein Agent auf jedem Endpunkt, ein Manager, der Detektionsregeln auf den Ereignisstrom anwendet, und ein Indexer (auf OpenSearch-Basis), der die Ergebnisse speichert und durchsuchbar macht. File-Integrity-Monitoring, Schwachstellenerkennung, Log-Analyse und ein großes Standard-Regelwerk sind ab Werk dabei. Hier werden Warnungen geboren.

**[TheHive](https://thehive-project.org/)** ist die Case-Management-Schicht: eine Security-Incident-Response-Plattform, in der aus Warnungen Cases werden, Cases Aufgaben und Observables tragen und Analystenteams mit einem Audit-Trail zusammenarbeiten. Wenn Wazuh der Ort ist, an dem Warnungen geboren werden, ist TheHive der Ort, an dem Untersuchungen leben und sterben.

**Cortex** ist TheHives Begleiter für die Observable-Analyse. Sie übergeben ihm eine IP, einen Hash, eine Domain oder eine URL, und seine Analyzer-Plugins fächern zu Reputations- und Sandbox-Diensten auf — VirusTotal, AbuseIPDB, Hybrid Analysis und Dutzende mehr — und bringen ein Verdikt zurück. Es verwandelt „hier ist ein Hash“ in „hier ist, was die Welt über diesen Hash weiß“.

**[MISP](https://www.misp-project.org/)** ist die Threat-Intelligence-Plattform: Sie aggregiert, korreliert und teilt Indicators of Compromise über Feeds und Sharing-Communities hinweg. Ein Observable gegen MISP zu prüfen sagt Ihnen, ob es zu einer bekannten Kampagne oder einem bekannten Akteur gehört — Kontext, den keines der anderen drei Tools von sich aus mitbringt.

Vier Tools, vier klar getrennte Jobs, alles Open Source. Auf dem Papier ein vollständiges SOC.

## Die Integrationssteuer, die niemand budgetiert

Jedes dieser Tools ist an einem Nachmittag installiert. Genau dort enden die Home-Lab-Tutorials, und dort beginnt die eigentliche Arbeit, denn keines dieser Tools spricht ab Werk in der Form mit den anderen, die ein produktives SOC braucht.

Der Klebstoff liegt bei Ihnen. Wazuh-Warnungen werden nicht ohne einen Forwarder zu TheHive-Cases, den Sie schreiben oder übernehmen und dann über API-Änderungen auf beiden Seiten hinweg pflegen. Cortex-Analyzer brauchen API-Schlüssel pro Anbieter, Rate-Limit-Behandlung und eine Entscheidung, welcher Analyzer für welchen Observable-Typ läuft. MISP braucht konfigurierte Feeds, eingeplante Sync-Jobs und die Kuratierung falsch-positiv-anfälliger Indikatoren, bevor Sie es wagen, darauf zu automatisieren.

Dann die operative Oberfläche: Vier Produkte bedeuten vier Authentifizierungssysteme und API-Schlüssel-Rotationspläne, vier Upgrade-Rhythmen, die Ihren Klebstoff bei jedem beliebigen Release brechen können, vier Backup-Konzepte und — seit TheHive unter der Haube auf Cassandra/Elasticsearch umgestellt hat — einen nicht trivialen Datastore-Fußabdruck allein für das Case-Management. Dazu kommen TLS zwischen jedem Paar, Monitoring für jeden Dienst und die Frage, wer alarmiert wird, wenn der Wazuh-zu-TheHive-Forwarder stillschweigend aufhört zu forwarden.

Nichts davon ist Kritik an den Tools. Es liegt in der Natur des Komponierens unabhängiger Projekte: Die Integrationsschicht ist ein fünftes Produkt — nur dass niemand es ausliefert, dokumentiert oder für Sie aktualisiert.

## Einzelne Organisation vs. MSSP: die Anforderungsgabelung

Für eine einzelne Organisation ist die obige Steuer bezahlbar. Sie bauen den Stack einmal, der Klebstoff dient einem Mandanten, und ein fähiger Engineer kann ihn nebenbei gesund halten.

Für einen MSP oder MSSP gabeln sich die Anforderungen hart:

- **Isolation ist nicht verhandelbar.** Die Warnungen, Cases und Indikatoren von Kunde A müssen für Kunde B nachweisbar unsichtbar sein — vertraglich und oft auch regulatorisch. Geteilte Single-Tenant-Tools machen daraus eine Konfigurationsübung pro Tool mit Fehlermodi pro Tool.
- **Stacks pro Kunde vervielfachen die Steuer.** Zehn Kunden auf dedizierten Stacks bedeuten zehn Wazuh-Manager und -Indexer, die deployt, aktualisiert und gesichert werden müssen — und zehn Kopien Ihres Klebstoffs.
- **Onboarding muss wiederholbar sein.** Kunde elf sollte ein Kommando sein, keine Woche Wiki-Archäologie. Handgebaute Stacks driften; Drift wird zum Incident.
- **One pane of glass.** Analysten, die zwanzig Kunden betreuen, können nicht durch zwanzig Dashboards rotieren.

Das ist die Lücke zwischen „der FOSS-SOC-Stack funktioniert“ und „der FOSS-SOC-Stack funktioniert als Geschäft“.

## Wo SocTalk hineinpasst: eine Control Plane auf dem Stack, kein Ersatz

[SocTalk](https://github.com/soctalk/soctalk) ersetzt keines der vier Tools. Es ist eine mandantenfähige Control Plane und AI-Triage-Schicht unter Apache-2.0-Lizenz, gebaut *um* diesen Stack herum, für MSPs und MSSPs, die ihn auf ihrem eigenen Kubernetes betreiben:

- **Wazuh ist die Data Plane.** Jeder Kunde erhält einen dedizierten Wazuh-Manager und -Indexer in einem isolierten Namespace, provisioniert durch die Control Plane — oder Sie bringen ein bestehendes Wazuh über das `provided`-Profil mit. Agents enrollen über hostnamenbasiert geroutetes Ingress mit mandantenbezogenen Secrets.
- **Die AI-Triage-Schicht sitzt zwischen Wazuh und Ihren Analysten.** Ein deterministischer Ingest-Trichter dedupliziert, verdichtet und korreliert Warnungen, bevor irgendein Modell läuft; eine agentische LangGraph-Schleife untersucht, was übrig bleibt; Eskalationen durchlaufen immer ein Gate zur menschlichen Prüfung. Details unter [So funktioniert es](/de-de/how-it-works).
- **TheHive, Cortex und MISP sind Integrationen**, die während des Laufs konsultiert werden: Cortex für Observable-Reputation, MISP für Threat-Intel-Kontext, TheHive als Exportziel für eskalierte Cases.
- **Die mandantenfähige Maschinerie ist das Produkt**: Namespace-Isolation mit Cilium NetworkPolicy, Postgres Row-Level Security als Daten-Backstop, eine Zustandsmaschine für den Mandanten-Lebenszyklus und LLM-Konfiguration pro Mandant.

**Seien Sie sich über die V1-Integrationsoberfläche im Klaren**, denn hier schlägt Ehrlichkeit Marketing:

- Der [TheHive-Export](/de-de/integrate/thehive) ist Opt-in und **synchron** — der Worker ruft TheHives API zur Graph-Node-Zeit auf und erstellt den Case und die Observables. Es gibt keine Outbox, keine Retry-Schleife und keinen mitgelieferten TheHive-Subchart; ist TheHive nicht erreichbar, wird der Fehler geloggt und der Case läuft nur in SocTalk weiter.
- [Cortex](/de-de/integrate/cortex) ist in V1 **ausschließlich kundenbetrieben** — Sie betreiben Cortex selbst, und SocTalk ruft es auf. Kein mitgelieferter Subchart; die Analyzer-Auswahl nutzt eine fest codierte Zuordnung, und fehlgeschlagene Aufrufe sind für den Lauf nicht fatal.
- **MISP**-Lookups laufen im `misp_worker` der Pipeline gegen Ihre MISP-Instanz; ein mitgelieferter MISP-Subchart ist auf ein zukünftiges Release verschoben.
- **Slack**-Benachrichtigung und Code für Zwei-Wege-Freigaben existieren im Repo, sind aber **nicht in die V1-Chart-Laufzeit verdrahtet** — die Review-Queue im Dashboard ist heute die funktionierende Human-in-the-Loop-Oberfläche.

Mit anderen Worten: SocTalk paketiert die mandantenfähige Wazuh-Plane und die Triage-Schicht und *verbindet sich mit* den TheHive-/Cortex-/MISP-Instanzen, die Sie betreiben. Der Komfort mitgelieferter Subcharts ist Roadmap, nicht Release.

## Den Stack selbst bauen oder SocTalk deployen?

Ehrliche Kriterien, da beide Wege Open Source sind:

**Bauen Sie den Vier-Tool-Stack selbst, wenn** Sie eine einzelne Organisation mit Engineering-Zeit sind, maximale Kontrolle über jede Komponente wollen, Ihr Warnungsvolumen für Ihre Analystenzahl beherrschbar ist und Mandantenfähigkeit irrelevant ist. Der klassische Stack plus Ihr eigener Klebstoff ist ein bewährtes Muster, und Sie werden jede Leitung verstehen, weil Sie sie selbst gelötet haben.

**Schauen Sie sich SocTalk an, wenn** Sie ein MSP/MSSP sind, der wiederholbare Wazuh-Stacks pro Kunde hinter einer Control Plane, nachweisbare Mandanten-Isolation und AI-Triage braucht, die das Warnungsvolumen komprimiert, bevor Analysten es sehen — und Sie lieber eine Helm-verwaltete Plattform betreiben als N handgebaute Stacks. Sie betreiben weiterhin Kubernetes, und in V1 betreiben Sie weiterhin Ihr eigenes TheHive, Cortex und MISP, wenn Sie sie nutzen wollen.

Der schnellste Weg zur Evaluierung ist die [Demo-VM](/de-de/quickstart-vm): ein Image, ein Browser-Assistent, etwa fünf Minuten bis zu einer laufenden mandantenfähigen Installation mit einem onboardeten Demo-Mandanten. Von dort erklärt [So funktioniert es](/de-de/how-it-works) die Pipeline, und die Seiten zu [TheHive](/de-de/integrate/thehive) und [Cortex](/de-de/integrate/cortex) dokumentieren genau, was die V1-Integrationen tun — und was nicht —, damit Sie den Rest Ihres Stacks darum herum planen können.
