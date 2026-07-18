# Gestione degli utenti: una guida passo passo

Questa guida illustra come fornire una credenziale di accesso e gestirne l'intero ciclo di vita dalla UI, su entrambi i lati del business: il personale MSSP dal pannello **Staff Users** e il personale del cliente dal pannello **Users** del tenant. I due pannelli si rispecchiano a vicenda, quindi una volta gestito uno, l'altro risulta familiare. Per il modello che sta alla base di tutto questo, quali ruoli esistono e cosa può fare ciascuno, consulta [Utenti e ruoli](/it-it/users-and-roles); questa pagina è il percorso operativo.

Tutto ciò che segue è svolto da un amministratore. Sul lato MSSP si tratta di un `mssp_admin` o `platform_admin`. Sul lato tenant è il `tenant_admin` del cliente stesso, che opera esclusivamente all'interno della propria organizzazione. Nessuno dei due può oltrepassare la barriera tra le audience: un amministratore MSSP non assegna mai un ruolo tenant e un amministratore tenant non assegna mai un ruolo MSSP.

## Provisioning del personale MSSP

Accedi come amministratore MSSP. Il pannello che ti serve è **Staff Users** nella barra laterale, che compare solo per un account che detiene la gestione utenti.

![La pagina di accesso di SocTalk](/screenshots/iam-mssp-01-login.png)

Apri **Staff Users** e scegli **+ Add user**. Inserisci l'email della persona, un nome visualizzato facoltativo e seleziona il ruolo adatto alla mansione. Un analyst lavora la coda tra i vari clienti, un manager autorizza il rischio e un admin configura il sistema e gestisce gli utenti. L'elenco dei ruoli qui contiene solo ruoli MSSP; un ruolo tenant non viene offerto, perché non potrebbe essere assegnato da questo lato.

![Aggiunta di un utente del personale MSSP con un ruolo selezionato](/screenshots/iam-mssp-02-add-user.png)

L'invio crea la credenziale di accesso e restituisce una password temporanea monouso. Copiala subito e consegnala alla persona tramite un canale sicuro esterno, perché viene mostrata una sola volta e in seguito non è mai recuperabile in chiaro. Alla persona viene richiesto di modificarla al primo accesso. Il nuovo utente compare nell'elenco sotto il modulo, attivo, con il ruolo che gli hai assegnato.

![La password temporanea monouso e il nuovo utente nell'elenco](/screenshots/iam-mssp-03-created.png)

## Modifica di un ruolo

I ruoli si modificano sul posto. Seleziona un nuovo ruolo dal selettore sulla riga della persona e viene salvato immediatamente. Qui l'analyst viene promosso a manager.

Una modifica di ruolo revoca le sessioni attive di quell'utente, così la nuova autorità ha effetto immediato anziché attendere la scadenza della vecchia sessione. Se l'utente era connesso, la sua richiesta successiva lo riporta alla schermata di accesso.

![Promozione dell'analyst a manager dal selettore sulla riga](/screenshots/iam-mssp-04-promoted.png)

## Disattivazione e riattivazione

**Deactivate** sulla riga disattiva l'account. Lo stato cambia e ogni sessione attiva viene revocata nello stesso istante, così chi è già connesso viene disconnesso anziché rimanere attivo fino alla scadenza naturale della sessione. Il livello di sessione rifiuta inoltre un account inattivo a ogni richiesta, il che colma il divario nei confronti di un accesso in corso al momento della disattivazione.

![L'utente disattivato, con l'opzione Reactivate ora disponibile](/screenshots/iam-mssp-05-deactivated.png)

La disattivazione è reversibile. **Reactivate** sulla stessa riga riporta l'account allo stato attivo. Ritorna con il ruolo che aveva; nulla della sua cronologia va perduto.

![L'utente riattivato e di nuovo attivo](/screenshots/iam-mssp-06-reactivated.png)

## Il lato tenant, dall'inizio alla fine

Un `tenant_admin` gestisce lo stesso ciclo di vita per la propria organizzazione, dal pannello **Users**. È questo che rende utilizzabili i ruoli tenant; senza di esso un cliente disporrebbe soltanto dell'unico admin creato al momento dell'onboarding del tenant. In alto a destra viene mostrato il tenant in cui stai operando, e ogni utente che crei viene assegnato a quel tenant. Il tenant è ricavato dalla tua sessione, mai dal modulo, e il database lo impone, così un amministratore tenant può creare utenti solo all'interno della propria organizzazione.

Scegli **+ Add user**, inserisci un'email e un nome facoltativo e seleziona un ruolo. Le scelte sono i ruoli tenant: un viewer che si limita a osservare, un analyst che gestisce il SOC, un manager che autorizza il rischio e un admin. Qui viene fornito un nuovo analyst per Acme Corp.

![Aggiunta di un utente tenant dal pannello Users del cliente](/screenshots/iam-tenant-01-add-user.png)

Come sul lato MSSP, la creazione dell'utente restituisce una password temporanea monouso da consegnare tramite un canale sicuro esterno, e il nuovo analyst entra a far parte dell'elenco.

![L'utente tenant creato, con la sua password monouso](/screenshots/iam-tenant-02-created.png)

Le modifiche di ruolo funzionano allo stesso modo. Promuovi l'analyst a manager dal selettore sulla riga: la modifica viene salvata e le sue sessioni revocate immediatamente.

![Promozione dell'analyst tenant a manager](/screenshots/iam-tenant-03-promoted.png)

Deactivate disattiva l'account e ne revoca le sessioni,

![L'utente tenant disattivato](/screenshots/iam-tenant-04-deactivated.png)

e Reactivate lo riporta in attività.

![L'utente tenant riattivato](/screenshots/iam-tenant-05-reactivated.png)

## Le protezioni che valgono sempre

Alcune regole valgono per ogni modifica, su entrambi i lati, e la UI le impone anziché affidarsi alla tua memoria:

- Non puoi modificare il tuo stesso account. Non esiste auto-declassamento né auto-esclusione.
- Non puoi rimuovere l'ultimo amministratore attivo. Una modifica che lascerebbe un tenant senza alcun `tenant_admin` attivo, o l'installazione senza alcun `mssp_admin` o `platform_admin` attivo, viene rifiutata. Il controllo blocca le righe candidate, così due amministratori che si declassano a vicenda nello stesso istante non possono entrambi passare.
- Un `platform_admin` esistente può essere modificato, disattivato o avere la password reimpostata solo da un altro `platform_admin`.

## Reimpostazione di una password

In questa release non esiste un flusso self-service di password dimenticata. Quando qualcuno resta bloccato fuori, un amministratore effettua la reimpostazione. Sul lato MSSP un `mssp_admin` o `platform_admin` reimposta qualsiasi utente, MSSP o tenant, e la reimpostazione restituisce una nuova password monouso e revoca le sessioni esistenti di quell'utente. L'endpoint esatto e il ripiego via CLI per i casi di bootstrap e offline sono descritti in [Utenti e ruoli](/it-it/users-and-roles#password-reset).

## Farlo dall'API

Ogni azione descritta sopra ha un equivalente API sotto `/api/mssp/users` e `/api/tenant/users`, incluse creazione, elenco, modifica del ruolo, disattivazione e riattivazione. Le strutture delle richieste, la capability richiesta da ciascuna e le regole di scoping per audience e tenant sono documentate in [Utenti e ruoli](/it-it/users-and-roles#creating-tenant-users). La UI è un livello sottile sopra questi endpoint, quindi tutto ciò che puoi cliccare puoi anche automatizzarlo.
