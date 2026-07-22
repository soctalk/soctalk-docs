# Audit des Mandanten-Helm-Charts


> **Audit-Methodik**: Dieses Dokument erfasst die erwartete Klassifizierung auf Basis der Chart-Inspektion. Tatsächliche `helm template`-Läufe und der Abgleich Diff-vs-Klassifizierung sind in der Pre-Release-Validierung erforderlich. Jedes Objekt, das in einem realen Render gefunden wird und hier nicht aufgeführt ist, wird zu einem Prüf-Gate.

## Umfang des Audits

Zu auditierende Charts:

| Upstream | Upstream-Quelle | Zielversion |
|---|---|---|
| Wazuh | `wazuh/wazuh-kubernetes` Helm-Chart (Community) oder offizielles OCI-Chart | Neueste stabile 4.x mit Unterstützung für Single-Manager-HA |
| linux-ep | SocTalk-L2-Endpoint-Agent-Subchart (Komponentenschlüssel `components.linuxep`) | `0.2.0` |
| MISP | **auf ein zukünftiges Release verschoben** | |

Das `soctalk-tenant`-Chart vendort genau zwei Subcharts, `wazuh` und `linux-ep`. Für jedes vendorn wir die Manifest-Templates (bei Bedarf mit Patches) als Subchart-Abhängigkeiten von `charts/soctalk-tenant/`: Das Version-Pinning ist strikt. `Chart.yaml` verwendet exaktes SemVer mit Digest (OCI), wo verfügbar.

TheHive und Cortex sind **externe Integrationen**, über das Netzwerk erreicht und pro Mandant konfiguriert (siehe /de-de/integrate/thehive und /de-de/integrate/cortex). Sie sind keine vendorten Subcharts und daher außerhalb des Scopes dieses Chart-Audits.

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

### linux-ep

Das L2-Endpoint-Agent-Subchart (`components.linuxep`). Sein gerendertes Inventar ist schmal: Das Chart emittiert ein einzelnes `StatefulSet` und konsumiert ein bestehendes Secret per `secretKeyRef`, statt eigene Credential-Objekte zu rendern.

| Objekt | Erwartete Klasse | Hinweise |
|---|---|---|
| `StatefulSet` (Endpoint-Agent) | NS-OK | Die einzige Workload, die das Subchart rendert; namespace-scoped |
| `Secret` (Enrollment-/Agent-Zugangsdaten) | Konsumiert, nicht gerendert | Referenziert per `secretKeyRef`; pro Mandant beim Provisioning eingespielt, außerhalb dieses Subcharts |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** im Mandanten-Chart | Niemals clusterweites RBAC aus einem Mandanten-Namespace installieren |

**Aktueller Stand und erwartete Patches**:
1. Der Subchart-Default setzt `securityContext.privileged: true` auf dem Agent-Pod. Dies ist reines PoC-Verhalten und ein reales Risiko, es muss vor jeder Produktionsnutzung eingegrenzt werden (privileged entfernen, `allowPrivilegeEscalation: false`).
2. Bestätigen, dass keine `ClusterRole`/`ClusterRoleBinding` in der gerenderten Ausgabe erscheint.
3. Images auf Digests pinnen, nicht auf `latest`.

### Externe Integrationen (außerhalb des Audit-Scopes)

TheHive und Cortex sind **externe Integrationen**, keine vendorten Subcharts, und daher außerhalb des Scopes dieses Chart-Audits. SocTalk erreicht sie pro Mandant über das Netzwerk; es gibt keine In-Namespace-TheHive-/Cortex-Objekte zu klassifizieren. Konfiguriere sie über /de-de/integrate/thehive und /de-de/integrate/cortex.

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

Wir vendorn Upstream-Charts als Geschwister-Charts unter `charts/` (`charts/wazuh`, `charts/linux-ep`), referenziert per relativem Pfad, nicht als `helm repo`-Referenzen (Helm kopiert sie zur Build-Zeit in das Paket). Das ermöglicht uns:
- Auf exakte Versionen zu pinnen (keine überraschenden Upstream-Updates)
- Patches bei Bedarf anzuwenden, ohne auf die Akzeptanz von Upstream-PRs angewiesen zu sein
- Unser Bundle als einzelnes Artefakt zu signieren (ein zukünftiges Release, wenn cosign eintrifft)

Falls Upstream unsere Anforderungen auch nach Patches nicht erfüllt, ist der Fallback, SocTalk-native Templates zu schreiben, die dieselben Container-Images mit unseren eigenen Manifesten aufrufen. Die Pre-Release-Validierung entscheidet dies pro Chart.

## Bekannte Unbekannte (durch Pre-Release-Validierung aufgelöst)

Punkte, die tatsächliche `helm template`-Läufe + Inspektion zur Bestätigung erfordern:

- [ ] **Wazuh**: Benötigt die gewählte Chart-Version CRDs für ein operator-getriebenes Deployment? Falls ja, CRDs in das `soctalk-system`-Chart verschieben.
- [ ] **linux-ep**: Benötigt der Endpoint-Agent Host-Level-Zugriff (hostPath, Host-Network), der herausgepatcht oder eingegrenzt werden muss?
- [ ] **Alle Charts**: Gibt es einen `Job` oder `CronJob`, der mit einem `ServiceAccount` über den Namespace hinaus läuft? Auf eine ns-lokale SA patchen.
- [ ] **Alle Charts**: Gibt es einen `initContainer` mit `privileged: true` oder `hostPath`-Mounts? Patchen oder ersetzen.
- [ ] **Alle Charts**: Standard-`resources.requests` und `limits`: Mit dem Sizing-Profil vergleichen; in den Values überschreiben, wo nötig.

Jeder offene Punkt wird zu einem Eintrag in der Pre-Release-Validierungscheckliste. Das Ergebnis des Spikes ist eine ausgefüllte Klassifizierungstabelle und das gepatchte Chart, gepflegt unter `charts/wazuh` / `charts/linux-ep`.

## Output-Artefakt (vor dem Shipping erzeugt)

Der Spike erzeugt:

1. **Klassifiziertes Objekt-Inventar** (Ausfüllen der Tabellen aus Abschnitt 3 mit den tatsächlich gerenderten Objekten).
2. **Gepatchte Chart-Bundles**, gepflegt unter `charts/wazuh/` und `charts/linux-ep/` mit gepinnten Versionen.
3. **Liste der Cluster-Voraussetzungen**, in den Install-Guide eingearbeitet.
4. **Values-Schema-Fragment** für jedes Subchart (Inputs, die SocTalk pro Mandant bereitstellt).

Der Abschluss des Spikes ist eine Voraussetzung für die Helm-Chart-Implementierung.
