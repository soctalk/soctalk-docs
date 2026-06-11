# LLM providers

The runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) supports two providers, picked via `SOCTALK_LLM_PROVIDER`:

- `anthropic` — via `langchain-anthropic` (Claude models)
- `openai` — via `langchain-openai` (OpenAI or any OpenAI-compatible endpoint that honours `Authorization: Bearer <key>` against `POST /v1/chat/completions`: Azure OpenAI, vLLM, Ollama, LiteLLM, etc.)

In V1, the provider env var (`SOCTALK_LLM_PROVIDER`) is **only honoured by the per-tenant runs-worker** pods. The API pod itself uses hard-coded provider defaults. Per-tenant provider is settable via `PATCH /api/mssp/tenants/{tenant_id}/llm` (see [Per-tenant overrides](#per-tenant-overrides)).

## What the chart exposes

Today the `soctalk-system` chart accepts three install-wide LLM value keys, but most of them do **not** flow through to runtime behavior in V1:

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

**V1 behavior summary:** the API pod uses its **own hard-coded defaults** for provider/model/base URL. The chart-rendered `*_DEFAULT` envs are scaffolding for a future release; today they go unread.

**Where the LLM env wiring actually takes effect:** the per-tenant `soctalk-runs-worker` Deployment. Its `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL`, and `OPENAI_BASE_URL` env vars are rendered by the provisioning controller from the tenant's `IntegrationConfig` row. That's the surface that actually controls which provider gets called.

## Switch to Anthropic

To run a tenant against Anthropic directly (no OpenAI-compatible proxy in between), set the per-tenant provider via `PATCH /api/mssp/tenants/{id}/llm`:

```json
{ "provider": "anthropic" }
```

…and supply the Anthropic key via the BYOK flow (`PUT /api/tenant/llm/api-key`). The controller renders `SOCTALK_LLM_PROVIDER=anthropic` onto that tenant's runs-worker, which uses `langchain-anthropic`.

The chart's `llm.provider: anthropic` value + `llm.existingSecret` (Secret with an `anthropic-api-key` key) seed the install-wide credential Secret that the controller mirrors into new tenants — but the chart value does **not** itself set `SOCTALK_LLM_PROVIDER` anywhere in V1; provider selection is per-tenant.

## API keys

Never in `values.yaml`. Provide via `Secret/soctalk-system-llm-api-key`:

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Provide both keys when possible — the chart bundles both keys into the Secret regardless of the active provider, so swapping providers later (e.g., dev: openai → prod: anthropic) doesn't require re-creating the Secret.

## Settings UI

[Settings → LLM](/mssp-ui#settings) in the MSSP UI shows the active provider, model, base URL, temperature, and max tokens. The fields are **read-only in this release** — the `Read-only` badge appears next to the title. Mutations are not implemented; today the chart values + the runtime's env-based selection are authoritative.

API keys are never shown in the settings response (only the `present: bool` flag).

## Runtime-only knobs (env, not chart)

Several runtime knobs exist as environment variables but are not yet exposed as chart values. Set them directly on the `soctalk-system-api` Deployment (which is also the orchestrator in V1) after install:

| Env var | Effect |
|---|---|
| `SOCTALK_LLM_PROVIDER` | `anthropic` or `openai`. Picks the LangChain integration |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider keys (alternative to the bundled Secret) |
| `OPENAI_BASE_URL` | Override the OpenAI client base URL (Azure, vLLM, Ollama, …) |
| `OPENAI_API_VERSION`, `OPENAI_API_TYPE` | Azure-specific |
| `SOCTALK_FAST_MODEL` | Override the fast model (default `claude-sonnet-4-20250514`) |
| `SOCTALK_REASONING_MODEL` | Override the reasoning model (default `claude-sonnet-4-20250514`) |

The chart fronts these with `defaults.llm.*` for the install-wide defaults; per-tenant overrides apply at runtime via the tenant's runs-worker env.

## Per-tenant overrides

Per-tenant LLM provider, model, and base URL are settable via `PATCH /api/mssp/tenants/{tenant_id}/llm` (see [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py)). The change is persisted in the database and rendered into the tenant runs-worker's env on the next deployment; in practice the runs-worker picks up the change on the next pod restart (or the next `helm upgrade` of the tenant chart).

Tenant onboard payload may include `llm_base_url` and `llm_model` for the initial settings. The override fields, mirrored at runtime as env on the runs-worker:

| Tenant field | Env on runs-worker |
|---|---|
| `llm.provider` | `SOCTALK_LLM_PROVIDER` |
| `llm.base_url` | `OPENAI_BASE_URL` |
| `llm.fast_model` | `SOCTALK_FAST_MODEL` |
| `llm.reasoning_model` | `SOCTALK_REASONING_MODEL` |
| API key | `tenant-llm-key` Secret in the tenant namespace, mounted by secretKeyRef. `IntegrationConfig.llm_api_key_plain` in Postgres is the authoritative store; the provisioning controller materializes the Secret from it |

Common reasons to override per-tenant:

- A high-volume customer needs a dedicated rate-limit pool / pricing tier.
- A customer's data-residency rules require a region-specific endpoint.
- An evaluation tenant uses a cheaper model than production.

Per-tenant LLM rotation flow: see [Daily Operations → Rotate per-tenant LLM key](/operations#rotate-per-tenant-llm-key).

## Cost notes

- The runtime makes many small LLM calls per investigation (supervisor + workers + closure) and one large reasoning call (verdict). Picking a cheap model for `defaults.llm.model` lowers cost dramatically but currently degrades verdict quality too — the chart doesn't yet split fast vs reasoning model. A planned change separates the two.
- Per-tenant token usage is measured via the Prometheus metric `soctalk_tenant_llm_tokens_total{direction="input|output"}` — see [Observability](/observability#per-tenant-cost).

## Sanity test

No dedicated smoke-test CLI ships in this release. The fastest check is to onboard a test tenant and look at the orchestrator logs (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`) — the first investigation will surface any provider misconfiguration. A scripted smoke-test command is on the roadmap.

## Source pointers

| Concept | File |
|---|---|
| Provider factory | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Env-based settings resolution | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Chart LLM values | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Settings response | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
