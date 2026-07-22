# Richtlinie zur Platzierung von Secrets

> **Hinweis zum V1-Deployment.** Mehrere Einträge weiter unten verweisen auf „Orchestrator-Pods" als eigenständige Workload, im V1-Chart ist der Orchestrator im Deployment `soctalk-system-api` mitplatziert, sodass Verweise auf „Orchestrator-Pod" in diesem Release „API-Pod" bedeuten. Auch konkrete K8s-Secret-Namen können leicht von den durch das Chart gerenderten Namen abweichen (siehe [`charts/soctalk-system/templates/60-secrets.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/60-secrets.yaml) als maßgebliche Quelle).

## Invariante (angestrebt)

**Ziel:** kein Secret-Rohmaterial in der SocTalk-Datenbank. Postgres-Tabellen, die Secrets nachverfolgen, speichern ausschließlich Referenzen: `(namespace, name, version_label)`. Das Material selbst liegt in einem Kubernetes-`Secret`-Objekt, das in den Pod eingehängt wird, der es benötigt.

**Heute (V1):** es gibt **eine dokumentierte Ausnahme**: `IntegrationConfig.llm_api_key_plain` in der Datenbank speichert pro-Mandant LLM-API-Schlüssel im Klartext. Dies ist erforderlich, weil der runs-worker den Schlüssel zum Zeitpunkt der Untersuchungs-Übernahme aus seinem Mandantenkontext liest und das V1-Chart pro-Mandant LLM-Secrets noch nicht über die Pod-Spec verdrahtet. Behandle die Postgres-Zugangsdaten als Schutz dieser Schlüssel und rotiere die LLM-Provider-Schlüssel so, als wären sie kompromittiert, wenn die DB-Zugangsdaten rotiert werden.

Andere Secret-Kategorien, JWT-Signierung, Postgres-Rollen, Integrations-Zugangsdaten, Wazuh-authd, liegen alle in K8s-Secrets und werden namentlich aus der DB referenziert, nicht inline gespeichert. Die Architekturziele (unten) beschreiben den Zielzustand für alle Secret-Klassen:

- Begrenzt den Wirkungsradius einer Kompromittierung der SocTalk-DB (kein Materialabfluss).
- Ermöglicht K8s-native Rotationsmechanismen (Secret-Update → Pod übernimmt neuen Wert beim erneuten Einhängen oder beim nächsten Secret-Lesevorgang).
- Deckt sich mit dem Integrationspfad des External Secrets Operator in einem künftigen Release.

## V1-Secret-Inventar (was das Chart heute tatsächlich rendert)

| Secret | Material | Ort | Zugriff durch | Rotation |
|---|---|---|---|---|
| `soctalk-system-postgres-admin-creds` | user/pw | `soctalk-system` ns | nur `db-init`-Container des API-Pods (Migrationen + Bootstrap) | Manuell |
| `soctalk-system-postgres-app-creds` | user/pw | `soctalk-system` ns | API-Pod (Laufzeit, RLS-subject) | Manuell |
| `soctalk-system-postgres-mssp-creds` | user/pw | `soctalk-system` ns | API-Pod (`system_context()` mandantenübergreifende Abfragen) | Manuell |
| `soctalk-system-jwt-signing-key` | HMAC-Secret | `soctalk-system` ns | API-Pod | Manuell |
| `soctalk-system-adapter-signing-key` | HMAC-Schlüssel | `soctalk-system` ns | API-Pod (prägt pro-Mandant Adapter-Token) | Manuell |
| `soctalk-system-bootstrap-admin` | E-Mail + Passwort | `soctalk-system` ns | nur `db-init`-Container des API-Pods | Manuell |
| `soctalk-system-llm-api-key` | Provider-API-Schlüssel (anthropic-api-key + openai-api-key) | `soctalk-system` ns | API-Pod (installationsweiter Standard) | Manuell |
| `adapter-token` | Bearer-Token | `tenant-<slug>` ns | Mandanten-Adapter-Pod | Bei Provisionierung geprägt; Rotation über Re-Provisionierung |
| `runs-worker-token` | Bearer-Token | `tenant-<slug>` ns | Mandanten-runs-worker-Pod (ruft `/api/internal/worker/runs/*` auf) | Wie oben |
| `tenant-llm-key` | LLM-API-Schlüssel | `tenant-<slug>` ns | Mandanten-runs-worker-Pod (eingehängt über `secretKeyRef`) | MSSP-initiiert über `PATCH /api/mssp/tenants/{id}/llm`; Controller materialisiert aus `IntegrationConfig.llm_api_key_plain` + startet runs-worker neu |
| `tenant-<id>-llm` | LLM-API-Schlüssel (legacy / Audit-Kopie) | `soctalk-system` ns | Von keinem V1-Pod eingehängt | Wie oben; diese Kopie wird für Audit-Zwecke geschrieben, ist aber **nicht die maßgebliche Quelle**, die der runs-worker liest |
| `wazuh-authd-secret` | shared secret | `tenant-<slug>` ns | Wazuh-Manager (Enrollment) | Neu generieren, um ein Re-Enrollment aller Agents zu erzwingen |
| `wazuh-<slug>-wazuh-creds` | user/pw | `tenant-<slug>` ns | Wazuh-Manager + linux-ep-Pods (Agent-Enrollment) | Bei Provisionierung generiert |

**Die Triage wird im `soctalk-runs-worker` in jedem `tenant-<slug>`-Namespace ausgeführt** (nicht im zentralen API-Pod). Deshalb werden pro-Mandant Secrets in den Mandanten-Namespace eingehängt, nicht in `soctalk-system`.

Der LLM-API-Schlüssel wird **außerdem im Klartext in `IntegrationConfig.llm_api_key_plain`** in Postgres gespeichert, siehe den Haftungsausschluss zur Invariante oben. Das K8s-Secret wird zum Zeitpunkt der Provisionierung / Rotation aus dem DB-Wert materialisiert.

Veraltete Einträge aus früheren Entwürfen (jetzt entfernt): `tenant-<id>-wazuh`, `tenant-<id>-thehive`, `tenant-<id>-cortex`, `wazuh-bootstrap`, `thehive-bootstrap`, `cortex-bootstrap`, `cassandra-creds`, `soctalk-license`. `tenant-<id>-llm` in `soctalk-system` existiert in V1 weiterhin als legacy/Audit-Kopie, ist aber **nicht** das, was der runs-worker liest. Der Architekturabschnitt unten beschreibt die Design-Begründung; nur das obige Inventar ist aktuell.

## Platzierung des pro-Mandant LLM-Schlüssels

Die Triage wird im pro-Mandant `soctalk-runs-worker`-Pod (im `tenant-<slug>`-Namespace) ausgeführt, **nicht** im zentralen API-Pod. Deshalb liegen pro-Mandant LLM-Schlüssel im Mandanten-Namespace:

- **Maßgeblicher Speicher:** `IntegrationConfig.llm_api_key_plain` in Postgres.
- **Eingehängte Quelle:** `Secret/tenant-llm-key` in `tenant-<slug>`, vom Controller aus dem DB-Wert materialisiert.
- **Bei Rotation (`PATCH /api/mssp/tenants/{id}/llm`):** Der Controller schreibt das Secret im Mandanten-Namespace neu und startet `Deployment/soctalk-runs-worker` neu, sodass der neue Schlüssel bei der nächsten Untersuchungs-Übernahme wirksam wird.

`Secret/tenant-<id>-llm` im Namespace `soctalk-system` existiert ebenfalls als legacy / Audit-Kopie aus früheren Design-Iterationen, wird aber von keinem V1-Pod eingehängt. Es gibt in V1 kein namespaceübergreifendes Secret-Mount.

Die Alternative (pro-Mandant ns für den LLM-Schlüssel jedes Mandanten) wird in einem künftigen Release mit dem External Secrets Operator erneut bewertet, wo ESO in einem externen Vault gespeicherte Secrets in den jeweils benötigten Namespace synchronisieren kann.

## Bootstrap-Secrets der Data Plane

Wazuh/TheHive/Cortex-Admin-Zugangsdaten liegen in ihren jeweiligen Mandanten-Namespaces, weil:

- Diese Pods sie beim Start benötigen (Init-Container, Erstlauf-Setup).
- Namespaceübergreifende Mount-Komplikationen wie oben.
- Der Wirkungsradius einer Namespace-Kompromittierung bereits die Pods selbst offenlegt; das Bootstrap-Secret im selben Namespace zu platzieren, fügt kein Risiko hinzu.

Bootstrap-Secrets werden vom SocTalk-Controller zum Zeitpunkt der Mandanten-Provisionierung generiert:
1. Der Controller generiert zufällige Werte (z. B. `openssl rand -hex 32`).
2. Der Controller erstellt ein `Secret` im Ziel-Namespace `tenant-<slug>`.
3. Der Controller erfasst die Referenz `(tenant-<slug>, wazuh-bootstrap, v1)` in der Tabelle `TenantSecret`.
4. Der Controller rendert die Mandanten-Chart-Values, die das Secret namentlich referenzieren.
5. `helm install` läuft weiter; Data-Plane-Pods lesen die Zugangsdaten beim Start.

Geht das Material verloren (z. B. Secret gelöscht), generiert eine Re-Provisionierung neue Zugangsdaten. Data-Plane-Pods starten neu; abhängige Dienste initialisieren sich erneut. Kunden-Endpoint-Agents (die auf das Wazuh-Enrollment-Secret angewiesen sind) benötigen ein Re-Enrollment, wenn genau dieses Secret rotiert wird: dokumentiert im Ops-Runbook.

## Konventionen zur Secret-Generierung

Zum Zeitpunkt der Mandanten-Provisionierung generiert der SocTalk-Controller:

```python
import secrets

# Administrative passwords: 32-char high-entropy
wazuh_admin_pw = secrets.token_urlsafe(32)
thehive_admin_pw = secrets.token_urlsafe(32)
cortex_admin_pw = secrets.token_urlsafe(32)

# Enrollment shared secret: 48-char
wazuh_authd = secrets.token_urlsafe(48)

# API tokens (for SocTalk → data plane): 48-char
thehive_api_token = secrets.token_urlsafe(48)
cortex_api_key = secrets.token_urlsafe(48)

# Cassandra: 32-char
cassandra_pw = secrets.token_urlsafe(32)
```

SocTalk speichert Referenzen und Versionslabels; das Material wird über den Provisionierungsaufruf hinaus nicht im Speicher gehalten.

## Rotation (V1-Realität)

1. **Rotation des pro-Mandant LLM-Schlüssels** (MSSP initiiert über `PATCH /api/mssp/tenants/{id}/llm`):
   - Maßgeblicher Speicher in Postgres aktualisiert (`IntegrationConfig.llm_api_key_plain`).
   - Der Controller schreibt `Secret/tenant-llm-key` in `tenant-<slug>` neu (nicht im System-Namespace).
   - Der Controller startet `Deployment/soctalk-runs-worker` im Mandanten-Namespace neu, sodass der neue Schlüssel bei der nächsten Übernahme wirksam wird. **Ein Pod-Neustart ist erforderlich**: V1 lädt Secrets nicht zur Laufzeit neu.

2. **Rotation der Wazuh- / TheHive- / Cortex-Admin-Zugangsdaten** (manuell, Runbook):
   - `kubectl patch secret <name> -n tenant-<slug> ...`, um die Zugangsdaten neu zu schreiben.
   - `kubectl rollout restart` der betroffenen Workload, damit sie erneut liest.
   - Ein Wrapper-CLI hierfür (`soctalk-cli rotate-admin`) war in früheren Entwürfen dokumentiert, ist aber in V1 **nicht implementiert**.

3. **Rotation der Postgres-Zugangsdaten** (manuell, Runbook):
   - `ALTER ROLE soctalk_app WITH PASSWORD ...` in Postgres.
   - `kubectl patch secret soctalk-system-postgres-app-creds ...` (beachte den vom Chart gerenderten Namen).
   - `kubectl rollout restart deploy soctalk-system-api`: in V1 gibt es keinen separaten Orchestrator-Pod (der Orchestrator ist im API-Pod mitplatziert).

4. **Rotation des JWT-Signierschlüssels** (ein künftiges Release): Eine Rotation ohne Ausfallzeit erfordert die Unterstützung zweier gültiger Schlüssel während des Übergangs. Dieses Release verschiebt dies; eine manuelle Rotation erzwingt ein Zeitfenster, in dem sich alle Benutzer neu authentifizieren müssen.

## Zugriffskontrolle

Kubernetes-RBAC schränkt ein, welche ServiceAccounts welche Secrets lesen dürfen:

- `soctalk-system-api`-SA in `soctalk-system`: kann Secrets in `soctalk-system` lesen (Postgres-Zugangsdaten, JWT-/Adapter-Signierschlüssel). Außerdem berechtigt, Secrets in `tenant-*`-Namespaces zu schreiben (erforderlich, um Mandanten-Bootstrap-Secrets zu erstellen/rotieren); das V1-Chart konsolidiert die API- und Controller-Rollen in dieser SA.
- Pro-Mandant `ServiceAccount` in `tenant-<slug>`: kann nur Secrets im eigenen Namespace lesen. Es kann sein eigenes `adapter-token` / `runs-worker-token` / `tenant-llm-key` lesen, aber niemals den System-Signierschlüssel.
- Die `soctalk-orchestrator-sa` aus früheren Entwürfen existiert in V1 nicht; der Orchestrator läuft im API-Pod unter der API-SA.

`Role`-/`RoleBinding`-Templates sind Teil des `soctalk-system`-Charts (für SocTalk-SAs) und des `soctalk-tenant`-Charts (für pro-Mandant SAs).

## Explizit abgelehnte Anti-Patterns

- **Env-Var-Secret-Injection aus einer `.env`-Datei** (aktuelles V0-Muster): in Ordnung für Single-Org, nicht für Multi-Tenant. Alle Secrets wandern in K8s-Secrets.
- **Secrets in Helm values.yaml**: niemals: Values-Dateien landen in Git, CI-Logs, Helm-History. Der SocTalk-Controller rendert Secret-Objekte separat und verwendet `valueFrom.secretKeyRef` in Templates.
- **Einzelner gemeinsamer LLM-Schlüssel für alle Mandanten**: für BYO LLM explizit außerhalb des Umfangs. Immer pro-Mandant-Schlüssel.
- **Secrets in ConfigMaps**: verboten. ConfigMaps sind für nicht-sensible Konfiguration; Secrets für sensible.

## External Secrets Operator (ein künftiger Release-Pfad)

Ein künftiges Release führt die Integration des External Secrets Operator ein:

- Der MSSP stellt ein Secret-Backend bereit (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
- `ExternalSecret`-Ressourcen referenzieren Backend-Pfade; ESO synchronisiert zu K8s-Secrets.
- Pro-Mandant LLM-Schlüssel werden im Backend mit Pfaden wie `secret/mssp-abc/tenants/acme/llm` gespeichert.
- Die Rotation erfolgt im Backend; ESO propagiert innerhalb des Refresh-Intervalls.

Die Struktur (Referenzen in Postgres → K8s-Secret → Mount) ist kompatibel: nur die Secret-Quelle ändert sich (ESO-verwaltet vs. SocTalk-Controller-geschrieben).
