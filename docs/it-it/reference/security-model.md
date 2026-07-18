# Modello di sicurezza

Catalogo dei principal, matrice attore×risorsa, matrice delle policy RLS, modello dei ruoli Postgres, classificazione degli endpoint, schemi delle claim dei token, requisiti di audit, collocazione dei segreti.

> **Nota sul deployment V1.** Gli esempi di endpoint riportati di seguito (ad es. `/api/mssp/impersonate/:tenant_id`, `/api/mssp/users` POST/list, `/api/mssp/fleet/summary`) e diverse voci del catalogo dei principal (Cloud license issuer; l'attore di impersonation) descrivono la **superficie di sicurezza obiettivo**. Gli endpoint MSSP montati comprendono: CRUD dei tenant, audit (`/api/audit`), gestione degli utenti staff (`/api/mssp/users` create/list/patch/deactivate e `/{id}/password/reset`) e `/api/auth/assume-tenant` per lo scoping della sessione al tenant (non impersonation di utenti). La gestione self-service degli utenti tenant risiede sotto `/api/tenant/users`. Usa le matrici seguenti come intento di progettazione; consulta [REST API](/it-it/reference/api) per ciò che è effettivamente attivo.

## Catalogo dei principal

Otto principal.

| # | Principal | Categoria | Ambito | Autentica tramite |
|---|---|---|---|---|
| 1 | **User** (role ∈ {platform_admin, mssp_admin, mssp_manager, analyst, tenant_admin, tenant_manager, tenant_analyst, customer_viewer}) | Umano | Derivato dal ruolo | Ingress OIDC → SocTalk JWT |
| 2 | **Worker** | Servizio SocTalk (in background) | Un tenant per job | Service JWT, a breve durata, emesso dall'API SocTalk al dispatch |
| 3 | **System** | Servizio SocTalk (operazioni cross-tenant) | Install-wide, RLS-bypass | Gated a livello di code-path; nessun JWT |
| 4 | **SocTalk K8s ServiceAccount** | Servizio SocTalk (identità K8s) | Cluster, con ambito per convenzione di nome a `tenant-*` | Token proiettato K8s |
| 5 | **Tenant adapter** | Sidecar del data plane | Singolo tenant, chiama solo l'API SocTalk | Adapter JWT, con ambito tenant, a breve durata |
| 6 | **Wazuh agent** | Agente endpoint esterno | Wazuh manager di un singolo tenant | Enrollment Wazuh `authd` → mTLS per-agent |
| 7 | **MSSP cluster admin** | Umano, out-of-band | Intero cluster (illimitato) | Credenziali `kubectl` |
| 8 | **Cloud license issuer** | Trust anchor | Autorità di firma offline | Chiave Ed25519 in HSM/KMS (release futura) |

### Ruoli utente

I ruoli sono bundle di capability organizzati in tre livelli per ciascuna audience (operate ⊆ authorize-risk ⊆ configure); il lato tenant aggiunge uno stakeholder in sola lettura al di sotto di operate. Vedi [Utenti e ruoli](/it-it/users-and-roles) per il modello delle capability.

Lato MSSP (`tenant_id` NULL):

| Ruolo | Livello | Funzione tipica |
|---|---|---|
| `platform_admin` | configure (super) | Ogni capability MSSP, install-wide. |
| `mssp_admin` | configure | Configura il sistema, gestisce gli utenti staff, più tutto ciò che segue. |
| `mssp_manager` | authorize-risk | Dichiara gli engagement, cura i fatti di autorizzazione, approva le azioni ad alto impatto, più operate. |
| `analyst` | operate | Triage, revisione dei verdetti, decisione, chat; lavora su un tenant tramite un pin Open-SOC. |

Lato tenant (`tenant_id` impostato):

| Ruolo | Livello | Funzione tipica |
|---|---|---|
| `tenant_admin` | configure | Gestisce gli utenti della propria organizzazione e le impostazioni LLM, più tutto ciò che segue. |
| `tenant_manager` | authorize-risk | Dichiara i propri engagement, asserisce i fatti di autorizzazione (revisionati dall'MSSP), più operate. |
| `tenant_analyst` | operate | Lavora sul SOC del proprio tenant: triage, revisione dei verdetti, decisione, chat. |
| `customer_viewer` | sola visualizzazione | Dashboard e indagini in sola lettura; non può agire né aprire la coda di revisione. |

Derivazione dell'ambito: `role ∈ {platform_admin, mssp_admin, mssp_manager, analyst}` ⇒ `tenant_id` NULL nel DB, accesso cross-tenant tramite ruolo Postgres elevato o scoping della sessione al tenant (`/api/auth/assume-tenant`). `role ∈ {tenant_admin, tenant_manager, tenant_analyst, customer_viewer}` ⇒ `tenant_id` richiesto nella riga utente e nel JWT. Le capability MSSP e le capability tenant non si sovrappongono mai; il guard su ciascuna route verifica insieme capability e audience.

### Disciplina del principal Worker

Ogni job in background deve trasportare `tenant_id` nel proprio payload. Gli entrypoint dei worker sono decorati con `@tenant_scoped_worker` che imposta `app.current_tenant_id` prima di qualsiasi accesso al DB. I worker si connettono come ruolo Postgres `soctalk_app` e sono soggetti a RLS: dimenticare di impostare il contesto produce zero righe, non una fuga cross-tenant.

### Disciplina del principal System

Le operazioni cross-tenant (rollup MSSP, migrazioni, tooling di amministrazione) usano il principal `System` tramite un context manager Python `system_context()`. L'ingresso emette una riga di audit. Il context manager è l'unico gate. `import-linter` impedisce la sua importazione al di fuori dei moduli di sistema designati. Il principal System si connette come ruolo Postgres `soctalk_mssp` che ha `BYPASSRLS`.

## Catalogo delle risorse

### Risorse di database (con ambito tenant)

Tutte hanno una FK `tenant_id` e sono soggette a RLS:

- `Event` — event store, append-only
- `InvestigationReadModel` — stato dell'indagine proiettato
- `MetricsHourly`, `IOCStats`, `RuleStats`, `AnalyzerStats` — proiezioni per-tenant
- `PendingReview` — coda HIL
- `IntegrationConfig` — URL, endpoint e soglie di integrazione per-tenant
- `BrandingConfig` — nome dell'app, logo e colori per-tenant
- `TenantSecret` — riferimenti (ns + name + version) ai Secret K8s; nessun materiale grezzo
- `TenantLifecycleEvent` — log append-only delle transizioni di stato del tenant, revisioni di configurazione
- `AuditLog` — log append-only delle azioni di mutazione, con `mssp_user_id` quando eseguite tramite impersonation

### Risorse di database (con ambito install)

Nessun `tenant_id`; con ambito Organization o globale:

- `Organization` — install-wide (mssp_id, mssp_name, install_id, install_label, license_jwt riservato)
- `User` — sia utenti lato MSSP (tenant_id nullable) sia utenti cliente (tenant_id richiesto)
- Semantica MSSP-user / Tenant-user derivata dalla presenza di role + tenant_id; tabella singola
- `Release` — metadati di versione SocTalk (install-wide)
- Impostazioni di install (feature flag, toggle a livello di sistema)

### Risorse Kubernetes

| Risorsa | Ambito | Gestita da |
|---|---|---|
| Namespace `soctalk-system` | Livello install | MSSP cluster admin (creato da Helm) |
| Namespace `tenant-<slug>` | Per tenant | SocTalk K8s ServiceAccount (verb di cluster) |
| `Deployment`, `Service`, `PVC`, `Secret`, `ConfigMap`, `NetworkPolicy`, `ResourceQuota`, `LimitRange`, `ServiceAccount`, `Role`, `RoleBinding` in `tenant-*` | Per tenant | SocTalk K8s ServiceAccount |

## Matrice attore × risorsa

`R` = lettura, `W` = scrittura, `-` = negato.

| Gruppo di risorse | `platform_admin` | `mssp_admin` | `analyst` | `customer_viewer` | `Worker` | `System` | `SocTalk K8s SA` | `Tenant adapter` |
|---|---|---|---|---|---|---|---|---|
| DB con ambito tenant (proprio tenant) | RW (qualsiasi) | RW (qualsiasi) | RW (qualsiasi) | R (proprio) | RW (tenant del job) | RW (qualsiasi via bypass) | - | - |
| DB con ambito install | RW | R (meno license) | R | - | R | RW | - | - |
| Gestione utenti (lato MSSP) | RW | RW | - | - | - | RW | - | - |
| Gestione utenti (lato tenant, proprio tenant) | - | - | - | - | - | - | - | - |
| Audit log (proprio tenant) | R tutto | R tutto | R tutto | R proprio | W | W | - | W (via bootstrap) |
| Namespace K8s `tenant-*` | (solo via API) | (solo via API) | (solo via API) | - | - | - | CRUD | - |
| Risorse K8s all'interno di `tenant-*` | (solo via API) | (solo via API) | (solo via API) | - | - | - | CRUD | R self |
| Secret LLM per-tenant | - | - | - | - | R (proprio tenant) | - | mount | - |
| Secret di integrazione per-tenant | - | - | - | - | R (proprio tenant) | - | mount | - |

Note:
- Le colonne mostrano un sottoinsieme rappresentativo dei ruoli. `mssp_manager` si colloca tra `mssp_admin` e `analyst` (livello authorize-risk); `tenant_manager` e `tenant_analyst` si collocano sopra `customer_viewer` sul lato tenant. Ciascuno detiene ogni capability del livello sottostante.
- La gestione degli utenti è separata per audience a livello di capability. Gli utenti staff MSSP sono gestiti solo da `mssp_admin`/`platform_admin` tramite `/api/mssp/users`; gli utenti tenant sono gestiti solo dal `tenant_admin` di quel tenant tramite `/api/tenant/users`. Un admin MSSP non gestisce gli utenti tenant, e viceversa. Assegnare `platform_admin`, e mutare un `platform_admin` esistente, richiedono un `platform_admin`.
- "solo via API" significa che il principal umano attiva le operazioni K8s chiamando gli endpoint dell'API SocTalk, non direttamente. Gli handler dell'API usano il SocTalk K8s ServiceAccount.
- `analyst` che agisce su un tenant scrive righe di audit con sia `user_id` sia il `tenant_id` del tenant; la vista di audit lato cliente le mostra come voci di impersonation.

## Matrice delle policy RLS

Vedi [Postgres RLS](/it-it/reference/postgres-rls) per l'SQL. Riepilogo:

| Tabella | Policy | `USING` | `WITH CHECK` |
|---|---|---|---|
| Tutte le tabelle con ambito tenant | `tenant_isolation` | `tenant_id = current_setting('app.current_tenant_id')::uuid` | uguale |
| `User` (dove `tenant_id IS NOT NULL`) | uguale | uguale | uguale |
| `AuditLog` | `audit_read` | uguale per la lettura; scritture consentite da Worker + System | uguale |
| Tabelle con ambito install | nessun RLS | — | — |

Tutte le tabelle con ambito tenant hanno `FORCE ROW LEVEL SECURITY` cosicché anche il proprietario della tabella (`soctalk_admin`) è soggetto a RLS. Il principal System usa il ruolo `soctalk_mssp` (`BYPASSRLS`) per attraversare i tenant intenzionalmente.

## Classificazione degli endpoint API

Tre categorie. Mai un singolo endpoint che serve due categorie.

### `/api/mssp/*`: lato MSSP (richiede un ruolo MSSP; la capability specifica varia per route)

Abilitato al cross-tenant. Quando un handler necessita di visibilità cross-tenant (rollup, viste di fleet), usa il principal `System` tramite `system_context()`. Quando un handler agisce su un tenant specifico (impersonation), imposta `app.current_tenant_id` e resta soggetto a RLS.

Esempi (questa release): `POST /api/mssp/tenants/onboard`, `GET /api/mssp/tenants`, `POST /api/mssp/tenants/{id}:retry`, `POST /api/mssp/tenants/{id}:suspend|:resume|:decommission`, `GET /api/audit`, gestione degli utenti staff MSSP sotto `/api/mssp/users`. (Impersonation e rollup di fleet sono nella roadmap.)

### `/api/tenant/*`: lato tenant (richiede un ruolo tenant; la capability specifica varia per route)

Con ambito rigido. Contesto tenant dal JWT; nessuna voce di impersonation. Tutte le query sono applicate tramite RLS via `soctalk_app`. Include le superfici operate per `tenant_analyst`+ (triage, revisione, chat) e self-service per engagement, fatti di autorizzazione e utenti.

Esempi: `GET /api/tenant/overview`, `GET /api/tenant/incidents`, `GET /api/tenant/reports`, `GET /api/tenant/audit`, `GET /api/tenant/branding`.

### `/api/internal/*` — Service-to-service (Worker JWT o Adapter JWT)

Non esposto agli utenti. Service JWT a breve durata con contesto tenant esplicito. Esempi: `POST /api/internal/adapter/health`, `POST /api/internal/adapter/bootstrap`, `GET /api/internal/adapter/config`.

Nessun endpoint accetta insieme la semantica `/api/mssp/*` e `/api/tenant/*`. Se una capability è necessaria su entrambi i lati, viene implementata come due endpoint con authz diverse e flussi di contesto diversi.

## Schemi delle claim dei token

### JWT utente lato MSSP

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "iat": 1713475200,
  "exp": 1713478800,
  "jti": "<uuid>",
  "user_type": "mssp",
  "role": "platform_admin | mssp_admin | mssp_manager | analyst",
  "current_tenant": null
}
```

Quando un `mssp_admin` o un `analyst` entra nel contesto tenant, viene coniato un nuovo token a breve durata con `current_tenant: "<tenant_uuid>"`. I token di impersonation hanno un TTL massimo di 30 minuti e vengono registrati al momento della coniazione.

### JWT utente lato tenant

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "user_type": "tenant",
  "role": "tenant_admin | tenant_manager | tenant_analyst | customer_viewer",
  "tenant_id": "<tenant_uuid>"
}
```

### JWT di servizio Worker

```json
{
  "iss": "soctalk",
  "sub": "worker",
  "user_type": "worker",
  "tenant_id": "<tenant_uuid>",
  "job_id": "<uuid>",
  "job_type": "triage | enrich | decide | ..."
}
```

### Adapter JWT

```json
{
  "iss": "soctalk",
  "sub": "adapter",
  "user_type": "adapter",
  "tenant_id": "<tenant_uuid>",
  "scope": "adapter"
}
```

Gli Adapter JWT vengono rinnovati settimanalmente; la rotazione è una riscrittura del segreto lato SocTalk-controller nel namespace del tenant.

## Requisiti di audit

Ogni mutazione scrive una riga `AuditLog` con:

- `id` (uuid), `timestamp`, `tenant_id` (nullable per eventi con ambito install)
- `actor_principal` (User | Worker | System | Adapter)
- `actor_id` (user_id | `worker:<job_id>` | `system:<reason>` | tenant_id dell'adapter)
- `action` (enum: `tenant.create`, `tenant.suspend`, `investigation.approve`, `settings.update`, `user.impersonate`, …)
- `resource_type`, `resource_id`
- `before`, `after` (snapshot JSON per le azioni che modificano lo stato)
- `acting_as` (nullable; impostato quando un `mssp_admin` o un `analyst` sta impersonando un tenant)
- `request_id` (correla con le righe di log)

La retention è di 90 giorni; configurabile per-install in una release futura. I clienti possono visualizzare le righe di audit dove `tenant_id = own`, incluse le voci con `acting_as` valorizzato (trasparenza sulle azioni dell'MSSP). La vista di audit cross-tenant dell'MSSP viene eseguita sotto il principal `System`.

## Limiti architetturali noti

- **Fiducia nell'MSSP cluster admin.** Il principal #7 ha accesso K8s illimitato. Il modello di isolamento di SocTalk presuppone che questo principal sia fidato. I clienti che richiedono difesa contro la minaccia interna a livello MSSP necessitano di tiering su nodo dedicato o VM dedicata (release futura).
- **Ambito del confine di admission.** `ValidatingAdmissionPolicy` vincola il ServiceAccount del controller SocTalk per i namespace dei tenant e le mutazioni di risorse con namespace, ma gli utenti MSSP cluster-admin restano operatori break-glass fidati. Kyverno è un percorso di hardening opzionale futuro.
- **Attualmente nessuna applicazione delle licenze.** JWT di licenza e feature gate rinviati a una release futura. Gli MSSP pilota operano sulla fiducia.
- **Cache delle risposte LLM.** Con chiave su `(tenant_id, prompt_hash)` fin dal primo giorno. Se mai allentata, rischio di fuga di contenuti cross-tenant; la test suite asserisce la composizione della chiave.
- **Sottoscrizioni SSE.** Con ambito tenant al momento della sottoscrizione. Bug di persistenza della connessione potrebbero consegnare eventi cross-tenant su una sottoscrizione stale; test esplicito di isolamento SSE nell'implementation gate.
- **Fuga di contesto del Worker.** Ogni entrypoint di worker deve impostare `app.current_tenant_id`. Il default difensivo è zero righe sotto RLS, non una fuga cross-tenant, ma la test suite asserisce la difesa.

## Requisiti di test

1. **Probe API cross-tenant.** Per ogni endpoint `/api/tenant/*` e `/api/mssp/*` che accede a dati con ambito tenant, costruisci richieste come tenant A che tentano letture o scritture di risorse del tenant B. Asserisci 0 righe o 403.
2. **Probe RLS su SQL grezzo.** Connettiti come `soctalk_app`, imposta `app.current_tenant_id = A`, esegui `SELECT * FROM events` (senza filtro); asserisci che vengano restituite solo le righe del tenant A.
3. **Default di contesto del Worker.** Effettua il dispatch di un job worker senza impostare il contesto tenant; asserisci che le query restituiscano 0 righe (comportamento defensive-zero).
4. **Isolamento SSE.** Sottoscrivi come tenant A l'SSE degli eventi; muta nel tenant B; asserisci che nessun evento venga consegnato sullo stream di A.
5. **Isolamento della cache LLM.** Attiva prompt identici dal tenant A e dal tenant B; asserisci cache miss alla seconda chiamata per B (chiave diversa) e cache hit alla terza chiamata per A (stessa chiave).
6. **Audit di impersonation.** Come `mssp_admin`, impersona il tenant A, esegui una mutazione; asserisci che esista una riga `AuditLog` con `acting_as=<mssp_admin_id>` e `tenant_id=A`; asserisci che l'utente cliente in A possa leggere la riga.
7. **Audit di contesto System.** Attiva una chiamata `/api/mssp/fleet/summary`; asserisci una riga di audit per l'ingresso in contesto system con motivazione.
