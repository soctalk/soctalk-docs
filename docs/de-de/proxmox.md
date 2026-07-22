# Die Demo-VM auf Proxmox VE ausführen

Importieren Sie das veröffentlichte `soctalk-demo-<ver>.qcow2`-Image in Proxmox VE und booten Sie es. qcow2 ist das native Festplattenformat von Proxmox, daher ist dies ein Ein-Befehl-Import, kein Konvertierungsschritt nötig.

Dieser Weg richtet sich an **Evaluatoren und Demos**: für eine Produktivinstallation auf Ihrem eigenen Cluster siehe [Installation](/de-de/install). Validiert auf Proxmox VE 8.4.

## Voraussetzungen

- Ein Proxmox-VE-8.x-Node mit ≥ 4 vCPU / 8 GB RAM / 60 GB freiem Speicher ([Dimensionierung](/de-de/reference/sizing)).
- Ein Speicher, der **Disk image**-Inhalt akzeptiert (das standardmäßige `local-lvm` oder ein Verzeichnisspeicher wie `local` mit aktiviertem *Disk image*).
- Shell-Zugriff auf den Node (der Festplattenimport ist ein einziger `qm`-Befehl; alles Übrige geschieht in der Web-UI).

## 1. Das Image auf den Node herunterladen

Per SSH auf den Proxmox-Node verbinden:

```bash
VER=<ver>   # z. B. 0.2.0
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.qcow2.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.qcow2.xz
```

## 2. Das cloud-init-Seed-ISO erstellen

Ein NoCloud-Seed-ISO legt einen `ops`-Benutzer mit Ihrem SSH-Schlüssel an. Ohne ihn können Sie sich weiterhin als der zur Build-Zeit erstellte `ubuntu:packer`-Benutzer anmelden (siehe [SSH-Zugriff](/de-de/quickstart-vm#ssh-access-credentials)), doch diese Zugangsdaten liegen im öffentlichen Quellcode-Baum; stellen Sie das Seed bereit, bevor Sie die VM einem Netzwerk aussetzen, dem Sie nicht vertrauen. Auf dem Node oder einem beliebigen Linux-Rechner:

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
# (apt install genisoimage, falls es fehlt; cloud-localds aus cloud-image-utils funktioniert ebenfalls)
mv soctalk-seed.iso /var/lib/vz/template/iso/
```

Wenn Sie das ISO anderswo erstellt haben, laden Sie es stattdessen in der UI hoch: Wählen Sie den `local`-Speicher → **ISO Images** → **Upload**.

::: tip
Sie können den Assistenten vollständig überspringen, indem Sie `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` über `write_files` zum Seed hinzufügen, siehe [Optional: cloud-init-Seed](/de-de/quickstart-vm#optional-cloud-init-seed).
:::

## 3. Die VM in der Web-UI erstellen

Klicken Sie auf **Create VM** (oben rechts) und arbeiten Sie den Assistenten durch:

**General**: wählen Sie eine VM-ID und einen Namen:

![Create VM, General](/screenshots/proxmox-create-general.png)

**OS**: wählen Sie **Do not use any media** (das Betriebssystem befindet sich bereits auf der importierten Festplatte):

![Create VM, OS](/screenshots/proxmox-create-os.png)

**System**: behalten Sie die Standardwerte bei (SeaBIOS, i440fx; das Image bootet über BIOS-Firmware).

**Disks**: löschen Sie die Standardfestplatte über das Papierkorb-Symbol neben `scsi0`; das importierte qcow2 ersetzt sie:

![Create VM, Disks](/screenshots/proxmox-create-disks.png)

**CPU**: 4 Kerne, und setzen Sie **Type** auf `host`:

![Create VM, CPU](/screenshots/proxmox-create-cpu.png)

**Memory**: 8192 MiB:

![Create VM, Memory](/screenshots/proxmox-create-memory.png)

**Network**: Ihre LAN-Bridge (typischerweise `vmbr0`), VirtIO-Modell:

![Create VM, Network](/screenshots/proxmox-create-network.png)

**Confirm**: Finish. Starten Sie die VM noch nicht.

## 4. Die Festplatte importieren

Der einzige CLI-Schritt. Auf dem Node (passen Sie die VM-ID und den Zielspeicher an):

```bash
qm disk import 100 soctalk-demo-<ver>.qcow2 local --format qcow2
```

Bei LVM-thin-Speicher (`local-lvm`) lassen Sie das `--format`-Flag weg; Block-Speicher speichern raw. Der Import erscheint an der VM als **Unused Disk 0**.

## 5. Festplatte, Seed-ISO und Boot-Reihenfolge zuweisen

Öffnen Sie zurück in der UI das **Hardware**-Panel der VM:

![Hardware, unused disk](/screenshots/proxmox-hardware-unused.png)

- Doppelklicken Sie auf **Unused Disk 0** → belassen Sie Bus/Device bei `SCSI 0` → **Add**:

![Attach the imported disk](/screenshots/proxmox-attach-disk.png)

- Doppelklicken Sie auf **CD/DVD Drive (ide2)** → *Use CD/DVD disc image file* → Speicher `local`, ISO `soctalk-seed.iso` → **OK**:

![Mount the seed ISO](/screenshots/proxmox-attach-seed.png)

- **Options** → **Boot Order** → setzen Sie `scsi0` an die erste Stelle (oder `qm set 100 --boot order=scsi0`).

Das Hardware-Panel sollte nun so aussehen:

![Hardware, final](/screenshots/proxmox-hardware-final.png)

## 6. Starten und die IP der VM finden

Klicken Sie auf **Start**. Das Summary-Panel zeigt die laufende VM:

![VM running](/screenshots/proxmox-vm-running.png)

Die **Console** zeigt, wie die Appliance bis zur Anmeldeaufforderung bootet:

![Console, booted](/screenshots/proxmox-vm-console.png)

Die VM bezieht ein DHCP-Lease von Ihrer LAN-Bridge. Ermitteln Sie ihre IP über die Konsole (`login: ops` funktioniert nur per SSH-Schlüssel; verwenden Sie die Konsolenausgabe oder Ihren DHCP-Server/Router) oder über den Node:

```bash
# die MAC steht am Network Device (net0) der VM
grep -B2 -A2 "$(qm config 100 | grep -oP 'virtio=\K[^,]+')" /var/lib/misc/dnsmasq.leases 2>/dev/null \
  || arp -an | grep -i "$(qm config 100 | grep -oP 'virtio=\K[^,]+')"
```

## 7. Den Assistenten ausführen und sich anmelden

Ab hier derselbe Ablauf wie auf jeder Plattform:

```bash
ssh ops@<vm-ip> sudo cat /var/log/soctalk-setup-token
```

Rufen Sie `https://<vm-ip>:8443/` auf, akzeptieren Sie das selbstsignierte Zertifikat, fügen Sie das Token ein und füllen Sie den Assistenten aus ([Feldreferenz](/de-de/setup-wizard)). Nach dem Absenden führt der First-Boot-Installer `helm install` aus und onboardet den `demo`-Mandanten, etwa 2 Minuten für die `soctalk-system`-Pods, dann einige weitere für den Wazuh-Stack des Demo-Mandanten.

Rufen Sie anschließend `https://<vm-ip>/` (Port 443, nicht 8443) auf, melden Sie sich mit den Admin-Zugangsdaten aus dem Assistenten an und fahren Sie mit der [MSSP-UI-Tour](/de-de/mssp-ui) fort. Wenn Sie den Hostnamen im Assistenten leer gelassen haben, ordnen Sie `soctalk.local` in `/etc/hosts` der VM-IP zu und verwenden Sie `https://soctalk.local/`.

## Fehlerbehebung

| Symptom | Prüfung |
|---|---|
| `qm disk import` schlägt mit einem Speicherfehler fehl | Der Zielspeicher muss **Disk image**-Inhalt zulassen: Datacenter → Storage → edit → Content |
| VM bootet zu "No bootable device" | Die Boot-Reihenfolge zeigt noch auf die gelöschte Standardfestplatte, Options → Boot Order → `scsi0` an erste Stelle |
| Assistent erscheint, aber kein SSH | Das Seed-ISO ist nicht angehängt (Hardware → ide2) oder der Schlüssel in `user-data` ist falsch; Sie können das Token stattdessen über die Konsole auslesen: `sudo cat /var/log/soctalk-setup-token` |
| VM hat keine IP | `ip a` über die Konsole; prüfen Sie, ob die Bridge unter Hardware → net0 mit einer Bridge übereinstimmt, die DHCP in Ihrem LAN bereitstellt |
| VM hat eine IP, aber keinen Internetzugang (NAT-Bridge-Setups) | PVE setzt `bridge-nf-call-iptables=1`, wodurch gebrückter Verkehr eine auf das Uplink-Interface beschränkte `MASQUERADE`-Regel umgehen kann. `sysctl -w net.bridge.bridge-nf-call-iptables=0` (wenn Sie die PVE-Firewall nicht verwenden) oder nutzen Sie eine interface-unabhängige Regel: `iptables -t nat -A POSTROUTING -s <subnet> ! -d <subnet> -j MASQUERADE`, dann conntrack leeren |
| Alles nach dem Assistenten | Wie auf jeder Plattform, siehe die [Tabelle zur Fehlerbehebung im Quickstart](/de-de/quickstart-vm#troubleshooting) |
