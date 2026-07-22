# Schnellstart: SocTalk-Demo-VM

Der schnellste Weg, SocTalk end-to-end auszuprobieren: Ein vorgefertigtes VM-Image herunterladen, booten, den Einrichtungsassistenten im Browser öffnen und durchklicken. Fünf Minuten bis zu einer laufenden mandantenfähigen Installation mit einem onboardeten Demo-Mandanten.

Dieser Weg richtet sich an **Evaluierende und Demos**: für eine Produktivinstallation auf Ihrem eigenen Cluster siehe [Installation](/de-de/install).

## Was im Image enthalten ist

- Ubuntu 24.04 LTS, cloud-init aktiviert
- K3s mit gebündeltem Traefik-Ingress
- Helm + ein vorab geladenes `soctalk-system`-Chart
- Ein First-Boot-Einrichtungsassistent auf `:8443`
- Ein First-Boot-Installer (`soctalk-firstboot.service`), der ausgeführt wird, nachdem der Assistent die Konfiguration erfasst hat
- Das Image ist unabhängig vom Format identisch (qcow2 / vmdk / vhdx / vhd / raw); wählen Sie das Format, das Ihr Hypervisor nativ verarbeitet. Siehe [Downloads](/de-de/downloads).

## 1. Herunterladen

Wählen Sie auf der Seite [Downloads](/de-de/downloads) das Format für Ihren Hypervisor. Beispiele:

```bash
# KVM / Proxmox / libvirt
curl -L -o soctalk-demo.qcow2.xz \
  https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-<ver>.qcow2.xz
xz -d soctalk-demo.qcow2.xz
```

Überprüfen Sie die Prüfsumme:

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 2. Image booten

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

`qm disk import <vmid> soctalk-demo.qcow2 <storage>`, dann als SCSI anhängen und booten. Vollständige Anleitung mit Web-UI-Screenshots: [Auf Proxmox betreiben](/de-de/proxmox).

### VMware

Importieren Sie `soctalk-demo.vmdk` als vorhandene Festplatte auf einer neuen VM (Linux, Ubuntu 64-bit).

### VirtualBox

Konvertieren Sie `soctalk-demo.vmdk` nach VDI und hängen Sie es an eine neue VM an. Vollständige Anleitung mit Screenshots: [Auf VirtualBox betreiben](/de-de/virtualbox).

### Hyper-V

Verwenden Sie `soctalk-demo.vhdx` als Betriebssystemfestplatte auf einer VM der **Generation 1** (das Image bootet über BIOS-Firmware; Generation 2 / UEFI ist ungetestet). Um einen SSH-Schlüssel einzuschleusen, hängen Sie eine NoCloud-`seed.iso` als DVD-Laufwerk an, siehe [Optional: cloud-init-Seed](#optional-cloud-init-seed).

### AWS

Erstellen Sie eine native AMI mit Packer oder importieren Sie `soctalk-demo.vmdk` mit VM Import als AMI. Vollständige Anleitung: [Auf AWS betreiben](/de-de/aws).

### Azure

Laden Sie `soctalk-demo.vhd` (feste Größe) direkt auf eine Managed Disk hoch und erstellen Sie daraus ein Image und eine VM der Generation 1. Vollständige Anleitung: [Auf Azure betreiben](/de-de/azure).

### Raw / dd

`soctalk-demo.raw` ist ein Bit-für-Bit-Abbild dessen, was auf der Festplatte liegt. Geeignet für generischen Cloud-Image-Import (GCP, OpenStack) oder zum Schreiben auf eine physische Festplatte mit `dd`.

**Mindestdimensionierung**: 4 vCPU, 8 GB RAM, 60 GB Festplatte. Siehe [Dimensionierung](/de-de/reference/sizing).

## 3. Setup-Token abrufen

Der Assistent bindet `:8443` mit TLS (selbstsigniert). Er weist Verbindungen ohne das pro Boot generierte Setup-Token ab. Verbinden Sie sich per SSH mit der Maschine und lesen Sie es aus:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

Der empfohlene Login ist der **`ops`-Benutzer mit Ihrem SSH-Schlüssel**, der durch den cloud-init-Seed in [§ Optional: cloud-init-Seed](#optional-cloud-init-seed) weiter unten erstellt wird. Wenn Sie ohne Seed booten, siehe [§ SSH-Zugang + Anmeldedaten](#ssh-access-credentials) für den Build-Time-Fallback, und lesen Sie den dortigen Sicherheitshinweis, bevor Sie die VM einem Netzwerk aussetzen, dem Sie nicht vertrauen.

## 4. Assistenten öffnen

Rufen Sie `https://<vm-ip>:8443/` auf. Akzeptieren Sie das selbstsignierte Zertifikat. Sie landen auf der Seite zur Token-Eingabe:

![Einrichtungsassistent, Token-Eingabe](/screenshots/setup-wizard-token.png)

Fügen Sie das Token ein und füllen Sie dann aus:

- MSSP- / Organisationsname
- Hostname (optional, leer lassen, um die IP der Maschine zu verwenden)
- Admin-E-Mail + Passwort (mind. 12 Zeichen)
- LLM-Anbieter + API-Schlüssel

Siehe [Einrichtungsassistent](/de-de/setup-wizard) für die vollständige Feldreferenz.

Absenden. Der Assistent schreibt `values.yaml`, das LLM-Secret und eine Onboarding-Env-Datei und beendet sich dann. Der First-Boot-Installer übernimmt:

1. Startet k3s
2. Erstellt den Namespace `soctalk-system` + LLM-Secret
3. `helm install soctalk-system`
4. Meldet sich als Bootstrap-Admin an und onboardet einen `demo`-Mandanten über `POST /api/mssp/tenants/onboard`

Gesamte Wanduhrzeit ab dem Absenden: etwa 2 Minuten, bis die `soctalk-system`-Pods Ready sind, dann weitere 1–3 Minuten, bis der Wazuh-Stack des Demo-Mandanten den Zustand Ready erreicht.

## 5. Anmelden

Rufen Sie `https://<vm-ip>/` auf (Hinweis: Port 443, nicht 8443, der Assistent bindet gezielt 8443, um Konflikte mit Traefik zu vermeiden). Das MSSP-Dashboard erwartet einen DNS-Namen; wenn Sie einen leeren Hostnamen verwendet haben, fügen Sie einen `/etc/hosts`-Eintrag hinzu, der `soctalk.local` auf die VM-IP verweist, und rufen Sie `https://soctalk.local/` auf.

Melden Sie sich mit der Admin-E-Mail + dem Passwort an, die Sie im Assistenten festgelegt haben. Sie landen auf dem MSSP-Dashboard. Fahren Sie mit der [MSSP-UI-Tour](/de-de/mssp-ui) fort.

## Optional: cloud-init-Seed

Wenn Sie einen SSH-Schlüssel einschleusen möchten (oder den Assistenten ganz überspringen wollen, indem Sie values.yaml direkt bereitstellen), übergeben Sie cloud-init-User-Data über NoCloud:

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

# seed.iso beim ersten Boot als zweites Laufwerk anhängen.
```

Um den Assistenten zu überspringen, legen Sie `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` über cloud-init `write_files` ab; die systemd-Bedingung des Assistenten (`ConditionPathExists=!/etc/soctalk/values.yaml`) greift dann als Kurzschluss und der Installer geht direkt zu `helm install` über.

## SSH-Zugang + Anmeldedaten

Die herunterladbaren Festplatten-Images (qcow2 / vmdk / vhdx / vhd / raw) werden alle mit **zwei** möglichen Login-Identitäten ausgeliefert. Welche Sie verwenden, hängt davon ab, ob Sie cloud-init-User-Data bereitgestellt haben.

### Produktion: `ops`-Benutzer (empfohlen)

Der cloud-init-Seed in [§ Optional: cloud-init-Seed](#optional-cloud-init-seed) erstellt einen `ops`-Benutzer mit Ihrem SSH-Schlüssel. Nur SSH-Schlüssel-Authentifizierung, es ist kein Passwort gesetzt.

```bash
ssh -i ~/.ssh/<your-private-key> ops@<vm-ip>

# Root-Shell, kein weiteres Passwort
sudo -i
```

### Build-Time-Benutzer `ubuntu` (in jedem ausgelieferten Image vorhanden)

Der Packer-Build verwendet einen Build-Time-Benutzer `ubuntu` mit einem bekannten Passwort. Der Bereinigungsschritt, der dieses Konto sperren sollte, ist noch nicht eingebunden, daher wird es im Image mitgeliefert. Wenn Sie ohne cloud-init-Seed booten, ist es die einzige Möglichkeit, per SSH Konsolenzugang zu erhalten:

| Benutzer | Passwort | Sudo |
|---|---|---|
| `ubuntu` | `packer` | `ALL=(ALL) NOPASSWD:ALL` |

Passwort-SSH-Authentifizierung wird durch denselben Seed aktiviert, sodass das Image Folgendes akzeptiert:

```bash
# Interaktiv
ssh ubuntu@<vm-ip>
# password: packer

# Nicht-interaktiv (erfordert sshpass)
sshpass -p packer ssh -o StrictHostKeyChecking=accept-new ubuntu@<vm-ip>

# Root-Shell, kein weiteres Passwort
sudo -i
```

### Härtungs-Checkliste

Als `ops` nach dem ersten Boot ausführen oder in Ihr cloud-init `runcmd:` einbetten, damit sie automatisch ausgelöst wird:

```bash
# Build-Benutzer deaktivieren
sudo passwd -l ubuntu
sudo usermod -s /usr/sbin/nologin ubuntu

# Passwort-SSH-Authentifizierung deaktivieren
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
  /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>/dev/null
sudo systemctl reload ssh
```

Die AWS-AMI wird aus einer separaten Packer-Quelle (`amazon-ebs`) erstellt, die den Seed nicht enthält und stattdessen die Keypair-Injektion von EC2 verwendet, sie trägt die Anmeldedaten `ubuntu:packer` nicht. Die Härtungs-Checkliste gilt dennoch für sie, für den Standard-AMI-`ubuntu`-Cloud-Image-Benutzer.

## Nächster Schritt: Kunden mit Launchpad onboarden

Sie haben SocTalk gerade end-to-end auf einer einzelnen kolokierten Maschine ausgeführt. Der natürliche nächste Schritt ist ein echter Pilot, eine MSSP-Control-Plane plus eine oder mehrere Mandanten-Umgebungen auf Ihrer eigenen Infrastruktur. [**Launchpad**](/de-de/launchpad) macht genau das mit einem einzigen Befehl: Es bootet die VMs, verbindet sie mit Ihrem Tailnet, installiert SocTalk aus öffentlichen Quellen und übergibt Ihnen eine URL. (Möchten Sie lieber jeden Schritt von Hand ausführen? Siehe [MSSP-Pilot in Eigenregie](/de-de/mssp-pilot).)

## Fehlerbehebung

| Symptom | Prüfung |
|---|---|
| Assistenten-URL lädt nie | `systemctl status soctalk-setup-wizard` auf der VM. Bei `inactive` schauen Sie in `journalctl -u soctalk-setup-wizard` |
| Assistent meldet "invalid token" | Das Token steht in `/var/log/soctalk-setup-token`, **im Besitz von root**. Verwenden Sie `sudo cat`. Jeder Boot generiert das Token neu |
| Assistent meldet "rate-limited" | Der Assistent sperrt die IP nach 10 fehlgeschlagenen Token-Versuchen. Warten Sie 1 h oder `systemctl restart soctalk-setup-wizard` (dies rotiert auch das Token) |
| `helm install` hängt | `kubectl get pods -A` von der Maschine aus; `journalctl -u soctalk-firstboot -f` |
| Adapter- / runs-worker-Pods des Demo-Mandanten hängen in ImagePullBackOff | Bekannt: Der Controller verwendet standardmäßig ein unveröffentlichtes Image-Tag. Siehe [Fehlerbehebung](/de-de/troubleshooting) |

Für einen sauberen Reset: Löschen Sie `/var/lib/soctalk-firstboot.done`, `/var/lib/soctalk-wizard.done`, `/etc/soctalk/values.yaml`, dann `systemctl restart soctalk-setup-wizard`.
