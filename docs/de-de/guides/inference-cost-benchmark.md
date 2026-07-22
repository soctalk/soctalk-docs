---
title: Was Triage-Inferenz tatsächlich kostet, gemessen
description: "Die gemessenen Läufe hinter dem Kostenleitfaden: continuous Batching auf serverless GPUs, echtes Consumer-RTX-Silizium auf einem Mietmarktplatz und realistische golden-alert Triage-Zeit mit einem kleinen selbst hostbaren Modell. Durchsatz, Dollar pro Tausend und Triage-Sekunden, mit der Methode und den genannten Grenzen."
---

# Was Triage-Inferenz tatsächlich kostet, gemessen

Der [Kostenleitfaden](/de-de/guides/inference-cost-optimization) macht Aussagen darüber, was Triage-Inferenz kostet. Diese Seite ist die Messung dahinter: unsere eigenen Benchmark-Läufe, die Tabellen in voller Länge, und die Methode und Grenzen, damit Sie beurteilen können, wie weit sie auf Ihr eigenes Setup tragen. Jedes Ergebnis hier ist ein einzelner gemessener Lauf, kein statistisches Ergebnis und keine Herstellerangabe. Die Durchsatz-Sweeps nutzen synthetische triage-förmige Anfragen, die Preise sind Momentaufnahmen, die zum Zeitpunkt des Laufs abgelesen wurden, und die Triage-Zeit- und Genauigkeitszahlen nutzen einen festen 12-Warnungen-golden-Satz. Ihr Modell, Ihre Hardware und Ihr Warnungsmix werden alles davon verschieben.

Drei Dinge wurden gemessen, vom synthetischen Durchsatz bis zur realistischen Triage: wie viel ein voller continuous Batch auf einer serverless GPU spart, wie sich echtes Consumer-Silizium mit den Datacenter-Teilen vergleicht, die als Stellvertreter dafür einstehen, und wie lange eine echte Triage tatsächlich auf einem kleinen selbst hostbaren Modell dauert. Jeder Lauf baute seine GPU danach ab, sodass nichts weiter abrechnete.

## Continuous Batching füllt die GPU

Ein offenes Modell wurde pro GPU deployt und eine steigende Zahl identischer triage-förmiger Anfragen an den SGLang OpenAI-compatible Endpoint gefeuert. Das misst die Backend-Seite dessen, was Worker-Nebenläufigkeit freischaltet: wenn die Client-Nebenläufigkeit N steigt, füllt sich der continuous Batch, der aggregierte Durchsatz klettert, und die Kosten pro Anfrage fallen.

Die serverless Plattform hat keine Consumer-RTX-Karten, also stehen Low-End-Datacenter-GPUs als Stellvertreter ein: A10G (Ampere 24GB) für RTX 3090, L4 (Ada 24GB) für eine Karte der RTX-4090-Klasse. Qwen3-14B braucht etwa 28GB bei bf16 und passt nicht mit Batch-Spielraum auf eine 24GB-Karte, also lassen die 24GB-Karten DeepSeek-R1-Distill-Qwen-7B laufen, das KV-cache-Raum für einen größeren Batch lässt.

| GPU (Stellvertreter) | Modell | N=1 tok/s | N=8 tok/s | N=8 speedup | $/1k req, N=1 bis N=8 |
|---|---|---|---|---|---|
| L40S (mid, 48GB) | Qwen3-14B | 24.8 | 146.7 | 5.9x | 4.37 bis 0.74 (minus 83%) |
| A10G (ca. RTX 3090) | DS-R1-7B | 29.2 | 216.7 | 7.4x | 2.09 bis 0.28 (minus 87%) |
| L4 (ca. RTX 4090) | DS-R1-7B | 17.3 | 131.2 | 7.6x | 2.57 bis 0.34 (minus 87%) |

Seriell (N=1) lässt die GPU auf jeder Karte unterausgelastet. Das Füllen des Batches bei N=8 maß den 5,9- bis 7,6-fachen aggregierten Durchsatz und Kosten pro Anfrage bei 13 bis 17 Prozent des seriellen Falls. Die 24GB-Karten zeigten einen höheren speedup (7,4 bis 7,6x) als die mid-Karte, die das 14B laufen ließ (5,9x), weil das kleinere Modell mehr KV-cache-Raum für einen größeren Batch lässt. Der niedrigere absolute tok/s-Wert der L4 gegenüber der A10G ist zu erwarten, da die L4 ein Inferenz-Teil mit niedriger TDP ist, also liest es sich als konservativer Boden für eine echte RTX 4090. Die Skalierungsfaktoren waren über die Karten hinweg ähnlich, was der Punkt ist: die Auslastung, nicht die Karte, treibt die Einsparung.

## Echtes Consumer-Silizium, auf einem Mietmarktplatz

Ein GPU-Mietmarktplatz vermietet die buchstäblichen Consumer-Karten, also prüft das die echte Hardware, für die die serverless Stellvertreter nur einstehen konnten. Dasselbe 7B-Modell, derselbe Sweep, einzelne GPU, pod danach terminiert.

Mietpreise zum damaligen Zeitpunkt, community tier, aus der Marktplatz-API abgelesen: RTX 3090 $0.22/hr, RTX 4090 $0.34/hr, RTX 5090 $0.69/hr, gegenüber der A10G der serverless Plattform mit $1.10/hr und der L4 mit $0.80/hr.

Gemessen auf einer echten RTX 3090:

| N | tok/s (aggregiert) | speedup | $/1k req |
|---|---|---|---|
| 1 | 45.8 | 1.00x | 0.267 |
| 4 | 179.0 | 3.91x | 0.068 |
| 8 | 352.2 | 7.69x | 0.035 |

Der Batching-speedup hielt auf echtem Silizium (7,69x bei N=8, gegenüber 7,42x auf dem A10G-Stellvertreter und 7,58x auf dem L4-Stellvertreter). Die echte RTX 3090 lief schneller als der A10G-Stellvertreter (45,8 gegenüber 29,2 tok/s bei N=1, 352 gegenüber 217 bei N=8), weil die A10G ein beschnittenes Teil ist. Die gemessenen Kosten waren auf der gemieteten Karte niedriger: $0.035 pro 1k Anfragen bei N=8 gegenüber $0.282 der A10G, in diesem Lauf etwa 8x niedriger, aus einer günstigeren Karte ($0.22 gegenüber $1.10/hr) und höherem Durchsatz, ohne im Voraus eine GPU zu kaufen. Der pod-Pfad hat einen langsamen Kaltstart (Image-Pull plus Modell-Download), also lief er entkoppelt: erstellen, pollen bis bereit, sweepen, terminieren.

## Realistische Triage-Zeit, und ob ein kleines Modell standhält

Die Sweeps oben maßen synthetischen Token-Durchsatz. Dies misst realistische Triage: SocTalks Triage-Eval, getrieben über 12 golden Warnungen bei Nebenläufigkeit 8, das die echten router- und verdict-Nodes auf echten Payloads timt.

DeepSeek-R1-Distill-Qwen-7B, 12 golden Warnungen, N=8:

| Provider / GPU | serving | total wall | verdict | routing | schema errors |
|---|---|---|---|---|---|
| Serverless A10G | SGLang | 43.2 s | 5/6 | 2/3 | 0 |
| Gemietete RTX 4090 (secure) | vLLM | 11.3 s | 6/6 | 2/3 | 0 |

Stock gegenüber distilled, beide auf der gemieteten RTX 4090 (secure), N=8:

| Modell | total wall | verdict | routing | schema errors |
|---|---|---|---|---|
| DeepSeek-R1-Distill-Qwen-7B | 11.3 s | 6/6 | 2/3 | 0 |
| Qwen2.5-7B-Instruct (stock) | 16.7 s | 6/6 | 1/3 | 0 |

Realistische golden Triage bei N=8 schloss den 12-Warnungen-Satz über diese Läufe hinweg in 11 bis 43 Sekunden ab, unter einer Minute. Das 7B produzierte null schema errors und verdict-Werte von 5/6 bis 6/6, also produzierte ein kleines selbst hostbares Modell hier gültige strukturierte Triage-Ausgabe. Stock Qwen2.5-7B-Instruct funktionierte ebenfalls (gültige strukturierte Ausgabe, null schema errors, derselbe verdict-Wert wie das distill) und lag beim routing um einen Fall hinter dem distill, was eine zu kleine routing-Stichprobe ist, um stark gelesen zu werden.

Kosten pro realistischer Triage, gemessen pro Node (ein voller agentischer Lauf sind ein paar Aufrufe, also mit ungefähr 2 bis 3 multiplizieren): die serverless A10G bei $1.10/hr ist etwa $1.10 pro 1.000 Warnungen; die gemietete RTX 4090 secure bei $0.69/hr ist etwa $0.18 pro 1.000, und community bei $0.34/hr etwa $0.09 pro 1.000.

## Die Capabilities hinter diesen Zahlen

Die Einsparungen oben sind nicht zufällig. Sie kommen aus einem kleinen Stack von Inferenz-Capabilities, jede offen verfolgt, die zusammen einem Triage-Lauf erlauben, ein Frontier- oder selbst gehostetes Backend anzusteuern und den niedrigsten vertretbaren Satz dafür zu zahlen. Einige sind heute vorhanden und einige werden noch gebaut; die Issue-Links zeigen, wo jede steht.

- **Ein einheitliches Anfrage-Substrat** ([#32](https://github.com/soctalk/soctalk/issues/32)). Jeder Triage-Lauf wird als ein `InferenceRequest` ausgedrückt, zu einem tier aufgelöst, mit Budgetierung pro Token, ob er auf einer Frontier-API oder einer selbst gehosteten GPU landet. Nichts stromabwärts muss wissen, welches Backend er getroffen hat.
- **Eine Liefer-Abstraktion** ([#63](https://github.com/soctalk/soctalk/issues/63)). Jedes Backend wird danach klassifiziert, wie es geliefert und abgerechnet wird, eine warme Frontier-API, eine serverless GPU mit scale-to-zero, eine dauerhaft laufende gemietete GPU oder eine lokale Instanz, sodass das Substrat den richtigen Treiber auswählt und ein Backend pro GPU-Sekunde von einem pro Token unterscheidet, statt jedes Backend als warme token-metered API zu behandeln. Die serverless Readiness und das Scheduling, die diese Klassifikation ermöglicht, sind die nächste Stufe der Arbeit ([#64](https://github.com/soctalk/soctalk/issues/64)).
- **Worker-Nebenläufigkeit, die den Batch füllt** ([#61](https://github.com/soctalk/soctalk/issues/61)). Mehrere Untersuchungen laufen gleichzeitig, sodass mehrere Anfragen gegen das Backend unterwegs sind und der continuous Batch sich füllt. Dieser gefüllte Batch ist, woher der Durchsatz und die Kostensenkungen auf dieser Seite kommen.
- **Serverless-Ausrichtung** ([#64](https://github.com/soctalk/soctalk/issues/64), in Arbeit). Kaltstart-Toleranz, burst-release Scheduling und ein async-job Treiber sind darauf ausgelegt, eine scale-to-zero GPU konsumieren zu lassen, ohne Läufe an einen kalten worker zu verlieren, sodass die scale-to-zero Ökonomie in der Produktion nutzbar wird, nicht nur in einem Benchmark. Das Benchmarking traf genau diese Lücke, kalte RunPod worker, die während des Hochfahrens einen proxy 404 zurückgaben.
- **Erstklassiges selbst gehostetes serving** ([#13](https://github.com/soctalk/soctalk/issues/13), in Arbeit). Das Modell innerhalb Ihres eigenen Clusters laufen zu lassen, ist das Deployment, das Warnungsinhalte in Ihrem Perimeter hält, und es ist das beabsichtigte In-Cluster-Ziel für die Liefer-Abstraktion oben.
- **Eine Benchmarking- und Qualifizierungs-Suite** ([#33](https://github.com/soctalk/soctalk/issues/33)). Die Evidenz auf dieser Seite wird von einer zweiachsigen Suite produziert, die Modellqualität von serving-Tauglichkeit trennt, sodass ein kleines offenes Modell gegen den strukturierten Triage-Vertrag geprüft wird, bevor ihm irgendeine Entscheidung anvertraut wird.

Darunter sitzt das Rückgrat der Kostenrechnung: die Provider-Auswahl pro tier ([#4](https://github.com/soctalk/soctalk/issues/4)) lässt den leichteren router auf einem günstigeren Modell laufen als das verdict; ein Preis-Overlay ([#5](https://github.com/soctalk/soctalk/issues/5)) verhindert, dass ein selbst gehostetes oder unbekanntes Modell zu Frontier-Sätzen abgerechnet wird; und erzwungene strukturierte Ausgabe ([#3](https://github.com/soctalk/soctalk/issues/3)) ist der Vertrag, den ein kleines Modell halten muss, um überhaupt nutzbar zu sein, was genau das ist, was die schema-error-Spalte oben misst.

## Wie diese Zahlen zu lesen sind

- **Richtungsweisend, nicht statistisch.** Der golden-Satz sind 12 Fälle (3 routing, 6 verdict, 3 deterministische Policy), also weisen die Genauigkeitszahlen eine Richtung, sie qualifizieren kein Modell. Ein repräsentativer Benchmark ist das echte Qualitäts-Gate, bevor einem kleinen Modell irgendeine knappe Entscheidung anvertraut wird.
- **Pro Node, nicht pro vollem Lauf.** Das Eval timt jeden Node als einen Aufruf, nicht als eine volle mehrstufige Untersuchung, also sind die Triage-Sekunden pro Node. Mit ungefähr 2 bis 3 für einen vollen Lauf multiplizieren.
- **Preise sind eine Momentaufnahme.** GPU-Miet- und serverless Sätze bewegen sich, und wurden zum Zeitpunkt des Laufs abgelesen. Behandeln Sie sie als Verhältnis zwischen Optionen, nicht als aktuelles Angebot.
- **Betrieb variiert nach tier.** RTX-3090-pods auf sowohl community als auch secure Cloud scheiterten wiederholt daran, innerhalb eines 22-Minuten-Fensters zu servieren, während eine RTX 4090 auf secure Cloud zuverlässig hochkam, also war die höherstufige Karte auf secure Cloud in diesen Läufen der stetigere Pfad. Gemietete pods haben kein scale-to-zero, also ist das Abbauen manuell, und jeder pod wurde nach jedem Lauf terminiert.

## Fazit: die besten Kosten-Nutzen-Setups

Wenn Sie die kurze Antwort wollen, hier ist, worauf diese Läufe hindeuten, nach Situation. Jede Zahl stammt aus den Messungen oben, also lesen Sie sie mit denselben Vorbehalten: einzelne gemessene Läufe, Preise als Momentaufnahmen, Genauigkeit richtungsweisend.

| Situation | Das Setup, das hier am besten maß | Gesehene Kosten | Der Kompromiss, den Sie eingehen |
|---|---|---|---|
| Stetiges Volumen, und Sie können eine GPU betreiben | Eine gemietete Consumer-Karte (eine RTX 4090 auf secure Cloud kam zuverlässig hoch, wo 3090er es nicht taten), ein offenes 7B-Modell auf vLLM oder SGLang, Worker-Nebenläufigkeit bei 8, um den Batch zu füllen | etwa $0.09 bis $0.18 pro 1.000 Warnungen, der 12-Warnungen-Satz in etwa 11 Sekunden | Sie betreiben den Lebenszyklus: Kaltstarts, kein scale-to-zero, manuelles Abbauen |
| Stoßweises oder betriebsarmes Volumen | Eine verwaltete scale-to-zero serverless GPU, dasselbe 7B auf SGLang, Nebenläufigkeit bei 8 | etwa $1.10 pro 1.000 Warnungen | Ein höherer Stundensatz, aber null Leerlaufkosten und nichts zu betreiben; halten Sie ein warmes Fallback für dringende Schübe bereit, die während eines Kaltstarts ankommen |
| Die schwersten Fälle, mit minimalem Betrieb | Ein leistungsfähiges Frontier-Modell für das verdict mit eingeschalteter Batch API und prompt caching, und das günstige selbst gehostete tier für die routinemäßige Mitte | Der Frontier-Satz, aber nur auf einem Bruchteil der Warnungen | Am teuersten pro Aufruf, im Gegenzug für keine Infrastruktur und ein leistungsfähigeres verwaltetes Modell-tier für die schwersten Fälle |
| Warnungsinhalte dürfen Ihren Perimeter nicht verlassen | Das 7B in-cluster selbst hosten, sobald In-Cluster-serving ausgeliefert wird, mit einem leistungsfähigen Fallback und dem safety floor an Ort und Stelle | Hier nicht gemessen; die gemieteten und serverless Self-Host-Zahlen oben sind richtungsweisende Stellvertreter, bis In-Cluster-serving landet | Sie besitzen das serving; das In-Cluster-Deployment wird noch gebaut ([#13](https://github.com/soctalk/soctalk/issues/13)) |

Die einzelne Konfigurationsentscheidung, die in jeder selbst gehosteten Zeile die meiste Arbeit leistete, war **Worker-Nebenläufigkeit bei 8**, die den continuous Batch füllt und woher die 13 bis 17 Prozent Kosten und der sechs- bis achtfache Durchsatz kamen. Paaren Sie sie mit einem kleinen Modell, das den strukturierten Vertrag bei null schema errors hält, und einer Karte, die pro Stunde günstiger ist, und bauen Sie die GPU nach jedem Lauf ab. Alles andere auf dieser Seite ist eine Variation davon.

Für die meisten Teams ist die Reihenfolge die, die der [Kostenleitfaden](/de-de/guides/inference-cost-optimization) darlegt: Batching und Caching zuerst, der router auf einem günstigeren Modell als Nächstes, und ein selbst gehostetes tier erst, wenn das Volumen und der Bedarf an Datenresidenz seinen Betrieb rechtfertigen.

**Haftungsausschluss.** SocTalk ist mit keinem LLM- oder GPU-Dienstanbieter verbunden, wird von keinem unterstützt oder gesponsert, und die Plattformen hinter diesen Läufen werden im [Kostenleitfaden](/de-de/guides/inference-cost-optimization) nur als Beispiele dafür genannt, wo ein Modell laufen kann. Die Zahlen hier sind unsere eigenen Benchmark-Beobachtungen auf einem festen golden-Satz, keine vom Anbieter veröffentlichten Zahlen, und alle Produktnamen und Marken gehören ihren jeweiligen Eigentümern.
