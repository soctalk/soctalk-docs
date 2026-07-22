# CLI et scripts

Les opérateurs effectuent la plupart des tâches via l'[interface MSSP](/fr-fr/mssp-ui) ou l'[API REST](/fr-fr/reference/api). La surface CLI est réduite et existe pour l'amorçage, les environnements de développement et les opérations hors ligne.

## Points d'entrée intra-pod

Ceux-ci s'exécutent à l'intérieur de `soctalk-system-api` (ou d'un Job à usage unique). Ils utilisent les identifiants Postgres montés dans le pod et la configuration du chart — aucun état externe.

### Amorçage

Il n'existe pas de CLI d'amorçage séparé dans cette version — la commande d'initialisation du pod API du chart exécute l'amorçage en ligne (migrations, mots de passe des rôles, ligne d'organisation, utilisateur administrateur optionnel). Voir [Installation — Migrations et amorçage](/fr-fr/install#migrations-and-bootstrap-run-automatically).

### Test de bon fonctionnement du LLM

Il n'y a pas de CLI `soctalk.llm.smoke_test` dans cette version. Pour vérifier rapidement qu'un LLM configuré est accessible, consultez [Fournisseurs LLM — Test de bon fonctionnement](/fr-fr/integrate/llm-providers#sanity-test) pour l'expression Python en une ligne.

### `soctalk-auth` (assistant intra-pod)

Le seul assistant CLI de première classe dans cette version. Une seule sous-commande : `set-password`.

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password user@example.com
```

Demande un nouveau mot de passe (ou le lit depuis `SOCTALK_PASSWORD`), recherche l'utilisateur, définit le mot de passe haché et journalise `auth.password.reset.admin`. Utile pour des réinitialisations forcées sans passer par l'API. La ligne de l'utilisateur doit déjà exister ; `soctalk-auth` ne crée pas de lignes.

### `soctalk` (point d'entrée de l'orchestrateur)

`soctalk` est le point d'entrée de l'orchestrateur — il exécute le superviseur LangGraph + les workers. En V1, le pod API embarque l'orchestrateur (pas de Deployment `soctalk-system-orchestrator` séparé). Généralement non invoqué à la main en dehors du développement.

### Pas encore de `soctalk-cli` polyvalent

La première ébauche de cette page listait des commandes de gestion des tenants sous un binaire `soctalk-cli` qui n'existe pas dans la version actuelle. Les actions sur les tenants (suspend, resume, decommission, rotate-admin) passent aujourd'hui par l'[API REST](/fr-fr/reference/api). La surface CLI pour les opérations sur les tenants est prévue pour une version future.

## Côté dépôt : recettes `justfile`

Le [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) à la racine du dépôt contient des recettes utilisées pendant le développement et la publication :

| Recette | Ce qu'elle fait |
|---|---|
| `just build-api` | Construit l'image de conteneur de l'API |
| `just build-orchestrator` | Construit l'image de conteneur de l'orchestrateur |
| `just build-frontend` | Construit l'image de conteneur du frontend SvelteKit |
| `just build-mock-endpoint` | Construit l'image du simulateur d'endpoint fictif |
| `just run` | Exécute la pile de développement via docker-compose |
| `just push-all` | Pousse toutes les images vers le registre configuré |
| `just release` | Construit et pousse toutes les images (`build-all` + `push-all`). La publication versionnée du chart, le tag git et la GitHub Release sont produits séparément par la GitHub Action **Cut k8s Release**, pas par cette recette. |

## Côté dépôt : `scripts/`

| Script | Objectif |
|---|---|
| `scripts/dev-up.sh` | Démarre un cluster de développement k3d mono-nœud avec SocTalk et un tenant pré-alimenté |
| `scripts/local-up.sh` | Idem, mais sur l'instance k3s de l'hôte plutôt que k3d |
| `scripts/local-down.sh` | Démonte un cluster `local-up.sh` |
| `scripts/e2e-l1-l2-k3d.sh` | Configuration k3d à deux clusters (MSSP L1 + tenant L2) pour une validation e2e complète |
| `scripts/seed-mssp-demo-data.py` | Alimente Postgres avec des tenants de démonstration (`acme-corp`, `wayne-industries`, `stark-defense`) et rejoue des Alertes Wazuh via l'indexeur en préparation de captures d'écran |
| `scripts/dump_openapi.py` | Exporte le schéma OpenAPI de FastAPI en JSON ; la source de vérité à partir de laquelle la référence API REST des docs est générée |
| `scripts/verify-pages-visual.py` | Contrôle de régression visuelle Playwright contre l'interface SocTalk de développement |

Tous s'attendent à être exécutés depuis la racine du dépôt. Lisez l'en-tête du script pour connaître les arguments exacts.

## Côté dépôt : Packer

Pour les constructions d'images de VM, voir [Téléchargements → Construisez-la vous-même](/fr-fr/downloads#build-it-yourself).

## Opérations en environnement isolé

Pour les installations sans accès internet, l'API + `soctalk-auth` suffisent à faire fonctionner SocTalk sans toucher à l'interface :

```bash
# L'amorçage se produit automatiquement dans la commande d'initialisation du pod
# API — aucune étape supplémentaire. Installez simplement le chart avec
# install.bootstrapAdmin.* défini.

# Ou, si ceux-ci n'ont pas été fournis, définissez le mot de passe administrateur après l'installation :
kubectl -n soctalk-system exec deploy/soctalk-system-api -- \
  soctalk-auth set-password admin@example
# Lisez les identifiants de l'administrateur.
kubectl -n soctalk-system get secret soctalk-system-bootstrap-admin \
  -o jsonpath='{.data.password}' | base64 -d; echo

# Intégrez un tenant via l'API.
curl -k -c jar -X POST http://soctalk-system-api:8000/api/auth/login \
  -d '{"email":"admin@example","password":"..."}'
curl -k -b jar -X POST http://soctalk-system-api:8000/api/mssp/tenants/onboard \
  -d '{"slug":"acme","display_name":"Acme","profile":"persistent"}'
```

Pour le mot de passe existant de l'administrateur d'amorçage émis par le Job d'amorçage, voir [Installation → Migrations et amorçage](/fr-fr/install#migrations-and-bootstrap-run-automatically).

## Repères dans le code source

| Concept | Fichier |
|---|---|
| Amorçage (en ligne) | [`charts/soctalk-system/templates/30-api.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/30-api.yaml) (commande d'initialisation) |
| Fabrique de fournisseurs LLM | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Source de `soctalk-auth` | [`src/soctalk/core/cli/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/cli/auth.py) |
| Point d'entrée de l'orchestrateur `soctalk` | [`src/soctalk/main.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/main.py) |
| `justfile` | [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) |
| `scripts/` | [`scripts/`](https://github.com/soctalk/soctalk/tree/main/scripts) |
