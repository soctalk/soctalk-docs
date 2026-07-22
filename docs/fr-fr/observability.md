# Observabilité

Métriques et logs pour un MSSP exploitant SocTalk. Deux consommateurs visés : les tableaux de bord de planification de capacité et les tableaux de bord de coût par tenant.

## Endpoint Prometheus

`GET /metrics` sur le Service `soctalk-system-api` expose les métriques de l'installation au format d'exposition Prometheus. Non authentifié par conception, cadrez-le via une NetworkPolicy ou un Ingress avec `auth-basic`/liste d'autorisation d'IP si vous ne voulez pas qu'il soit lisible par tous.

## État de l'instrumentation en V1

Le catalogue de métriques ci-dessous décrit la surface de métriques **définie** (dans `src/soctalk/core/observability/metrics.py`). En V1, seule `soctalk_tenant_adapter_heartbeat_age_seconds` est visiblement mise à jour par le code (dans le gestionnaire de heartbeat de l'adaptateur). Les autres métriques sont définies mais **pas encore instrumentées au niveau des points d'appel**: elles s'exporteront comme zéro/vides. Considérez le tableau comme la cible de conception jusqu'à ce que les hooks d'exécution arrivent.

## Compteurs par tenant (surface définie)

Tous étiquetés avec `tenant_id`. La cardinalité est bornée par le nombre de tenants dans l'installation.

| Métrique | Type | Signification | Instrumenté en V1 ? |
|---|---|---|---|
| `soctalk_tenant_events_ingested_total` | counter | Alertes reçues depuis l'adaptateur Wazuh du tenant | pas encore |
| `soctalk_tenant_investigations_opened_total` | counter | Enquêtes ouvertes | pas encore |
| `soctalk_tenant_investigations_closed_total{disposition}` | counter | Clôturées par disposition | pas encore |
| `soctalk_tenant_pending_reviews` | gauge | Examens en attente d'un point de contrôle humain | pas encore |
| `soctalk_tenant_llm_tokens_total{direction}` | counter | Tokens LLM entrants/sortants, le facteur de coût | pas encore |
| `soctalk_tenant_adapter_heartbeat_age_seconds` | gauge | Secondes écoulées depuis le dernier heartbeat de l'adaptateur | **oui** (mis à jour par `/api/internal/adapter/heartbeat`). **La transition en état dégradé automatique n'est pas implémentée** ; utilisez ceci comme votre propre entrée d'alerte |

## Compteurs au niveau de l'installation (surface définie)

| Métrique | Type | Signification | Instrumenté en V1 ? |
|---|---|---|---|
| `soctalk_install_tenants_total{state}` | gauge | Nombre de tenants par état | pas encore |
| `soctalk_api_request_duration_seconds{method,path_template,status}` | histogram | Latence de l'API par chemin de template | pas encore |
| `soctalk_helm_op_duration_seconds{op,outcome}` | histogram | Durées des opérations Helm | pas encore |

`path_template` serait le template de route FastAPI (p. ex. `/api/mssp/tenants/{id}`), afin que la cardinalité reste bornée.

## Tableaux de bord Grafana suggérés

### Santé du plan de contrôle MSSP

- Disponibilité des pods (style Wazuh : tuiles vertes/jaunes/rouges par Deployment)
- `soctalk_api_request_duration_seconds` p50/p95/p99 par `path_template`
- `soctalk_install_tenants_total` empilé par état, santé du parc en un coup d'œil
- Heatmap de `soctalk_tenant_adapter_heartbeat_age_seconds` par tenant, repérez un client qui se dégrade avant qu'il n'appelle

### Coût par tenant

- `rate(soctalk_tenant_llm_tokens_total[1h])` empilé par tenant, les plus gros consommateurs de l'heure
- Total quotidien des tokens × le $/Mtok de votre fournisseur = projection de coût
- Épuisement (burn-down) par rapport au budget de tokens par exécution (`case_runs.tokens_budget`, valeur par défaut du modèle 200 000 ; le repli via la variable d'environnement `SOCTALK_CASE_RUN_TOKEN_BUDGET` avec une valeur par défaut de 15 000 ne s'applique que lorsque la ligne n'a pas de valeur), à quelle fréquence une seule exécution fait-elle exploser le budget ?

### Niveau de service

- `rate(soctalk_tenant_investigations_opened_total[5m])`: débit d'entrée
- `rate(soctalk_tenant_investigations_closed_total{disposition="escalate"}[1h])`: taux d'escalade (ceci figure aussi sur la page [Analytics](/fr-fr/mssp-ui#analytics))
- `soctalk_tenant_pending_reviews`: humains en retard / en avance sur la file

## Logs

JSON vers stderr par défaut, via `structlog`. L'API et l'orchestrateur sont configurables via :

| Variable d'env | Défaut | Effet |
|---|---|---|
| `SOCTALK_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `SOCTALK_LOG_FILE` | non défini | Si défini, reflète stderr vers un fichier |
| `SOCTALK_LOG_FORMAT` | `json` | `json` ou `console` (lisible par un humain pour le dev) |

Chaque ligne de log inclut `tenant_id` et `case_id` le cas échéant, de sorte que la stderr d'un seul pod SocTalk est divisible par tenant en aval.

Les pods worker (runs-worker par tenant) émettent la même forme. Agrégez-les dans votre pipeline de logs habituel (Loki, Elasticsearch, CloudWatch).

## Traçage

L'instrumentation OpenTelemetry **n'est pas** câblée dans cette version. Les spans pour le traitement des requêtes API, l'exécution des nœuds LangGraph et les appels LLM sont suivis comme une fonctionnalité prévue ; aujourd'hui, la seule surface « pourquoi ce cas a-t-il pris 90 secondes » ce sont les logs structurés + les histogrammes Prometheus ci-dessus.

## Exemples d'alertes

Extraits PromQL pour des alertes courantes :

### Tenant dégradé depuis trop longtemps

```promql
soctalk_tenant_adapter_heartbeat_age_seconds > 1800
```

Alerte : le tenant est silencieux depuis plus de 30 min. Appelez l'astreinte.

### Pic d'erreurs API

```promql
sum by (path_template) (
  rate(soctalk_api_request_duration_seconds_count{status=~"5.."}[5m])
) > 0.5
```

### Épuisement du budget LLM

```promql
sum by (tenant_id) (
  rate(soctalk_tenant_llm_tokens_total[1h])
) > 5000000
```

Ajustez le seuil au débit normal attendu de votre installation. Un pic signifie généralement qu'un modèle boucle sur `needs_more_info`.

## Ce qui n'est pas ici

- **Traces distribuées des décisions HIL**: les humains ne sont pas dans les traces OTel ; le journal d'audit est la source de vérité sur qui a décidé quoi.
- **SLO de bout en bout par client**: Analytics le fait dans l'UI ; le PromQL correspondant est sur la feuille de route en tant que tableaux de bord canoniques (aujourd'hui, ils sont définis par installation).
- **Monitoring synthétique**: hors périmètre pour SocTalk lui-même. Utilisez votre service de sonde externe habituel contre l'URL du SOC client.
