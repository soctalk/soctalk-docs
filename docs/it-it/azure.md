# Eseguire la VM demo su Azure

Importa l'immagine `soctalk-demo-<ver>.vhd` pubblicata in Azure come disco gestito, trasformala in un'immagine VM e avviala. Le VM di Azure girano su Hyper-V, quindi questo è anche il modo più rapido per convalidare l'immagine su un hypervisor Hyper-V senza dover predisporre un host Windows Server.

Questo percorso è pensato per **valutatori e demo**: per un'installazione di produzione sul tuo cluster consulta [Installazione](/it-it/install).

## Perché il `.vhd` (e perché la Generazione 1)

- Azure accetta solo dischi **VHD a dimensione fissa, allineati a 1 MiB** (non VHDX, non VHD dinamici). Il file `soctalk-demo-<ver>.vhd` pubblicato viene generato dalla pipeline di rilascio esattamente in quel modo (`qemu-img convert -O vpc -o subformat=fixed,force_size`), quindi si importa così com'è, nessun passaggio di conversione locale.
- L'immagine è costruita e testata all'avvio con firmware BIOS, che corrisponde alle VM di **Generazione 1** di Azure. Crea il disco e l'immagine con `--hyper-v-generation V1`.
- Un VHD fisso da 60 GB può sembrare pesante, ma è quasi interamente composto da zeri. `azcopy` carica su un page blob e **salta le pagine di zeri**, quindi il trasferimento effettivo corrisponde all'incirca ai ~3 GB di dati reali.

## Prerequisiti

- Una sottoscrizione Azure (`az account list` deve mostrarne una, l'accesso alla directory a livello di tenant non è sufficiente).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) e [AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10) (`azcopy`). Su macOS: `brew install azure-cli azcopy`.
- ~61 GB di spazio libero su disco locale per il VHD decompresso.
- Una coppia di chiavi SSH (`~/.ssh/id_ed25519.pub` negli esempi seguenti).

Accedi e seleziona la sottoscrizione:

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

## 1. Scarica e decomprimi il VHD

```bash
VER=<ver>   # es. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vhd.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vhd.xz   # decomprime in un VHD fisso da 60 GB
```

## 2. Crea un gruppo di risorse

Tutto ciò che riguarda questa guida risiede in un unico gruppo di risorse, così lo smantellamento è un singolo comando alla fine.

```bash
RG=soctalk-demo
LOC=westus2
az group create -n $RG -l $LOC
```

## 3. Carica il VHD direttamente su un disco gestito

Non serve alcun account di archiviazione, Azure supporta il caricamento diretto su un disco gestito. Crea un disco vuoto dimensionato esattamente al numero di byte del file VHD, ottieni un SAS di scrittura a breve durata, carica con `azcopy`, poi revoca il SAS:

```bash
VHD=soctalk-demo-$VER.vhd
SIZE=$(stat -f %z "$VHD" 2>/dev/null || stat -c %s "$VHD")   # macOS || Linux

az disk create -g $RG -n soctalk-demo \
  --for-upload --upload-size-bytes $SIZE \
  --sku standard_lrs --os-type Linux --hyper-v-generation V1

SAS=$(az disk grant-access -g $RG -n soctalk-demo \
  --access-level Write --duration-in-seconds 86400 \
  --query accessSAS -o tsv)

azcopy copy "$VHD" "$SAS" --blob-type PageBlob

az disk revoke-access -g $RG -n soctalk-demo
```

Il passaggio con `azcopy` è l'unico lungo; grazie al salto delle pagine di zeri sposta solo i dati reali (~3 GB).

## 4. Crea un'immagine dal disco

```bash
DISK_ID=$(az disk show -g $RG -n soctalk-demo --query id -o tsv)

az image create -g $RG -n soctalk-demo-image \
  --source $DISK_ID --os-type Linux --hyper-v-generation V1
```

## 5. Avvia una VM

Limita il gruppo di sicurezza di rete al tuo IP, la macchina espone SSH (22), la UI di SocTalk (443) e la procedura guidata di configurazione (8443), nessuna delle quali dovrebbe essere aperta a internet:

```bash
MYIP=$(curl -s https://ifconfig.me)

az network nsg create -g $RG -n soctalk-nsg
i=100
for port in 22 443 8443; do
  az network nsg rule create -g $RG --nsg-name soctalk-nsg \
    -n allow-$port --priority $i --access Allow --protocol Tcp \
    --direction Inbound --source-address-prefixes $MYIP/32 \
    --destination-port-ranges $port
  i=$((i+10))
done

az vm create -g $RG -n soctalk-demo-vm \
  --image soctalk-demo-image \
  --size Standard_D4s_v3 \
  --admin-username ops \
  --ssh-key-values ~/.ssh/id_ed25519.pub \
  --nsg soctalk-nsg \
  --public-ip-sku Standard

IP=$(az vm show -g $RG -n soctalk-demo-vm -d --query publicIps -o tsv)
echo "VM is at $IP"
```

`Standard_D4s_v3` (4 vCPU / 16 GiB) copre comodamente il [dimensionamento minimo](/it-it/reference/sizing) di 4 vCPU / 8 GB. Qualsiasi taglia inferiore farà fatica una volta avviato lo stack Wazuh del tenant demo.

::: tip Nessuna ISO di seed necessaria
Sugli hypervisor colleghi una `seed.iso` NoCloud per iniettare una chiave SSH ([Quickstart](/it-it/quickstart-vm#optional-cloud-init-seed)). Su Azure quel passaggio scompare: il cloud-init dell'immagine rileva il datasource di Azure e provisiona automaticamente `--admin-username` / `--ssh-key-values`.
:::

## 6. Ottieni il token di configurazione ed esegui la procedura guidata

Da qui in poi il flusso è lo stesso di qualsiasi altro hypervisor. Concedi alla VM ~2 minuti dopo l'avvio affinché il servizio della procedura guidata si avvii, poi:

```bash
ssh ops@$IP sudo cat /var/log/soctalk-setup-token
```

Vai su `https://<IP>:8443/`, accetta il certificato autofirmato, incolla il token e compila la procedura guidata, nome MSSP, credenziali admin, provider LLM + chiave API. Consulta [Procedura guidata di configurazione](/it-it/setup-wizard) per il riferimento dei campi.

Dopo l'invio, l'installer del primo avvio esegue `helm install` e onboarda il tenant `demo`: circa 2 minuti per i pod `soctalk-system`, poi qualche altro minuto per lo stack Wazuh del tenant demo. Puoi seguire l'avanzamento da SSH:

```bash
ssh ops@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

## 7. Accedi

Vai su `https://<IP>/` (porta 443, non 8443) e accedi con le credenziali admin della procedura guidata. Se hai lasciato vuoto l'hostname nella procedura guidata, mappa `soctalk.local` all'IP della VM in `/etc/hosts` e usa `https://soctalk.local/`. Prosegui con il [Tour della UI MSSP](/it-it/mssp-ui).

## 8. Smantellamento

Tutto è stato creato all'interno del gruppo di risorse, quindi:

```bash
az group delete -n $RG --yes --no-wait
```

Questo rimuove in un colpo solo la VM, la NIC, l'IP pubblico, l'NSG, il disco gestito e l'immagine. Non rimane nient'altro a generare costi.

## Risoluzione dei problemi

| Sintomo | Verifica |
|---|---|
| `az disk create --for-upload` rifiutato | `--upload-size-bytes` deve essere la dimensione **esatta** del file in byte del `.vhd` decompresso, footer incluso, riesegui il comando `stat` |
| `azcopy` fallisce con 403 | Il SAS di scrittura è scaduto (24 h nell'esempio) o è già stato revocato, riesegui `az disk grant-access` |
| La VM non riceve mai la chiave SSH | Verifica che l'immagine e il disco siano stati creati con `--hyper-v-generation V1`; un'immagine V2 da questo VHD non si avvia, e un avvio fallito non raggiunge mai cloud-init |
| L'URL della procedura guidata non si carica mai | Regola NSG per la 8443 mancante o il tuo IP pubblico è cambiato (`curl ifconfig.me` e confronta); poi `systemctl status soctalk-setup-wizard` via SSH |
| Qualsiasi problema oltre la procedura guidata | Come su ogni piattaforma, consulta la [tabella di risoluzione dei problemi del Quickstart](/it-it/quickstart-vm#troubleshooting) |
