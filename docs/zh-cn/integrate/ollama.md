# Ollama（本地 LLM）

使用 [Ollama](https://ollama.com/) 让 SocTalk 的 AI 分诊运行在**本地**模型上——无需云端 LLM、没有按 token 计费的成本，数据始终留在你自己的基础设施内。Ollama 提供**兼容 OpenAI** 的 API，SocTalk 每租户的 `runs-worker`（实际调用 LLM 的组件）会直接与它通信。

本页是端到端的完整设置。关于通用的 provider 模型，请参阅 [LLM 提供方](/zh-cn/integrate/llm-providers)。

## 工作原理

每租户的 **`runs-worker`** 就是 LLM 客户端。它的 provider、model 和 base-URL 来自租户的配置，并被渲染进其环境变量：

```
SOCTALK_LLM_PROVIDER=openai            # openai-compatible maps to "openai"
OPENAI_BASE_URL=http://<host>:11434/v1 # your Ollama endpoint
SOCTALK_FAST_MODEL=qwen2.5:7b
SOCTALK_REASONING_MODEL=qwen2.5:7b
```

因此配置 Ollama 只涉及四个值：**provider** 设为 `openai-compatible`、指向 Ollama 的 **base URL**、一个已拉取的**模型**，以及一个**占位 API key**（Ollama 会忽略它，但该密钥不能为空）。

## 1. 安装 Ollama

在集群可以访问到的主机上（某个节点，或同一网络中的任意机器）：

```bash
curl -fsSL https://ollama.com/install.sh | sh

# 绑定到所有网络接口，让租户 pod 能访问到它（默认只绑定 127.0.0.1）
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\n' \
  | sudo tee /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# 拉取一个支持工具调用的模型（参见下文“选择模型”）
ollama pull qwen2.5:7b
```

确认它能响应：`curl http://<host>:11434/api/version`。

## 2. 将租户指向 Ollama

按租户逐个配置，通过 API（或你自动化流程中的等效方式）：

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

这会持久化租户的 `IntegrationConfig` 并入队一次重新预置——控制器会对租户 chart 执行 `helm upgrade`，`runs-worker` 会带着 Ollama 的环境变量滚动更新，**并且出向 NetworkPolicy 会自动放通 Ollama 的端口**（参见可达性说明）。新的分诊运行会发往 Ollama。

若要让 Ollama 成为**每个**新租户的默认设置，请在安装时于 `soctalk-system` values 中设置 `defaults.llm`：

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

::: warning V1：设置界面显示的 provider 有误
在此版本中，MSSP UI 的 **Settings → LLM** 面板反映的是 *API pod 的*硬编码默认值（例如 `gpt-4o`），而**不是**租户的实际配置。权威来源是每租户的 `IntegrationConfig`（`GET /api/mssp/tenants/{id}/llm`）和 `runs-worker` 的环境变量。不要依赖设置页面来确认 Ollama 是否生效。
:::

## 3. 可达性检查清单（那些容易踩坑的地方）

- **绑定 `0.0.0.0`。** Ollama 默认只监听 `127.0.0.1`——pod 无法访问该地址。请设置 `OLLAMA_HOST=0.0.0.0:11434`（步骤 1）。
- **不要在 base URL 中使用 `localhost`/`127.0.0.1`。** 那指向的是 *pod* 自身，而非 Ollama 主机。请使用主机的可路由 IP（或将 Ollama 以 Service 形式运行在集群内）。pod 可通过默认的出向放行策略访问私有网段 IP（`10.0.0.0/8`、`172.16.0.0/12`）。
- **出向端口。** 租户 `runs-worker` 的出向 NetworkPolicy 会放通 LLM 端口，**该端口由 base URL 推导得出**（因此 Ollama 为 `:11434`、vLLM 为 `:8000`，以此类推）。在 `soctalk-tenant` chart **≥ 0.1.2** 上这是自动的。在更旧的 chart 上策略只放通了 `:443`——你可以升级、手动放通该端口，或在 `:443` 上用 TLS 反向代理来对外提供 Ollama。
- **占位 API key。** 若留空，chart 会跳过 Secret 的创建，导致 worker 启动时没有 `OPENAI_API_KEY` 而报错。请使用任意非空字符串。

## 4. 验证

确认 worker 已正确接入 Ollama，并且真实的分诊流量确实经由它：

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

当有告警传入时，调查会由本地模型分诊——调查上的 **Agent Run / Token Spend** 会反映 Ollama 生成的 token：

![由 Ollama 分诊的调查](/screenshots/ollama-investigation.png)

## 选择模型

SocTalk 的流水线会执行**工具调用 + 结构化 JSON 裁决**，因此请选择一个工具支持扎实的 instruct 模型——`qwen2.5`、`llama3.1`、`mistral-nemo`。小型或较老的模型常常无法通过结构化输出。推理层级从更强的模型中获益最大；你可以用 `fast_model` / `reasoning_model` 将两者拆分（一个小型快速路由模型 + 一个更大的裁决模型）。

::: tip CPU 很慢
在 CPU 上，一个 7B 模型的速度约为每秒几十个 token，而单次分诊会发起多次 LLM 调用——每次调查预计需要**数分钟**。请使用 GPU 主机以获得可用的延迟，或改用更小的快速模型。
:::
