# Demo-VM auf VMware ESXi ausführen

Importiere die veröffentlichte `soctalk-demo-<ver>.vmdk` in VMware ESXi und boote sie. Diese Anleitung deckt **ESXi 7/8** mit dem integrierten Host Client (der Browser-UI) ab. Wenn du stattdessen Fusion oder Workstation auf einem Laptop betreibst, ist der Ablauf nahezu identisch; importiere dieselbe vmdk über File → Open.

Dieser Weg richtet sich an **Evaluatoren und Demos**, die SocTalk auf ihrem vorhandenen On-Premise-ESXi betreiben. Für eine Produktivinstallation auf deinem eigenen Kubernetes-Cluster siehe [Installation](/de-de/install). Validiert auf ESXi 8.0.3 (Build 24677879) mit Host Client 2.x.

## Voraussetzungen

- ESXi 7.0 oder neuer mit einem vorhandenen Benutzer-Datastore (VMFS). Falls du noch keinen Datastore hast, führt dich der [Abschnitt Neuer Datastore](#optional-create-a-vmfs-datastore) weiter unten durch.
- Root oder ein Benutzer mit der Berechtigung `Virtual machine.Provisioning.Deploy from template`.
- Eine Portgruppe (üblicherweise das automatisch erstellte **VM Network**) mit DHCP + ausgehendem HTTPS.
- ~10 GB frei auf dem Datastore (die vmdk ist ~800 MB streamOptimized, wird aber in eine 60 GB große Thin-VMFS-Disk konvertiert, die bei Bedarf wächst).
- Ein SSH-Schlüsselpaar (`~/.ssh/id_ed25519.pub` in den Beispielen), um das Setup-Token über SSH auszulesen.

::: warning Du benötigst einen echten VMFS-Datastore, nicht das ESXi-OSDATA-Volume
Der ESXi-Installer erstellt ein `OSDATA-*`-Volume auf der Boot-Disk. Es erscheint in `esxcli storage filesystem list` und wird unter `/vmfs/volumes/` eingehängt, ist aber **kein** normaler Benutzer-Datastore, und dort gespeicherte VMs lassen sich nicht einschalten und schlagen mit `msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore` fehl. Füge eine separate Disk oder Partition hinzu und formatiere sie als VMFS, bevor du fortfährst.
:::

## 1. Image herunterladen und verifizieren

Hol dir die **vmdk** von der Seite [Downloads](/de-de/downloads). Auf jedem Linux-/macOS-Host, der `ovftool` hat, oder per SSH-Konsolenzugriff in eine ESXi-VM:

```bash
VER=0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

Du hast jetzt `soctalk-demo-<ver>.vmdk`, eine **streamOptimized** (hosted) VMware-Disk. ESXis VMFS kann sie nicht direkt ausführen; §4 konvertiert sie einmalig mit `vmkfstools`.

## 2. Ein cloud-init-Seed-ISO erstellen

Ein kleines NoCloud-Seed-ISO erzeugt einen `ops`-Benutzer mit deinem SSH-Schlüssel, damit du das Setup-Token pro Boot auslesen kannst. Wenn du es überspringst, kannst du dich trotzdem als der zur Build-Zeit angelegte `ubuntu:packer`-Benutzer anmelden (siehe [SSH-Zugriff](/de-de/quickstart-vm#ssh-access-credentials)), aber diese Zugangsdaten liegen im öffentlichen Quellcode-Baum, härte die VM also ab, bevor du sie exponierst. Unter Linux/macOS:

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
# Linux: genisoimage / cloud-localds   •   macOS: hdiutil or mkisofs (brew install cdrtools)
genisoimage -output soctalk-seed.iso -volid cidata -joliet -rock user-data meta-data
```

## 3. (Optional) Einen VMFS-Datastore erstellen

Überspringe diesen Schritt, wenn dein ESXi bereits einen Benutzer-Datastore (z. B. `datastore1`) mit 10+ GB frei hat.

Melde dich am Host Client an und gehe zu **Storage** → **Datastores**. Eine Installation, der noch keine Daten-Disk zugewiesen wurde, sieht so aus:

![ESXi Host Client, Storage-Tab ohne Datastores](/screenshots/esxi-storage-empty.png)

Klicke auf **New datastore**, um den 5-Schritte-Assistenten zu öffnen.

**Schritt 1, Select creation type.** Wähle **Create new VMFS datastore**. Next.

![Neuer Datastore Schritt 1, Erstellungstyp](/screenshots/esxi-new-datastore-01-type.png)

**Schritt 2, Name and select device.** Gib einen Namen ein (`datastore1` ist üblich) und wähle die zu formatierende Disk. Hier erscheinen nur nicht beanspruchte Disks.

![Neuer Datastore Schritt 2, Name](/screenshots/esxi-new-datastore-02-name.png)
![Neuer Datastore Schritt 3, Geräteauswahl](/screenshots/esxi-new-datastore-03-device.png)

**Schritt 3, Select partitioning options.** Standard: **Use full disk, VMFS 6**. Bestätige und klicke auf Next.

![Neuer Datastore Schritt 4, Partitionierung](/screenshots/esxi-new-datastore-04-partition.png)

**Schritt 4, Ready to complete.** Prüfe die Zusammenfassung und klicke auf **Finish**. ESXi warnt, dass die Disk neu partitioniert wird; bestätige.

![Neuer Datastore Schritt 5, Prüfung](/screenshots/esxi-new-datastore-05-review.png)

**Ergebnis.** Storage → Datastores zeigt nun den neuen VMFS6-Datastore. Recent tasks meldet, dass sowohl **Create Vmfs Datastore** als auch **Rescan Vmfs** erfolgreich abgeschlossen wurden.

![Datastore erstellt](/screenshots/esxi-datastore-created.png)

## 4. Die vmdk hochladen und konvertieren

Die vmdk aus GHCR ist streamOptimized. ESXis VM-Subsystem benötigt eine VMFS-Thin-Disk. Zwei Wege:

::: code-group

```bash [SSH + vmkfstools (recommended)]
# Enable SSH on the ESXi host: Host Client → Actions → Services → Enable SSH
# Copy the vmdk to the datastore (from any host that has scp)
DS=/vmfs/volumes/datastore1
scp soctalk-demo-0.2.0.vmdk root@<esxi-host>:$DS/soctalk-source.vmdk

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
  soctalk-demo-0.2.0.vmdk \
  vi://root:<password>@<esxi-host>
```

:::

Lade außerdem das Seed-ISO über **Storage → Datastore browser → Upload** hoch:

```
[datastore1]/SocTalk-Demo/soctalk-seed.iso
```

## 5. Die VM erstellen

Gehe im Host Client zu **Virtual Machines** und klicke auf **Create / Register VM**, um den 5-Schritte-Assistenten zu öffnen.

![Create / Register VM-Assistent](/screenshots/esxi-create-vm-wizard.png)

Durchlaufe den Assistenten:

- **Select creation type**: **Register an existing virtual machine** (wir haben die vmdk bereits in Schritt 4 platziert).

Falls dein ESXi-Build diese Option ausblendet oder du lieber alles über den Assistenten konfigurierst, wähle stattdessen **Create a new virtual machine** und verwende diese Einstellungen:

- **Select a name and guest OS**: Name `SocTalk-Demo`. Compatibility `ESXi 8.0 virtual machine`. Guest OS family `Linux`. Guest OS version `Ubuntu Linux (64-bit)`.
- **Select storage**: `datastore1`.
- **Customize settings**: setze:
  - **CPU** 4
  - **Memory** 8 GB
  - **Hard disk 1**: klicke auf die Disk-Zeile → **Existing hard disk**, navigiere zu `[datastore1] SocTalk-Demo/SocTalk-Demo.vmdk`
  - **Network adapter 1**: Network `VM Network`, Adapter type `VMXNET3` (VMwares empfohlene paravirtualisierte NIC; verwende sie auf Bare-Metal-ESXi für beste Performance)
  - **CD/DVD drive 1**: Datastore ISO file, navigiere zu `soctalk-seed.iso`: aktiviere **Connect at power on**
  - Belasse USB controller und Floppy auf ihren Standardwerten.
- **Ready to complete**: Finish.

Die VM erscheint in der Virtual-Machines-Liste mit `Register VM`, markiert als erfolgreich abgeschlossen.

![VM auf datastore1 registriert](/screenshots/esxi-vm-registered.png)

## 6. Einschalten und die Konsole öffnen

Wähle **SocTalk-Demo** und klicke auf **Power on**. Der Header wechselt in den grünen Power-on-Status und das Konsolen-Thumbnail beginnt sich zu aktualisieren.

![VM eingeschaltet, Hardware-Bereich sichtbar](/screenshots/esxi-vm-powered-on.png)

Klicke auf **Console** → **Open browser console** (der eigenständige Tab lässt sich leichter befüllen als die Inline-Vorschau).

![Konsolen-Dropdown-Menü](/screenshots/esxi-console-menu.png)

Die Konsole zeigt Ubuntu 24.04, das durch cloud-init bootet und zu einer Login-Aufforderung gelangt:

![VM-Konsole, Ubuntu-Boot bis zum Login](/screenshots/esxi-vm-console-boot.png)

## 7. An der VM anmelden

Du hast zwei Wege hinein, die dir beide eine Shell geben, aus der du dich per `sudo -i` zu Root machen kannst.

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

::: warning Härte die packer-Zugangsdaten ab oder lösche sie, bevor du die VM exponierst
Das `ubuntu:packer`-Login ist in jedes veröffentlichte Image eingebacken und lebt im öffentlichen Quellcode-Baum. Auf jeder VM, die ein isoliertes Labor verlässt: `sudo passwd -l ubuntu` (das Konto sperren) plus `sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null && sudo systemctl reload ssh`. Siehe [SSH-Zugriff + Zugangsdaten](/de-de/quickstart-vm#ssh-access-credentials) für die vollständige Härtungsgeschichte.
:::

## 8. Das Setup-Token auslesen

Von dem Host, der den privaten SSH-Schlüssel aus dem Seed-ISO besitzt:

```bash
# Find the VM's IP: Host Client → SocTalk-Demo → General information → Networking
ssh ops@<vm-ip> sudo cat /run/soctalk/setup-token
```

Kopiere das Token, öffne dann **https://\<vm-ip\>/** in einem Browser und füge es ein, wenn der Assistent danach fragt. Fahre fort ab [Quickstart-VM Schritt 6](/de-de/quickstart-vm#_6-open-the-setup-wizard).

Sobald die Installation abgeschlossen ist, befindest du dich im MSSP-Dashboard:

![SocTalk MSSP-Dashboard auf ESXi](/screenshots/esxi-soctalk-mssp-dashboard.png)

## Fehlerbehebung

Die folgenden Einträge gelten für echte Bare-Metal-ESXi-Hosts, sofern sie nicht mit einem Tag **(nur verschachteltes Labor)** versehen sind. Die getaggten tauchten beim Validieren dieser Anleitung auf verschachteltem ESXi auf (ESXi 8.0.3 als KVM-Gast unter Ubuntu 24.04) und betreffen keine Produktionshardware.

**`msg.vmx.poweron.failed: not on NAS or VMFS version 3 datastore`**: die VM-Dateien liegen unter `/vmfs/volumes/OSDATA-*` statt auf einem echten Benutzer-Datastore. Verschiebe sie: `vmkfstools -i` die vmdk in einen echten VMFS-Datastore (§3 + §4), kopiere die `.vmx` daneben, deregistriere die alte VM (`vim-cmd vmsvc/unregister <id>`) und registriere die neue (`vim-cmd solo/registervm /vmfs/volumes/datastore1/SocTalk-Demo/SocTalk-Demo.vmx SocTalk-Demo`).

**VM bootet, aber die Netzwerkschnittstelle ist DOWN und bekommt nie eine IP**: das packer-Image liefert eine netplan-Konfiguration, die per MAC matched. Wenn ESXi der vNIC eine neue MAC zuweist, schlägt der Match fehl und DHCP läuft nie. Behebe es, indem du `/etc/netplan/50-cloud-init.yaml` so bearbeitest, dass stattdessen per Schnittstellenname gematcht wird:

```yaml
network:
  version: 2
  ethernets:
    all:
      match:
        name: "en*"
      dhcp4: true
```

Dann `netplan apply`.

**`ovftool: error while loading shared libraries: libssl.so.1.1`**: installiere eine kompatible OpenSSL-1.1-Runtime oder verwende stattdessen den Weg über SSH + `vmkfstools`.

**Der Host Client zeigt ein rotes Banner darüber, dass die ESXi Shell / SSH aktiviert ist**: in Evaluierungs-Setups zu erwarten. Es ist eine Härtungserinnerung, kein Fehler. Deaktiviere SSH, wenn du fertig bist, falls der Host exponiert ist.

### Nur verschachteltes Labor

Diese tauchen auf, wenn ESXi selbst als Gast innerhalb eines anderen Hypervisors läuft (KVM, VirtualBox, Fusion, Workstation oder eine „Bare-Metal-Lite"-Cloud-Instanz). Auf echtem Bare-Metal-ESXi wirst du keinen davon sehen; die Standardwerte aus §5 (VMXNET3-NIC, Hardware-Version 20, USB + Floppy aktiviert) funktionieren unverändert.

**Einschalten schlägt fehl mit `E1000PCI: failed to register e1000e device` oder `Vmxnet3 PCI: failed to reserve slot` (nur verschachteltes Labor)**: der äußere Hypervisor emuliert nicht genug PCIe-Topologie, damit ESXi einen Slot für die paravirtualisierte NIC zuweisen kann. Bearbeite `SocTalk-Demo.vmx` und setze `ethernet0.virtualDev = "e1000"` (die klassische emulierte NIC, die weniger benötigt), dann `vim-cmd vmsvc/reload <id>` und schalte erneut ein. Auf echter Hardware behalte VMXNET3.

**vmx stürzt mit Signal 11 / `msg.vmx.poweron.failed` auf Hardware-Version 20 ab (nur verschachteltes Labor)**: manche äußeren Hypervisoren geben die neueren PCIe-/EPT-Funktionen nicht bekannt, die vmx-20 voraussetzt. Bearbeite `SocTalk-Demo.vmx` und gehe zurück auf `virtualHW.version = "15"`, entferne `usb.present = "TRUE"` und `floppy0.present = "TRUE"` (oder setze beide auf `"FALSE"`), dann `vim-cmd vmsvc/reload <id>` und versuche es erneut. Echtes Bare-Metal-ESXi führt vmx-20 problemlos aus.
