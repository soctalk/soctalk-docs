# Quickstart: VM demo di SocTalk

Il modo più rapido per provare SocTalk end-to-end: scarica un'immagine VM pre-costruita, avviala, apri la procedura guidata di configurazione nel browser e prosegui con i clic. Cinque minuti per un'installazione multi-tenant funzionante con un tenant demo già onboardato.

Questo percorso è pensato per **valutatori e demo** — per un'installazione di produzione sul tuo cluster consulta [Installazione](/it-it/install).

## Cosa contiene l'immagine

- Ubuntu 24.04 LTS, con cloud-init abilitato
- K3s con ingress Traefik integrato
- Helm + un chart `soctalk-system` pre-scaricato
- Una procedura guidata di configurazione al primo avvio su `:8443`
- Un installer al primo avvio (`soctalk-firstboot.service`) che viene eseguito dopo che la procedura guidata ha raccolto la configurazione
- L'immagine è la stessa indipendentemente dal formato (qcow2 / vmdk / vhdx / vhd / raw); scegli quello che il tuo hypervisor consuma nativamente. Consulta [Download](/it-it/downloads).

## 1. Download

Scegli il formato per il tuo hypervisor nella pagina [Download](/it-it/downloads). Esempi:

```bash
# KVM / Proxmox / libvirt
curl -L -o soctalk-demo.qcow2.xz \
  https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-<ver>.qcow2.xz
xz -d soctalk-demo.qcow2.xz
```

Verifica il checksum:

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 2. Avvia l'immagine

### KVM / libvirt (CLI)

```bash
qemu-system-x86_64 \
  -m 8G -smp 4 -enable-kvm -cpu host \
  -drive file=soctalk-demo.qcow2,format=qcow2,if=virtio \
  -netdev user,id=net0,hostfwd=tcp::18022-:22,hostfwd=tcp::18443-:8443 \
  -device virtio-net,netdev=net0 \
  -nographic
```

### Proxmox VE

`qm disk import <vmid> soctalk-demo.qcow2 <storage>`, poi collega come SCSI e avvia. Procedura completa con screenshot della web-UI: [Esecuzione su Proxmox](/it-it/proxmox).

### VMware

Importa `soctalk-demo.vmdk` come disco esistente su una nuova VM (Linux, Ubuntu 64-bit).

### VirtualBox

Converti `soctalk-demo.vmdk` in VDI e collegalo a una nuova VM. Procedura completa con screenshot: [Esecuzione su VirtualBox](/it-it/virtualbox).

### Hyper-V

Usa `soctalk-demo.vhdx` come disco del sistema operativo su una VM di **Generazione 1** (l'immagine si avvia tramite firmware BIOS; la Generazione 2 / UEFI non è testata). Per iniettare una chiave SSH, collega un `seed.iso` NoCloud come unità DVD — consulta [Opzionale: seed cloud-init](#opzionale-seed-cloud-init).

### AWS

Costruisci un AMI nativo con Packer, oppure importa `soctalk-demo.vmdk` come AMI con VM Import. Procedura completa: [Esecuzione su AWS](/it-it/aws).

### Azure

Carica `soctalk-demo.vhd` (dimensione fissa) direttamente su un Managed Disk, poi crea da esso un'immagine di Generazione 1 e una VM. Procedura completa: [Esecuzione su Azure](/it-it/azure).

### Raw / dd

`soctalk-demo.raw` è, bit per bit, ciò che si trova su disco. Adatto per l'import di immagini cloud generiche (GCP, OpenStack) o per la scrittura su un disco fisico con `dd`.

**Dimensionamento minimo**: 4 vCPU, 8 GB di RAM, 60 GB di disco. Consulta [Dimensionamento](/it-it/reference/sizing).

## 3. Ottieni il token di configurazione

La procedura guidata si lega a `:8443` con TLS (self-signed). Rifiuta le connessioni prive del token di configurazione per-boot. Collegati alla macchina via SSH e leggilo:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

Il login consigliato è l'**utente `ops` con la tua chiave SSH**, creato dal seed cloud-init in [§ Opzionale: seed cloud-init](#opzionale-seed-cloud-init) più avanti. Se avvii senza un seed, consulta [§ Accesso SSH + credenziali](#accesso-ssh-credenziali) per il fallback disponibile in fase di build — e leggi la nota di sicurezza lì presente prima di esporre la VM a una rete di cui non ti fidi.

## 4. Apri la procedura guidata

Vai su `https://<vm-ip>:8443/`. Accetta il certificato self-signed. Arriverai alla pagina di inserimento del token:

![Procedura guidata di configurazione — inserimento token](/screenshots/setup-wizard-token.png)

Incolla il token, poi compila:

- Nome MSSP / organizzazione
- Hostname (opzionale — lascia vuoto per usare l'IP della macchina)
- Email + password amministratore (min 12 caratteri)
- Provider LLM + API key

Consulta [Procedura guidata di configurazione](/it-it/setup-wizard) per il riferimento completo dei campi.

Invia. La procedura guidata scrive `values.yaml`, il Secret dell'LLM e un file env di onboarding, poi termina. L'installer al primo avvio prende il controllo:

1. Avvia k3s
2. Crea il namespace `soctalk-system` + il Secret dell'LLM
3. `helm install soctalk-system`
4. Effettua il login come amministratore bootstrap e onboarda un tenant `demo` tramite `POST /api/mssp/tenants/onboard`

Tempo totale dall'invio: circa 2 minuti perché i pod di `soctalk-system` siano Ready, poi altri 1–3 minuti perché lo stack Wazuh del tenant demo raggiunga lo stato Ready.

## 5. Accedi

Vai su `https://<vm-ip>/` (nota: porta 443, non 8443 — la procedura guidata si lega specificamente alla 8443 per evitare conflitti con Traefik). La dashboard MSSP richiede un nome DNS; se hai usato un hostname vuoto aggiungi una voce `/etc/hosts` che punti `soctalk.local` all'IP della VM e vai su `https://soctalk.local/`.

Accedi con l'email + password amministratore impostate nella procedura guidata. Arriverai alla dashboard MSSP. Prosegui con il [Tour della UI MSSP](/it-it/mssp-ui).

## Opzionale: seed cloud-init

Se vuoi iniettare una chiave SSH (o saltare del tutto la procedura guidata fornendo direttamente values.yaml), passa i user-data di cloud-init tramite NoCloud:

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
echo "instance-id: $(uuidgen)" > meta-data
cloud-localds seed.iso user-data meta-data

# attach seed.iso as a second drive on first boot.
```

Per saltare la procedura guidata, deposita `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` tramite `write_files` di cloud-init; la condizione systemd della procedura guidata (`ConditionPathExists=!/etc/soctalk/values.yaml`) andrà in cortocircuito e l'installer passerà direttamente a `helm install`.

## Accesso SSH + credenziali

Le immagini disco scaricabili (qcow2 / vmdk / vhdx / vhd / raw) includono tutte **due** possibili identità di login. Quale usare dipende dal fatto che tu abbia fornito o meno i user-data di cloud-init.

### Produzione: utente `ops` (consigliato)

Il seed cloud-init in [§ Opzionale: seed cloud-init](#opzionale-seed-cloud-init) crea un utente `ops` con la tua chiave SSH. Solo autenticazione con chiave SSH — nessuna password impostata.

```bash
ssh -i ~/.ssh/<your-private-key> ops@<vm-ip>

# Root shell, no further password
sudo -i
```

### Utente `ubuntu` di build (presente in ogni immagine distribuita)

La build Packer usa un utente `ubuntu` di build con una password nota. Il passaggio di pulizia che dovrebbe bloccare questo account non è ancora stato predisposto, quindi viene distribuito nell'immagine. Se avvii senza un seed cloud-init è l'unico modo per ottenere l'accesso alla console via SSH:

| Utente | Password | Sudo |
|---|---|---|
| `ubuntu` | `packer` | `ALL=(ALL) NOPASSWD:ALL` |

L'autenticazione SSH con password è abilitata dallo stesso seed, quindi l'immagine accetta:

```bash
# Interactive
ssh ubuntu@<vm-ip>
# password: packer

# Non-interactive (requires sshpass)
sshpass -p packer ssh -o StrictHostKeyChecking=accept-new ubuntu@<vm-ip>

# Root shell, no further password
sudo -i
```

### Checklist di hardening

Esegui come `ops` dopo il primo avvio, oppure inseriscila nel tuo `runcmd:` di cloud-init in modo che venga eseguita automaticamente:

```bash
# Disable the build user
sudo passwd -l ubuntu
sudo usermod -s /usr/sbin/nologin ubuntu

# Turn off password SSH auth
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```

L'AMI AWS è costruita da una sorgente Packer separata (`amazon-ebs`) che non include il seed e usa invece l'iniezione della keypair di EC2 — non porta con sé la credenziale `ubuntu:packer`. La checklist di hardening si applica comunque ad essa per l'utente standard `ubuntu` dell'immagine cloud AMI.

## Passo successivo: onboarda i clienti con Launchpad

Hai appena eseguito SocTalk end-to-end su una singola macchina co-locata. Il passo naturale successivo è un vero pilot — un control plane MSSP più uno o più ambienti tenant sulla tua infrastruttura. [**Launchpad**](/it-it/launchpad) fa esattamente questo con un solo comando: avvia le VM, le unisce alla tua tailnet, installa SocTalk da sorgenti pubbliche e ti consegna una URL. (Preferisci eseguire ogni passo a mano? Consulta il [pilot MSSP fai-da-te](/it-it/mssp-pilot).)

## Risoluzione dei problemi

| Sintomo | Verifica |
|---|---|
| L'URL della procedura guidata non si carica mai | `systemctl status soctalk-setup-wizard` sulla VM. Se è `inactive`, guarda `journalctl -u soctalk-setup-wizard` |
| La procedura guidata dice "invalid token" | Il token si trova in `/var/log/soctalk-setup-token`, **di proprietà di root**. Usa `sudo cat`. Ogni avvio rigenera il token |
| La procedura guidata dice "rate-limited" | La procedura guidata blocca l'IP dopo 10 tentativi di token falliti. Attendi 1 h oppure esegui `systemctl restart soctalk-setup-wizard` (questo ruota anche il token) |
| `helm install` si blocca | `kubectl get pods -A` dalla macchina; `journalctl -u soctalk-firstboot -f` |
| I pod adapter / runs-worker del tenant demo bloccati in ImagePullBackOff | Noto: il controller usa come default un tag immagine non pubblicato. Consulta [Risoluzione dei problemi](/it-it/troubleshooting) |

Per un reset pulito: elimina `/var/lib/soctalk-firstboot.done`, `/var/lib/soctalk-wizard.done`, `/etc/soctalk/values.yaml`, poi esegui `systemctl restart soctalk-setup-wizard`.
