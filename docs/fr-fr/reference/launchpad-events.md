# Schéma d'événements Launchpad

`launchpad up --headless` et `launchpad down --headless` diffusent **un événement JSON par ligne** vers stdout. C'est la surface d'automatisation : effectuez vos assertions sur ces événements depuis la CI, des scripts ou une TUI de pilotage.

Tous les événements partagent la même forme de premier niveau. Seuls les champs pertinents pour le type d'événement sont renseignés.

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

## Types d'événements

| `ev`             | Émis lorsque                                                                            | Terminal ? |
|------------------|---------------------------------------------------------------------------------------|-----------|
| `phase`          | L'orchestrateur change de phase.                                                       | non       |
| `plugin_ready`   | Le plugin de provisioning s'est lancé et a renvoyé sa poignée de main `hello`.         | non       |
| `vm_plan`        | Description en dry-run de ce que le plugin *créerait*, par VM.                         | non       |
| `vm_progress`    | Progression des sous-étapes par VM (comporte `step` + `percent`).                      | non       |
| `vm_ready`       | Le plugin a créé et vérifié la VM.                                                     | non       |
| `vm_log`         | Ligne de journal provenant soit du plugin (relais de progression), soit d'un shell d'installation piloté par launchpad. | non       |
| `gate_open`      | Un point de contrôle manuel est atteint ; nécessite une confirmation de l'opérateur.  | non       |
| `gate_resolved`  | L'opérateur (ou `--auto-resolve-gates`) a fermé le point de contrôle.                  | non       |
| `error`          | Erreur fatale. `error.category` + `error.code` sont des identifiants stables.          | **oui**   |
| `complete`       | L'ensemble du flux s'est déroulé sans erreur.                                          | **oui**   |

`error` et `complete` sont les deux événements terminaux. Chaque exécution de launchpad en émet exactement un.

## Ordre des phases (up)

```
initializing → planning → provisioning → installing → complete
```

Par VM au sein de `provisioning`, les étapes `lookup → prepare → image_cache|image_download → tailscale → cloud_init → disk → boot → wait_ready` sont émises en tant que `vm_progress`. L'étape `install` pendant `installing` diffuse la sortie stdout de l'installateur sous-jacent en tant que `vm_log`.

## Ordre des phases (down)

```
tearing_down → torn_down → complete
```

`vm.destroy` est appelé par VM dans l'ordre inverse du provisioning (tenants d'abord, MSSP en dernier). Chaque émission par VM est un `vm_progress` avec `step=destroy`.

## Taxonomie des erreurs

`error.category` prend l'une des dix valeurs d'identifiants stables auxquelles le launchpad et tous les plugins first-party s'engagent :

| Catégorie           | Signification                                                       | Réessayable |
|---------------------|---------------------------------------------------------------------|-----------|
| `auth`              | Identifiant manquant, invalide ou dépourvu de la portée requise.    | non       |
| `validation`        | Configuration ou entrée mal formée.                                 | non       |
| `not_found`         | L'entité référencée n'existe pas.                                   | non       |
| `already_exists`    | La création idempotente a échoué car l'entité est déjà présente.    | non       |
| `provider_unavailable` | Le fournisseur en amont (Tailscale, Hetzner, ...) est injoignable. | oui       |
| `quota`             | Quota épuisé côté fournisseur.                                      | non       |
| `timeout`           | L'attente a dépassé un délai limite défini par la politique.        | oui       |
| `internal`          | Bug du plugin/orchestrateur — chemin d'erreur inattendu.            | non       |
| `network`           | Réseau local / TLS / DNS.                                           | oui       |
| `cancelled`         | Ctrl-C ou SIGTERM.                                                  | non       |

`error.code` est un identifiant préfixé par l'espace de noms du plugin, sous la catégorie (p. ex. `qemu.image.sha256_mismatch`). Les catégories sont stables ; des codes peuvent être ajoutés.

## Consommation depuis bash

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates | \
  jq -c 'select(.ev == "phase" or .ev == "error" or .ev == "complete")'
```

Pour conditionner une tâche CI à la complétion :

```bash
launchpad up --config pilot.yaml --headless --auto-resolve-gates > run.log
grep -q '"ev":"complete"' run.log || {
  jq -r 'select(.ev == "error") | "\(.error.category)/\(.error.code): \(.error.message)"' < run.log
  exit 1
}
```

## Compatibilité des versions

- Les ajouts de champs sont non cassants.
- Les suppressions de champs incrémentent la version majeure du launchpad.
- Les valeurs de `error.category` sont permanentes. Les valeurs de `ev` sont permanentes.
- Les valeurs de `error.code` peuvent être renommées au sein d'une même catégorie (elles sont propres au plugin).
