# Installation aus einem OS-Paket (rpm / deb)

Jedes SocTalk-Release liefert native OS-Pakete zusätzlich zu den VM-Images, angehängt
an dasselbe GitHub-Release wie der Versions-Tag, für die beiden systemd-basierten Linux-Familien:

| File | Package manager | Verified on | Also expected to work |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Beide sind Ende zu Ende verifiziert: Paket installieren, `soctalk install` ausführen, die
Web-App erreichen und sich anmelden. Die Spalte "Also expected" bezeichnet dieselbe Paketfamilie,
wurde aber auf diesen Distributionen nicht spezifisch getestet.

**Alpine wird nicht unterstützt** und es wird kein `.apk` veröffentlicht: `soctalk install`
benötigt systemd, und Alpine verwendet OpenRC. Siehe [Alpine und andere Hosts ohne
systemd](#alpine-and-other-non-systemd-hosts) weiter unten. **openSUSE / zypper** und
**RHEL 10** sind ungetestet; die RHEL/Fedora-Hinweise treffen möglicherweise nicht vollständig zu. **Nur amd64**:
es gibt kein arm64-Paket.

Sie werden auf der Releases-Seite von [`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases)
veröffentlicht. Die aktuelle Version ist **v0.2.0**:
[Release-Seite](https://github.com/soctalk/soctalk/releases/tag/v0.2.0). Das
Repository ist öffentlich, daher ist zum Herunterladen keine Authentifizierung erforderlich.

## Was das Paket installiert

Das Paket ist bewusst klein gehalten. SocTalk läuft auf Kubernetes (K3s), daher enthält das
Paket nicht den SOC-Stack selbst. Es installiert eine schlanke Management-CLI
und den Installer, danach führen Sie einen Befehl aus, um den Stack hochzufahren:

- `/usr/bin/soctalk`, die Management-CLI (`install`, `upgrade`, `status`,
  `logs`, `uninstall`, `version`).
- `/usr/libexec/soctalk/install.sh`, derselbe Installer, den die [Demo-VM](/de-de/quickstart-vm)
  und die [Ein-Befehl-Installation](/de-de/install) verwenden. Er bootstrappt K3s und Helm, falls
  sie fehlen, und Helm-installiert dann das `soctalk-system`-Chart aus GHCR.
- `/etc/soctalk/soctalk.env.example`, eine Vorlage für unbeaufsichtigte Installationen.

Die einzigen Abhängigkeiten sind `curl` und `tar`; der Installer holt K3s und Helm
selbst. Dies ist der richtige Weg, wenn Sie auf einem Linux-Host installieren, den Sie
direkt verwalten, und SocTalk in der System-Paketdatenbank registriert haben möchten (damit
`dnf`/`apt` es verfolgen und aktualisieren). Wenn Sie SocTalk nur ausprobieren möchten, ist das
[Demo-VM-Image](/de-de/quickstart-vm) schneller.

## Das Paket installieren

Wählen Sie den Block für Ihre Distribution. Ersetzen Sie `0.2.0` durch die aktuelle Version,
wenn Sie auf einem neueren Release sind.

### RHEL, Fedora, AlmaLinux, Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

`dnf` zieht `curl` und `tar` nach, falls sie fehlen. Auf älteren Hosts verwenden Sie
`sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`.

### Debian, Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` löst die `curl`- und `tar`-Abhängigkeiten aus Ihren
konfigurierten Repositories auf. Auf einem minimalen Image ohne `apt` können Sie
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install` verwenden.

## Den Download verifizieren

Jedes Release enthält `SHA256SUMS.txt`, das alle Artefakte abdeckt, einschließlich der
Pakete.

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` prüft nur die Dateien, die Sie tatsächlich heruntergeladen haben. Jede Zeile
sollte `OK` melden.

## Den SOC-Stack hochfahren

Die Installation des Pakets startet SocTalk nicht. Nachdem das Paket installiert ist,
führen Sie den Installer über die CLI aus. Dies installiert K3s und Helm bei Bedarf, und
Helm-installiert dann `soctalk-system` auf diesem Host.

Interaktiv (fragt nach MSSP-Name, Admin und LLM-Anbieter):

```bash
sudo soctalk install
```

Wegwerf-Demo (zufälliges Admin-Passwort, onboardet automatisch einen Demo-Mandanten):

```bash
sudo soctalk install --demo
```

`--demo` pausiert dennoch einmal für eine Zustimmungsabfrage. Für einen vollständig unbeaufsichtigten Lauf (kein
angeschlossenes Terminal, zum Beispiel aus einem Provisionierungsskript) fügen Sie `--yes` hinzu:
`sudo soctalk install --demo --yes`.

Unbeaufsichtigt, gesteuert durch Umgebungsvariablen (kopieren Sie die mitgelieferte Vorlage):

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

Wenn `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL` und `SOCTALK_ADMIN_PASSWORD`
alle gesetzt sind, überspringt der Installer seine Zustimmungsabfrage, sodass dies ohne jegliche
Interaktion läuft. Jedes Argument nach `install` wird an den Installer durchgereicht, zum
Beispiel `soctalk install --chart-version 0.2.0`, um ein Chart zu pinnen, oder
`soctalk install --values-file /etc/soctalk/values.yaml` für eine Air-Gap-Installation.
Siehe [Produktionsinstallation](/de-de/install) für die vollständige Flag-Referenz und den
Cilium-basierten Cluster-Pfad.

## Die Installation verwalten

Die CLI kapselt die üblichen Cluster-Operationen, sodass Sie sich weder den
`KUBECONFIG`-Pfad noch den Helm-Release-Namen merken müssen.

```bash
soctalk status              # pods and their readiness in the soctalk namespace
soctalk logs api            # tail a component's logs (api, orchestrator, adapter, app-ui)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk upgrade` ist ein `helm upgrade --install`, daher ist es gefahrlos erneut ausführbar und
der Weg, um auf ein neueres Chart zu wechseln, nachdem Sie ein neueres Paket installiert haben.

## Deinstallation

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

Das Entfernen des OS-Pakets (`dnf remove soctalk` oder `apt remove soctalk`) löscht
die CLI und den Installer, berührt aber keinen laufenden Cluster. Führen Sie zuerst
`soctalk uninstall` aus, wenn Sie den SOC-Stack entfernen möchten.

## OS-spezifische Hinweise

### RHEL, Fedora, AlmaLinux, Rocky

Verifiziert auf Rocky Linux 9 mit SELinux im Modus **Enforcing**. Es ist keine manuelle SELinux-Arbeit
erforderlich, um lauffähig zu sein: Der K3s-Installer zieht die Policy-Pakete `k3s-selinux` und
`container-selinux` während `soctalk install` automatisch nach, sodass
der Cluster unter Enforcing hochkommt. Beachten Sie, dass dies "läuft korrekt unter der
targeted Policy" bedeutet, nicht dass SELinux die Workload als Härtungsschicht einschränkt;
das Aktivieren von K3s' eigener SELinux-Durchsetzung (`--selinux` / `K3S_SELINUX=true`)
wurde hier nicht getestet. RHEL 10 benötigt zusätzlich das Paket `kernel-modules-extra` für
K3s, was nicht getestet wurde.

Wenn **firewalld** aktiv ist (üblich bei einer vollständigen RHEL-Serverinstallation, jedoch nicht bei
den minimalen Cloud-Images), kann es Cluster-Traffic blockieren, was sich als Pods
zeigt, die in `ContainerCreating` feststecken, oder als nicht erreichbare Web-App. Vertrauen Sie dem K3s-Pod-
und Service-Netzwerk und öffnen Sie die Ingress-Ports, über die Sie die UI tatsächlich erreichen:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

Die Werte `10.42.0.0/16` und `10.43.0.0/16` sind die K3s-Standardwerte; wenn Sie eine
benutzerdefinierte Cluster- oder Service-CIDR gesetzt haben, verwenden Sie stattdessen diese. Ein Cluster mit mehreren Knoten benötigt
weitere zwischen den Knoten offene Ports (siehe die K3s-Netzwerkanforderungen).

### Alpine und andere Hosts ohne systemd {#alpine-and-other-non-systemd-hosts}

**Der Installer von SocTalk benötigt systemd.** Er bringt K3s als systemd-Dienst hoch
und wartet auf die von systemd geschriebene kubeconfig, sodass er auf Alpine
(OpenRC) oder jedem anderen Init ohne systemd nicht funktioniert. Auf einem solchen Host stoppt `soctalk install`
frühzeitig mit einer klaren Meldung, die Sie darauf hinweist. Aus diesem Grund wird kein `.apk`
veröffentlicht.

Um SocTalk dort auszuführen, wo Sie Alpine in Betracht gezogen haben, verwenden Sie eine systemd-Distribution
(den `.deb`- oder `.rpm`-Pfad oben) oder das vorgefertigte
[Demo-VM-Image](/de-de/quickstart-vm).

## Welchen Pfad sollte ich verwenden?

- **OS-Paket (diese Seite)**: ein von Ihnen verwalteter Linux-Host, verfolgt vom System-
  Paketmanager. Gut für wiederholbare, konfigurationsverwaltete Installationen.
- **[Ein-Befehl-Installation](/de-de/install)**: `curl … | install.sh | bash` auf einer nackten
  Ubuntu-VM, derselbe Installer ohne die Paketumhüllung.
- **[Demo-VM-Image](/de-de/quickstart-vm)**: vorgefertigte Appliance mit einem Browser-Setup-
  Assistenten, der schnellste Weg zu einem laufenden System für die Evaluierung.

Alle drei landen beim selben `soctalk-system`-Chart und demselben laufenden SOC.
