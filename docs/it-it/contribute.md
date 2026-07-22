# Contribuisci

SocTalk è Apache 2.0. Le PR sono benvenute. Questa pagina descrive il ciclo di sviluppo e cosa aspettarti da una revisione.

## Ambiente di sviluppo

Avvia un cluster locale pronto per SocTalk:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk
./scripts/dev-up.sh           # cluster dependencies only
```

`scripts/dev-up.sh` crea un cluster k3d e installa i prerequisiti a livello di cluster:

- K3s con Flannel + kube-proxy disabilitati
- Cilium come CNI con applicazione delle NetworkPolicy
- cert-manager installato
- k3d local-path come StorageClass predefinita

**Non** compila le immagini di SocTalk, non installa il chart di SocTalk, non effettua l'onboarding dei tenant e non popola dati con dati di esempio, le bozze precedenti di questa pagina sostenevano il contrario. Esegui tu stesso i passaggi successivi. Sequenza tipica dopo `dev-up.sh`:

```bash
just build-api build-frontend  # api image embeds the orchestrator in V1
helm install soctalk-system charts/soctalk-system \
  -n soctalk-system --create-namespace \
  --set install.bootstrapAdmin.email=dev@example \
  --set install.bootstrapAdmin.password=devpassword12
# migrations + bootstrap admin run in the API pod's init command
# sign in at https://<your-ingress>/ with the credentials you set above
```

Per un ciclo interno più rapido (nessuna ricompilazione dell'immagine a ogni modifica), consulta i suggerimenti sull'iterazione più sotto.

## Scegli il tuo ciclo di iterazione

Secondo la convenzione del progetto, preferisci eseguire i servizi con `uvicorn` / `pnpm dev` rispetto al ciclo build-push-redeploy di k3d:

```bash
# API (embeds the orchestrator in V1)
cd src && uvicorn soctalk.core.api.app_v1:app --reload --port 8000

# Frontend
cd frontend && pnpm dev
```

Puntali al Postgres / Wazuh / Cortex del cluster k3d tramite `kubectl port-forward`. L'iterazione richiede secondi, non minuti.

## Struttura del repository

```text
src/                Python (control plane, AI pipeline, adapter, runs-worker)
frontend/           SvelteKit (MSSP + customer UI)
charts/             Helm charts (soctalk-system, soctalk-tenant, wazuh, linux-ep)
infra/packer/       VM image generation (see /downloads)
setup-wizard/       Go (first-boot setup wizard)
attack-simulator/   MITRE ATT&CK demo scripts
scripts/            Dev / e2e / seed scripts
alembic/            DB migrations
docker-compose*.yml Various dev composition files
justfile            Build / release recipes
```

Il sito della documentazione (questo sito) risiede in un repository separato, [`soctalk/soctalk-docs`](https://github.com/soctalk/soctalk-docs).

## Test

In questa release non esistono le ricette `just test` / `just test-rls` / `just e2e-l1-l2`: quella è la forma pianificata. Oggi esegui i test direttamente con pytest:

```bash
pytest tests/                          # full suite
pytest tests/v1/test_rls_isolation.py  # Postgres Row-Level Security suite
```

I test RLS non sono negoziabili, verificano l'isolamento dei dati cross-tenant promesso dal [Modello di sicurezza](/it-it/reference/security-model). La CI esegue l'intera suite pytest a ogni PR.

## Stile

- Python: ruff + black. Applicato dalla CI.
- TypeScript: ESLint + Prettier con la configurazione presente nel repository. Applicato dalla CI.
- Messaggi di commit: oggetto su singola riga, prefisso conventional commit (`feat:`, `fix:`, `chore:`, `ci:`, `chart:`, …). Nessun corpo richiesto.
- Nessun trailer co-authored-by / signed-off-by.

## Aspettative sulle PR

- **Test per la modifica.** I nuovi endpoint richiedono test API; i nuovi nodi del grafo richiedono test della macchina a stati; le modifiche ai chart richiedono snapshot dei template renderizzati.
- **Migrazione se hai toccato un modello.** Alembic la genera automaticamente; rivedi l'SQL generato per verificarne la correttezza prima del commit.
- **Aggiorna la documentazione** in [`soctalk-docs`](https://github.com/soctalk/soctalk-docs) se la modifica influisce su un comportamento documentato. Non siamo rigidi su questo per i refactoring puramente interni; lo siamo per tutto ciò che è rivolto all'utente.
- **PR piccole.** Le PR grandi con modifiche miste sono difficili da revisionare. Separa il refactoring dalla feature; separa la modifica ai chart dalla modifica al runtime.

## Revisionare il proprio lavoro

Prima di richiedere una revisione, esegui codex sulle tue modifiche:

```bash
codex review --uncommitted
```

Questo è lo stesso passaggio di revisione che eseguiamo al momento del rilascio. Individua i problemi evidenti prima che un revisore umano debba occuparsene.

## Rilascio

I rilasci vengono taggati da `main`. Oggi il flusso ha più passaggi manuali di quanto la ricetta pianificata `just release` lasci intendere:

1. Incrementa manualmente le versioni in `Chart.yaml` + `pyproject.toml`, effettua il commit, esegui il push.
2. Tagga il commit ed effettua il push del tag (`git tag v0.1.x && git push --tags`).
3. `just release`: esegue `just build-all push-all`. Questo **compila e pubblica solo le immagini dei container**; non tagga, non pubblica i chart e non crea una GitHub Release.
4. Il workflow GH `publish-images.yml` gestisce la pubblicazione delle immagini su ghcr.io quando viene attivato.
5. La pubblicazione dei chart su `ghcr.io/soctalk/charts/` viene oggi effettuata manualmente con `helm push`.
6. `gh release create` per creare la GitHub Release.
7. `build-packer-images.yml` (attivazione manuale) compila l'[immagine VM demo](/it-it/downloads) in tutti e cinque i formati e la allega alla GitHub Release.

Il consolidamento dei passaggi 1, 2, 5 e 6 nella ricetta `just release` è in roadmap.

## Divulgazione di vulnerabilità

Se hai trovato una vulnerabilità, **non aprire un issue pubblico.** Invia una email all'indirizzo indicato in SECURITY.md nella radice del repository. Rispondiamo entro due giorni lavorativi.

## Licenza

Apache 2.0. Inviando una PR accetti di rilasciare il tuo contributo con la stessa licenza.

## Riconoscimenti

Oggi il git log è il registro canonico dei contributori; un file dedicato CONTRIBUTORS.md / `just update-contributors` è pianificato.
