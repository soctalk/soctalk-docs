# Setup-Assistent

Browserbasierter First-Boot-Konfigurator, der mit dem [Demo-VM-Image](/de-de/quickstart-vm) ausgeliefert wird. Er ist **kein** Bestandteil einer Produktionsinstallation, Produktionsnutzer schreiben `values.yaml` selbst und führen `helm install` selbst aus.

Aufgabe des Assistenten ist es:

1. Den Operator mit einem Setup-Token pro Boot-Vorgang zu authentifizieren.
2. Die Mindestkonfiguration zu erfassen, die für die Installation von `soctalk-system` erforderlich ist.
3. `/etc/soctalk/values.yaml`, `/etc/soctalk/llm.key` und eine Env-Datei für das Mandanten-Onboarding zu schreiben.
4. Zu beenden und an `soctalk-firstboot.service` zu übergeben, der `helm install` ausführt und einen Demo-Mandanten onboardet.

Der Quellcode befindet sich unter [`setup-wizard/`](https://github.com/soctalk/soctalk/tree/main/setup-wizard) (Go, ~600 Zeilen).

## So erreichen Sie ihn

Port `:8443` auf der VM. Nur TLS; der Assistent generiert beim ersten Boot ein selbstsigniertes ECDSA-P-256-Zertifikat, das die lokalen IPs der VM, `localhost` und `soctalk.local` abdeckt. Der Bind-Port ist `:8443` (nicht `:443`), damit er nicht mit dem in k3s gebündelten Traefik kollidiert.

```text
https://<vm-ip>:8443/
```

## Setup-Token

Der Assistent generiert beim ersten Start ein 256-Bit-Setup-Token und schreibt es nach `/var/log/soctalk-setup-token` (Modus `0600`, root-eigen). Abrufen mit:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

Das Token wird bei jedem Neustart des Assistenten rotiert. Es gibt keine API, um ein verlorenes Token ohne Neustart der Unit wiederherzustellen; ein Neustart rotiert und gibt es erneut aus.

## Zweistufiges Formular

1. **Authentifizieren**: das Setup-Token einfügen.
2. **Konfigurieren**: die untenstehenden Felder ausfüllen.

Die Seite zur Token-Eingabe sendet an `POST /auth`; die Konfigurationsseite sendet an `POST /submit`. Beide verwenden HMAC-gebundene CSRF-Cookies (`SameSite=Strict`, `HttpOnly`, `Secure`).

### Stufe 1, Authentifizieren

![Setup-Assistent, Token-Eingabe](/screenshots/setup-wizard-token.png)

### Stufe 2, Konfigurieren

![Setup-Assistent, Konfigurationsformular, ausgefüllt](/screenshots/setup-wizard-config-filled.png)

### Identität

| Feld | Typ | Hinweise |
|---|---|---|
| MSSP-/Organisationsname | Text, ≤120 Zeichen | wird zu `install.msspName` in den Chart-Values |
| Hostname | optionaler FQDN, ≤253 Zeichen | leer → Standardwert `soctalk.local`; der Chart lehnt IP-Adressen auf `spec.rules[0].host` ab |
| Admin-E-Mail | E-Mail | wird zum Bootstrap-`mssp_admin` (die V1-Chart-Init erstellt diese Rolle, nicht `platform_admin`) |
| Admin-Passwort | Passwort, ≥12 Zeichen | wird in die Values-Datei als `install.bootstrapAdmin.password` geschrieben. Die Init des Charts erstellt den Benutzer mit `must_change=false`, sodass die erste Anmeldung sofort möglich ist |

### LLM

| Feld | Typ | Hinweise |
|---|---|---|
| Provider | Auswahl (`anthropic`, `openai`) | **Nur zur Anzeige in dieser Version.** Der Assistent erfasst den Wert, schreibt ihn aber nicht in die Chart-Values; der Standardwert des Charts (`openai-compatible`) gilt. Um einen bestimmten Provider festzulegen, bearbeiten Sie `/etc/soctalk/values.yaml`, um `defaults.llm.provider` zu setzen, bevor `soctalk-firstboot.service` läuft, oder führen Sie nach der Installation `helm upgrade` aus. Die Anbindung durch den Assistenten ist für eine zukünftige Version vorgesehen |
| API-Schlüssel | Passwort | wird nach `/etc/soctalk/llm.key` geschrieben (Modus `0600`), NICHT in die Values-Datei. Der Installer erstellt daraus ein Kubernetes Secret (`soctalk-system-llm-api-key`) mit den beiden Datenfeldern `anthropic-api-key` und `openai-api-key`, sodass die Laufzeit des Charts den jeweils in den Values angegebenen Provider verwenden kann |

### Onboarding des Demo-Mandanten

Der Assistent schreibt außerdem `/etc/soctalk/onboard.env`:

```text
ADMIN_EMAIL='<email>'
ADMIN_PW='<password>'
INGRESS_HOST='<hostname or soctalk.local>'
TENANT_SLUG=demo
TENANT_NAME='<org name> — Demo'
```

`soctalk-firstboot.sh` liest diese Datei, nachdem `helm install` erfolgreich war, meldet sich über `POST /api/auth/login` an und ruft `POST /api/mssp/tenants/onboard` mit `{slug: demo, profile: poc, display_name: <name>}` auf. Das Mandanten-Onboarding erfolgt **asynchron**: Die API gibt sofort 202 zurück; der Provisioning-Controller startet den Wazuh-Stack im Hintergrund. Der First-Boot-Installer wartet vor dem Beenden nicht darauf, dass der Mandant den Status `active` erreicht.

## Was der Assistent schreibt

| Pfad | Modus | Inhalt |
|---|---|---|
| `/etc/soctalk/values.yaml` | 0640 | Gerenderte Chart-Values (`install.*`, `ingress.*`, `postgres.*`) |
| `/etc/soctalk/llm.key` | 0600 | LLM-API-Schlüssel, einzeilig |
| `/etc/soctalk/onboard.env` | 0600 | Env-Datei für das Demo-Mandanten-Onboarding |
| `/var/lib/soctalk-wizard.done` | 0644 | Sentinel, verhindert, dass der Assistent bei nachfolgenden Boot-Vorgängen erneut startet |

## systemd-Unit

```text
[Unit]
After=cloud-init.target network-online.target
ConditionPathExists=!/var/lib/soctalk-firstboot.done
ConditionPathExists=!/var/lib/soctalk-wizard.done
ConditionPathExists=!/etc/soctalk/values.yaml

[Install]
WantedBy=cloud-init.target
```

Sie hängt sich an `cloud-init.target` (nicht `multi-user.target`), um einen Ordering-Zyklus über `After=cloud-final.service` zu vermeiden. Die User-Data von Cloud-init darf `/etc/soctalk/values.yaml` direkt ablegen, geschieht dies, startet der Assistent nie und `soctalk-firstboot.service` fährt direkt mit `helm install` fort.

## Härtung

Die Unit verwendet die Standard-Härtung von systemd: `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `RestrictNamespaces=true`, `MemoryDenyWriteExecute=true`. Schreibvorgänge sind auf `/etc/soctalk`, `/var/lib` und `/var/log` beschränkt. Der Assistent bindet den privilegierten Port `:8443` über `AmbientCapabilities=CAP_NET_BIND_SERVICE`.

Nach einem erfolgreichen Submit schreibt der Assistent das Sentinel und beendet sich. Das `ConditionPathExists=!sentinel` von systemd verhindert einen Neustart beim Boot-Vorgang.

## Missbrauchsschutz

- **Token-Gate** an jedem authentifizierten Endpoint. Konstantzeit-Vergleich.
- **CSRF** über HMAC-gebundene Double-Submit-Cookies bei jedem statusändernden POST.
- **Rate-Limit**: mindestens 30 s zwischen Authentifizierungsversuchen pro Quell-IP; 10 Fehlschläge innerhalb einer Stunde sperren die IP für eine Stunde. (Codex kennzeichnete dies als trivialen DoS-Vektor hinter NAT, Operatoren hinter einem gemeinsam genutzten NAT können sehen, dass legitimes Setup blockiert wird. Starten Sie die Unit neu, um dies zurückzusetzen.)
- **Nur selbstsigniertes TLS**. Der Assistent liefert niemals Klartext-HTTP aus. Kunden akzeptieren das selbstsignierte Zertifikat einmalig; Produktionsnutzer sollten den Assistenten überhaupt nie erreichen.

## Was nach dem Submit passiert

Der Assistent gibt `{poll: "/status", status: "accepted"}` zurück und beendet sich nach einem Kulanzfenster von 3 Sekunden (damit der Poller des Kunden die Erfolgsantwort abgreifen kann). Dann:

1. `soctalk-firstboot.service` bemerkt, dass `values.yaml` existiert, und startet.
2. `systemctl start k3s` (k3s wurde von Packer installiert, aber nicht gestartet, sodass der Assistent `:8443` frei hatte).
3. Erstellt den Namespace `soctalk-system` + das LLM Secret.
4. `helm upgrade --install soctalk-system /opt/soctalk/charts/soctalk-system --values /etc/soctalk/values.yaml --wait --timeout 15m`.
5. Patcht die NetworkPolicy `kube-system → soctalk-system`, damit Traefik die soctalk-system-Services erreichen kann.
6. Pollt `/api/auth/me` über Traefik (Host-Header-Trick) für bis zu 10 Minuten. Sowohl 200 als auch 401 bedeuten „Traefik routet"; die Schleife akzeptiert beides.
7. Meldet sich als Bootstrap-Admin an, ruft `POST /api/mssp/tenants/onboard` auf.
8. Schreibt `/var/lib/soctalk-firstboot.done`.

Verfolgen Sie `/var/log/soctalk-firstboot.log` (oder `journalctl -u soctalk-firstboot -f`) zum Mitverfolgen.

## Zurücksetzen / erneut ausführen

Um den Assistenten nach einer erfolgreichen Installation erneut auszuführen:

```bash
sudo rm /var/lib/soctalk-firstboot.done /var/lib/soctalk-wizard.done /etc/soctalk/values.yaml
sudo systemctl restart soctalk-setup-wizard
```

Dies ist destruktiv, das bestehende Helm-Release besitzt weiterhin den Namespace `soctalk-system`. Für ein sauberes Zurücksetzen führen Sie zuerst `helm uninstall soctalk-system -n soctalk-system` aus.
