# Launchpad: MSSP-Pilot mit einem einzigen Befehl

Sobald du SocTalk end-to-end auf einer einzelnen, gemeinsam untergebrachten Maschine gesehen hast ([Quickstart](/de-de/quickstart-vm)), ist **Launchpad der nächste Schritt**: Er bringt dich von dieser lokalen Demo zu einem echten Pilot — eine MSSP-Control-Plane plus eine oder mehrere Mandantenumgebungen auf deiner eigenen Infrastruktur. Steuere ihn über eine **Web-Konsole** (empfohlen) oder, später, einen einzigen kopflosen Befehl: Er bootet die VMs, verbindet sie mit deinem Tailnet, installiert SocTalk aus öffentlichen Quellen und übergibt dir eine URL.

Möchtest du lieber jeden Schritt verstehen, bevor ein Tool ihn ausführt? Der [MSSP-Pilot zum Selbermachen](/de-de/mssp-pilot) führt dieselbe Installation von Hand durch — dieselben Charts, derselbe Tailscale-Ablauf. Launchpad übernimmt nur das Kopieren und Einfügen für dich.

::: tip Praktischer Zeitaufwand
| Weg | Praktischer Aufwand | Reale Zeit |
|---|---|---|
| [Zum Selbermachen](/de-de/mssp-pilot) | ~90 Min. | ~2 Stunden |
| Launchpad-Konsole | ~5 Min. Formular ausfüllen | ~15-25 Min. (überwiegend Warten auf Downloads) |
:::

## Was er tut

Ausgehend von deinen MSSP-Admin-Zugangsdaten und einer Liste von Mandanten führt Launchpad Folgendes aus:

1. Lädt das Ubuntu-Noble-Cloud-Image auf deinem VM-Host herunter (bei späteren Läufen aus dem Cache)
2. Stellt QEMU-VMs bereit — eine für den MSSP, eine pro Mandant — mit cloud-init + Tailscale
3. Wartet, bis jede VM deinem Tailnet mit dem von ihr angekündigten Tag beitritt
4. Führt [`install.sh`](https://github.com/soctalk/soctalk/blob/main/install.sh) auf dem MSSP im `--demo`-Modus aus
5. Bindet jeden Mandanten über die MSSP-API ein (Onboarding)
6. Ruft `:issue-agent` für jeden Mandanten auf, um das Bootstrap-Token zu erhalten
7. Installiert k3s + Helm + `soctalk-cloud-agent` auf jeder Mandanten-VM
8. Der MSSP versendet den Job `install_helm_release` → der cloud-agent zieht und wendet den `soctalk-tenant`-Chart an (Wazuh manager + indexer + dashboard, adapter, runs-worker)

Am Ende hast du ein funktionierendes MSSP-Dashboard, registrierte und `active` gesetzte Mandanten sowie Wazuh, das pro Mandant läuft. Alles aus öffentlichen Quellen heruntergeladen — keine vorab bereitgestellten Images, keine gebündelten Charts.

## Was er nicht ist

- **Kein Produktionsinstaller.** Er ist ein Evaluierungstool. Dieselben Nicht-Produktions-Vorbehalte wie beim Pilot zum Selbermachen: kein HA, selbstsignierte Zertifikate, Tailnet als Ingress.
- **Kein Cluster-Manager.** Er läuft einmal und beendet sich dann. Er überwacht den Cluster nicht, macht keine Upgrades, gleicht keine Drift ab. Verwende danach `helm upgrade`.
- **Kein Kubernetes-Operator.** Der Launchpad läuft auf deinem Schreibtisch, nicht im Cluster.

## Voraussetzungen

Beschaffe dir zuerst Folgendes:

- [ ] **Einen von deiner Workstation aus erreichbaren VM-Host.** Eine Linux-Maschine mit:
      - `qemu-system-x86_64`, `qemu-img`, `genisoimage`, `curl`
      - `/dev/kvm` (verschachteltes KVM funktioniert, Bare Metal ist schneller)
      - Genug Reserve für deine VMs: **8 GB RAM + 4 vCPU + 60 GB Festplatte pro VM**
      - Passwortloses SSH von deiner Workstation als Benutzer in der `kvm`-Gruppe
- [ ] **Ein Tailscale-Tailnet.** Der kostenlose Tarif genügt. Du benötigst:
      - Den Tailnet-Namen (z. B. `taila1b2c3.ts.net`)
      - Ein [Tailscale-API-Zugriffstoken](https://login.tailscale.com/admin/settings/keys) mit `keys:write`-Scope — der Launchpad nutzt es, um pro VM kurzlebige Geräte-Auth-Keys zu erzeugen
      - Tag-Ownership für die Tags, die du verwenden wirst — füge diese zu deiner ACL hinzu:
        ```json
        "tagOwners": {
          "tag:mssp":        ["autogroup:admin"],
          "tag:tenant-acme": ["autogroup:admin"]
        }
        ```
- [ ] **Einen öffentlichen SSH-Schlüssel**, den du auf jeder bereitgestellten VM autorisieren möchtest (üblicherweise den deiner Workstation).
- [ ] **Einen LLM-API-Schlüssel** für den MSSP. Wähle einen Anbieter, den du hast (Anthropic, OpenAI, oder verweise auf ein lokales Ollama). Ein Platzhalter-Schlüssel reicht für einen Smoke-Test, bei dem die AI nicht beansprucht wird.

::: warning Tailscale MagicDNS
Der Launchpad erwartet, dass MagicDNS in deinem Tailnet aktiviert ist, damit Mandanten-Cluster den MSSP über den Hostnamen erreichen können. Es ist standardmäßig aktiviert. Wenn du es deaktiviert hast, musst du `hostAliases` selbst hinzufügen (siehe [Pilot zum Selbermachen](/de-de/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant) für das Muster).
:::

## 1. Die CLI installieren

Lade das `launchpad`-Binary für deine Plattform aus dem
[neuesten Release](https://github.com/soctalk/soctalk-launchpad/releases/latest) herunter
und lass es dann seine Plugins abrufen:

```bash
# wähle das Asset für dein OS/deine Arch: launchpad_{darwin,linux,windows}_{amd64,arm64}
base=https://github.com/soctalk/soctalk-launchpad/releases/latest/download
curl -fsSL "$base/launchpad_$(uname -s | tr A-Z a-z)_$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')" -o launchpad
chmod +x launchpad && sudo mv launchpad /usr/local/bin/launchpad

launchpad version
launchpad init   # lädt jedes Plugin herunter + verifiziert die Signatur nach ~/.launchpad/plugins
```

`init` zieht den Plugin-Satz für deine Plattform aus demselben signierten Release und
verifiziert jedes Binary gegen den ed25519-signierten Index des Releases, bevor es
installiert wird. Nichts wird unverifiziert ausgeführt. (`launchpad plugin list` zeigt den
installierten Satz an; `launchpad plugin sync` holt den Store erneut oder repariert ihn.)

## 2. Den Pilot in der Web-Konsole ausführen

`launchpad ui` startet eine lokale Web-Konsole und öffnet sie in deinem Browser — die primäre Art, einen Pilot zu steuern. Du registrierst deine Infrastruktur einmal als wiederverwendbare, testbare **Hosts** und **Networks** und startest und beobachtest dann.

```bash
launchpad ui
```

Beim ersten Lauf lädt die CLI den Plugin-Satz herunter und verifiziert ihn nach `~/.launchpad/plugins`, dann bedient sie die Konsole aus demselben Binary — nichts weiter zu installieren. Arbeite dich im Browser durch drei Bildschirme:

1. **Networks** — füge dein Tailnet hinzu: den Overlay-Namen (z. B. `taila1b2c3.ts.net`) und deinen Tailscale-API-Schlüssel. Drücke **Test**, um zu bestätigen, dass der Schlüssel funktioniert, bevor du dich darauf verlässt. Ein Lauf bindet sich an ein Netzwerk, und jede Maschine tritt ihm bei.
2. **Hosts** — füge den Ort hinzu, an dem du bereitstellen wirst. Für diese Anleitung ist das deine KVM-Maschine: das SSH-Ziel und ein beschreibbares Arbeitsverzeichnis. Neue Hosts füllen die von ihrer Plattform erwarteten Felder vor, und **Test** validiert die Verbindung und die Zugangsdaten. Zugangsdaten werden beim Host gespeichert und verlassen niemals die Maschine, auf der Launchpad läuft.
3. **Runs** — erstelle einen Lauf: weise den **Control-Node** (deinen MSSP) und jeden **Mandanten** einem Host zu, wähle das Netzwerk, trage die MSSP-Admin-Zugangsdaten und den LLM-Schlüssel ein und drücke **Launch**.

![Networks — das Overlay, dem jede Maschine in einem Lauf beitritt, einmalig registriert](/screenshots/launchpad-ui-networks.png)

![Hosts — die Substrate, auf denen du bereitstellst, einmalig registriert](/screenshots/launchpad-ui-hosts.png)

Die Konsole streamt den Fortschritt live — jede VM-Bereitstellung, den Tailnet-Beitritt und die SocTalk-Installation — und gibt dir am Ende die MSSP-URL. Läufe sind idempotent (ein erneuter Start gleicht gegen bereits existierende Maschinen ab, statt sie zu duplizieren), und die Aktion **Down** baut die Maschinen eines Laufs wieder ab.

![Ein laufender Lauf — die MSSP- und Mandanten-VMs bei der Bereitstellung, mit dem Phasen-Tracker und einem Live-Event-Stream](/screenshots/launchpad-ui-run.png)

::: tip Compliance-Prüfung
Bevor du ein Plugin auf echte Infrastruktur richtest, kannst du es über die CLI auf Plausibilität prüfen:
```bash
launchpad plugin verify qemu
```
Dies führt die Protokoll-Compliance-Suite aus (checksum, handshake, `plan`, idempotentes `destroy`), ohne echte Zugangsdaten zu benötigen.
:::

## 3. Prüfen, ob es funktioniert hat

Wenn der Lauf abgeschlossen ist (die Konsole markiert ihn als erledigt, oder `launchpad up` beendet sich mit `0`), prüfe die beiden Systeme auf Plausibilität:

**MSSP-Dashboard** — öffne die URL, die der Lauf am Ende ausgegeben hat (oder `https://lp-mssp.<your-tailnet>.ts.net/`). Melde dich mit den Admin-Zugangsdaten an, die du für den Lauf festgelegt hast. Dein Mandant sollte aufgeführt sein und innerhalb von 1-2 Minuten auf **Online** umschalten.

![Von Launchpad bereitgestelltes MSSP-Dashboard](/screenshots/launchpad-mssp-dashboard.png)

**Wazuh auf dem Mandanten** — verbinde dich per SSH mit der Mandanten-VM (`ssh ops@lp-tenant-acme.<your-tailnet>.ts.net`) und prüfe die Pods:

```bash
sudo k3s kubectl -n tenant-acme get pods
```

Du solltest Folgendes sehen:

```
NAME                                          READY   STATUS
tenant-acme-wazuh-manager-0                   1/1     Running
tenant-acme-wazuh-indexer-0                   1/1     Running
tenant-acme-wazuh-dashboard-<hash>            1/1     Running
tenant-acme-linuxep-0                         1/1     Running
soctalk-adapter-<hash>                        1/1     Running
soctalk-runs-worker-<hash>                    1/1     Running
```

Das `linuxep-0`-StatefulSet ist ein Demo-Linux-Endpoint mit installiertem Wazuh-Agent — ein Ort, um Warnungen zu simulieren. Siehe [Angriffssimulator](/de-de/mssp-pilot#5-3-generate-alerts) für Details.

### Per SSH auf die VMs zugreifen

Jede von Launchpad bereitgestellte VM hat einen vorkonfigurierten `ops`-Benutzer, für den die SSH-Schlüssel aus deiner Host-Konfiguration autorisiert sind, sowie **passwortloses sudo**. So greift die Installationsphase des Launchpad hinein; du verwendest dasselbe Konto für die Fehlersuche.

```bash
# Interaktive Shell als ops
ssh ops@lp-mssp.<your-tailnet>.ts.net
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net

# Einmaliger Befehl als root
ssh ops@lp-tenant-acme.<your-tailnet>.ts.net "sudo journalctl -u k3s -n 100"
```

::: tip Ausweichlösung: über IPv4 verbinden, wenn MagicDNS aus ist
Wenn MagicDNS in deinem Tailnet deaktiviert ist, wird `lp-<key>.<tailnet>.ts.net` auf deiner Workstation nicht aufgelöst. Verwende `tailscale status | grep lp-`, um die Tailnet-IPv4 zu finden, und `ssh ops@100.x.y.z` direkt.
:::

## 4. Deinen Pilot nutzen: Kunden einbinden und die AI befragen

Launchpad übergibt dir einen funktionierenden MSSP mit deinem bereits eingebundenen ersten Mandanten — von hier an steuerst du ihn genau so, wie es ein MSSP tun würde. Das **Dashboard** ist eine mandantenübergreifende Flottenansicht: ausstehende Prüfungen, festhängende Fälle, beeinträchtigte Mandanten und der Zustand pro Mandant.

![Das MSSP-Dashboard — mandantenübergreifende Flottenansicht](/screenshots/pilot-final-dashboard.png)

**Einen weiteren Kunden einbinden.** **Tenants → Create customer** startet einen kurzen vierstufigen Assistenten:

![Create customer — 1. Identity](/screenshots/pilot-add-tenant-step1.png)
![Create customer — 2. Profile](/screenshots/pilot-add-tenant-step2.png)
![Create customer — 3. Branding](/screenshots/pilot-add-tenant-step3.png)
![Create customer — 4. Review](/screenshots/pilot-add-tenant-step4.png)

Der neue Kunde tritt der Flotte bei, und der cloud-agent stellt seinen Wazuh- + Adapter-Stack auf dieselbe Weise bereit, wie Launchpad es für den ersten Mandanten getan hat:

![Die Mandantenliste mit dem eingebundenen Kunden](/screenshots/pilot-final-tenants-list.png)

Tauche in einen Mandanten ein, um seine offenen Untersuchungen, Prüfungen und den Wazuh-Zustand zu sehen:

![Mandanten-Detailansicht](/screenshots/pilot-final-acme-detail.png)

**Den AI-SOC-Analysten befragen.** Die **Chat**-Ansicht beantwortet Fragen über die gesamte Flotte hinweg oder auf einen einzelnen Mandanten begrenzt, ruft Tools gegen Live-Daten auf und fasst zusammen, was sie findet:

![Ask AI — eine flottenweite Zusammenfassung, mit dem ausgeführten Tool-Aufruf](/screenshots/pilot-chat-mssp-reply.png)
![Ask AI — auf einen einzelnen Mandanten begrenzt](/screenshots/pilot-chat-tenant-reply.png)

::: tip
Die AI benötigt einen echten konfigurierten [LLM-Anbieter](/de-de/integrate/llm-providers) — der Smoke-Test-Platzhalter-Schlüssel beantwortet keine Fragen.
:::

## 5. Mit einer Konfigurationsdatei feinjustieren

Sobald ein Pilot aus der Konsole heraus funktioniert, kannst du dasselbe Setup als YAML-Konfiguration erfassen und es kopflos mit `launchpad up` steuern — ohne Konsole. Greife dazu, wenn du Folgendes möchtest:

- **Wiederholbare, skriptbare Läufe** — checke die Konfiguration in git ein, führe sie in CI aus und prüfe den JSON-Event-Stream mit Assertions.
- **Feinsteuerung, die das Formular nicht anbietet** — fixiere ein Basis-Image oder dessen SHA, verweise auf ein bestimmtes `install.sh`-Release-Tag, skripte viele Mandanten auf einmal oder justiere CPU / Speicher / Festplatte pro VM.

Die Konsole und die Konfiguration teilen sich dieselben Hosts und Networks unter `~/.launchpad`, sodass ein Konfigurationslauf genau das wiederverwendet, was du bereits getestet hast.

Speichere dies als `pilot.yaml` und ersetze die Werte in eckigen Klammern:

```yaml
run_id: my-pilot

# Provisioning-Ziel — das Plugin, das VMs erstellt. Weitere: vmware, hetzner, proxmox, docker.
target: qemu

# Wird undurchsichtig an die initialize-Funktion des qemu-Plugins übergeben.
plugin_config:
  ssh_host: [user]@[vm-host-ip]      # SSH-Ziel auf deinem KVM-Host
  work_dir: /home/[user]/lp-vms       # beschreibbarer Pfad; cacht Images + beherbergt VM-Festplatten
  tailnet: [your-tailnet].ts.net
  cpu: 4
  memory_mb: 8192
  disk_gb: 60
  # base_image_url ist optional; Standard ist das aktuelle Ubuntu-Noble-Cloud-Image.
  # base_image_sha256: <optionale Fixierung>

# SSH-Schlüssel, die auf jeder bereitgestellten VM autorisiert sind (der Launchpad verbindet sich per SSH als `ops`).
ssh_keys:
  - "ssh-ed25519 AAAA... you@laptop"

mssp:
  key: mssp
  name: my-pilot-mssp
  role: mssp
  tags: { role: mssp }

tenants:
  - key: tenant-acme
    name: acme-corp
    role: tenant
    tenant_slug: acme
    tags: { role: tenant, tenant_slug: acme }

# Installationsphase nach dem Provisioning.
install:
  # Verweise auf ein fixiertes Release-Tag für reproduzierbare Smoke-Tests. `main` funktioniert auch.
  installer_url: https://raw.githubusercontent.com/soctalk/soctalk/main/install.sh
  mssp_admin_email: admin@my-pilot.demo
  mssp_admin_password: [pick-a-strong-one]
  mssp_display_name: My Pilot MSSP
  llm_provider: anthropic
  llm_api_key: [your-anthropic-key]
```

::: warning Zum Admin-Passwort
Speichere es vor dem Ausführen in einem Passwort-Manager. Der Launchpad gibt es dir nicht zurück, wenn du den Überblick verlierst.
:::

Um Mandanten hinzuzufügen, erweitere die `tenants:`-Liste. Jeder benötigt einen eindeutigen `key`, einen `tenant_slug`, der zu deiner Tailscale-ACL passt, und einen entsprechenden Eintrag unter `tagOwners`.

### Ausführen

```bash
export TAILSCALE_API_KEY=tskey-api-...

launchpad up --config pilot.yaml --state ~/.launchpad/state.json
```

Standardmäßig wird ein Bubble-Tea-TUI mit Fortschrittsbalken pro VM, einem Live-Event-Log und einer Gate-Abfrage für interaktive Schritte gerendert. Für unbeaufsichtigte Läufe (CI, Skripte, die Smoke-Tests dieser Anleitung) verwende `--headless`, um JSON-Events nach stdout zu streamen:

```bash
launchpad up --config pilot.yaml \
  --state ~/.launchpad/state.json \
  --headless --auto-resolve-gates | tee run.log
```

`--auto-resolve-gates` akzeptiert jedes Gate (derzeit nur die Tailscale-ACL-Bestätigung) ohne Nachfrage. Lass es weg, wenn du deine ACL prüfen möchtest, bevor Mandanten bereitgestellt werden.

Grobe Phasen-Zeiten bei einem ersten Lauf (frischer Cache, ordentliches Heim-Internet):

| Phase | Dauer | Was passiert |
|---|---|---|
| `provisioning` | 60-90 s | Image-Download (~600 MB) + cloud-init + Tailnet-Beitritt |
| `installing` (MSSP) | 3-5 Min. | k3s-Installation, Helm, `soctalk-system`-Chart |
| `installing` (pro Mandant) | 3-5 Min. | k3s + Helm + `soctalk-cloud-agent`, dann versendet der MSSP den `soctalk-tenant`-Chart (Wazuh + adapter) |
| Gesamt | **~10-15 Min.** | für MSSP + 1 Mandant |

Nachfolgende Läufe sind deutlich schneller, weil das Basis-Image auf dem VM-Host gecacht ist.

## 6. Iterieren — fortsetzen, abbauen, neu starten

Der Launchpad ist idempotent. Ein erneuter Start eines Laufs — erneut die Konsolen-**Launch**-Aktion oder `launchpad up` — macht dort weiter, wo er aufgehört hat:

- VMs, die bereits existieren, werden wiederverwendet (kein doppeltes Provisioning)
- Der MSSP-Installationsschritt wird übersprungen, wenn die API bereits antwortet
- Das Mandanten-Onboarding wird übersprungen, wenn der Mandant bereits existiert
- Der `soctalk-cloud-agent`-Chart wird per `helm upgrade --install` installiert, nicht neu installiert

Um alles sauber abzubauen (VMs, Tailscale-Geräte, Arbeitsverzeichnis), verwende die Konsolen-**Down**-Aktion oder:

```bash
launchpad down --config pilot.yaml --state ~/.launchpad/state.json
```

Um einen Mandanten zu einem laufenden Pilot hinzuzufügen, füge ihn in der Konsole hinzu (oder bearbeite `tenants:` in `pilot.yaml`) und starte erneut. Bestehende VMs bleiben unangetastet; der neue Mandant wird bereitgestellt und installiert.

## 7. Fehlersuche

### `vm.wait_ready` läuft in einen Timeout

Die VM ist gebootet, aber nie dem Tailnet beigetreten. Cloud-init auf der VM konnte die Tailscale-Koordinationsserver nicht erreichen.

- Bestätige, dass dein VM-Host Internet hat
- Verbinde dich per SSH mit dem VM-Host und inspiziere das QEMU-Serial-Log unter `<work_dir>/<run_id>/<vm_key>/serial.log` — es erfasst die cloud-init-Ausgabe einschließlich tailscale-up
- Häufige Ursache: Der kurzlebige Auth-Key wurde widerrufen, bevor die VM ihn verwendete (prüfe Tailscale-Admin → Machines-Log)

### MSSP-Installation läuft bei `helm upgrade` in einen Timeout

Die Chart-Installation lief, aber die Pods konvergierten nicht innerhalb von 15 Minuten. Meist Image-Pulls über langsame Verbindungen.

- Verbinde dich per SSH mit der MSSP-VM: `sudo k3s kubectl -n soctalk-system get pods` und prüfe auf `ImagePullBackOff` oder `CrashLoopBackOff`
- Wenn Pods noch ziehen, warte und starte erneut — der zweite Versuch überspringt den Installationsschritt, sobald die API antwortet

### Mandanten-Agent loggt `no such host` bei `/api/agent/register`

Das Cluster-DNS des Pods kann den Tailnet-Hostnamen des MSSP nicht auflösen. Genau dafür ist `hostAliases` gedacht. Der Launchpad fügt dies standardmäßig in den Helm-Befehl ein; wenn du es von Hand machst, siehe [Pilot zum Selbermachen](/de-de/mssp-pilot#4-6-install-the-cloud-agent-on-the-tenant).

### Automatisierung

Der `--headless`-Modus ist die Automatisierungsschnittstelle des Launchpad. Jede Phase, jeder VM-Zustandswechsel, jede Installations-Log-Zeile und jede Gate-Abfrage ist ein JSON-Event auf stdout:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Prüfe diese Events aus deinem CI heraus mit Assertions. Siehe [Launchpad-Event-Schema](/de-de/reference/launchpad-events) für die vollständige Liste.

## Wie geht es weiter

- **Einen echten Mandanten hinzufügen.** Binde ihn über das MSSP-Dashboard ein — siehe [Pilot zum Selbermachen §3](/de-de/mssp-pilot#3-onboard-tenants) für die Assistenten-Anleitung.
- **Ein paar Warnungen erzeugen.** [Angriffssimulator](/de-de/mssp-pilot#5-3-generate-alerts) enthält das Runbook.
- **Die AI auf echte Daten richten.** Konfiguriere deinen [LLM-Anbieter](/de-de/integrate/llm-providers) ordentlich (der Smoke-Test-Platzhalter-Schlüssel beantwortet keine Fragen).
- **In Produktion gehen.** [Install](/de-de/install) ist der Nicht-Launchpad-Pfad mit HA-Fähigkeit.
