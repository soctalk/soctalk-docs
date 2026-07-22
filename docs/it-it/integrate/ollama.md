# Ollama (LLM locale)

Esegui il triage AI di SocTalk contro un modello **locale** con [Ollama](https://ollama.com/), nessun LLM cloud, nessun costo per token, i dati restano sulla tua infrastruttura. Ollama espone un'API **compatibile con OpenAI**, e il `runs-worker` per-tenant di SocTalk (il componente che chiama effettivamente l'LLM) comunica direttamente con essa.

Questa pagina è la configurazione end-to-end. Per il modello generale dei provider vedi [Provider LLM](/it-it/integrate/llm-providers).

## Come si integra

Il **`runs-worker`** per-tenant è il client LLM. Il suo provider/modello/base-URL provengono dalla configurazione del tenant e vengono resi nel suo env:

```
SOCTALK_LLM_PROVIDER=openai            # openai-compatible maps to "openai"
OPENAI_BASE_URL=http://<host>:11434/v1 # your Ollama endpoint
SOCTALK_FAST_MODEL=qwen2.5:7b
SOCTALK_REASONING_MODEL=qwen2.5:7b
```

Quindi configurare Ollama significa quattro valori: **provider** `openai-compatible`, **base URL** che punta a Ollama, un **modello** scaricato e una **API key fittizia** (Ollama la ignora, ma il segreto non deve essere vuoto).

## 1. Installa Ollama

Su un host raggiungibile dal cluster (un nodo, o qualsiasi macchina sulla stessa rete):

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Bind to all interfaces so the tenant pods can reach it (default is 127.0.0.1 only)
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\n' \
  | sudo tee /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# Pull a tool-capable model (see "Choosing a model" below)
ollama pull qwen2.5:7b
```

Verifica che risponda: `curl http://<host>:11434/api/version`.

## 2. Punta un tenant verso Ollama

Per ogni tenant, tramite l'API (o l'equivalente nella tua automazione):

```bash
curl -X PATCH https://<your-mssp-host>/api/mssp/tenants/<tenant-id>/llm \
  -H 'Content-Type: application/json' -b <admin-session-cookie> \
  -d '{
        "provider": "openai-compatible",
        "base_url": "http://<host>:11434/v1",
        "model":    "qwen2.5:7b",
        "api_key":  "ollama"
      }'
```

Questo rende persistente l'`IntegrationConfig` del tenant e accoda un re-provisioning, il controller esegue `helm upgrade` sul chart del tenant, il `runs-worker` viene rilanciato con l'env di Ollama, **e la NetworkPolicy di egress apre automaticamente la porta di Ollama** (vedi le note sulla raggiungibilità). I nuovi triage vanno a Ollama.

Per rendere Ollama il default per **ogni** nuovo tenant, imposta `defaults.llm` nei valori di `soctalk-system` in fase di installazione:

```yaml
defaults:
  llm:
    provider: openai-compatible
    baseUrl: http://<host>:11434/v1
    model: qwen2.5:7b
llm:
  provider: openai
  apiKey: "ollama"
```

::: warning V1: la UI Settings mostra il provider sbagliato
In questa release il pannello **Settings → LLM** della UI MSSP riflette i default hard-coded del *pod API* (es. `gpt-4o`), **non** la configurazione effettiva del tenant. La sorgente autorevole è l'`IntegrationConfig` per-tenant (`GET /api/mssp/tenants/{id}/llm`) e l'env del `runs-worker`. Non fidarti della pagina Settings per confermare Ollama.
:::

## 3. Checklist di raggiungibilità (le cose che fanno male)

- **Bind su `0.0.0.0`.** Per impostazione predefinita Ollama ascolta su `127.0.0.1`: i pod non possono raggiungerlo. Imposta `OLLAMA_HOST=0.0.0.0:11434` (passo 1).
- **Non usare `localhost`/`127.0.0.1` nel base URL.** Quello è il *pod*, non l'host Ollama. Usa l'IP instradabile dell'host (oppure esegui Ollama in-cluster come Service). I pod raggiungono gli IP di range privato (`10.0.0.0/8`, `172.16.0.0/12`) attraverso gli allowance di egress predefiniti.
- **Porta di egress.** La NetworkPolicy di egress del `runs-worker` del tenant apre la porta LLM, **derivata dal base URL** (quindi `:11434` per Ollama, `:8000` per vLLM, ecc.). Questo è automatico sul chart `soctalk-tenant` **≥ 0.1.2**. Sui chart più vecchi la policy consentiva solo `:443`: puoi aggiornare, aprire la porta manualmente, o mettere davanti a Ollama un reverse proxy TLS su `:443`.
- **API key fittizia.** Se la lasci vuota il chart salta il Secret → il worker si avvia senza `OPENAI_API_KEY` e va in errore. Usa una qualsiasi stringa non vuota.

## 4. Verifica

Verifica che il worker sia collegato a Ollama e che un triage reale ci passi attraverso:

```bash
# 1. tenant config (authoritative)
curl -s https://<host>/api/mssp/tenants/<id>/llm   # provider/base_url/model = Ollama

# 2. worker env
kubectl -n tenant-<slug> get deploy soctalk-runs-worker \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -E 'LLM_PROVIDER|MODEL|OPENAI_BASE'

# 3. Ollama actually serving SocTalk
ollama ps                                   # model loaded while triaging
journalctl -u ollama | grep /v1/chat/completions   # 200s during a triage
```

Quando arriva un alert, l'indagine viene sottoposta a triage dal modello locale, l'**Agent Run / Token Spend** sull'indagine riflette i token generati da Ollama:

![Indagine sottoposta a triage da Ollama](/screenshots/ollama-investigation.png)

## Scegliere un modello

La pipeline di SocTalk esegue **tool-calling + verdetti JSON strutturati**, quindi scegli un modello instruct con solido supporto ai tool, `qwen2.5`, `llama3.1`, `mistral-nemo`. I modelli piccoli/datati spesso falliscono l'output strutturato. Il tier di reasoning trae il massimo beneficio da un modello più potente; puoi separarli con `fast_model` / `reasoning_model` (un piccolo router veloce + un modello di verdetto più grande).

::: tip La CPU è lenta
Su CPU, un modello 7B gira a ~decine di token/sec, e un singolo triage effettua diverse chiamate LLM, aspettati **minuti** per indagine. Usa un host con GPU per una latenza utilizzabile, o un modello veloce più piccolo.
:::
