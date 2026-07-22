# Demo-VM auf Azure ausführen

Importiere das veröffentlichte `soctalk-demo-<ver>.vhd`-Image als verwaltete Festplatte in Azure, wandle es in ein VM-Image um und starte es. Azure-VMs laufen auf Hyper-V, daher ist dies auch der schnellste Weg, das Image auf einem Hyper-V-Hypervisor zu validieren, ohne einen Windows-Server-Host aufzusetzen.

Dieser Weg richtet sich an **Evaluatoren und Demos**: für eine Produktionsinstallation auf deinem eigenen Cluster siehe [Installation](/de-de/install).

## Warum das `.vhd` (und warum Generation 1)

- Azure akzeptiert nur **VHD-Festplatten mit fester Größe und 1-MiB-Ausrichtung** (kein VHDX, kein dynamisches VHD). Das veröffentlichte `soctalk-demo-<ver>.vhd` wird von der Release-Pipeline genau so erzeugt (`qemu-img convert -O vpc -o subformat=fixed,force_size`), sodass es unverändert importiert werden kann, kein lokaler Konvertierungsschritt.
- Das Image wird unter BIOS-Firmware gebaut und boot-getestet, was **Generation 1**-VMs in Azure entspricht. Erstelle Festplatte und Image mit `--hyper-v-generation V1`.
- Ein festes 60-GB-VHD klingt sperrig, besteht aber fast vollständig aus Nullen. `azcopy` lädt in ein Page-Blob hoch und **überspringt Null-Seiten**, sodass die tatsächliche Übertragung nur etwa die ~3 GB an echten Daten umfasst.

## Voraussetzungen

- Ein Azure-Abonnement (`az account list` muss eines anzeigen, Verzeichniszugriff auf Mandantenebene reicht nicht aus).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) und [AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10) (`azcopy`). Unter macOS: `brew install azure-cli azcopy`.
- ~61 GB freier lokaler Festplattenspeicher für das dekomprimierte VHD.
- Ein SSH-Schlüsselpaar (`~/.ssh/id_ed25519.pub` in den folgenden Beispielen).

Melde dich an und wähle das Abonnement:

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

## 1. VHD herunterladen und dekomprimieren

```bash
VER=<ver>   # z. B. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vhd.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vhd.xz   # dekomprimiert zu einem 60 GB großen VHD mit fester Größe
```

## 2. Eine Ressourcengruppe erstellen

Alles in dieser Anleitung befindet sich in einer einzigen Ressourcengruppe, sodass der Abbau am Ende ein einziger Befehl ist.

```bash
RG=soctalk-demo
LOC=westus2
az group create -n $RG -l $LOC
```

## 3. Das VHD direkt auf eine verwaltete Festplatte hochladen

Kein Speicherkonto nötig, Azure unterstützt den direkten Upload auf eine verwaltete Festplatte. Erstelle eine leere Festplatte in der exakten Byte-Anzahl der VHD-Datei, hole dir ein kurzlebiges Schreib-SAS, lade mit `azcopy` hoch und widerrufe dann das SAS:

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

Der `azcopy`-Schritt ist der einzige langwierige; durch das Überspringen von Null-Seiten werden nur die echten Daten (~3 GB) übertragen.

## 4. Ein Image aus der Festplatte erstellen

```bash
DISK_ID=$(az disk show -g $RG -n soctalk-demo --query id -o tsv)

az image create -g $RG -n soctalk-demo-image \
  --source $DISK_ID --os-type Linux --hyper-v-generation V1
```

## 5. Eine VM starten

Beschränke die Netzwerksicherheitsgruppe auf deine eigene IP, die Maschine stellt SSH (22), die SocTalk-UI (443) und den Setup-Assistenten (8443) bereit, von denen keiner im Internet offen sein sollte:

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

`Standard_D4s_v3` (4 vCPU / 16 GiB) deckt die [Mindestdimensionierung](/de-de/reference/sizing) von 4 vCPU / 8 GB bequem ab. Alles Kleinere gerät ins Straucheln, sobald der Wazuh-Stack des Demo-Mandanten startet.

::: tip Kein Seed-ISO nötig
Auf Hypervisoren hängst du ein NoCloud-`seed.iso` an, um einen SSH-Schlüssel einzuschleusen ([Schnellstart](/de-de/quickstart-vm#optional-cloud-init-seed)). Auf Azure entfällt dieser Schritt: Das cloud-init des Images erkennt die Azure-Datenquelle und stellt `--admin-username` / `--ssh-key-values` automatisch bereit.
:::

## 6. Setup-Token abrufen und den Assistenten ausführen

Ab hier derselbe Ablauf wie bei jedem anderen Hypervisor. Gib der VM nach dem Booten ~2 Minuten, bis der Assistenten-Dienst hochfährt, dann:

```bash
ssh ops@$IP sudo cat /var/log/soctalk-setup-token
```

Rufe `https://<IP>:8443/` auf, akzeptiere das selbstsignierte Zertifikat, füge den Token ein und fülle den Assistenten aus, MSSP-Name, Admin-Zugangsdaten, LLM-Anbieter + API-Schlüssel. Siehe [Setup-Assistent](/de-de/setup-wizard) für die Feldreferenz.

Nach dem Absenden führt der First-Boot-Installer `helm install` aus und onboardet den `demo`-Mandanten, etwa 2 Minuten für die `soctalk-system`-Pods, dann weitere paar Minuten für den Wazuh-Stack des Demo-Mandanten. Du kannst per SSH zusehen:

```bash
ssh ops@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

## 7. Anmelden

Rufe `https://<IP>/` auf (Port 443, nicht 8443) und melde dich mit den Admin-Zugangsdaten aus dem Assistenten an. Wenn du den Hostnamen im Assistenten leer gelassen hast, ordne `soctalk.local` in `/etc/hosts` der VM-IP zu und verwende `https://soctalk.local/`. Fahre mit der [MSSP-UI-Tour](/de-de/mssp-ui) fort.

## 8. Abbau

Alles wurde innerhalb der Ressourcengruppe erstellt, also:

```bash
az group delete -n $RG --yes --no-wait
```

Damit werden VM, NIC, öffentliche IP, NSG, verwaltete Festplatte und Image in einem Zug entfernt. Es bleibt nichts weiter, das Kosten verursacht.

## Fehlerbehebung

| Symptom | Prüfung |
|---|---|
| `az disk create --for-upload` abgelehnt | `--upload-size-bytes` muss die **exakte** Dateigröße in Bytes des dekomprimierten `.vhd` sein, einschließlich Footer, führe den `stat`-Befehl erneut aus |
| `azcopy` schlägt mit 403 fehl | Das Schreib-SAS ist abgelaufen (24 h im Beispiel) oder wurde bereits widerrufen, führe `az disk grant-access` erneut aus |
| VM erhält den SSH-Schlüssel nie | Stelle sicher, dass Image und Festplatte mit `--hyper-v-generation V1` erstellt wurden; ein V2-Image aus diesem VHD bootet nicht, und ein fehlgeschlagener Boot erreicht cloud-init nie |
| Assistenten-URL lädt nie | NSG-Regel für 8443 fehlt oder deine öffentliche IP hat sich geändert (`curl ifconfig.me` und vergleichen); dann `systemctl status soctalk-setup-wizard` über SSH |
| Alles nach dem Assistenten | Wie bei jeder Plattform, siehe die [Schnellstart-Fehlerbehebungstabelle](/de-de/quickstart-vm#troubleshooting) |
