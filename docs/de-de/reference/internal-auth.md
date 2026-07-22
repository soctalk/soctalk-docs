# Interne Authentifizierung

## 1. Geltungsbereich

Fügt einen eigenständigen Anmeldepfad für die First-Party-UIs von SocTalk
hinzu, damit Betreiber ohne einen vorgeschalteten OIDC-Proxy arbeiten
können. Die bestehende Autorisierung (Rollen, `tenant_id`, Dekoratoren in
`src/soctalk/core/tenancy/decorators.py:120`, Postgres RLS) bleibt
unverändert. Diese Spezifikation fügt lediglich eine neue Identitätsquelle
hinzu, die dieselbe `UserIdentity`-Struktur erzeugt, die bereits in
`src/soctalk/core/tenancy/auth.py:67` konsumiert wird.

Zwei Modi, ausgewählt beim Prozessstart und über `/health/live` und `/health/ready` ausgewiesen:

```
SOCTALK_AUTH_MODE = internal | proxy
```

- `internal` (Standard für Neuinstallationen): SocTalk verwaltet Anmeldung,
  Sitzungen und Passwortspeicherung. Die Ingress-Handoff-Middleware ist
  deaktiviert.
- `proxy`: bewahrt das bestehende Ingress-Handoff-Verhalten. Interne
  Endpunkte antworten mit 404.

Kein Hybridmodus. Föderation (JIT-Provisionierung, OIDC SP usw.) ist eine
eigene Spezifikation.

## 2. Datenmodell

Zwei neue Tabellen. Alles andere verwendet bestehende Modelle wieder.

### `password_credentials`

| column               | type        | notes                                       |
| ---                  | ---         | ---                                         |
| user_id              | uuid PK, FK | verweist auf `users.id`, on-delete cascade  |
| password_hash        | text NOT NULL | argon2id, vollständiger Hash-String mit Parametern |
| must_change          | bool        | vom Admin-Reset gesetzt                     |
| updated_at           | timestamptz |                                             |
| last_used_at         | timestamptz | letzte erfolgreiche Anmeldung               |
| consecutive_failures | int         | bei Erfolg zurückgesetzt                    |
| locked_until         | timestamptz | null, sofern keine Sperre aktiv ist         |

### `sessions`

DB-gestützte Sitzungen. Das Cookie trägt eine opake session_id; die
DB-Zeile ist die Quelle der Wahrheit.

| column          | type        | notes                                |
| ---             | ---         | ---                                  |
| id              | uuid PK     | zugleich der Cookie-Wert             |
| user_id         | uuid FK     |                                      |
| tenant_context  | uuid        | `current_tenant` bei der Anmeldung erfasst |
| created_at      | timestamptz |                                      |
| last_seen_at    | timestamptz | gedrosselt aktualisiert (~60s)       |
| absolute_expiry | timestamptz | harte Obergrenze, 12h                |
| idle_expiry     | timestamptz | gleitet bei Aktivität, 30m           |
| revoked_at      | timestamptz | ungleich null deaktiviert die Sitzung |
| ip_created      | inet        | Beobachtbarkeit                      |
| user_agent      | text        | Beobachtbarkeit                      |

Index: `(user_id, revoked_at)`.

### Wiederverwendung

- `users` (`src/soctalk/core/tenancy/models.py:156`), unverändert.
- `audit_log` (`src/soctalk/core/tenancy/models.py:291`), erhält
  `auth.*`-Aktionen (siehe §9).

Keine neue Audit-Tabelle. Keine Signierschlüssel-Tabelle (Sitzungen sind
opake DB-Zeilen, keine JWTs; die bestehende HMAC-Signierung in
`src/soctalk/core/tenancy/auth.py:167` ist davon unabhängig).

## 3. Endpunkte

Alle unter `/api/auth/*`. JSON. Zustandsändernde Routen gemäß §6 geschützt.

| method | path                                          | purpose                                |
| ---    | ---                                           | ---                                    |
| POST   | `/api/auth/login`                             | E-Mail + Passwort, setzt Sitzungscookie |
| POST   | `/api/auth/logout`                            | widerruft die aktuelle Sitzung         |
| GET    | `/api/auth/me`                                | aktuelle Identitäts-Payload + Rollen-`permissions[]` |
| POST   | `/api/auth/password/change`                   | alt + neu, authentifiziert             |
| POST   | `/api/mssp/users/{id}/password/reset`         | erzwungener Admin-Reset, setzt `must_change` |

`/api/auth/me` gibt die Identität plus eine berechnete `permissions[]`-Liste zurück, die Capabilities, die die angemeldete Rolle hält, abgeleitet aus der Single-Source-of-Truth-Rollen-zu-Berechtigungs-Map. Das Frontend gated Navigation und Aktionen anhand dieser Berechtigungen, statt sie aus dem Rollen-String abzuleiten.

Der Admin-Reset-Endpunkt erzeugt serverseitig ein starkes zufälliges
Passwort und gibt es einmalig im Antworttext zurück; der Admin übergibt es
dem Benutzer out-of-band. Ein Self-Service-Reset per E-Mail ist zurückgestellt (§12).

In `AUTH_MODE=proxy` antwortet jeder Endpunkt in dieser Tabelle mit 404.

## 4. Cookie und Sitzung

### Cookie

Name: `soctalk_session`.

Attribute:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- `Domain` weggelassen (host-only)
- `Max-Age` entspricht dem `absolute_expiry` der Sitzung

Wert: url-safe base64 der Sitzungs-UUID. Keine Claims im Cookie.

### Lebenszyklus

- `absolute_expiry = created_at + 12h`. Harte Obergrenze.
- `idle_expiry = last_seen_at + 30m`. Gleitet bei Aktivität vorwärts.
- Bei Passwortänderung: alle anderen Sitzungen des Benutzers werden
  widerrufen; die Sitzung, die die Änderung vorgenommen hat, bleibt
  erhalten, damit der Benutzer auf seinem aktuellen Gerät angemeldet bleibt.
- `/api/auth/logout` widerruft nur die aktuelle Sitzung.
- Der Admin-Reset widerruft alle Sitzungen des Zielbenutzers.

## 5. Passwortrichtlinie

- argon2id über `argon2-cffi`.
- Parameter: `time_cost=3`, `memory_cost=65536` (64 MiB),
  `parallelism=4`, `hash_len=32`, `salt_len=16`.
- Der gespeicherte Hash-String enthält seine Parameter; verifiziere und
  rehashe transparent, wenn die Parameter abweichen.
- Mindestlänge: 12. Keine Zusammensetzungsregeln.
- Sperre: 10 aufeinanderfolgende Fehlversuche innerhalb von 15 min setzen `locked_until = now() + 15m`. Der Zähler wird bei erfolgreicher Anmeldung zurückgesetzt.
- `must_change`: vom Admin-Reset gesetzt. Zwingt den Benutzer durch den
  Passwortänderungs-Flow, bevor irgendein anderer Endpunkt erreichbar ist.

## 6. CSRF

`SameSite=Lax` auf dem Sitzungscookie blockiert bereits siteübergreifende
POSTs. Für zustandsändernde Methoden (`POST`, `PATCH`, `DELETE`, `PUT`)
erzwingt die Middleware zusätzlich:

- Wenn `Origin` vorhanden ist, muss es mit einem der konfigurierten
  First-Party-Origins übereinstimmen. Die Konfiguration ist eine
  Liste/ein Muster, kein einzelner Wert, denn Installationen bedienen
  sowohl den MSSP-Host (`mssp.example.com`) als auch einen
  Wildcard-Kundenhost pro Mandant (`*.customers.example.com`). Ein
  Anheften an eine einzige Origin würde jeden POST von derjenigen UI, die
  nicht die angeheftete ist, mit 403 abweisen.
- Andernfalls, wenn `Referer` vorhanden ist, muss dessen
  Origin-Komponente mit derselben Allow-List übereinstimmen.
- Andernfalls mit 403 ablehnen.

Die Allow-List leitet sich aus den konfigurierten UI-Hostnamen in den
Chart-Werten (`ingress.hostnames.mssp`, `ingress.hostnames.customer`) ab,
sodass Betreiber sie nicht separat pflegen müssen.

## 7. Middleware

Neue Middleware `internal_session_middleware` ersetzt
`ingress_handoff_middleware`, wenn `SOCTALK_AUTH_MODE=internal`.

Pro Anfrage:

1. Lies das `soctalk_session`-Cookie.
2. Schlage die Sitzungszeile nach. Weise ab, wenn sie fehlt, widerrufen
   ist, `absolute_expiry` überschritten hat oder `idle_expiry`
   überschritten hat.
3. Aktualisiere `last_seen_at` (gedrosselt, schreibe höchstens alle 60s).
4. Lade den Benutzer und konstruiere dieselbe `UserIdentity`-Struktur, die
   der Pfad erzeugt. Setze `request.state.user_identity` genau wie heute,
   sodass Dekoratoren und RLS-Kontext-Helfer unverändert bleiben.

Ratenbegrenzung: Anmeldeversuche pro IP und pro E-Mail je 15 Minuten,
angewandt vor der DB-Abfrage. In-Process-Zähler für die Beta; austauschen
gegen Redis, wenn wir horizontale Skalierung benötigen.

## 8. UI/UX

Zwei First-Party-UIs erhalten Auth-Funktionen: die MSSP-Konsole
(`frontend/mssp`) und das Kundenportal (`frontend/customer`). Beides sind
SvelteKit-Apps, die mit derselben API sprechen.

### Anmeldeseite

Beide Apps erhalten `/login`:

- Zentrierte Karte. Zwei Felder (E-Mail, Passwort). Eine einzige primäre
  Schaltfläche mit der Beschriftung „Sign in.“
- Das Kundenportal liest App-Name und Logo aus der `BrandingConfig` des
  Mandanten, damit sich die Seite nativ für die Marke des MSSP anfühlt.
  Die MSSP-Konsole verwendet das Standard-Branding auf Installationsebene.
- Anfänglicher Fokus auf E-Mail. Enter sendet ab. Standard-Feldnamen,
  damit Browser-Passwortmanager sauber automatisch ausfüllen.
- Fehlerzustände (keine Benutzerenumeration):
  - Ungültige Anmeldedaten → „Email or password is incorrect.“
  - Gesperrtes Konto → „This account is temporarily locked. Try again at
    {unlock_time}.“
  - Serverfehler → „Something went wrong. Try again.“
- Kleine Hilfszeile darunter: „Contact your administrator if you've
  lost access.“ Kein Self-Service-Reset-Link in dieser Spezifikation.

### Erzwungene Änderung (`must_change`)

Wenn die Anmeldung gegen eine Anmeldeinformation mit `must_change=true`
erfolgreich ist, signalisiert die Serverantwort die Änderung als nächsten
Schritt. Die UI navigiert direkt zu `/account/password`: kein
Dashboard-Aufblitzen.

Solange `must_change` gesetzt ist, leitet jede Route außer
`/account/password` und `POST /api/auth/logout` zurück auf
`/account/password`. Ein kleines gelbes Banner lautet „Your administrator
requires you to set a new password before continuing.“

### Passwortänderungsseite

`/account/password`:

- Drei Felder: aktuelles Passwort, neues Passwort, neues Passwort
  bestätigen.
- Inline-Validator nur für die Regel ≥12 Länge. Kein
  Zusammensetzungs-Messgerät.
- Bei Erfolg eine Bestätigung und den Hinweis „Other devices have
  been signed out. You're still signed in here.“ anzeigen.
- Erreichbar über das Kontomenü und obligatorisch während `must_change`.

### Kontomenü

Im Header beider Apps, sichtbar bei Authentifizierung:

- Benutzer-E-Mail.
- Rollenbezeichnung („MSSP admin“, „Analyst“, „Customer viewer“ usw.).
- Link zu „Change password.“
- „Sign out“, `POST /api/auth/logout`, dann Navigation zu `/login` mit
  der Flash-Meldung „You have been signed out.“

### Admin-Reset (MSSP-Konsole)

Auf der Benutzerdetailseite in der MSSP-Konsole:

- Schaltfläche „Reset password“, berechtigungsgesteuert für
  `platform_admin` und `mssp_admin`.
- Der Bestätigungsdialog erklärt: „Generates a one-time password, revokes
  all of this user's active sessions, and forces them to change it at
  next login.“
- Bei Bestätigung gibt der Server das erzeugte Passwort einmalig zurück.
  Die UI stellt es in einem In-die-Zwischenablage-kopieren-Feld mit „Copy
  and close“ dar. Nachdem der Dialog geschlossen wurde, ist das Passwort
  nicht mehr abrufbar, der Admin teilt es out-of-band.

### Sitzungsablauf

- Bei jedem 401, das an eine authentifizierte Sitzung zurückgegeben wird,
  navigiert die SPA zu `/login?expired=1&next=<current-url>`.
- Die Anmeldeseite liest `expired=1` und zeigt „Your session expired.
  Please sign in again.“ Absoluter vs. Leerlauf-Ablauf wird in der UI
  nicht unterschieden.
- Nach erfolgreicher Anmeldung navigiert die SPA zu `next`, sofern
  vorhanden und same-origin; andernfalls zur Standard-Landing-Route für
  diese UI.

### Leer- und Fehlerzustände

- Erster Aufruf ohne Sitzung → Weiterleitung zu `/login` (kein Flash).
- Anmeldeseite bei bereits authentifiziertem Zustand → Weiterleitung zur
  Standard-Landing-Route (den Benutzer nicht auf einem Formular
  stranden lassen, das er nicht braucht).
- Netzwerkfehler während der Anmeldung → das Formular beibehalten, inline
  „Couldn't reach the server. Check your connection and try again.“
  anzeigen.

### Barrierefreiheit

- Alle Eingabefelder haben zugeordnete `<label>`-Elemente. Fehler nutzen
  `role="alert"`, damit Screenreader sie ankündigen.
- Die Fokusreihenfolge ist natürlich (E-Mail → Passwort → Absenden).
- Kein CAPTCHA. Sperre plus IP-/E-Mail-Ratenbegrenzung decken Missbrauch
  im MSSP-Maßstab ab; CAPTCHA unterbricht den Screenreader-Fluss und
  verursacht Betriebsaufwand.
- Minimales Touch-Ziel 44×44px für die primäre Aktion auf Mobilgeräten.

## 9. Audit

Gib die folgenden `action`-Werte in das bestehende `audit_log` aus:

- `auth.login.success`
- `auth.login.failure` (`details.reason` in `{bad_password, unknown_email, locked}`)
- `auth.logout`
- `auth.password.changed`
- `auth.password.reset.admin` (admin-ausgelöster Reset eines anderen Benutzers)
- `auth.lockout.triggered`

`actor_id` ist die ID des handelnden Benutzers oder `system:auth` für
Sperrauslöser. `tenant_id` wird vom handelnden Benutzer kopiert.

## 10. Migration von `proxy` zu `internal`

1. Wende die Migration an, die §2.1 und §2.2 erstellt. Bestehende
   `users`-Zeilen sind nicht betroffen.
2. Deploye die neue App-Version. `SOCTALK_AUTH_MODE=proxy` bewahrt das
   bestehende Verhalten.
3. Für jeden Benutzer, der die interne Anmeldung nutzen soll, führt der
   Betreiber `soctalk auth set-password <email>` aus (neues CLI; schreibt
   eine `password_credentials`-Zeile und gibt `auth.password.reset.admin`
   aus).
4. Der Betreiber schaltet `SOCTALK_AUTH_MODE=internal` um und startet neu.
   Die Ingress-Handoff-Middleware wird aus der Pipeline entfernt.

Rollback: das Flag zurückschalten und neu starten.

## 11. Tests

Verpflichtende Backend-Suite (Stil postgres-rls §9):

1. Der Happy Path der Anmeldung erstellt eine Sitzungszeile mit dem
   richtigen `tenant_context` und setzt das Cookie.
2. Ein falsches Passwort erhöht `consecutive_failures`; zehn
   aufeinanderfolgende lösen `locked_until` aus; weitere Versuche werden
   selbst mit dem richtigen Passwort abgewiesen.
3. `must_change` blockiert jeden Nicht-Passwort-Endpunkt bis zu einer
   erfolgreichen Änderung.
4. Die Passwortänderung widerruft alle anderen Sitzungen des Benutzers,
   bewahrt aber die aktuelle.
5. Das Abmelden widerruft nur die aktuelle Sitzung.
6. Der Admin-Reset widerruft alle Sitzungen des Zielbenutzers und erzwingt
   `must_change`.
7. `AUTH_MODE=proxy`: `/api/auth/*` und der Admin-Reset-Endpunkt geben
   404 zurück. Der Ingress-Handoff-Pfad funktioniert weiterhin.
8. CSRF: eine zustandsändernde Anfrage mit einem fremden `Origin` wird mit
   403 abgewiesen.
9. Eine Sitzung nach `absolute_expiry` oder `idle_expiry` wird abgewiesen;
   die Zeile wird nicht automatisch gelöscht (für Audit aufbewahrt).

Playwright-Smoke-Suite für jede UI:

1. Anmeldung mit gültigen Anmeldedaten landet auf der Standardroute und
   zeigt das Kontomenü.
2. Anmeldung mit falschen Anmeldedaten zeigt den generischen Fehler ohne
   Enumeration.
3. `must_change` bei der Anmeldung landet auf der Änderungsseite und kann
   nicht anderswohin navigieren.
4. Die Passwortänderung gelingt und die Anmeldung bleibt bestehen.
5. Der Admin-Reset-Dialog zeigt das erzeugte Passwort einmalig; das
   Schließen des Dialogs blendet es aus.
6. Eine abgelaufene Sitzung auf einer geschützten Route leitet zu
   `/login?expired=1` mit dem Flash und bewahrt `next`.

## 12. Zurückgestellt

Nicht Teil dieser Spezifikation. Sortiert nach wahrscheinlicher
Wiederaufnahme:

1. `password_reset_tokens`: Self-Service-Passwort-Reset per E-Mail.
2. MFA (TOTP + Wiederherstellungscodes), mit entsprechenden UI-Schritten in
   den Anmelde- und Konto-Flows.
3. Sitzungsinventar (`GET /api/auth/sessions`, gezielt widerrufen,
   Logout-all) mit einem „Devices“-Panel auf der Kontoseite.
4. Identitätsübernahme (mssp_admin → Mandantenbenutzer-Sitzungen), mit
   einem deutlichen Banner in der UI während der Übernahme.
5. OIDC SP / Föderation (eigene Spezifikation).
6. OIDC-Issuer (eigene Spezifikation; nur wenn ein konkreter Konsument
   auftritt).
7. Signierschlüssel-Rotation + JWKS (nur erforderlich, sobald wir
   zustandslose Tokens extern ausstellen).
