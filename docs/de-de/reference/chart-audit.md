# Audit des Mandanten-Helm-Charts


> **Audit-Methodik**: Dieses Dokument erfasst die erwartete Klassifizierung auf Basis der Chart-Inspektion. Tatsächliche `helm template`-Läufe und der Abgleich Diff-vs-Klassifizierung sind in der Pre-Release-Validierung erforderlich. Jedes Objekt, das in einem realen Render gefunden wird und hier nicht aufgeführt ist, wird zu einem Prüf-Gate.

## Umfang des Audits

Zu auditierende Charts:

| Upstream | Upstream-Quelle | Zielversion |
|---|---|---|
| Wazuh | `wazuh/wazuh-kubernetes` Helm-Chart (Community) oder offizielles OCI-Chart | Neueste stabile 4.x mit Unterstützung für Single-Manager-HA |
| TheHive | `StrangeBee/thehive4` Helm-Chart oder Community | 5.x |
| Cortex | `TheHive-Project/Cortex` Helm-Chart oder Community | 3.x |
| MISP | **auf ein zukünftiges Release verschoben** | |

Für jedes Chart vendorn wir die Manifest-Templates (bei Bedarf mit Patches) als Subchart-Abhängigkeiten von `charts/soctalk-tenant/`: Das Version-Pinning ist strikt. `Chart.yaml` verwendet exaktes SemVer mit Digest (OCI), wo verfügbar.

## Klassifizierungsregeln

Klassifiziere jedes gerenderte Objekt als:

- **NS-OK**: Namespace-scoped Objekt, das innerhalb von `tenant-<slug>` lebt. Sicher, erwartet.
- **CLUSTER-PREREQ**: Cluster-scoped Objekt, das einmalig durch das `soctalk-system`-Chart installiert oder als Verantwortung des MSSP-Cluster-Admins dokumentiert werden muss. Das Mandanten-Chart darf diese nicht pro Mandant erneut installieren.
- **FORBIDDEN**: Objekttyp oder Fähigkeit, die wir in einem Mandanten-Chart ablehnen, selbst wenn Upstream sie deklariert (z. B. clusterweites `ClusterRoleBinding`, das Wazuh privilegierten Zugriff gibt). Muss herausgepatcht werden.
- **PATCH**: Objekt beibehalten, aber modifizieren (z. B. `hostPath`-Volumes entfernen, privilegierten `securityContext` entfernen, Standard-Ressourcenanforderungen reduzieren).

## Erwartete Klassifizierung pro Upstream-Chart

### Wazuh

Wazuh-Charts rendern typischerweise:

| Objekt | Erwartete Klasse | Hinweise |
|---|---|---|
| `Deployment` / `StatefulSet` (Manager, Indexer, Dashboard) | NS-OK | Core-Stack-Pods |
| `Service` (Manager-API, Indexer, Dashboard, Agent-Ingress 1514/1515) | NS-OK | |
| `ConfigMap` (ossec.conf, indexer.yml, dashboard.yml) | NS-OK | |
| `Secret` (Admin-Passwort, mTLS-Zertifikate) | NS-OK | Pro Mandant beim Provisioning eingespielt |
| `PersistentVolumeClaim` (Indexer-Daten, Manager-Daten) | NS-OK | Größe über Mandanten-Values gesetzt |
| `ServiceAccount` | NS-OK | SA pro Mandant |
| `Role` + `RoleBinding` (für Leader-Election, falls verwendet) | NS-OK | Nur namespace-scoped |
| `NetworkPolicy` (Chart-bereitgestellt) | PATCH | Durch von SocTalk gerenderte NP für konsistente Posture ersetzen; Upstream-Defaults dürfen Default-Deny nicht überschreiben |
| `StorageClass`-Referenzen | CLUSTER-PREREQ | MSSP muss einen dynamischen Provisioner bereitstellen; `storageClassName` ist ein Values-Input |
| `Ingress` | PATCH oder deaktivieren | Das Agent-Protokoll von Wazuh auf 1514 ist kein Standard-TLS, daher ist ein HTTP/HTTPS-`Ingress` nicht geeignet. Alle `Ingress`-Ressourcen entfernen. Für den `Service` des Agent-Ingress sollte das Chart die Variante rendern, die zu `tenant.wazuhIngress.mode` passt: ein `LoadBalancer`-Service für LB-IPs pro Mandant (Standard) oder ein `ClusterIP`-Service, wenn die Installation den In-Cluster-HAProxy-Fallback verwendet. Siehe [Wazuh Ingress](/de-de/reference/wazuh-ingress). |
| `PodSecurityPolicy` / `SecurityContextConstraints` | CLUSTER-PREREQ falls vorhanden; andernfalls verboten | PSP ist deprecated; falls vorhanden, entfernen. OpenShift SCC ist für dieses Release nicht im Scope |
| `CustomResourceDefinition` | **FORBIDDEN** im Mandanten-Chart | Wenn das Chart versucht, eine CRD zu installieren, in das `soctalk-system`-Chart verschieben oder als Voraussetzung dokumentieren |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** im Mandanten-Chart | Niemals clusterweites RBAC aus einem Mandanten-Namespace installieren |
| Privilegierte/Host-Network-/hostPath-Pods | **FORBIDDEN**; herauspatchen | Der Wazuh-Manager benötigt diese für den Standardbetrieb nicht; der Indexer ebenfalls nicht. Falls ein Subchart `hostPath` für Logs verlangt, auf `emptyDir` + PVC patchen |
| `PodDisruptionBudget` | NS-OK | Optional; hängt vom Wazuh-HA-Modus ab. Single-Manager-Topologie kann darauf verzichten |

**Erwartete Patches**:
1. Alle `ClusterRole`/`ClusterRoleBinding` aus der gerenderten Ausgabe entfernen.
2. Alle cluster-scoped Ressourcen entfernen (`ValidatingWebhookConfiguration` usw.).
3. Den `Service` des Agent-Ingress passend zu `tenant.wazuhIngress.mode` rendern (`LoadBalancer` für LB-IPs pro Mandant, `ClusterIP` für den In-Cluster-HAProxy-Fallback).
4. `Ingress`-Ressourcen entfernen. Wazuh-Dashboards werden über einen separaten, von SocTalk verwalteten Pfad bereitgestellt; das Agent-Protokoll auf 1514 ist kein HTTP, daher findet K8s-`Ingress` keine Anwendung.
5. Sicherstellen, dass alle Pods `securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }` haben; patchen, falls Upstream anderes setzt.
6. Images auf Digests pinnen, nicht auf `latest`.

### TheHive

| Objekt | Erwartete Klasse | Hinweise |
|---|---|---|
| `Deployment` (TheHive-App) | NS-OK | |
| `StatefulSet` (Cassandra oder Varianten mit externer DB) | NS-OK | verwendet eingebettetes Cassandra; externes Cassandra ist eine Option für ein zukünftiges Release |
| `Service` (TheHive Web + API auf 9000) | NS-OK | |
| `ConfigMap` (application.conf) | NS-OK | Pro-Mandant-Konfiguration von SocTalk gerendert |
| `Secret` (Admin-Zugangsdaten, Cortex-API-Key für das Cortex dieses Mandanten) | NS-OK | |
| `PersistentVolumeClaim` (Cassandra-Daten, Index-Daten) | NS-OK | |
| `ServiceAccount` | NS-OK | |
| `Ingress` | PATCH oder deaktivieren | Wie bei Wazuh: Dashboard-Bereitstellung über MSSP-seitigen Proxy mit Mandanten-Routing, nicht per Namespace-Ingress |
| `Job` (Bootstrap / Init) | NS-OK | OK für Zertifikatsgenerierung beim ersten Start / DB-Initialisierung |
| `CustomResourceDefinition` | **FORBIDDEN**: muss im `soctalk-system`-Chart sein, falls vorhanden |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** im Mandanten-Chart |

**Erwartete Patches**:
1. Ingress entfernen; nur ClusterIP-Services verwenden.
2. Cassandra auf Digest pinnen; Ressourcenlimits passend zum Sizing setzen.
3. Sicherstellen, dass der Init-`Job` idempotent ist (erneute Läufe sind harmlos).
4. Keine CRD-Abhängigkeiten.

### Cortex

| Objekt | Erwartete Klasse | Hinweise |
|---|---|---|
| `Deployment` (Cortex-App) | NS-OK | |
| `StatefulSet` (Elasticsearch oder kompatibler Index) | NS-OK | eingebettetes ES; externes ES ist ein zukünftiges Release |
| `Service` (Cortex-API auf 9001) | NS-OK | |
| `ConfigMap` (application.conf, Analyzer-Listen) | NS-OK | |
| `Secret` (Admin, Inter-Service-Tokens) | NS-OK | |
| `PersistentVolumeClaim` | NS-OK | |
| `ServiceAccount` | NS-OK | |
| `Job` (Analyzer-Registrierung) | NS-OK falls idempotent |
| `Ingress` | PATCH oder deaktivieren |
| `PrivilegedContainer` (Docker-in-Docker für Analyzer-Sandboxing, falls Upstream dieses Muster verwendet) | **FORBIDDEN**: patchen | Cortex-Analyzer, die Docker-Sandboxing benötigen, sind für dieses Release nicht im Scope. Nur Analyzer verwenden, die In-Process laufen oder auf sandboxed externe Dienste zugreifen |

**Bekanntes Risiko**: Cortex führt historisch einige Analyzer als Subprozesse oder Docker-Container aus. Dieses Release beschränkt sich auf "Pure-Code"-Analyzer, die keinen privilegierten Host-Zugriff benötigen. Die Analyzer-Liste wird in den Values gepinnt; Analyzer, die Docker-in-Docker benötigen, werden zum Provisioning-Zeitpunkt abgelehnt.

## Liste der Cluster-Voraussetzungen (in den Install-Guide + Prereq-Check des `soctalk-system`-Charts eingearbeitet)

Nach dem Audit sind diese **außerhalb des Scopes des Mandanten-Charts** und müssen im Cluster existieren, bevor `soctalk-tenant` auf einen Namespace angewendet wird:

| Voraussetzung | Warum | Quelle |
|---|---|---|
| K3s 1.30+ (oder kompatibles K8s 1.30+) | Baseline plus `ValidatingAdmissionPolicy` v1 | MSSP-Verantwortung |
| NP-durchsetzendes CNI (Cilium primär, Calico alternativ) | Durchsetzung der Isolation | MSSP-Verantwortung |
| cert-manager | TLS für Ingress, Zertifikatsausstellung pro Mandant für Wazuh | MSSP-Verantwortung; Install-Guide liefert `helm install`-Rezept |
| Ingress-Controller (Traefik-Standard in K3s, ingress-nginx verbreitet) | MSSP-UI + Customer-UI + WebUI-Routing pro Mandant | MSSP-Verantwortung |
| Dynamische `StorageClass` (local-path, longhorn, Cloud-Provider-CSI usw.) | PVC-Provisioning | MSSP-Verantwortung |
| `VolumeSnapshotClass` bei Verwendung von CSI-Snapshots | Backup-/Restore-Runbook (nur Docs) | Optional |

Das `soctalk-system`-Chart enthält einen Pre-Install-Hook (`helm.sh/hook: pre-install`), der Folgendes verifiziert:
- NP-durchsetzendes CNI aktiv (prüft auf Cilium- oder Calico-Marker)
- cert-manager-CRDs vorhanden
- Standard-`StorageClass` gesetzt

Der Hook schlägt frühzeitig mit einer umsetzbaren Fehlermeldung fehl, falls etwas fehlt.

## Patching-Strategie

Zwei Wege:

1. **Values-gesteuerte Overrides**: Bevorzuge Upstream-Chart-Values, die das unerwünschte Objekt deaktivieren (z. B. `ingress.enabled: false`, `networkPolicy.enabled: false`, falls Upstreams laxer ist als unsere, `rbac.create: true` nur auf den Namespace gescoped).
2. **Overlay im Kustomize-Stil** (Helms `kustomize`-Integration oder Post-Render-Hook) für Objekte, die sich nicht über Values deaktivieren lassen: `ClusterRole`s entfernen, `hostPath`-Volumes entfernen, `securityContext` setzen.

Wir vendorn Upstream-Charts als gepinnte Subchart-Abhängigkeiten in `charts/soctalk-tenant/charts/`, nicht als `helm repo`-Referenzen. Das ermöglicht uns:
- Auf exakte Versionen zu pinnen (keine überraschenden Upstream-Updates)
- Patches bei Bedarf anzuwenden, ohne auf die Akzeptanz von Upstream-PRs angewiesen zu sein
- Unser Bundle als einzelnes Artefakt zu signieren (ein zukünftiges Release, wenn cosign eintrifft)

Falls Upstream unsere Anforderungen auch nach Patches nicht erfüllt, ist der Fallback, SocTalk-native Templates zu schreiben, die dieselben Container-Images mit unseren eigenen Manifesten aufrufen. Die Pre-Release-Validierung entscheidet dies pro Chart.

## Bekannte Unbekannte (durch Pre-Release-Validierung aufgelöst)

Punkte, die tatsächliche `helm template`-Läufe + Inspektion zur Bestätigung erfordern:

- [ ] **Wazuh**: Benötigt die gewählte Chart-Version CRDs für ein operator-getriebenes Deployment? Falls ja, CRDs in das `soctalk-system`-Chart verschieben.
- [ ] **TheHive**: Benötigt Cassandra eine `StorageClass` mit spezifischen Features (z. B. nur RWO, minimale IOPS)? Im Sizing dokumentieren.
- [ ] **Cortex**: Welche Analyzer sind standardmäßig aktiviert, und benötigt einer davon Docker-in-Docker? Eine Allowlist sicherer Analyzer erstellen.
- [ ] **Alle Charts**: Gibt es einen `Job` oder `CronJob`, der mit einem `ServiceAccount` über den Namespace hinaus läuft? Auf eine ns-lokale SA patchen.
- [ ] **Alle Charts**: Gibt es einen `initContainer` mit `privileged: true` oder `hostPath`-Mounts? Patchen oder ersetzen.
- [ ] **Alle Charts**: Standard-`resources.requests` und `limits`: Mit dem Sizing-Profil vergleichen; in den Values überschreiben, wo nötig.

Jeder offene Punkt wird zu einem Eintrag in der Pre-Release-Validierungscheckliste. Das Ergebnis des Spikes ist eine ausgefüllte Klassifizierungstabelle und das gepatchte Chart, bereit für `charts/soctalk-tenant/charts/`.

## Output-Artefakt (vor dem Shipping erzeugt)

Der Spike erzeugt:

1. **Klassifiziertes Objekt-Inventar** (Ausfüllen der Tabellen aus Abschnitt 3 mit den tatsächlich gerenderten Objekten).
2. **Gepatchte Chart-Bundles**, eingecheckt in `charts/soctalk-tenant/charts/wazuh/`, `thehive/`, `cortex/` mit gepinnten Versionen.
3. **Liste der Cluster-Voraussetzungen**, in den Install-Guide eingearbeitet.
4. **Analyzer-Allowlist** für Cortex (nur sicheres Set).
5. **Values-Schema-Fragment** für jedes Subchart (Inputs, die SocTalk pro Mandant bereitstellt).

Der Abschluss des Spikes ist eine Voraussetzung für die Helm-Chart-Implementierung.
