# Operazioni quotidiane

Attività che gli operatori MSSP eseguono su un'installazione SocTalk attiva. Se non l'hai ancora fatto, leggi prima il [Tour dell'interfaccia MSSP](/it-it/mssp-ui) — cataloga tutte le pagine referenziate di seguito.

## Coda delle indagini

Apri **Investigations** per vedere in un'unica vista i casi attivi di ogni tenant. Filtri: tenant, gravità. Fai clic su una riga per la timeline del caso, la conversazione e le proposte.

![Investigations list](/screenshots/investigations-list.png)

## Coda di revisione delle proposte

**Reviews** è la coda cross-tenant delle proposte AI in attesa di un intervento umano. Approva / rifiuta / richiedi maggiori informazioni: ciascuna azione aggiorna la riga di revisione nel database (e nell'audit log). In V1 **non esiste alcuna outbox** — l'executor e la pipeline di notifica a valle sono in roadmap.

![Review queue](/screenshots/review-queue.png)

## Tenant bloccato in stato `provisioning`

**Sintomo:** la riga del tenant di un nuovo cliente rimane nello stato `provisioning` per più di 15 minuti.

1. Controlla lo stato della release Helm:
   ```bash
   helm status tenant-<slug> -n tenant-<slug>
   ```
2. Controlla gli eventi dei pod:
   ```bash
   kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp | tail -30
   ```
3. Cause comuni:
   - `StorageClass` mancante o provisioner non attivo → i PVC rimangono in `Pending`. Effettua il provisioning dello storage; `kubectl describe pvc` mostra il motivo.
   - ResourceQuota troppo piccola per la richiesta dell'indexer Wazuh. Aumenta la ResourceQuota del tenant tramite `helm upgrade` con i nuovi valori.
   - Fallimenti nel pull delle immagini → controlla l'autenticazione del registry e il firewall.

Se un tentativo di provisioning non riesce a recuperare, dismetti e riprova:

```bash
# Dall'interfaccia MSSP: dettaglio tenant → Decommission → force=true
# Oppure tramite API:
curl -X POST https://mssp.../api/mssp/tenants/<id>:decommission?force=true
```

## Tenant in stato `degraded`

Lo stato `degraded` viene impostato dal controller di provisioning in caso di fallimento del provisioning, oppure impostato esplicitamente tramite l'API. **In questa release non esiste alcun ciclo di auto-degradazione basato sull'età dell'heartbeat dell'adapter**; la metrica `soctalk_tenant_adapter_heartbeat_age_seconds` è a disposizione del tuo alerting.

1. Controlla il pod dell'adapter:
   ```bash
   kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=200
   ```
2. Controlla l'egress della NetworkPolicy (l'adapter deve raggiungere l'API `soctalk-system`):
   ```bash
   hubble observe --from-pod tenant-<slug>/soctalk-adapter-<pod>
   ```
3. Riavvia l'adapter:
   ```bash
   kubectl -n tenant-<slug> rollout restart deploy/soctalk-adapter
   ```

Se il data plane è integro ma l'adapter continua a non raggiungere `soctalk-system`, ispeziona la NetworkPolicy `adapter-egress`.

## Ruotare la chiave LLM per tenant

1. Admin MSSP → dettaglio cliente → Settings → LLM → incolla la nuova chiave → Save (oppure `PATCH /api/mssp/tenants/{id}/llm`).
2. Lo store autoritativo di SocTalk è `IntegrationConfig.llm_api_key_plain` in Postgres. Il controller di provisioning materializza tale valore in `Secret/tenant-llm-key` nel namespace del tenant (montato dal Deployment runs-worker) e, opzionalmente, replica un riferimento in `soctalk-system/<tenant-id>-llm` a fini di audit.
3. SocTalk riavvia con logica best-effort il Deployment `soctalk-runs-worker` in `tenant-<slug>` in modo che la nuova chiave abbia effetto alla successiva presa in carico di un'indagine.

## Ruotare i secret di bootstrap del data plane

In questa release non esiste alcun comando `soctalk-cli rotate-*` — quel percorso era documentato in bozze precedenti. Ad oggi:

- **Password admin di Wazuh / TheHive / Cortex:** applica una patch al Secret pertinente nel namespace del tenant, quindi riavvia il pod interessato. La riesecuzione del bootstrap del chart all'avvio del pod recupererà la nuova credenziale.
- **Secret condiviso `authd` di Wazuh:** applica una patch a `Secret/wazuh-authd-secret` in `tenant-<slug>`, riavvia il manager Wazuh. Tutti gli agenti esistenti devono ri-effettuare l'enrollment con il nuovo secret; distribuiscilo tramite il tuo normale canale sicuro.

Una CLI wrapper per queste rotazioni è in roadmap.

## Analytics

**Analytics** aggrega il volume di triage, gli esiti delle proposte, l'MTTR e il consumo di budget per tenant. Usala per la pianificazione della capacità, la valutazione dei modelli e la revisione degli SLA.

![Analytics](/screenshots/analytics.png)

## Revisione dell'audit log

L'audit log a livello di MSSP si trova in **UI → tab Audit**. Filtra per tenant, attore, azione o timestamp. Per le esportazioni di conformità, usa l'API:

```bash
curl 'https://mssp.../api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

![Audit log](/screenshots/audit-log.png)

## Ripristino del database (disaster recovery)

I backup sono gestiti esternamente dall'MSSP (Velero, snapshot del cluster, `pg_dump` esterno). Per ripristinare:

1. Ferma l'API SocTalk:
   ```bash
   kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=0
   ```
   (Il chart V1 integra l'orchestrator nel pod dell'API — nessun Deployment `soctalk-system-orchestrator` separato.)
2. Ripristina i dati Postgres dal tuo backup.
3. Riavvia l'API: `kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=2` (o il tuo normale conteggio di repliche).

I PVC del data plane del tenant seguono lo stesso schema: ripristina per singolo namespace, quindi esegui `helm upgrade` della release del tenant per ricollegarli.

## Emergenza: disabilitare immediatamente un tenant

L'azione **Suspend** dell'interfaccia, in questa release, porta lo stato del tenant a `suspended` e impedisce all'orchestrator di pianificare nuove indagini — **ma non scala i workload**. Per un blocco effettivo, esegui i passaggi seguenti (scala tutti i deployment + applica una NetworkPolicy deny-all come ulteriore misura di sicurezza):

```bash
# 1. Scala a zero tutti i workload nel namespace del tenant. Questo è lo
#    stop definitivo — i pod scompaiono.
kubectl -n tenant-<slug> get deploy,statefulset -o name \
  | xargs -I {} kubectl -n tenant-<slug> scale {} --replicas=0

# 2. Deny-all come misura di sicurezza aggiuntiva, così tutto ciò che
#    torna attivo (ad es. da un operatore bloccato in riconciliazione) è isolato.
kubectl -n tenant-<slug> apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: emergency-deny-all }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
EOF
```

Per invertire, elimina la NetworkPolicy, riporta i workload ai conteggi di repliche originali e chiama **Resume** nell'interfaccia. Anche **Resume**, in questa release, aggiorna soltanto lo stato nel DB — non ripristinerà i conteggi di repliche al posto tuo.

## Sospetto di data leak cross-tenant

Se sospetti un accesso cross-tenant:

1. Controlla le esecuzioni recenti della suite di test RLS; passano in CI per ogni release.
2. Sonda direttamente il DB:
   ```bash
   kubectl -n soctalk-system exec -it statefulset/soctalk-system-postgres -- \
     psql -U soctalk_app -d soctalk \
     -c "SET app.current_tenant_id='<tenant-a>'; SELECT tenant_id FROM events LIMIT 5;"
   ```
3. Se un leak è confermato, apri un incidente P1. RLS insieme a `FORCE ROW LEVEL SECURITY` è l'ultima linea di difesa; un leak non risolto indica un bug applicativo o una configurazione errata del ruolo Postgres.

## Errori comuni

- Eseguire le migrazioni come `soctalk_app`. Le migrazioni richiedono le credenziali `soctalk_admin`; con `soctalk_app` falliscono.
- Modificare direttamente i valori `soctalk-tenant` in Helm. Questo aggira lo stato del database di SocTalk; passa attraverso l'API.
- Creare namespace `tenant-*` a mano. Le label richieste non saranno presenti e SocTalk non riconoscerà il namespace. Usa il flusso di creazione del tenant.
