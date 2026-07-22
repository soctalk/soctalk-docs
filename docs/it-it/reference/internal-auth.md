# Autenticazione interna

## 1. Ambito

Aggiunge un percorso di login autonomo per le UI proprietarie di SocTalk,
così gli operatori possono operare senza un proxy OIDC upstream.
L'autorizzazione esistente (ruoli, `tenant_id`, decoratori in
`src/soctalk/core/tenancy/decorators.py:120`, RLS di Postgres) rimane
invariata. Questa specifica aggiunge soltanto una nuova sorgente di
identità che produce la stessa forma `UserIdentity` già consumata in
`src/soctalk/core/tenancy/auth.py:67`.

Due modalità, selezionate all'avvio del processo ed esposte su `/health/live` e `/health/ready`:

```
SOCTALK_AUTH_MODE = internal | proxy
```

- `internal` (default per le nuove installazioni): SocTalk gestisce
  login, sessioni e archiviazione delle password. Il middleware di
  ingress-handoff è disabilitato.
- `proxy`: preserva il comportamento esistente di ingress-handoff. Gli
  endpoint interni rispondono con 404.

Nessuna modalità ibrida. La federazione (provisioning JIT, OIDC SP, ecc.) è
una specifica separata.

## 2. Modello dati

Due nuove tabelle. Tutto il resto riusa i modelli esistenti.

### `password_credentials`

| column               | type        | notes                                       |
| ---                  | ---         | ---                                         |
| user_id              | uuid PK, FK | fa riferimento a `users.id`, on-delete cascade |
| password_hash        | text NOT NULL | argon2id, stringa hash completa con parametri |
| must_change          | bool        | impostato dal reset dell'amministratore     |
| updated_at           | timestamptz |                                             |
| last_used_at         | timestamptz | ultimo login riuscito                       |
| consecutive_failures | int         | azzerato in caso di successo                |
| locked_until         | timestamptz | null salvo blocco attivo                    |

### `sessions`

Sessioni persistite su DB. Il cookie porta un session_id opaco; la riga
del DB è la fonte di verità.

| column          | type        | notes                                |
| ---             | ---         | ---                                  |
| id              | uuid PK     | anche il valore del cookie           |
| user_id         | uuid FK     |                                      |
| tenant_context  | uuid        | `current_tenant` catturato al login  |
| created_at      | timestamptz |                                      |
| last_seen_at    | timestamptz | aggiornato con throttling (~60s)     |
| absolute_expiry | timestamptz | limite rigido, 12h                   |
| idle_expiry     | timestamptz | scorre con l'attività, 30m           |
| revoked_at      | timestamptz | se non nullo disabilita la sessione  |
| ip_created      | inet        | osservabilità                        |
| user_agent      | text        | osservabilità                        |

Indice: `(user_id, revoked_at)`.

### Riuso

- `users` (`src/soctalk/core/tenancy/models.py:156`) — invariata.
- `audit_log` (`src/soctalk/core/tenancy/models.py:291`) — riceve le
  azioni `auth.*` (vedi §9).

Nessuna nuova tabella di audit. Nessuna tabella di chiavi di firma (le
sessioni sono righe DB opache, non JWT; la firma HMAC esistente in
`src/soctalk/core/tenancy/auth.py:167` non è correlata).

## 3. Endpoint

Tutti sotto `/api/auth/*`. JSON. Le route che modificano lo stato sono
protette secondo §6.

| method | path                                          | purpose                                |
| ---    | ---                                           | ---                                    |
| POST   | `/api/auth/login`                             | email + password, imposta il cookie di sessione |
| POST   | `/api/auth/logout`                            | revoca la sessione corrente            |
| GET    | `/api/auth/me`                                | payload dell'identità corrente + `permissions[]` del ruolo |
| POST   | `/api/auth/password/change`                   | vecchia + nuova, autenticato           |
| POST   | `/api/mssp/users/{id}/password/reset`         | reset forzato dell'admin, imposta `must_change` |

`/api/auth/me` restituisce l'identità più un elenco `permissions[]` calcolato, le capability detenute dal ruolo con cui si è effettuato l'accesso, derivate dalla mappa ruolo-a-permesso unica fonte autorevole. Il frontend gestisce navigazione e azioni in base a questi permessi anziché dedurli dalla stringa del ruolo.

L'endpoint di reset dell'admin genera lato server una password casuale
robusta e la restituisce una sola volta nel corpo della risposta; l'admin
la consegna all'utente fuori banda. Il reset self-service basato su email è
rimandato (§12).

In `AUTH_MODE=proxy`, ogni endpoint di questa tabella risponde con 404.

## 4. Cookie e sessione

### Cookie

Nome: `soctalk_session`.

Attributi:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- `Domain` omesso (host-only)
- `Max-Age` corrisponde a `absolute_expiry` della sessione

Valore: base64 url-safe dello UUID della sessione. Nessun claim nel cookie.

### Ciclo di vita

- `absolute_expiry = created_at + 12h`. Limite rigido.
- `idle_expiry = last_seen_at + 30m`. Scorre in avanti con l'attività.
- Al cambio password: tutte le altre sessioni dell'utente vengono
  revocate; la sessione che ha effettuato il cambio viene preservata così
  l'utente rimane connesso sul dispositivo corrente.
- `/api/auth/logout` revoca solo la sessione corrente.
- Il reset dell'admin revoca tutte le sessioni dell'utente destinatario.

## 5. Policy delle password

- argon2id tramite `argon2-cffi`.
- Parametri: `time_cost=3`, `memory_cost=65536` (64 MiB),
  `parallelism=4`, `hash_len=32`, `salt_len=16`.
- La stringa hash memorizzata contiene i suoi parametri; verifica-e-rehash
  in modo trasparente quando i parametri divergono.
- Lunghezza minima: 12. Nessuna regola di composizione.
- Lockout: 10 fallimenti consecutivi entro 15 min impostano `locked_until = now() + 15m`. Il contatore si azzera al login riuscito.
- `must_change`: impostato dal reset dell'admin. Forza l'utente attraverso
  il flusso di cambio password prima di qualsiasi altro endpoint.

## 6. CSRF

`SameSite=Lax` sul cookie di sessione blocca già le POST cross-site. Per i
metodi che modificano lo stato (`POST`, `PATCH`, `DELETE`, `PUT`) il
middleware applica inoltre:

- Se `Origin` è presente, deve corrispondere a una delle origini
  proprietarie configurate. La configurazione è una lista/pattern, non un
  singolo valore, perché le installazioni servono sia l'host MSSP
  (`mssp.example.com`) sia un host cliente per-tenant con wildcard
  (`*.customers.example.com`). Il pinning a una singola origine
  restituirebbe 403 su ogni POST proveniente da qualsiasi UI non sia
  quella fissata.
- Altrimenti, se `Referer` è presente, la sua componente di origine deve
  corrispondere alla stessa allow-list.
- Altrimenti rifiuta con 403.

L'allow-list deriva dagli hostname UI configurati nei chart values
(`ingress.hostnames.mssp`, `ingress.hostnames.customer`) così gli
operatori non la mantengono separatamente.

## 7. Middleware

Il nuovo middleware `internal_session_middleware` sostituisce
`ingress_handoff_middleware` quando `SOCTALK_AUTH_MODE=internal`.

Per ogni richiesta:

1. Legge il cookie `soctalk_session`.
2. Cerca la riga della sessione. Rifiuta se mancante, revocata, oltre
   `absolute_expiry`, oppure oltre `idle_expiry`.
3. Aggiorna `last_seen_at` (con throttling — scrive al massimo ogni 60s).
4. Carica l'utente e costruisce la stessa forma `UserIdentity` prodotta
   dal percorso. Imposta `request.state.user_identity` esattamente come
   oggi, così decoratori e helper del contesto RLS restano intatti.

Rate limiting: tentativi di login per IP e per email ogni 15 minuti,
applicati prima della ricerca su DB. Contatore in-process per la beta; da
sostituire con Redis quando servirà lo scaling orizzontale.

## 8. UI/UX

Due UI proprietarie acquisiscono le funzionalità di auth: la console MSSP
(`frontend/mssp`) e il portale cliente (`frontend/customer`). Entrambe sono
app SvelteKit che dialogano con la stessa API.

### Pagina di login

Entrambe le app acquisiscono `/login`:

- Card centrata. Due campi (Email, Password). Un singolo pulsante primario
  etichettato "Sign in."
- Il portale cliente legge nome e logo dell'app dal `BrandingConfig` del
  tenant così la pagina risulta nativa rispetto al brand dell'MSSP. La
  console MSSP usa il branding di default a livello di installazione.
- Focus iniziale su Email. Invio effettua il submit. Nomi di campo
  standard così i gestori di password del browser fanno autofill senza
  problemi.
- Stati di errore (nessuna enumerazione utenti):
  - Credenziali non valide → "Email or password is incorrect."
  - Account bloccato → "This account is temporarily locked. Try again at
    {unlock_time}."
  - Errore server → "Something went wrong. Try again."
- Piccola riga di utilità sotto: "Contact your administrator if you've
  lost access." Nessun link di reset self-service in questa specifica.

### Cambio forzato (`must_change`)

Quando il login riesce con una credenziale che ha `must_change=true`, la
risposta del server segnala il cambio come passo successivo. La UI naviga
direttamente a `/account/password` — nessun flash della dashboard.

Mentre `must_change` è impostato, qualsiasi route eccetto
`/account/password` e `POST /api/auth/logout` reindirizza a
`/account/password`. Un piccolo banner ambra riporta "Your administrator
requires you to set a new password before continuing."

### Pagina di cambio password

`/account/password`:

- Tre campi: Current password, New password, Confirm new password.
- Validatore inline solo per la regola di lunghezza ≥12. Nessun indicatore
  di composizione.
- In caso di successo, mostra una conferma e la nota "Other devices have
  been signed out. You're still signed in here."
- Raggiungibile dal menu account, e obbligatoria durante `must_change`.

### Menu account

Nell'header di entrambe le app, visibile quando autenticati:

- Email utente.
- Etichetta di ruolo ("MSSP admin", "Analyst", "Customer viewer", ecc.).
- Link a "Change password."
- "Sign out" — `POST /api/auth/logout`, poi naviga a `/login` con un
  messaggio flash "You have been signed out."

### Reset dell'admin (console MSSP)

Nella pagina di dettaglio utente della console MSSP:

- Pulsante "Reset password", protetto da permessi per `platform_admin` e
  `mssp_admin`.
- Il modale di conferma spiega: "Generates a one-time password, revokes
  all of this user's active sessions, and forces them to change it at
  next login."
- Alla conferma, il server restituisce una volta la password generata. La
  UI la mostra in un campo copia-negli-appunti con "Copy and close." Dopo
  la chiusura del modale, la password non è più recuperabile — l'admin la
  condivide fuori banda.

### Scadenza della sessione

- Su qualsiasi 401 restituito a una sessione autenticata, la SPA naviga a
  `/login?expired=1&next=<current-url>`.
- La pagina di login legge `expired=1` e mostra "Your session expired.
  Please sign in again." La scadenza assoluta rispetto a quella per
  inattività non viene distinta nella UI.
- Dopo il sign-in riuscito, la SPA naviga a `next` se presente e
  same-origin; altrimenti alla route di atterraggio di default per quella
  UI.

### Stati vuoti e di errore

- Primo caricamento senza sessione → redirect a `/login` (nessun flash).
- Pagina di login mentre già autenticati → redirect alla route di
  atterraggio di default (non lasciare l'utente bloccato su un form che
  non gli serve).
- Errori di rete durante il login → mantieni il form, mostra inline
  "Couldn't reach the server. Check your connection and try again."

### Accessibilità

- Tutti gli input hanno elementi `<label>` associati. Gli errori usano
  `role="alert"` così gli screen reader li annunciano.
- L'ordine di focus è naturale (email → password → submit).
- Nessun CAPTCHA. Lockout più rate limiting per IP/email coprono gli abusi
  su scala MSSP; il CAPTCHA interrompe il flusso degli screen reader e
  aggiunge overhead operativo.
- Touch target minimo 44×44px per l'azione primaria su mobile.

## 9. Audit

Emette i seguenti valori `action` nell'`audit_log` esistente:

- `auth.login.success`
- `auth.login.failure` (`details.reason` in `{bad_password, unknown_email, locked}`)
- `auth.logout`
- `auth.password.changed`
- `auth.password.reset.admin` (reset di un altro utente attivato dall'admin)
- `auth.lockout.triggered`

`actor_id` è l'id dell'utente che agisce, oppure `system:auth` per gli
scatti di lockout. `tenant_id` è copiato dall'utente che agisce.

## 10. Migrazione da `proxy` a `internal`

1. Applica la migrazione che crea §2.1 e §2.2. Le righe `users` esistenti
   non sono interessate.
2. Distribuisci la nuova versione dell'app. `SOCTALK_AUTH_MODE=proxy`
   preserva il comportamento esistente.
3. Per ogni utente che ci si aspetta usi il login interno, l'operatore
   esegue `soctalk auth set-password <email>` (nuova CLI; scrive una riga
   `password_credentials` ed emette `auth.password.reset.admin`).
4. L'operatore commuta `SOCTALK_AUTH_MODE=internal` e riavvia. Il
   middleware di ingress-handoff viene rimosso dalla pipeline.

Rollback: ricommuta il flag e riavvia.

## 11. Test

Suite backend obbligatoria (stile postgres-rls §9):

1. Il percorso felice del login crea una riga di sessione con il
   `tenant_context` corretto e imposta il cookie.
2. Password errata incrementa `consecutive_failures`; dieci consecutive
   scatenano `locked_until`; ulteriori tentativi vengono rifiutati anche
   con la password corretta.
3. `must_change` blocca ogni endpoint non-password fino a un cambio
   riuscito.
4. Il cambio password revoca tutte le altre sessioni dell'utente ma
   preserva quella corrente.
5. Il logout revoca solo la sessione corrente.
6. Il reset dell'admin revoca tutte le sessioni dell'utente destinatario e
   forza `must_change`.
7. `AUTH_MODE=proxy`: `/api/auth/*` e l'endpoint di reset dell'admin
   restituiscono 404. Il percorso di ingress-handoff funziona ancora.
8. CSRF: una richiesta che modifica lo stato con un `Origin` estraneo viene
   rifiutata con 403.
9. Una sessione oltre `absolute_expiry` o `idle_expiry` viene rifiutata; la
   riga non viene cancellata automaticamente (mantenuta per l'audit).

Suite di smoke Playwright per ogni UI:

1. Il login con credenziali valide atterra sulla route di default e mostra
   il menu account.
2. Il login con credenziali errate mostra l'errore generico senza
   enumerare.
3. `must_change` al login atterra sulla pagina di cambio e non consente di
   navigare altrove.
4. Il cambio password riesce e persiste il sign-in.
5. Il modale di reset dell'admin espone una volta la password generata; la
   chiusura del modale la nasconde.
6. Una sessione scaduta su una route protetta instrada a
   `/login?expired=1` con il flash e preserva `next`.

## 12. Rimandato

Non fa parte di questa specifica. Ordinato per probabilità di
reintroduzione:

1. `password_reset_tokens` — reset password self-service basato su email.
2. MFA (TOTP + codici di recupero), con i corrispondenti passi UI nei
   flussi di login e account.
3. Inventario delle sessioni (`GET /api/auth/sessions`, revoca-specifica,
   logout-all) con un pannello "Devices" nella pagina account.
4. Impersonificazione (mssp_admin → sessioni utente tenant), con un banner
   chiaro nella UI durante l'impersonificazione.
5. OIDC SP / federazione (specifica separata).
6. OIDC issuer (specifica separata; solo se compare un consumatore
   concreto).
7. Rotazione delle chiavi di firma + JWKS (necessaria solo quando
   emetteremo token stateless esternamente).
