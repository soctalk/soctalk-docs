# CLI und Skripte

Betreiber erledigen die meisten Aufgaben über die [MSSP-UI](/de-de/mssp-ui) oder die [REST API](/de-de/reference/api). Die CLI-Oberfläche ist klein und existiert für Bootstrap, Entwicklungsumgebungen und Offline-Betrieb.

## In-Pod-Einstiegspunkte

Diese laufen innerhalb von `soctalk-system-api` (oder einem einmaligen Job). Sie verwenden die im Pod eingebundenen Postgres-Zugangsdaten und die Chart-Konfiguration, kein externer Zustand.

### Bootstrap

In diesem Release gibt es keine separate Bootstrap-CLI, der Init-Befehl des API-Pods des Charts führt den Bootstrap inline aus (Migrationen, Rollen-Passwörter, Organisationszeile, optionaler Admin-Benutzer). Siehe [Installation, Migrationen und Bootstrap](/de-de/install#migrations-and-bootstrap-run-automatically).

### LLM-Smoke-Test

In diesem Release gibt es keine `soctalk.llm.smoke_test`-CLI. Um zu überprüfen, ob ein konfiguriertes LLM erreichbar ist, siehe [LLM-Anbieter, Sanity-Test](/de-de/integrate/llm-providers#sanity-test) für den einzeiligen Python-Ausdruck.

### `soctalk-auth` (In-Pod-Helfer)

Der einzige erstklassige CLI-Helfer in diesem Release. Einzelner Unterbefehl: `set-password`.

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password user@example.com
```

Fordert ein neues Passwort an (oder liest es aus `SOCTALK_PASSWORD`), sucht den Benutzer, setzt das gehashte Passwort und protokolliert `auth.password.reset.admin`. Nützlich für erzwungene Zurücksetzungen ohne den Umweg über die API. Die Benutzerzeile muss bereits existieren; `soctalk-auth` erstellt keine Zeilen.

### `soctalk` (Orchestrator-Einstiegspunkt)

`soctalk` ist der Orchestrator-Einstiegspunkt, er führt den LangGraph-Supervisor + Worker aus. In V1 bettet der API-Pod den Orchestrator ein (kein separates `soctalk-system-orchestrator`-Deployment). Wird außerhalb der Entwicklung normalerweise nicht von Hand aufgerufen.

### Noch keine universelle `soctalk-cli`

Der frühere Entwurf dieser Seite listete Mandanten-Verwaltungsbefehle unter einer `soctalk-cli`-Binärdatei auf, die im aktuellen Release nicht existiert. Mandanten-Aktionen (suspend, resume, decommission, rotate-admin) laufen heute über die [REST API](/de-de/reference/api). Die CLI-Oberfläche für Mandanten-Operationen ist für ein zukünftiges Release vorgemerkt.

## Repo-seitig: `justfile`-Rezepte

Die [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) im Repo-Root enthält Rezepte, die während Entwicklung und Release verwendet werden:

| Rezept | Was es tut |
|---|---|
| `just build-api` | Baut das API-Container-Image |
| `just build-orchestrator` | Baut das Orchestrator-Container-Image |
| `just build-frontend` | Baut das SvelteKit-Frontend-Container-Image |
| `just build-mock-endpoint` | Baut das Mock-Endpoint-Sim-Image |
| `just run` | Führt den Dev-Stack via docker-compose aus |
| `just push-all` | Pusht alle Images in die konfigurierte Registry |
| `just release` | Baut und pusht alle Images (`build-all` + `push-all`). Die versionierte Chart-Veröffentlichung, das Git-Tag und das GitHub Release werden separat von der GitHub Action **Cut k8s Release** erstellt, nicht von diesem Rezept. |

## Repo-seitig: `scripts/`

| Skript | Zweck |
|---|---|
| `scripts/dev-up.sh` | Bringt einen Single-Node-k3d-Dev-Cluster mit SocTalk und einem vorbefüllten Mandanten hoch |
| `scripts/local-up.sh` | Dasselbe, aber auf dem k3s des Hosts anstelle von k3d |
| `scripts/local-down.sh` | Fährt einen `local-up.sh`-Cluster herunter |
| `scripts/e2e-l1-l2-k3d.sh` | Zwei-Cluster-k3d-Setup (MSSP L1 + Mandant L2) für die vollständige e2e-Validierung |
| `scripts/seed-mssp-demo-data.py` | Befüllt Postgres mit Fixture-Mandanten (`acme-corp`, `wayne-industries`, `stark-defense`) und spielt Wazuh-Warnungen über den Indexer erneut ein, zur Vorbereitung von Screenshots |
| `scripts/dump_openapi.py` | Gibt das FastAPI-OpenAPI-Schema als JSON aus; die Source of Truth, aus der die REST-API-Referenz der Docs generiert wird |
| `scripts/verify-pages-visual.py` | Playwright-Prüfung auf visuelle Regressionen gegen die Dev-SocTalk-UI |

Diese erwarten alle, dass sie vom Repo-Root aus ausgeführt werden. Lies den Skript-Header für die genauen Argumente.

## Repo-seitig: Packer

Für VM-Image-Builds siehe [Downloads → Selbst bauen](/de-de/downloads#build-it-yourself).

## Air-Gapped-Betrieb

Für Installationen ohne Internetzugang reichen die API + `soctalk-auth` aus, um SocTalk ohne Berührung der UI zu betreiben:

```bash
# Bootstrap happens automatically in the API pod's init command — no
# extra step. Just install the chart with install.bootstrapAdmin.* set.

# Or, if those weren't supplied, set the admin password after install:
kubectl -n soctalk-system exec deploy/soctalk-system-api -- \
  soctalk-auth set-password admin@example
# Read the admin credentials.
kubectl -n soctalk-system get secret soctalk-system-bootstrap-admin \
  -o jsonpath='{.data.password}' | base64 -d; echo

# Onboard a tenant via the API.
curl -k -c jar -X POST http://soctalk-system-api:8000/api/auth/login \
  -d '{"email":"admin@example","password":"..."}'
curl -k -b jar -X POST http://soctalk-system-api:8000/api/mssp/tenants/onboard \
  -d '{"slug":"acme","display_name":"Acme","profile":"persistent"}'
```

Das vorhandene Passwort des Bootstrap-Admins, das der Bootstrap-Job ausgibt, findest du unter [Installation → Migrationen und Bootstrap](/de-de/install#migrations-and-bootstrap-run-automatically).

## Quell-Verweise

| Konzept | Datei |
|---|---|
| Bootstrap (inline) | [`charts/soctalk-system/templates/30-api.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/30-api.yaml) (Init-Befehl) |
| LLM-Anbieter-Factory | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| `soctalk-auth`-Quelle | [`src/soctalk/core/cli/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/cli/auth.py) |
| `soctalk`-Orchestrator-Einstieg | [`src/soctalk/main.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/main.py) |
| `justfile` | [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) |
| `scripts/` | [`scripts/`](https://github.com/soctalk/soctalk/tree/main/scripts) |
