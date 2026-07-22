# Fournisseurs LLM

Le runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) prend en charge deux fournisseurs, sélectionnés via `SOCTALK_LLM_PROVIDER` :

- `anthropic`: via `langchain-anthropic` (modèles Claude)
- `openai`: via `langchain-openai` (OpenAI ou tout endpoint compatible OpenAI qui honore `Authorization: Bearer <key>` sur `POST /v1/chat/completions` : Azure OpenAI, vLLM, Ollama, LiteLLM, etc.)

En V1, la variable d'environnement de fournisseur (`SOCTALK_LLM_PROVIDER`) n'est **honorée que par les pods runs-worker propres à chaque tenant**. Le pod API lui-même utilise des valeurs de fournisseur codées en dur. Le fournisseur par tenant est configurable via `PATCH /api/mssp/tenants/{tenant_id}/llm` (voir [Surcharges par tenant](#per-tenant-overrides)).

Un modèle auto-hébergé, compatible OpenAI, est une option de premier plan, pas un repli : pointez le fournisseur `openai` vers un serveur vLLM ou SGLang que vous exploitez, un endpoint GPU serverless managé, ou un Ollama local, le tout via `OPENAI_BASE_URL`. SocTalk classe les backends par modèle de livraison, API managée à chaud, GPU serverless scale-to-zero, GPU loué toujours actif, ou local, et chacun a un profil de coût et de latence différent. Pour savoir comment choisir, voir [Réduire au minimum la facture du triage AI](/fr-fr/guides/inference-cost-optimization) et [Ce que coûte réellement l'inférence de triage, mesuré](/fr-fr/guides/inference-cost-benchmark).

## Ce que le chart expose

Le chart `soctalk-system` accepte des valeurs par défaut LLM à l'échelle de l'installation qui amorcent la configuration LLM par tier de chaque tenant nouvellement intégré :

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

**Comment les valeurs par défaut prennent effet :** les clés `defaults.llm.*` sont lues lors de l'intégration du tenant et amorcent la configuration par tier du nouveau tenant, de sorte qu'un tenant créé après que vous les avez définies en hérite. Les tenants existants conservent leur configuration actuelle jusqu'à ce qu'elle soit patchée.

**Là où la configuration résolue s'exécute :** le Deployment `soctalk-runs-worker` propre à chaque tenant. Ses variables d'environnement `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` et `OPENAI_BASE_URL` sont rendues par le contrôleur de provisionnement à partir de la ligne de configuration du tenant, et c'est la surface qui contrôle quel fournisseur et quel modèle chaque tier appelle.

## Basculer vers Anthropic

Pour exécuter un tenant directement sur Anthropic (sans proxy compatible OpenAI intermédiaire), définissez le fournisseur par tenant via `PATCH /api/mssp/tenants/{id}/llm` :

```json
{ "provider": "anthropic" }
```

… et fournissez la clé Anthropic via le flux BYOK (`PUT /api/tenant/llm/api-key`). Le contrôleur rend `SOCTALK_LLM_PROVIDER=anthropic` sur le runs-worker de ce tenant, qui utilise `langchain-anthropic`.

La valeur `llm.provider: anthropic` du chart + `llm.existingSecret` (un Secret comportant une clé `anthropic-api-key`) alimentent le Secret d'identifiants à l'échelle de l'installation que le contrôleur réplique vers les nouveaux tenants, mais la valeur du chart ne définit **pas** elle-même `SOCTALK_LLM_PROVIDER` où que ce soit en V1 ; la sélection du fournisseur se fait par tenant.

## Clés API

Jamais dans `values.yaml`. Fournissez-les via `Secret/soctalk-system-llm-api-key` :

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Fournissez les deux clés lorsque c'est possible ; le chart regroupe les deux clés dans le Secret quel que soit le fournisseur actif, de sorte que changer de fournisseur ultérieurement (par exemple, dev : openai → prod : anthropic) ne nécessite pas de recréer le Secret.

## Interface de paramètres

[Paramètres → LLM](/fr-fr/mssp-ui#settings) dans l'interface MSSP affiche le fournisseur actif, le modèle, l'URL de base, la température et le nombre maximal de tokens. Les champs sont **en lecture seule dans cette version**: le badge `Read-only` apparaît à côté du titre. Les mutations ne sont pas implémentées ; aujourd'hui, les valeurs du chart + la sélection basée sur les variables d'environnement du runtime font autorité.

Les clés API ne sont jamais affichées dans la réponse des paramètres (seulement l'indicateur `present: bool`).

## Réglages disponibles uniquement via le runtime (variables d'environnement, pas le chart)

Plusieurs réglages du runtime existent sous forme de variables d'environnement mais ne sont pas encore exposés comme valeurs du chart. Définissez-les directement sur le Deployment `soctalk-system-api` (qui est aussi l'orchestrateur en V1) après l'installation :

| Variable d'environnement | Effet |
|---|---|
| `SOCTALK_LLM_PROVIDER` | `anthropic` ou `openai`. Sélectionne l'intégration LangChain |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Clés de fournisseur (alternative au Secret groupé) |
| `OPENAI_BASE_URL` | Remplace l'URL de base du client OpenAI (Azure, vLLM, Ollama, …) |
| `OPENAI_API_VERSION`, `OPENAI_API_TYPE` | Spécifique à Azure |
| `SOCTALK_FAST_MODEL` | Remplace le modèle rapide (par défaut `claude-sonnet-4-20250514`) |
| `SOCTALK_REASONING_MODEL` | Remplace le modèle de raisonnement (par défaut `claude-sonnet-4-20250514`) |

Le chart pilote ces réglages via `defaults.llm.*` pour les valeurs par défaut à l'échelle de l'installation ; les surcharges par tenant s'appliquent au runtime via les variables d'environnement du runs-worker du tenant.

## Surcharges par tenant

Le fournisseur LLM, le modèle et l'URL de base par tenant sont configurables via `PATCH /api/mssp/tenants/{tenant_id}/llm` (voir [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py)). Le changement est persisté en base de données et rendu dans les variables d'environnement du runs-worker du tenant lors du déploiement suivant ; en pratique, le runs-worker prend en compte le changement au prochain redémarrage du pod (ou au prochain `helm upgrade` du chart du tenant).

La charge utile d'intégration du tenant peut inclure `llm_base_url` et `llm_model` pour les paramètres initiaux. Les champs de surcharge, répliqués au runtime en tant que variables d'environnement sur le runs-worker :

| Champ du tenant | Variable d'environnement sur le runs-worker |
|---|---|
| `llm.provider` | `SOCTALK_LLM_PROVIDER` |
| `llm.base_url` | `OPENAI_BASE_URL` |
| `llm.fast_model` | `SOCTALK_FAST_MODEL` |
| `llm.reasoning_model` | `SOCTALK_REASONING_MODEL` |
| Clé API | Secret `tenant-llm-key` dans le namespace du tenant, monté par secretKeyRef. `IntegrationConfig.llm_api_key_plain` dans Postgres est le magasin de référence ; le contrôleur de provisionnement matérialise le Secret à partir de celui-ci |

Raisons courantes de procéder à une surcharge par tenant :

- Un client à fort volume a besoin d'un pool de limitation de débit dédié / d'un palier tarifaire dédié.
- Les règles de résidence des données d'un client exigent un endpoint spécifique à une région.
- Un tenant d'évaluation utilise un modèle moins cher que la production.

Flux de rotation de la clé LLM par tenant : voir [Opérations quotidiennes → Rotation de la clé LLM par tenant](/fr-fr/operations#rotate-per-tenant-llm-key).

## Notes sur les coûts

- Le runtime effectue de nombreux petits appels LLM par enquête (supervisor + workers + clôture) et un grand appel de raisonnement (verdict). La séparation rapide vs raisonnement est désormais configurable par tier : SocTalk résout chaque rôle, un tier router/supervisor plus léger et un tier verdict/raisonnement plus puissant, vers son propre tier, chacun pointant vers son propre fournisseur, modèle et endpoint. Le réglage `defaults.llm.fastTier` dans les valeurs du chart `soctalk-system` et le rendu par tier dans la couche de provisionnement vous permettent de pointer le tier rapide vers un modèle bon marché tout en conservant un modèle plus puissant pour le verdict, de sorte que vous ne troquez plus la qualité du verdict pour réduire le coût par appel. Le tier rapide est désactivé par défaut (`fastTier: {}`) ; définissez ses `provider`, `baseUrl` et `model` pour l'activer. Il amorce la configuration par tier des tenants nouvellement intégrés, de sorte que les tenants existants conservent leur configuration actuelle jusqu'à ce qu'elle soit patchée.
- L'utilisation des tokens par tenant est mesurée via la métrique Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}`: voir [Observabilité](/fr-fr/observability#per-tenant-cost).
- L'auto-hébergement n'est rentable que si vous gardez le GPU occupé. Le réglage `runsWorker.concurrency` (par défaut `1`) définit combien d'enquêtes un runs-worker traite en parallèle ; augmentez-le pour remplir un batch continu auto-hébergé et amortir un GPU toujours actif sur davantage de travail. Voir [Réduire au minimum la facture du triage AI](/fr-fr/guides/inference-cost-optimization) pour savoir comment le dimensionner face à un backend donné.

## Test de bon fonctionnement

Aucune CLI de smoke-test dédiée n'est livrée dans cette version. La vérification la plus rapide consiste à intégrer un tenant de test et à consulter les journaux de l'orchestrateur (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`), la première enquête fera apparaître toute mauvaise configuration du fournisseur. Une commande de smoke-test scriptée est prévue dans la feuille de route.

## Pointeurs vers le code source

| Concept | Fichier |
|---|---|
| Fabrique de fournisseurs | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Résolution des paramètres basée sur les variables d'environnement | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valeurs LLM du chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Réponse des paramètres | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
