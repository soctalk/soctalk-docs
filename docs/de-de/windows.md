# Unter Windows ausführen (WSL2)

SocTalk ist Kubernetes-nativ. Unter Windows läuft es als **k3s (leichtgewichtiges Kubernetes) innerhalb von WSL2** — für dich installiert und eingerichtet durch einen einzigen PowerShell-Befehl. Kein Docker Desktop erforderlich.

::: tip Nur zum Ausprobieren?
Die **[VM-Appliance](/de-de/downloads)** (Hyper-V `vhdx` oder [VirtualBox](/de-de/virtualbox)) ist der einfachste und robusteste Weg, SocTalk unter Windows zu testen — sie ist eine eigenständige Linux-VM, an der nichts zu konfigurieren ist. Der WSL2-Weg auf dieser Seite ist die Komfortoption für ein lokales Cluster, gedacht für Entwickler, die lieber keine vollständige VM betreiben möchten.
:::

::: warning Architektur
SocTalk-Images sind **ausschließlich amd64**, daher funktioniert dies unter **Windows x64**. Unter Windows on ARM würde das Image-Set Emulation benötigen.
:::

## Voraussetzungen

- **Windows 10 2004 (Build 19041) oder neuer, oder Windows 11** — x64
- **Administrator**-PowerShell (das Installationsprogramm aktiviert Windows-Features und konfiguriert WSL2)
- **CPU-Virtualisierung aktiviert** in der Firmware (WSL2 benötigt sie; in einer VM aktiviere geschachtelte Virtualisierung)

Du musst WSL2, Ubuntu oder Docker **nicht** vorab installieren — das Installationsprogramm erledigt all das.

## Installation mit einem Klick

Öffne **PowerShell als Administrator** und führe aus:

```powershell
irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1 | iex
```

Was passiert:

1. **Aktiviert WSL2** (ein Neustart — melde dich wieder an, und die Installation **wird automatisch fortgesetzt** bei deiner nächsten Anmeldung; WSL2 kann nicht unter dem SYSTEM-Konto laufen, daher läuft die Fortsetzung in deiner Sitzung).
2. **Importiert eine Ubuntu**-Distribution und aktiviert systemd darin.
3. **Installiert k3s** als systemd-Dienst innerhalb von WSL2, stellt dann SocTalk bereit und richtet einen **`demo`-Mandanten** ein.
4. **Macht die UI für Windows verfügbar** unter **`https://localhost/`** (ein `netsh portproxy` leitet an das Cluster innerhalb von WSL2 weiter; eine Anmeldeaufgabe frischt sie nach Neustarts wieder auf).

Wenn der Vorgang abgeschlossen ist, gibt er die URL und die Demo-Zugangsdaten aus. Öffne **`https://localhost/`** in deinem Browser, akzeptiere das selbstsignierte Zertifikat und melde dich an.

Für eine **echte (nicht-Demo)** Installation übergib `-Real`, um nach dem MSSP-Namen, der Admin-E-Mail/dem Passwort und dem LLM-Schlüssel gefragt zu werden (oder setze die `SOCTALK_*`-Umgebungsvariablen):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1))) -Real
```

## Was es tut (unter der Haube)

Das PowerShell-Installationsprogramm bootstrappt WSL2 und führt dann dasselbe **`install.sh`** aus, das die Linux-Appliance verwendet, mit k3s als Laufzeitumgebung:

```bash
# inside the WSL2 Ubuntu distro, as root:
curl -sfL https://get.k3s.io | sh -          # k3s as a systemd service
helm upgrade --install soctalk-system \
  oci://ghcr.io/soctalk/charts/soctalk-system --version 0.2.0 \
  --namespace soctalk-system --create-namespace -f values.yaml
```

Der Ingress-Host ist `localhost`, und ein Windows-`netsh portproxy` (`localhost:443` → die WSL2-IP) macht ihn aus deinem Browser erreichbar.

## Hinweise

- **Ein Neustart** ist erforderlich, um die Aktivierung von WSL2 abzuschließen; melde dich danach wieder an, und die Installation läuft von selbst weiter.
- **Halte die WSL-Distribution des Clusters am Laufen** — k3s lebt darin. Das Installationsprogramm setzt `vmIdleTimeout=-1`, damit WSL2 nicht in den Leerlauf geht, und eine Anmeldeaufgabe startet WSL neu und frischt die `localhost`-Weiterleitung nach einem Windows-Neustart wieder auf.
- Der WSL2-Weg ist die **Komfortoption für ein lokales Cluster**. Für eine immer aktive / produktionsnahe Installation unter Windows bevorzuge die **[VM-Appliance](/de-de/downloads)** (Hyper-V/VirtualBox) — eine einzelne Linux-VM ohne bewegliche Teile in der WSL2-Vernetzung.
- amd64-Images → nur Windows **x64**.

## Abbau

```powershell
# remove the host forward + logon tasks
netsh interface portproxy reset
Get-ScheduledTask SocTalk* | Unregister-ScheduledTask -Confirm:$false

# remove the cluster (inside WSL) and/or the whole distro
wsl -d Ubuntu -u root -- /usr/local/bin/k3s-uninstall.sh
wsl --unregister Ubuntu      # optional: remove the distro entirely
```

## Fehlerbehebung

| Symptom | Prüfung |
|---|---|
| Installation wurde nach dem Neustart nicht fortgesetzt | melde dich als **derselbe Benutzer** wieder an — die Fortsetzung läuft bei deiner Anmeldung. Ein erneutes Ausführen von `install.ps1` ist unbedenklich (abgeschlossene Schritte werden übersprungen). |
| `https://localhost/` lädt nicht | die WSL2-IP hat sich möglicherweise geändert; die geplante Aufgabe `SocTalkExpose` frischt die Weiterleitung wieder auf — führe sie aus (`Start-ScheduledTask SocTalkExpose`) oder starte erneut und versuche es dann erneut. |
| `503` von `https://localhost/` | die Weiterleitung funktioniert, aber die Pods sind noch nicht bereit — `wsl -d Ubuntu -u root -- k3s kubectl -n soctalk-system get pods` und warte auf `Running`. |
| WSL2 startet nicht | aktiviere die CPU-Virtualisierung (VT-x/AMD-V) in der Firmware; in einer VM aktiviere geschachtelte Virtualisierung. |
| Alles nach dem Assistenten | wie bei jeder Plattform — siehe die [Tabelle zur Fehlerbehebung im Quickstart](/de-de/quickstart-vm#troubleshooting). |
