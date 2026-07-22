# Sicherheitsmodell

Prinzipal-Katalog, Akteur×Ressource-Matrix, RLS-Policy-Matrix, Postgres-Rollenmodell, Endpunkt-Klassifizierung, Token-Claim-Schemata, Audit-Anforderungen, Secret-Platzierung.

> **V1-Deployment-Hinweis.** Die folgenden Endpunkt-Beispiele (z. B. `/api/mssp/impersonate/:tenant_id`, `/api/mssp/users` POST/list, `/api/mssp/fleet/summary`) sowie mehrere Prinzipal-Einträge (Cloud-Lizenzaussteller; der Impersonation-Akteur) beschreiben die **angestrebte Sicherheitsoberfläche**. Zu den eingebundenen MSSP-Endpunkten gehören: Mandanten-CRUD, Audit (`/api/audit`), Verwaltung von Staff-Benutzern (`/api/mssp/users` create/list/patch/deactivate und `/{id}/password/reset`) sowie `/api/auth/assume-tenant` für das Session-Mandanten-Scoping (keine Benutzer-Impersonation). Die Self-Service-Benutzerverwaltung des Mandanten liegt unter `/api/tenant/users`. Verwende die untenstehenden Matrizen als Design-Absicht; konsultiere die [REST API](/de-de/reference/api) für das, was tatsächlich live ist.

## Prinzipal-Katalog

Acht Prinzipale.

| # | Prinzipal | Kategorie | Scope | Authentifiziert sich über |
|---|---|---|---|---|
| 1 | **User** (Rolle ∈ {platform_admin, mssp_admin, mssp_manager, analyst, tenant_admin, tenant_manager, tenant_analyst, customer_viewer}) | Mensch | Rollen-abgeleitet | Ingress OIDC → SocTalk JWT |
| 2 | **Worker** | SocTalk-Dienst (Hintergrund) | Ein Mandant pro Job | Service-JWT, kurzlebig, vom SocTalk-API bei Dispatch ausgestellt |
| 3 | **System** | SocTalk-Dienst (mandantenübergreifende Ops) | Installationsweit, RLS-Bypass | Code-Pfad-gated; kein JWT |
| 4 | **SocTalk K8s ServiceAccount** | SocTalk-Dienst (K8s-Identität) | Cluster, per Namenskonvention auf `tenant-*` beschränkt | K8s Projected Token |
| 5 | **Tenant adapter** | Data-Plane-Sidecar | Einzelner Mandant, ruft nur das SocTalk-API auf | Adapter-JWT, mandantenbezogen, kurzlebig |
| 6 | **Wazuh agent** | Externer Endpunkt-Agent | Wazuh-Manager eines einzelnen Mandanten | Wazuh-`authd`-Enrollment → mTLS pro Agent |
| 7 | **MSSP cluster admin** | Mensch, out-of-band | Gesamter Cluster (unbegrenzt) | `kubectl`-Anmeldedaten |
| 8 | **Cloud license issuer** | Trust Anchor | Offline-Signaturinstanz | Ed25519-Schlüssel in HSM/KMS (zukünftiges Release) |

### Benutzerrollen

Rollen sind Capability-Bündel, organisiert in drei Ebenen pro Zielgruppe (operate ⊆ authorize-risk ⊆ configure); die Mandantenseite ergänzt darunter einen schreibgeschützten Stakeholder unterhalb von operate. Siehe [Benutzer und Rollen](/de-de/users-and-roles) für das Capability-Modell.

MSSP-seitig (`tenant_id` NULL):

| Rolle | Ebene | Typische Funktion |
|---|---|---|
| `platform_admin` | configure (super) | Jede MSSP-Capability, installationsweit. |
| `mssp_admin` | configure | Das System konfigurieren, Staff-Benutzer verwalten, plus alles darunter. |
| `mssp_manager` | authorize-risk | Engagements deklarieren, Autorisierungsfakten kuratieren, Aktionen mit hohem Blast-Radius abzeichnen, plus operate. |
| `analyst` | operate | Triage, Verdikte prüfen, entscheiden, chatten; bearbeitet einen Mandanten über einen Open-SOC-Pin. |

Mandanten-seitig (`tenant_id` gesetzt):

| Rolle | Ebene | Typische Funktion |
|---|---|---|
| `tenant_admin` | configure | Benutzer der eigenen Organisation und LLM-Einstellungen verwalten, plus alles darunter. |
| `tenant_manager` | authorize-risk | Eigene Engagements deklarieren, Autorisierungsfakten geltend machen (MSSP-geprüft), plus operate. |
| `tenant_analyst` | operate | Den SOC des eigenen Mandanten bearbeiten: Triage, Verdikte prüfen, entscheiden, chatten. |
| `customer_viewer` | nur lesen | Schreibgeschützte Dashboards und Untersuchungen; kann nicht handeln oder die Prüf-Queue öffnen. |

Scope-Ableitung: `role ∈ {platform_admin, mssp_admin, mssp_manager, analyst}` ⇒ `tenant_id` NULL in der DB, mandantenübergreifender Zugriff über eine erhöhte Postgres-Rolle oder Session-Mandanten-Scoping (`/api/auth/assume-tenant`). `role ∈ {tenant_admin, tenant_manager, tenant_analyst, customer_viewer}` ⇒ `tenant_id` erforderlich in der Benutzerzeile und im JWT. MSSP-Capabilities und Mandanten-Capabilities überschneiden sich nie; der Guard auf jeder Route prüft Capability und Zielgruppe gemeinsam.

### Worker-Prinzipal-Disziplin

Jeder Hintergrund-Job muss `tenant_id` in seinem Payload mitführen. Worker-Einstiegspunkte sind mit `@tenant_scoped_worker` dekoriert, was `app.current_tenant_id` vor jedem DB-Zugriff setzt. Worker verbinden sich als Postgres-Rolle `soctalk_app` und unterliegen RLS: Das Vergessen, den Kontext zu setzen, liefert null Zeilen, kein mandantenübergreifendes Leck.

### System-Prinzipal-Disziplin

Mandantenübergreifende Operationen (MSSP-Rollups, Migrationen, Admin-Tooling) verwenden das `System`-Prinzipal über einen `system_context()`-Python-Kontextmanager. Der Eintritt emittiert eine Audit-Zeile. Der Kontextmanager ist das einzige Gate. `import-linter` verhindert dessen Import außerhalb der dafür vorgesehenen System-Module. Das System-Prinzipal verbindet sich als Postgres-Rolle `soctalk_mssp`, die `BYPASSRLS` besitzt.

## Ressourcen-Katalog

### Datenbank-Ressourcen (mandantenbezogen)

Alle haben eine `tenant_id`-FK und unterliegen RLS:

- `Event` — Event-Store, append-only
- `InvestigationReadModel` — projizierter Untersuchungszustand
- `MetricsHourly`, `IOCStats`, `RuleStats`, `AnalyzerStats` — Projektionen pro Mandant
- `PendingReview` — HIL-Queue
- `IntegrationConfig` — Integrations-URLs, Endpunkte, Schwellenwerte pro Mandant
- `BrandingConfig` — App-Name, Logo, Farben pro Mandant
- `TenantSecret` — Referenzen (ns + name + version) auf K8s Secrets; kein Rohmaterial
- `TenantLifecycleEvent` — append-only-Log von Mandanten-Zustandsübergängen, Konfigurationsrevisionen
- `AuditLog` — append-only-Log von Mutationsaktionen, mit `mssp_user_id`, wenn über Impersonation ausgeführt

### Datenbank-Ressourcen (installationsbezogen)

Keine `tenant_id`; Organization-bezogen oder global:

- `Organization` — installationsweit (mssp_id, mssp_name, install_id, install_label, reserviertes license_jwt)
- `User` — sowohl MSSP-seitige Benutzer (nullable tenant_id) als auch Kundenbenutzer (tenant_id erforderlich)
- MSSP-Benutzer-/Mandanten-Benutzer-Semantik abgeleitet aus Rolle + Vorhandensein von tenant_id; eine einzige Tabelle
- `Release` — SocTalk-Versions-Metadaten (installationsweit)
- Installationseinstellungen (Feature-Flags, systemweite Umschalter)

### Kubernetes-Ressourcen

| Ressource | Scope | Verwaltet von |
|---|---|---|
| Namespace `soctalk-system` | Installationsebene | MSSP cluster admin (von Helm erstellt) |
| Namespace `tenant-<slug>` | Pro Mandant | SocTalk K8s ServiceAccount (Cluster-Verben) |
| `Deployment`, `Service`, `PVC`, `Secret`, `ConfigMap`, `NetworkPolicy`, `ResourceQuota`, `LimitRange`, `ServiceAccount`, `Role`, `RoleBinding` in `tenant-*` | Pro Mandant | SocTalk K8s ServiceAccount |

## Akteur × Ressource-Matrix

`R` = lesen, `W` = schreiben, `-` = verweigern.

| Ressourcengruppe | `platform_admin` | `mssp_admin` | `analyst` | `customer_viewer` | `Worker` | `System` | `SocTalk K8s SA` | `Tenant adapter` |
|---|---|---|---|---|---|---|---|---|
| Mandantenbezogene DB (eigener Mandant) | RW (beliebig) | RW (beliebig) | RW (beliebig) | R (eigen) | RW (Mandant des Jobs) | RW (beliebig via Bypass) | - | - |
| Installationsbezogene DB | RW | R (minus Lizenz) | R | - | R | RW | - | - |
| Benutzerverwaltung (MSSP-seitig) | RW | RW | - | - | - | RW | - | - |
| Benutzerverwaltung (mandantenseitig, eigener Mandant) | - | - | - | - | - | - | - | - |
| Audit-Log (eigener Mandant) | R alle | R alle | R alle | R eigen | W | W | - | W (via Bootstrap) |
| K8s-Namespaces `tenant-*` | (nur via API) | (nur via API) | (nur via API) | - | - | - | CRUD | - |
| K8s-Ressourcen innerhalb `tenant-*` | (nur via API) | (nur via API) | (nur via API) | - | - | - | CRUD | R self |
| LLM-Secret pro Mandant | - | - | - | - | R (eigener Mandant) | - | mount | - |
| Integrations-Secrets pro Mandant | - | - | - | - | R (eigener Mandant) | - | mount | - |

Hinweise:
- Die Spalten zeigen eine repräsentative Teilmenge der Rollen. `mssp_manager` liegt zwischen `mssp_admin` und `analyst` (authorize-risk-Ebene); `tenant_manager` und `tenant_analyst` liegen auf der Mandantenseite über `customer_viewer`. Jede hält jede Capability der darunterliegenden Ebene.
- Die Benutzerverwaltung ist per Zielgruppe capability-gewallt, eine **Aufgabentrennung**. MSSP-Staff-Benutzer werden nur von `mssp_admin`/`platform_admin` über `/api/mssp/users` verwaltet; Mandanten-Benutzer werden nur vom `tenant_admin` des jeweiligen Mandanten über `/api/tenant/users` verwaltet. Ein MSSP-Admin verwaltet keine Mandanten-Benutzer und umgekehrt. Das Zuweisen von `platform_admin` sowie das Mutieren eines bestehenden `platform_admin` erfordern einen `platform_admin`.
- „nur via API" bedeutet, dass das menschliche Prinzipal K8s-Operationen durch Aufruf von SocTalk-API-Endpunkten auslöst, nicht direkt. API-Handler verwenden das SocTalk K8s ServiceAccount.
- `analyst`, der auf einen Mandanten einwirkt, schreibt Audit-Zeilen mit sowohl `user_id` als auch der `tenant_id` des Mandanten; die kundenseitige Audit-Ansicht zeigt diese als Impersonation-Einträge.

## RLS-Policy-Matrix

Siehe [Postgres RLS](/de-de/reference/postgres-rls) für SQL. Zusammenfassung:

| Tabelle | Policy | `USING` | `WITH CHECK` |
|---|---|---|---|
| Alle mandantenbezogenen Tabellen | `tenant_isolation` | `tenant_id = current_setting('app.current_tenant_id')::uuid` | gleich |
| `User` (wobei `tenant_id IS NOT NULL`) | gleich | gleich | gleich |
| `AuditLog` | `audit_read` | gleich beim Lesen; Schreibvorgänge erlaubt von Worker + System | gleich |
| Installationsbezogene Tabellen | keine RLS | — | — |

Alle mandantenbezogenen Tabellen haben `FORCE ROW LEVEL SECURITY`, sodass der Tabelleneigentümer (`soctalk_admin`) ebenfalls RLS-unterworfen ist. Das System-Prinzipal verwendet die Rolle `soctalk_mssp` (`BYPASSRLS`), um absichtlich mandantenübergreifend zu agieren.

## Klassifizierung der API-Endpunkte

Drei Kategorien. Niemals ein Endpunkt, der zwei Kategorien bedient.

### `/api/mssp/*`: MSSP-seitig (erfordert eine MSSP-Rolle; die spezifische Capability variiert je Route)

Mandantenübergreifend fähig. Wenn ein Handler mandantenübergreifende Sichtbarkeit benötigt (Rollups, Fleet-Views), verwendet er das `System`-Prinzipal über `system_context()`. Wenn ein Handler auf einen spezifischen Mandanten einwirkt (Impersonation), setzt er `app.current_tenant_id` und bleibt RLS-unterworfen.

Beispiele (dieses Release): `POST /api/mssp/tenants/onboard`, `GET /api/mssp/tenants`, `POST /api/mssp/tenants/{id}:retry`, `POST /api/mssp/tenants/{id}:suspend|:resume|:decommission`, `GET /api/audit`, MSSP-Staff-Benutzerverwaltung unter `/api/mssp/users`. (Impersonation und Fleet-Rollups sind Roadmap.)

### `/api/tenant/*`: Mandantenseitig (erfordert eine Mandantenrolle; die spezifische Capability variiert je Route)

Hart begrenzt. Mandantenkontext aus dem JWT; kein Impersonation-Eintrag. Alle Abfragen RLS-erzwungen über `soctalk_app`. Umfasst Operate-Oberflächen für `tenant_analyst`+ (Triage, Prüfung, Chat) und Self-Service für Engagements, Autorisierungsfakten und Benutzer.

Beispiele: `GET /api/tenant/overview`, `GET /api/tenant/incidents`, `GET /api/tenant/reports`, `GET /api/tenant/audit`, `GET /api/tenant/branding`.

### `/api/internal/*` — Service-zu-Service (Worker-JWT oder Adapter-JWT)

Nicht benutzerorientiert. Kurzlebige Service-JWTs mit explizitem Mandantenkontext. Beispiele: `POST /api/internal/adapter/health`, `POST /api/internal/adapter/bootstrap`, `GET /api/internal/adapter/config`.

Kein Endpunkt akzeptiert sowohl `/api/mssp/*`- als auch `/api/tenant/*`-Semantik. Wird eine Capability auf beiden Seiten benötigt, wird sie als zwei Endpunkte mit unterschiedlicher Authz und unterschiedlichen Kontextflüssen implementiert.

## Token-Claim-Schemata

### MSSP-seitiges User-JWT

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "iat": 1713475200,
  "exp": 1713478800,
  "jti": "<uuid>",
  "user_type": "mssp",
  "role": "platform_admin | mssp_admin | mssp_manager | analyst",
  "current_tenant": null
}
```

Wenn ein `mssp_admin` oder `analyst` in den Mandantenkontext eintritt, wird ein neues kurzlebiges Token mit `current_tenant: "<tenant_uuid>"` geprägt. Impersonation-Tokens haben eine TTL von maximal 30 Minuten und werden bei der Prägung protokolliert.

### Mandantenseitiges User-JWT

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "user_type": "tenant",
  "role": "tenant_admin | tenant_manager | tenant_analyst | customer_viewer",
  "tenant_id": "<tenant_uuid>"
}
```

### Worker-Service-JWT

```json
{
  "iss": "soctalk",
  "sub": "worker",
  "user_type": "worker",
  "tenant_id": "<tenant_uuid>",
  "job_id": "<uuid>",
  "job_type": "triage | enrich | decide | ..."
}
```

### Adapter-JWT

```json
{
  "iss": "soctalk",
  "sub": "adapter",
  "user_type": "adapter",
  "tenant_id": "<tenant_uuid>",
  "scope": "adapter"
}
```

Adapter-JWTs werden wöchentlich erneuert; die Rotation ist ein SocTalk-Controller-seitiges Secret-Rewrite im Mandanten-Namespace.

## Audit-Anforderungen

Jede Mutation schreibt eine `AuditLog`-Zeile mit:

- `id` (uuid), `timestamp`, `tenant_id` (nullable bei installationsbezogenen Events)
- `actor_principal` (User | Worker | System | Adapter)
- `actor_id` (user_id | `worker:<job_id>` | `system:<reason>` | tenant_id des Adapters)
- `action` (Enum: `tenant.create`, `tenant.suspend`, `investigation.approve`, `settings.update`, `user.impersonate`, …)
- `resource_type`, `resource_id`
- `before`, `after` (JSON-Snapshots für zustandsändernde Aktionen)
- `acting_as` (nullable; gesetzt, wenn ein `mssp_admin` oder `analyst` einen Mandanten impersoniert)
- `request_id` (korreliert mit Log-Zeilen)

Die Aufbewahrung beträgt 90 Tage; in einem zukünftigen Release pro Installation konfigurierbar. Kunden können Audit-Zeilen einsehen, bei denen `tenant_id = own` gilt, einschließlich Einträgen mit gesetztem `acting_as` (Transparenz über MSSP-Aktionen). Die mandantenübergreifende MSSP-Audit-Ansicht läuft unter dem `System`-Prinzipal.

## Bekannte architektonische Grenzen

- **Vertrauen in den MSSP cluster admin.** Prinzipal #7 hat unbegrenzten K8s-Zugriff. Das Isolationsmodell von SocTalk setzt voraus, dass dieses Prinzipal vertrauenswürdig ist. Kunden, die Verteidigung gegen Insider-Bedrohungen auf MSSP-Ebene benötigen, brauchen ein Dedicated-Node- oder Dedicated-VM-Tiering (zukünftiges Release).
- **Umfang der Admission-Boundary.** `ValidatingAdmissionPolicy` schränkt das SocTalk-Controller-ServiceAccount für Mandanten-Namespaces und namespace-bezogene Ressourcenmutationen ein, aber MSSP-Cluster-Admin-Benutzer bleiben vertrauenswürdige Break-Glass-Operatoren. Kyverno ist ein optionaler zukünftiger Härtungspfad.
- **Derzeit keine Lizenzdurchsetzung.** Lizenz-JWT und Feature-Gates auf ein zukünftiges Release verschoben. Pilot-MSSPs operieren auf Vertrauensbasis.
- **LLM-Response-Cache.** Ab Tag 1 mit `(tenant_id, prompt_hash)` als Schlüssel. Bei jeglicher Lockerung besteht das Risiko eines mandantenübergreifenden Inhaltslecks; die Testsuite prüft die Zusammensetzung des Schlüssels.
- **SSE-Subscriptions.** Zum Zeitpunkt der Subscription mandantenbezogen. Bugs bei der Verbindungspersistenz könnten mandantenübergreifende Events auf einer veralteten Subscription ausliefern; expliziter SSE-Isolationstest im Implementierungs-Gate.
- **Worker-Kontext-Leck.** Jeder Worker-Einstiegspunkt muss `app.current_tenant_id` setzen. Der defensive Standard ist null Zeilen unter RLS, kein mandantenübergreifendes Leck, aber die Testsuite prüft die Verteidigung.

## Test-Anforderungen

1. **Mandantenübergreifende API-Sonde.** Erstelle für jeden `/api/tenant/*`- und `/api/mssp/*`-Endpunkt, der auf mandantenbezogene Daten zugreift, Requests als Mandant A, die Lese- oder Schreibvorgänge auf Ressourcen von Mandant B versuchen. Prüfe auf 0 Zeilen oder 403.
2. **Raw-SQL-RLS-Sonde.** Verbinde dich als `soctalk_app`, setze `app.current_tenant_id = A`, führe `SELECT * FROM events` (ungefiltert) aus; prüfe, dass nur Zeilen von Mandant A zurückgegeben werden.
3. **Worker-Kontext-Standard.** Dispatche einen Worker-Job, ohne den Mandantenkontext zu setzen; prüfe, dass Abfragen 0 Zeilen zurückgeben (Defensive-Zero-Verhalten).
4. **SSE-Isolation.** Abonniere als Mandant A den Events-SSE; mutiere in Mandant B; prüfe, dass kein Event auf dem Stream von A ausgeliefert wird.
5. **LLM-Cache-Isolation.** Löse identische Prompts von Mandant A und Mandant B aus; prüfe auf Cache-Misses beim zweiten Aufruf für B (anderer Schlüssel) und Hits beim dritten Aufruf für A (gleicher Schlüssel).
6. **Impersonation-Audit.** Impersoniere als `mssp_admin` Mandant A, führe eine Mutation durch; prüfe, dass eine `AuditLog`-Zeile mit `acting_as=<mssp_admin_id>` und `tenant_id=A` existiert; prüfe, dass der Kundenbenutzer in A die Zeile lesen kann.
7. **System-Kontext-Audit.** Löse einen `/api/mssp/fleet/summary`-Aufruf aus; prüfe auf eine Audit-Zeile für den System-Kontext-Eintritt mit Grund.
