# Provedores de LLM

O runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) suporta dois provedores, selecionados via `SOCTALK_LLM_PROVIDER`:

- `anthropic` — via `langchain-anthropic` (modelos Claude)
- `openai` — via `langchain-openai` (OpenAI ou qualquer endpoint compatível com OpenAI que respeite `Authorization: Bearer <key>` em `POST /v1/chat/completions`: Azure OpenAI, vLLM, Ollama, LiteLLM, etc.)

No V1, a variável de ambiente do provedor (`SOCTALK_LLM_PROVIDER`) é **respeitada apenas pelos pods do runs-worker por tenant**. O próprio pod da API usa provedores padrão fixados no código. O provedor por tenant pode ser definido via `PATCH /api/mssp/tenants/{tenant_id}/llm` (veja [Substituições por tenant](#substituicoes-por-tenant)).

## O que o chart expõe

Atualmente o chart `soctalk-system` aceita três chaves de valores de LLM abrangentes para toda a instalação, mas a maioria delas **não** se reflete no comportamento em runtime no V1:

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

**Resumo do comportamento no V1:** o pod da API usa seus **próprios padrões fixados no código** para provedor/modelo/URL base. As variáveis de ambiente `*_DEFAULT` renderizadas pelo chart são estrutura para uma versão futura; hoje elas não são lidas.

**Onde a configuração de ambiente do LLM realmente entra em vigor:** o Deployment `soctalk-runs-worker` por tenant. Suas variáveis de ambiente `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` e `OPENAI_BASE_URL` são renderizadas pelo controlador de provisionamento a partir da linha `IntegrationConfig` do tenant. Essa é a superfície que efetivamente controla qual provedor é chamado.

## Mudar para o Anthropic

Para executar um tenant diretamente contra o Anthropic (sem um proxy compatível com OpenAI no meio), defina o provedor por tenant via `PATCH /api/mssp/tenants/{id}/llm`:

```json
{ "provider": "anthropic" }
```

…e forneça a chave do Anthropic via o fluxo BYOK (`PUT /api/tenant/llm/api-key`). O controlador renderiza `SOCTALK_LLM_PROVIDER=anthropic` no runs-worker desse tenant, que usa `langchain-anthropic`.

O valor `llm.provider: anthropic` do chart + `llm.existingSecret` (Secret com uma chave `anthropic-api-key`) inicializam o Secret de credenciais abrangente da instalação que o controlador espelha para novos tenants — mas o valor do chart **não** define, por si só, `SOCTALK_LLM_PROVIDER` em lugar nenhum no V1; a seleção de provedor é por tenant.

## Chaves de API

Nunca em `values.yaml`. Forneça via `Secret/soctalk-system-llm-api-key`:

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Forneça ambas as chaves quando possível — o chart agrupa as duas chaves no Secret independentemente do provedor ativo, então trocar de provedor depois (por exemplo, dev: openai → prod: anthropic) não exige recriar o Secret.

## Interface de configurações

[Configurações → LLM](/pt-br/mssp-ui#settings) na interface MSSP mostra o provedor ativo, o modelo, a URL base, a temperatura e o máximo de tokens. Os campos são **somente leitura nesta versão** — o selo `Read-only` aparece ao lado do título. Mutações não estão implementadas; hoje os valores do chart + a seleção baseada em variáveis de ambiente do runtime são autoritativos.

As chaves de API nunca são exibidas na resposta de configurações (apenas o sinalizador `present: bool`).

## Ajustes exclusivos de runtime (env, não chart)

Vários ajustes de runtime existem como variáveis de ambiente, mas ainda não estão expostos como valores do chart. Defina-os diretamente no Deployment `soctalk-system-api` (que também é o orquestrador no V1) após a instalação:

| Variável de ambiente | Efeito |
|---|---|
| `SOCTALK_LLM_PROVIDER` | `anthropic` ou `openai`. Seleciona a integração LangChain |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Chaves de provedor (alternativa ao Secret agrupado) |
| `OPENAI_BASE_URL` | Substitui a URL base do cliente OpenAI (Azure, vLLM, Ollama, …) |
| `OPENAI_API_VERSION`, `OPENAI_API_TYPE` | Específico do Azure |
| `SOCTALK_FAST_MODEL` | Substitui o modelo rápido (padrão `claude-sonnet-4-20250514`) |
| `SOCTALK_REASONING_MODEL` | Substitui o modelo de raciocínio (padrão `claude-sonnet-4-20250514`) |

O chart antecede esses valores com `defaults.llm.*` para os padrões abrangentes da instalação; as substituições por tenant se aplicam em runtime via as variáveis de ambiente do runs-worker do tenant.

## Substituições por tenant

O provedor de LLM, o modelo e a URL base por tenant podem ser definidos via `PATCH /api/mssp/tenants/{tenant_id}/llm` (veja [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py)). A mudança é persistida no banco de dados e renderizada nas variáveis de ambiente do runs-worker do tenant no próximo deployment; na prática, o runs-worker adota a mudança no próximo reinício de pod (ou no próximo `helm upgrade` do chart do tenant).

O payload de onboarding do tenant pode incluir `llm_base_url` e `llm_model` para as configurações iniciais. Os campos de substituição, espelhados em runtime como variáveis de ambiente no runs-worker:

| Campo do tenant | Variável de ambiente no runs-worker |
|---|---|
| `llm.provider` | `SOCTALK_LLM_PROVIDER` |
| `llm.base_url` | `OPENAI_BASE_URL` |
| `llm.fast_model` | `SOCTALK_FAST_MODEL` |
| `llm.reasoning_model` | `SOCTALK_REASONING_MODEL` |
| Chave de API | Secret `tenant-llm-key` no namespace do tenant, montado por secretKeyRef. `IntegrationConfig.llm_api_key_plain` no Postgres é o armazenamento autoritativo; o controlador de provisionamento materializa o Secret a partir dele |

Motivos comuns para substituir por tenant:

- Um cliente de alto volume precisa de um pool de rate-limit / camada de preços dedicado.
- As regras de residência de dados de um cliente exigem um endpoint específico de região.
- Um tenant de avaliação usa um modelo mais barato que o de produção.

Fluxo de rotação de LLM por tenant: veja [Operações diárias → Rotacionar chave de LLM por tenant](/pt-br/operations#rotate-per-tenant-llm-key).

## Notas sobre custo

- O runtime faz muitas chamadas pequenas de LLM por investigação (supervisor + workers + encerramento) e uma grande chamada de raciocínio (veredito). Escolher um modelo barato para `defaults.llm.model` reduz o custo drasticamente, mas atualmente também degrada a qualidade do veredito — o chart ainda não separa o modelo rápido do modelo de raciocínio. Uma mudança planejada separa os dois.
- O uso de tokens por tenant é medido via a métrica Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}` — veja [Observabilidade](/pt-br/observability#per-tenant-cost).

## Teste de sanidade

Nenhuma CLI de smoke-test dedicada é entregue nesta versão. A verificação mais rápida é fazer o onboarding de um tenant de teste e observar os logs do orquestrador (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`) — a primeira investigação revelará qualquer má configuração de provedor. Um comando de smoke-test em script está no roadmap.

## Ponteiros de código-fonte

| Conceito | Arquivo |
|---|---|
| Fábrica de provedores | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Resolução de configurações baseada em variáveis de ambiente | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valores de LLM do chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Resposta de configurações | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
