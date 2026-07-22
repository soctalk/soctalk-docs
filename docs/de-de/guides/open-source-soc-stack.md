---
description: "Open-Source-SOC-Stack mit Wazuh, TheHive, Cortex und MISP aufbauen: was jedes Tool leistet, die echten Integrationskosten und wann sich Paketierung lohnt."
---

# Ein Open-Source-SOC-Stack mit Wazuh, TheHive, Cortex und MISP: zusammengestellt vs. integriert

Es gibt einen kanonischen Free-and-Open-Source-SOC-Stack, und er besteht seit Jahren aus ungefähr denselben vier Namen: Wazuh für die Detektion, TheHive für das Fallmanagement, Cortex für die Analyse von Observables, MISP für Threat Intelligence. Alle vier sind ausgereifte Projekte mit jahrelangem Produktionseinsatz, und zusammen decken sie das meiste ab, was eine kommerzielle SOC-Suite verkauft. Der Haken liegt im Wort *zusammen*. Die Integration zwischen den Tools ist ein Projekt, das Sie selbst bauen und danach selbst betreiben.

Dieser Leitfaden beschreibt, was jedes Teil leistet, was das Zusammenstellen tatsächlich kostet, wie sich die Anforderungen ändern, wenn Sie die Sicherheit von mehr als einer Organisation betreiben, und wo SocTalk hineinpasst, nämlich *oberhalb* dieses Stacks statt an seiner Stelle.

## Der klassische FOSS-SOC-Stack

**[Wazuh](https://wazuh.com/)** ist die SIEM/XDR-Schicht: ein Agent auf jedem Endpunkt, ein Manager, der Erkennungsregeln auf den Ereignisstrom anwendet, und ein Indexer (auf OpenSearch-Basis), der die Ergebnisse speichert und durchsuchbar macht. File-Integrity-Monitoring, Schwachstellenerkennung, Log-Analyse und ein großes Standard-Regelwerk sind ab Werk enthalten. Hier entstehen die Warnungen.

**[TheHive](https://thehive-project.org/)** ist die Fallmanagement-Schicht: eine Incident-Response-Plattform, in der Warnungen zu Fällen werden, Fälle Aufgaben und Observables tragen und Analystenteams mit einem Audit-Trail zusammenarbeiten. Wenn Wazuh der Ort ist, an dem Warnungen entstehen, ist TheHive der Ort, an dem Untersuchungen leben und enden.

**Cortex** ist der Begleiter von TheHive für die Analyse von Observables. Sie übergeben eine IP, einen Hash, eine Domain oder eine URL, und seine Analyzer-Plugins fächern die Anfrage auf Reputations- und Sandbox-Dienste auf, von VirusTotal und AbuseIPDB bis Hybrid Analysis und Dutzenden weiteren, und liefern ein Verdict zurück. Aus "hier ist ein Hash" wird "hier ist, was die Welt über diesen Hash weiß".

**[MISP](https://www.misp-project.org/)** ist die Threat-Intelligence-Plattform: sie aggregiert, korreliert und teilt Kompromittierungsindikatoren über Feeds und Sharing-Communities hinweg. Der Abgleich eines Observables gegen MISP zeigt, ob es zu einer bekannten Kampagne oder einem bekannten Akteur gehört, ein Kontext, den keines der anderen drei Tools von sich aus mitbringt.

Das sind vier Tools für vier klar getrennte Aufgaben, alle Open Source, und auf dem Papier ein vollständiges SOC.

## Die echten Integrationskosten

Jedes dieser Tools ist an einem Nachmittag installiert. Genau dort enden die Home-Lab-Tutorials, und dort beginnt die eigentliche Arbeit, denn keines der Tools spricht ab Werk in der Form mit den anderen, die ein Produktions-SOC braucht.

Der Kleber ist Ihre Aufgabe. Wazuh-Warnungen werden nicht von allein zu TheHive-Fällen; dafür schreiben oder übernehmen Sie einen Forwarder und pflegen ihn über API-Änderungen auf beiden Seiten hinweg. Cortex-Analyzer brauchen API-Schlüssel pro Anbieter, den Umgang mit Rate-Limits und eine Entscheidung, welcher Analyzer für welchen Observable-Typ läuft. MISP braucht konfigurierte Feeds, geplante Sync-Jobs und die Kuratierung von Indikatoren mit hoher Falsch-Positiv-Neigung, bevor Sie es wagen, darauf zu automatisieren.

Dann die Betriebsfläche: Vier Produkte bedeuten vier Authentifizierungssysteme und Rotationspläne für API-Schlüssel, vier Upgrade-Takte, die Ihren Kleber bei jedem Release brechen können, vier Backup-Konzepte und, seit TheHive intern auf Cassandra/Elasticsearch umgestellt hat, einen nicht trivialen Datastore-Fußabdruck allein für das Fallmanagement. Dazu kommen TLS zwischen jedem Paar, Monitoring für jeden Dienst und die Frage, wer alarmiert wird, wenn der Forwarder von Wazuh zu TheHive stillschweigend aufhört zu forwarden.

Die Tools selbst trifft dabei keine Schuld; das ist schlicht, was das Zusammensetzen unabhängiger Projekte mit sich bringt. Die Integrationsschicht läuft auf ein fünftes Produkt hinaus, nur dass niemand es für Sie ausliefert, dokumentiert oder aktualisiert.

## Einzelorganisation vs. MSSP: die Anforderungen gabeln sich

Für eine einzelne Organisation ist die oben beschriebene Abgabe bezahlbar. Sie bauen den Stack einmal, der Kleber bedient einen Mandanten, und ein fähiger Engineer kann ihn als Teilzeitaufgabe gesund halten.

Für einen MSP oder MSSP gabeln sich die Anforderungen deutlich:

- **Isolation ist nicht verhandelbar.** Die Warnungen, Fälle und Indikatoren von Kunde A müssen für Kunde B nachweislich unsichtbar sein, vertraglich und oft auch regulatorisch. Geteilte Single-Tenant-Tools machen daraus eine Konfigurationsübung pro Tool mit Fehlermodi pro Tool.
- **Stacks pro Kunde vervielfachen die Abgabe.** Zehn Kunden auf dedizierten Stacks bedeuten zehn Wazuh-Manager und -Indexer, die deployt, aktualisiert und gesichert werden wollen, plus zehn Kopien Ihres Klebers.
- **Onboarding muss wiederholbar sein.** Kunde elf sollte einen Befehl kosten und nicht eine Woche Wiki-Archäologie. Handgebaute Stacks driften auseinander, und Drift zeigt sich früher oder später als Vorfall.
- **Eine einzige Oberfläche.** Analysten, die zwanzig Kunden betreuen, können nicht durch zwanzig Dashboards rotieren.

Das ist die Lücke zwischen "der FOSS-SOC-Stack funktioniert" und "der FOSS-SOC-Stack funktioniert als Geschäft".

## Wo SocTalk hineinpasst: eine Control Plane oberhalb des Stacks

[SocTalk](https://github.com/soctalk/soctalk) lässt alle vier Tools an ihrem Platz. Es ist eine mandantenfähige Control Plane und AI-Triage-Schicht unter Apache-2.0-Lizenz, gebaut *um* diesen Stack herum, für MSPs und MSSPs, die ihn auf eigenem Kubernetes betreiben:

- **Wazuh ist die Data Plane.** Jeder Kunde erhält einen dedizierten Wazuh-Manager und -Indexer in einem isolierten Namespace, provisioniert durch die Control Plane, oder Sie bringen ein bestehendes Wazuh über das `provided`-Profil mit. Agents registrieren sich über hostnamen-geroutetes Ingress mit mandantenbezogenen Secrets.
- **Die AI-Triage-Schicht sitzt zwischen Wazuh und Ihren Analysten.** Ein deterministischer Ingest-Trichter dedupliziert, bündelt und korreliert Warnungen, bevor irgendein Modell läuft; eine agentische LangGraph-Schleife untersucht, was übrig bleibt; Eskalationen passieren immer ein Gate für menschliche Prüfung. Details unter [Funktionsweise](/de-de/how-it-works).
- **TheHive, Cortex und MISP sind Integrationen**, die während des Laufs konsultiert werden: Cortex für die Reputation von Observables, MISP für Threat-Intel-Kontext, TheHive als Exportziel für eskalierte Fälle.
- **Die mandantenfähige Maschinerie ist das Produkt**: Namespace-Isolation mit Cilium NetworkPolicy, Row-Level Security in Postgres als Daten-Absicherung, eine Zustandsmaschine für den Mandanten-Lebenszyklus und LLM-Konfiguration pro Mandant.

**Kennen Sie die V1-Integrationsfläche, bevor Sie darauf planen:**

- Der [TheHive-Export](/de-de/integrate/thehive) ist Opt-in und **synchron**: Der Worker ruft die API von TheHive zur Laufzeit des Graph-Knotens auf und legt Fall und Observables an. Es gibt keine Outbox, keine Retry-Schleife und kein gebündeltes TheHive-Subchart; ist TheHive nicht erreichbar, wird der Fehler protokolliert und der Fall läuft nur in SocTalk weiter.
- [Cortex](/de-de/integrate/cortex) ist in V1 **ausschließlich kundenbetrieben**. Sie betreiben Cortex selbst, und SocTalk ruft es auf. Kein gebündeltes Subchart; die Analyzer-Auswahl nutzt eine fest codierte Zuordnung, und fehlgeschlagene Aufrufe sind für den Lauf nicht fatal.
- **MISP**-Abfragen laufen im `misp_worker` der Pipeline gegen Ihre MISP-Instanz; ein gebündeltes MISP-Subchart ist auf ein künftiges Release verschoben.
- Code für **Slack**-Benachrichtigungen und Zwei-Wege-Freigaben existiert im Repository, ist aber **nicht in die V1-Chart-Laufzeit verdrahtet**. Die Prüf-Warteschlange im Dashboard ist heute die funktionierende Human-in-the-Loop-Oberfläche.

SocTalk paketiert die mandantenfähige Wazuh-Ebene und die Triage-Schicht und *verbindet sich mit* den TheHive-, Cortex- und MISP-Instanzen, die Sie betreiben. Der Komfort gebündelter Subcharts bleibt auf der Roadmap; dieses Release enthält ihn nicht.

## Wann Sie den Stack selbst bauen und wann Sie SocTalk deployen

Beide Wege sind Open Source, die Wahl hängt also an operativen Kriterien:

**Bauen Sie den Vier-Tool-Stack selbst, wenn** Sie eine einzelne Organisation mit Engineering-Zeit sind, maximale Kontrolle über jede Komponente wollen, Ihr Warnungsvolumen für Ihre Analystenzahl handhabbar ist und Mandantenfähigkeit keine Rolle spielt. Der klassische Stack plus eigener Kleber ist ein bewährtes Muster, und Sie werden jeden Draht verstehen, weil Sie ihn selbst verlötet haben.

**Sehen Sie sich SocTalk an, wenn** Sie ein MSP/MSSP sind, der wiederholbare Wazuh-Stacks pro Kunde hinter einer Control Plane braucht, nachweisbare Mandanten-Isolation und eine AI-Triage, die das Warnungsvolumen komprimiert, bevor Analysten es sehen, und wenn Sie lieber eine Helm-verwaltete Plattform betreiben als N handgebaute Stacks. Sie betreiben weiterhin Kubernetes, und in V1 betreiben Sie weiterhin Ihr eigenes TheHive, Cortex und MISP, wenn Sie sie nutzen wollen.

Der schnellste Weg zur Bewertung ist die [Demo-VM](/de-de/quickstart-vm): ein Image, ein Browser-Assistent, rund fünf Minuten bis zu einer laufenden mandantenfähigen Installation mit einem eingerichteten Demo-Mandanten. Von dort erklärt [Funktionsweise](/de-de/how-it-works) die Pipeline, und die Seiten zu [TheHive](/de-de/integrate/thehive) und [Cortex](/de-de/integrate/cortex) dokumentieren genau, was die V1-Integrationen tun und was nicht, damit Sie den Rest Ihres Stacks darum herum planen können.
