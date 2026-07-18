# Risoluzione dei problemi

Sintomo → diagnosi → soluzione. Runbook per le modalità di guasto più comuni.

| Sintomo | Prima verifica | Soluzione |
|---|---|---|
| `helm install soctalk-system` fallisce nell'hook pre-install | `kubectl logs -n soctalk-system job/<release>-preinstall-check` | Installa il prerequisito di cluster mancante (CNI, cert-manager, StorageClass) seguendo la guida [Installazione](/it-it/install#cluster-prerequisites) |
| Il pod API va in `CrashLoopBackOff` all'avvio | `kubectl logs -n soctalk-system deploy/soctalk-system-api` | Più spesso: Secret `DATABASE_URL` errato, Postgres non ancora pronto, o migrazione Alembic fallita. Controlla prima il pod Postgres |
| `helm install` riesce ma la UI MSSP restituisce 502 | Log del controller di ingress; verifica che gli `endpoints` del Service di ingress siano popolati | Il proxy OIDC non è distribuito o non inietta gli header attendibili. Controlla il CIDR trusted-proxy |
| La creazione del Tenant restituisce 500 | I log dell'API mostrano `ProvisionError` | Di solito `helm install tenant-*` è fallito. Controlla `helm status tenant-<slug>`. I problemi più comuni riguardano namespace e resource-quota |
| Tenant bloccato in `provisioning` > 15 min | `kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp` | Vedi [Tenant bloccato in provisioning](/it-it/operations#tenant-stuck-in-provisioning) nella sezione operations |
| Il Tenant passa a `degraded` | Log dell'adapter nel namespace del tenant | Egress della NetworkPolicy, crash del pod adapter, o DNS risolto in modo errato |
| Dati visibili tra Tenant diversi | Esegui la suite di test di isolamento | **Incidente P1.** La RLS è l'ultima linea di difesa; un guasto indica un bug applicativo o una configurazione errata dei ruoli Postgres |
| Chiamate LLM in errore per un Tenant | Log del worker: cerca 401/403 dal provider LLM | Il runs-worker legge da `Secret/tenant-llm-key` nel namespace `tenant-<slug>`. La fonte autorevole è `IntegrationConfig.llm_api_key_plain` in Postgres — ruota tramite `PATCH /api/mssp/tenants/{id}/llm` (UI: dettaglio tenant → Settings → LLM) che riscrive il Secret e riavvia il runs-worker |
| L'agente Wazuh non riesce a connettersi | L'IP del LB del Tenant (o l'IP+porta dell'edge HAProxy) è raggiungibile dall'host dell'agente; il DNS per `<slug>.soc.mssp.*` lo risolve; 1514/1515 aperti attraverso eventuali firewall intermedi | Vedi [Wazuh Ingress](/it-it/reference/wazuh-ingress). 1514 è il protocollo proprietario di Wazuh — non c'è SNI da ispezionare; l'instradamento avviene per indirizzo di destinazione o porta. Verifica che il `Service` del Tenant (`type: LoadBalancer` o la porta HAProxy) sia l'indirizzo verso cui punta l'agente |
| Lo StatefulSet Postgres non parte (PVC Pending) | `kubectl describe pvc -n soctalk-system` | Nessuna StorageClass predefinita, la classe non supporta RWO, o il cluster ha esaurito lo spazio su disco |
| Messaggi `PolicyViolation` dal controller di ingress | Regole allow della NetworkPolicy | Assicurati che il namespace di ingress abbia l'etichetta `kubernetes.io/metadata.name=ingress-system` |
| Cilium Hubble mostra flussi DROPPED tra il tenant e `soctalk-system` | NetworkPolicies + identità Cilium | Policy di egress dell'adapter mancante o `namespaceSelector` errato |
| Il login di un utente cliente restituisce 403 su `/api/tenant/*` | Claim del JWT | Assicurati che la riga utente abbia `tenant_id` impostato e `role=customer_viewer` |
| L'impersonificazione dell'utente MSSP non compare nell'audit del cliente | Query di audit | Verifica che la colonna `acting_as` sia popolata in scrittura; la vista di audit del cliente fa join su `tenant_id = own AND acting_as IS NOT NULL` |
| Il test di isolamento fallisce in CI (l'admin FORCE RLS vede le righe) | Migrazione applicata? | Riesegui `alembic upgrade head`; assicurati che `FORCE ROW LEVEL SECURITY` sia applicato a ogni tabella con ambito tenant |
| ImagePullBackOff sul `soctalk-adapter` / `soctalk-runs-worker` del tenant | `kubectl -n tenant-<slug> describe pod` mostra un errore di pull per `ghcr.io/soctalk/soctalk-adapter:0.1.13-fixes` (o simile) | Noto: `render.py` usa come default un tag che potrebbe non essere presente nel ghcr pubblico. Sovrascrivi al momento dell'installazione: imposta `tenantProvisioning.adapterImageTag: latest` e `tenantProvisioning.runsWorkerImageTag: latest` nei values di `soctalk-system`. Questi si propagano alle env `SOCTALK_TENANT_ADAPTER_IMAGE_TAG` / `SOCTALK_TENANT_RUNS_WORKER_IMAGE_TAG` sul Deployment dell'API, che il render di provisioning legge |

## Raccolta dei bundle diagnostici

Quando apri un'escalation al supporto, raccogli:

```bash
# Stato a livello di sistema SocTalk
kubectl get all,events,networkpolicies,resourcequotas \
  -n soctalk-system -o yaml > soctalk-system.yaml
kubectl -n soctalk-system logs deploy/soctalk-system-api --tail=500 > api.log
# (Il chart V1 include l'orchestrator nel pod API — nessun Deployment separato)

# Tenant specifico
kubectl get all,events,networkpolicies,resourcequotas,limitranges \
  -n tenant-<slug> -o yaml > tenant.yaml
kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=500 > adapter.log

# Stato Helm
helm status -n soctalk-system soctalk-system > helm-system.txt
helm status -n tenant-<slug> tenant-<slug> > helm-tenant.txt

# Versione SocTalk + eventi del ciclo di vita del tenant
# soctalk-cli debug-bundle era documentato in bozze precedenti; non implementato.
# Cattura i dati manualmente dai passaggi kubectl/helm qui sopra.

tar czf soctalk-debug-$(date +%s).tgz *.yaml *.log *.txt
```

**Esamina il tarball alla ricerca di dati dei clienti prima di condividerlo esternamente.** I log possono contenere estratti di alert.
