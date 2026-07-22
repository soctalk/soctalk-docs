# Response-Playbooks

## Vom Verdict zur Aktion

Die [KI-Triage-Pipeline](/de-de/ai-pipeline) von SocTalk existiert, um eine einzige Frage zu einer Warnung zu beantworten: Ist das echt, und was soll mit dem Fall geschehen. Die agentische Schleife reichert die Warnung an, sammelt Kontext, untersucht und argumentiert sich zu einem Verdict, und der Lauf endet mit einer Disposition. Die Disposition ist die endgültige Entscheidung, eine von: an einen Menschen eskalieren, automatisch als Falsch-Positiv schließen oder nach weiteren Belegen fragen. Diese Entscheidung ist das Ergebnis der gesamten vorgelagerten Pipeline, und hier verrichten [Triage-Richtlinien](/de-de/triage-policies) ihre Arbeit, indem sie die Teile der Triage, die garantiert deterministisch sein müssen, deterministisch halten und das Modell über den mehrdeutigen Rest argumentieren lassen.

Eine Disposition für sich ändert nichts in der Außenwelt. Sie öffnet kein Ticket, alarmiert nicht den Bereitschaftsdienst, übergibt den Fall keinem SOAR und trennt kein kompromittiertes Notebook vom Netzwerk. Ein Response-Playbook ist die Schicht, die auf die Disposition hin handelt. Es läuft strikt nach dem Commit der Triage, es liest, was die Triage produziert hat, und macht daraus konkrete Schritte.

Was es liest, ist ein einzelnes typisiertes Objekt namens Disposition-Envelope. SocTalk stellt den Envelope in dem Moment zusammen, in dem die Disposition endgültig wird, innerhalb derselben Datenbanktransaktion, und er trägt alles, worauf eine Response ansetzen könnte. Das ist die effektive Disposition, also die endgültige Entscheidung, nachdem der Sicherheits-Floor sein Wort mitgeredet hat; das Verdict des Modells und dessen Konfidenz; die Schwere der Warnung; ihre Regelgruppen und Regel-IDs; die ATT&CK-Techniken und -Taktiken, auf die sie abgebildet wurde; die beteiligten Entitäten und IOCs; und welche Vetos des Sicherheits-Floors unterwegs ausgelöst wurden. Der Envelope ist der Vertrag zwischen Triage und Response, und er ist zugleich genau die Nutzlast, die ein Playbook an jedes nachgelagerte System weiterreicht.

![Wie ein Response-Playbook die Triage-Disposition konsumiert und darauf hin handelt](/diagrams/response-playbook-loop.svg)

Alles Folgende ist die rechte Seite dieses Bildes: wie ein Playbook den Envelope abgleicht, welche Aktionen es ausführen kann und wie die gefährlichen hinter einem Menschen bleiben. Der Code liegt in [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response).

## Was von selbst läuft und was eine Freigabe braucht

Aktionen fallen danach, wie stark sie deine Umgebung beeinflussen können, in zwei Gruppen. Eine Notiz an den Fall zu schreiben oder eine Benachrichtigung an einen Webhook zu senden ist gefahrlos von selbst zu tun, denn das Schlimmste, was es anrichten kann, ist Rauschen hinzuzufügen, also laufen diese sofort, ohne dass jemand sie freigibt. Einen Endpunkt zu isolieren oder ein Konto zu deaktivieren ist eine andere Sache, also feuern diese niemals von selbst. Wenn ein Playbook eine solche verlangt, führt es sie nicht aus. Es erhebt einen Vorschlag am Fall, und ein Analyst prüft und gibt ihn frei, bevor irgendetwas passiert. Das Modell ergreift während der Triage niemals von selbst eine Containment-Aktion, und ein Playbook kann während der Response keine von selbst ergreifen. In beiden Fällen zeichnet ein Mensch alles ab, was in ein Live-System eingreift.

Drei Regeln leben im Code statt in Playbook-Daten, und kein Playbook kann sie abschwächen. Ein Schließen ist die Richtung, die ein Angreifer am liebsten auslösen würde, also darf ein Playbook auf dem Schließen-Pfad nur annotieren oder auditieren, niemals eine externe Aktion ergreifen. Der Dispatch-Kill-Switch, gesetzt mit `SOCTALK_RESPONSE_DISPATCH_KILL` auf dem API-Prozess oder dem `response_dispatch_kill`-Flag auf einem Mandanten, stoppt jede Response ohne Rollout, was der Hebel ist, zu dem man greift, wenn ein Connector mitten in einem Vorfall beginnt, sich fehlzuverhalten. Und eine Response feuert nur, wenn die Disposition am Fall tatsächlich wirksam wurde. Hat ein Analyst die Untersuchung geschlossen oder zusammengeführt, während der Lauf noch lief, wird nichts gegen einen Zustand ausgeliefert, der nie eingetreten ist.

## Die drei Capabilities

Ein Playbook verweist auf eine Capability per Namen und kann nichts anderes benennen. Ein unbekannter Name wird bei der Validierung des Playbooks abgelehnt. Drei Capabilities werden heute ausgeliefert.

`annotate_investigation` schreibt eine Systemnotiz an den Fall. Es berührt nur SocTalk, es läuft von selbst, und es ist die einzige beim Schließen erlaubte Aktion.

`notify_webhook` postet den signierten Envelope an den für den Mandanten konfigurierten Webhook. Das ist die Übergabe an ein externes SOAR. SocTalk signiert den Envelope und sendet ihn, und der Empfänger verantwortet alles, was danach geschieht. Auch dies läuft von selbst.

`external_action` ist diejenige, die eine Freigabe braucht. Sie sendet eine benannte Aktion zusammen mit dem signierten Envelope an einen vom Operator konfigurierten Endpoint, und hier lebt die eigentliche Arbeit, einen Endpunkt zu isolieren oder ein Konto zu deaktivieren, außerhalb von SocTalk hinter einem stabilen Vertrag. Sie läuft niemals, ohne dass ein Analyst sie zuvor freigibt.

Ein Detail hält `external_action` sicher. Ein Playbook-Autor benennt einen Endpoint und eine Aktion, niemals eine URL. Der Operator bildet diesen Endpointnamen in der Mandanten-Richtlinie `response_action_endpoints` auf eine echte URL und ein Signaturgeheimnis ab, sodass ein Autor darum bitten kann, auf dem `edr`-Endpoint zu isolieren, aber nicht wählen kann, wohin die Anfrage tatsächlich geht. Jede Anfrage ist HMAC-signiert, und sie weigert sich, eine private oder Link-Local-Adresse zu erreichen.

## Das Schema

Ein Response-Playbook ist Daten, und ein Interpreter führt beliebig viele davon aus. Das Playbook, das das Tutorial unten baut, sieht so aus:

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active or shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx), not names
  mitre_tactics: ["Lateral Movement"]   # tactic strings as your source emits them
response:
  on_escalate:
    - capability: external_action
      when: { ">=": [{ "var": "severity" }, 10] }
      params: { endpoint: edr, action: isolate_endpoint }
    - capability: notify_webhook
    - capability: annotate_investigation
      params: { body: "endpoint isolation proposed for lateral-movement alert" }
  on_close:
    - capability: annotate_investigation
      params: { body: "auto-closed as false positive" }
```

Der `applies_to`-Block entscheidet, welche Warnungen das Playbook besitzt. Er gleicht auf Regelgruppen, Regel-IDs, ATT&CK-Technik-IDs oder ATT&CK-Taktiken ab, und die vier werden mit ODER verknüpft, sodass jeder einzelne Treffer ein Match ist. Ein leeres `applies_to` matcht jede Warnung, was in Ordnung ist, denn die Dispositionslisten entscheiden ohnehin bereits, wann ein Playbook tatsächlich feuert. Der ATT&CK-Abgleich folgt einer Regel. Techniken werden über ihre kanonische ID wie `T1021` abgeglichen, niemals über den Namen, denn die menschenlesbaren Namen sind instabil. Taktiken werden über die Zeichenkette abgeglichen, die die Warnungsquelle ausgibt, und Wazuh sendet Namen wie `Lateral Movement` statt `TA`-Referenzen.

Unter `response` hält `on_escalate` bis zu acht Aktionen, die auszuführen sind, wenn der Fall eskaliert, und `on_close` hält bis zu vier Aktionen der Annotationsstufe für ein automatisches Schließen. Jede Aktion ist ein Capability-Name, eine optionale `when`-Bedingung und ein Bündel von `params`, das die Capability liest. Die Params sind durchgereicht. `external_action` zieht `endpoint` und `action` daraus heraus und leitet den Rest weiter, und sie braucht den Ziel-Host nicht in den Params benannt, denn der vollständige signierte Envelope reist mit jeder Anfrage mit und die Entitäten fahren darin mit.

## Bedingungen

Eine `when`-Bedingung ist die einzige Logik, die ein Autor schreibt, und sie läuft in derselben kleinen sandboxed Sprache wie die Triage-Guardrails. Sie ist ein Baum aus Knoten mit je einem einzigen Operator über einer festen Menge von Feldern, ohne Attributzugriff, ohne Funktionsaufrufe und ohne Möglichkeit, irgendetwas außerhalb des Vertrags zu benennen. Die Operatoren sind `var`, die Vergleiche `==`, `!=`, `<`, `<=`, `>` und `>=`, die logischen `and`, `or`, `!` und `!!` sowie `in`. Eine Aktion feuert nur, wenn ihre Bedingung zutrifft, und eine Bedingung über Daten, die fehlen, ist schlicht falsch und kein Fehler.

Die Felder, die eine Bedingung lesen darf, stammen alle aus dem Envelope. Da ist die effektive `disposition` und die `worker_disposition`, die das Modell vorschlug, bevor der Floor sie änderte; `floor_vetoed`, das aussagt, ob ein Floor-Veto das Ergebnis verändert hat; `verdict_confidence` und `severity`; die `rule.groups` und `rule.ids` der Warnung; und die ATT&CK-Felder, `mitre.techniques`, das die kanonischen `Txxxx`-IDs hält, und `mitre.tactics`, das die Taktik-Zeichenketten der Quelle hält. Die letzten vier sind Listen, also testest du sie mit `in`. `{"in": ["T1021", {"var": "mitre.techniques"}]}` zu schreiben feuert die Aktion, wenn die Warnung die Technik T1021 trägt. Ein Feld oder einen Operator zu referenzieren, den der Vertrag nicht deklariert, lehnt das Playbook beim Speichern ab, lange bevor es je laufen könnte.

## Bau eines im No-Code-Editor

Admins verfassen Response-Playbooks auf der Seite **Response Playbooks**, während ein Mandant angepinnt ist, ganz ohne YAML. Dies führt durchgehend durch den Bau des Playbooks `isolate-lateral-movement-endpoint` aus dem Schema oben. Es schlägt vor, bei einer hochschweren Lateral-Movement-Eskalation einen Endpunkt zu isolieren, benachrichtigt das SOC und annotiert den Fall.

Öffne **"+ New response playbook"** (oder navigiere zu `/response-playbooks/editor`). Der Editor besteht aus zwei Spalten. Das Dokumentformular ist links, und rechts ist ein Live-Flussdiagramm, das bei jeder Bearbeitung neu rendert und zeigt, wie sich die Disposition auf die Aktionen auffächert, wobei diejenigen, die eine Freigabe brauchen, zuerst durch einen Freigabeschritt geleitet werden.

![Der leere No-Code-Editor](/screenshots/response-playbook-editor-01-blank.png)

Beginne mit der Identität. Gib dem Playbook eine Slug-ID und eine Priorität, wobei bei einem Mehrfach-Match eine niedrigere Zahl gewinnt.

![Identität](/screenshots/response-playbook-editor-02-identity.png)

Als Nächstes entscheide, welche Warnungen es besitzt. Die vier Matcher werden mit ODER verknüpft. Dieses Playbook besitzt die Regelgruppen `sudo` und `su` und, nützlicher, die ATT&CK-Technik `T1021` (Remote Services) und die Taktik `Lateral Movement`, sodass es auf jede auf Lateral Movement abgebildete Warnung feuert, egal welche Regel sie ausgelöst hat. Das Technik-Feld nimmt IDs, keine Namen, und das Taktik-Feld nimmt die Zeichenkette, die deine Quelle ausgibt.

![Matcher, einschließlich ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

Nun die Isolationsaktion. Füge bei einer Eskalation `external_action` hinzu, die mit "needs approval" gekennzeichnete. Benenne in ihren Params den vom Operator konfigurierten Endpoint und die Aktion, welche `isolate_endpoint` lautet, und du gibst niemals eine URL ein. Füge eine Bedingung hinzu, damit sie nur bei einer hochschweren Eskalation feuert.

![Die Isolationsaktion mit einer Bedingung](/screenshots/response-playbook-editor-04-isolate.png)

Füge die beiden Aktionen hinzu, die die Response abrunden und von selbst laufen. Ein `notify_webhook` übergibt den Fall an das SOAR des SOC, und ein `annotate_investigation` hinterlässt eine Audit-Spur.

![Die Notify- und Annotate-Aktionen, die von selbst laufen](/screenshots/response-playbook-editor-05-tier0.png)

Lies den Flow, während du baust. Die rechte Spalte projiziert das gesamte Dokument. Der Disposition-Envelope fächert sich auf jede Aktion auf, die Isolationsaktion wird durch einen Freigabeschritt geleitet, bevor sie laufen kann, und die anderen beiden werden von selbst laufend dargestellt.

![Das Flussdiagramm, mit der Isolationsaktion, die durch die Freigabe geleitet wird](/screenshots/response-playbook-editor-06-flow.png)

Das Speichern mit **Create (shadow)** persistiert es. Das Formular und das gespeicherte Dokument sind dasselbe Artefakt, und "Preview JSON" zeigt genau, was gespeichert wird. Die Validierung beim Speichern ist fail-closed. Die ID muss ein Slug sein, jede Capability muss einer der geprüften Namen sein, `on_close` darf nur annotieren, und Bedingungen müssen den deklarierten Vertrag referenzieren. Eine unbekannte Referenz wird während des Verfassens abgelehnt, niemals stillschweigend zur Laufzeit verworfen.

![Das fertige Playbook in der Liste, bereit zur Aktivierung](/screenshots/response-playbook-editor-07-list.png)

## Shadow, dann aktivieren

Ein verfasstes Playbook durchläuft vier Status: draft, shadow, active und retired.

Im Shadow-Modus wird das Playbook gematcht und seine Aktionen werden genau so ausgewählt, wie es ein aktives täte, und seine potenziell feuernden Aktionen werden in die Audit-Spur geschrieben, aber nichts wird eingereiht. Das gibt dir echte Belege dafür, was es gegen Live-Verkehr täte, bevor es irgendetwas tut.

Es zu aktivieren, mit der Aktion **Activate** auf der Seite Response Playbooks, schaltet es ein, und anders als eine Triage-Richtlinie wird es live wirksam. SocTalk wertet Response-Playbooks aus, sobald jeder Fall entschieden wird, sodass ein aktives Playbook auf die allernächste Disposition angewendet wird, ohne dass auf einen Rollout gewartet werden muss. Die Deaktivierung führt es sofort in den Shadow-Modus zurück.

Wenn eine Aktion, die eine Freigabe braucht, bei einer echten Eskalation aufkommt, landet sie als Vorschlag am Fall. Der Analyst sieht genau, was laufen würde und gegen welchen Host, und sie freizugeben ist es, was die Isolation auslöst. Die Aktion läuft einmal, die zurückerhaltene Antwort wird aufgezeichnet, und eine wiederholte Zustellung führt sie nie ein zweites Mal aus.

## Die Verdrahtung

Ein paar Teile tragen all dies. `SOCTALK_RESPONSE_PLAYBOOK_DIR` auf dem API-Prozess ist ein Verzeichnis von YAML-Playbooks, das beim Start geladen wird, was der git-verwaltete Pfad für Operatoren ist, die Playbooks als Code bevorzugen. In der UI verfasste Playbooks leben stattdessen in der Datenbank, als append-only geführte Historie und so gescopt, dass ein Mandant immer nur seine eigenen sieht, und SocTalk führt sie mit den Datei-Playbooks so zusammen, dass das eigene Playbook eines Mandanten ein Datei-Playbook gleicher ID überschreibt. `response_webhook_url`, mit einem optionalen `response_webhook_secret`, setzt das `notify_webhook`-Ziel auf einem Mandanten. Und `response_action_endpoints` auf einem Mandanten bildet Endpointnamen auf ihre URL und ihr Geheimnis für `external_action` ab, wodurch der Operator die Kontrolle über die Ziele behält, während ein Playbook immer nur eines benennt.

Jeder Match, jede Freigabe, jede Aktion und jede Ablehnung wird protokolliert, und jede Aktion, die läuft, zeichnet die Playbook-ID und -Version zusammen mit der zurückerhaltenen Antwort auf. Ein Playbook, das die Validierung nicht besteht, wird als Ganzes abgelehnt und wird niemals wirksam, sodass eine fehlerhafte Bearbeitung als "dieses Playbook ist nicht aktiv" endet statt als eine falsche Aktion.
