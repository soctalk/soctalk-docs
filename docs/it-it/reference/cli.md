# CLI e script

Gli operatori svolgono la maggior parte delle attività tramite la [MSSP UI](/it-it/mssp-ui) o la [REST API](/it-it/reference/api). La superficie della CLI è ridotta ed esiste per il bootstrap, gli ambienti di sviluppo e le operazioni offline.

## Entry point in-pod

Questi vengono eseguiti all'interno di `soctalk-system-api` (o di un Job una tantum). Utilizzano le credenziali Postgres montate nel pod e la configurazione del chart, senza stato esterno.

### Bootstrap

In questa release non esiste una CLI di bootstrap separata: il comando di init del pod API del chart esegue il bootstrap in linea (migrazioni, password dei ruoli, riga dell'organizzazione, utente admin opzionale). Vedi [Installazione — Migrazioni e bootstrap](/it-it/install#migrations-and-bootstrap-run-automatically).

### Smoke test dell'LLM

In questa release non esiste una CLI `soctalk.llm.smoke_test`. Per verificare che un LLM configurato sia raggiungibile, vedi [Provider LLM — Test di sanità](/it-it/integrate/llm-providers#sanity-test) per l'espressione Python in una riga.

### `soctalk-auth` (helper in-pod)

L'unico helper CLI di prima classe in questa release. Sottocomando singolo: `set-password`.

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password user@example.com
```

Richiede una nuova password (o la legge da `SOCTALK_PASSWORD`), cerca l'utente, imposta la password con hash e registra l'audit `auth.password.reset.admin`. Utile per reset forzati senza passare per l'API. La riga dell'utente deve già esistere; `soctalk-auth` non crea righe.

### `soctalk` (entry point dell'orchestratore)

`soctalk` è l'entry point dell'orchestratore: esegue il supervisor LangGraph + i worker. In V1 il pod API incorpora l'orchestratore (nessuna Deployment `soctalk-system-orchestrator` separata). Normalmente non viene invocato a mano al di fuori dello sviluppo.

### Nessun `soctalk-cli` generico ancora

La bozza precedente di questa pagina elencava comandi di gestione dei tenant sotto un binario `soctalk-cli` che non esiste nella release attuale. Le azioni sui tenant (suspend, resume, decommission, rotate-admin) oggi passano attraverso la [REST API](/it-it/reference/api). La superficie CLI per le operazioni sui tenant è pianificata per una release futura.

## Lato repo: ricette del `justfile`

Il [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) nella root del repo contiene ricette usate durante lo sviluppo e il rilascio:

| Ricetta | Cosa fa |
|---|---|
| `just build-api` | Compila l'immagine container dell'API |
| `just build-orchestrator` | Compila l'immagine container dell'orchestratore |
| `just build-frontend` | Compila l'immagine container del frontend SvelteKit |
| `just build-mock-endpoint` | Compila l'immagine del simulatore di endpoint mock |
| `just run` | Esegue lo stack di sviluppo tramite docker-compose |
| `just push-all` | Effettua il push di tutte le immagini nel registry configurato |
| `just release` | Compila ed effettua il push di tutte le immagini (`build-all` + `push-all`). La pubblicazione versionata del chart, il tag git e la GitHub Release vengono prodotti separatamente dalla GitHub Action **Cut k8s Release**, non da questa ricetta. |

## Lato repo: `scripts/`

| Script | Scopo |
|---|---|
| `scripts/dev-up.sh` | Avvia un cluster di sviluppo k3d a nodo singolo con SocTalk e un tenant preconfigurato |
| `scripts/local-up.sh` | Uguale, ma sul k3s dell'host anziché su k3d |
| `scripts/local-down.sh` | Smantella un cluster creato con `local-up.sh` |
| `scripts/e2e-l1-l2-k3d.sh` | Configurazione k3d a due cluster (MSSP L1 + tenant L2) per la validazione e2e completa |
| `scripts/seed-mssp-demo-data.py` | Popola Postgres con tenant di fixture (`acme-corp`, `wayne-industries`, `stark-defense`) e riproduce gli Alert Wazuh tramite l'indexer per la preparazione degli screenshot |
| `scripts/dump_openapi.py` | Esporta lo schema OpenAPI di FastAPI in JSON; la fonte autorevole da cui viene generato il riferimento REST API della documentazione |
| `scripts/verify-pages-visual.py` | Controllo di regressione visiva con Playwright sulla UI di sviluppo di SocTalk |

Tutti questi presuppongono l'esecuzione dalla root del repo. Leggi l'intestazione dello script per gli argomenti esatti.

## Lato repo: Packer

Per le build delle immagini VM, vedi [Download → Compilala da solo](/it-it/downloads#build-it-yourself).

## Operazioni air-gapped

Per installazioni senza accesso a internet, l'API + `soctalk-auth` sono sufficienti per eseguire SocTalk senza toccare la UI:

```bash
# Il bootstrap avviene automaticamente nel comando di init del pod API — nessuno
# step extra. Basta installare il chart con install.bootstrapAdmin.* impostato.

# Oppure, se questi non sono stati forniti, imposta la password admin dopo l'installazione:
kubectl -n soctalk-system exec deploy/soctalk-system-api -- \
  soctalk-auth set-password admin@example
# Leggi le credenziali admin.
kubectl -n soctalk-system get secret soctalk-system-bootstrap-admin \
  -o jsonpath='{.data.password}' | base64 -d; echo

# Effettua l'onboarding di un tenant tramite l'API.
curl -k -c jar -X POST http://soctalk-system-api:8000/api/auth/login \
  -d '{"email":"admin@example","password":"..."}'
curl -k -b jar -X POST http://soctalk-system-api:8000/api/mssp/tenants/onboard \
  -d '{"slug":"acme","display_name":"Acme","profile":"persistent"}'
```

Per la password esistente dell'admin di bootstrap emessa dal Job di bootstrap, vedi [Installazione → Migrazioni e bootstrap](/it-it/install#migrations-and-bootstrap-run-automatically).

## Riferimenti al codice sorgente

| Concetto | File |
|---|---|
| Bootstrap (in linea) | [`charts/soctalk-system/templates/30-api.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/30-api.yaml) (comando di init) |
| Factory del provider LLM | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Sorgente di `soctalk-auth` | [`src/soctalk/core/cli/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/cli/auth.py) |
| Entry dell'orchestratore `soctalk` | [`src/soctalk/main.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/main.py) |
| `justfile` | [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) |
| `scripts/` | [`scripts/`](https://github.com/soctalk/soctalk/tree/main/scripts) |
