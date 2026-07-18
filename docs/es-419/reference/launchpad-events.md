# Esquema de eventos de Launchpad

`launchpad up --headless` y `launchpad down --headless` emiten **un evento JSON por línea** a stdout. Esta es la superficie de automatización: haz aserciones sobre estos eventos desde CI, scripts o una TUI de control.

Todos los eventos comparten la misma forma de nivel superior. Solo se rellenan los campos relevantes para el tipo de evento.

```json
{
  "ev":       "<kind>",        // discriminador; ver más abajo
  "time":     "2026-07-02T16:05:14.089Z",
  "phase":    "<phase>",       // solo en ev=phase
  "vm_key":   "mssp",          // delimita eventos a nivel de VM
  "step":     "install",       // subfase dentro de una VM
  "percent":  60,              // 0-100
  "message":  "...",           // legible por humanos
  "level":    "info",          // para vm_log
  "gate_id":  "...",           // para gate_open / gate_resolved
  "instructions": "...",       // para gate_open
  "copy_text":    "...",       // para gate_open
  "ipv4":     "100.x.x.x",     // para vm_ready
  "ipv6":     "...",
  "ssh_user": "ops",
  "ssh_port": 22,
  "fields":   { "capabilities": ["vm.plan"] },  // formato libre; usado por plugin_ready
  "error":    { "category":"...", "code":"...", "message":"...", "hint":"..." }
}
```

## Tipos de evento

| `ev`             | Se emite cuando                                                                        | ¿Terminal? |
|------------------|---------------------------------------------------------------------------------------|-----------|
| `phase`          | El orquestador cambia de fase.                                                         | no        |
| `plugin_ready`   | El plugin de aprovisionamiento se ha lanzado + ha devuelto su handshake `hello`.       | no        |
| `vm_plan`        | Descripción en modo dry-run de lo que el plugin *crearía*, por VM.                     | no        |
| `vm_progress`    | Progreso por subpaso de cada VM (tiene `step` + `percent`).                            | no        |
| `vm_ready`       | El plugin ha creado + verificado la VM.                                                | no        |
| `vm_log`         | Línea de log del plugin (relay de progreso) o de un shell de instalación de launchpad. | no        |
| `gate_open`      | Se alcanzó una compuerta manual; requiere confirmación del operador.                   | no        |
| `gate_resolved`  | El operador (o `--auto-resolve-gates`) cerró la compuerta.                             | no        |
| `error`          | Error fatal. `error.category` + `error.code` son identificadores estables.             | **sí**    |
| `complete`       | Todo el flujo se ejecutó sin problemas.                                                | **sí**    |

`error` y `complete` son los dos eventos terminales. Cada ejecución de launchpad emite exactamente uno.

## Orden de fases (up)

```
initializing → planning → provisioning → installing → complete
```

Por cada VM dentro de `provisioning`, los pasos `lookup → prepare → image_cache|image_download → tailscale → cloud_init → disk → boot → wait_ready` se emiten como `vm_progress`. El paso `install` durante `installing` transmite la stdout del instalador subyacente como `vm_log`.

## Orden de fases (down)

```
tearing_down → torn_down → complete
```

`vm.destroy` se invoca por cada VM en orden inverso al de aprovisionamiento (los tenants primero, el MSSP al final). Cada emisión por VM es un `vm_progress` con `step=destroy`.

## Taxonomía de errores

`error.category` es uno de diez identificadores estables a los que se comprometen el launchpad + todos los plugins de primera parte:

| Categoría           | Significado                                                          | ¿Reintentable? |
|---------------------|---------------------------------------------------------------------|-----------|
| `auth`              | Credencial ausente, inválida o sin alcance suficiente.              | no        |
| `validation`        | Configuración o entrada mal formada.                                | no        |
| `not_found`         | La entidad referenciada no existe.                                  | no        |
| `already_exists`    | Una creación idempotente falló porque la entidad ya está presente.  | no        |
| `provider_unavailable` | El proveedor upstream (Tailscale, Hetzner, ...) es inalcanzable. | sí        |
| `quota`             | Cuota del lado del proveedor agotada.                               | no        |
| `timeout`           | La espera superó una fecha límite de política.                     | sí        |
| `internal`          | Bug del plugin/orquestador — ruta de error inesperada.             | no        |
| `network`           | Red local / TLS / DNS.                                              | sí        |
| `cancelled`         | Ctrl-C o SIGTERM.                                                   | no        |

`error.code` es un identificador con espacio de nombres del plugin dentro de la categoría (p. ej. `qemu.image.sha256_mismatch`). Las categorías son estables; se pueden añadir códigos.

## Consumo desde bash

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Para condicionar un job de CI a la finalización:

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates > run.log
grep -q '"ev":"complete"' run.log || {
  jq -r 'select(.ev == "error") | "\(.error.category)/\(.error.code): \(.error.message)"' < run.log
  exit 1
}
```

## Compatibilidad de versiones

- Las adiciones de campos no rompen la compatibilidad.
- Las eliminaciones de campos incrementan la versión mayor del launchpad.
- Los valores de `error.category` son permanentes. Los valores de `ev` son permanentes.
- Los valores de `error.code` pueden renombrarse dentro de la misma categoría (tienen alcance de plugin).
