# LLM 提供商

运行时（[`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)）支持两种提供商，通过 `SOCTALK_LLM_PROVIDER` 选择：

- `anthropic` — 经由 `langchain-anthropic`（Claude 模型）
- `openai` — 经由 `langchain-openai`（OpenAI 或任何兼容 OpenAI 的端点，即针对 `POST /v1/chat/completions` 遵循 `Authorization: Bearer <key>` 的端点：Azure OpenAI、vLLM、Ollama、LiteLLM 等）

在 V1 中，提供商环境变量（`SOCTALK_LLM_PROVIDER`）**仅由每租户的 runs-worker** Pod 采用。API Pod 本身使用硬编码的提供商默认值。每租户提供商可通过 `PATCH /api/mssp/tenants/{tenant_id}/llm` 设置（参见[每租户覆盖](#per-tenant-overrides)）。

自托管的、兼容 OpenAI 的模型是一等选项，而非回退方案：将 `openai` 提供商指向你自己运行的 vLLM 或 SGLang 服务器、一个托管的 serverless GPU 端点，或一个本地 Ollama，全部通过 `OPENAI_BASE_URL` 完成。SocTalk 按交付模型对 backend 进行分类：温热的托管 API、scale-to-zero 的 serverless GPU、常开的租用 GPU，或本地，每一种都有不同的成本与延迟特征。关于如何选择，参见[压低 AI 分诊账单](/zh-cn/guides/inference-cost-optimization)与[分诊推理的实测真实成本](/zh-cn/guides/inference-cost-benchmark)。

## chart 暴露了哪些内容

`soctalk-system` chart 接受安装级的 LLM 默认值，用于为每个新上线租户的按 tier LLM 配置播种：

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

**默认值如何生效：** `defaults.llm.*` 键会在租户上线时被读取，并为新租户的按 tier 配置播种，因此在你设置它们之后创建的租户会继承这些值。既有租户会保留其当前配置，直到被 patch。

**解析后的配置在何处运行：** 每租户的 `soctalk-runs-worker` Deployment。其 `SOCTALK_LLM_PROVIDER`、`SOCTALK_FAST_MODEL`、`SOCTALK_REASONING_MODEL` 以及 `OPENAI_BASE_URL` 环境变量由 provisioning 控制器依据该租户的配置行渲染，这才是控制每个 tier 调用哪个提供商和模型的界面。

## 切换到 Anthropic

要让某个租户直接对接 Anthropic（中间不经过兼容 OpenAI 的代理），请通过 `PATCH /api/mssp/tenants/{id}/llm` 设置每租户提供商：

```json
{ "provider": "anthropic" }
```

……并通过 BYOK 流程（`PUT /api/tenant/llm/api-key`）提供 Anthropic 密钥。控制器会将 `SOCTALK_LLM_PROVIDER=anthropic` 渲染到该租户的 runs-worker 上，后者使用 `langchain-anthropic`。

chart 的 `llm.provider: anthropic` value 加上 `llm.existingSecret`（带有 `anthropic-api-key` 键的 Secret）会为控制器镜像到新租户的安装级凭据 Secret 播种——但在 V1 中，chart value 本身**不会**在任何地方设置 `SOCTALK_LLM_PROVIDER`；提供商选择是按租户进行的。

## API 密钥

切勿放在 `values.yaml` 中。请通过 `Secret/soctalk-system-llm-api-key` 提供：

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

尽可能同时提供两个密钥——无论当前激活的是哪个提供商，chart 都会将两个密钥一并打包进 Secret，因此日后切换提供商（例如开发环境 openai → 生产环境 anthropic）时无需重新创建 Secret。

## 设置界面

MSSP 界面中的[设置 → LLM](/zh-cn/mssp-ui#settings) 会显示当前激活的提供商、模型、基础 URL、温度以及最大 token 数。这些字段**在本版本中为只读**——标题旁会出现 `Read-only` 徽章。变更操作尚未实现；如今以 chart values 加上运行时基于环境变量的选择为准。

设置响应中永远不会显示 API 密钥（仅有 `present: bool` 标志）。

## 仅运行时可调项（环境变量，而非 chart）

有若干运行时可调项以环境变量形式存在，但尚未作为 chart values 暴露。请在安装后直接在 `soctalk-system-api` Deployment（在 V1 中同时也是编排器）上设置它们：

| 环境变量 | 作用 |
|---|---|
| `SOCTALK_LLM_PROVIDER` | `anthropic` 或 `openai`。选择所用的 LangChain 集成 |
| `OPENAI_API_KEY`、`ANTHROPIC_API_KEY` | 提供商密钥（作为打包 Secret 的替代方式） |
| `OPENAI_BASE_URL` | 覆盖 OpenAI 客户端的基础 URL（Azure、vLLM、Ollama……） |
| `OPENAI_API_VERSION`、`OPENAI_API_TYPE` | Azure 专用 |
| `SOCTALK_FAST_MODEL` | 覆盖 fast 模型（默认 `claude-sonnet-4-20250514`） |
| `SOCTALK_REASONING_MODEL` | 覆盖 reasoning 模型（默认 `claude-sonnet-4-20250514`） |

chart 以 `defaults.llm.*` 为这些项提供安装级默认值的入口；每租户覆盖则在运行时经由该租户 runs-worker 的环境变量生效。

## 每租户覆盖

每租户的 LLM 提供商、模型和基础 URL 可通过 `PATCH /api/mssp/tenants/{tenant_id}/llm` 设置（参见 [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py)）。变更会持久化到数据库，并在下一次部署时渲染进该租户 runs-worker 的环境变量；实际操作中，runs-worker 会在下一次 Pod 重启时（或该租户 chart 的下一次 `helm upgrade` 时）采用该变更。

租户上线载荷可包含 `llm_base_url` 和 `llm_model` 作为初始设置。这些覆盖字段在运行时映射为 runs-worker 上的环境变量：

| 租户字段 | runs-worker 上的环境变量 |
|---|---|
| `llm.provider` | `SOCTALK_LLM_PROVIDER` |
| `llm.base_url` | `OPENAI_BASE_URL` |
| `llm.fast_model` | `SOCTALK_FAST_MODEL` |
| `llm.reasoning_model` | `SOCTALK_REASONING_MODEL` |
| API 密钥 | 租户命名空间中的 `tenant-llm-key` Secret，通过 secretKeyRef 挂载。Postgres 中的 `IntegrationConfig.llm_api_key_plain` 是权威存储；provisioning 控制器据此物化该 Secret |

按租户覆盖的常见原因：

- 高流量客户需要独立的限流池／定价档位。
- 客户的数据驻留规则要求使用特定区域的端点。
- 评估用租户使用比生产环境更便宜的模型。

每租户 LLM 轮换流程：参见[日常运维 → 轮换每租户 LLM 密钥](/zh-cn/operations#rotate-per-tenant-llm-key)。

## 成本说明

- 运行时每次调查会发起许多次小型 LLM 调用（supervisor + workers + closure）以及一次大型 reasoning 调用（裁决）。fast 与 reasoning 的拆分现在可按 tier 配置：SocTalk 将每个角色（较轻量的 router/supervisor tier 和更强的 verdict/reasoning tier）各自解析到其自己的 tier，每个 tier 指向各自的提供商、模型和 endpoint。`soctalk-system` chart values 中的 `defaults.llm.fastTier` 调节项，以及 provisioning 层的按 tier 渲染，让你可以把 fast tier 指向一个便宜模型，同时为裁决保留一个更强的模型，因此你不必再以裁决质量来换取更低的每次调用成本。fast tier 默认关闭（`fastTier: {}`）；设置其 `provider`、`baseUrl` 和 `model` 即可启用。它会为新上线租户的按 tier 配置播种，因此既有租户会保留其当前设置，直到被 patch。
- 每租户 token 用量通过 Prometheus 指标 `soctalk_tenant_llm_tokens_total{direction="input|output"}` 度量——参见[可观测性](/zh-cn/observability#per-tenant-cost)。
- 自托管只有在你让 GPU 保持繁忙时才划算。`runsWorker.concurrency` 调节项（默认 `1`）设定一个 runs-worker 并行处理多少次调查；调高它以填满自托管的连续 batch，并将一个常开 GPU 摊薄到更多工作上。关于如何针对某个给定 backend 为其设定大小，参见[压低 AI 分诊账单](/zh-cn/guides/inference-cost-optimization)。

## 基本功能测试

本版本未附带专用的冒烟测试 CLI。最快的检查方式是上线一个测试租户并查看编排器日志（`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`）——首次调查便会暴露任何提供商配置错误。脚本化的冒烟测试命令已列入路线图。

## 源码索引

| 概念 | 文件 |
|---|---|
| 提供商工厂 | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| 基于环境变量的设置解析 | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| chart LLM values | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| 设置响应 | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
