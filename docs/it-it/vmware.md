# Esegui la VM demo su VMware ESXi

Importa il file `soctalk-demo-<ver>.vmdk` pubblicato in VMware ESXi e avvialo. Questa guida copre **ESXi 7/8** con l'Host Client integrato (l'interfaccia browser). Se invece esegui Fusion o Workstation su un laptop, il flusso è quasi identico; importa lo stesso vmdk tramite File → Open.

Questo percorso è pensato per **valutatori e demo** che eseguono SocTalk sul proprio ESXi on-premise esistente. Per un'installazione di produzione sul tuo cluster Kubernetes, consulta [Install](/it-it/install). Validato su ESXi 8.0.3 (build 24677879) con Host Client 2.x.

## Prerequisiti

- ESXi 7.0 o più recente con un datastore utente esistente (VMFS). Se non hai ancora un datastore, la [sezione Nuovo datastore](#optional-create-a-vmfs-datastore) qui sotto ti guida.
- Root o un utente con il privilegio `Virtual machine.Provisioning.Deploy from template`.
- Un port group (di solito il **VM Network** creato automaticamente) che disponga di DHCP + HTTPS in uscita.
- ~10 GB liberi sul datastore (il vmdk è ~800 MB streamOptimized ma si converte in un disco VMFS thin da 60 GB che cresce su richiesta).
- Una coppia di chiavi SSH (`~/.ssh/id_ed25519.pub` negli esempi) per leggere il token di setup via SSH.

::: warning Ti serve un vero datastore VMFS, non il volume OSDATA di ESXi
L'installer di ESXi crea un volume `OSDATA-*` sul disco di boot. Compare in `esxcli storage filesystem list` e viene montato sotto `/vmfs/volumes/`, ma **non** è un normale datastore utente e le VM archiviate su di esso non si accendono, restituendo `msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`. Aggiungi un disco o una partizione separata e formattala come VMFS prima di continuare.
:::

## 1. Scarica e verifica l'immagine

Preleva il **vmdk** dalla pagina [Downloads](/it-it/downloads). Su qualsiasi host Linux/macOS che disponga di `ovftool` o via SSH con accesso alla console di una VM ESXi:

```bash
VER=0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

Ora hai `soctalk-demo-<ver>.vmdk`, un disco VMware **streamOptimized** (hosted). Il VMFS di ESXi non lo esegue direttamente; il §4 lo converte una volta con `vmkfstools`.

## 2. Costruisci un ISO seed cloud-init

Un piccolo ISO seed NoCloud crea un utente `ops` con la tua chiave SSH così puoi leggere il token di setup per-boot. Se lo salti puoi comunque accedere come utente `ubuntu:packer` di build-time (vedi [Accesso SSH](/it-it/quickstart-vm#ssh-access-credentials)) — ma quella credenziale è presente nell'albero sorgente pubblico, quindi metti in sicurezza la VM prima di esporla. Su Linux/macOS:

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - $(cat ~/.ssh/id_ed25519.pub)
EOF
printf 'instance-id: soctalk-demo\nlocal-hostname: soctalk-demo\n' > meta-data
# Linux: genisoimage / cloud-localds   •   macOS: hdiutil o mkisofs (brew install cdrtools)
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
```

## 3. (Opzionale) Crea un datastore VMFS

Salta questo passaggio se il tuo ESXi ha già un datastore utente (ad es. `datastore1`) con 10+ GB liberi.

Accedi all'Host Client e vai su **Storage** → **Datastores**. Un'installazione a cui non è stato assegnato un disco dati si presenta così:

![ESXi Host Client — scheda Storage senza datastore](/screenshots/esxi-storage-empty.png)

Fai clic su **New datastore** per aprire la procedura guidata in 5 passi.

**Passo 1 — Select creation type.** Scegli **Create new VMFS datastore**. Next.

![Nuovo datastore passo 1 — tipo di creazione](/screenshots/esxi-new-datastore-01-type.png)

**Passo 2 — Name and select device.** Inserisci un nome (`datastore1` è quello convenzionale) e scegli il disco da formattare. Qui compaiono solo i dischi non rivendicati.

![Nuovo datastore passo 2 — nome](/screenshots/esxi-new-datastore-02-name.png)
![Nuovo datastore passo 3 — selezione dispositivo](/screenshots/esxi-new-datastore-03-device.png)

**Passo 3 — Select partitioning options.** Predefinito: **Use full disk, VMFS 6**. Conferma e fai clic su Next.

![Nuovo datastore passo 4 — partizionamento](/screenshots/esxi-new-datastore-04-partition.png)

**Passo 4 — Ready to complete.** Verifica il riepilogo e fai clic su **Finish**. ESXi avverte che il disco verrà ripartizionato; conferma.

![Nuovo datastore passo 5 — revisione](/screenshots/esxi-new-datastore-05-review.png)

**Risultato.** Storage → Datastores ora mostra il nuovo datastore VMFS6. Recent tasks riporta il completamento con successo sia di **Create Vmfs Datastore** sia di **Rescan Vmfs**.

![Datastore creato](/screenshots/esxi-datastore-created.png)

## 4. Carica e converti il vmdk

Il vmdk da GHCR è streamOptimized. Il sottosistema VM di ESXi richiede un disco VMFS thin. Due percorsi:

::: code-group

```bash [SSH + vmkfstools (recommended)]
# Enable SSH on the ESXi host: Host Client → Actions → Services → Enable SSH
# Copy the vmdk to the datastore (from any host that has scp)
DS=/vmfs/volumes/datastore1
scp soctalk-demo-0.1.4.vmdk root@<esxi-host>:$DS/soctalk-source.vmdk

# On the ESXi host: convert to VMFS thin (~1 minute on a fast SSD)
ssh root@<esxi-host>
mkdir -p /vmfs/volumes/datastore1/SocTalk-Demo
vmkfstools -i /vmfs/volumes/datastore1/soctalk-source.vmdk \
           /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmdk -d thin
rm /vmfs/volumes/datastore1/soctalk-source.vmdk
```

```bash [ovftool from your workstation]
# Wraps the vmdk into a minimal OVF and pushes to ESXi in one command
ovftool --acceptAllEulas --diskMode=thin \
  --datastore=datastore1 \
  --net:"VM Network"="VM Network" \
  --name=SocTalk-Demo \
  soctalk-demo-0.1.4.vmdk \
  vi://root:<password>@<esxi-host>
```

:::

Carica anche l'ISO seed tramite **Storage → Datastore browser → Upload**:

```
[datastore1]/SocTalk-Demo/soctalk-seed.iso
```

## 5. Crea la VM

Vai su **Virtual Machines** nell'Host Client e fai clic su **Create / Register VM** per aprire la procedura guidata in 5 passi.

![Procedura guidata Create / Register VM](/screenshots/esxi-create-vm-wizard.png)

Segui la procedura guidata:

- **Select creation type** — **Register an existing virtual machine** (abbiamo già posizionato il vmdk nel passo 4).

Se la tua build di ESXi nasconde quell'opzione o preferisci configurare tutto dalla procedura guidata, scegli invece **Create a new virtual machine** e usa queste impostazioni:

- **Select a name and guest OS** — Nome `SocTalk-Demo`. Compatibilità `ESXi 8.0 virtual machine`. Famiglia guest OS `Linux`. Versione guest OS `Ubuntu Linux (64-bit)`.
- **Select storage** — `datastore1`.
- **Customize settings** — imposta:
  - **CPU** 4
  - **Memory** 8 GB
  - **Hard disk 1** — fai clic sulla riga del disco → **Existing hard disk**, naviga fino a `[datastore1] SocTalk-Demo/SocTalk-Demo.vmdk`
  - **Network adapter 1** — Network `VM Network`, tipo di adattatore `VMXNET3` (la NIC paravirtualizzata raccomandata da VMware; usala su ESXi bare-metal per le migliori prestazioni)
  - **CD/DVD drive 1** — Datastore ISO file, naviga fino a `soctalk-seed.iso` — spunta **Connect at power on**
  - Lascia il controller USB e il Floppy ai loro valori predefiniti.
- **Ready to complete** — Finish.

La VM compare nell'elenco Virtual Machines con `Register VM` contrassegnato come completato con successo.

![VM registrata su datastore1](/screenshots/esxi-vm-registered.png)

## 6. Accendi e apri la console

Seleziona **SocTalk-Demo** e fai clic su **Power on**. L'intestazione passa allo stato verde di accensione e la miniatura della console inizia ad aggiornarsi.

![VM accesa, pannello hardware visibile](/screenshots/esxi-vm-powered-on.png)

Fai clic su **Console** → **Open browser console** (la scheda standalone è più comoda per digitare rispetto all'anteprima inline).

![Menu a discesa della console](/screenshots/esxi-console-menu.png)

La console mostra Ubuntu 24.04 che avvia il boot attraverso cloud-init e arriva a un prompt di login:

![Console VM — boot di Ubuntu fino al login](/screenshots/esxi-vm-console-boot.png)

## 7. Accedi alla VM

Hai due modi per entrare, entrambi ti danno una shell da cui puoi fare `sudo -i` per diventare root.

::: code-group

```bash [SSH as ops (seed ISO required)]
# From the host whose SSH public key is in the seed ISO you built in §2.
# The VM's IP shows in the Host Client under SocTalk-Demo →
# General information → Networking.
ssh ops@<vm-ip>

# From the ops shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
whoami         # → root
```

```bash [SSH as ubuntu:packer (fallback — no seed ISO)]
# Every published image ships a build-time ``ubuntu`` account with password
# ``packer``. This credential is in the public source tree, so treat it as
# public information; harden or delete the account before exposing the VM.
ssh ubuntu@<vm-ip>
# Password: packer

# From the ubuntu shell:
sudo -i        # → root shell (NOPASSWD sudo, no password prompt)
```

```text [Browser console (no SSH available)]
# Host Client → SocTalk-Demo → Console → Open browser console
# Same credentials as the SSH tabs above.

packer-build login: ubuntu
Password: packer                    # not echoed on screen

ubuntu@packer-build:~$ sudo -i
root@packer-build:~#
```

:::

::: warning Metti in sicurezza o elimina la credenziale packer prima di esporre la VM
Il login `ubuntu:packer` è integrato in ogni immagine pubblicata e risiede nell'albero sorgente pubblico. Su qualsiasi VM che esca da un laboratorio isolato: `sudo passwd -l ubuntu` (blocca l'account) più `sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null && sudo systemctl reload ssh`. Consulta [Accesso SSH + credenziali](/it-it/quickstart-vm#ssh-access-credentials) per la procedura di hardening completa.
:::

## 8. Leggi il token di setup

Dall'host che possiede la chiave privata SSH nell'ISO seed:

```bash
# Find the VM's IP: Host Client → SocTalk-Demo → General information → Networking
ssh ops@<vm-ip> sudo cat /run/soctalk/setup-token
```

Copia il token, quindi apri **https://\<vm-ip\>/** in un browser e incollalo quando la procedura guidata lo richiede. Prosegui da [Quickstart VM passo 6](/it-it/quickstart-vm#_6-open-the-setup-wizard).

Una volta completata l'installazione, ti trovi nella MSSP Dashboard:

![Dashboard MSSP SocTalk su ESXi](/screenshots/esxi-soctalk-mssp-dashboard.png)

## Risoluzione dei problemi

Le voci sottostanti si applicano a host ESXi bare-metal reali, salvo quando riportano un tag **(solo laboratorio annidato)**. Quelle contrassegnate sono emerse durante la validazione di questa guida su ESXi annidato (ESXi 8.0.3 come guest KVM sotto Ubuntu 24.04) e non riguardano l'hardware di produzione.

**`msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`** — i file della VM risiedono sotto `/vmfs/volumes/OSDATA-*` invece che su un vero datastore utente. Spostali: converti il vmdk con `vmkfstools -i` in un vero datastore VMFS (§3 + §4), copia il `.vmx` accanto, annulla la registrazione della vecchia VM (`vim-cmd vmsvc/unregister <id>`) e registra quella nuova (`vim-cmd solo/registervm /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmx SocTalk-Demo`).

**La VM si avvia ma l'interfaccia di rete è DOWN e non ottiene mai un IP** — l'immagine packer include una configurazione netplan che effettua il match tramite MAC. Quando ESXi assegna un nuovo MAC alla vNIC, il match fallisce e il DHCP non viene mai eseguito. Correggi modificando `/etc/netplan/50-cloud-init.yaml` per effettuare il match tramite nome di interfaccia:

```yaml
network:
  version: 2
  ethernets:
    all:
      match:
        name: "en*"
      dhcp4: true
```

Poi `netplan apply`.

**`ovftool: error while loading shared libraries: libssl.so.1.1`** — installa un runtime OpenSSL 1.1 compatibile, oppure usa invece il percorso SSH + `vmkfstools`.

**L'Host Client mostra un banner rosso relativo all'abilitazione della ESXi Shell / SSH** — atteso nei setup di valutazione. È un promemoria di hardening, non un errore. Disabilita SSH quando hai finito se l'host è esposto.

### Solo laboratorio annidato

Questi compaiono quando ESXi stesso è in esecuzione come guest all'interno di un altro hypervisor (KVM, VirtualBox, Fusion, Workstation, o un'istanza cloud "bare-metal-lite"). Su ESXi bare-metal reale non ne vedrai nessuno; i valori predefiniti del §5 (NIC VMXNET3, hardware version 20, USB + Floppy abilitati) funzionano così come sono.

**L'accensione fallisce con `E1000PCI: failed to register e1000e device` o `Vmxnet3 PCI: failed to reserve slot` (solo laboratorio annidato)** — l'hypervisor esterno non emula una topologia PCIe sufficiente perché ESXi allochi uno slot per la NIC paravirtualizzata. Modifica `SocTalk-Demo.vmx` e imposta `ethernet0.virtualDev = "e1000"` (la classica NIC emulata, che richiede meno), poi `vim-cmd vmsvc/reload <id>` e accendi di nuovo. Su hardware reale, mantieni VMXNET3.

**vmx va in segfault con signal 11 / `msg.vmx.poweron.failed` sulla hardware version 20 (solo laboratorio annidato)** — alcuni hypervisor esterni non annunciano le funzionalità PCIe/EPT più recenti che vmx-20 presuppone. Modifica `SocTalk-Demo.vmx` e scendi a `virtualHW.version = "15"`, rimuovi `usb.present = "TRUE"` e `floppy0.present = "TRUE"` (o imposta entrambi a `"FALSE"`), poi `vim-cmd vmsvc/reload <id>` e riprova. Un ESXi bare-metal reale esegue vmx-20 senza problemi.
