# Täglicher Betrieb

Aufgaben, die MSSP-Betreiber gegen eine laufende SocTalk-Installation ausführen. Falls noch nicht geschehen, lesen Sie zuerst die [MSSP-UI-Tour](/de-de/mssp-ui); sie katalogisiert jede unten referenzierte Seite.

## Untersuchungs-Warteschlange

Öffnen Sie **Investigations**, um aktive Fälle für jeden Mandanten in einer Ansicht zu sehen. Filter: Mandant, Schweregrad. Klicken Sie auf eine Zeile für die Fall-Zeitachse, die Konversation und die Vorschläge.

![Investigations list](/screenshots/investigations-list.png)

## Vorschlags-Prüfungs-Warteschlange

**Reviews** ist die mandantenübergreifende Warteschlange von KI-Vorschlägen, die auf einen Menschen warten. Genehmigen / Ablehnen / Mehr-Infos aktualisieren jeweils die Prüfungszeile in der Datenbank (und dem Audit-Log). Es gibt **keine Outbox** in V1; die Executor- / nachgelagerte Benachrichtigungs-Pipeline steht auf der Roadmap.

![Review queue](/screenshots/review-queue.png)

## Mandant hängt in `provisioning`

**Symptom:** die Mandantenzeile eines neuen Kunden verbleibt länger als 15 Min. im Zustand `provisioning`.

1. Prüfen Sie den Status des Helm-Release:
   ```bash
   helm status tenant-<slug> -n tenant-<slug>
   ```
2. Prüfen Sie die Pod-Ereignisse:
   ```bash
   kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp | tail -30
   ```
3. Häufige Ursachen:
   - `StorageClass` fehlt oder Provisioner ausgefallen → PVCs hängen in `Pending`. Stellen Sie Storage bereit; `kubectl describe pvc` zeigt den Grund.
   - ResourceQuota zu klein für die Anforderung des Wazuh-Indexers. Erhöhen Sie die ResourceQuota des Mandanten via `helm upgrade` mit neuen Werten.
   - Image-Pull-Fehler → prüfen Sie Registry-Authentifizierung und Firewall.

Wenn ein Provisioning-Versuch nicht wiederherstellbar ist, außer Betrieb nehmen und erneut versuchen:

```bash
# Aus der MSSP-UI: Mandantendetail → Decommission → force=true
# Oder via API:
curl -X POST https://mssp.../api/mssp/tenants/<id>:decommission?force=true
```

## Mandant im Zustand `degraded`

`degraded` wird vom Provisioning-Controller bei einem Provisioning-Fehler gesetzt oder explizit via API gesetzt. **In diesem Release gibt es keine automatische Degradations-Schleife basierend auf dem Alter des Adapter-Heartbeats**; die Metrik `soctalk_tenant_adapter_heartbeat_age_seconds` dient Ihrem Alerting.

1. Prüfen Sie den Adapter-Pod:
   ```bash
   kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=200
   ```
2. Prüfen Sie den NetworkPolicy-Egress (der Adapter muss die `soctalk-system`-API erreichen):
   ```bash
   hubble observe --from-pod tenant-<slug>/soctalk-adapter-<pod>
   ```
3. Starten Sie den Adapter neu:
   ```bash
   kubectl -n tenant-<slug> rollout restart deploy/soctalk-adapter
   ```

Wenn die Data Plane gesund ist, der Adapter aber `soctalk-system` immer noch nicht erreichen kann, inspizieren Sie die `adapter-egress`-NetworkPolicy.

## Pro-Mandant-LLM-Schlüssel rotieren

1. MSSP-Admin → Kundendetail → Settings → LLM → neuen Schlüssel einfügen → Save (oder `PATCH /api/mssp/tenants/{id}/llm`).
2. SocTalks maßgeblicher Speicher ist `IntegrationConfig.llm_api_key_plain` in Postgres. Der Provisioning-Controller materialisiert diesen Wert in `Secret/tenant-llm-key` im Mandanten-Namespace (eingebunden vom runs-worker-Deployment) und spiegelt optional eine Referenz nach `soctalk-system/<tenant-id>-llm` zu Audit-Zwecken.
3. SocTalk startet nach Best-Effort das `soctalk-runs-worker`-Deployment in `tenant-<slug>` neu, damit der neue Schlüssel bei der nächsten Untersuchungs-Übernahme wirksam wird.

## Data-Plane-Bootstrap-Secrets rotieren

Es gibt in diesem Release kein `soctalk-cli rotate-*`-Kommando; dieser Weg war in früheren Entwürfen dokumentiert. Heute:

- **Wazuh-Admin-Passwort:** patchen Sie das relevante Secret im Mandanten-Namespace und starten Sie dann den betroffenen Pod neu. Der Bootstrap-Rerun der Chart beim Pod-Start übernimmt die neue Zugangsinformation. TheHive und Cortex sind externe Integrationen, keine gebündelten Subcharts, daher werden ihre Zugangsdaten in jenen Systemen rotiert und über die Integrationskonfiguration aktualisiert (siehe /de-de/integrate/thehive, /de-de/integrate/cortex).
- **Wazuh-`authd`-Shared-Secret:** patchen Sie `Secret/wazuh-authd-secret` in `tenant-<slug>`, starten Sie den Wazuh-Manager neu. Alle bestehenden Agenten müssen sich mit dem neuen Secret neu registrieren; verteilen Sie es über Ihren üblichen sicheren Kanal.

Eine Wrapper-CLI für diese Rotationen steht auf der Roadmap.

## Analytics

**Analytics** rollt Triage-Volumen, Vorschlagsergebnisse, MTTR und Budgetverbrauch pro Mandant auf. Nutzen Sie es für Kapazitätsplanung, Modellbewertung und SLA-Prüfung.

![Analytics](/screenshots/analytics.png)

## Audit-Log-Prüfung

Das MSSP-weite Audit-Log liegt in **UI → Audit-Tab**. Filtern Sie nach Mandant, Akteur, Aktion oder Zeitstempel. Für Compliance-Exporte nutzen Sie die API:

```bash
curl 'https://mssp.../api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

![Audit log](/screenshots/audit-log.png)

## Datenbank-Wiederherstellung (Disaster Recovery)

Backups werden extern MSSP-verwaltet (Velero, Cluster-Snapshots, externes `pg_dump`). Zum Wiederherstellen:

1. Stoppen Sie die SocTalk-API:
   ```bash
   kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=0
   ```
   (Die V1-Chart bündelt den Orchestrator in den API-Pod, kein separates `soctalk-system-orchestrator`-Deployment.)
2. Stellen Sie die Postgres-Daten aus Ihrem Backup wieder her.
3. Starten Sie die API neu: `kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=2` (oder Ihre übliche Replica-Anzahl).

Die PVCs der Mandanten-Data-Plane folgen demselben Muster: pro Namespace wiederherstellen, dann `helm upgrade` des Mandanten-Release, um sie wieder anzubinden.

## Notfall: einen Mandanten sofort deaktivieren

Die UI-**Suspend**-Aktion setzt in diesem Release den Mandantenzustand auf `suspended` und hindert den Orchestrator daran, neue Untersuchungen zu planen, **aber sie skaliert keine Workloads**. Für eine tatsächliche Abschaltung führen Sie die untenstehenden Schritte aus (alle Deployments skalieren + eine Deny-All-NetworkPolicy zur doppelten Absicherung anwenden):

```bash
# 1. Alle Workloads im Mandanten-Namespace auf null skalieren. Dies ist der
#    definitive Stopp — Pods verschwinden.
kubectl -n tenant-<slug> get deploy,statefulset -o name \
  | xargs -I {} kubectl -n tenant-<slug> scale {} --replicas=0

# 2. Deny-All zur doppelten Absicherung, damit alles, was wieder hochkommt (z. B.
#    von einem hängenden, abgleichenden Operator), eingesperrt ist.
kubectl -n tenant-<slug> apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: emergency-deny-all }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
EOF
```

Kehren Sie den Vorgang um, indem Sie die NetworkPolicy löschen, die Workloads wieder auf ihre ursprünglichen Replica-Anzahlen hochskalieren und in der UI **Resume** aufrufen. **Resume** aktualisiert in diesem Release ebenfalls nur den DB-Zustand; es stellt die Replica-Anzahlen nicht für Sie wieder her.

## Verdacht auf mandantenübergreifendes Datenleck

Wenn Sie mandantenübergreifenden Zugriff vermuten:

1. Prüfen Sie die jüngsten Läufe der RLS-Testsuite; sie bestehen in CI bei jedem Release.
2. Sondieren Sie die DB direkt:
   ```bash
   kubectl -n soctalk-system exec -it statefulset/soctalk-system-postgres -- \
     psql -U soctalk_app -d soctalk \
     -c "SET app.current_tenant_id='<tenant-a>'; SELECT tenant_id FROM events LIMIT 5;"
   ```
3. Wenn ein Leck bestätigt ist, eröffnen Sie einen P1-Vorfall. RLS plus `FORCE ROW LEVEL SECURITY` ist die letzte Verteidigungslinie; ein ungepatchtes Leck deutet auf einen Anwendungsfehler oder eine Fehlkonfiguration einer Postgres-Rolle hin.

## Häufige Fehler

- Migrationen als `soctalk_app` ausführen. Migrationen benötigen `soctalk_admin`-Zugangsdaten; unter `soctalk_app` schlagen sie fehl.
- `soctalk-tenant`-Werte direkt in Helm bearbeiten. Dies umgeht SocTalks Datenbankzustand; gehen Sie über die API.
- `tenant-*`-Namespaces von Hand anlegen. Die erforderlichen Labels sind dann nicht vorhanden und SocTalk erkennt den Namespace nicht. Nutzen Sie den Tenant-Create-Flow.
