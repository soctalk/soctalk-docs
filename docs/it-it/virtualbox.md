# Esegui la VM demo su VirtualBox

VirtualBox è il modo cross-platform più semplice per provare SocTalk su un desktop, gratuito, guidato da GUI e disponibile su Windows, Linux e macOS Intel. Questa guida importa l'immagine demo pubblicata e la avvia. Validata su VirtualBox 7.0.

Questo percorso è pensato per **valutatori e demo**: per un'installazione di produzione sul tuo cluster consulta [Install](/it-it/install).

::: warning Mac Apple Silicon (serie M)
L'immagine demo è **x86-64**, che VirtualBox non può eseguire su Apple Silicon. Su un Mac serie M, usa un [lancio cloud](/it-it/aws) o un altro host. Qui VirtualBox significa Windows, Linux o un Mac **Intel**.
:::

## Prerequisiti

- [VirtualBox](https://www.virtualbox.org/) 7.0 o più recente.
- ~3 GB di spazio su disco libero per l'immagine convertita.
- Una coppia di chiavi SSH (`~/.ssh/id_ed25519.pub` negli esempi) per leggere il token di setup via SSH.

## 1. Scarica e decomprimi l'immagine

Preleva il **vmdk** dalla pagina [Downloads](/it-it/downloads) (il formato di VirtualBox compatibile con VMware):

```bash
VER=0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

## 2. Converti il vmdk nel formato nativo VDI di VirtualBox

Il vmdk rilasciato è **streamOptimized** (un layout VMware/OVA di sola lettura), che VirtualBox non avvia come disco scrivibile. Convertilo una volta in un VDI:

```bash
VBoxManage clonemedium disk soctalk-demo-0.2.0.vmdk soctalk-demo-0.2.0.vdi --format VDI
```

Questo produce un `soctalk-demo-0.2.0.vdi` scrivibile e dimensionato dinamicamente (pochi GB su disco). `VBoxManage` è incluso con VirtualBox, su Windows si trova in `C:\Program Files\Oracle\VirtualBox\`.

## 3. Crea un ISO seed cloud-init

Un piccolo ISO seed NoCloud crea un utente `ops` con la tua chiave SSH così puoi leggere il token di setup generato a ogni avvio. Se lo salti puoi comunque accedere come l'utente `ubuntu:packer` definito al momento della build (vedi [Accesso SSH](/it-it/quickstart-vm#ssh-access-credentials)), ma quella credenziale è presente nell'albero sorgente pubblico, quindi metti in sicurezza la VM prima di esporla. Su Linux/macOS:

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

## 4. Crea la VM

Apri **VirtualBox** e fai clic su **New**.

![VirtualBox Manager](/screenshots/virtualbox-manager.png)

**Name and Operating System**: assegna il nome `soctalk-demo`, imposta **Type** su *Linux* e **Version** su *Ubuntu (64-bit)*. Lascia l'ISO vuoto:

![Name and OS](/screenshots/virtualbox-create-name.png)

**Hardware**: assegna **8192 MB** di memoria e **4 CPUs** (il minimo di [dimensionamento](/it-it/reference/sizing) è 4 vCPU / 8 GB; lo stack Wazuh ha bisogno della RAM):

![Hardware](/screenshots/virtualbox-create-hardware.png)

**Virtual Hard disk**: scegli **Use an Existing Virtual Hard Disk File** e seleziona il `soctalk-demo-0.2.0.vdi` che hai convertito:

![Use existing disk](/screenshots/virtualbox-create-disk.png)

**Summary**: conferma le impostazioni e fai clic su **Finish**:

![Summary](/screenshots/virtualbox-create-summary.png)

La VM compare nel Manager con il VDI sul suo controller SATA:

![VM created](/screenshots/virtualbox-vm-details.png)

## 5. Collega l'ISO seed e configura la rete

Seleziona la VM e fai clic su **Settings**.

**Storage**: sotto il controller IDE, fai clic sull'unità ottica e scegli il tuo `soctalk-seed.iso` (fai clic sull'icona del disco → *Choose a disk file*). Il VDI è già su SATA:

![Storage](/screenshots/virtualbox-storage.png)

**Network**: imposta **Adapter 1 → Attached to: Bridged Adapter** così la VM ottiene un IP sulla tua LAN e puoi raggiungere direttamente il wizard:

![Network, bridged](/screenshots/virtualbox-network.png)

Fai clic su **OK**.

::: tip NAT invece di bridged
Se non puoi usare bridged (ad es. su una rete con restrizioni), lascia il NAT predefinito e aggiungi regole di **Port Forwarding** sotto Network → Advanced (host `8443` → guest `8443` per il wizard, host `8080` → guest `443` per la UI), quindi usa `localhost` al posto dell'IP della VM indicato sotto.
:::

## 6. Avvia e individua l'IP della VM

Fai clic su **Start**. La console si avvia fino a un prompt di login:

![Console](/screenshots/virtualbox-console.png)

Individua l'IP bridged della VM, dalle lease DHCP del tuo router, oppure abbinando il MAC della VM:

```bash
VBoxManage showvminfo soctalk-demo | grep "MAC"      # note the MAC
arp -an | grep -i <mac>                               # find the matching IP
```

## 7. Esegui il wizard e accedi

Leggi il token di setup generato a ogni avvio via SSH, poi esegui il wizard:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Vai su `https://<vm-ip>:8443/`, accetta il certificato self-signed, incolla il token e compila il wizard ([riferimento dei campi](/it-it/setup-wizard)). Dopo l'invio, l'installer di primo avvio esegue `helm install` e onboarda il tenant `demo`: circa 2 minuti per i pod `soctalk-system`, poi qualche minuto in più per lo stack Wazuh del tenant demo:

```bash
ssh ops@<vm-ip>
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Poi vai su `https://<vm-ip>/` (porta 443, non 8443), accedi con le credenziali admin del wizard e prosegui con il [Tour della UI MSSP](/it-it/mssp-ui). Se hai lasciato vuoto l'hostname nel wizard, mappa `soctalk.local` sull'IP della VM nel tuo file hosts e usa `https://soctalk.local/`.

## 8. Smantellamento

```bash
VBoxManage controlvm soctalk-demo poweroff
VBoxManage unregistervm soctalk-demo --delete
VBoxManage closemedium disk soctalk-demo-0.2.0.vdi --delete
```

## Risoluzione dei problemi

| Sintomo | Verifica |
|---|---|
| La VM non si avvia: "cannot open … streamOptimized" / disco di sola lettura | Hai collegato il `.vmdk` grezzo. Usa il `.vdi` convertito nel passo 2 |
| Non si avvia su un Mac Apple Silicon | Previsto, l'immagine è x86-64; usa invece un [lancio cloud](/it-it/aws) |
| La console mostra errori `vmwgfx … unsupported hypervisor` | Innocui, è la GPU emulata di VirtualBox; l'appliance è headless e si avvia correttamente |
| La VM non ha un IP in bridged | Scegli la NIC host corretta in Network → Name; verifica che la tua LAN abbia il DHCP. Oppure usa l'opzione NAT + port-forwarding indicata sopra |
| Impossibile leggere il token (nessun SSH) | L'ISO seed non è collegato (Storage → IDE) o la sua chiave è errata; ricontrolla i passi 3/5 |
| Qualsiasi cosa dopo il wizard | Come su ogni piattaforma, vedi la [tabella di risoluzione dei problemi del Quickstart](/it-it/quickstart-vm#troubleshooting) |
