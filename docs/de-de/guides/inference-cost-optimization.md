---
title: Die Rechnung für das KI-Triage so niedrig wie möglich halten
description: "Sobald das KI-Triage funktioniert, ist die nächste Frage die Rechnung. Batching und Caching, Modell-Staffelung, günstigere gehostete Modelle und Self-Hosting auf gemieteten oder lokalen GPUs, mit gemessenen Kosten und Latenzen, um die Modellrechnung so weit wie möglich zu drücken."
---

# Die Rechnung für das KI-Triage so niedrig wie möglich halten

Sobald das KI-Triage funktioniert, ist die nächste Frage die Rechnung. Jede Warnung, die ein Modell erreicht, kostet Geld, und bei realem Warnungsvolumen steigt diese Zahl schnell. Der größte Teil dieser Rechnung ist optional.

SocTalk hält die meisten Warnungen von vornherein von einem Modell fern, durch Deduplizierung, Coalescing, Korrelation und deterministisches Schließen (siehe [Wie es funktioniert](/de-de/how-it-works)), sodass sich die verbleibenden Ausgaben auf die Warnungen konzentrieren, die tatsächlich ein Urteil brauchen. In diesem Leitfaden geht es darum, diese verbleibenden Ausgaben so weit wie möglich zu senken, ohne mehr Qualität aufzugeben, als Sie gemessen haben, und ohne sensible Warnungsinhalte aus Ihrem Perimeter herauszubewegen.

Die Optionen unten sind von der günstigsten und sichersten zur teuersten geordnet. Die meisten Deployments erreichen die letzte nie.

## Zuerst Batching und Caching

Zwei verwaltete Funktionen der Frontier-APIs senken die Kosten, ohne die Modellqualität zu ändern.

**Die Batch API** verarbeitet Anfragen asynchron gegen einen festen Rabatt, und die Ausgabe ist identisch. SocTalk passt hier mühelos hinein. Das Settle-Fenster hält einen Run ohnehin zurück, damit korrelierte Warnungen sich sammeln, und ein Run ist von Haus aus asynchron, also ist Triage kein latenzsensibler Pfad.

**Prompt-Caching** berechnet den wiederholten Teil eines Prompts zu einem Bruchteil des Eingaberatensatzes. Die Supervisor- und Verdict-Prompts von SocTalk tragen ein großes stabiles Präfix, den Systemprompt und die Tool-Definitionen, mit dem volatilen fallbezogenen Inhalt am Ende, also ist der cachebare Anteil real und wird auf dem Anthropic-Pfad bereits genutzt.

Schalten Sie beide ein und messen Sie die neuen Kosten pro Run, bevor Sie irgendetwas darunter erwägen. Keine der beiden berührt die Qualität, es gibt also keinen Grund, sie zu überspringen.

## Setzen Sie ein günstigeres Modell auf die günstigere Arbeit

Ein Triage-Run nutzt ein Modell in zwei Rollen: einen Supervisor, der die Untersuchung routet und entscheidet, was als Nächstes anzureichern ist und wann zu entscheiden ist, und ein Verdict, das die Beweislage abwägt. Das Routing ist die leichtere Aufgabe. SocTalk löst jede Rolle zu ihrem eigenen Tier auf, und jedes Tier zeigt auf seinen eigenen Provider, sein eigenes Modell und seinen eigenen Endpoint, also kann der Router auf einem kleineren Modell laufen, während das Verdict das leistungsfähige behält. Das ist Konfiguration, keine neue Infrastruktur.

## Günstigere gehostete Modelle, mit einem Vorbehalt

Mehrere Provider servieren nahezu-Frontier offene Modelle, die die Frontier-APIs unterbieten können, je nach Provider, Modell und Last. Sie passen zu den routinemäßigen, risikoärmeren Fällen, in denen ein nahezu-Frontier offenes Modell genügt. Für Sicherheitsarbeit ist die Einschränkung die Datengovernance, nicht der Preis: Kundenwarnungen an eine Dritt-API zu senden, besonders in einer anderen Jurisdiktion, bewegt diese Daten aus Ihrer Kontrolle. Wenn das für Ihre Tenants ein klares Nein ist, hält der nächste Abschnitt die Daten innerhalb Ihrer Grenze.

## Das Modell selbst hosten

Self-Hosting ist die größte Einsparung und die einzige Option, die Warnungsinhalte in Ihrem Perimeter hält. SocTalk konsumiert ein selbst gehostetes Modell genauso wie eine Frontier-API, indem es ein Tier auf einen OpenAI-kompatiblen Endpoint zeigen lässt. Es klassifiziert das Backend nach seinem Liefermodell, eine warme verwaltete API, eine serverless GPU, die auf null herunterskaliert, eine dauerhaft laufende gemietete GPU oder eine lokale Instanz, damit Kosten und Scheduling für jedes korrekt arbeiten.

Wo Sie es laufen lassen, ist ein echter Kompromiss.

- **Eine verwaltete serverless GPU-Plattform** (zum Beispiel Modal) deployt das Modell hinter einem OpenAI-kompatiblen Endpoint, skaliert im Leerlauf auf null herunter und rechnet pro GPU-Sekunde ab. Sie zahlen nur, während es läuft, und es gibt keinen Server zu betreiben, zu einem höheren Stundensatz als eine reine Miete.
- **Ein GPU-Mietmarktplatz** (zum Beispiel RunPod) mietet Consumer-GPUs nahe dem, was ein kleines selbst gehostetes Deployment kaufen würde, zu einem niedrigeren Stundensatz. Im Gegenzug betreiben Sie den Lebenszyklus. Ein Pod rechnet ab, bis Sie ihn stoppen, Kaltstarts dauern Minuten, und die Verfügbarkeit auf den günstigsten Stufen schwankt.
- **Eine lokale Instanz** (zum Beispiel [Ollama](/de-de/integrate/ollama)) läuft auf Hardware, die Sie bereits besitzen, ohne gemessene Gebühr pro Anfrage und ohne dass etwas die Maschine verlässt, begrenzt durch den Durchsatz dieser einen Maschine.

## Die Auslastung, nicht die Karte, treibt die Einsparung

Ein selbst gehosteter Server ist nur günstig, wenn sein kontinuierlicher Batch voll ist. Eine Anfrage zur Zeit lässt die GPU unterausgelastet und macht Self-Hosting teurer, als es sein sollte. SocTalk lässt mehrere Untersuchungen pro Worker nebenläufig laufen, sodass mehrere Anfragen gleichzeitig zum Backend unterwegs sind und der Batch sich füllt.

In unseren Benchmarks hob das Füllen des Batches auf acht nebenläufige Anfragen den aggregierten Durchsatz gegenüber eins-nach-dem-anderen um etwa das Sechs- bis Achtfache und senkte die Kosten pro Anfrage auf etwa 13 bis 17 Prozent des seriellen Falls, über die getesteten Läufe mit L40S, A10G, L4, RTX 3090 und RTX 4090. Die Auslastung leistete den größten Teil der Arbeit. Es war die Nebenläufigkeit, nicht die Karte, die Self-Hosting in diesen Läufen von ineffizient zu günstiger als die serielle Basislinie machte.

## Was es kostet, gemessen

Diese Zahlen stammen aus unseren eigenen Benchmark-Läufen eines offenen 7B-Modells über einen festen Satz von Triage-Fällen bei achtfacher Nebenläufigkeit. Sie sind Richtwerte, keine Garantie. Ihr Modell, Ihre Hardware und Ihr Warnungsmix werden sie verschieben.

Pro vollständigem Triage kam Self-Hosting auf einer gemieteten Consumer-GPU etwa zwei bis drei Größenordnungen günstiger heraus als ein unoptimierter Frontier-API-Aufruf und mehrfach günstiger als dasselbe Modell auf einer verwalteten serverless Plattform, weil die getestete Mietkarte sowohl pro Stunde günstiger als auch, in diesen Läufen, schneller war. Der höhere Satz der verwalteten Plattform kauft das Herunterskalieren auf null und keinen Betrieb. Der höhere Preis der Frontier-API kauft ein verwaltetes Modell-Tier, das für die schwereren Fälle passen kann, ohne Infrastruktur zu betreiben.

Die Latenz blieb praxistauglich. Der Satz von 12 Fällen war auf einer Modal A10G in etwa einer Minute und auf einer RunPod 4090 in 11 bis 14 Sekunden fertig, beide bei achtfacher Nebenläufigkeit, statt der mehreren Minuten, die eine Einzelstrom-Schätzung nahelegt, weil die Nebenläufigkeit die Aufrufe überlappt und echte Verdicts in das Token-Budget passen.

## Ob ein kleines Modell gut genug ist

Kosten zählen nur, wenn das günstige Modell standhält. In unseren Läufen hielt ein offenes 7B-Modell den strukturierten Triage-Vertrag von SocTalk: gültige Router- und Verdict-Ausgabe, keine Schema-Fehler, und Verdicts, die mit einem größeren Reasoning-Modell auf etwa 58 bis 75 Prozent einer kleinen Benchmark-Stichprobe übereinstimmten. Es war schwächer beim Routing, und bei den autorisierungssensiblen Fällen schloss es manchmal Aktivität, für die keine Autorisierung dokumentiert war und die hätte eskaliert werden müssen.

Ein kleines selbst gehostetes Modell ist daher ein brauchbares günstiges Tier für die routinemäßige Mitte, mit einem leistungsfähigen Modell dahinter für die schweren Fälle. Ob es für Ihre Umgebung gut genug ist, ist eine Messung, keine Annahme, und sie gehört gegen einen repräsentativen Benchmark, bevor einem kleinen Modell irgendeine Schließungsentscheidung anvertraut wird. Der Safety Floor gilt ohnehin. Kein Modell darf über ein bekanntes bösartiges Signal oder einen aktiven verwandten Fall schließen, egal wie es serviert wurde.

## Einzuplanende Grenzen

- **Kaltstarts.** Ein auf null herunterskaliertes oder frisch gemietetes Backend ist nicht sofort bereit. Modell-Download und -Laden dauern Minuten, also wartet ein Schub, der kalt ankommt. Gut für routinemäßiges Triage, ein Problem für alles Dringende, weshalb sich ein warmes Fallback-Tier verdient macht.
- **Betriebslast bei Mieten.** Eine gemietete GPU rechnet ab, bis Sie sie stoppen, und hat kein Herunterskalieren auf null, also ist Leerlaufzeit verschwendetes Geld und das Abbauen ist Ihre Sache, daran zu denken. Die Verfügbarkeit auf den günstigsten Stufen schwankt.
- **Kostenrechnung.** Ein Budget pro Token ist die richtige Einheit für eine Frontier-API und die falsche für ein Backend pro GPU-Sekunde. Rechnen Sie beim Self-Hosting nach der eigenen Abrechnungseinheit des Backends.
- **Datengovernance ist ein Spektrum.** Die Redaktion entfernt Geheimnisse, bevor etwas geht, aber der operative Kontext, Hosts, Konten, Log-Inhalte, reist trotzdem zu einer externen API. Nur Self-Hosting innerhalb der Grenze hält diesen Kontext in Ihrem Perimeter.

## Wählen, wo das Modell läuft

Drei Fragen entscheiden es. **Auslastung.** Eine stetige, hoch ausgelastete Last begünstigt eine gemietete Karte; eine sporadische, stoßweise Last begünstigt eine auf null herunterskalierende Plattform oder eine verwaltete API, deren Leerlaufkosten null sind. **Betriebsbereitschaft.** Eine Miete ist am günstigsten, aber Sie betreiben sie; eine serverless Plattform kostet mehr und betreibt sich selbst; eine API kostet am meisten, mit nichts zu betreiben. **Datensensibilität.** Wenn Warnungsinhalte Ihre Grenze nicht verlassen dürfen, ist Self-Hosting die einzige Antwort, und die Arbeit oben ist, wie Sie es erschwinglich machen.

Für die meisten Teams ist die Reihenfolge dieselbe wie in diesem Leitfaden. Batching und Caching zuerst, der Router auf einem günstigeren Modell als Nächstes, und ein selbst gehostetes Tier erst, wenn das Volumen und der Bedarf an Datenresidenz den Betrieb rechtfertigen.

**Haftungsausschluss.** SocTalk ist mit keinem LLM- oder GPU-Dienstanbieter verbunden, wird von keinem unterstützt oder gesponsert. Modal, RunPod, Anthropic, OpenAI, Ollama und alle anderen in diesem Leitfaden genannten Dienste werden nur als Beispiele dafür genannt, wo ein Modell laufen kann. Die Kosten- und Leistungszahlen sind unsere eigenen Benchmark-Beobachtungen, keine vom Anbieter veröffentlichten Zahlen, und alle Produktnamen und Marken gehören ihren jeweiligen Eigentümern.
