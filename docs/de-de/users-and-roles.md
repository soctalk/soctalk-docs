# Benutzer und Rollen

Wie Rollen funktionieren, wer was tun darf und wie Administratoren Benutzer anlegen, das Kundenportal freigeben und Passwörter rotieren. Eine bebilderte Schritt-für-Schritt-Anleitung zur Bereitstellung und zum Benutzerlebenszyklus findest du unter [Benutzer verwalten: eine Anleitung](/de-de/manage-users). Siehe [Internal Auth](/de-de/reference/internal-auth) für die Referenz auf Protokollebene und [Sicherheitsmodell](/de-de/reference/security-model) für die Matrix „Rolle nach Ressource".

## Wie der Zugriff entschieden wird

Der Zugriff wird auf ein Capability-Modell umgestellt. Jede Rolle ist ein benanntes Bündel von Capabilities, und die dafür gebauten oder überarbeiteten Oberflächen (der Bearbeitungs- und Prüfungsablauf, Chat, Mandanten-Self-Service für Engagements, Autorisierungsfakten und Benutzer) fragen nach der Capability, die sie benötigen, statt nach einer bestimmten Rolle. Auf diesen Routen ist das Hinzufügen einer Rolle lediglich eine Frage der Definition ihres Bündels; die Aufrufstellen ändern sich nicht. Andere Routen prüfen weiterhin direkt gegen Rolle oder Zielgruppe, darunter die MSSP-Mandantenverwaltung, die LLM- und Branding-Konfiguration, das administrative Zurücksetzen von Passwörtern sowie mehrere Dashboard-, Analyse- und Untersuchungsrouten. Diese werden bei Rollenänderungen von Hand aktualisiert. Betrachte den Capability-basierten Zugriff als die Richtung, nicht als heute überall gültig.

Rollen sind in Stufen organisiert, und dieselben Betriebsstufen existieren auf beiden Seiten des Geschäfts:

- **operate**: die Warteschlange abarbeiten. Untersuchungen ansehen und triagieren, die Verdicts der AI prüfen, entscheiden, Standard-Blast-Vorschläge genehmigen, Chat nutzen.
- **authorize risk**: alles, was operate kann, plus Pentest-Engagements deklarieren, Autorisierungsfakten kuratieren und High-Blast-Aktionen abzeichnen, die in ein externes System schreiben.
- **configure**: alles, was der Manager kann, plus die Einstellungen, die diese Rolle steuert, und die Benutzerverwaltung.

Eine höhere Stufe hält jede Capability der darunterliegenden Stufe. Die Mandantenseite fügt unterhalb von operate eine weitere Stufe hinzu, einen schreibgeschützten Stakeholder (`customer_viewer`), der sehen, aber nicht handeln kann; die MSSP-Seite hat kein Äquivalent, da ihre niedrigste Rolle (`analyst`) bereits operativ tätig ist.

Die Zielgruppe ist eine separate Trennwand über den Stufen. MSSP-Rollen halten nur MSSP-Capabilities und Mandantenrollen nur Mandanten-Capabilities; die beiden Mengen überschneiden sich nie. Ein Capability-Guard prüft Capability und Zielgruppe gemeinsam, sodass eine MSSP-Capability niemals eine Mandantenroute erfüllen kann und umgekehrt. Deshalb hält beispielsweise `platform_admin` jede MSSP-Capability, aber keine der Mandanten-Capabilities.

## Rollenkatalog

**MSSP-Seite** (Personal des Anbieters; `tenant_id` ist null):

| Rolle | Stufe | Kann |
|---|---|---|
| `platform_admin` | configure (super) | Jede MSSP-Capability, installationsweit. |
| `mssp_admin` | configure | Das System konfigurieren, Benutzer verwalten, plus alles darunter. |
| `mssp_manager` | authorize risk | Engagements deklarieren, Autorisierungsfakten kuratieren, High-Blast-Aktionen abzeichnen, plus operate. |
| `analyst` | operate | Untersuchungen triagieren, Verdicts prüfen, entscheiden, chatten. Arbeitet jeweils an einem Kunden, indem ein Mandant angeheftet wird (siehe Impersonation weiter unten); schreibgeschützt bei Einstellungen. |

**Mandantenseite** (Personal eines Kunden; `tenant_id` gesetzt; auf diesen einen Mandanten beschränkt):

| Rolle | Stufe | Kann |
|---|---|---|
| `tenant_admin` | configure | Die Benutzer und LLM-Einstellungen der eigenen Organisation verwalten, plus alles darunter. Wird während des Mandanten-Onboardings durch den `_mint_tenant_admin_user`-Ablauf der Laufzeitumgebung automatisch bereitgestellt. |
| `tenant_manager` | authorize risk | Eigene Pentest-Engagements deklarieren, Autorisierungsfakten geltend machen (die zur MSSP-Prüfung eingehen, bevor sie wirksam werden), High-Blast-Aktionen abzeichnen, plus operate. |
| `tenant_analyst` | operate | Den SOC des eigenen Mandanten betreiben: triagieren, Verdicts prüfen, entscheiden, Standard-Blast-Vorschläge genehmigen, chatten. Dies ist die Co-Managed-SOC-Rolle, das mandantenseitige Gegenstück zu `analyst`. |
| `customer_viewer` | view only | Schreibgeschützter Stakeholder. Sieht das eigene SOC-Dashboard und die Untersuchungen des Kunden, kann aber nicht darauf handeln und kann die Prüfungs-Warteschlange nicht öffnen. |

Die „configure"-Stufe von `tenant_admin` ist eng gefasst: gegenüber dem Manager fügt sie die LLM-Konfiguration und Benutzerverwaltung der eigenen Organisation hinzu, und sonst nichts. Branding und Integrationen bleiben auf der MSSP-Seite.

Der initiale Administrator wird inline durch den Init-Befehl des API-Pods erstellt (gesteuert durch `install.bootstrapAdmin.email` und `install.bootstrapAdmin.password` in den Chart-Werten) als `mssp_admin` mit `must_change=false`. Der [Einrichtungsassistent](/de-de/setup-wizard) befüllt diese Werte während des ersten Bootvorgangs.

## Die Trennung zwischen customer-viewer und tenant-analyst

`customer_viewer` und `tenant_analyst` sind beide mandantenseitig, aber sie sind unterschiedliche Aufgaben. `customer_viewer` beobachtet: Dashboards und Untersuchungsstatus, mehr nicht. Er kann keine Prüfungen entscheiden, keinen Chat nutzen und die Warteschlange der ausstehenden Prüfungen nicht auflisten. `tenant_analyst` ist operativ tätig: Er betreibt den eigenen SOC des Kunden auf den Warnungen des eigenen Mandanten. Gib Viewer an Personen, die Sichtbarkeit benötigen, und Analysten an Personen, die die Arbeit erledigen.

Die Warteschlange der ausstehenden Prüfungen ist entsprechend abgesichert. Das Auflisten oder Öffnen einer Prüfung erfordert Prüfungsbefugnis, die vom MSSP-`analyst` aufwärts und von `tenant_analyst` aufwärts gehalten wird. Ein Mandantenoperator sieht nur die Warteschlange des eigenen Mandanten. Mandantenübergreifende Prüfungszugriffe sind auf `platform_admin`, `mssp_admin` und `mssp_manager` beschränkt; ein MSSP-`analyst` liest die Warteschlange eines Mandanten, sobald er an diesen angeheftet ist.

## Mandantenbenutzer anlegen

Ein `tenant_admin` stellt die Logins der eigenen Organisation bereit. Genau das macht die Mandantenrollen nutzbar; ohne dies hätte ein Mandant nur den einzelnen beim Onboarding erstellten Administrator.

Öffne in der Kunden-UI **Users** in der Seitenleiste (nur für `tenant_admin` sichtbar), dann **Add user**: gib eine E-Mail-Adresse ein, wähle eine Rolle und sende ab. Das Panel gibt ein einmaliges temporäres Passwort zurück. Kopiere es und übergib es dem Benutzer auf einem anderen Kanal; es wird einmal angezeigt und ist niemals im Klartext abrufbar. Der Benutzer wird beim ersten Anmelden aufgefordert, es zu ändern.

Dasselbe ist über die API verfügbar:

```bash
curl -X POST 'https://<customer-host>/api/tenant/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@customer.example","role":"tenant_analyst"}'
```

Hinweise:

- Die zuweisbaren Rollen sind `customer_viewer`, `tenant_analyst`, `tenant_manager` und `tenant_admin`. Eine MSSP-Rolle kann hier nicht zugewiesen werden; die Anfrage wird abgelehnt. Dies ist die Zielgruppen-Trennwand.
- Der neue Benutzer wird immer im eigenen Mandanten des Aufrufers platziert. Der Mandant wird aus der Sitzung des Aufrufers übernommen, niemals aus dem Anfragetext, und die Datenbank erzwingt dies, sodass ein Mandantenadministrator nur jemals Benutzer im eigenen Mandanten anlegen kann.
- Eine doppelte E-Mail-Adresse wird abgelehnt. E-Mail-Adressen sind über die gesamte Installation hinweg eindeutig.
- `GET /api/tenant/users` listet die eigenen Benutzer des Mandanten auf. Beide Endpoints erfordern die Capability `tenant_manage_users`, die nur `tenant_admin` hält.

Das Kundenportal ist unter einem mandantenspezifischen Host erreichbar. Der feste Hostname stammt aus `ingress.hostnames.customer` in den Chart-Werten, und slug-gesteuerte mandantenspezifische Hosts stammen aus `ingress.tenantWildcard`. Siehe die [Installationsdokumentation](/de-de/install) für das Hostnamen-Layout.

## MSSP-Personalbenutzer anlegen

Ein `mssp_admin` oder `platform_admin` stellt Logins für MSSP-Personal über das Panel **Staff Users** in der [MSSP-UI](/de-de/mssp-ui) oder über die API bereit. Die Struktur spiegelt die Mandantenseite wider.

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@your-mssp.example","role":"analyst"}'
```

Hinweise:

- Die zuweisbaren Rollen sind `analyst`, `mssp_manager`, `mssp_admin` und `platform_admin`. Eine Mandantenrolle kann hier nicht zugewiesen werden (die Zielgruppen-Trennwand). Das Zuweisen von `platform_admin` ist nur erlaubt, wenn der Aufrufer bereits ein `platform_admin` ist.
- Der neue Benutzer ist MSSP-seitig (`tenant_id` ist null). Diese Endpoints operieren immer nur auf MSSP-Personalzeilen, sodass ein Mandantenbenutzer niemals über sie erreicht werden kann.
- Die Antwort trägt ein einmaliges temporäres Passwort; der Benutzer ändert es beim ersten Anmelden. Eine doppelte E-Mail-Adresse wird abgelehnt.
- `GET /api/mssp/users` listet das Personal auf. All dies erfordert die Capability `manage_users`, die nur von `mssp_admin` und `platform_admin` gehalten wird.

`soctalk-auth set-password` (das CLI) existiert weiterhin für den Bootstrap- und Offline-Fall: Es setzt ein Passwort für einen bestehenden Benutzer, löscht `must_change` und auditiert die Änderung, erstellt aber die Benutzerzeile nicht und widerruft keine Sitzungen.

## Rolle ändern, deaktivieren, reaktivieren

Beide Seiten bieten denselben Lebenszyklus. Auf der Mandantenseite verwaltet ein `tenant_admin` die eigene Organisation; auf der MSSP-Seite verwaltet ein `mssp_admin`/`platform_admin` das Personal.

- **Rolle ändern**: wähle eine neue Rolle aus dem Selektor der Zeile aus, oder `PATCH /api/tenant/users/{id}` (bzw. `/api/mssp/users/{id}`) mit `{"role": "..."}`. Eine Rollenänderung widerruft die aktiven Sitzungen des Benutzers, sodass die neue Rolle sofort wirksam wird.
- **Deaktivieren**: die Schaltfläche „Deactivate" der Zeile, oder `POST .../{id}/deactivate`. Der Benutzer wird auf inaktiv gesetzt und jede aktive Sitzung wird auf einmal widerrufen, sodass ein bereits angemeldeter Benutzer abgeschnitten wird, statt bis zum Ablauf zu verweilen. Die Sitzungs-Middleware verweigert einen inaktiven Benutzer ebenfalls, was das Wettrennen mit einer gleichzeitigen Anmeldung schließt.
- **Reaktivieren**: die Schaltfläche „Reactivate" der Zeile, oder `PATCH .../{id}` mit `{"active": true}`.

Zwei Guards gelten für jede Änderung:

- Du kannst dein eigenes Konto nicht ändern (keine Selbstherabstufung und keine Selbstaussperrung).
- Du kannst den letzten aktiven Administrator nicht entfernen: die Änderung, die einen Mandanten ohne aktiven `tenant_admin` oder die Installation ohne aktiven `mssp_admin`/`platform_admin` (oder ohne aktiven `platform_admin`, wenn einer existiert) zurücklassen würde, wird verweigert. Die Prüfung sperrt die Kandidatenzeilen, sodass gleichzeitige Herabstufungen nicht beide durchschlüpfen können.

Ein bestehendes `platform_admin`-Konto kann nur von einem anderen `platform_admin` geändert, deaktiviert oder mit einem Passwort-Reset versehen werden.

## Passwort zurücksetzen

**Self-Service**: in diesem Release nicht implementiert. Es gibt keinen Passwort-vergessen-Ablauf und keine E-Mail-Zustellung auf der Anmeldeseite. Benutzer bitten einen Administrator um ein Zurücksetzen.

**Administrativ erzwungen**: ein `mssp_admin` oder `platform_admin` setzt das Passwort jedes Benutzers per ID zurück:

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

Das Ziel kann ein MSSP-Benutzer oder ein Mandantenbenutzer sein; der Akteur muss `mssp_admin` oder `platform_admin` sein. Die Antwort enthält ein neues `temporary_password`, markiert mit `must_change=true`, und das Zurücksetzen widerruft alle bestehenden Sitzungen dieses Benutzers. Teile das Passwort mit; der Benutzer wählt beim ersten Anmelden ein neues.

Es gibt keine mandantenseitige Reset-Aktion, sodass ein `tenant_admin` das Passwort eines seiner eigenen Benutzer nicht über die UI zurücksetzen kann. Bis das ausgeliefert wird, setzt ein MSSP-Administrator es mit dem obigen Endpoint zurück, oder ein Operator setzt es an der Datenbankzeile zurück.

## Impersonation und Mandantenkontext-Wechsel

MSSP-seitige Benutzer (`platform_admin`, `mssp_admin`, `mssp_manager`, `analyst`) können ihre Sitzung über `POST /api/auth/assume-tenant` auf einen bestimmten Mandanten beschränken. Mandantenseitige Benutzer können das nicht; sie sind bereits auf ihren eigenen Mandanten festgelegt. Die UI zeigt dies als Chip **Tenant: \<name\>** oben rechts in der [MSSP-UI](/de-de/mssp-ui) an: das Anklicken eines Mandanten heftet die Sitzung an die Ansicht dieses Kunden an, und **Clear** kehrt zum mandantenübergreifenden Bereich zurück. Zustandsändernde Aktionen, die während dieses Bereichs vorgenommen werden, laufen als der ursprüngliche Benutzer, wobei die Sitzung an diesen Mandanten gebunden ist.

Dies ist keine Impersonation eines anderen Benutzers; die Sitzungsidentität bleibt dieselbe. Eine Oberfläche zum „Übernehmen der Sitzung eines bestimmten Benutzers" ist geplant.

## Sitzungen

| Sitzungsspeicher | Cookie-Name | Lebensdauer |
|---|---|---|
| MSSP-UI-Sitzung | `soctalk_session` | 12 h absolut + 30 min Leerlauf |
| Kundenportal-Sitzung | `soctalk_session` | 12 h absolut + 30 min Leerlauf |
| Assistenten-Sitzung | `soctalk_session` | bis der Assistent beendet wird |

`POST /api/auth/logout` widerruft nur die aktuelle Sitzung. Das Deaktivieren eines Mandantenbenutzers und das Zurücksetzen des Passworts eines beliebigen Benutzers widerrufen alle Sitzungen dieses Benutzers. Um jede Sitzung eines MSSP-Benutzers ohne ein Passwort-Reset zu widerrufen, setze `revoked_at` direkt auf dessen `sessions`-Zeilen in Postgres; dafür gibt es noch keine Admin-API. Das Rotieren des JWT-Signierschlüssels widerruft keine DB-gestützten Cookie-Sitzungen; die Suche erfolgt über die DB-Zeile, nicht über die JWT-Signatur.

Ein schreibgeschütztes Sitzungsinventar (`GET /api/auth/sessions`) ist geplant.

## SSO / Proxy-Authentifizierung

Die Laufzeitumgebung unterstützt `SOCTALK_AUTH_MODE=proxy`, bei dem SocTalk einem vorgelagerten OIDC-Proxy (OAuth2-Proxy, Keycloak, Dex) vertraut, um die Anfrage zu authentifizieren. Die Identität wird aus dem Header `X-Forwarded-Email` aufgelöst und per E-Mail-Adresse mit einer bestehenden Benutzerzeile abgeglichen. Der Auth-Modus selbst ist heute nicht als Chart-Werte-Stellknopf verfügbar; setze die Umgebungsvariable nach der Installation direkt auf dem `soctalk-system-api`-Deployment. Vertrauenswürdige Proxy-CIDRs sind über `oidc.trustedProxyCIDRs` chart-gestützt.

Im Proxy-Modus wird der passwortbasierte Auth-Router überhaupt nicht eingehängt, sodass `/api/auth/login`, `/api/auth/password/change`, das administrative Passwort-Reset sowie auch `/api/auth/me`, `/api/auth/logout` und `/api/auth/assume-tenant` fehlen. Der Bootstrap-Init des Charts setzt weiterhin die Organization-Zeile und, falls `install.bootstrapAdmin.password` gesetzt ist, den `mssp_admin`-Benutzer auf. Setze `bootstrapAdmin` auch im Proxy-Modus weiterhin: Eine Just-in-Time-Benutzerbereitstellung bei der ersten authentifizierten Anfrage ist nicht implementiert, sodass ohne einen aufgesetzten Benutzer, der per E-Mail-Adresse mit deiner IdP-Identität abgeglichen ist, keine proxy-authentifizierte Anfrage auf eine Benutzerzeile aufgelöst werden kann.

Die Rollenzuweisung im Proxy-Modus geschieht bei der Benutzererstellung in der Datenbank. Die Laufzeitumgebung vertraut der weitergeleiteten E-Mail-Adresse für die Identität, liest aber keine Gruppen-Header und befördert nicht automatisch anhand der Gruppenzugehörigkeit. Eine konfigurierbare Zuordnung von IdP-Gruppe zu SocTalk-Rolle ist geplant.

Vollständige Details: [Internal Auth](/de-de/reference/internal-auth).

## Audit

Benutzererstellung, Rollen-/Statusänderungen und Deaktivierung schreiben `user.create`-, `user.update`- und `user.delete`-Zeilen in das Audit-Log (mit Rolle und Aktiv-Status vorher/nachher bei Aktualisierungen), und Passwort-Resets werden ebenfalls auditiert. Beachte, dass die aktuelle `/api/audit`-Ansicht in der UI den Untersuchungs-Ereignisstrom liest, nicht die Tabelle `audit_log`, sodass diese Benutzerverwaltungszeilen direkt in `audit_log` abfragbar sind, aber noch nicht in diesem Bildschirm auftauchen.
