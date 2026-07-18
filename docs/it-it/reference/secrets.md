# Policy di collocazione dei secret

> **Nota sul deployment V1.** Diverse voci qui sotto fanno riferimento agli "orchestrator pod" come workload distinto — nel chart V1 l'orchestrator è co-locato nel Deployment `soctalk-system-api`, quindi i riferimenti a "orchestrator pod" indicano il "pod API" in questa release. Anche gli specifici nomi dei Secret K8s possono variare leggermente rispetto ai nomi resi dal chart (vedi [`charts/soctalk-system/templates/60-secrets.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/60-secrets.yaml) per la fonte di verità).

## Invariante (obiettivo)

**Obiettivo:** nessun materiale segreto in chiaro nel database di SocTalk. Le tabelle Postgres che tracciano i secret memorizzano solo riferimenti: `(namespace, name, version_label)`. Il materiale stesso risiede in un oggetto `Secret` di Kubernetes, montato nel pod che ne ha bisogno.

**Oggi (V1):** esiste **un'eccezione documentata** — `IntegrationConfig.llm_api_key_plain` nel database memorizza le chiavi API LLM per-tenant in chiaro. Ciò è necessario perché il runs-worker legge la chiave dal proprio contesto tenant al momento della presa in carico dell'indagine, e il chart V1 non collega ancora i Secret LLM per-tenant attraverso la pod spec. Considera le credenziali Postgres come protezione di queste chiavi e ruota le chiavi del provider LLM come se fossero esposte se la credenziale del DB viene ruotata.

Le altre categorie di secret — firma JWT, ruoli Postgres, credenziali di integrazione, Wazuh authd — risiedono tutte in Secret K8s e sono referenziate per nome dal DB, non memorizzate inline. Gli obiettivi architetturali (di seguito) descrivono lo stato di destinazione per tutte le classi di secret:

- Limita il raggio d'azione di una compromissione del DB di SocTalk (nessuna fuga di materiale).
- Consente il funzionamento dei meccanismi di rotazione nativi di K8s (aggiornamento del Secret → il pod acquisisce il nuovo valore al rimontaggio o alla lettura successiva del Secret).
- Si allinea con il percorso di integrazione di External Secrets Operator previsto in una release futura.

## Inventario dei secret V1 (ciò che il chart rende effettivamente oggi)

| Secret | Materiale | Posizione | Utilizzato da | Rotazione |
|---|---|---|---|---|
| `soctalk-system-postgres-admin-creds` | user/pw | ns `soctalk-system` | Solo container `db-init` del pod API (migrazioni + bootstrap) | Manuale |
| `soctalk-system-postgres-app-creds` | user/pw | ns `soctalk-system` | Pod API (runtime, soggetto a RLS) | Manuale |
| `soctalk-system-postgres-mssp-creds` | user/pw | ns `soctalk-system` | Pod API (query cross-tenant `system_context()`) | Manuale |
| `soctalk-system-jwt-signing-key` | secret HMAC | ns `soctalk-system` | Pod API | Manuale |
| `soctalk-system-adapter-signing-key` | chiave HMAC | ns `soctalk-system` | Pod API (emette token adapter per-tenant) | Manuale |
| `soctalk-system-bootstrap-admin` | email + password | ns `soctalk-system` | Solo container `db-init` del pod API | Manuale |
| `soctalk-system-llm-api-key` | chiavi API del provider (anthropic-api-key + openai-api-key) | ns `soctalk-system` | Pod API (default a livello di installazione) | Manuale |
| `adapter-token` | bearer token | ns `tenant-<slug>` | Pod adapter del Tenant | Emesso al provisioning; rotazione tramite ri-provisioning |
| `runs-worker-token` | bearer token | ns `tenant-<slug>` | Pod runs-worker del Tenant (chiama `/api/internal/worker/runs/*`) | Come sopra |
| `tenant-llm-key` | chiave API LLM | ns `tenant-<slug>` | Pod runs-worker del Tenant (montato tramite `secretKeyRef`) | Avviata dall'MSSP tramite `PATCH /api/mssp/tenants/{id}/llm`; il controller la materializza da `IntegrationConfig.llm_api_key_plain` + riavvia il runs-worker |
| `tenant-<id>-llm` | chiave API LLM (copia legacy / di audit) | ns `soctalk-system` | Non montato da alcun pod V1 | Come sopra; questa copia viene scritta per l'audit ma **non è la fonte autoritativa** letta dal runs-worker |
| `wazuh-authd-secret` | shared secret | ns `tenant-<slug>` | Wazuh manager (enrollment) | Rigenera per forzare il re-enrollment di tutti gli agent |
| `wazuh-<slug>-wazuh-creds` | user/pw | ns `tenant-<slug>` | Wazuh manager + pod linux-ep (enrollment degli agent) | Generato al provisioning |

**Il Triage viene eseguito in `soctalk-runs-worker` in ciascun namespace `tenant-<slug>`** (non nel pod API centrale). Per questo motivo i secret per-tenant vengono montati nel namespace del tenant, non in `soctalk-system`.

La chiave API LLM è **memorizzata anche in chiaro in `IntegrationConfig.llm_api_key_plain`** in Postgres — vedi la clausola sull'invariante sopra. Il Secret K8s viene materializzato dal valore del DB al momento del provisioning / della rotazione.

Voci obsolete da bozze precedenti (ora rimosse): `tenant-<id>-wazuh`, `tenant-<id>-thehive`, `tenant-<id>-cortex`, `wazuh-bootstrap`, `thehive-bootstrap`, `cortex-bootstrap`, `cassandra-creds`, `soctalk-license`. `tenant-<id>-llm` in `soctalk-system` esiste ancora in V1 come copia legacy/di audit, ma **non** è ciò che legge il runs-worker. La sezione sull'architettura sotto descrive la motivazione progettuale; solo l'inventario sopra è aggiornato.

## Collocazione della chiave LLM per-tenant

Il Triage viene eseguito nel pod `soctalk-runs-worker` per-tenant (nel namespace `tenant-<slug>`), **non** nel pod API centrale. Per questo motivo le chiavi LLM per-tenant risiedono nel namespace del tenant:

- **Store autoritativo:** `IntegrationConfig.llm_api_key_plain` in Postgres.
- **Fonte montata:** `Secret/tenant-llm-key` in `tenant-<slug>`, materializzato dal controller a partire dal valore del DB.
- **In caso di rotazione (`PATCH /api/mssp/tenants/{id}/llm`):** il controller riscrive il Secret nel namespace del tenant e riavvia `Deployment/soctalk-runs-worker` affinché la nuova chiave abbia effetto alla successiva presa in carico di un'indagine.

`Secret/tenant-<id>-llm` nel namespace `soctalk-system` esiste anch'esso come copia legacy / di audit derivante da iterazioni di design precedenti, ma **non** è montato da alcun pod V1. In V1 non esiste alcun mount di Secret cross-namespace.

L'alternativa (ns per-tenant per la chiave LLM di ciascun tenant) viene rivalutata in una release futura con External Secrets Operator, dove ESO può sincronizzare i secret memorizzati in un vault esterno in qualunque namespace ne abbia bisogno.

## Secret di bootstrap del data plane

Le credenziali admin di Wazuh/TheHive/Cortex risiedono nei rispettivi namespace tenant perché:

- Questi pod ne hanno bisogno all'avvio (init container, setup al primo avvio).
- Le complicazioni del mounting cross-ns descritte sopra.
- Il raggio d'azione di una compromissione del namespace espone già i pod stessi; collocare il secret di bootstrap nello stesso namespace non aggiunge rischio.

I secret di bootstrap vengono generati dal controller di SocTalk al momento del provisioning del tenant:
1. Il controller genera valori casuali (es. `openssl rand -hex 32`).
2. Il controller crea un `Secret` nel ns di destinazione `tenant-<slug>`.
3. Il controller registra il riferimento `(tenant-<slug>, wazuh-bootstrap, v1)` nella tabella `TenantSecret`.
4. Il controller rende i values del chart tenant referenziando il Secret per nome.
5. `helm install` procede; i pod del data plane leggono le credenziali all'avvio.

Se il materiale viene perso (es. Secret eliminato), il ri-provisioning rigenera nuove credenziali. I pod del data plane si riavviano; gli eventuali servizi dipendenti si reinizializzano. Gli agent sugli endpoint del cliente (che dipendono dal secret di enrollment di Wazuh) necessitano di re-enrollment se quello specifico secret viene ruotato: documentato nel runbook operativo.

## Convenzioni per la generazione dei secret

Al momento del provisioning del tenant, il controller di SocTalk genera:

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

SocTalk memorizza riferimenti ed etichette di versione; non conserva il materiale in memoria oltre la chiamata di provisioning.

## Rotazione (realtà V1)

1. **Rotazione della chiave LLM per-tenant** (avviata dall'MSSP tramite `PATCH /api/mssp/tenants/{id}/llm`):
   - Store autoritativo aggiornato in Postgres (`IntegrationConfig.llm_api_key_plain`).
   - Il controller riscrive `Secret/tenant-llm-key` in `tenant-<slug>` (non nel namespace di sistema).
   - Il controller riavvia `Deployment/soctalk-runs-worker` nel namespace del tenant affinché la nuova chiave abbia effetto alla successiva presa in carico. **Il riavvio del pod è necessario** — la V1 non ricarica i secret a runtime.

2. **Rotazione delle credenziali admin di Wazuh / TheHive / Cortex** (manuale, runbook):
   - `kubectl patch secret <name> -n tenant-<slug> ...` per riscrivere la credenziale.
   - `kubectl rollout restart` del workload interessato affinché la rilegga.
   - Una CLI wrapper per questo (`soctalk-cli rotate-admin`) era documentata in bozze precedenti ma **non è implementata** in V1.

3. **Rotazione delle credenziali Postgres** (manuale, runbook):
   - `ALTER ROLE soctalk_app WITH PASSWORD ...` in Postgres.
   - `kubectl patch secret soctalk-system-postgres-app-creds ...` (attenzione al nome reso dal chart).
   - `kubectl rollout restart deploy soctalk-system-api` — in V1 non esiste un orchestrator pod separato (l'orchestrator è co-locato nel pod API).

4. **Rotazione della chiave di firma JWT** (una release futura): la rotazione senza downtime richiede il supporto di due chiavi valide durante la transizione. Questa release la rimanda; la rotazione manuale impone una finestra in cui tutti gli utenti devono ri-autenticarsi.

## Controllo degli accessi

L'RBAC di Kubernetes limita quali ServiceAccount possono leggere quali Secret:

- SA `soctalk-system-api` in `soctalk-system`: può leggere i Secret in `soctalk-system` (credenziali Postgres, chiavi di firma JWT/adapter). È inoltre autorizzato a scrivere Secret nei namespace `tenant-*` (necessario per creare/ruotare i secret di bootstrap dei tenant) — il chart V1 consolida i ruoli API + controller in questo SA.
- `ServiceAccount` per-tenant in `tenant-<slug>`: può leggere solo i secret nel proprio namespace. Può leggere i propri `adapter-token` / `runs-worker-token` / `tenant-llm-key`, ma mai la chiave di firma di sistema.
- Il `soctalk-orchestrator-sa` delle bozze precedenti non esiste in V1 — l'orchestrator gira all'interno del pod API sotto il SA dell'API.

I template `Role`/`RoleBinding` fanno parte del chart `soctalk-system` (per i SA di SocTalk) e del chart `soctalk-tenant` (per i SA per-tenant).

## Anti-pattern esplicitamente respinti

- **Iniezione di secret via variabili d'ambiente da file `.env`** (attuale pattern V0): va bene per una singola organizzazione, non per il multi-tenant. Tutti i secret si spostano nei Secret K8s.
- **Secret nel values.yaml di Helm**: mai: i file dei values finiscono in Git, nei log CI, nella history di Helm. Il controller di SocTalk rende gli oggetti Secret separatamente e usa `valueFrom.secretKeyRef` nei template.
- **Chiave LLM unica condivisa per tutti i tenant**: esplicitamente fuori scope per il BYO LLM. Sempre chiavi per-tenant.
- **Secret nei ConfigMap**: vietato. I ConfigMap sono per configurazioni non sensibili; i Secret per quelle sensibili.

## External Secrets Operator (percorso per una release futura)

Una release futura introduce l'integrazione con External Secrets Operator:

- L'MSSP fornisce un backend di secret (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
- Le risorse `ExternalSecret` referenziano i path del backend; ESO sincronizza verso i Secret K8s.
- Le chiavi LLM per-tenant vengono memorizzate nel backend con path come `secret/mssp-abc/tenants/acme/llm`.
- La rotazione avviene nel backend; ESO propaga entro l'intervallo di refresh.

La struttura (riferimenti in Postgres → Secret K8s → mount) è compatibile: cambia solo la fonte del Secret (gestita da ESO vs scritta dal controller di SocTalk).
