# Provider LLM

Il runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) supporta due provider, selezionabili tramite `SOCTALK_LLM_PROVIDER`:

- `anthropic` — tramite `langchain-anthropic` (modelli Claude)
- `openai` — tramite `langchain-openai` (OpenAI o qualsiasi endpoint compatibile con OpenAI che rispetti `Authorization: Bearer <key>` verso `POST /v1/chat/completions`: Azure OpenAI, vLLM, Ollama, LiteLLM, ecc.)

In V1, la variabile d'ambiente del provider (`SOCTALK_LLM_PROVIDER`) è **onorata solo dai pod runs-worker per-tenant**. Il pod API utilizza invece impostazioni predefinite del provider cablate nel codice. Il provider per-tenant è impostabile tramite `PATCH /api/mssp/tenants/{tenant_id}/llm` (vedi [Override per-tenant](#per-tenant-overrides)).

## Cosa espone il chart

Attualmente il chart `soctalk-system` accetta tre chiavi di valore LLM valide per l'intera installazione, ma la maggior parte di esse **non** si propaga al comportamento a runtime in V1:

```yaml
defaults:
  llm:
    provider: openai-compatible   # rendered as SOCTALK_LLM_PROVIDER_DEFAULT on API pod, but V1 API IGNORES this env
    baseUrl: https://api.openai.com/v1   # rendered as SOCTALK_LLM_BASE_URL_DEFAULT, also IGNORED by V1 API
    model: gpt-4o                  # rendered as SOCTALK_LLM_MODEL_DEFAULT, also IGNORED by V1 API

llm:
  provider: openai               # NOT propagated to SOCTALK_LLM_PROVIDER on the API by V1 chart
  existingSecret: ""             # Secret with anthropic-api-key / openai-api-key keys
  apiKey: ""                     # inline alternative; creates ONE provider key only (not both) — dev / lab use only
```

**Riepilogo del comportamento V1:** il pod API utilizza le **proprie impostazioni predefinite cablate nel codice** per provider/modello/base URL. Le variabili d'ambiente `*_DEFAULT` renderizzate dal chart sono impalcatura per una release futura; oggi non vengono lette.

**Dove il cablaggio delle variabili d'ambiente LLM ha effettivamente effetto:** il Deployment `soctalk-runs-worker` per-tenant. Le sue variabili d'ambiente `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` e `OPENAI_BASE_URL` vengono renderizzate dal provisioning controller a partire dalla riga `IntegrationConfig` del tenant. È questa la superficie che controlla effettivamente quale provider viene chiamato.

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

- Il runtime effettua molte piccole chiamate LLM per indagine (supervisor + worker + closure) e una grande chiamata di reasoning (verdetto). Scegliere un modello economico per `defaults.llm.model` riduce drasticamente i costi ma attualmente degrada anche la qualità del verdetto — il chart non separa ancora il modello veloce da quello di reasoning. Una modifica pianificata separa i due.
- L'utilizzo di token per-tenant è misurato tramite la metrica Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}` — vedi [Osservabilità](/it-it/observability#per-tenant-cost).

## Test di sanità

In questa release non viene distribuita alcuna CLI di smoke-test dedicata. Il controllo più rapido consiste nell'onboarding di un tenant di prova e nell'esame dei log dell'orchestratore (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`) — la prima indagine farà emergere qualsiasi errore di configurazione del provider. Un comando di smoke-test scriptato è nella roadmap.

## Riferimenti al codice sorgente

| Concetto | File |
|---|---|
| Factory del provider | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Risoluzione delle impostazioni basata su env | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valori LLM del chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Risposta delle impostazioni | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
