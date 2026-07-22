# Backup e ripristino

Cosa esegue in backup un MSSP, con quale frequenza e come ripristinare. SocTalk mantiene tre livelli di stato; ciascuno ha il proprio percorso di backup e ripristino.

Questa pagina approfondisce [Operazioni quotidiane, Ripristino del database](/it-it/operations#database-restore-disaster-recovery), che è la stessa procedura documentata a livello di runbook. Usa questa pagina per pianificare la strategia; usa la sezione operativa per i comandi da digitare.

## Cosa mettere in backup

### 1. Postgres (il control plane)

`soctalk-system-postgres-0` contiene:

- Righe dei Tenant + eventi del ciclo di vita
- Utenti, sessioni, ruoli
- Indagini, casi, run, proposte
- Impostazioni (LLM, integrazioni, branding)
- `audit_log` append-only e `case_events` event-sourced
- Righe dell'outbox in attesa di consumo da parte dell'executor

**Tolleranza alla perdita: zero**. Un Postgres perso = cronologia di audit persa, nessuna indagine recuperabile.

### 2. Kubernetes Secrets in `soctalk-system`

| Secret (nome renderizzato dal chart) | Contenuto |
|---|---|
| `soctalk-system-llm-api-key` | API key del provider LLM (default a livello di installazione) |
| `soctalk-system-bootstrap-admin` | Email + password dell'admin iniziale (se `install.bootstrapAdmin.password` è impostato nei values) |
| `soctalk-system-jwt-signing-key` | Chiave di firma dei token di sessione |
| `soctalk-system-adapter-signing-key` | Chiave di firma dei token dell'adapter |
| `soctalk-system-postgres-admin-creds` | Credenziali Postgres `soctalk_admin` (migrazioni) |
| `soctalk-system-postgres-app-creds` | Credenziali Postgres `soctalk_app` (runtime) |
| `soctalk-system-postgres-mssp-creds` | Credenziali Postgres `soctalk_mssp` (query cross-tenant) |
| `soctalk-slack-creds` | Token Slack (forniti via env; non renderizzati dal chart) |
| `soctalk-thehive-creds` | API key TheHive (fornita via env) |
| `soctalk-cortex-creds` | API key Cortex (fornita via env) |

Un set rigenerato di Secrets è recuperabile, ma le sessioni in corso si interrompono e le credenziali delle integrazioni devono essere reinserite.

### 3. PVC per-tenant

Per ogni namespace `tenant-<slug>`:

| PVC | Contenuto |
|---|---|
| `wazuh-indexer-data` | Tutta la cronologia degli Alert e degli eventi Wazuh |
| `wazuh-manager-data` | Registrazioni degli agent Wazuh + stato del manager |
| `cortex-data` | Elasticsearch di Cortex (se Cortex è abilitato) |
| `thehive-data` | Cassandra di TheHive (se TheHive è abilitato) |

I tenant con profilo `poc` usano `local-path`, che **non offre alcuna reale garanzia di persistenza**: il riavvio di un nodo può causare la perdita dei dati. I tenant con profilo `persistent` usano qualunque StorageClass l'installazione contrassegni come default; esegui il backup secondo la documentazione di quel provisioner.

## Cadenza

| Livello | Cadenza suggerita | Retention |
|---|---|---|
| Backup logico Postgres (`pg_dump`) | giornaliera | 30 giorni |
| Archiviazione WAL Postgres | continua | 7 giorni |
| Snapshot dei Kubernetes Secrets | settimanale + a ogni rotazione | 90 giorni |
| PVC per-tenant | in linea con lo SLA del cliente (tipicamente giornaliera per attività di compliance) | da contratto |

I clienti soggetti a compliance (PCI, HIPAA, SOC 2) richiedono spesso retention più lunghe. Considera i valori sopra come il minimo indispensabile.

## Backup di Postgres

### pg_dump (logico)

Viene eseguito sul database live, senza downtime. Ripristino più lento rispetto al backup fisico, ma si comprime bene ed è portabile.

```bash
kubectl -n soctalk-system exec soctalk-system-postgres-0 -- \
  pg_dump -U soctalk_app -d soctalk -Fc -Z 9 \
  > soctalk-$(date +%Y%m%d).pgdump
```

Invia tramite pipe al tuo consueto store offsite (S3, GCS, Azure Blob).

### Archiviazione WAL (point-in-time)

**Non integrata nel chart in questa release.** Il chart `soctalk-system` non espone un value `postgres.archiveCommand`, quindi il PITR richiede un deployment Postgres esterno allo StatefulSet incluso nel chart. Due percorsi:

1. **Eseguire Postgres esternamente** (RDS gestito / Cloud SQL / Azure Database for PostgreSQL). Configura l'archiviazione WAL / PITR secondo la documentazione del provider. **Puntare il chart a un Postgres esterno non è integrato tramite values in V1**: il chart codifica in modo fisso i dettagli di connessione dello StatefulSet incluso nei Secrets delle credenziali di ruolo. Oggi questo significa o eseguire un proprio overlay helm che modifica la variabile env `DATABASE_URL` del Deployment dell'API, oppure modificare `soctalk-system-postgres-app-creds` / `-mssp-creds` / `-admin-creds` dopo l'installazione. Un value `postgres.external` è in roadmap.
2. **Sidecar archiver** nel tuo overlay helm (ad esempio, [`spilo`](https://github.com/zalando/spilo) o [`wal-g`](https://github.com/wal-g/wal-g) come sidecar). Fuori dallo scope del chart; viene eseguito come Deployment separato che invia in streaming i WAL verso l'object storage.

In entrambi i casi il lato SocTalk resta invariato, il data plane tratta Postgres come una dipendenza esterna. L'integrazione di un `archiveCommand` lato chart è pianificata per una release futura.

## Ripristino (Postgres)

Consulta il [runbook](/it-it/operations#database-restore-disaster-recovery). Riepilogo:

1. Scala l'API a zero così che nulla stia scrivendo (il chart V1 integra l'orchestrator nel pod dell'API, un unico Deployment).
2. Esegui `pg_restore` del dump (pulendo prima il DB).
3. Se usi i WAL: riproduci i WAL fino al point-in-time desiderato.
4. Riporta l'API in alto (scale up).

Dopo il ripristino, il pod dell'API (che nel chart V1 incorpora l'orchestrator) potrebbe aver bisogno di una spinta per riprendere le run in sospeso:

```bash
kubectl -n soctalk-system rollout restart deploy soctalk-system-api
```

## Backup dei Secrets

I Secrets K8s sono complessi da mettere in backup in modo sicuro a causa del materiale segreto. Due pattern:

### Sealed Secrets (consigliato)

Installa [Bitnami sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) una volta per cluster. Converti i tuoi Secrets in risorse `SealedSecret`; committa queste in git. Il controller del cluster le decifra al momento dell'installazione. La perdita di un Secret è recuperabile da git.

### Velero con restic / kopia

[Velero](https://velero.io) esegue il backup delle risorse Kubernetes (Secrets inclusi) più i PVC verso l'object storage. Usa lo [snapshotter CSI in-tree](https://velero.io/docs/main/csi/) per i PVC e il backup standard delle risorse per i Secrets.

```bash
velero backup create soctalk-system-daily \
  --include-namespaces soctalk-system \
  --snapshot-volumes \
  --schedule "0 2 * * *"
```

## Backup dei PVC per-tenant

I tenant con profilo `persistent` usano una StorageClass reale; utilizza gli strumenti di snapshot di quel provisioner:

- **Longhorn**: backup schedulati integrati verso S3
- **Rook/Ceph**: snapshot RBD o `cephfs-mirror`
- **Volumi cloud CSI (EBS/Persistent Disk/Azure Disk)**: API native di snapshot

Per chi usa Velero, `velero backup create tenant-<slug>-daily --include-namespaces tenant-<slug> --snapshot-volumes` copre in un'unica operazione sia i PVC sia gli oggetti K8s.

## Ripristino per-tenant

1. Dismetti il tenant esistente (se presente), questo elimina il namespace.
2. Ripristina i PVC in un namespace nuovo a partire dallo snapshot.
3. Effettua l'onboarding di un tenant con lo stesso slug e profilo tramite `POST /api/mssp/tenants/onboard`: il provisioning è idempotente sul namespace, quindi l'installazione Helm adotterà i PVC ripristinati.
4. Verifica che Wazuh veda gli agent esistenti (nessuna re-enrollment necessaria se il ripristino dei PVC è stato pulito).

Se è corrotto solo il data plane (non il control plane di SocTalk), il percorso più semplice è `helm rollback tenant-<slug>` seguito dal ripristino dei PVC in-place.

## Esercitazione di ripristino

Esegui un'esercitazione di ripristino con cadenza trimestrale. Scegli un cluster non di produzione o un tenant temporaneamente messo a riposo. Fissa un time-box di 4 h. Documenta ciò che è fallito e aggiorna questa pagina.

Errori comuni che l'esercitazione intercetta:

- Gap nei WAL (l'archiviazione è rimasta indietro durante un guasto di un nodo)
- Secrets ruotati dopo l'ultimo backup
- Discordanza di StorageClass tra cluster e snapshot
- Network policy che impedisce al pod ripristinato di raggiungere il nuovo Postgres

## Cosa non è coperto qui

- Disaster recovery a livello di cluster (perdita di un nodo del control plane, ecc.), sono operazioni Kubernetes, non specifiche di SocTalk. Consulta la documentazione della tua distribuzione.
- Recupero delle credenziali del provider LLM, fuori scope; gestiscilo con il tuo consueto runbook di rotazione dei segreti.
- Backup degli endpoint lato cliente, responsabilità del cliente, non dell'MSSP.
