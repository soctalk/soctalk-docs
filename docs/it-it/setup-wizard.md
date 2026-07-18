# Setup wizard

Configuratore di primo avvio basato su browser fornito con l'[immagine VM demo](/it-it/quickstart-vm). **Non** fa parte di un'installazione di produzione: gli utenti di produzione scrivono a mano `values.yaml` ed eseguono `helm install` autonomamente.

Il compito del wizard è:

1. Autenticare l'operatore con un token di setup generato a ogni avvio.
2. Raccogliere la configurazione minima necessaria per installare `soctalk-system`.
3. Scrivere `/etc/soctalk/values.yaml`, `/etc/soctalk/llm.key` e un env-file di onboarding del tenant.
4. Uscire e passare il controllo a `soctalk-firstboot.service`, che esegue `helm install` e fa l'onboarding di un tenant demo.

Il codice sorgente si trova in [`setup-wizard/`](https://github.com/soctalk/soctalk/tree/main/setup-wizard) (Go, ~600 righe).

## Come raggiungerlo

Porta `:8443` sulla VM. Solo TLS; al primo avvio il wizard genera un certificato ECDSA P-256 autofirmato che copre gli IP locali della VM, `localhost` e `soctalk.local`. La porta di bind è `:8443` (non `:443`) per non entrare in conflitto con il Traefik incluso in k3s.

```text
https://<vm-ip>:8443/
```

## Token di setup

Al primo avvio il wizard genera un token di setup a 256 bit e lo scrive in `/var/log/soctalk-setup-token` (modo `0600`, di proprietà di root). Recuperalo con:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

Il token viene ruotato a ogni riavvio del wizard. Non esiste alcuna API per recuperare un token perso senza riavviare l'unità; riavviarla lo ruota e lo ristampa.

## Modulo a due fasi

1. **Autenticazione** — incolla il token di setup.
2. **Configurazione** — compila i campi seguenti.

La pagina di inserimento del token invia i dati a `POST /auth`; la pagina di configurazione invia i dati a `POST /submit`. Entrambe usano cookie CSRF vincolati tramite HMAC (`SameSite=Strict`, `HttpOnly`, `Secure`).

### Fase 1 — Autenticazione

![Setup wizard — inserimento del token](/screenshots/setup-wizard-token.png)

### Fase 2 — Configurazione

![Setup wizard — modulo di configurazione, compilato](/screenshots/setup-wizard-config-filled.png)

### Identità

| Campo | Tipo | Note |
|---|---|---|
| Nome MSSP / organizzazione | testo, ≤120 caratteri | diventa `install.msspName` nei valori del chart |
| Hostname | FQDN opzionale, ≤253 caratteri | vuoto → predefinito a `soctalk.local`; il chart rifiuta gli indirizzi IP su `spec.rules[0].host` |
| Email admin | email | diventa il `mssp_admin` di bootstrap (l'init del chart V1 crea questo ruolo, non `platform_admin`) |
| Password admin | password, ≥12 caratteri | scritta nel file dei valori come `install.bootstrapAdmin.password`. L'init del chart crea l'utente con `must_change=false`, quindi il primo accesso è immediato |

### LLM

| Campo | Tipo | Note |
|---|---|---|
| Provider | select (`anthropic`, `openai`) | **Solo visualizzazione in questa release.** Il wizard raccoglie il valore ma non lo scrive nei valori del chart; si applica il valore predefinito del chart (`openai-compatible`). Per fissare un provider specifico, modifica `/etc/soctalk/values.yaml` impostando `defaults.llm.provider` prima che venga eseguito `soctalk-firstboot.service`, oppure esegui `helm upgrade` dopo l'installazione. Il collegamento attraverso il wizard è pianificato per una release futura |
| API key | password | scritta in `/etc/soctalk/llm.key` (modo `0600`) — NON nel file dei valori. L'installer crea da essa un Secret Kubernetes (`soctalk-system-llm-api-key`) con entrambi i campi dati `anthropic-api-key` e `openai-api-key`, così il runtime del chart può usare qualunque provider indicato dai valori |

### Onboarding del tenant demo

Il wizard scrive anche `/etc/soctalk/onboard.env`:

```text
ADMIN_EMAIL='<email>'
ADMIN_PW='<password>'
INGRESS_HOST='<hostname or soctalk.local>'
TENANT_SLUG=demo
TENANT_NAME='<org name> — Demo'
```

`soctalk-firstboot.sh` lo legge dopo che `helm install` è andato a buon fine, effettua il login tramite `POST /api/auth/login` e chiama `POST /api/mssp/tenants/onboard` con `{slug: demo, profile: poc, display_name: <name>}`. L'onboarding del tenant è **asincrono**: l'API restituisce immediatamente 202; il controller di provisioning avvia lo stack Wazuh in background. L'installer di primo avvio non attende che il tenant raggiunga lo stato `active` prima di uscire.

## Cosa scrive il wizard

| Percorso | Modo | Contenuto |
|---|---|---|
| `/etc/soctalk/values.yaml` | 0640 | Valori del chart renderizzati (`install.*`, `ingress.*`, `postgres.*`) |
| `/etc/soctalk/llm.key` | 0600 | API key LLM, singola riga |
| `/etc/soctalk/onboard.env` | 0600 | Env-file di onboarding del tenant demo |
| `/var/lib/soctalk-wizard.done` | 0644 | Sentinella — impedisce che il wizard si riavvii ai boot successivi |

## Unità systemd

```text
[Unit]
After=cloud-init.target network-online.target
ConditionPathExists=!/var/lib/soctalk-firstboot.done
ConditionPathExists=!/var/lib/soctalk-wizard.done
ConditionPathExists=!/etc/soctalk/values.yaml

[Install]
WantedBy=cloud-init.target
```

Si aggancia a `cloud-init.target` (non a `multi-user.target`) per evitare un ciclo di ordinamento attraverso `After=cloud-final.service`. Al user-data di cloud-init è consentito depositare direttamente `/etc/soctalk/values.yaml` — se lo fa, il wizard non parte mai e `soctalk-firstboot.service` procede direttamente a `helm install`.

## Hardening

L'unità usa l'hardening standard di systemd: `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `RestrictNamespaces=true`, `MemoryDenyWriteExecute=true`. Le scritture sono confinate a `/etc/soctalk`, `/var/lib` e `/var/log`. Il wizard si lega alla porta privilegiata `:8443` tramite `AmbientCapabilities=CAP_NET_BIND_SERVICE`.

Dopo un invio riuscito, il wizard scrive la sentinella ed esce. Il `ConditionPathExists=!sentinel` di systemd ne impedisce il riavvio al boot.

## Anti-abuso

- **Gate del token** su ogni endpoint autenticato. Confronto a tempo costante.
- **CSRF** tramite cookie double-submit vincolati con HMAC su ogni POST che modifica lo stato.
- **Rate limit**: minimo 30 s tra i tentativi di autenticazione per IP di origine; 10 fallimenti entro un'ora bloccano l'IP per un'ora. (Codex ha segnalato questo come un banale vettore di DoS dietro NAT — gli operatori dietro un NAT condiviso potrebbero vedere bloccato un setup legittimo. Riavvia l'unità per sbloccare.)
- **Solo TLS autofirmato**. Il wizard non serve mai HTTP in chiaro. I clienti accettano il certificato autofirmato una volta; gli utenti di produzione non dovrebbero mai raggiungere il wizard.

## Cosa succede dopo l'invio

Il wizard restituisce `{poll: "/status", status: "accepted"}` ed esce dopo una finestra di grazia di 3 secondi (così il poller del cliente può recuperare la risposta di successo). Poi:

1. `soctalk-firstboot.service` rileva che `values.yaml` esiste e si avvia.
2. `systemctl start k3s` (k3s era installato ma non avviato da Packer, così il wizard aveva `:8443` libera).
3. Crea il namespace `soctalk-system` + il Secret LLM.
4. `helm upgrade --install soctalk-system /opt/soctalk/charts/soctalk-system --values /etc/soctalk/values.yaml --wait --timeout 15m`.
5. Applica una patch alla NetworkPolicy `kube-system → soctalk-system` così Traefik può raggiungere i Service di soctalk-system.
6. Interroga `/api/auth/me` attraverso Traefik (trucco dell'header Host) per un massimo di 10 minuti. Sia 200 che 401 significano "Traefik sta instradando"; il loop accetta entrambi.
7. Effettua il login come admin di bootstrap, chiama `POST /api/mssp/tenants/onboard`.
8. Scrive `/var/lib/soctalk-firstboot.done`.

Fai il tail di `/var/log/soctalk-firstboot.log` (o `journalctl -u soctalk-firstboot -f`) per osservare l'avanzamento.

## Reset / riesecuzione

Per rieseguire il wizard dopo un'installazione riuscita:

```bash
sudo rm /var/lib/soctalk-firstboot.done /var/lib/soctalk-wizard.done /etc/soctalk/values.yaml
sudo systemctl restart soctalk-setup-wizard
```

Questa operazione è distruttiva — il release helm esistente possiede ancora il namespace `soctalk-system`. Per un reset pulito, esegui prima `helm uninstall soctalk-system -n soctalk-system`.
