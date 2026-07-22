# Funktionsweise

## Das Problem

Ein SOC ertrinkt in Warnungen. Ein einzelner Scan kann Tausende davon erzeugen, das meiste, was eskaliert wird, stellt sich als harmlos heraus, und Analysten brennen aus, während sie eine Queue abarbeiten, die überwiegend aus Rauschen besteht. Der schwierige Teil ist nicht das Erkennen. Es ist die Entscheidung, schnell und sicher, welche der ausgelösten Dinge tatsächlich relevant sind.

## Drei Generationen der SOC-Triage

Das Triage-Tooling hat drei Generationen durchlaufen, und jede hat das Problem der vorherigen behoben, während sie einen eigenen blinden Fleck hinterließ.

Die erste Generation sind **Regeln**: Signatur- und Korrelationsregeln in einem SIEM sowie deterministische Automatisierung in einem SOAR. Sie ist schnell, auditierbar und vorhersehbar, weshalb sie noch immer unter allem läuft. Sie ist außerdem grob. Eine Regel löst bei allem aus, was auf sie passt, also ist sie laut, und ein Mensch muss trotzdem fast alles lesen. Sie ist ein Rauchmelder: zuverlässig, aber sie kann ein echtes Feuer nicht von verbranntem Toast unterscheiden.

Die zweite Generation fügte **maschinelles Lernen** hinzu: überwachte Klassifikatoren, Anomalieerkennung und Analyse des Nutzerverhaltens, die lernen, wie normal aussieht, und bewerten, was nicht normal ist. Das sortiert die Queue und hebt die Ausreißer hervor, aber es braucht gelabelte Daten, es driftet, wenn sich die Umgebung ändert, und es liefert einen Score statt eines Grundes. Es ist ein Spamfilter: Er sortiert den Stapel, aber er gibt dir eine Zahl, keine Erklärung.

Die dritte Generation sind **Sprachmodelle**, die über eine Warnung im Kontext schlussfolgern und sich in klarer Sprache erklären können. Die erste Welle von AI-SOC-Tools nutzte sie auf die naheliegende Weise, indem sie ein Modell auf jede Warnung richtete, Prompt rein und Verdikt raus. Das Problem ist, dass ein Modell, das eine Warnung isoliert liest, keine Erinnerung daran hat, was ein Analyst bereits entschieden hat, kein Bild vom Zustand der Organisation selbst (sodass es eine genehmigte Änderung nicht von einem identisch aussehenden Angriff unterscheiden kann), keine Garantie, dass es nicht selbstbewusst über einen echten Indikator hinweg schließt, und kein Gespür für die anderen Warnungen ringsum. Ein Frontier-Modell auf jede rohe Warnung anzuwenden ist zudem teuer, und die Kosten drängen Teams dazu, auf genau den Fällen schwächere Modelle einzusetzen, in denen Urteilsvermögen am wichtigsten ist. Es ist ein scharfsinniger Analyst an seinem ersten Tag: Er schlussfolgert gut über jede einzelne Warnung, aber er erinnert sich an nichts von gestern und hat weder den Änderungskalender noch die Asset-Liste ausgehändigt bekommen.

![Die Entwicklung der SOC-Triage: Regeln, maschinelles Lernen, Sprachmodelle und die agentische Generation, die SocTalk repräsentiert](/diagrams/soc-evolution.svg)

Jede Generation ist an etwas wirklich gut, und keine von ihnen ist falsch. Das Problem ist, dass die meisten Produkte eine auswählen und sich auf sie stützen.

## Was SocTalk anders macht

SocTalk ist die agentische Generation. Wo die erste Welle ein Modell auf eine Warnung richtete, lässt SocTalk eine agentische Schleife um das Modell laufen: Das Modell steuert eine deterministische Untersuchung, schlussfolgert über den gesamten korrelierten Fall und liefert ein Verdikt, das gesteuertes Handeln antreibt, während ein Mensch alles Gefährliche freigibt. All das läuft innerhalb deterministischer Guardrails. Es hält die Garantien der Regel-Ära in Code fest und überspringt bewusst die undurchsichtige Mitte. Der Rauschkollaps, den maschinelles Lernen anstrebte, wird stattdessen deterministisch erledigt, durch Coalescing, Korrelation und regelbasiertes Schließen, sodass nichts im Entscheidungspfad eine trainierte Blackbox ist. Das Modell wird nur auf die mehrdeutigen Fälle verwendet. Dann werden zwei Dinge obendrauf gesetzt, die keine der früheren Generationen hatte: Die Pipeline erinnert sich, was Analysten entscheiden, und ein Mensch gibt alles frei, das in ein Live-System eingreift.

Anders ausgedrückt: Das Modell ist eine Komponente, nicht das gesamte System. Rauschen wird zusammengeführt, bevor irgendein Modell läuft. Dem Modell wird echter organisatorischer Kontext gegeben. Die sicherheitskritischen Entscheidungen sitzen hinter einem **Safety Floor**, einer kleinen Menge harter Vetos, die in Code geschrieben sind und die weder eine Regel noch das Modell abschalten kann, so wie ein Sicherungsschalter den Strom kappt, egal was die Verdrahtung verlangt. Analystenentscheidungen werden erinnert. Und das Verdikt treibt gesteuertes Handeln an, die SOAR-Schicht des Systems, wobei ein Mensch alles Gefährliche freigibt. Das Ergebnis ist, dass das Modell über die mehrdeutige Mitte schlussfolgert und die Teile, die garantiert sein müssen, garantiert bleiben.

![Die SocTalk-Triage-Pipeline: ein deterministischer Ingest-Trichter, ein agentischer Lauf, in dem das Modell nur in zwei Rollen konsultiert wird, und gesteuertes Handeln](/diagrams/triage-pipeline.svg)

## Zwei Ebenen und ein Settle-Fenster

Die Pipeline läuft über zwei Ebenen, oder Stufen, und zu wissen, welche welche ist, erklärt den Großteil des Designs.

Die **Ingest-Ebene** ist serverseitig und vollständig deterministisch. Wenn ein Adapter (der mandantenseitige Collector, der Wazuh- und ähnliche Warnungen weiterleitet) einen Batch von Ereignissen postet, werden diese dedupliziert, zusammengeführt, korreliert, dekonfliktiert und in vielen Fällen aufgelöst, ohne dass jemals ein Modell läuft. Kein Modell berührt diese Ebene.

Die **Graph-Ebene** ist die agentische Schleife, eine pro Mandant, die als eigener Prozess läuft. Dort schlussfolgert das Modell, und es konsultiert das Modell nur in zwei Rollen: Routing und dem finalen Verdikt. Viele Fälle brauchen noch weniger und schließen mit einer deterministischen Policy ganz ohne Modellaufruf. Die Schleife hält keine eigene Datenbank: Der Fall wird ihr übergeben, wenn der Lauf startet, und sein Ergebnis wird zurückgegeben, wenn der Lauf endet, und ihre Anreicherung geschieht über Tool-Aufrufe hinaus zum SIEM und zu Threat-Intel-Diensten.

Zwischen den beiden sitzt ein optionales **Settle-Fenster**. Wenn ein Mandant eines konfiguriert, wird ein promoteter Lauf für eine kurze Verzögerung zurückgehalten, sodass sich ein Schwall korrelierter Warnungen zuerst ansammeln kann, und das Modell betrachtet den gesamten Vorfall auf einmal statt jedes Fragment einzeln, wie es eintrifft. Eine Warnung mit hoher Schwere umgeht die Wartezeit.

Auf das Verdikt zu reagieren geschieht wieder auf dem Server, deterministisch, nachdem der Lauf abgeschlossen ist. Das hält das Modell aus der Schleife heraus, die in externe Systeme eingreift.

## Auf dem Weg hinein: der deterministische Trichter

Viele Warnungen werden aufgelöst, bevor jemals ein Modell konsultiert wird, was hilft, die Pipeline erschwinglich und schnell zu halten, und es ist alles deterministischer Code.

**Coalescing und Deduplizierung lassen den Sturm zusammenbrechen.** Deduplizierung verwirft ein wiederabgespieltes Ereignis, das eine bereits gesehene ID trägt. Coalescing gruppiert dann wiederholte Warnungen derselben Regel auf demselben Asset innerhalb eines Fünf-Minuten-Fensters zu einem einzigen Fall, sodass ein Schwall derselben Erkennung zu einem Fall statt zu Tausenden wird. Das Modell und der Analyst sehen einen Fall pro Vorfall statt des rohen Feuerschlauchs. ([Korrelation und Coalescing im IR-Kern](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/triage.py))

**Korrelation hält einen Vorfall bei einem Fall.** Mit aktivierter Entitätskorrelation hängt sich eine neue Warnung, die eine starke Entität (eine zuverlässige Kennung wie ein Host oder ein Datei-Hash) mit einer aktiven Untersuchung teilt, als Beweismittel an diese an, statt einen frischen, kontextlosen Lauf zu starten. Eine Quelle, die beginnt, die Korrelation zu dominieren, etwa eine Scanner-IP, die alles berührt, wird herabgestuft, sodass sie keine unzusammenhängenden Warnungen in einen Fall ziehen kann. Korrelation läuft vor den Schließ-Pfaden, sodass eine harmlos aussehende Warnung, die zu einem laufenden Vorfall gehört, nicht stillschweigend unterdrückt wird.

**Engagement-Deconfliction hält genehmigte Tests aus der Queue heraus.** Wenn es aktiviert ist, wird ein deklariertes Pentest- oder Red-Team-Fenster nach Quelle, Host, Technik und Zeit abgeglichen. Aktivität darin wird gekennzeichnet und auditiert, aber nie automatisch geschlossen, und Tester-Aktivität, die außerhalb des Geltungsbereichs abweicht, wird zu einer menschlichen Prüfung gezwungen statt geschlossen. Siehe [Benutzer und Rollen](/de-de/users-and-roles) dafür, wie Engagements deklariert und geprüft werden.

**Deterministisches Schließen erledigt die offensichtlichen Fälle.** Falsch-Positive mit niedriger Schwere und hoher Konfidenz schließen per Regel, und eine wiederkehrende harmlose Form kann unter Bezug auf eine frühere Entscheidung schließen, beides ohne Modell. Die Falsch-Positiv-Schließbänder und der operative Schließ-Pfad halten bewusst alles zurück, was auf eine ATT&CK-Technik (eine standardisierte Angriffstechnik-ID) abgebildet ist, sodass eine technik-abgebildete Warnung nicht als Routine-Rauschen geschlossen wird.

**Der Ingest-Safety-Floor schützt all das.** Kein deterministisches Schließen darf über einem bekannten Indikator (einer verdächtigen Observable wie einer bösartigen IP oder einem Datei-Hash), einem aktiven Vorfall oder einem Kill-Switch (einer Betreiber-Einstellung, die automatisches Handeln stoppt) auslösen, und eine Volumenobergrenze wirkt als Sicherungsschalter, sodass eine außer Kontrolle geratene Regel zu "Menschen schauen" degradiert wird statt zu Massenunterdrückung.

Was auch immer den Trichter überlebt, wird promotet: Es wird zu einer Untersuchung, geplant für einen Triage-Lauf.

## Der Triage-Lauf: zwei Modellrollen und eine Menge Determinismus

Der Lauf ist eine agentische Schleife, aber der Fußabdruck des Modells darin ist klein und bewusst gesetzt.

Die Schleife öffnet mit einem deterministischen Gate. Wenn die Warnung auf eine [Triage-Policy](/de-de/triage-policies) passt, deren Disposition (das anzuwendende Ergebnis: schließen, eskalieren oder um mehr Informationen bitten) garantiert und unwidersprochen ist, wird sie dort erledigt, und das Modell wird überhaupt nicht konsultiert.

Für alles andere entscheidet ein **Supervisor**, was als Nächstes zu tun ist. Dies ist die erste der beiden Modellrollen, und ihre gesamte Aufgabe ist Routing: untersuchen, anreichern, kontextualisieren, entscheiden oder schließen. Sie leistet selbst keine Facharbeit, und sie kann mehrere Routing-Runden brauchen, bevor sie sich entscheidet.

Die Arbeit, zu der sie routet, ist deterministisch. Die **Anreicherungsschritte** ziehen Host- und Prozesskontext aus dem SIEM, prüfen die Reputation von Observables über Cortex-Analyzer und schlagen Threat-Intel-Kontext in MISP nach. Dies sind Tool-Aufrufe und Heuristiken, keine Modellaufrufe. Ein verbreitetes Missverständnis über AI-Triage ist, dass das Modell das Anreichern erledigt. Hier tut es das nicht: Anreicherung ist deterministische Tool-Orchestrierung, und das Modell liest nur die Ergebnisse.

Unterwegs sammelt der Lauf seinen [Autorisierungskontext](/de-de/authorization): die Fakten zum Organisationszustand (Änderungstickets, genehmigte Wartung, Konto- und Asset-Kontext), die sagen, ob diese Aktivität genehmigt war. Autorisierung ist das, was der Pipeline erlaubt, eine autorisierte Änderung von einem Angriff zu trennen, der eine byte-identische Warnung erzeugt, eine Unterscheidung, die kein Umfang an Reputationsabfragen treffen kann.

Wenn der Supervisor genug hat, übergibt er an das **Verdikt**, die zweite Modellrolle. Dies ist die eine Stelle, an der ein Reasoning-Modell alles abwägt, was der Lauf gesammelt hat, und eine Disposition vorschlägt: schließen, eskalieren oder um mehr Informationen bitten.

Dann übernimmt wieder der Determinismus. Das Verdikt ist ein Vorschlag, kein Commit. Ein [Triage-Policy](/de-de/triage-policies)-Guard kann die Entscheidung des Modells immer nur anheben, nie absenken: Ein vorgeschlagenes Schließen über einem bösartigen Signal oder einem widersprochenen Autorisierungsdatensatz wird in eine Eskalation umgewandelt, und das Vokabular des Guards macht Unterdrückung unmöglich auszudrücken. Wenn ein vorgeschlagenes Schließen ein sensibles Asset berührt, wird es für eine menschliche Freigabe zurückgehalten. Das Modell schlägt vor; deterministischer Code verfügt.

## Die Garantien: ein Safety Floor an drei Stellen

Die Regel, dass Autorisierung und das Modell niemals über einem bekannten bösartigen Signal, einem unverifizierten Indikator oder einem aktiven verwandten Fall schließen können, wird nicht dem Wortlaut des Prompts überlassen. Sie wird in Code durchgesetzt, an drei unabhängigen Punkten auf dem Schließ-Pfad:

- **Beim Ingest**, vor jedem deterministischen Schließen, geschlüsselt auf einen bekannten Indikator, einen aktiven Vorfall, einen Kill-Switch und die Volumenobergrenze.
- **Während des Laufs**, wenn das Modell ein Schließen vorschlägt, geschlüsselt auf einen bekannten Indikator, einen unverifizierten Indikator und einen widersprochenen Autorisierungsdatensatz. Dies ist der einzige Floor, der überhaupt Autorisierung konsultiert.
- **Auf dem Server**, wenn das Schließen committet wird, geschlüsselt auf den Kill-Switch, einen weiteren aktiven Fall, der dieselben Entitäten teilt, und die Volumenobergrenze.

Jeder Schließ-Pfad ist an seinem eigenen Punkt mit einem Floor versehen: Ein deterministisches Ingest-Schließen passiert den ersten, und ein modell-vorgeschlagenes Schließen passiert den zweiten und dann den dritten. Autorisierung kann Verdacht an diesem mittleren Floor senken, aber sie kann keinen von ihnen von einem bekannten Indikator oder einem aktiven verwandten Fall abbringen. Siehe [Autorisierung](/de-de/authorization) dafür, wie deckende Beweise Verdacht senken, ohne jemals ein bösartiges Signal zu übersteuern.

## Auf das Verdikt reagieren

Sobald der Lauf abgeschlossen ist, committet der Server die Disposition und reagiert darauf, deterministisch und in einer Transaktion.

Eine Eskalation landet in der Queue der [menschlichen Prüfung](/de-de/human-review) mit den echten Beweisen angehängt. Wenn der Lauf gerade deshalb ins Stocken geriet, weil Autorisierung fehlte, trägt die Prüfung eine typisierte Autorisierungsfrage, und die Antwort des Analysten wird als wiederverwendbarer Fakt gespeichert, sodass dieselbe Aktivität nicht erneut abgefragt wird, solange diese Autorisierung gilt. Dieses Einmal-Fragen-Gedächtnis wird auf der Seite [Autorisierung](/de-de/authorization) beschrieben.

Ein Verdikt treibt außerdem [Response-Playbooks](/de-de/response-playbooks) an. Dies ist die SOAR-Schicht des Systems, dieselbe Art deterministischer, gesteuerter Automatisierung, die ein SOAR-Analyst wiedererkennen würde, nur dass sie von einem begründeten Verdikt statt von einer spröden Regel angetrieben wird, und hier zeigt sich die Haltung des "gesteuerten Handelns". Sichere Aktionen, das Schreiben einer Notiz oder das Benachrichtigen eines Webhooks, laufen von allein. Aktionen, die in ein Live-System eingreifen, das Isolieren eines Endpunkts oder das Deaktivieren eines Kontos, laufen niemals von allein: Sie werden als Vorschlag aufgeworfen, und ein Analyst gibt sie zuerst frei. Ein Schließen darf immer nur annotieren, ein Dispatch-Kill-Switch stoppt aktive Response-Aktionen sofort (Shadow-Audits können weiterhin aufzeichnen, was ausgelöst hätte), und der gesamte Dispatch geschieht serverseitig, niemals aus der Schleife des Modells.

Ein letzter deterministischer Handgriff kümmert sich um das Timing. Wenn neue korrelierte Beweise eintrafen, während der Lauf noch im Gange war, und der Fall noch offen ist, wird ein Folge-Lauf über das nun vollständige Bild gestartet, sodass eine spät eintreffende Warnung nicht außerhalb des Falls stranden bleibt, zu dem sie gehört.

## Was das anders macht

Zusammengenommen heben ein paar Eigenschaften dies davon ab, ein Modell auf jede Warnung zu richten:

- **Viele Warnungen erreichen nie ein Modell.** Dedup, Coalescing, Deconfliction und deterministisches Schließen lösen viele davon beim Ingest auf, sodass das Modell auf die mehrdeutigen Fälle verwendet wird.
- **Ein Lauf konsultiert das Modell nur in zwei Rollen**, Routing und dem finalen Verdikt, und viele Fälle schließen deterministisch ganz ohne Modellaufruf. Anreicherung ist deterministische Tool-Orchestrierung, keine Modellklassifikation pro Warnung.
- **Ein Vorfall ist ein Fall.** Coalescing und Korrelation geben dem Modell das gesamte korrelierte Bild, nicht eine einzelne Warnung, die ihres Kontexts beraubt ist.
- **Das Modell schlägt vor, Code verfügt.** Ein Guard und ein Safety Floor an drei Stellen machen es strukturell unmöglich für das Modell, über einem bekannten Indikator, einem widersprochenen Autorisierungsdatensatz oder einem aktiven verwandten Fall zu schließen.
- **Die Pipeline schlussfolgert über Autorisierung.** Sie kann eine genehmigte Änderung von einem identisch aussehenden Angriff unterscheiden, ein Urteil, das Reputation und Signaturen allein nicht treffen können.
- **Sie erinnert sich.** Die Autorisierungsentscheidung eines Analysten wird zu wiederverwendbarem Gedächtnis, sodass die Queue aufhört, eine bereits beantwortete Frage zu stellen, solange diese Autorisierung gilt.

## Wohin als Nächstes

Jede Stufe hat ihre eigene Seite und ihren Code:

- [Autorisierung](/de-de/authorization), Schlussfolgern über den Organisationszustand und das Einmal-Fragen-Gedächtnis.
- [Triage-Policies](/de-de/triage-policies), die deterministischen Guardrails auf dem Lauf.
- [Response-Playbooks](/de-de/response-playbooks), ein Verdikt in gesteuertes Handeln verwandeln.
- [Menschliche Prüfung](/de-de/human-review), die Prüfungs-Queue und der Entscheidungspfad des Analysten.
- [AI-Pipeline](/de-de/ai-pipeline), der agentische Graph im Detail.
- [Architektur](/de-de/reference/architecture), das Deployment und das Datenmodell.

Der Pipeline-Code liegt unter [`src/soctalk/core/ir/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/core/ir) (Ingest-Ebene), [`src/soctalk/graph/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/graph) und [`src/soctalk/supervisor/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/supervisor) (Graph-Ebene) und [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response) (Response).
