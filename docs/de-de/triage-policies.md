# Triage-Richtlinien

Ein LLM, das eine `sudo`-Warnung triagiert, ist ein brillanter Analyst und eine schwache Garantie. Stelle ihm dieselbe Frage zweimal, und du kannst zwei Antworten bekommen. Weise es an, vor jeder Entscheidung stets den Change-Record heranzuziehen, und es wird das tun, meistens, größtenteils. Aber ein Teil der Triage ist keine Ermessensfrage. Ein Beweisschritt *muss* laufen, bevor ein Verdikt zählt. Ein Abschluss auf einem PCI-Asset *muss* für einen Menschen pausieren. Eine Flut von Agent-Health-Rauschen *sollte* überhaupt keinen Model-Call kosten. Für diese Fälle willst du kein Reasoning. Du willst eine Regel.

Eine **Triage-Richtlinie** ist genau diese Regel, geschrieben als Daten. Sie ersetzt den Agenten nicht, sie legt einige deterministische Gates um die **agentische Schleife** (den Supervisor-und-Tools-Zyklus, der anreichert, untersucht und sich zu einem Verdikt durchdenkt). Jedes einzelne davon gehorcht demselben Gesetz:

> **Das LLM schlägt vor. Ein deterministisches Gate entscheidet.**

Das Modell bleibt frei zu argumentieren. Eine reine Funktion entscheidet, ob seine Ausgabe wirksam wird, und sie greift nur an Kanten ein, die du *beweisen* kannst, ein Autorisierungs-Record, der der Aktivität widerspricht, ein IOC auf der Warnung, ein aktiver Vorfall, der eine Entität mit diesem teilt. Die mehrdeutige Mitte geht direkt an das Modell durch, wohin sie gehört.

![Wie eine Triage-Richtlinie innerhalb der agentischen Schleife ausgewertet wird](/diagrams/triage-policy-loop.svg)

Lies es von oben nach unten: Eine Warnung wird gegen die Registry aufgelöst, durchläuft die agentische Schleife unter den Gates der Richtlinie und landet auf einer **Disposition**: der finalen Entscheidung für den Fall (automatischer Abschluss, Eskalation an einen Menschen oder Anforderung weiterer Beweise). Unter jedem automatischen Abschluss liegt ein **Safety Floor**: eine Menge nicht überschreibbarer Vetos auf Code-Ebene, die keine Richtlinie abschwächen kann, vollständig definiert [weiter unten](#the-safety-floor). Die nummerierten Gates sind die gesamte Oberfläche, und der nächste Abschnitt geht sie einzeln durch.

Die eine Eigenschaft, die all dies sicher macht: Eine **mandanten-verfasste** Triage-Richtlinie kann die Triage **strenger** machen, niemals lockerer, ihre Guardrails können nur anheben, und der harte Floor unter jedem Abschluss kann nicht abgeschwächt werden. (Geprüfte eingebaute und betreiberverwaltete *Datei*-Richtlinien sind vertrauenswürdiger Code und unterliegen dieser Einschränkung nicht.) Der Code liegt in [`src/soctalk/triage_policy/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/triage_policy).


## Wo eine Triage-Richtlinie wirkt

Eine Triage-Richtlinie steuert einen Lauf an vier Punkten, den nummerierten Gates im Diagramm oben.

1. **Resolver.** Ein Eintrittsknoten gleicht die Warnung gegen die Registry ab und schreibt die aktive Triage-Richtlinie in den Lauf-State. Gehört die Warnung zu einer bekannten Betriebsklasse ohne Sicherheitsindikatoren, kann der Lauf hier deterministisch abgeschlossen werden, ohne das Modell jemals aufzurufen.
2. **Vor-Entscheidungs-Gate.** Eine Richtlinie kann deterministische Schritte verlangen (zum Beispiel das Sammeln von Autorisierungskontext), bevor ein Verdikt zulässig ist. Schlägt der Supervisor ein Verdikt zu früh vor, leitet das Gate ihn zunächst zum erforderlichen Schritt um. Eine Richtlinie kann außerdem einschränken, welche Supervisor-Aktionen in jeder Phase zulässig sind, und diese Einschränkung wird vor dem Call auf die strukturierte Ausgabe des Modells angewendet, sodass eine unzulässige Aktion nicht einmal gesampelt werden kann.
3. **Nach-Verdikt-Guard.** Nachdem das Modell ein Verdikt entworfen hat, entscheidet eine reine Funktion, ob es committet wird. Sie kann den Entwurf überschreiben (einen Abschluss zu einer Eskalation anheben), ihn unterbrechen (den Entwurf beibehalten, aber zur menschlichen Freigabe umleiten) oder ihn bestehen lassen. Jede Überschreibung wird protokolliert.
4. **Safety Floor.** Eine nicht überschreibbare Menge von Prüfungen bewacht jeden automatischen Abschlusspfad. Es ist *kein* einzelner Schritt, die IOC-/Autorisierungs-Vetos laufen innerhalb des Nach-Verdikt-Guards, und die Kill-Switch-, Volumen-Cap- und Aktiver-Vorfall-Vetos laufen erneut, wenn ein Abschluss auf der Worker-, Server- und Ingest-Ebene committet wird. Das Diagramm zeichnet ihn der Klarheit halber als einen Knoten; nichts in einer Triage-Richtlinie kann ihn abschwächen, wo immer er läuft.

## Der Safety Floor

Der Floor wird im Code durchgesetzt, nicht in Richtliniendaten, und er gilt auf jeder Ebene, auf der ein Fall automatisch abgeschlossen werden kann: der Disposition des Workers, dem Server, der sie committet, und den Ingest-Fast-Paths (memoisierter Abschluss und regelbasierter Auto-Close). Ein Abschluss wird per Veto verhindert und der Fall stattdessen hochgestuft oder eskaliert, wenn eine der folgenden Bedingungen zutrifft:

| Veto | Wann es auslöst |
|---|---|
| IOC vorhanden | Auf dem Verdikt-Pfad ein bösartiges Anreicherungs-Verdikt oder ein MISP-Match; auf den Ingest-Fast-Paths jedes rohe IOC auf der Warnung. |
| Widersprochene Autorisierung | Records existieren, decken die Aktivität aber nicht ab (abgelaufen, außerhalb des Zeitfensters, falscher Scope, per Richtlinie verboten). |
| Ungeprüftes IOC | Ein Abschluss auf Router-Ebene mit Observables, die keine Anreicherung jemals geprüft hat. |
| Aktiver Vorfall | Eine andere aktive Untersuchung teilt eine anhang-fähige Entität mit dieser. |
| Kill Switch | Auto-Close ist ausgeschaltet, pro Mandant oder installationsweit. |
| Volumen-Cap | Der rollierende Zähler des Mandanten für automatische Abschlüsse ist aufgebraucht. |

Die effektive Menge der Gates auf einem Lauf ist der Floor plus was auch immer die aktive Richtlinie hinzufügt. Eine Triage-Richtlinie kann die Dinge nur strenger machen. Genau das macht es sicher, mandanten-verfasste Richtlinien zuzulassen: Eine fehlkonfigurierte oder feindselige Richtlinie kann nicht zu einem Kanal für die Unterdrückung von Erkennungen werden.

Der Kill Switch und der Volumen-Cap lohnen es, beim Namen gekannt zu werden. `SOCTALK_AUTO_CLOSE_KILL` auf dem API-Prozess oder das Richtlinien-Flag `auto_close_kill` auf einem Mandanten kippt jeden automatischen Abschluss in eine Hochstufung, ohne dass ein Rollout nötig ist, das ist der Hebel, zu dem du mitten in einem Vorfall greifst. `auto_close_volume_cap` (Standard 500 pro 24 Stunden) bedeutet, dass eine außer Kontrolle geratene Abschlussschleife zu „Menschen sehen sich diese an“ degradiert, statt zu Massenunterdrückung.

## Eingebaute Triage-Richtlinien

Zwei werden mit dem Produkt ausgeliefert. Beide sind geprüfter Code und schreibgeschützt.

**`dual-use-privileged-exec`** behandelt Host-Auth-Aktivität wie `sudo` und `su`, bei der dasselbe Ereignis unter einem abdeckenden Change-Record eine Routineadministration ist und ohne einen solchen ein Vorfall. Sie erfordert den Schritt `gather_authorization_context` vor jedem Verdikt, entfernt `CLOSE` aus den zulässigen Aktionen des Supervisors (damit die günstige Router-Ebene einen Fall nicht kurzschließen kann, dessen ganzer Sinn darin besteht, dass gutartig und feindselig identisch aussehen), und verlangt eine menschliche Freigabe für jeden Abschluss, der ein PCI-klassifiziertes Asset berührt.

**`agent-health-operational`** behandelt das Rauschen des Wazuh-Agent-Selbstmonitorings, etwa Regel 202 „Agent event queue is flooded.“ Dies ist eine Infrastrukturbedingung, kein Sicherheitsereignis, daher schließt die Richtlinie es deterministisch ohne jeden Model-Call ab, was das Ergebnis zudem konsistent macht, statt von Lauf zu Lauf zu variieren. Jeder Sicherheitsindikator auf der Warnung (eine MITRE-Technik, ein IOC, ein bösartiges Signal, eine nicht attestierte Klasse oder ein kritisches Wazuh-Level, 12+) verhindert den deterministischen Abschluss per Veto und schickt die Warnung in die vollständige Triage.

Du kannst beide, mit jedem ausgeklappten Gate und Guardrail, auf der Seite **Triage Policies** im MSSP-Dashboard sehen.

## Das Schema

Eine Triage-Richtlinie ist Daten. Ein generischer Interpreter führt beliebig viele davon aus.

```yaml
id: regulated-privileged-exec
version: 2
tenant: acme                       # a tenant slug or id; authored policies are always scoped
status: shadow                     # active | shadow
priority: 70                       # lower wins on a multi-match; authored/file >= 60
applies_to:
  rule_groups: [sudo]
  rule_ids: []
  authorization_tracks: [account]
required_steps: [gather_authorization_context]
decision_modules: [authorization_engine]
legal_actions:
  decide:  [VERDICT]               # an unlisted phase is unconstrained
close_signoff_data_classes: [pci]
guardrails:
  - when:
      "and":
        - "==": [{ "var": "authz.class" }, "contradicted"]
        - "==": [{ "var": "verdict" }, "close"]
    effect: override
    to: escalate
    reason: acted outside the terms of an authorization
```

Lies diese Bedingung so: Wenn die Autorisierungsklasse als `contradicted` herauskam und das Modell ein `close` entworfen hat, hebe es auf `escalate` an. Jeder Knoten ist ein einzelner Operator über seinen Argumenten, und `var` liest ein Feld aus dem State-Contract.

| Feld | Bedeutung |
|---|---|
| `applies_to` | Welche Warnungen die Richtlinie steuert. Abgeglichen anhand von Regelgruppen, Regel-IDs oder dem Autorisierungs-Track der Aktivität der Warnung, die drei werden mit OR verknüpft. |
| `required_steps` | Deterministische Knoten, die laufen müssen, bevor ein Verdikt zulässig ist. |
| `decision_modules` | Deklariert die geprüften Engines, auf die sich die Richtlinie stützt (heute: `authorization_engine`), validiert gegen bekannte Module. Die Laufzeitkonsultation wird derzeit durch `required_steps` gesteuert (z. B. `gather_authorization_context`), nicht durch dieses Feld. |
| `legal_actions` | Die pro Phase zulässigen Supervisor-Aktionen (`triage`, bis die erforderlichen Schritte gelaufen sind, dann `decide`). Eine nicht aufgeführte Phase ist unbeschränkt. |
| `close_signoff_data_classes` | Ein committender Abschluss auf einem Asset in einer dieser Klassen wird für eine menschliche Freigabe unterbrochen. |
| `guardrails` | Deklarative Override- oder Interrupt-Regeln. Siehe unten. |
| `priority` | Registry-Reihenfolge. Eingebaute belegen 10 und 50; alles Verfasste oder aus Dateien Geladene muss 60 oder höher sein, sodass es die Schutzmechanismen eines Eingebauten niemals überbieten kann. |

Einige Fähigkeiten sind dadurch eingeschränkt, woher eine Richtlinie stammt:

- **Deterministische Dispositionen** (das, womit `agent-health-operational` ohne Modell abschließt) sind **nur eingebaut**: eine neue Auto-Close-Klasse zu prägen ist eine Code-Review-Entscheidung, keine Konfiguration.
- **Verfasste Richtlinien dürfen `CLOSE` nicht gewähren** in `legal_actions`. Es zu gewähren fügt nichts gegenüber einer unbeschränkten Phase hinzu (die Baseline erlaubt den Router-Abschluss bereits), würde aber das Remapping unzulässiger Aktionen jeden Vorschlag zu einem verdiktlosen Auto-Close zwingen lassen, der nur auf dem groben Floor steht. Terminale Entscheidungen laufen stattdessen über `VERDICT`; die Validierung weist `CLOSE` in jeder Phase zurück. Eingebaute und Datei-Richtlinien dürfen weiterhin die vollständige Aktionsmenge auflisten.

## Guardrail-Bedingungen

Bedingungen sind die einzige Logik, die ein Autor schreibt, und sie laufen in einer kleinen Sandbox-Sprache über einen dokumentierten State-Contract. Es gibt keinen Attributzugriff, keine Funktionsaufrufe, keine Möglichkeit, irgendetwas außerhalb des Contracts zu benennen. Eine Bedingung ist ein Baum aus Ein-Operator-Knoten.

Operatoren: `var`, die Vergleiche (`==`, `!=`, `<`, `<=`, `>`, `>=`), die logischen `and` / `or` / `!` / `!!` und `in`.

Die Felder, die eine Bedingung lesen darf:

| Feld | Was es ist |
|---|---|
| `authz.class` | `covered`, `contradicted` oder `absent`, abgeleitet aus der Engine. |
| `authz.in_scope`, `authz.sanctioned_or_routine`, `authz.actor_genuine`, `authz.policy_allowed` | Die vier *Erwartbarkeitskomponenten*: die Booleans der Autorisierungs-Engine dafür, ob die Aktivität in einen genehmigten Scope fiel, sanktioniert oder routinemäßig war, von einem echten Akteur ausgeführt wurde und per Richtlinie erlaubt war. |
| `verdict` | Die Entwurfsentscheidung des Modells. |
| `verdict_confidence` | Deren Konfidenz, `0.0` bis `1.0`. |
| `asset.data_classification`, `asset.environment`, `asset.criticality` | Trust-aufgelöste Attribute des Assets der Aktivität. |
| `enrichment.ioc` | Ob ein bösartiges Signal vorhanden ist. |
| `correlation.active_incident` | Ob ein aktiver Vorfall überlappt. |

Ein `effect` ist entweder `override` oder `interrupt`. Unterdrückung ist nicht ausdrückbar: `close` ist kein gültiges Ziel, und ein Override darf eine Entscheidung nur die Leiter `close < needs_more_info < escalate` hinaufheben, niemals hinab. Eine Bedingung, die auf ein nicht deklariertes Feld oder einen unbekannten Operator verweist, wird bei der Validierung der Richtlinie zurückgewiesen, bevor sie jemals laufen kann. Beachte, dass `enrichment.ioc` und `correlation.active_incident` unabhängig von jedem Guardrail auch vom harten Floor durchgesetzt werden, in einem ausgelieferten Worker-Lauf wird `correlation.active_incident` üblicherweise erst am Commit-Zeit-Floor befüllt, also stütze dich für diese auf den Floor, statt sie in einem Guardrail neu herzuleiten.

## Verfasse eine im No-Code-Editor

Admins verfassen Triage-Richtlinien auf der Seite **Triage Policies**, während ein Mandant angeheftet ist, kein YAML erforderlich. Dies führt durch das End-to-End-Erstellen einer realen, nicht-trivialen Richtlinie. Das Beispiel, `prod-privileged-exec-strict`, steuert Privileged-Execution-Warnungen auf einem Account-Autorisierungs-Track: Es fordert Autorisierungsnachweise, engt ein, was der Agent tun darf, und fügt Nur-Anheben-Guardrails plus ein PCI-Abschluss-Gate hinzu.

Öffne **„+ New triage policy“** (oder `/triage-policies/editor`). Der Editor besteht aus zwei Spalten, dem Dokument-**Formular** links und einer live **Entscheidungsfluss-Projektion** plus einem **„Try it“-Simulator** rechts, die bei jeder Bearbeitung neu rendern.

![Der leere No-Code-Editor](/screenshots/triage-policy-editor-01-blank.png)

**1. Identität.** Gib der Richtlinie eine Slug-ID und eine **Priorität**: eine floor-gegatete Ganzzahl (`≥ 60`), bei der die niedrigere bei einem Doppel-Match gewinnt, sodass eine verfasste Richtlinie die eingebauten Schutzmechanismen niemals überbieten kann.

![Identität: Slug und Priorität](/screenshots/triage-policy-editor-02-identity.png)

**2. Welche Warnungen besitzt sie?** Die drei Matcher werden mit OR verknüpft. Hier besitzt die Richtlinie die Regelgruppen `sudo, su, sudoers`, die Regel-IDs `5402, 5501`, auf dem `account`-Track.

![Matcher](/screenshots/triage-policy-editor-03-matchers.png)

**3. Untersuchungsanforderungen.** Erfordere den Schritt `gather_authorization_context`, deklariere die Abhängigkeit vom Modul `authorization_engine` und enge die `decide`-Phase auf nur `VERDICT` ein. Beachte: `CLOSE` wird nicht angeboten, verfasste Richtlinien können es nicht gewähren.

![Untersuchungsanforderungen](/screenshots/triage-policy-editor-04-requirements.png)

**4. Abschluss-Freigabe.** Ein committender Abschluss auf einem `pci`- oder `phi`-klassifizierten Asset wird für einen Menschen zurückgehalten.

![Abschluss-Freigabe](/screenshots/triage-policy-editor-05-signoff.png)

**5. Guardrails.** Guardrails laufen nach dem Safety Floor, der Reihe nach, der erste Match gewinnt. Jede Bedingung kann als JSON verfasst werden, der Sandbox-Dialekt `{"op": [{"var": "field"}, value]}` mit `and`/`or`-Gruppen…

![Eine Bedingung als JSON verfassen](/screenshots/triage-policy-editor-06-guardrail-json.png)

…oder im visuellen Builder, der mit dem JSON hin- und herübersetzt. Dieser Guardrail löst aus, wenn die Autorisierung **contradicted** ist *und* das Asset **critical** ist, und hebt die Entscheidung auf `escalate` an.

![Dieselbe Bedingung im visuellen Builder](/screenshots/triage-policy-editor-07-guardrail-visual.png)

Zwei weitere vervollständigen die Richtlinie: ein Low-Confidence-Override auf `needs_more_info` und ein `interrupt`, das einen PCI-Abschluss für eine menschliche Prüfung zurückhält. Die Reihenfolge ist wichtig, der erste passende Guardrail entscheidet.

![Alle drei Guardrails](/screenshots/triage-policy-editor-08-guardrails-all.png)

**6. Lies den Fluss, dann simuliere.** Die rechte Spalte projiziert das gesamte Dokument auf die Pipeline: Matcher → Phasen → LLM-Entwurf → **Safety Floor (immer an)** → Guardrails → Freigabe → Commit.

![Entscheidungsfluss-Projektion](/screenshots/triage-policy-editor-09-decision-flow.png)

Das **„Try it“**-Panel zeigt eine Vorschau der Guardrail- und Floor-Logik, die der Editor modellieren kann, eine Teilmenge des vollständigen Worker-/Server-/Ingest-Durchsetzungspfads, für Autoren-Feedback. Füttere es mit einem Fall mit widersprochener Autorisierung und kritischem Asset, und das Ergebnis ist `escalate`: aber es kommt vom **Safety Floor**, nicht von dieser Richtlinie. Das ist die Kerninvariante sichtbar gemacht: Widersprochene Autorisierung ist ein nicht überschreibbares Floor-Veto, und die Guardrails der Richtlinie *heben* nur darauf an.

![Der Try-it-Simulator, der die Floor-Eskalation zeigt](/screenshots/triage-policy-editor-10-try-it.png)

`Create (shadow)` speichert sie. Das Formular und das gespeicherte Dokument sind dasselbe Artefakt, „View as JSON“ zeigt genau, was persistiert wird.

![Die fertige Richtlinie](/screenshots/triage-policy-editor-11-complete.png)

Die Validierung beim Speichern ist fail-closed und wendet dieselben Regeln wie Datei-Richtlinien an, plus einige strengere: Die ID muss ein Slug sein, referenzierte Schritte, Entscheidungsmodule und Legal-Action-Phasen müssen solche sein, die die Laufzeit tatsächlich kennt, `CLOSE` darf nicht gewährt werden, und die Definition ist größenbegrenzt. Eine unbekannte Referenz wird zur Autorenzeit zurückgewiesen, statt zur Laufzeit stillschweigend ignoriert zu werden. Jede gespeicherte Revision wird als Append-Only-Historie aufbewahrt.

## Shadow, dann aktivieren

Eine verfasste Richtlinie hat vier Status, **draft**, **shadow**, **active**, **retired**. Shadow-Auswertung wird dringend empfohlen, ist aber nicht verpflichtend: Eine Richtlinie kann direkt aus dem Draft aktiviert werden.

Im **Shadow**-Modus wird die Richtlinie abgeglichen und ihre Guardrails werden genau so ausgewertet, wie es eine aktive täte, und ihre würde-auslösen-Entscheidungen werden in den Audit-Trail geschrieben, aber sie ändert keine Disposition. Das gibt dir echte Belege dafür, was sie gegen Live-Traffic täte, bevor sie irgendetwas entscheidet.

Sie zu **aktivieren** (die Aktion **Activate** auf der Triage-Policies-Seite) macht sie steuernd. Da der Worker ein separater Prozess ist, dessen Registry einmalig beim Start lädt, kann die Aktivierung nicht einfach ein Datenbank-Flag umlegen, sie materialisiert die Definition beim nächsten `tenant.reconcile` in die Worker-ConfigMap des Mandanten, und der **Worker-Rollout ist das Aktivierungs-Gate**: Die Richtlinie beginnt erst zu steuern, wenn ein frischer Worker sie liest. Das Bearbeiten einer aktiven Richtlinie hält sie aktiv und rollt mit der neuen Definition neu aus; das Deaktivieren setzt sie zurück auf Shadow.

![Der Lebenszyklus einer verfassten Richtlinie: Shadow, dann aktivieren zum Steuern](/diagrams/triage-policy-lifecycle.svg)

Betreiber, die es vorziehen, Richtlinien als Code zu verwalten, können weiterhin den Git-Pfad nehmen: Schreibe eine YAML-Datei in das gemountete Verzeichnis und rolle die Worker neu aus. Dieselbe Registry lädt sowohl verfasst-und-aktivierte Richtlinien als auch handgeschriebene Datei-Richtlinien.

## Die Verdrahtung

Zwei Umgebungsvariablen tragen es:

- `SOCTALK_TRIAGE_POLICY_DIR` auf dem runs-worker ist das Verzeichnis, aus dem die Registry beim Start lädt.
- `SOCTALK_TENANT_TRIAGE_POLICIES_DIR` auf dem Controller ist das betreiber-gemountete Verzeichnis, das der Provisioning-Pfad liest, validiert und in die Chart-Values jedes Mandanten als gemountete ConfigMap rendert.

Auf dem chart-provisionierten Pfad sind Richtlinien Mandanten-Chart-Values (`runsWorker.triagePolicies`, gerendert als die `soctalk-triage-policies`-ConfigMap), und eine Inhaltsänderung stempelt eine Prüfsumme auf das Pod-Template, sodass eine Bearbeitung den Worker automatisch neu ausrollt. Der Rollout ist das Aktivierungs-Gate: Da die Registry einmal pro Prozess lädt, beginnt eine Richtlinie erst zu steuern, wenn ein frischer Worker sie liest.

Jedes Laden, Überspringen und Zurückweisen wird protokolliert. Eine Datei, die aus irgendeinem Grund die Validierung nicht besteht (fehlerhaftes Schema, ein unbekanntes Feld, eine fehlerhafte Bedingung, eine Priorität, die einen Eingebauten überbieten würde), wird als Ganzes zurückgewiesen und steuert niemals irgendetwas, sodass ein fehlerhafter Rollout zu „diese Richtlinie ist nicht aktiv“ degradiert, niemals zu falscher Durchsetzung.
