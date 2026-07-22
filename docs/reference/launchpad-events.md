# Launchpad event schema

`launchpad up --headless` and `launchpad down --headless` stream **one JSON event per line** to stdout. This is the automation surface: assert on these events from CI, scripts, or a driving TUI.

All events share the same top-level shape. Only fields relevant to the event kind are populated.

```json
{
  "ev":       "<kind>",        // discriminator; see below
  "time":     "2026-07-02T16:05:14.089Z",
  "phase":    "<phase>",       // only on ev=phase
  "vm_key":   "mssp",          // scopes VM-level events
  "step":     "install",       // sub-phase within a VM
  "percent":  60,              // 0-100
  "message":  "...",           // human-readable
  "level":    "info",          // for vm_log
  "gate_id":  "...",           // for gate_open / gate_resolved
  "instructions": "...",       // for gate_open
  "copy_text":    "...",       // for gate_open
  "ipv4":     "100.x.x.x",     // for vm_ready
  "ipv6":     "...",
  "ssh_user": "ops",
  "ssh_port": 22,
  "fields":   { "capabilities": ["vm.plan"] },  // free-form; used by plugin_ready
  "error":    { "category":"...", "code":"...", "message":"...", "hint":"..." }
}
```

## Event kinds

| `ev`             | Emitted when                                                                          | Terminal? |
|------------------|---------------------------------------------------------------------------------------|-----------|
| `phase`          | The orchestrator transitions phase.                                                   | no        |
| `plugin_ready`   | The provisioning plugin has spawned + returned its `hello` handshake.                 | no        |
| `vm_plan`        | Dry-run description of what the plugin *would* create, per VM.                        | no        |
| `vm_progress`    | Per-VM sub-step progress (has `step` + `percent`).                                    | no        |
| `vm_ready`       | Plugin has created + verified the VM.                                                 | no        |
| `vm_log`         | Log line from either the plugin (progress relay) or a launchpad-driven install shell. | no        |
| `gate_open`      | Manual gate reached; requires operator confirmation.                                  | no        |
| `gate_resolved`  | Operator (or `--auto-resolve-gates`) closed the gate.                                 | no        |
| `error`          | Fatal error. `error.category` + `error.code` are stable identifiers.                  | **yes**   |
| `complete`       | Whole flow ran clean.                                                                 | **yes**   |

`error` and `complete` are the two terminal events. Every launchpad run emits exactly one.

## Phase order (up)

```
initializing → planning → provisioning → installing → complete
```

Per-VM within `provisioning`, the steps `lookup → prepare → image_cache|image_download → tailscale → cloud_init → disk → boot → wait_ready` are emitted as `vm_progress`. The `install` step during `installing` streams the underlying installer's stdout as `vm_log`.

## Phase order (down)

```
tearing_down → torn_down → complete
```

`vm.destroy` is called per VM in reverse-provision order (tenants first, MSSP last). Each per-VM emit is a `vm_progress` with `step=destroy`.

## Error taxonomy

`error.category` is one of ten stable identifiers the launchpad + all first-party plugins commit to:

| Category            | Meaning                                                             | Retryable |
|---------------------|---------------------------------------------------------------------|-----------|
| `auth`              | Credential missing, invalid, or lacks scope.                        | no        |
| `validation`        | Config or input malformed.                                          | no        |
| `not_found`         | Referenced entity doesn't exist.                                    | no        |
| `already_exists`    | Idempotent create failed because the entity is present.             | no        |
| `provider_unavailable` | Upstream provider (Tailscale, Hetzner, ...) is unreachable.      | yes       |
| `quota`             | Provider-side quota exhausted.                                      | no        |
| `timeout`           | Wait exceeded a policy deadline.                                    | yes       |
| `internal`          | Plugin/orchestrator bug, unexpected error path.                    | no        |
| `network`           | Local network / TLS / DNS.                                          | yes       |
| `cancelled`         | Ctrl-C or SIGTERM.                                                  | no        |

`error.code` is a plugin-namespaced identifier under the category (e.g. `qemu.image.sha256_mismatch`). Categories are stable; codes may be added.

## Consuming from bash

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

To gate a CI job on completion:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates > run.log
grep -q '"ev":"complete"' run.log || {
  jq -r 'select(.ev == "error") | "\(.error.category)/\(.error.code): \(.error.message)"' < run.log
  exit 1
}
```

## Version compatibility

- Field additions are non-breaking.
- Field removals bump the launchpad major version.
- `error.category` values are permanent. `ev` values are permanent.
- `error.code` values may be renamed within the same category (they're plugin-scoped).
