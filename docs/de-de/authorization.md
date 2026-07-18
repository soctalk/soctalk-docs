# Autorisierung

## War diese Aktivität autorisiert?

Das meiste, was ein SOC eskaliert, ist nicht böswillig. Es ist eine reale Person oder ein reales System, das reale Arbeit verrichtet, die zufällig wie ein Angriff aussieht: ein Administrator, der um 3 Uhr morgens ein Break-Glass-Konto verwendet, eine Deploy-Pipeline, die eine Konfigurationsdatei berührt, ein Scanner, der während eines genehmigten Pentests ein Subnetz durchsucht. Ob eine Warnung harmlos ist, hängt oft nicht von der Warnung selbst ab, sondern vom Zustand der Organisation, die sie umgibt. Zwei byte-identische Warnungen können entgegengesetzte Dispositionen haben, allein abhängig davon, ob ein Change-Ticket, ein Wartungsfenster oder eine genehmigte Baseline die Aktivität abdeckt.

Autorisierung ist die Schicht, die SocTalk diesen Kontext des Organisationszustands verleiht. Sie bindet typisierte Datensätze (Change-Tickets, dauerhafte Baselines, Change-Freezes, Verbote und Entitätsfakten über Assets und Konten) an die Aktivität in einer Warnung und schlussfolgert, ob ein einzelner Datensatz sie vollständig abdeckt. Sie senkt den Verdacht nur, indem sie abdeckende Belege findet. Sie erhöht ihn nie und setzt niemals ein böswilliges Signal außer Kraft.

Sie ist kein separater Schritt, der auf die Triage aufgesetzt wird. Sie ist Kontext, den die agentische Schleife während der Untersuchung sammelt, und sie löst sich in einen von drei Zuständen auf, die das Verdikt prägen. Alles Nachgelagerte durchläuft weiterhin den Sicherheitsboden, den die Autorisierung niemals schwächen kann.

![Wo die Autorisierung in den Triage-Workflow passt](/diagrams/authorization-in-triage.svg)

## Abgedeckt, widersprochen, fehlend

Die Autorisierung jeder Warnung löst sich in einen von drei Zuständen auf, und der Unterschied zwischen den letzten beiden ist das Entscheidende:

- **Abgedeckt.** Ein einzelner Datensatz deckt die Aktivität vollständig ab: das richtige Subjekt, Ziel, die richtige Aktion, das richtige Zeitfenster, die Kalendergültigkeit und die Genehmigungen. Der Verdacht wird gesenkt.
- **Widersprochen.** Es liegen Datensätze vor, aber keiner deckt ab, oder ein Verbot mit hoher Priorität untersagt die Aktion. Ein Change-Ticket existiert, aber es ist abgelaufen, oder es gilt für einen anderen Host, oder der benötigte Change-Freeze wurde nie ausgenommen. Dies ist ein Fund, keine Abwesenheit, und es wird an einen Menschen eskaliert.
- **Fehlend.** Es liegt überhaupt kein Datensatz der richtigen Art vor. Abwesenheit wird niemals als Autorisierung behandelt. SocTalk fragt nach weiteren Informationen, anstatt anzunehmen, dass die Aktivität genehmigt wurde.

Fehlend und widersprochen auseinanderzuhalten ist wichtig. Ein veraltetes oder falsches Ticket darf niemals als "beinahe autorisiert" gelesen werden. Es ist das Gegenteil: Der Papierkram, der dies hätte abdecken sollen, tut es nicht, und das verdient die Aufmerksamkeit eines Menschen.

## Woher Autorisierungsfakten stammen

Fakten erreichen den Speicher auf drei Wegen, mit steigendem Vertrauen:

- **Mandanten behaupten Fakten über ihre eigene Umgebung.** Ein Kunde deklariert ein Wartungsfenster oder eine dauerhafte Baseline im Autorisierungsbereich. Von Mandanten behauptete Fakten landen im Status "ausstehend" und beeinflussen die Triage nicht, bis ein MSSP-Analyst sie genehmigt.
- **Systeme pushen Fakten über die Ingest-API.** Provisionierungsskripte, CI-Hooks und Konnektoren übermitteln typisierte Fakten mit einem mandantenspezifischen Credential. Das Vertrauen wird vom Credential abgeleitet, niemals von der Payload, denn wer einen Fakt pushen kann, kann eine Erkennung unterdrücken.
- **Analysten beantworten eine Autorisierungsfrage.** Wenn die Triage speziell deshalb ins Stocken gerät, weil die Autorisierung fehlt, beantwortet der Analyst sie einmal, und die Antwort wird zu einem wiederverwendbaren Datensatz. Dies ist der nachfolgend beschriebene Ablauf.

## Eine Autorisierungsfrage beantworten

Wenn eine Untersuchung nicht entschieden werden kann, weil die Autorisierung fehlt, und es kein böswilliges Signal gibt, trägt die Prüfung eine typisierte Autorisierungsfrage statt einer generischen Anforderung weiterer Informationen. Der Analyst wird nach einer Sache gefragt: War diese Aktivität autorisiert?

![Die typisierte Autorisierungsfrage auf einer Prüfung, mit einer Speicheraktion](/screenshots/authz-ask-question.png)

Das Panel benennt die genaue fragliche Aktivität und bietet eine einzelne Aktion, die sich von "genehmigen" oder "ablehnen" unterscheidet. Wenn die Aktivität autorisiert war, legt der Analyst fest, wie lange die Autorisierung gelten soll, und wählt **Confirm authorized, save reusable authorization**. Dies schreibt eine dauerhafte, von einem Analysten behauptete Berechtigung, die auf genau diese Aktivität (dieses Konto, diese Aktion, diesen Host) mit dem gewählten Ablaufdatum eingegrenzt ist.

![Die gespeicherte wiederverwendbare Autorisierung und die aus der Warteschlange entfernte Prüfung](/screenshots/authz-ask-saved.png)

Die gespeicherte Berechtigung ist der springende Punkt. Wenn dieselbe Aktivität das nächste Mal eine Warnung erzeugt, deckt ein Datensatz sie nun ab, sodass die Frage nicht erneut gestellt wird. Einmal fragen, sich merken. Die Autorisierung ist auf die genaue Aktivität eingegrenzt und trägt ein Ablaufdatum, sodass sie sich nicht stillschweigend ausweitet oder für immer besteht, und sie erscheint im Autorisierungsbereich, wo sie jederzeit geprüft oder widerrufen werden kann.

Eine Regel ist bewusst gewählt: Ein Fakt wird nur durch diese explizite Antwort erzeugt. SocTalk lernt niemals eine Autorisierung aus einem bloßen Schließen oder Ablehnen. Ein Analyst, der die Warteschlange leert, ist nicht dasselbe wie ein Analyst, der erklärt, dass eine Aktivität genehmigt ist, und dies so zu behandeln würde zulassen, dass der Druck der Warteschlange den Speicher stillschweigend vergiftet.

## Die Guardrails

Autorisierung ist eine Unterdrückungsfläche, daher werden ihre Grenzen im Code durchgesetzt und nicht der Formulierung eines Prompts überlassen:

- **Abwesenheit schließt niemals automatisch.** Kein abdeckender Datensatz bedeutet, dass ein Mensch entscheidet, niemals ein automatisches Schließen.
- **Autorisierung setzt niemals ein böswilliges Signal außer Kraft.** Ein gespeicherter Fakt "autorisiert" kann eine Warnung nicht schließen, die zugleich einen IOC-Treffer, eine böswillige Anreicherung oder eine Korrelation mit einem aktiven Vorfall trägt. Die Korrelation läuft vor der Unterdrückung, und der Sicherheitsboden legt in diesen Fällen unabhängig von jedem Fakt ein Veto ein. Eine wiederverwendbare Autorisierung senkt den routinemäßigen Verdacht; sie macht das System nicht blind für einen realen Angriff, der dieselbe Aktivität wiederverwendet.
- **Der Speicher ist typisiert und geregelt.** Fakten tragen eine Quelle, eine Vertrauensstufe, einen Geltungsbereich und ein Ablaufdatum. Sie sind niemals formloser Prompt-Speicher, und breite oder privilegierte Fakten sollen die Prüfung durchlaufen.
- **Vertrauen ist gestuft.** Konnektor-verifizierte Datensätze rangieren über systembehaupteten, die über analysten-behaupteten rangieren, die über routinemäßiger Telemetrie rangieren, die über mandanten-behaupteten rangiert. Ein Datensatz mit höherem Vertrauen bestätigt einen mit niedrigerem Vertrauen oder setzt ihn außer Kraft.

## Wo es auftaucht

Der Autorisierungskontext wird in jede Untersuchung, die ihn trägt, in die Schlussfolgerung der AI eingerendert, sodass das Modell die abdeckenden Belege selbst abwägt, anstatt ein Ja oder Nein vorgesetzt zu bekommen. Gespeicherte Fakten, ihr Prüfstatus und ihr Ablaufdatum werden im Bereich **Autorisierung** der UI aufgelistet, wo ein Analyst jeden Fakt widerrufen kann. Siehe [Benutzer und Rollen](/de-de/users-and-roles) dazu, wer behaupten, prüfen und beantworten darf, und [Menschliche Prüfung](/de-de/human-review) für die Prüf-Warteschlange, auf der die Autorisierungsfrage mitfährt.
