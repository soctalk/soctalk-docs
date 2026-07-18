# Esegui la VM demo su Proxmox VE

Importa l'immagine pubblicata `soctalk-demo-<ver>.qcow2` in Proxmox VE e avviala. qcow2 è il formato disco nativo di Proxmox, quindi si tratta di un'importazione con un solo comando — nessun passaggio di conversione.

Questo percorso è pensato per **valutatori e demo** — per un'installazione in produzione sul tuo cluster consulta [Install](/it-it/install). Validato su Proxmox VE 8.4.

## Prerequisiti

- Un nodo Proxmox VE 8.x con ≥ 4 vCPU / 8 GB di RAM / 60 GB di storage disponibili ([dimensionamento](/it-it/reference/sizing)).
- Uno storage che accetti contenuti di tipo **Disk image** (il `local-lvm` predefinito o uno storage directory come `local` con *Disk image* abilitato).
- Accesso shell al nodo (l'importazione del disco è un singolo comando `qm`; tutto il resto avviene nella web UI).

## 1. Scarica l'immagine sul nodo

Collegati via SSH al nodo Proxmox:

```bash
VER=<ver>   # e.g. 0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.qcow2.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.qcow2.xz
```

## 2. Crea l'ISO seed di cloud-init

Un'ISO seed NoCloud crea un utente `ops` con la tua chiave SSH. Senza di essa puoi comunque accedere come utente `ubuntu:packer` creato in fase di build (vedi [Accesso SSH](/it-it/quickstart-vm#ssh-access-credentials)), ma quella credenziale è presente nell'albero sorgente pubblico — fornisci il seed prima di esporre la VM a una rete di cui non ti fidi. Sul nodo, o su una qualsiasi macchina Linux:

```bash
cat > user-data <<'EOF'
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
cat > meta-data <<'EOF'
instance-id: soctalk-demo-001
local-hostname: soctalk-demo
EOF
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
# (apt install genisoimage if missing; cloud-localds from cloud-image-utils also works)
mv soctalk-seed.iso /var/lib/vz/template/iso/
```

Se hai creato l'ISO altrove, caricala invece nella UI: seleziona lo storage `local` → **ISO Images** → **Upload**.

::: tip
Puoi saltare del tutto il wizard aggiungendo `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` al seed tramite `write_files` — vedi [Opzionale: seed di cloud-init](/it-it/quickstart-vm#optional-cloud-init-seed).
:::

## 3. Crea la VM nella web UI

Fai clic su **Create VM** (in alto a destra) e segui il wizard:

**General** — scegli un ID e un nome per la VM:

![Create VM — General](/screenshots/proxmox-create-general.png)

**OS** — seleziona **Do not use any media** (il sistema operativo è già presente sul disco importato):

![Create VM — OS](/screenshots/proxmox-create-os.png)

**System** — mantieni i valori predefiniti (SeaBIOS, i440fx — l'immagine si avvia tramite firmware BIOS).

**Disks** — elimina il disco predefinito con l'icona del cestino accanto a `scsi0`; il qcow2 importato lo sostituisce:

![Create VM — Disks](/screenshots/proxmox-create-disks.png)

**CPU** — 4 core, e imposta **Type** su `host`:

![Create VM — CPU](/screenshots/proxmox-create-cpu.png)

**Memory** — 8192 MiB:

![Create VM — Memory](/screenshots/proxmox-create-memory.png)

**Network** — il bridge della tua LAN (tipicamente `vmbr0`), modello VirtIO:

![Create VM — Network](/screenshots/proxmox-create-network.png)

**Confirm** — Finish. Non avviare ancora la VM.

## 4. Importa il disco

L'unico passaggio da CLI. Sul nodo (adatta l'ID della VM e lo storage di destinazione):

```bash
qm disk import 100 soctalk-demo-<ver>.qcow2 local --format qcow2
```

Su storage LVM-thin (`local-lvm`) ometti il flag `--format` — gli storage a blocchi memorizzano in formato raw. L'importazione compare sulla VM come **Unused Disk 0**.

## 5. Collega disco, ISO seed e ordine di avvio

Torna nella UI e apri il pannello **Hardware** della VM:

![Hardware — unused disk](/screenshots/proxmox-hardware-unused.png)

- Fai doppio clic su **Unused Disk 0** → lascia Bus/Device su `SCSI 0` → **Add**:

![Attach the imported disk](/screenshots/proxmox-attach-disk.png)

- Fai doppio clic su **CD/DVD Drive (ide2)** → *Use CD/DVD disc image file* → storage `local`, ISO `soctalk-seed.iso` → **OK**:

![Mount the seed ISO](/screenshots/proxmox-attach-seed.png)

- **Options** → **Boot Order** → metti `scsi0` per primo (oppure `qm set 100 --boot order=scsi0`).

Il pannello Hardware dovrebbe ora apparire così:

![Hardware — final](/screenshots/proxmox-hardware-final.png)

## 6. Avvia e trova l'IP della VM

Fai clic su **Start**. Il pannello Summary mostra la VM in esecuzione:

![VM running](/screenshots/proxmox-vm-running.png)

La **Console** mostra l'appliance che si avvia fino al prompt di login:

![Console — booted](/screenshots/proxmox-vm-console.png)

La VM ottiene un lease DHCP dal bridge della tua LAN. Trova il suo IP dalla console (`login: ops` funziona solo tramite chiave SSH — usa l'output della console oppure il tuo server DHCP/router), oppure dal nodo:

```bash
# the MAC is on the VM's Network Device (net0)
grep -B2 -A2 "$(qm config 100 | grep -oP 'virtio=\K[^,]+')" /var/lib/misc/dnsmasq.leases 2>/dev/null \
  || arp -an | grep -i "$(qm config 100 | grep -oP 'virtio=\K[^,]+')"
```

## 7. Esegui il wizard e accedi

Da qui il flusso è lo stesso di ogni piattaforma:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Vai su `https://<vm-ip>:8443/`, accetta il certificato self-signed, incolla il token e compila il wizard ([riferimento dei campi](/it-it/setup-wizard)). Dopo l'invio, l'installer di primo avvio esegue `helm install` e effettua l'onboarding del tenant `demo` — circa 2 minuti per i pod `soctalk-system`, poi qualche minuto in più per lo stack Wazuh del tenant demo.

Vai quindi su `https://<vm-ip>/` (porta 443, non 8443), accedi con le credenziali admin definite nel wizard e prosegui con il [Tour della UI MSSP](/it-it/mssp-ui). Se hai lasciato vuoto l'hostname nel wizard, mappa `soctalk.local` all'IP della VM in `/etc/hosts` e usa `https://soctalk.local/`.

## Risoluzione dei problemi

| Sintomo | Verifica |
|---|---|
| `qm disk import` fallisce con un errore di storage | Lo storage di destinazione deve consentire contenuti di tipo **Disk image**: Datacenter → Storage → edit → Content |
| La VM si avvia mostrando "No bootable device" | L'ordine di avvio punta ancora al disco predefinito eliminato — Options → Boot Order → `scsi0` per primo |
| Il wizard compare ma niente SSH | L'ISO seed non è collegata (Hardware → ide2) oppure la chiave in `user-data` è errata; puoi leggere il token dalla Console: `sudo cat /var/log/soctalk-setup-token` |
| La VM non ha un IP | `ip a` dalla Console; verifica che il bridge in Hardware → net0 corrisponda a un bridge con DHCP sulla tua LAN |
| La VM ha un IP ma nessun accesso a internet (configurazioni con bridge NAT) | PVE imposta `bridge-nf-call-iptables=1`, il che può far sì che il traffico bridged bypassi una regola `MASQUERADE` limitata all'interfaccia di uplink. `sysctl -w net.bridge.bridge-nf-call-iptables=0` (se non usi il firewall PVE) oppure usa una regola indipendente dall'interfaccia: `iptables -t nat -A POSTROUTING -s <subnet> ! -d <subnet> -j MASQUERADE`, poi svuota conntrack |
| Qualsiasi problema successivo al wizard | Come per ogni piattaforma — vedi la [tabella di risoluzione dei problemi del Quickstart](/it-it/quickstart-vm#troubleshooting) |
