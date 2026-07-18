# Fournisseurs LLM

Le runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) prend en charge deux fournisseurs, sélectionnés via `SOCTALK_LLM_PROVIDER` :

- `anthropic` — via `langchain-anthropic` (modèles Claude)
- `openai` — via `langchain-openai` (OpenAI ou tout point de terminaison compatible OpenAI qui honore `Authorization: Bearer <key>` sur `POST /v1/chat/completions` : Azure OpenAI, vLLM, Ollama, LiteLLM, etc.)

En V1, la variable d'environnement de fournisseur (`SOCTALK_LLM_PROVIDER`) n'est **honorée que par les pods runs-worker propres à chaque tenant**. Le pod API lui-même utilise des valeurs de fournisseur codées en dur. Le fournisseur par tenant est configurable via `PATCH /api/mssp/tenants/{tenant_id}/llm` (voir [Surcharges par tenant](#per-tenant-overrides)).

## Ce que le chart expose

Aujourd'hui, le chart `soctalk-system` accepte trois clés de valeurs LLM à l'échelle de l'installation, mais la plupart d'entre elles **ne** se répercutent **pas** sur le comportement du runtime en V1 :

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

**Résumé du comportement V1 :** le pod API utilise ses **propres valeurs codées en dur** pour le fournisseur/modèle/URL de base. Les variables d'environnement `*_DEFAULT` rendues par le chart sont un échafaudage pour une version future ; aujourd'hui, elles ne sont pas lues.

**Là où le câblage des variables d'environnement LLM prend réellement effet :** le Deployment `soctalk-runs-worker` propre à chaque tenant. Ses variables d'environnement `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` et `OPENAI_BASE_URL` sont rendues par le contrôleur de provisionnement à partir de la ligne `IntegrationConfig` du tenant. C'est la surface qui contrôle réellement quel fournisseur est appelé.

## Basculer vers Anthropic

Pour exécuter un tenant directement sur Anthropic (sans proxy compatible OpenAI intermédiaire), définissez le fournisseur par tenant via `PATCH /api/mssp/tenants/{id}/llm` :

```json
{ "provider": "anthropic" }
```

… et fournissez la clé Anthropic via le flux BYOK (`PUT /api/tenant/llm/api-key`). Le contrôleur rend `SOCTALK_LLM_PROVIDER=anthropic` sur le runs-worker de ce tenant, qui utilise `langchain-anthropic`.

La valeur `llm.provider: anthropic` du chart + `llm.existingSecret` (un Secret comportant une clé `anthropic-api-key`) alimentent le Secret d'identifiants à l'échelle de l'installation que le contrôleur réplique vers les nouveaux tenants — mais la valeur du chart ne définit **pas** elle-même `SOCTALK_LLM_PROVIDER` où que ce soit en V1 ; la sélection du fournisseur se fait par tenant.

## Clés API

Jamais dans `values.yaml`. Fournissez-les via `Secret/soctalk-system-llm-api-key` :

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Fournissez les deux clés lorsque c'est possible — le chart regroupe les deux clés dans le Secret quel que soit le fournisseur actif, de sorte que changer de fournisseur ultérieurement (par exemple, dev : openai → prod : anthropic) ne nécessite pas de recréer le Secret.

## Interface de paramètres

[Paramètres → LLM](/fr-fr/mssp-ui#settings) dans l'interface MSSP affiche le fournisseur actif, le modèle, l'URL de base, la température et le nombre maximal de tokens. Les champs sont **en lecture seule dans cette version** — le badge `Read-only` apparaît à côté du titre. Les mutations ne sont pas implémentées ; aujourd'hui, les valeurs du chart + la sélection basée sur les variables d'environnement du runtime font autorité.

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
- Les règles de résidence des données d'un client exigent un point de terminaison spécifique à une région.
- Un tenant d'évaluation utilise un modèle moins cher que la production.

Flux de rotation de la clé LLM par tenant : voir [Opérations quotidiennes → Rotation de la clé LLM par tenant](/fr-fr/operations#rotate-per-tenant-llm-key).

## Notes sur les coûts

- Le runtime effectue de nombreux petits appels LLM par enquête (superviseur + workers + clôture) et un grand appel de raisonnement (verdict). Choisir un modèle bon marché pour `defaults.llm.model` réduit considérablement les coûts mais dégrade actuellement aussi la qualité du verdict — le chart ne sépare pas encore le modèle rapide du modèle de raisonnement. Un changement planifié dissocie les deux.
- L'utilisation des tokens par tenant est mesurée via la métrique Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}` — voir [Observabilité](/fr-fr/observability#per-tenant-cost).

## Test de bon fonctionnement

Aucune CLI de smoke-test dédiée n'est livrée dans cette version. La vérification la plus rapide consiste à intégrer un tenant de test et à consulter les journaux de l'orchestrateur (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`) — la première enquête fera apparaître toute mauvaise configuration du fournisseur. Une commande de smoke-test scriptée est prévue dans la feuille de route.

## Pointeurs vers le code source

| Concept | Fichier |
|---|---|
| Fabrique de fournisseurs | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Résolution des paramètres basée sur les variables d'environnement | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valeurs LLM du chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Réponse des paramètres | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
