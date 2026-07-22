# Ollama (LLM local)

Execute a triagem por AI do SocTalk contra um modelo **local** com o [Ollama](https://ollama.com/), sem LLM na nuvem, sem custo por token, os dados permanecem na sua infraestrutura. O Ollama expõe uma API **compatível com OpenAI**, e o `runs-worker` por tenant do SocTalk (o componente que de fato chama o LLM) fala diretamente com ela.

Esta página é a configuração de ponta a ponta. Para o modelo geral de provedores, consulte [Provedores de LLM](/pt-br/integrate/llm-providers).

## Como isso se encaixa

O **`runs-worker`** por tenant é o cliente de LLM. Seu provedor/modelo/base-URL vêm da config do tenant e são renderizados no seu env:

```
SOCTALK_LLM_PROVIDER=openai            # openai-compatible maps to "openai"
OPENAI_BASE_URL=http://<host>:11434/v1 # your Ollama endpoint
SOCTALK_FAST_MODEL=qwen2.5:7b
SOCTALK_REASONING_MODEL=qwen2.5:7b
```

Portanto, configurar o Ollama são quatro valores: **provider** `openai-compatible`, **base URL** apontando para o Ollama, um **modelo** já baixado (pull), e uma **chave de API fictícia** (o Ollama a ignora, mas o segredo precisa ser não vazio).

## 1. Instalar o Ollama

Em um host que o cluster consiga alcançar (um nó, ou qualquer máquina na mesma rede):

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

Confirme que ele responde: `curl http://<host>:11434/api/version`.

## 2. Apontar um tenant para o Ollama

Por tenant, via API (ou o equivalente na sua automação):

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

Isso persiste o `IntegrationConfig` do tenant e enfileira um re-provisionamento, o controlador executa `helm upgrade` no chart do tenant, o `runs-worker` faz o roll com o env do Ollama, **e a NetworkPolicy de egress abre automaticamente a porta do Ollama** (veja as notas de alcançabilidade). Novas execuções de triagem vão para o Ollama.

Para tornar o Ollama o padrão para **todo** novo tenant, defina `defaults.llm` nos values do `soctalk-system` na instalação:

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

::: warning V1: a UI de Settings mostra o provedor errado
Nesta versão, o painel **Settings → LLM** da UI do MSSP reflete os padrões fixos (hard-coded) do *pod da API* (por exemplo, `gpt-4o`), e **não** a config real do tenant. A fonte autoritativa é o `IntegrationConfig` por tenant (`GET /api/mssp/tenants/{id}/llm`) e o env do `runs-worker`. Não confie na página de Settings para confirmar o Ollama.
:::

## 3. Checklist de alcançabilidade (as coisas que mordem)

- **Faça bind em `0.0.0.0`.** O Ollama escuta em `127.0.0.1` por padrão, os pods não conseguem alcançar isso. Defina `OLLAMA_HOST=0.0.0.0:11434` (passo 1).
- **Não use `localhost`/`127.0.0.1` na base URL.** Isso é o *pod*, não o host do Ollama. Use o IP roteável do host (ou execute o Ollama dentro do cluster como um Service). Os pods alcançam IPs de faixa privada (`10.0.0.0/8`, `172.16.0.0/12`) através das permissões de egress padrão.
- **Porta de egress.** A NetworkPolicy de egress do `runs-worker` do tenant abre a porta do LLM, **derivada da base URL** (então `:11434` para o Ollama, `:8000` para o vLLM, etc.). Isso é automático no chart `soctalk-tenant` **≥ 0.1.2**. Em charts mais antigos, a política permitia apenas `:443`: ou faça upgrade, ou libere a porta manualmente, ou coloque o Ollama atrás de um proxy reverso TLS na `:443`.
- **Chave de API fictícia.** Deixe-a vazia e o chart pula o Secret → o worker inicia sem `OPENAI_API_KEY` e dá erro. Use qualquer string não vazia.

## 4. Verificar

Confirme que o worker está conectado ao Ollama e que uma triagem real flui através dele:

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

Quando um alerta chega, a investigação é triada pelo modelo local, o **Agent Run / Token Spend** na investigação reflete os tokens gerados pelo Ollama:

![Investigação triada pelo Ollama](/screenshots/ollama-investigation.png)

## Escolhendo um modelo

O pipeline do SocTalk faz **tool-calling + vereditos em JSON estruturado**, então escolha um modelo instruct com suporte sólido a tools, `qwen2.5`, `llama3.1`, `mistral-nemo`. Modelos pequenos/antigos frequentemente falham na saída estruturada. O tier de raciocínio se beneficia mais de um modelo mais forte; você pode dividi-los com `fast_model` / `reasoning_model` (um roteador rápido pequeno + um modelo de veredito maior).

::: tip CPU é lento
Em CPU, um modelo de 7B roda a ~dezenas de tokens/seg, e uma única triagem faz várias chamadas de LLM, espere **minutos** por investigação. Use um host com GPU para uma latência utilizável, ou um modelo rápido menor.
:::
