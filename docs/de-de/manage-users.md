# Benutzer verwalten: eine exemplarische Anleitung

Diese Anleitung führt durch die Bereitstellung eines Logins und dessen gesamten Lebenszyklus über die UI, auf beiden Seiten des Geschäfts: MSSP-Personal über das Panel **Staff Users** und die eigenen Mitarbeitenden eines Kunden über das Mandanten-Panel **Users**. Die beiden Panels spiegeln einander, sodass das eine vertraut ist, sobald du das andere gemacht hast. Für das Modell hinter alldem, welche Rollen es gibt und was jede kann, siehe [Benutzer und Rollen](/de-de/users-and-roles); diese Seite ist der Klick-für-Klick-Durchlauf.

Alles hier wird von einem Admin erledigt. Auf der MSSP-Seite ist das ein `mssp_admin` oder `platform_admin`. Auf der Mandanten-Seite ist es der eigene `tenant_admin` des jeweiligen Kunden, der ausschließlich innerhalb seiner Organisation handelt. Keiner kann die Wand zwischen den Zielgruppen überwinden: Ein MSSP-Admin weist niemals eine Mandantenrolle zu, und ein Mandanten-Admin weist niemals eine MSSP-Rolle zu.

## MSSP-Personal bereitstellen

Melde dich als MSSP-Admin an. Das gewünschte Panel ist **Staff Users** in der Seitenleiste, das nur bei einem Konto erscheint, das die Benutzerverwaltung innehat.

![Die SocTalk-Anmeldeseite](/screenshots/iam-mssp-01-login.png)

Öffne **Staff Users** und wähle **+ Add user**. Gib die E-Mail-Adresse der Person, einen optionalen Anzeigenamen ein und wähle die Rolle, die zur Aufgabe passt. Ein Analyst bearbeitet die Warteschlange über Kunden hinweg, ein Manager autorisiert Risiken, und ein Admin konfiguriert das System und verwaltet Benutzer. Die Rollenliste hier enthält nur MSSP-Rollen; eine Mandantenrolle wird nicht angeboten, weil sie von dieser Seite aus nicht zugewiesen werden könnte.

![Hinzufügen eines MSSP-Mitarbeiters mit ausgewählter Rolle](/screenshots/iam-mssp-02-add-user.png)

Das Absenden erstellt das Login und liefert ein einmaliges temporäres Passwort zurück. Kopiere es jetzt und übergib es der Person außerhalb des Systems (out of band), denn es wird nur einmal angezeigt und ist danach niemals im Klartext abrufbar. Die Person wird aufgefordert, es bei der ersten Anmeldung zu ändern. Der neue Benutzer erscheint in der Liste unter dem Formular, aktiv, mit der Rolle, die du vergeben hast.

![Das einmalige temporäre Passwort und der neue Benutzer in der Liste](/screenshots/iam-mssp-03-created.png)

## Eine Rolle ändern

Rollen ändern sich direkt an Ort und Stelle. Wähle eine neue Rolle aus dem Selektor in der Zeile der Person, und sie wird sofort gespeichert. Hier wird der Analyst zum Manager befördert.

Eine Rollenänderung widerruft die aktiven Sitzungen dieses Benutzers, sodass die neue Autorität sofort wirksam wird, statt auf den Ablauf der alten Sitzung zu warten. War die Person angemeldet, führt ihre nächste Anfrage sie zurück durch die Anmeldung.

![Beförderung des Analysten zum Manager über den Zeilenselektor](/screenshots/iam-mssp-04-promoted.png)

## Deaktivieren und Reaktivieren

**Deactivate** in der Zeile schaltet das Konto ab. Der Status kippt und jede aktive Sitzung wird im selben Moment widerrufen, sodass jemand, der bereits angemeldet ist, abgeschnitten wird, statt zu verweilen, bis seine Sitzung altersbedingt abläuft. Die Sitzungsschicht weist ein inaktives Konto außerdem bei jeder Anfrage ab, was die Lücke gegen eine Anmeldung schließt, die zum Zeitpunkt der Deaktivierung gerade in Bearbeitung war.

![Der deaktivierte Benutzer, mit nun angebotenem Reactivate](/screenshots/iam-mssp-05-deactivated.png)

Deaktivierung ist umkehrbar. **Reactivate** in derselben Zeile setzt das Konto wieder aktiv. Es kommt mit der Rolle zurück, die es hatte; nichts von seiner Historie geht verloren.

![Der reaktivierte Benutzer, wieder aktiv](/screenshots/iam-mssp-06-reactivated.png)

## Die Mandanten-Seite, von Anfang bis Ende

Ein `tenant_admin` führt denselben Lebenszyklus für die eigene Organisation aus, über das Panel **Users**. Das ist es, was die Mandantenrollen überhaupt nutzbar macht; ohne es hätte ein Kunde nur den einzelnen Admin, der beim Onboarding des Mandanten erstellt wurde. Oben rechts wird der Mandant angezeigt, in dem du handelst, und jeder Benutzer, den du erstellst, landet in diesem Mandanten. Der Mandant wird aus deiner Sitzung übernommen, niemals aus dem Formular, und die Datenbank erzwingt dies, sodass ein Mandanten-Admin nur jemals Benutzer in seiner eigenen Organisation erstellen kann.

Wähle **+ Add user**, gib eine E-Mail-Adresse und einen optionalen Namen ein und wähle eine Rolle. Zur Auswahl stehen die Mandantenrollen: ein Viewer, der nur zusieht, ein Analyst, der den SOC betreibt, ein Manager, der Risiken autorisiert, und ein Admin. Hier wird ein neuer Analyst für Acme Corp bereitgestellt.

![Hinzufügen eines Mandantenbenutzers über das Kunden-Panel Users](/screenshots/iam-tenant-01-add-user.png)

Wie auf der MSSP-Seite liefert das Erstellen des Benutzers ein einmaliges temporäres Passwort zurück, das außerhalb des Systems (out of band) zu übergeben ist, und der neue Analyst tritt der Liste bei.

![Der erstellte Mandantenbenutzer, mit seinem einmaligen Passwort](/screenshots/iam-tenant-02-created.png)

Rollenänderungen funktionieren genauso. Befördere den Analysten über den Zeilenselektor zum Manager, und die Änderung wird gespeichert und seine Sitzungen werden sofort widerrufen.

![Beförderung des Mandanten-Analysten zum Manager](/screenshots/iam-tenant-03-promoted.png)

Deactivate schaltet das Konto ab und widerruft seine Sitzungen,

![Der deaktivierte Mandantenbenutzer](/screenshots/iam-tenant-04-deactivated.png)

und Reactivate bringt es zurück.

![Der reaktivierte Mandantenbenutzer](/screenshots/iam-tenant-05-reactivated.png)

## Die Schutzmechanismen, die immer gelten

Einige Regeln gelten bei jeder Änderung, auf beiden Seiten, und die UI erzwingt sie, statt sich darauf zu verlassen, dass du sie im Kopf behältst:

- Du kannst dein eigenes Konto nicht ändern. Es gibt keine Selbst-Herabstufung und keine Selbst-Aussperrung.
- Du kannst den letzten aktiven Administrator nicht entfernen. Eine Änderung, die einen Mandanten ohne aktiven `tenant_admin` oder die Installation ohne aktiven `mssp_admin` oder `platform_admin` zurücklassen würde, wird abgelehnt. Die Prüfung sperrt die betroffenen Zeilen, sodass zwei Admins, die sich im selben Moment gegenseitig herabstufen, nicht beide durchschlüpfen können.
- Ein bestehender `platform_admin` kann nur von einem anderen `platform_admin` geändert, deaktiviert oder in seinem Passwort zurückgesetzt werden.

## Ein Passwort zurücksetzen

In dieser Version gibt es keinen Self-Service-Passwort-vergessen-Ablauf. Wenn jemand ausgesperrt ist, setzt ein Admin ihn zurück. Auf der MSSP-Seite setzt ein `mssp_admin` oder `platform_admin` jeden Benutzer zurück, ob MSSP oder Mandant, und das Zurücksetzen liefert ein frisches einmaliges Passwort zurück und widerruft die bestehenden Sitzungen dieses Benutzers. Der genaue Endpoint und der CLI-Fallback für Bootstrap- und Offline-Fälle stehen in [Benutzer und Rollen](/de-de/users-and-roles#password-reset).

## Dasselbe über die API

Jede Aktion oben hat eine API-Entsprechung unter `/api/mssp/users` und `/api/tenant/users`, einschließlich Erstellen, Auflisten, Rollenänderung, Deaktivieren und Reaktivieren. Die Anfrageformate, die jeweils erforderliche Berechtigung sowie die Regeln zu Zielgruppe und Mandanten-Scoping sind in [Benutzer und Rollen](/de-de/users-and-roles#creating-tenant-users) dokumentiert. Die UI ist eine dünne Schicht über diesen Endpoints, sodass du alles, was du anklicken kannst, auch automatisieren kannst.
