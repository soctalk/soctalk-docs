# Provider LLM

Il runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) supporta due provider, selezionabili tramite `SOCTALK_LLM_PROVIDER`:

- `anthropic` — tramite `langchain-anthropic` (modelli Claude)
- `openai` — tramite `langchain-openai` (OpenAI o qualsiasi endpoint compatibile con OpenAI che rispetti `Authorization: Bearer <key>` verso `POST /v1/chat/completions`: Azure OpenAI, vLLM, Ollama, LiteLLM, ecc.)

In V1, la variabile d'ambiente del provider (`SOCTALK_LLM_PROVIDER`) è **onorata solo dai pod runs-worker per-tenant**. Il pod API utilizza invece impostazioni predefinite del provider cablate nel codice. Il provider per-tenant è impostabile tramite `PATCH /api/mssp/tenants/{tenant_id}/llm` (vedi [Override per-tenant](#per-tenant-overrides)).

Un modello self-hosted e compatibile con OpenAI è un'opzione di prima classe, non un ripiego: punta il provider `openai` verso un server vLLM o SGLang che gestisci tu, un endpoint GPU serverless gestito, o un Ollama locale, tutto tramite `OPENAI_BASE_URL`. SocTalk classifica i backend per modello di erogazione, API gestita warm, GPU serverless scale-to-zero, GPU affittata always-on, o locale, e ciascuno ha un profilo di costo e latenza differente. Per sapere come scegliere, vedi [Contenere la spesa del triage AI](/it-it/guides/inference-cost-optimization) e [Quanto costa davvero l'inferenza di triage, misurato](/it-it/guides/inference-cost-benchmark).

## Cosa espone il chart

Il chart `soctalk-system` accetta impostazioni predefinite LLM valide per l'intera installazione che inizializzano la configurazione LLM per-tier di ogni tenant appena onboardato:

```yaml
defaults:
  llm:
    provider: openai-compatible          # SOCTALK_LLM_PROVIDER_DEFAULT
    baseUrl: https://api.openai.com/v1   # SOCTALK_LLM_BASE_URL_DEFAULT
    model: gpt-4o                        # SOCTALK_LLM_MODEL_DEFAULT
    fastTier: {}                         # optional cheaper router/supervisor tier; off until provider/baseUrl/model are set

llm:
  provider: openai               # provider whose API key the install ships with
  existingSecret: ""             # Secret with anthropic-api-key / openai-api-key keys
  apiKey: ""                     # inline alternative; creates ONE provider key only (not both), dev / lab use only
```

**Come le impostazioni predefinite prendono effetto:** le chiavi `defaults.llm.*` vengono lette all'onboarding del tenant e inizializzano la configurazione per-tier del nuovo tenant, così un tenant creato dopo averle impostate le eredita. I tenant esistenti mantengono la loro configurazione attuale finché non vengono patchati.

**Dove gira la configurazione risolta:** il Deployment `soctalk-runs-worker` per-tenant. Le sue variabili d'ambiente `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` e `OPENAI_BASE_URL` vengono renderizzate dal provisioning controller a partire dalla riga di configurazione del tenant, ed è questa la superficie che controlla quale provider e modello chiama ogni tier.

## Passare ad Anthropic

Per eseguire un tenant direttamente su Anthropic (senza alcun proxy compatibile con OpenAI intermedio), imposta il provider per-tenant tramite `PATCH /api/mssp/tenants/{id}/llm`:

```json
{ "provider": "anthropic" }
```

…e fornisci la chiave Anthropic tramite il flusso BYOK (`PUT /api/tenant/llm/api-key`). Il controller renderizza `SOCTALK_LLM_PROVIDER=anthropic` sul runs-worker di quel tenant, che utilizza `langchain-anthropic`.

Il valore `llm.provider: anthropic` del chart + `llm.existingSecret` (Secret con una chiave `anthropic-api-key`) inizializzano il Secret delle credenziali valido per l'intera installazione che il controller replica nei nuovi tenant — ma il valore del chart di per sé **non** imposta `SOCTALK_LLM_PROVIDER` da nessuna parte in V1; la selezione del provider è per-tenant.

## Chiavi API

Mai in `values.yaml`. Fornisci tramite `Secret/soctalk-system-llm-api-key`:

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Quando possibile fornisci entrambe le chiavi — il chart raggruppa entrambe le chiavi nel Secret indipendentemente dal provider attivo, così che cambiare provider in seguito (ad es., dev: openai → prod: anthropic) non richieda di ricreare il Secret.

## UI Impostazioni

[Impostazioni → LLM](/it-it/mssp-ui#settings) nella UI MSSP mostra il provider attivo, il modello, il base URL, la temperatura e i max token. I campi sono **in sola lettura in questa release** — il badge `Read-only` compare accanto al titolo. Le mutazioni non sono implementate; oggi i valori del chart + la selezione basata sulle variabili d'ambiente del runtime sono le fonti autorevoli.

Le chiavi API non vengono mai mostrate nella risposta delle impostazioni (solo il flag `present: bool`).

## Parametri solo-runtime (env, non chart)

Diversi parametri a runtime esistono come variabili d'ambiente ma non sono ancora esposti come valori del chart. Impostali direttamente sul Deployment `soctalk-system-api` (che in V1 è anche l'orchestratore) dopo l'installazione:

| Variabile d'ambiente | Effetto |
|---|---|
| `SOCTALK_LLM_PROVIDER` | `anthropic` o `openai`. Seleziona l'integrazione LangChain |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Chiavi del provider (alternativa al Secret raggruppato) |
| `OPENAI_BASE_URL` | Sovrascrive il base URL del client OpenAI (Azure, vLLM, Ollama, …) |
| `OPENAI_API_VERSION`, `OPENAI_API_TYPE` | Specifiche di Azure |
| `SOCTALK_FAST_MODEL` | Sovrascrive il modello veloce (default `claude-sonnet-4-20250514`) |
| `SOCTALK_REASONING_MODEL` | Sovrascrive il modello di reasoning (default `claude-sonnet-4-20250514`) |

Il chart antepone a queste le `defaults.llm.*` per le impostazioni predefinite valide per l'intera installazione; gli override per-tenant si applicano a runtime tramite le variabili d'ambiente del runs-worker del tenant.

## Override per-tenant

Provider LLM, modello e base URL per-tenant sono impostabili tramite `PATCH /api/mssp/tenants/{tenant_id}/llm` (vedi [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py)). La modifica viene persistita nel database e renderizzata nelle variabili d'ambiente del runs-worker del tenant al prossimo deployment; in pratica il runs-worker recepisce la modifica al successivo riavvio del pod (o al successivo `helm upgrade` del chart del tenant).

Il payload di onboarding del tenant può includere `llm_base_url` e `llm_model` per le impostazioni iniziali. I campi di override, riflessi a runtime come variabili d'ambiente sul runs-worker:

| Campo del tenant | Variabile d'ambiente sul runs-worker |
|---|---|
| `llm.provider` | `SOCTALK_LLM_PROVIDER` |
| `llm.base_url` | `OPENAI_BASE_URL` |
| `llm.fast_model` | `SOCTALK_FAST_MODEL` |
| `llm.reasoning_model` | `SOCTALK_REASONING_MODEL` |
| Chiave API | Secret `tenant-llm-key` nel namespace del tenant, montato tramite secretKeyRef. `IntegrationConfig.llm_api_key_plain` in Postgres è lo store autorevole; il provisioning controller materializza il Secret a partire da esso |

Motivi comuni per applicare un override per-tenant:

- Un cliente ad alto volume necessita di un pool di rate-limit / fascia di prezzo dedicati.
- Le regole di residenza dei dati di un cliente richiedono un endpoint specifico per regione.
- Un tenant di valutazione utilizza un modello più economico rispetto alla produzione.

Flusso di rotazione della chiave LLM per-tenant: vedi [Operazioni quotidiane → Ruotare la chiave LLM per-tenant](/it-it/operations#rotate-per-tenant-llm-key).

## Note sui costi

- Il runtime effettua molte piccole chiamate LLM per indagine (supervisor + worker + closure) e una grande chiamata di reasoning (verdetto). La separazione tra fast e reasoning è ora configurabile per tier: SocTalk risolve ogni ruolo, un tier router/supervisor più leggero e un tier verdetto/reasoning più forte, verso il proprio tier, ciascuno che punta al proprio provider, modello ed endpoint. Il parametro `defaults.llm.fastTier` nei valori del chart `soctalk-system` e il rendering per-tier nel livello di provisioning ti permettono di puntare il fast tier verso un modello economico mantenendo un modello più forte per il verdetto, così non baratti più la qualità del verdetto per abbassare il costo per chiamata. Il fast tier è disattivato di default (`fastTier: {}`); imposta il suo `provider`, `baseUrl` e `model` per abilitarlo. Inizializza la configurazione per-tier dei tenant appena onboardati, così i tenant esistenti mantengono la loro configurazione attuale finché non vengono patchati.
- L'utilizzo di token per-tenant è misurato tramite la metrica Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}` — vedi [Osservabilità](/it-it/observability#per-tenant-cost).
- Il self-hosting conviene solo se mantieni la GPU occupata. Il parametro `runsWorker.concurrency` (default `1`) imposta quante indagini un runs-worker elabora in parallelo; aumentalo per riempire un batch continuo self-hosted e ammortizzare una GPU always-on su più lavoro. Vedi [Contenere la spesa del triage AI](/it-it/guides/inference-cost-optimization) per come dimensionarlo rispetto a un dato backend.

## Test di sanità

In questa release non viene distribuita alcuna CLI di smoke-test dedicata. Il controllo più rapido consiste nell'onboarding di un tenant di prova e nell'esame dei log dell'orchestratore (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`) — la prima indagine farà emergere qualsiasi errore di configurazione del provider. Un comando di smoke-test scriptato è nella roadmap.

## Riferimenti al codice sorgente

| Concetto | File |
|---|---|
| Factory del provider | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Risoluzione delle impostazioni basata su env | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valori LLM del chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Risposta delle impostazioni | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
