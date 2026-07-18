# Schema degli eventi di Launchpad

`launchpad up --headless` e `launchpad down --headless` inviano **un evento JSON per riga** su stdout. Questa è la superficie di automazione: verifica questi eventi da CI, script o da una TUI di controllo.

Tutti gli eventi condividono la stessa struttura di primo livello. Vengono popolati solo i campi rilevanti per il tipo di evento.

```json
{
  "ev":       "<kind>",        // discriminante; vedi sotto
  "time":     "2026-07-02T16:05:14.089Z",
  "phase":    "<phase>",       // solo su ev=phase
  "vm_key":   "mssp",          // delimita gli eventi a livello di VM
  "step":     "install",       // sotto-fase all'interno di una VM
  "percent":  60,              // 0-100
  "message":  "...",           // leggibile dall'operatore
  "level":    "info",          // per vm_log
  "gate_id":  "...",           // per gate_open / gate_resolved
  "instructions": "...",       // per gate_open
  "copy_text":    "...",       // per gate_open
  "ipv4":     "100.x.x.x",     // per vm_ready
  "ipv6":     "...",
  "ssh_user": "ops",
  "ssh_port": 22,
  "fields":   { "capabilities": ["vm.plan"] },  // formato libero; usato da plugin_ready
  "error":    { "category":"...", "code":"...", "message":"...", "hint":"..." }
}
```

## Tipi di evento

| `ev`             | Emesso quando                                                                          | Terminale? |
|------------------|---------------------------------------------------------------------------------------|-----------|
| `phase`          | L'orchestratore cambia fase.                                                           | no        |
| `plugin_ready`   | Il plugin di provisioning è stato avviato e ha restituito il proprio handshake `hello`. | no        |
| `vm_plan`        | Descrizione in dry-run di ciò che il plugin *creerebbe*, per ogni VM.                  | no        |
| `vm_progress`    | Avanzamento dei sotto-step per VM (contiene `step` + `percent`).                       | no        |
| `vm_ready`       | Il plugin ha creato e verificato la VM.                                                | no        |
| `vm_log`         | Riga di log dal plugin (relay di avanzamento) o da una shell di installazione pilotata da launchpad. | no        |
| `gate_open`      | Raggiunto un gate manuale; richiede la conferma dell'operatore.                        | no        |
| `gate_resolved`  | L'operatore (o `--auto-resolve-gates`) ha chiuso il gate.                              | no        |
| `error`          | Errore fatale. `error.category` + `error.code` sono identificatori stabili.           | **sì**    |
| `complete`       | L'intero flusso è stato eseguito senza errori.                                         | **sì**    |

`error` e `complete` sono i due eventi terminali. Ogni esecuzione di launchpad ne emette esattamente uno.

## Ordine delle fasi (up)

```
initializing → planning → provisioning → installing → complete
```

All'interno di `provisioning`, per ciascuna VM gli step `lookup → prepare → image_cache|image_download → tailscale → cloud_init → disk → boot → wait_ready` vengono emessi come `vm_progress`. Lo step `install` durante `installing` trasmette in streaming lo stdout dell'installer sottostante come `vm_log`.

## Ordine delle fasi (down)

```
tearing_down → torn_down → complete
```

`vm.destroy` viene invocato per ciascuna VM nell'ordine inverso al provisioning (prima i tenant, per ultimo l'MSSP). Ogni emissione per VM è un `vm_progress` con `step=destroy`.

## Tassonomia degli errori

`error.category` è uno dei dieci identificatori stabili a cui launchpad e tutti i plugin first-party si attengono:

| Categoria           | Significato                                                         | Ritentabile |
|---------------------|---------------------------------------------------------------------|-----------|
| `auth`              | Credenziale mancante, non valida o priva di scope.                  | no        |
| `validation`        | Configurazione o input malformati.                                 | no        |
| `not_found`         | L'entità referenziata non esiste.                                  | no        |
| `already_exists`    | Creazione idempotente fallita perché l'entità è già presente.      | no        |
| `provider_unavailable` | Il provider upstream (Tailscale, Hetzner, ...) è irraggiungibile. | sì        |
| `quota`             | Quota lato provider esaurita.                                       | no        |
| `timeout`           | L'attesa ha superato una scadenza di policy.                        | sì        |
| `internal`          | Bug del plugin/orchestratore — percorso di errore inatteso.        | no        |
| `network`           | Rete locale / TLS / DNS.                                            | sì        |
| `cancelled`         | Ctrl-C o SIGTERM.                                                   | no        |

`error.code` è un identificatore con namespace di plugin all'interno della categoria (ad es. `qemu.image.sha256_mismatch`). Le categorie sono stabili; i codici possono essere aggiunti.

## Consumo da bash

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Per subordinare un job CI al completamento:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates > run.log
grep -q '"ev":"complete"' run.log || {
  jq -r 'select(.ev == "error") | "\(.error.category)/\(.error.code): \(.error.message)"' < run.log
  exit 1
}
```

## Compatibilità tra versioni

- Le aggiunte di campi non introducono modifiche incompatibili.
- La rimozione di campi incrementa la major version di launchpad.
- I valori di `error.category` sono permanenti. I valori di `ev` sono permanenti.
- I valori di `error.code` possono essere rinominati all'interno della stessa categoria (hanno scope di plugin).
