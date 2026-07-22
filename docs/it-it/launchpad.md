# Launchpad: pilot MSSP con un solo comando

Dopo aver visto SocTalk end-to-end su una singola macchina co-locata ([Quickstart](/it-it/quickstart-vm)), **Launchpad è il passo successivo**: ti porta da quella demo locale a un vero pilot, un control plane MSSP più uno o più ambienti tenant sulla tua infrastruttura. Puoi guidarlo da una **console web** (consigliato) o, in seguito, con un singolo comando headless: avvia le VM, le unisce alla tua tailnet, installa SocTalk da sorgenti pubbliche e ti consegna un URL.

Preferisci capire ogni passaggio prima di lasciare che uno strumento lo faccia? Il [pilot MSSP fai-da-te](/it-it/mssp-pilot) illustra la stessa installazione a mano, stessi chart, stesso flusso Tailscale. Launchpad si limita a fare il copia-incolla al posto tuo.

::: tip Tempo pratico
| Percorso | Tempo pratico | Tempo effettivo |
|---|---|---|
| [Fai-da-te](/it-it/mssp-pilot) | ~90 min | ~2 ore |
| Console Launchpad | ~5 min per compilare un form | ~15-25 min (per lo più in attesa dei download) |
:::

## Cosa fa

Date le credenziali di admin MSSP e un elenco di tenant, Launchpad:

1. Scarica la cloud image di Ubuntu Noble sul tuo host VM (memorizzata in cache nelle esecuzioni successive)
2. Effettua il provisioning delle VM QEMU, una per l'MSSP, una per tenant, con cloud-init + Tailscale
3. Attende che ogni VM si unisca alla tua tailnet con il tag che annuncia
4. Esegue [`install.sh`](https://github.com/soctalk/soctalk/blob/main/install.sh) sull'MSSP in modalità `--demo`
5. Effettua l'onboarding di ogni tenant tramite l'API MSSP
6. Chiama `:issue-agent` per ogni tenant per ottenere il token di bootstrap
7. Installa k3s + Helm + `soctalk-cloud-agent` su ogni VM tenant
8. L'MSSP invia il job `install_helm_release` → il cloud-agent scarica e applica il chart `soctalk-tenant` (Wazuh manager + indexer + dashboard, adapter, runs-worker)

Alla fine hai una dashboard MSSP funzionante, i tenant registrati e `active`, e Wazuh in esecuzione per tenant. Tutto scaricato da sorgenti pubbliche, nessuna immagine pre-preparata, nessun chart in bundle.

## Cosa non è

- **Non è un installer di produzione.** È uno strumento di valutazione. Stesse avvertenze non-produzione del pilot fai-da-te: niente HA, certificati self-signed, tailnet come ingress.
- **Non è un cluster manager.** Si avvia una volta ed esce. Non sorveglia il cluster, non fa upgrade, non riconcilia i drift. Usa `helm upgrade` in seguito.
- **Non è un operatore Kubernetes.** Il launchpad gira sulla tua scrivania, non nel cluster.

## Prerequisiti

Procurati prima questi elementi:

- [ ] **Un host VM raggiungibile dalla tua workstation.** Una macchina Linux con:
      - `qemu-system-x86_64`, `qemu-img`, `genisoimage`, `curl`
      - `/dev/kvm` (KVM annidato funziona, il bare metal è più veloce)
      - Margine sufficiente per le tue VM: **8 GB RAM + 4 vCPU + 60 GB di disco per VM**
      - SSH senza password dalla tua workstation come utente nel gruppo `kvm`
- [ ] **Una tailnet Tailscale.** Il tier gratuito va bene. Ti serviranno:
      - Il nome della tailnet (es. `taila1b2c3.ts.net`)
      - Un [token di accesso API Tailscale](https://login.tailscale.com/admin/settings/keys) con scope `keys:write`: il launchpad lo usa per generare chiavi di autenticazione dispositivo effimere per ogni VM
      - La proprietà dei tag che utilizzerai; aggiungi questi alla tua ACL:
        ```json
        "tagOwners": {
          "tag:mssp":        ["autogroup:admin"],
          "tag:tenant-acme": ["autogroup:admin"]
        }
        ```
- [ ] **Una chiave pubblica SSH** che vuoi autorizzare su ogni VM di cui viene effettuato il provisioning (di solito quella della tua workstation).
- [ ] **Una chiave API LLM** per l'MSSP. Scegli un provider che possiedi (Anthropic, OpenAI, oppure punta a un Ollama locale). Una chiave segnaposto funziona per uno smoke test in cui l'AI non viene esercitata.

::: warning Tailscale MagicDNS
Il launchpad si aspetta che MagicDNS sia abilitato sulla tua tailnet così che i cluster tenant possano raggiungere l'MSSP per hostname. È attivo di default. Se lo hai disattivato, dovrai aggiungere tu stesso `hostAliases` (vedi [pilot fai-da-te](/it-it/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant) per il pattern).
:::

## 1. Installa la CLI

Scarica il binario `launchpad` per la tua piattaforma dalla
[release più recente](https://github.com/soctalk/soctalk-launchpad/releases/latest),
poi lascia che scarichi i suoi plugin:

```bash
# pick the asset for your OS/arch: launchpad_{darwin,linux,windows}_{amd64,arm64}
base=https://github.com/soctalk/soctalk-launchpad/releases/latest/download
curl -fsSL "$base/launchpad_$(uname -s | tr A-Z a-z)_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o launchpad
chmod +x launchpad && sudo mv launchpad /usr/local/bin/launchpad

launchpad version
launchpad init   # downloads + signature-verifies every plugin into ~/.launchpad/plugins
```

`init` scarica il set di plugin per la tua piattaforma dalla stessa release firmata e
verifica ogni binario rispetto all'indice della release firmato con ed25519 prima che venga
installato. Nulla viene eseguito senza verifica. (`launchpad plugin list` mostra il
set installato; `launchpad plugin sync` riscarica o ripara lo store.)

## 2. Esegui il pilot nella console web

`launchpad ui` avvia una console web locale e la apre nel tuo browser, il modo principale per guidare un pilot. Registri la tua infrastruttura una volta come **Host** e **Network** riutilizzabili e testabili, poi avvii e osservi.

```bash
launchpad ui
```

Alla prima esecuzione la CLI scarica e verifica il set di plugin in `~/.launchpad/plugins`, poi serve la console dallo stesso binario, nient'altro da installare. Nel browser, lavora attraverso tre schermate:

1. **Networks**: aggiungi la tua tailnet: il nome dell'overlay (es. `taila1b2c3.ts.net`) e la tua chiave API Tailscale. Premi **Test** per confermare che la chiave funziona prima di farci affidamento. Un'esecuzione si lega a una rete, e ogni macchina vi si unisce.
2. **Hosts**: aggiungi il luogo su cui effettuerai il provisioning. Per questa guida è la tua macchina KVM: il target SSH e una work dir scrivibile. I nuovi host precompilano i campi che la loro piattaforma si aspetta, e **Test** convalida la connessione e le credenziali. Le credenziali vengono memorizzate con l'host e non lasciano mai la macchina su cui gira Launchpad.
3. **Runs**: crea un'esecuzione: assegna il **control node** (il tuo MSSP) e ogni **tenant** a un host, scegli la rete, inserisci le credenziali di admin MSSP e la chiave LLM, e premi **Launch**.

![Networks, l'overlay a cui si unisce ogni macchina di un'esecuzione, registrato una volta](/screenshots/launchpad-ui-networks.png)

![Hosts, i substrati su cui effettui il provisioning, registrati una volta](/screenshots/launchpad-ui-hosts.png)

La console trasmette l'avanzamento in tempo reale, ogni VM che viene provisioned, si unisce alla tailnet e installa SocTalk, e alla fine ti fornisce l'URL dell'MSSP. Le esecuzioni sono idempotenti (un nuovo lancio riconcilia con le macchine già esistenti invece di duplicarle), e l'azione **Down** smonta di nuovo le macchine di un'esecuzione.

![Un'esecuzione in corso, le VM MSSP e tenant in fase di provisioning, con il tracker delle fasi e uno stream di eventi in tempo reale](/screenshots/launchpad-ui-run.png)

::: tip Controllo di conformità
Prima di puntare un plugin su un'infrastruttura reale puoi verificarne la coerenza dalla CLI:
```bash
launchpad plugin verify qemu
```
Questo esegue la suite di conformità al protocollo (checksum, handshake, `plan`, `destroy` idempotente) senza bisogno di credenziali reali.
:::

## 3. Verifica che abbia funzionato

Quando l'esecuzione si completa (la console la marca come conclusa, oppure `launchpad up` esce con `0`), verifica i due sistemi:

**Dashboard MSSP**: apri l'URL che l'esecuzione ha stampato alla fine (o `https://lp-mssp.<your-tailnet>.ts.net/`). Accedi con le credenziali di admin che hai impostato per l'esecuzione. Il tuo tenant dovrebbe essere elencato e passare a **Online** entro 1-2 minuti.

![Dashboard MSSP provisioned da Launchpad](/screenshots/launchpad-mssp-dashboard.png)

**Wazuh sul tenant**: collegati via SSH alla VM tenant (`ssh ops@lp-tenant-acme.<your-tailnet>.ts.net`) e controlla i pod:

```bash
sudo k3s kubectl -n tenant-acme get pods
```

Dovresti vedere:

```
NAME                                          READY   STATUS
tenant-acme-wazuh-manager-0                   1/1     Running
tenant-acme-wazuh-indexer-0                   1/1     Running
tenant-acme-wazuh-dashboard-<hash>            1/1     Running
tenant-acme-linuxep-0                         1/1     Running
soctalk-adapter-<hash>                        1/1     Running
soctalk-runs-worker-<hash>                    1/1     Running
```

Lo StatefulSet `linuxep-0` è un endpoint Linux dimostrativo con l'agente Wazuh installato, un posto dove simulare gli alert. Vedi [Simulatore di attacchi](/it-it/mssp-pilot#5-3-generate-alerts) per i dettagli.

### SSH nelle VM

Ogni VM provisioned da launchpad ha un utente `ops` preconfigurato con le chiavi SSH dalla configurazione del tuo host autorizzate e **sudo senza password**. È così che la fase di installazione del launchpad accede; usa lo stesso account per il troubleshooting.

```bash
# Interactive shell as ops
ssh ops@lp-mssp.<your-tailnet>.ts.net
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net

# One-off command as root
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net "sudo journalctl -u k3s -n 100"
```

::: tip Fallback: connetti via IPv4 se MagicDNS è disattivato
Se MagicDNS è disabilitato sulla tua tailnet, `lp-<key>.<tailnet>.ts.net` non verrà risolto sulla tua workstation. Usa `tailscale status | grep lp-` per trovare l'IPv4 della tailnet ed esegui `ssh ops@100.x.y.z` direttamente.
:::

## 4. Usa il tuo pilot: onboarding dei clienti e domande all'AI

Launchpad ti consegna un MSSP funzionante con il tuo primo tenant già onboarded; da qui lo guidi esattamente come farebbe un MSSP. La **Dashboard** è una vista di flotta cross-tenant: revisioni in attesa, casi bloccati, tenant degradati e salute per tenant.

![La dashboard MSSP, vista di flotta cross-tenant](/screenshots/pilot-final-dashboard.png)

**Onboarding di un altro cliente.** **Tenants → Create customer** avvia un breve wizard in quattro passaggi:

![Create customer, 1. Identity](/screenshots/pilot-add-tenant-step1.png)
![Create customer, 2. Profile](/screenshots/pilot-add-tenant-step2.png)
![Create customer, 3. Branding](/screenshots/pilot-add-tenant-step3.png)
![Create customer, 4. Review](/screenshots/pilot-add-tenant-step4.png)

Il nuovo cliente si unisce alla flotta, e il cloud-agent effettua il provisioning del suo stack Wazuh + adapter nello stesso modo in cui Launchpad ha fatto per il primo tenant:

![L'elenco dei tenant con il cliente onboarded](/screenshots/pilot-final-tenants-list.png)

Approfondisci un tenant per le sue indagini aperte, le revisioni e la salute di Wazuh:

![Dettaglio tenant](/screenshots/pilot-final-acme-detail.png)

**Chiedi all'analista SOC AI.** La vista **Chat** risponde a domande sull'intera flotta o limitate a un singolo tenant, chiamando strumenti sui dati live e riassumendo ciò che trova:

![Ask AI, un riepilogo su tutta la flotta, con la chiamata allo strumento eseguita](/screenshots/pilot-chat-mssp-reply.png)
![Ask AI, limitato a un singolo tenant](/screenshots/pilot-chat-tenant-reply.png)

::: tip
L'AI ha bisogno di un vero [provider LLM](/it-it/integrate/llm-providers) configurato; la chiave segnaposto dello smoke test non risponderà alle domande.
:::

## 5. Messa a punto con un file di configurazione

Una volta che un pilot funziona dalla console, puoi catturare la stessa configurazione come file YAML e guidarlo in modalità headless con `launchpad up`: senza console. Ricorri a questo quando vuoi:

- **Esecuzioni ripetibili e scriptate**: versiona la configurazione in git, eseguila in CI e verifica gli assert sullo stream di eventi JSON.
- **Controllo fine che il form non espone**: fissa un'immagine di base o il suo SHA, punta a uno specifico tag di release di `install.sh`, esegui script per molti tenant in una volta, o regola CPU / memoria / disco per VM.

La console e la configurazione condividono gli stessi Host e Network sotto `~/.launchpad`, quindi un'esecuzione da configurazione riutilizza esattamente ciò che hai già testato.

Salva questo come `pilot.yaml` e sostituisci i valori tra parentesi:

```yaml
run_id: my-pilot

# Provisioning target — the plugin that creates VMs. Others: vmware, hetzner, proxmox, docker.
target: qemu

# Passed opaquely to the qemu plugin's initialize.
plugin_config:
  ssh_host: [user]@[vm-host-ip]      # SSH target on your KVM host
  work_dir: /home/[user]/lp-vms       # writable path; caches images + hosts VM disks
  tailnet: [your-tailnet].ts.net
  cpu: 4
  memory_mb: 8192
  disk_gb: 60
  # base_image_url is optional; defaults to the current Ubuntu Noble cloud image.
  # base_image_sha256: <optional pin>

# SSH keys authorized on every provisioned VM (the launchpad SSHes in as `ops`).
ssh_keys:
  - "ssh-ed25519 AAAA... you@laptop"

mssp:
  key: mssp
  name: my-pilot-mssp
  role: mssp
  tags: { role: mssp }

tenants:
  - key: tenant-acme
    name: acme-corp
    role: tenant
    tenant_slug: acme
    tags: { role: tenant, tenant_slug: acme }

# Post-provision installation phase.
install:
  # Point at a pinned release tag for reproducible smoke tests. `main` also works.
  installer_url: https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh
  mssp_admin_email: admin@my-pilot.demo
  mssp_admin_password: [pick-a-strong-one]
  mssp_display_name: My Pilot MSSP
  llm_provider: anthropic
  llm_api_key: [your-anthropic-key]
```

::: warning Informazioni sulla password di admin
Salvala in un password manager prima di eseguire. Il launchpad non te la ristamperà se la perdi di vista.
:::

Per aggiungere tenant, estendi l'elenco `tenants:`. Ognuno ha bisogno di una `key` univoca, un `tenant_slug` che corrisponda alla tua ACL Tailscale e una voce corrispondente sotto `tagOwners`.

### Eseguilo

```bash
export TAILSCALE_API_KEY=tskey-api-...

launchpad up --config pilot.yaml --state ~/.launchpad/state.json
```

Il comportamento predefinito visualizza una TUI Bubble Tea con barre di avanzamento per VM, un log eventi in tempo reale e un prompt di gate per i passaggi interattivi. Per esecuzioni non presidiate (CI, script, gli smoke test di questa guida) usa `--headless` per trasmettere eventi JSON su stdout:

```bash
launchpad up --config pilot.yaml \
  --state ~/.launchpad/state.json \
  --headless --auto-resolve-gates | tee run.log
```

`--auto-resolve-gates` accetta ogni gate (attualmente solo la conferma dell'ACL Tailscale) senza chiedere conferma. Ometti l'opzione se vuoi rivedere la tua ACL prima che i tenant vengano provisioned.

Tempistica approssimativa delle fasi in una prima esecuzione (cache vuota, connessione domestica decente):

| Fase | Durata | Cosa sta succedendo |
|---|---|---|
| `provisioning` | 60-90s | Download dell'immagine (~600 MB) + cloud-init + join Tailscale |
| `installing` (MSSP) | 3-5 min | Installazione k3s, Helm, chart `soctalk-system` |
| `installing` (per tenant) | 3-5 min | k3s + Helm + `soctalk-cloud-agent`, poi l'MSSP invia il chart `soctalk-tenant` (Wazuh + adapter) |
| Totale | **~10-15 min** | per MSSP + 1 tenant |

Le esecuzioni successive sono molto più veloci perché l'immagine di base è in cache sull'host VM.

## 6. Itera, riprendi, smonta, riavvia

Il launchpad è idempotente. Rilanciare un'esecuzione (di nuovo **Launch** dalla console, o `launchpad up`) riprende da dove si era interrotto:

- Le VM già esistenti vengono riutilizzate (nessun doppio provisioning)
- Il passaggio di installazione dell'MSSP viene saltato se l'API risponde già
- L'onboarding del tenant viene saltato se il tenant esiste già
- Il chart `soctalk-cloud-agent` viene installato con `helm upgrade --install`, non reinstallato

Per smontare tutto in modo pulito (VM, dispositivi Tailscale, work dir), usa l'azione **Down** della console oppure:

```bash
launchpad down --config pilot.yaml --state ~/.launchpad/state.json
```

Per aggiungere un tenant a un pilot in esecuzione, aggiungilo nella console (o modifica `tenants:` in `pilot.yaml`) e rilancia. Le VM esistenti vengono lasciate intatte; il nuovo tenant viene provisioned e installato.

## 7. Troubleshooting

### `vm.wait_ready` va in timeout

La VM è avviata ma non si è mai unita alla tailnet. Il cloud-init sulla VM non è riuscito a raggiungere i server di coordinamento Tailscale.

- Conferma che il tuo host VM abbia accesso a internet
- Collegati via SSH all'host VM e ispeziona il log seriale QEMU in `<work_dir>/<run_id>/<vm_key>/serial.log`: cattura l'output di cloud-init incluso tailscale-up
- Causa comune: la chiave di autenticazione effimera è stata revocata prima che la VM la usasse (controlla il log Tailscale admin → Machines)

### L'installazione MSSP va in timeout su `helm upgrade`

L'installazione del chart è partita ma i pod non sono convergiti in 15 minuti. Di solito il pull delle immagini su connessioni lente.

- Collegati via SSH alla VM MSSP: `sudo k3s kubectl -n soctalk-system get pods` e controlla `ImagePullBackOff` o `CrashLoopBackOff`
- Se i pod stanno ancora effettuando il pull, attendi e rilancia; il secondo tentativo salta il passaggio di installazione una volta che l'API risponde

### L'agente tenant registra `no such host` su `/api/agent/register`

Il DNS del cluster del pod non riesce a risolvere l'hostname della tailnet dell'MSSP. È esattamente a questo che serve `hostAliases`. Il launchpad lo inserisce nel comando helm di default; se lo stai facendo a mano, vedi il [pilot fai-da-te](/it-it/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant).

### Automazione

La modalità `--headless` è la superficie di automazione del launchpad. Ogni fase, cambio di stato della VM, riga di log dell'installazione e prompt di gate è un evento JSON su stdout:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Verifica gli assert su quegli eventi dalla tua CI. Vedi [Schema degli eventi Launchpad](/it-it/reference/launchpad-events) per l'elenco completo.

## Dove andare adesso

- **Aggiungi un tenant reale.** Fai l'onboarding dalla dashboard MSSP; vedi [pilot fai-da-te §3](/it-it/mssp-pilot#3-onboard-tenants) per la procedura guidata.
- **Genera alcuni alert.** [Simulatore di attacchi](/it-it/mssp-pilot#5-3-generate-alerts) contiene il runbook.
- **Punta l'AI su dati reali.** Configura correttamente il tuo [provider LLM](/it-it/integrate/llm-providers) (la chiave segnaposto dello smoke test non risponderà alle domande).
- **Passa alla produzione.** [Install](/it-it/install) è il percorso non-launchpad, HA-capable.
