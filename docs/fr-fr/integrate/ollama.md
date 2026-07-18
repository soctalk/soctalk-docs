# Ollama (LLM local)

Exécutez le triage AI de SocTalk avec un modèle **local** grâce à [Ollama](https://ollama.com/) — pas de LLM cloud, pas de coût par token, les données restent sur votre infrastructure. Ollama expose une API **compatible OpenAI**, et le `runs-worker` par tenant de SocTalk (le composant qui appelle réellement le LLM) communique directement avec elle.

Cette page décrit la configuration de bout en bout. Pour le modèle de fournisseur général, consultez [Fournisseurs LLM](/fr-fr/integrate/llm-providers).

## Comment cela s'intègre

Le **`runs-worker`** par tenant est le client LLM. Son fournisseur, son modèle et son URL de base proviennent de la configuration du tenant et sont injectés dans son environnement :

```
SOCTALK_LLM_PROVIDER=openai            # openai-compatible maps to "openai"
OPENAI_BASE_URL=http://<host>:11434/v1 # your Ollama endpoint
SOCTALK_FAST_MODEL=qwen2.5:7b
SOCTALK_REASONING_MODEL=qwen2.5:7b
```

Configurer Ollama revient donc à quatre valeurs : le **fournisseur** `openai-compatible`, l'**URL de base** pointant vers Ollama, un **modèle** téléchargé, et une **clé API factice** (Ollama l'ignore, mais le secret ne doit pas être vide).

## 1. Installer Ollama

Sur un hôte accessible depuis le cluster (un nœud, ou n'importe quelle machine sur le même réseau) :

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

Vérifiez qu'il répond : `curl http://<host>:11434/api/version`.

## 2. Pointer un tenant vers Ollama

Par tenant, via l'API (ou l'équivalent dans votre automatisation) :

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

Cela persiste l'`IntegrationConfig` du tenant et met en file d'attente un re-provisionnement — le contrôleur effectue un `helm upgrade` du chart du tenant, le `runs-worker` redémarre avec l'environnement Ollama, **et la NetworkPolicy de sortie ouvre automatiquement le port d'Ollama** (voir les notes sur l'accessibilité). Les nouveaux runs de triage vont vers Ollama.

Pour faire d'Ollama la valeur par défaut de **chaque** nouveau tenant, définissez `defaults.llm` dans les values `soctalk-system` lors de l'installation :

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

::: warning V1 : l'interface Paramètres affiche le mauvais fournisseur
Dans cette version, le panneau **Paramètres → LLM** de l'interface MSSP reflète les valeurs par défaut codées en dur du *pod API* (par ex. `gpt-4o`), et **non** la configuration réelle du tenant. La source de référence est l'`IntegrationConfig` par tenant (`GET /api/mssp/tenants/{id}/llm`) et l'environnement du `runs-worker`. Ne vous fiez pas à la page Paramètres pour confirmer Ollama.
:::

## 3. Liste de vérification de l'accessibilité (les pièges courants)

- **Écoutez sur `0.0.0.0`.** Ollama écoute sur `127.0.0.1` par défaut — les pods ne peuvent pas l'atteindre. Définissez `OLLAMA_HOST=0.0.0.0:11434` (étape 1).
- **N'utilisez pas `localhost`/`127.0.0.1` dans l'URL de base.** Il s'agit du *pod*, pas de l'hôte Ollama. Utilisez l'IP routable de l'hôte (ou exécutez Ollama dans le cluster en tant que Service). Les pods atteignent les IP de plages privées (`10.0.0.0/8`, `172.16.0.0/12`) via les autorisations de sortie par défaut.
- **Port de sortie.** La NetworkPolicy de sortie du `runs-worker` du tenant ouvre le port LLM, **dérivé de l'URL de base** (donc `:11434` pour Ollama, `:8000` pour vLLM, etc.). C'est automatique sur le chart `soctalk-tenant` **≥ 0.1.2**. Sur les charts plus anciens, la policy n'autorisait que `:443` — soit vous effectuez une mise à niveau, soit vous autorisez le port manuellement, soit vous placez Ollama derrière un reverse proxy TLS sur `:443`.
- **Clé API factice.** Si vous la laissez vide, le chart ignore le Secret → le worker démarre sans `OPENAI_API_KEY` et échoue. Utilisez n'importe quelle chaîne non vide.

## 4. Vérifier

Confirmez que le worker est bien câblé à Ollama et qu'un vrai triage le traverse :

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

Lorsqu'une alerte arrive, l'enquête est triée par le modèle local — l'indicateur **Agent Run / Token Spend** de l'enquête reflète les tokens générés par Ollama :

![Enquête triée par Ollama](/screenshots/ollama-investigation.png)

## Choisir un modèle

Le pipeline de SocTalk effectue du **tool-calling + des verdicts JSON structurés**, alors choisissez un modèle instruct doté d'un solide support des outils — `qwen2.5`, `llama3.1`, `mistral-nemo`. Les modèles petits ou anciens échouent souvent sur la sortie structurée. Le niveau de raisonnement bénéficie le plus d'un modèle plus puissant ; vous pouvez les séparer avec `fast_model` / `reasoning_model` (un petit routeur rapide + un modèle de verdict plus grand).

::: tip Le CPU est lent
Sur CPU, un modèle 7B tourne à quelques dizaines de tokens/sec, et un seul triage effectue plusieurs appels LLM — comptez des **minutes** par enquête. Utilisez un hôte GPU pour une latence exploitable, ou un modèle rapide plus petit.
:::
