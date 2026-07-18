# Utenti e ruoli

Come funzionano i ruoli, chi può fare cosa e come gli amministratori creano utenti, distribuiscono il portale clienti e ruotano le password. Per una guida passo-passo del provisioning e del ciclo di vita dell'utente con screenshot, vedi [Gestione degli utenti: una guida pratica](/it-it/manage-users). Vedi [Internal Auth](/it-it/reference/internal-auth) per il riferimento a livello di protocollo e [Security Model](/it-it/reference/security-model) per la matrice ruolo/risorsa.

## Come viene deciso l'accesso

L'accesso sta passando a un modello a capacità. Ogni ruolo è un insieme denominato di capacità e le superfici costruite o rielaborate per esso (il flusso di operate e revisione, la chat, il self-service tenant per le engagement, gli authorization fact e gli utenti) richiedono la capacità di cui hanno bisogno anziché un ruolo specifico. Su quelle route, aggiungere un ruolo è una questione di definire il suo insieme; i call site non cambiano. Altre route continuano a filtrare direttamente per ruolo o audience, tra cui la gestione dei tenant MSSP, la configurazione di LLM e branding, il reset della password amministrativo e diverse route di dashboard, analytics e indagine. Queste vengono aggiornate a mano quando i ruoli cambiano. Considera l'accesso basato sulle capacità come la direzione, non come lo stato universale attuale.

I ruoli sono organizzati in livelli (tier) e gli stessi tier operativi esistono su entrambi i lati del business:

- **operate**: lavorare la coda. Visualizzare e fare triage delle indagini, revisionare i verdetti dell'AI, decidere, approvare le proposte standard-blast, usare la chat.
- **authorize risk**: tutto ciò che può fare operate, più dichiarare le engagement di pentest, curare gli authorization fact e approvare le azioni high-blast che scrivono su un sistema esterno.
- **configure**: tutto ciò che può fare il manager, più le impostazioni che quel ruolo controlla e la gestione degli utenti.

Un tier superiore possiede ogni capacità del tier inferiore. Il lato tenant aggiunge un ulteriore tier sotto operate, uno stakeholder in sola lettura (`customer_viewer`) che può vedere ma non agire; il lato MSSP non ha equivalente, poiché il suo ruolo più basso (`analyst`) già opera.

L'audience è una barriera separata sopra i tier. I ruoli MSSP possiedono solo capacità MSSP e i ruoli tenant possiedono solo capacità tenant; i due insiemi non si sovrappongono mai. Una guardia di capacità verifica insieme la capacità e l'audience, quindi una capacità MSSP non può mai soddisfare una route tenant e viceversa. Ecco perché `platform_admin`, ad esempio, possiede ogni capacità MSSP ma nessuna di quelle tenant.

## Catalogo dei ruoli

**Lato MSSP** (personale del provider; `tenant_id` è null):

| Ruolo | Tier | Può fare |
|---|---|---|
| `platform_admin` | configure (super) | Ogni capacità MSSP, a livello di installazione. |
| `mssp_admin` | configure | Configurare il sistema, gestire gli utenti, più tutto ciò che è sotto. |
| `mssp_manager` | authorize risk | Dichiarare engagement, curare gli authorization fact, approvare le azioni high-blast, più operate. |
| `analyst` | operate | Fare triage delle indagini, revisionare i verdetti, decidere, chattare. Lavora un cliente alla volta fissando (pinning) un tenant (vedi Impersonation più sotto); sola lettura sulle impostazioni. |

**Lato tenant** (personale di un cliente; `tenant_id` impostato; ambito limitato a quel singolo tenant):

| Ruolo | Tier | Può fare |
|---|---|---|
| `tenant_admin` | configure | Gestire gli utenti della propria organizzazione e le proprie impostazioni LLM, più tutto ciò che è sotto. Provisioning automatico durante l'onboarding del tenant tramite il flow `_mint_tenant_admin_user` del runtime. |
| `tenant_manager` | authorize risk | Dichiarare le proprie engagement di pentest, asserire authorization fact (che vengono sottoposti a revisione MSSP prima di avere effetto), approvare le azioni high-blast, più operate. |
| `tenant_analyst` | operate | Lavorare il SOC del proprio tenant: triage, revisione dei verdetti, decisione, approvazione delle proposte standard-blast, chat. Questo è il ruolo del SOC co-gestito, lo specchio lato tenant di `analyst`. |
| `customer_viewer` | view only | Stakeholder in sola lettura. Vede la dashboard SOC e le indagini del proprio cliente, ma non può agire su di esse e non può aprire la coda di revisione. |

Il tier "configure" di `tenant_admin` è ristretto: rispetto al manager aggiunge la configurazione LLM della propria organizzazione e la gestione degli utenti, nient'altro. Branding e integrazioni restano sul lato MSSP.

L'admin iniziale viene creato inline dal comando di init del pod API (guidato da `install.bootstrapAdmin.email` e `install.bootstrapAdmin.password` nei chart values) come `mssp_admin` con `must_change=false`. Il [setup wizard](/it-it/setup-wizard) popola quei valori durante il primo avvio.

## La distinzione tra customer-viewer e tenant-analyst

`customer_viewer` e `tenant_analyst` sono entrambi lato tenant, ma sono lavori diversi. `customer_viewer` osserva: dashboard e stato delle indagini, niente di più. Non può decidere le revisioni, usare la chat o elencare la coda di revisione in sospeso. `tenant_analyst` opera: gestisce il SOC del cliente sugli alert del proprio tenant. Assegna i viewer alle persone che hanno bisogno di visibilità e gli analyst alle persone che fanno il lavoro.

La coda di revisione in sospeso è protetta di conseguenza. Elencare o aprire una revisione richiede l'autorità di revisione, posseduta da `analyst` MSSP e superiori e da `tenant_analyst` e superiori. Un operatore tenant vede solo la coda del proprio tenant. Le letture di revisione cross-tenant sono limitate a `platform_admin`, `mssp_admin` e `mssp_manager`; un `analyst` MSSP legge la coda di un tenant una volta fissato ad esso.

## Creazione di utenti tenant

Un `tenant_admin` esegue il provisioning dei login della propria organizzazione. È questo che rende utilizzabili i ruoli tenant; senza di esso, un tenant avrebbe solo il singolo admin creato durante l'onboarding.

Nell'interfaccia cliente, apri **Users** nella barra laterale (visibile solo a `tenant_admin`), poi **Add user**: inserisci un'email, scegli un ruolo e invia. Il pannello restituisce una password temporanea monouso. Copiala e consegnala all'utente fuori banda; viene mostrata una sola volta e non è mai recuperabile in chiaro. All'utente viene chiesto di cambiarla al primo accesso.

Lo stesso è disponibile sull'API:

```bash
curl -X POST 'https://<customer-host>/api/tenant/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@customer.example","role":"tenant_analyst"}'
```

Note:

- I ruoli assegnabili sono `customer_viewer`, `tenant_analyst`, `tenant_manager` e `tenant_admin`. Un ruolo MSSP non può essere assegnato qui; la richiesta viene rifiutata. Questa è la barriera dell'audience.
- Il nuovo utente viene sempre inserito nel tenant del chiamante. Il tenant è preso dalla sessione del chiamante, mai dal corpo della richiesta, e il database lo impone, quindi un tenant admin può creare utenti solo nel proprio tenant.
- Un'email duplicata viene rifiutata. Le email sono uniche in tutta l'installazione.
- `GET /api/tenant/users` elenca gli utenti del proprio tenant. Entrambi gli endpoint richiedono la capacità `tenant_manage_users`, che solo `tenant_admin` possiede.

Il portale del cliente è raggiungibile su un host per-tenant. L'hostname fisso proviene da `ingress.hostnames.customer` nei chart values, e gli host per-tenant basati su slug provengono da `ingress.tenantWildcard`. Vedi la [documentazione di installazione](/it-it/install) per il layout degli hostname.

## Creazione di utenti dello staff MSSP

Un `mssp_admin` o `platform_admin` esegue il provisioning dei login dello staff MSSP dal pannello **Staff Users** nella [MSSP UI](/it-it/mssp-ui), o sull'API. La forma rispecchia il lato tenant.

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@your-mssp.example","role":"analyst"}'
```

Note:

- I ruoli assegnabili sono `analyst`, `mssp_manager`, `mssp_admin` e `platform_admin`. Un ruolo tenant non può essere assegnato qui (la barriera dell'audience). L'assegnazione di `platform_admin` è consentita solo se il chiamante è già un `platform_admin`.
- Il nuovo utente è lato MSSP (`tenant_id` è null). Questi endpoint operano sempre e solo su righe di staff MSSP, quindi un utente tenant non può mai essere raggiunto tramite essi.
- La risposta contiene una password temporanea monouso; l'utente la cambia al primo accesso. Un'email duplicata viene rifiutata.
- `GET /api/mssp/users` elenca lo staff. Tutti questi richiedono la capacità `manage_users`, posseduta solo da `mssp_admin` e `platform_admin`.

`soctalk-auth set-password` (la CLI) esiste ancora per i casi di bootstrap e offline: imposta una password per un utente esistente, azzera `must_change` e registra la modifica nell'audit, ma non crea la riga dell'utente e non revoca le sessioni.

## Cambiare un ruolo, disattivare, riattivare

Entrambi i lati espongono lo stesso ciclo di vita. Sul lato tenant un `tenant_admin` gestisce la propria organizzazione; sul lato MSSP un `mssp_admin`/`platform_admin` gestisce lo staff.

- **Cambiare un ruolo**: scegli un nuovo ruolo dal selettore della riga, oppure `PATCH /api/tenant/users/{id}` (o `/api/mssp/users/{id}`) con `{"role": "..."}`. Un cambio di ruolo revoca le sessioni attive dell'utente in modo che il nuovo ruolo abbia effetto immediato.
- **Disattivare**: il pulsante Deactivate della riga, oppure `POST .../{id}/deactivate`. L'utente viene impostato come inattivo e ogni sessione attiva viene revocata all'istante, così che un utente già autenticato venga tagliato fuori anziché rimanere fino alla scadenza. Il middleware di sessione rifiuta inoltre un utente inattivo, chiudendo la race con un accesso concorrente.
- **Riattivare**: il pulsante Reactivate della riga, oppure `PATCH .../{id}` con `{"active": true}`.

Due guardie si applicano a ogni modifica:

- Non puoi modificare il tuo account (nessuna auto-retrocessione o auto-blocco).
- Non puoi rimuovere l'ultimo amministratore attivo: la modifica che lascerebbe un tenant senza alcun `tenant_admin` attivo, o l'installazione senza alcun `mssp_admin`/`platform_admin` attivo (o senza alcun `platform_admin` attivo quando ne esiste uno), viene rifiutata. Il controllo blocca le righe candidate, così che retrocessioni concorrenti non possano passare entrambe.

Un account `platform_admin` esistente può essere modificato, disattivato o resettato di password solo da un altro `platform_admin`.

## Reset della password

**Self-service**: non implementato in questa release. Non esiste un flusso di password dimenticata né la consegna via email nella pagina di login. Gli utenti chiedono a un admin di eseguire il reset.

**Forzato dall'admin**: un `mssp_admin` o `platform_admin` resetta la password di qualsiasi utente tramite id:

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

Il target può essere un utente MSSP o un utente tenant; l'attore deve essere `mssp_admin` o `platform_admin`. La risposta contiene una nuova `temporary_password` contrassegnata con `must_change=true`, e il reset revoca tutte le sessioni esistenti di quell'utente. Condividi la password; l'utente ne sceglie una nuova al primo accesso.

Non esiste un'azione di reset lato tenant, quindi un `tenant_admin` non può resettare la password di uno dei propri utenti dall'interfaccia. Finché ciò non sarà disponibile, un admin MSSP la resetta con l'endpoint sopra, oppure un operatore la resetta sulla riga del database.

## Impersonation e cambio del contesto tenant

Gli utenti lato MSSP (`platform_admin`, `mssp_admin`, `mssp_manager`, `analyst`) possono limitare la propria sessione a un tenant specifico tramite `POST /api/auth/assume-tenant`. Gli utenti lato tenant non possono; sono già fissati al proprio tenant. L'interfaccia lo espone come il chip **Tenant: \<name\>** in alto a destra nella [MSSP UI](/it-it/mssp-ui): cliccando un tenant si fissa la sessione alla vista di quel cliente, e **Clear** riporta all'ambito cross-tenant. Le azioni che modificano lo stato eseguite durante quell'ambito vengono eseguite come l'utente originale con la sessione vincolata a quel tenant.

Questa non è l'impersonation di un utente diverso; l'identità della sessione rimane la stessa. È pianificata una superficie per "prendere il controllo della sessione di un utente specifico".

## Sessioni

| Archiviazione sessione | Nome cookie | Durata |
|---|---|---|
| Sessione MSSP UI | `soctalk_session` | 12 h assolute + 30 min di inattività |
| Sessione portale clienti | `soctalk_session` | 12 h assolute + 30 min di inattività |
| Sessione wizard | `soctalk_session` | fino all'uscita dal wizard |

`POST /api/auth/logout` revoca solo la sessione corrente. La disattivazione di un utente tenant, e il reset della password di qualsiasi utente, revocano tutte le sessioni di quell'utente. Per revocare ogni sessione di un utente MSSP senza un reset della password, imposta `revoked_at` direttamente sulle sue righe `sessions` in Postgres; non esiste ancora un'API di amministrazione per questo. La rotazione della chiave di firma JWT non revoca le sessioni cookie basate su DB; la ricerca avviene sulla riga del DB, non sulla firma del JWT.

È pianificato un inventario delle sessioni in sola lettura (`GET /api/auth/sessions`).

## SSO / proxy auth

Il runtime supporta `SOCTALK_AUTH_MODE=proxy`, dove SocTalk si fida di un proxy OIDC upstream (OAuth2-Proxy, Keycloak, Dex) per autenticare la richiesta. L'identità viene risolta dall'header `X-Forwarded-Email`, abbinata per email a una riga utente esistente. La modalità di autenticazione in sé oggi non è esposta come knob nei chart values; imposta la env var direttamente sul Deployment `soctalk-system-api` dopo l'installazione. I CIDR dei proxy fidati sono gestiti dal chart tramite `oidc.trustedProxyCIDRs`.

In modalità proxy il router di autenticazione basato su password non viene montato affatto, quindi `/api/auth/login`, `/api/auth/password/change`, il reset della password amministrativo e anche `/api/auth/me`, `/api/auth/logout` e `/api/auth/assume-tenant` sono assenti. L'init di bootstrap del chart continua a inizializzare la riga Organization e, se `install.bootstrapAdmin.password` è impostato, l'utente `mssp_admin`. Continua a impostare `bootstrapAdmin` anche in modalità proxy: il provisioning just-in-time degli utenti alla prima richiesta autenticata non è implementato, quindi senza un utente inizializzato e abbinato per email alla tua identità IdP, nessuna richiesta autenticata via proxy può risolversi in una riga utente.

L'assegnazione dei ruoli in modalità proxy avviene alla creazione dell'utente nel database. Il runtime si fida dell'email inoltrata per l'identità ma non legge gli header di gruppo né promuove automaticamente in base all'appartenenza a un gruppo. È pianificato un mapping configurabile da gruppo IdP a ruolo SocTalk.

Dettagli completi: [Internal Auth](/it-it/reference/internal-auth).

## Audit

La creazione di utenti, le modifiche di ruolo/stato e la disattivazione scrivono righe `user.create`, `user.update` e `user.delete` nel log di audit (con lo stato di ruolo e attività prima/dopo negli aggiornamenti), e anche i reset di password vengono registrati nell'audit. Nota che l'attuale vista `/api/audit` nell'interfaccia legge lo stream di eventi delle indagini, non la tabella `audit_log`, quindi queste righe di gestione utenti sono interrogabili direttamente in `audit_log` ma non compaiono ancora in quella schermata.
