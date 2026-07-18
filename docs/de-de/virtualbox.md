# Demo-VM auf VirtualBox ausführen

VirtualBox ist die einfachste plattformübergreifende Möglichkeit, SocTalk auf einem Desktop auszuprobieren — kostenlos, GUI-gesteuert und verfügbar unter Windows, Linux und Intel-macOS. Diese Anleitung importiert das veröffentlichte Demo-Image und startet es. Validiert mit VirtualBox 7.0.

Dieser Weg ist für **Evaluierende und Demos** gedacht — für eine produktive Installation auf deinem eigenen Cluster siehe [Installation](/de-de/install).

::: warning Apple-Silicon-Macs (M-Serie)
Das Demo-Image ist **x86-64**, was VirtualBox auf Apple Silicon nicht ausführen kann. Nutze auf einem Mac der M-Serie einen [Cloud-Start](/de-de/aws) oder einen anderen Host. VirtualBox bedeutet hier Windows, Linux oder einen **Intel**-Mac.
:::

## Voraussetzungen

- [VirtualBox](https://www.virtualbox.org/) 7.0 oder neuer.
- ~3 GB freier Speicherplatz für das konvertierte Image.
- Ein SSH-Schlüsselpaar (`~/.ssh/id_ed25519.pub` in den Beispielen), um das Setup-Token über SSH zu lesen.

## 1. Image herunterladen und dekomprimieren

Hol dir die **vmdk** von der Seite [Downloads](/de-de/downloads) (VirtualBox' VMware-kompatibles Format):

```bash
VER=0.1.4
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/soctalk-demo-$VER.vmdk.xz
curl -L -O https://github.com/soctalk/soctalk/releases/download/v$VER/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing   # macOS: shasum -a 256 -c
xz -d soctalk-demo-$VER.vmdk.xz
```

## 2. Die vmdk in VirtualBox' natives VDI konvertieren

Die veröffentlichte vmdk ist **streamOptimized** (ein schreibgeschütztes VMware/OVA-Layout), das VirtualBox nicht als beschreibbare Festplatte bootet. Konvertiere sie einmalig in ein VDI:

```bash
VBoxManage clonemedium disk soctalk-demo-0.1.4.vmdk soctalk-demo-0.1.4.vdi --format VDI
```

Dies erzeugt ein beschreibbares, dynamisch dimensioniertes `soctalk-demo-0.1.4.vdi` (einige GB auf der Festplatte). `VBoxManage` wird mit VirtualBox ausgeliefert — unter Windows liegt es in `C:\Program Files\Oracle\VirtualBox\`.

## 3. Eine cloud-init-Seed-ISO erstellen

Eine kleine NoCloud-Seed-ISO erstellt einen `ops`-Benutzer mit deinem SSH-Schlüssel, damit du das Setup-Token je Boot lesen kannst. Wenn du sie überspringst, kannst du dich weiterhin als der zur Build-Zeit angelegte Benutzer `ubuntu:packer` anmelden (siehe [SSH-Zugang](/de-de/quickstart-vm#ssh-access-credentials)) — dieser Zugangsdatensatz liegt jedoch im öffentlichen Quellbaum, härte die VM also ab, bevor du sie exponierst. Unter Linux/macOS:

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

## 4. Die VM erstellen

Öffne **VirtualBox** und klicke auf **New**.

![VirtualBox Manager](/screenshots/virtualbox-manager.png)

**Name and Operating System** — nenne sie `soctalk-demo`, setze **Type** auf *Linux* und **Version** auf *Ubuntu (64-bit)*. Lass die ISO leer:

![Name and OS](/screenshots/virtualbox-create-name.png)

**Hardware** — gib ihr **8192 MB** Arbeitsspeicher und **4 CPUs** (das [Sizing](/de-de/reference/sizing)-Minimum ist 4 vCPU / 8 GB; der Wazuh-Stack benötigt den RAM):

![Hardware](/screenshots/virtualbox-create-hardware.png)

**Virtual Hard disk** — wähle **Use an Existing Virtual Hard Disk File** und selektiere die von dir konvertierte `soctalk-demo-0.1.4.vdi`:

![Use existing disk](/screenshots/virtualbox-create-disk.png)

**Summary** — bestätige die Einstellungen und klicke auf **Finish**:

![Summary](/screenshots/virtualbox-create-summary.png)

Die VM erscheint im Manager mit dem VDI an ihrem SATA-Controller:

![VM created](/screenshots/virtualbox-vm-details.png)

## 5. Die Seed-ISO anhängen und das Netzwerk konfigurieren

Wähle die VM aus und klicke auf **Settings**.

**Storage** — klicke unter dem IDE-Controller auf das optische Laufwerk und wähle deine `soctalk-seed.iso` (klicke auf das Disc-Symbol → *Choose a disk file*). Das VDI liegt bereits auf SATA:

![Storage](/screenshots/virtualbox-storage.png)

**Network** — setze **Adapter 1 → Attached to: Bridged Adapter**, damit die VM eine IP in deinem LAN erhält und du den Assistenten direkt erreichen kannst:

![Network — bridged](/screenshots/virtualbox-network.png)

Klicke auf **OK**.

::: tip NAT statt Bridged
Wenn du Bridged nicht nutzen kannst (z. B. in einem eingeschränkten Netzwerk), belasse die Standardeinstellung NAT und füge unter Network → Advanced **Port Forwarding**-Regeln hinzu (Host `8443` → Gast `8443` für den Assistenten, Host `8080` → Gast `443` für die UI), und verwende dann unten `localhost` anstelle der IP der VM.
:::

## 6. Starten und die IP der VM ermitteln

Klicke auf **Start**. Die Konsole bootet bis zu einer Login-Eingabeaufforderung:

![Console](/screenshots/virtualbox-console.png)

Ermittle die Bridged-IP der VM — aus den DHCP-Leases deines Routers oder durch Abgleich der MAC der VM:

```bash
VBoxManage showvminfo soctalk-demo | grep "MAC"      # note the MAC
arp -an | grep -i <mac>                               # find the matching IP
```

## 7. Den Assistenten ausführen und anmelden

Lies das Setup-Token je Boot über SSH und steuere dann den Assistenten:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Rufe `https://<vm-ip>:8443/` auf, akzeptiere das selbstsignierte Zertifikat, füge das Token ein und fülle den Assistenten aus ([Feldreferenz](/de-de/setup-wizard)). Nach dem Absenden führt der First-Boot-Installer `helm install` aus und onboardet den Mandanten `demo` — etwa 2 Minuten für die `soctalk-system`-Pods, dann einige weitere für den Wazuh-Stack des Demo-Mandanten:

```bash
ssh ops@<vm-ip>
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

Rufe anschließend `https://<vm-ip>/` auf (Port 443, nicht 8443), melde dich mit den Admin-Zugangsdaten aus dem Assistenten an und fahre mit der [MSSP-UI-Tour](/de-de/mssp-ui) fort. Wenn du den Hostnamen im Assistenten leer gelassen hast, ordne `soctalk.local` in deiner Hosts-Datei der VM-IP zu und verwende `https://soctalk.local/`.

## 8. Abbauen

```bash
VBoxManage controlvm soctalk-demo poweroff
VBoxManage unregistervm soctalk-demo --delete
VBoxManage closemedium disk soctalk-demo-0.1.4.vdi --delete
```

## Fehlerbehebung

| Symptom | Prüfung |
|---|---|
| VM startet nicht: "cannot open … streamOptimized" / Festplatte schreibgeschützt | Du hast die rohe `.vmdk` angehängt. Verwende die konvertierte `.vdi` aus Schritt 2 |
| Läuft nicht auf einem Apple-Silicon-Mac | Erwartet — das Image ist x86-64; nutze stattdessen einen [Cloud-Start](/de-de/aws) |
| Konsole zeigt `vmwgfx … unsupported hypervisor`-Fehler | Harmlos — VirtualBox' emulierte GPU; die Appliance ist headless und bootet problemlos |
| VM hat keine IP bei Bridged | Wähle unter Network → Name die richtige Host-NIC; stelle sicher, dass dein LAN DHCP hat. Oder nutze die oben beschriebene NAT- + Port-Forwarding-Option |
| Token lässt sich nicht lesen (kein SSH) | Die Seed-ISO ist nicht angehängt (Storage → IDE) oder ihr Schlüssel ist falsch; überprüfe Schritt 3/5 erneut |
| Alles nach dem Assistenten | Wie bei jeder Plattform — siehe die [Quickstart-Fehlerbehebungstabelle](/de-de/quickstart-vm#troubleshooting) |
