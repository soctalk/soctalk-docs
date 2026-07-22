# Provedores de LLM

O runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) suporta dois provedores, selecionados via `SOCTALK_LLM_PROVIDER`:

- `anthropic`: via `langchain-anthropic` (modelos Claude)
- `openai`: via `langchain-openai` (OpenAI ou qualquer endpoint compatível com OpenAI que respeite `Authorization: Bearer <key>` em `POST /v1/chat/completions`: Azure OpenAI, vLLM, Ollama, LiteLLM, etc.)

No V1, a variável de ambiente do provedor (`SOCTALK_LLM_PROVIDER`) é **respeitada apenas pelos pods do runs-worker por tenant**. O próprio pod da API usa provedores padrão fixados no código. O provedor por tenant pode ser definido via `PATCH /api/mssp/tenants/{tenant_id}/llm` (veja [Substituições por tenant](#substituicoes-por-tenant)).

Um modelo auto-hospedado e compatível com OpenAI é uma opção de primeira classe, não um fallback: aponte o provedor `openai` para um servidor vLLM ou SGLang que você opera, um endpoint serverless de GPU gerenciado, ou um Ollama local, tudo via `OPENAI_BASE_URL`. O SocTalk classifica os backends por modelo de entrega, API gerenciada aquecida, serverless GPU com scale-to-zero, GPU alugada sempre ativa, ou local, e cada um tem um perfil de custo e latência diferente. Para saber como escolher, veja [Mantendo baixa a conta de triagem por AI](/pt-br/guides/inference-cost-optimization) e [Quanto a inferência de triagem realmente custa, medido](/pt-br/guides/inference-cost-benchmark).

## O que o chart expõe

O chart `soctalk-system` aceita padrões de LLM abrangentes para toda a instalação que semeiam a configuração de LLM por tier de cada novo tenant integrado:

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

**Como os padrões entram em vigor:** as chaves `defaults.llm.*` são lidas no onboarding do tenant e semeiam a configuração por tier do novo tenant, então um tenant criado depois de você defini-las as herda. Tenants existentes mantêm sua configuração atual até serem atualizados via patch.

**Onde a configuração resolvida roda:** o Deployment `soctalk-runs-worker` por tenant. Suas variáveis de ambiente `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` e `OPENAI_BASE_URL` são renderizadas pelo controlador de provisionamento a partir da linha de configuração do tenant, e essa é a superfície que controla qual provedor e modelo cada tier chama.

## Mudar para o Anthropic

Para executar um tenant diretamente contra o Anthropic (sem um proxy compatível com OpenAI no meio), defina o provedor por tenant via `PATCH /api/mssp/tenants/{id}/llm`:

```json
{ "provider": "anthropic" }
```

…e forneça a chave do Anthropic via o fluxo BYOK (`PUT /api/tenant/llm/api-key`). O controlador renderiza `SOCTALK_LLM_PROVIDER=anthropic` no runs-worker desse tenant, que usa `langchain-anthropic`.

O valor `llm.provider: anthropic` do chart + `llm.existingSecret` (Secret com uma chave `anthropic-api-key`) inicializam o Secret de credenciais abrangente da instalação que o controlador espelha para novos tenants, mas o valor do chart **não** define, por si só, `SOCTALK_LLM_PROVIDER` em lugar nenhum no V1; a seleção de provedor é por tenant.

## Chaves de API

Nunca em `values.yaml`. Forneça via `Secret/soctalk-system-llm-api-key`:

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Forneça ambas as chaves quando possível, o chart agrupa as duas chaves no Secret independentemente do provedor ativo, então trocar de provedor depois (por exemplo, dev: openai → prod: anthropic) não exige recriar o Secret.

## Interface de configurações

[Configurações → LLM](/pt-br/mssp-ui#settings) na interface MSSP mostra o provedor ativo, o modelo, a URL base, a temperatura e o máximo de tokens. Os campos são **somente leitura nesta versão**: o selo `Read-only` aparece ao lado do título. Mutações não estão implementadas; hoje os valores do chart + a seleção baseada em variáveis de ambiente do runtime são autoritativos.

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

- O runtime faz muitas chamadas pequenas de LLM por investigação (supervisor + workers + encerramento) e uma grande chamada de raciocínio (verdict). A divisão entre rápido e raciocínio agora é configurável por tier: o SocTalk resolve cada papel, um tier mais leve de router/supervisor e um tier mais forte de verdict/raciocínio, para seu próprio tier, cada um apontando para seu próprio provedor, modelo e endpoint. O ajuste `defaults.llm.fastTier` nos valores do chart `soctalk-system` e a renderização por tier na camada de provisionamento permitem apontar o tier rápido para um modelo barato mantendo um modelo mais forte para o verdict, então você não troca mais qualidade de verdict para reduzir o custo por chamada. O tier rápido vem desligado por padrão (`fastTier: {}`); defina seu `provider`, `baseUrl` e `model` para habilitá-lo. Ele semeia a configuração por tier de novos tenants integrados, então tenants existentes mantêm sua configuração atual até serem atualizados via patch.
- O uso de tokens por tenant é medido via a métrica Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}`: veja [Observabilidade](/pt-br/observability#per-tenant-cost).
- Auto-hospedar só compensa se você mantiver a GPU ocupada. O ajuste `runsWorker.concurrency` (padrão `1`) define quantas investigações um runs-worker processa em paralelo; aumente-o para preencher um batch contínuo auto-hospedado e amortizar uma GPU sempre ativa sobre mais trabalho. Veja [Mantendo baixa a conta de triagem por AI](/pt-br/guides/inference-cost-optimization) para saber como dimensioná-lo em relação a um dado backend.

## Teste de sanidade

Nenhuma CLI de smoke-test dedicada é entregue nesta versão. A verificação mais rápida é fazer o onboarding de um tenant de teste e observar os logs do orquestrador (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`), a primeira investigação revelará qualquer má configuração de provedor. Um comando de smoke-test em script está no roadmap.

## Ponteiros de código-fonte

| Conceito | Arquivo |
|---|---|
| Fábrica de provedores | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Resolução de configurações baseada em variáveis de ambiente | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valores de LLM do chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Resposta de configurações | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
