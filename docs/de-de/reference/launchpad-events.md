# Launchpad-Event-Schema

`launchpad up --headless` und `launchpad down --headless` streamen **ein JSON-Event pro Zeile** nach stdout. Dies ist die Automatisierungsschnittstelle: Werte diese Events aus CI, Skripten oder einer steuernden TUI aus.

Alle Events teilen dieselbe Grundstruktur auf oberster Ebene. Nur die Felder, die für die jeweilige Event-Art relevant sind, werden befüllt.

```json
{
  "ev":       "<kind>",        // Diskriminator; siehe unten
  "time":     "2026-07-02T16:05:14.089Z",
  "phase":    "<phase>",       // nur bei ev=phase
  "vm_key":   "mssp",          // grenzt Events auf VM-Ebene ein
  "step":     "install",       // Unterphase innerhalb einer VM
  "percent":  60,              // 0-100
  "message":  "...",           // menschenlesbar
  "level":    "info",          // für vm_log
  "gate_id":  "...",           // für gate_open / gate_resolved
  "instructions": "...",       // für gate_open
  "copy_text":    "...",       // für gate_open
  "ipv4":     "100.x.x.x",     // für vm_ready
  "ipv6":     "...",
  "ssh_user": "ops",
  "ssh_port": 22,
  "fields":   { "capabilities": ["vm.plan"] },  // frei formatiert; von plugin_ready verwendet
  "error":    { "category":"...", "code":"...", "message":"...", "hint":"..." }
}
```

## Event-Arten

| `ev`             | Ausgelöst, wenn                                                                        | Terminal? |
|------------------|---------------------------------------------------------------------------------------|-----------|
| `phase`          | Der Orchestrator wechselt die Phase.                                                   | nein      |
| `plugin_ready`   | Das Provisioning-Plugin wurde gestartet und hat seinen `hello`-Handshake zurückgegeben. | nein    |
| `vm_plan`        | Trockenlauf-Beschreibung dessen, was das Plugin pro VM erstellen *würde*.              | nein      |
| `vm_progress`    | Fortschritt eines VM-Unterschritts (enthält `step` + `percent`).                      | nein      |
| `vm_ready`       | Das Plugin hat die VM erstellt und verifiziert.                                        | nein      |
| `vm_log`         | Log-Zeile entweder vom Plugin (Fortschritts-Relay) oder von einer launchpad-gesteuerten Installations-Shell. | nein |
| `gate_open`      | Manuelles Gate erreicht; erfordert Bestätigung durch den Operator.                     | nein      |
| `gate_resolved`  | Der Operator (oder `--auto-resolve-gates`) hat das Gate geschlossen.                   | nein      |
| `error`          | Fataler Fehler. `error.category` + `error.code` sind stabile Bezeichner.              | **ja**    |
| `complete`       | Der gesamte Ablauf lief sauber durch.                                                  | **ja**    |

`error` und `complete` sind die beiden terminalen Events. Jeder launchpad-Lauf gibt genau eines davon aus.

## Phasenreihenfolge (up)

```
initializing → planning → provisioning → installing → complete
```

Pro VM innerhalb von `provisioning` werden die Schritte `lookup → prepare → image_cache|image_download → tailscale → cloud_init → disk → boot → wait_ready` als `vm_progress` ausgegeben. Der Schritt `install` während `installing` streamt die stdout-Ausgabe des zugrunde liegenden Installers als `vm_log`.

## Phasenreihenfolge (down)

```
tearing_down → torn_down → complete
```

`vm.destroy` wird pro VM in umgekehrter Provisioning-Reihenfolge aufgerufen (Mandanten zuerst, MSSP zuletzt). Jede Ausgabe pro VM ist ein `vm_progress` mit `step=destroy`.

## Fehlertaxonomie

`error.category` ist einer von zehn stabilen Bezeichnern, zu denen sich der launchpad + alle Erstanbieter-Plugins verpflichten:

| Kategorie           | Bedeutung                                                           | Wiederholbar |
|---------------------|---------------------------------------------------------------------|--------------|
| `auth`              | Anmeldedaten fehlen, sind ungültig oder haben keinen ausreichenden Scope. | nein   |
| `validation`        | Konfiguration oder Eingabe ist fehlerhaft.                          | nein         |
| `not_found`         | Referenzierte Entität existiert nicht.                              | nein         |
| `already_exists`    | Idempotentes Erstellen fehlgeschlagen, weil die Entität bereits vorhanden ist. | nein |
| `provider_unavailable` | Upstream-Provider (Tailscale, Hetzner, ...) ist nicht erreichbar. | ja        |
| `quota`             | Provider-seitiges Kontingent erschöpft.                            | nein         |
| `timeout`           | Wartezeit hat eine Richtlinien-Deadline überschritten.             | ja           |
| `internal`          | Fehler im Plugin/Orchestrator — unerwarteter Fehlerpfad.           | nein         |
| `network`           | Lokales Netzwerk / TLS / DNS.                                      | ja           |
| `cancelled`         | Ctrl-C oder SIGTERM.                                               | nein         |

`error.code` ist ein Plugin-namespaced Bezeichner unterhalb der Kategorie (z. B. `qemu.image.sha256_mismatch`). Kategorien sind stabil; Codes können hinzugefügt werden.

## Konsumieren aus bash

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Um einen CI-Job vom Abschluss abhängig zu machen:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates > run.log
grep -q '"ev":"complete"' run.log || {
  jq -r 'select(.ev == "error") | "\(.error.category)/\(.error.code): \(.error.message)"' < run.log
  exit 1
}
```

## Versionskompatibilität

- Feld-Ergänzungen sind nicht abwärtsbrechend.
- Feld-Entfernungen erhöhen die Major-Version des launchpad.
- Die Werte von `error.category` sind dauerhaft. Die Werte von `ev` sind dauerhaft.
- Die Werte von `error.code` können innerhalb derselben Kategorie umbenannt werden (sie sind Plugin-scoped).
