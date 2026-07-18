# Politique de placement des secrets

> **Note de déploiement V1.** Plusieurs entrées ci-dessous font référence aux « pods orchestrateur » comme une charge de travail distincte — dans le chart V1, l'orchestrateur est co-localisé dans le Deployment `soctalk-system-api`, de sorte que les références au « pod orchestrateur » désignent le « pod API » dans cette version. Certains noms de Secret K8s peuvent également différer légèrement des noms rendus par le chart (voir [`charts/soctalk-system/templates/60-secrets.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/60-secrets.yaml) comme source de vérité).

## Invariant (aspirationnel)

**Cible :** aucun matériel de secret brut dans la base de données SocTalk. Les tables Postgres qui suivent les secrets ne stockent que des références : `(namespace, name, version_label)`. Le matériel lui-même se trouve dans un objet Kubernetes `Secret`, monté dans le pod qui en a besoin.

**Aujourd'hui (V1) :** il existe **une exception documentée** — `IntegrationConfig.llm_api_key_plain` dans la base de données stocke les clés API LLM par tenant en clair. Cela est nécessaire car le runs-worker lit la clé depuis son contexte de tenant au moment de la prise en charge de l'enquête, et le chart V1 ne câble pas encore les Secrets LLM par tenant via le pod spec. Considérez les identifiants Postgres comme protégeant ces clés, et faites tourner les clés du fournisseur LLM comme si elles étaient exposées si l'identifiant de la BD change.

Les autres catégories de secrets — signature JWT, rôles Postgres, identifiants d'intégration, Wazuh authd — vivent toutes dans des Secrets K8s et sont référencées par nom depuis la BD, non stockées en ligne. Les objectifs d'architecture (ci-dessous) décrivent l'état de destination pour toutes les classes de secrets :

- Limite le rayon d'impact d'une compromission de la BD SocTalk (aucune fuite de matériel).
- Permet aux mécanismes de rotation natifs de K8s de fonctionner (mise à jour du Secret → le pod récupère la nouvelle valeur au remontage ou à la prochaine lecture du Secret).
- S'aligne avec le chemin d'intégration d'External Secrets Operator dans une version future.

## Inventaire des secrets V1 (ce que le chart rend réellement aujourd'hui)

| Secret | Matériel | Emplacement | Accédé par | Rotation |
|---|---|---|---|---|
| `soctalk-system-postgres-admin-creds` | user/pw | ns `soctalk-system` | Conteneur `db-init` du pod API uniquement (migrations + bootstrap) | Manuelle |
| `soctalk-system-postgres-app-creds` | user/pw | ns `soctalk-system` | Pod API (runtime, soumis à RLS) | Manuelle |
| `soctalk-system-postgres-mssp-creds` | user/pw | ns `soctalk-system` | Pod API (requêtes inter-tenants `system_context()`) | Manuelle |
| `soctalk-system-jwt-signing-key` | secret HMAC | ns `soctalk-system` | Pod API | Manuelle |
| `soctalk-system-adapter-signing-key` | clé HMAC | ns `soctalk-system` | Pod API (émet des jetons d'adaptateur par tenant) | Manuelle |
| `soctalk-system-bootstrap-admin` | email + mot de passe | ns `soctalk-system` | Conteneur `db-init` du pod API uniquement | Manuelle |
| `soctalk-system-llm-api-key` | clés API du fournisseur (anthropic-api-key + openai-api-key) | ns `soctalk-system` | Pod API (valeur par défaut à l'échelle de l'installation) | Manuelle |
| `adapter-token` | jeton bearer | ns `tenant-<slug>` | Pod adaptateur du tenant | Émis au provisionnement ; rotation via re-provisionnement |
| `runs-worker-token` | jeton bearer | ns `tenant-<slug>` | Pod runs-worker du tenant (appelle `/api/internal/worker/runs/*`) | Comme ci-dessus |
| `tenant-llm-key` | clé API LLM | ns `tenant-<slug>` | Pod runs-worker du tenant (monté via `secretKeyRef`) | Initiée par le MSSP via `PATCH /api/mssp/tenants/{id}/llm` ; le contrôleur la matérialise depuis `IntegrationConfig.llm_api_key_plain` + redémarre le runs-worker |
| `tenant-<id>-llm` | clé API LLM (copie héritée / d'audit) | ns `soctalk-system` | Monté par aucun pod V1 | Comme ci-dessus ; cette copie est écrite pour l'audit mais n'est **pas la source faisant autorité** que lit le runs-worker |
| `wazuh-authd-secret` | secret partagé | ns `tenant-<slug>` | Wazuh manager (enrôlement) | Régénérer pour forcer le ré-enrôlement de tous les agents |
| `wazuh-<slug>-wazuh-creds` | user/pw | ns `tenant-<slug>` | Pods Wazuh manager + linux-ep (enrôlement d'agent) | Générés au provisionnement |

**Le triage s'exécute dans `soctalk-runs-worker` dans chaque namespace `tenant-<slug>`** (pas dans le pod API central). C'est pourquoi les secrets par tenant sont montés dans le namespace du tenant, et non dans `soctalk-system`.

La clé API LLM est **également stockée en clair dans `IntegrationConfig.llm_api_key_plain`** dans Postgres — voir la clause de non-responsabilité sur l'invariant ci-dessus. Le Secret K8s est matérialisé à partir de la valeur de la BD au moment du provisionnement / de la rotation.

Éléments obsolètes issus de versions préliminaires (désormais supprimés) : `tenant-<id>-wazuh`, `tenant-<id>-thehive`, `tenant-<id>-cortex`, `wazuh-bootstrap`, `thehive-bootstrap`, `cortex-bootstrap`, `cassandra-creds`, `soctalk-license`. `tenant-<id>-llm` dans `soctalk-system` existe toujours en V1 comme copie héritée/d'audit, mais ce n'est **pas** ce que lit le runs-worker. La section architecture ci-dessous décrit la logique de conception ; seul l'inventaire ci-dessus est à jour.

## Placement de la clé LLM par tenant

Le triage s'exécute dans le pod `soctalk-runs-worker` par tenant (dans le namespace `tenant-<slug>`), **et non** dans le pod API central. C'est pourquoi les clés LLM par tenant vivent dans le namespace du tenant :

- **Store faisant autorité :** `IntegrationConfig.llm_api_key_plain` dans Postgres.
- **Source montée :** `Secret/tenant-llm-key` dans `tenant-<slug>`, matérialisée par le contrôleur à partir de la valeur de la BD.
- **À la rotation (`PATCH /api/mssp/tenants/{id}/llm`) :** le contrôleur réécrit le Secret du namespace du tenant et redémarre `Deployment/soctalk-runs-worker` afin que la nouvelle clé prenne effet à la prochaine prise en charge d'enquête.

`Secret/tenant-<id>-llm` dans le namespace `soctalk-system` existe également comme copie héritée / d'audit issue d'itérations de conception antérieures, mais n'est monté par aucun pod V1. Il n'y a pas de montage de Secret inter-namespaces en V1.

L'alternative (un ns par tenant pour la clé LLM de chaque tenant) est réévaluée dans une version future avec External Secrets Operator, où ESO peut synchroniser les secrets stockés dans un coffre externe vers le namespace qui en a besoin.

## Secrets de bootstrap du plan de données

Les identifiants administrateur Wazuh/TheHive/Cortex vivent dans leurs namespaces de tenant respectifs parce que :

- Ces pods en ont besoin au démarrage (conteneurs init, configuration au premier lancement).
- Complications de montage inter-ns comme évoqué ci-dessus.
- Le rayon d'impact d'une compromission de namespace expose déjà les pods eux-mêmes ; placer le secret de bootstrap dans le même namespace n'ajoute pas de risque.

Les secrets de bootstrap sont générés par le contrôleur SocTalk au moment du provisionnement du tenant :
1. Le contrôleur génère des valeurs aléatoires (par ex. `openssl rand -hex 32`).
2. Le contrôleur crée un `Secret` dans le ns `tenant-<slug>` cible.
3. Le contrôleur enregistre la référence `(tenant-<slug>, wazuh-bootstrap, v1)` dans la table `TenantSecret`.
4. Le contrôleur rend les valeurs du chart de tenant référençant le Secret par nom.
5. `helm install` se déroule ; les pods du plan de données lisent les identifiants au démarrage.

Si le matériel est perdu (par ex. Secret supprimé), le re-provisionnement régénère de nouveaux identifiants. Les pods du plan de données redémarrent ; tous les services dépendants se réinitialisent. Les agents des endpoints client (qui reposent sur le secret d'enrôlement Wazuh) nécessitent un ré-enrôlement si ce secret spécifique change : documenté dans le runbook d'exploitation.

## Conventions de génération des secrets

Au moment du provisionnement du tenant, le contrôleur SocTalk génère :

```python
import secrets

# Mots de passe administratifs : 32 caractères à haute entropie
wazuh_admin_pw = secrets.token_urlsafe(32)
thehive_admin_pw = secrets.token_urlsafe(32)
cortex_admin_pw = secrets.token_urlsafe(32)

# Secret partagé d'enrôlement : 48 caractères
wazuh_authd = secrets.token_urlsafe(48)

# Jetons API (pour SocTalk → plan de données) : 48 caractères
thehive_api_token = secrets.token_urlsafe(48)
cortex_api_key = secrets.token_urlsafe(48)

# Cassandra : 32 caractères
cassandra_pw = secrets.token_urlsafe(32)
```

SocTalk stocke les références et les libellés de version ; il ne conserve pas le matériel en mémoire au-delà de l'appel de provisionnement.

## Rotation (réalité V1)

1. **Rotation de la clé LLM par tenant** (le MSSP l'initie via `PATCH /api/mssp/tenants/{id}/llm`) :
   - Store faisant autorité mis à jour dans Postgres (`IntegrationConfig.llm_api_key_plain`).
   - Le contrôleur réécrit `Secret/tenant-llm-key` dans `tenant-<slug>` (pas le namespace système).
   - Le contrôleur redémarre `Deployment/soctalk-runs-worker` dans le namespace du tenant afin que la nouvelle clé prenne effet à la prochaine prise en charge. **Le redémarrage du pod est requis** — la V1 ne recharge pas les secrets à l'exécution.

2. **Rotation des identifiants administrateur Wazuh / TheHive / Cortex** (manuelle, runbook) :
   - `kubectl patch secret <name> -n tenant-<slug> ...` pour réécrire l'identifiant.
   - `kubectl rollout restart` la charge de travail concernée afin qu'elle relise.
   - Une CLI d'encapsulation pour cela (`soctalk-cli rotate-admin`) était documentée dans des versions préliminaires antérieures mais n'est **pas implémentée** en V1.

3. **Rotation des identifiants Postgres** (manuelle, runbook) :
   - `ALTER ROLE soctalk_app WITH PASSWORD ...` dans Postgres.
   - `kubectl patch secret soctalk-system-postgres-app-creds ...` (attention au nom rendu par le chart).
   - `kubectl rollout restart deploy soctalk-system-api` — il n'y a pas de pod orchestrateur séparé en V1 (l'orchestrateur est co-localisé dans le pod API).

4. **Rotation de la clé de signature JWT** (version future) : la rotation sans interruption nécessite de prendre en charge deux clés valides pendant la transition. Cette version diffère ce point ; la rotation manuelle force une fenêtre où tous les utilisateurs doivent se ré-authentifier.

## Contrôle d'accès

Le RBAC Kubernetes restreint quels ServiceAccounts peuvent lire quels Secrets :

- Le SA `soctalk-system-api` dans `soctalk-system` : peut lire les Secrets de `soctalk-system` (identifiants Postgres, clés de signature JWT/adaptateur). Également lié à l'écriture de Secrets dans les namespaces `tenant-*` (nécessaire pour créer/faire tourner les secrets de bootstrap des tenants) — le chart V1 consolide les rôles API + contrôleur dans ce SA.
- Le `ServiceAccount` par tenant dans `tenant-<slug>` : ne peut lire que les secrets de son propre namespace. Il peut lire ses propres `adapter-token` / `runs-worker-token` / `tenant-llm-key`, mais jamais la clé de signature système.
- Le `soctalk-orchestrator-sa` des versions préliminaires n'existe pas en V1 — l'orchestrateur s'exécute à l'intérieur du pod API sous le SA de l'API.

Les templates `Role`/`RoleBinding` font partie du chart `soctalk-system` (pour les SAs SocTalk) et du chart `soctalk-tenant` (pour les SAs par tenant).

## Anti-patterns explicitement rejetés

- **Injection de secret par variable d'environnement depuis un fichier `.env`** (pattern V0 actuel) : convient pour une organisation unique, pas pour le multi-tenant. Tous les secrets passent vers des Secrets K8s.
- **Secrets dans values.yaml de Helm** : jamais : les fichiers de valeurs finissent dans Git, les logs de CI, l'historique de Helm. Le contrôleur SocTalk rend les objets Secret séparément et utilise `valueFrom.secretKeyRef` dans les templates.
- **Clé LLM partagée unique pour tous les tenants** : explicitement hors périmètre pour BYO LLM. Toujours des clés par tenant.
- **Secrets dans les ConfigMaps** : interdit. Les ConfigMaps sont pour la configuration non sensible ; les Secrets pour les données sensibles.

## External Secrets Operator (un chemin de version future)

Une version future introduit l'intégration d'External Secrets Operator :

- Le MSSP fournit un backend de secrets (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
- Les ressources `ExternalSecret` référencent des chemins du backend ; ESO synchronise vers des Secrets K8s.
- Les clés LLM par tenant sont stockées dans le backend avec des chemins comme `secret/mssp-abc/tenants/acme/llm`.
- La rotation est effectuée dans le backend ; ESO la propage dans l'intervalle de rafraîchissement.

La structure (références dans Postgres → Secret K8s → montage) est compatible : seule la source du Secret change (gérée par ESO vs écrite par le contrôleur SocTalk).
