# Contribuer

SocTalk est sous licence Apache 2.0. Les PR sont les bienvenues. Cette page couvre la boucle de développement et ce à quoi vous attendre lors d'un examen.

## Environnement de développement

Démarrez un cluster local prêt pour SocTalk :

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk
./scripts/dev-up.sh           # cluster dependencies only
```

`scripts/dev-up.sh` crée un cluster k3d et installe les prérequis au niveau du cluster :

- K3s avec Flannel + kube-proxy désactivés
- Cilium comme CNI avec application des NetworkPolicy
- cert-manager installé
- k3d local-path comme StorageClass par défaut

Il **ne** construit **pas** les images SocTalk, n'installe pas le chart SocTalk, n'intègre pas de tenants et n'amorce pas de données, des brouillons antérieurs de cette page prétendaient le contraire. Exécutez vous-même les étapes suivantes. Séquence typique après `dev-up.sh` :

```bash
just build-api build-frontend  # api image embeds the orchestrator in V1
helm install soctalk-system charts/soctalk-system \
  -n soctalk-system --create-namespace \
  --set install.bootstrapAdmin.email=dev@example \
  --set install.bootstrapAdmin.password=devpassword12
# migrations + bootstrap admin run in the API pod's init command
# sign in at https://<your-ingress>/ with the credentials you set above
```

Pour une boucle interne plus rapide (sans reconstruction d'image à chaque changement), consultez les conseils d'itération ci-dessous.

## Choisir votre boucle d'itération

Selon la convention du projet, préférez exécuter les services avec `uvicorn` / `pnpm dev` plutôt que le cycle build-push-redeploy de k3d :

```bash
# API (embeds the orchestrator in V1)
cd src && uvicorn soctalk.core.api.app_v1:app --reload --port 8000

# Frontend
cd frontend && pnpm dev
```

Pointez-les vers les Postgres / Wazuh / Cortex du cluster k3d via `kubectl port-forward`. L'itération se compte en secondes, pas en minutes.

## Organisation du dépôt

```text
src/                Python (control plane, AI pipeline, adapter, runs-worker)
frontend/           SvelteKit (MSSP + customer UI)
charts/             Helm charts (soctalk-system, soctalk-tenant, wazuh, linux-ep)
infra/packer/       VM image generation (see /downloads)
setup-wizard/       Go (first-boot setup wizard)
attack-simulator/   MITRE ATT&CK demo scripts
scripts/            Dev / e2e / seed scripts
alembic/            DB migrations
docker-compose*.yml Various dev composition files
justfile            Build / release recipes
```

Le site de documentation (ce site) réside dans un dépôt distinct, [`soctalk/soctalk-docs`](https://github.com/soctalk/soctalk-docs).

## Tests

Il n'y a pas de recettes `just test` / `just test-rls` / `just e2e-l1-l2` dans cette version ; c'est la forme prévue. Aujourd'hui, exécutez les tests directement avec pytest :

```bash
pytest tests/                          # full suite
pytest tests/v1/test_rls_isolation.py  # Postgres Row-Level Security suite
```

Les tests RLS sont non négociables ; ils vérifient l'isolation des données inter-tenants que promet le [Modèle de sécurité](/fr-fr/reference/security-model). La CI exécute la suite pytest complète sur chaque PR.

## Style

- Python : ruff + black. Appliqué par la CI.
- TypeScript : ESLint + Prettier avec la configuration du dépôt. Appliqué par la CI.
- Messages de commit : sujet sur une seule ligne, préfixe de commit conventionnel (`feat:`, `fix:`, `chore:`, `ci:`, `chart:`, …). Aucun corps requis.
- Pas de trailers co-authored-by / signed-off-by.

## Attentes concernant les PR

- **Des tests pour le changement.** Les nouveaux endpoints nécessitent des tests d'API ; les nouveaux nœuds de graphe nécessitent des tests de machine à états ; les changements de chart nécessitent des instantanés de templates rendus.
- **Une migration si vous avez touché un modèle.** Alembic génère automatiquement ; examinez le SQL généré pour en vérifier l'exactitude avant de committer.
- **Mettez à jour la documentation** dans [`soctalk-docs`](https://github.com/soctalk/soctalk-docs) si le changement affecte un comportement documenté. Nous ne sommes pas stricts à ce sujet pour les refactorisations internes uniquement ; nous le sommes pour tout ce qui touche l'utilisateur.
- **Des PR petites.** Les grosses PR mêlant plusieurs changements sont difficiles à examiner. Séparez la refactorisation de la fonctionnalité ; séparez le changement de chart du changement d'exécution.

## Examiner votre propre travail

Avant de demander un examen, exécutez codex sur vos changements :

```bash
codex review --uncommitted
```

C'est la même passe d'examen que nous exécutons au moment de la release. Elle détecte les problèmes évidents avant qu'un relecteur humain n'ait à le faire.

## Publier une release

Les releases sont taguées depuis `main`. Aujourd'hui, le flux comporte davantage d'étapes manuelles que ne le laisse entendre la recette `just release` prévue :

1. Incrémentez manuellement les versions dans `Chart.yaml` + `pyproject.toml`, committez, poussez.
2. Taguez le commit et poussez le tag (`git tag v0.1.x && git push --tags`).
3. `just release`: exécute `just build-all push-all`. Cela **construit et pousse uniquement les images de conteneurs** ; cela ne tague pas, ne publie pas les charts et ne crée pas de GitHub Release.
4. Le workflow GH `publish-images.yml` gère la publication de l'image vers ghcr.io lorsqu'il est déclenché.
5. La publication du chart vers `ghcr.io/soctalk/charts/` se fait manuellement avec `helm push` aujourd'hui.
6. `gh release create` pour créer la GitHub Release.
7. `build-packer-images.yml` (déclenchement manuel) construit l'[image de VM de démonstration](/fr-fr/downloads) dans les cinq formats et les attache à la GitHub Release.

La consolidation des étapes 1, 2, 5 et 6 dans la recette `just release` figure sur la feuille de route.

## Divulgation de sécurité

Si vous avez trouvé une vulnérabilité, **ne créez pas de ticket public.** Envoyez un e-mail à l'adresse indiquée dans SECURITY.md à la racine du dépôt. Nous répondons sous deux jours ouvrés.

## Licence

Apache 2.0. En soumettant une PR, vous acceptez de placer votre contribution sous la même licence.

## Reconnaissance

Le journal git est aujourd'hui le registre de référence des contributeurs ; un fichier CONTRIBUTORS.md dédié / `just update-contributors` est prévu.
