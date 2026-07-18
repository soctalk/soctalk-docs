# Mises à niveau

Les deux classes de charts se mettent à niveau via `helm upgrade`. Il s'agit aujourd'hui d'un runbook ; une API de mise à niveau à l'échelle de la flotte figure sur la feuille de route.

## Liste de vérification pré-vol

Avant toute mise à niveau :

1. **Lisez les [notes de version](https://github.com/soctalk/soctalk/releases)** de la version cible. Les migrations sont irréversibles (uniquement vers l'avant) ; un changement de schéma inattendu ne peut pas être annulé avec `helm rollback`.
2. **Mettez à niveau `soctalk-system` avant les tenants.** Une surface formelle de matrice de compatibilité (System → interface Versions, validation `controller.can_upgrade`) est décrite dans [Contrat de chart](/fr-fr/reference/chart-contract) comme cible architecturale, mais elle **n'est pas implémentée dans cette version**. En attendant sa livraison, suivez la ligne « combinaisons testées » des notes de version, mettez à niveau `soctalk-system` en premier, puis faites monter chaque tenant une fois que vous avez vérifié la mise à niveau côté système.
3. **Faites une sauvegarde.** Prenez un instantané de Postgres + de tous les PVC des tenants. Consultez la [section de restauration de la base de données](/fr-fr/operations#database-restore-disaster-recovery) dans les opérations.
4. **Effectuez un essai à blanc** avec `helm diff` :
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## Mettre à niveau `soctalk-system` (niveau installation)

Le fichier `soctalk-system-values.yaml` issu de l'installation épingle `image.tag` à la version d'origine. Surchargez-le à chaque mise à niveau afin que le nouveau chart rende la nouvelle image. Modifiez le fichier dans le contrôle de version, ou passez `--set image.tag=<new-version>` sur chacune des commandes ci-dessous.

Les migrations s'exécutent dans la commande d'initialisation du pod API (voir [Installation → Migrations et bootstrap](/fr-fr/install#migrations-and-bootstrap-run-automatically)). Un `helm upgrade` fait tourner le pod API ; la commande d'initialisation exécute `alembic upgrade head` avant le démarrage de la nouvelle application. Alembic est idempotent — le réexécuter sur un schéma à jour n'a aucun effet.

```bash
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 15m
```

Surveillez la migration :

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Si `--wait` reste bloqué, la cause la plus fréquente est un échec de migration — lisez les journaux d'initialisation.

### Rollback

```bash
helm rollback soctalk-system <revision> -n soctalk-system --wait
```

Si la mise à niveau a introduit une migration ayant touché aux données, `helm rollback` ne restaurera pas le schéma. Restaurez alors Postgres à partir de la sauvegarde antérieure à la mise à niveau, en complément.

## Mettre à niveau le plan de données d'un seul tenant

```bash
helm upgrade tenant-<slug> oci://ghcr.io/soctalk/charts/soctalk-tenant \
  --version <new-tenant-chart-version> \
  --namespace tenant-<slug> \
  -f /tmp/tenant-<slug>-values.yaml \
  --wait --timeout 15m
```

`/tmp/tenant-<slug>-values.yaml` est le fichier de valeurs rendu par SocTalk. Il n'existe aujourd'hui aucune CLI destinée aux opérateurs pour le générer ; récupérez les dernières valeurs rendues depuis le secret de la release Helm du tenant :

```bash
helm get values tenant-<slug> -n tenant-<slug> -a > /tmp/tenant-<slug>-values.yaml
```

Une commande `soctalk-cli render-values` a été mentionnée précédemment dans ce guide, mais elle n'existe pas — le seul outil CLI disponible aujourd'hui est `soctalk-auth`.

### Rollback par tenant

```bash
helm rollback tenant-<slug> <revision> -n tenant-<slug> --wait
```

Les rollbacks du plan de données d'un tenant sont plus sûrs que ceux au niveau système : les stacks OSS (Wazuh, TheHive, Cortex) stockent leurs propres données dans des PVC que `helm rollback` laisse intacts.

## Mise à niveau de la flotte (boucle manuelle)

```bash
# Lister les tenants.
kubectl get ns -l tenant=true,managed-by=soctalk \
  -o jsonpath='{.items[*].metadata.name}'

# Mettre à niveau chacun, en marquant une pause entre les deux.
for ns in tenant-acme tenant-beta tenant-gamma; do
  echo "upgrading $ns..."
  helm upgrade ${ns} oci://ghcr.io/soctalk/charts/soctalk-tenant \
    --version <new> -n $ns -f /tmp/${ns}-values.yaml --wait --timeout 15m
  kubectl -n $ns rollout status deploy/soctalk-adapter
  sleep 60   # laisser le heartbeat se stabiliser avant le suivant.
done
```

Une version future remplacera cette boucle par une API de mise à niveau de flotte compatible avec les déploiements canari.

## Ordre de mise à niveau

1. Les prérequis du cluster (CNI, cert-manager, ingress). Mettez-les à jour indépendamment.
2. Le chart `soctalk-system`. Exécute les migrations dans le cadre de la mise à niveau au niveau installation.
3. Le chart `soctalk-tenant`, un tenant à la fois, en surveillant les régressions.

Ne mettez jamais à niveau les charts de tenant avant `soctalk-system`. La matrice de compatibilité rejette les combinaisons hors plage et l'API refuse de provisionner de nouveaux tenants sur des versions incompatibles.

## Mises à niveau de chart de tenant avec changements incompatibles

Si le chart de tenant fait monter une version majeure de Wazuh, TheHive ou Cortex avec un changement de schéma :

1. Prenez d'abord un instantané des PVC du tenant.
2. Effectuez la mise à niveau pendant une fenêtre de faible trafic.
3. Vérifiez immédiatement après que les alertes circulent de bout en bout.
4. Soyez prêt à effectuer un `helm rollback` et à restaurer les PVC si le processus de migration de schéma du plan de données échoue.

Les projets OSS en amont livrent occasionnellement des changements incompatibles. L'[audit des charts](/fr-fr/reference/chart-audit) épingle les versions exactes des sous-charts ; la montée de ces versions est explicite et testée avant chaque version.
