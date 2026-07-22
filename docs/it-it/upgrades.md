# Aggiornamenti

Entrambe le classi di chart si aggiornano tramite `helm upgrade`. Al momento questo è un runbook; una API di aggiornamento per l'intera flotta è nella roadmap.

## Checklist pre-volo

Prima di qualsiasi aggiornamento:

1. **Leggi le [note di rilascio](https://github.com/soctalk/soctalk/releases)** per la versione di destinazione. Le migrazioni sono solo in avanti; una modifica di schema imprevista non può essere annullata con `helm rollback`.
2. **Aggiorna `soctalk-system` prima dei tenant.** Una superficie formale di matrice di compatibilità (System → Versions UI, validazione `controller.can_upgrade`) è descritta in [Chart Contract](/it-it/reference/chart-contract) come obiettivo architetturale ma **non è implementata in questa release**. Finché non arriva, segui la riga "tested combinations" delle note di rilascio, aggiorna prima `soctalk-system`, poi incrementa ciascun tenant una volta verificato l'aggiornamento lato sistema.
3. **Esegui un backup.** Crea uno snapshot di Postgres + tutti i PVC dei tenant. Vedi la [sezione sul ripristino del database](/it-it/operations#database-restore-disaster-recovery) in operations.
4. **Esegui un dry-run** con `helm diff`:
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## Aggiorna `soctalk-system` (livello install)

`soctalk-system-values.yaml` dall'installazione fissa `image.tag` alla release originale. Sovrascrivilo a ogni aggiornamento in modo che il nuovo chart renderizzi la nuova immagine. Puoi incrementare il file nel version control oppure passare `--set image.tag=<new-version>` su ogni comando qui sotto.

Le migrazioni vengono eseguite all'interno del comando di init del pod API (vedi [Install → Migrations and bootstrap](/it-it/install#migrations-and-bootstrap-run-automatically)). Un `helm upgrade` fa ripartire il pod API; il comando di init esegue `alembic upgrade head` prima che la nuova app si avvii. Alembic è idempotente, rieseguirlo su uno schema aggiornato è un no-op.

```bash
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 15m
```

Osserva la migrazione:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Se `--wait` si blocca, la causa più comune è un fallimento della migrazione, leggi i log di init.

### Rollback

```bash
helm rollback soctalk-system <revision> -n soctalk-system --wait
```

Se l'aggiornamento ha introdotto una migrazione che ha toccato i dati, `helm rollback` non ripristinerà lo schema. Ripristina Postgres dal backup pre-aggiornamento in aggiunta.

## Aggiorna il data plane di un singolo tenant

```bash
helm upgrade tenant-<slug> oci://ghcr.io/soctalk/charts/soctalk-tenant \
  --version <new-tenant-chart-version> \
  --namespace tenant-<slug> \
  -f /tmp/tenant-<slug>-values.yaml \
  --wait --timeout 15m
```

`/tmp/tenant-<slug>-values.yaml` è il file di values renderizzato da SocTalk. Al momento non esiste una CLI rivolta all'operatore per esportarlo; estrai gli ultimi values renderizzati dal secret della release Helm del tenant:

```bash
helm get values tenant-<slug> -n tenant-<slug> -a > /tmp/tenant-<slug>-values.yaml
```

Un comando `soctalk-cli render-values` era stato menzionato in precedenza in questa guida ma non esiste, l'unico strumento CLI oggi è `soctalk-auth`.

### Rollback per singolo tenant

```bash
helm rollback tenant-<slug> <revision> -n tenant-<slug> --wait
```

I rollback del data plane dei tenant sono più sicuri di quelli a livello di sistema: gli stack OSS (Wazuh, TheHive, Cortex) memorizzano i propri dati in PVC che `helm rollback` lascia intatti.

## Aggiornamento della flotta (loop manuale)

```bash
# List tenants.
kubectl get ns -l tenant=true,managed-by=soctalk \
  -o jsonpath='{.items[*].metadata.name}'

# Upgrade each, pausing between.
for ns in tenant-acme tenant-beta tenant-gamma; do
  echo "upgrading $ns..."
  helm upgrade ${ns} oci://ghcr.io/soctalk/charts/soctalk-tenant \
    --version <new> -n $ns -f /tmp/${ns}-values.yaml --wait --timeout 15m
  kubectl -n $ns rollout status deploy/soctalk-adapter
  sleep 60   # let heartbeat settle before next.
done
```

Una release futura sostituirà questo loop con una API di aggiornamento della flotta consapevole del canary.

## Ordine di aggiornamento

1. Prerequisiti del cluster (CNI, cert-manager, ingress). Aggiornali in modo indipendente.
2. Il chart `soctalk-system`. Esegue le migrazioni come parte dell'aggiornamento a livello install.
3. Il chart `soctalk-tenant`, un tenant alla volta, monitorando le regressioni.

Non aggiornare mai i chart dei tenant prima di `soctalk-system`. La matrice di compatibilità rifiuta le combinazioni fuori intervallo e l'API si rifiuta di effettuare il provisioning di nuovi tenant su versioni non allineate.

## Aggiornamenti del chart tenant con modifiche incompatibili

Se il chart tenant incrementa una major version di Wazuh, TheHive o Cortex con una modifica di schema:

1. Crea prima uno snapshot dei PVC del tenant.
2. Aggiorna in una finestra a basso traffico.
3. Verifica subito dopo che gli alert fluiscano end-to-end.
4. Preparati a eseguire `helm rollback` più il ripristino dei PVC se il processo di migrazione dello schema del data plane fallisce.

I progetti OSS upstream occasionalmente rilasciano modifiche incompatibili. L'[audit dei chart](/it-it/reference/chart-audit) fissa le versioni esatte dei subchart; l'incremento di tali versioni è esplicito e testato prima della release.
