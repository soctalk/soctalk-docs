# Fehlerbehebung

Symptom → Diagnose → Behebung. Runbook für die häufigsten Fehlerursachen.

| Symptom | Erste Prüfung | Behebung |
|---|---|---|
| `helm install soctalk-system` schlägt im Pre-Install-Hook fehl | `kubectl logs -n soctalk-system job/<release>-preinstall-check` | Installiere die fehlende Cluster-Voraussetzung (CNI, cert-manager, StorageClass) gemäß dem [Install](/de-de/install#cluster-prerequisites)-Leitfaden |
| API-Pod `CrashLoopBackOff` beim Start | `kubectl logs -n soctalk-system deploy/soctalk-system-api` | Meistens: fehlerhaftes `DATABASE_URL`-Secret, Postgres noch nicht bereit oder fehlgeschlagene Alembic-Migration. Prüfe zuerst den Postgres-Pod |
| `helm install` erfolgreich, aber MSSP-UI liefert 502 | Logs des Ingress-Controllers; prüfe, ob die `endpoints` des Ingress-Service befüllt sind | OIDC-Proxy nicht bereitgestellt oder injiziert keine vertrauenswürdigen Header. Prüfe das Trusted-Proxy-CIDR |
| Mandant-Erstellung liefert 500 | API-Logs zeigen `ProvisionError` | Normalerweise ist `helm install tenant-*` fehlgeschlagen. Prüfe `helm status tenant-<slug>`. Namespace- und Resource-Quota-Probleme sind am häufigsten |
| Mandant hängt seit > 15 min in `provisioning` | `kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp` | Siehe [Mandant hängt in Provisioning](/de-de/operations#tenant-stuck-in-provisioning) im Betriebshandbuch |
| Mandant wechselt in `degraded` | Adapter-Logs im Namespace des Mandanten | NetworkPolicy-Egress, Absturz des Adapter-Pods oder DNS falsch aufgelöst |
| Mandantenübergreifende Daten sichtbar | Isolations-Testsuite ausführen | **P1-Vorfall.** RLS ist die letzte Verteidigungslinie; ein Fehler deutet auf einen Anwendungsfehler oder eine fehlerhafte Postgres-Rollenkonfiguration hin |
| LLM-Aufrufe schlagen für einen Mandanten fehl | Worker-Logs: nach 401/403 vom LLM-Anbieter suchen | Der runs-worker liest aus `Secret/tenant-llm-key` im Namespace `tenant-<slug>`. Maßgebliche Quelle ist `IntegrationConfig.llm_api_key_plain` in Postgres — rotiere über `PATCH /api/mssp/tenants/{id}/llm` (UI: Mandantendetail → Settings → LLM), was das Secret neu schreibt und den runs-worker neu startet |
| Wazuh-Agent kann keine Verbindung herstellen | LB-IP des Mandanten (oder Edge-HAProxy-IP+Port) vom Agent-Host erreichbar; DNS für `<slug>.soc.mssp.*` löst dorthin auf; 1514/1515 durch jede zwischengeschaltete Firewall offen | Siehe [Wazuh Ingress](/de-de/reference/wazuh-ingress). 1514 ist Wazuhs proprietäres Protokoll — es gibt kein SNI zum Inspizieren; die Weiterleitung erfolgt anhand von Zieladresse oder Port. Stelle sicher, dass der `Service` des Mandanten (`type: LoadBalancer` oder der HAProxy-Port) die Adresse ist, die der Agent anspricht |
| Postgres-StatefulSet startet nicht (PVC Pending) | `kubectl describe pvc -n soctalk-system` | Keine Standard-StorageClass, die Klasse unterstützt kein RWO oder der Cluster hat keinen freien Speicherplatz mehr |
| `PolicyViolation`-Meldungen vom Ingress-Controller | NetworkPolicy-Allow-Regeln | Stelle sicher, dass der Ingress-Namespace mit `kubernetes.io/metadata.name=ingress-system` gelabelt ist |
| Cilium Hubble zeigt DROPPED-Flows zwischen Mandant und `soctalk-system` | NetworkPolicies + Cilium-Identitäten | Adapter-Egress-Policy fehlt oder falscher `namespaceSelector` |
| Login eines Kundenbenutzers liefert 403 bei `/api/tenant/*` | JWT-Claims | Stelle sicher, dass die Benutzerzeile `tenant_id` gesetzt hat und `role=customer_viewer` |
| MSSP-Benutzer-Impersonation erscheint nicht im Kunden-Audit | Audit-Abfrage | Prüfe, ob die Spalte `acting_as` beim Schreiben befüllt wird; die Kunden-Audit-Ansicht joint auf `tenant_id = own AND acting_as IS NOT NULL` |
| Isolationstest schlägt in CI fehl (FORCE-RLS-Admin kann Zeilen sehen) | Migration angewendet? | Führe `alembic upgrade head` erneut aus; stelle sicher, dass `FORCE ROW LEVEL SECURITY` auf jede mandantengebundene Tabelle angewendet wird |
| ImagePullBackOff bei Mandant `soctalk-adapter` / `soctalk-runs-worker` | `kubectl -n tenant-<slug> describe pod` zeigt Pull-Fehler für `ghcr.io/soctalk/soctalk-adapter:0.1.13-fixes` (oder ähnlich) | Bekannt: `render.py` verwendet standardmäßig ein Tag, das möglicherweise nicht in der öffentlichen ghcr vorhanden ist. Überschreibe zur Installationszeit: setze `tenantProvisioning.adapterImageTag: latest` und `tenantProvisioning.runsWorkerImageTag: latest` in den `soctalk-system`-Values. Diese werden bis zu den Env-Variablen `SOCTALK_TENANT_ADAPTER_IMAGE_TAG` / `SOCTALK_TENANT_RUNS_WORKER_IMAGE_TAG` am API-Deployment durchgereicht, die das Provisioning-Rendering liest |

## Diagnose-Bundles sammeln

Sammle beim Eskalieren an den Support:

```bash
# SocTalk-Zustand auf Systemebene
kubectl get all,events,networkpolicies,resourcequotas \
  -n soctalk-system -o yaml > soctalk-system.yaml
kubectl -n soctalk-system logs deploy/soctalk-system-api --tail=500 > api.log
# (Der V1-Chart bündelt den Orchestrator in den API-Pod — kein separates Deployment)

# Bestimmter Mandant
kubectl get all,events,networkpolicies,resourcequotas,limitranges \
  -n tenant-<slug> -o yaml > tenant.yaml
kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=500 > adapter.log

# Helm-Zustand
helm status -n soctalk-system soctalk-system > helm-system.txt
helm status -n tenant-<slug> tenant-<slug> > helm-tenant.txt

# SocTalk-Version + Lifecycle-Events für den Mandanten
# soctalk-cli debug-bundle war in früheren Entwürfen dokumentiert; nicht implementiert.
# Erfasse die Daten manuell aus den obigen kubectl/helm-Schritten.

tar czf soctalk-debug-$(date +%s).tgz *.yaml *.log *.txt
```

**Prüfe das Tarball auf Kundendaten, bevor du es extern weitergibst.** Logs können Warnungs-Auszüge enthalten.
