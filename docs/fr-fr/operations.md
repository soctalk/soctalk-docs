# Opérations quotidiennes

Tâches que les opérateurs MSSP exécutent sur une installation SocTalk active. Si ce n'est pas déjà fait, lisez d'abord la [visite guidée de l'interface MSSP](/fr-fr/mssp-ui) — elle recense toutes les pages référencées ci-dessous.

## File d'attente des enquêtes

Ouvrez **Enquêtes** pour voir les cas actifs de chaque tenant sur une seule vue. Filtres : tenant, gravité. Cliquez sur une ligne pour afficher la chronologie du cas, la conversation et les propositions.

![Liste des enquêtes](/screenshots/investigations-list.png)

## File d'attente d'examen des propositions

**Examens** est la file inter-tenant des propositions de l'AI en attente d'un humain. Chaque action approuver / rejeter / demander plus d'informations met à jour la ligne d'examen dans la base de données (et le journal d'audit). Il n'y a **aucun outbox** en V1 — le pipeline d'exécution / de notification en aval figure dans la feuille de route.

![File d'examen](/screenshots/review-queue.png)

## Tenant bloqué en `provisioning`

**Symptôme :** la ligne du tenant d'un nouveau client reste à l'état `provisioning` pendant plus de 15 min.

1. Vérifiez le statut de la release Helm :
   ```bash
   helm status tenant-<slug> -n tenant-<slug>
   ```
2. Vérifiez les événements du pod :
   ```bash
   kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp | tail -30
   ```
3. Causes fréquentes :
   - `StorageClass` manquante ou provisioner hors service → PVC bloqués en `Pending`. Provisionnez le stockage ; `kubectl describe pvc` affiche la raison.
   - ResourceQuota trop faible pour la requête de l'indexeur Wazuh. Augmentez la ResourceQuota du tenant via `helm upgrade` avec de nouvelles valeurs.
   - Échecs de récupération d'image → vérifiez l'authentification du registre et le pare-feu.

Si une tentative de provisionnement ne peut pas se rétablir, décommissionnez et réessayez :

```bash
# Depuis l'interface MSSP : détail du tenant → Décommissionner → force=true
# Ou via l'API :
curl -X POST https://mssp.../api/mssp/tenants/<id>:decommission?force=true
```

## Tenant à l'état `degraded`

`degraded` est défini par le contrôleur de provisionnement lors d'un échec de provisionnement, ou défini explicitement via l'API. **Il n'existe aucune boucle d'auto-dégradation basée sur l'âge du heartbeat de l'adaptateur dans cette release** ; la métrique `soctalk_tenant_adapter_heartbeat_age_seconds` est destinée à vos alertes.

1. Vérifiez le pod de l'adaptateur :
   ```bash
   kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=200
   ```
2. Vérifiez l'egress de la NetworkPolicy (l'adaptateur doit atteindre l'API `soctalk-system`) :
   ```bash
   hubble observe --from-pod tenant-<slug>/soctalk-adapter-<pod>
   ```
3. Redémarrez l'adaptateur :
   ```bash
   kubectl -n tenant-<slug> rollout restart deploy/soctalk-adapter
   ```

Si le plan de données est sain mais que l'adaptateur ne parvient toujours pas à atteindre `soctalk-system`, inspectez la NetworkPolicy `adapter-egress`.

## Rotation de la clé LLM par tenant

1. Admin MSSP → détail du client → Paramètres → LLM → collez la nouvelle clé → Enregistrer (ou `PATCH /api/mssp/tenants/{id}/llm`).
2. Le magasin de référence de SocTalk est `IntegrationConfig.llm_api_key_plain` dans Postgres. Le contrôleur de provisionnement matérialise cette valeur dans `Secret/tenant-llm-key` du namespace du tenant (monté par le Deployment runs-worker) et, en option, en reflète une référence dans `soctalk-system/<tenant-id>-llm` à des fins d'audit.
3. SocTalk redémarre au mieux le Deployment `soctalk-runs-worker` dans `tenant-<slug>` afin que la nouvelle clé prenne effet lors de la prochaine prise en charge d'une enquête.

## Rotation des secrets de bootstrap du plan de données

Il n'existe aucune commande `soctalk-cli rotate-*` dans cette release — cette voie était documentée dans des brouillons antérieurs. Aujourd'hui :

- **Mots de passe admin Wazuh / TheHive / Cortex :** patchez le Secret concerné dans le namespace du tenant, puis redémarrez le pod affecté. La réexécution du bootstrap du chart au démarrage du pod prendra en compte le nouvel identifiant.
- **Secret partagé `authd` de Wazuh :** patchez `Secret/wazuh-authd-secret` dans `tenant-<slug>`, redémarrez le manager Wazuh. Tous les agents existants doivent se réenrôler avec le nouveau secret ; distribuez-le via votre canal sécurisé habituel.

Un CLI enveloppant pour ces rotations figure dans la feuille de route.

## Analytique

**Analytique** agrège le volume de triage, les résultats des propositions, le MTTR et la consommation de budget par tenant. Utilisez-la pour la planification de capacité, l'évaluation des modèles et l'examen des SLA.

![Analytique](/screenshots/analytics.png)

## Examen du journal d'audit

Le journal d'audit à l'échelle du MSSP se trouve dans **Interface → onglet Audit**. Filtrez par tenant, acteur, action ou horodatage. Pour les exports de conformité, utilisez l'API :

```bash
curl 'https://mssp.../api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

![Journal d'audit](/screenshots/audit-log.png)

## Restauration de la base de données (reprise après sinistre)

Les sauvegardes sont gérées en externe par le MSSP (Velero, snapshots de cluster, `pg_dump` externe). Pour restaurer :

1. Arrêtez l'API SocTalk :
   ```bash
   kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=0
   ```
   (Le chart V1 intègre l'orchestrateur dans le pod de l'API — pas de Deployment `soctalk-system-orchestrator` séparé.)
2. Restaurez les données Postgres depuis votre sauvegarde.
3. Redémarrez l'API : `kubectl -n soctalk-system scale deploy soctalk-system-api --replicas=2` (ou votre nombre de réplicas habituel).

Les PVC du plan de données du tenant suivent le même schéma : restaurez par namespace, puis exécutez `helm upgrade` sur la release du tenant pour les rattacher.

## Urgence : désactiver immédiatement un tenant

L'action **Suspendre** de l'interface dans cette release fait passer l'état du tenant à `suspended` et empêche l'orchestrateur de planifier de nouvelles enquêtes — **mais elle ne réduit pas l'échelle des charges de travail**. Pour une coupure effective, exécutez les étapes ci-dessous (mise à l'échelle de tous les deployments + application d'une NetworkPolicy deny-all en ceinture et bretelles) :

```bash
# 1. Mettre à zéro toutes les charges de travail du namespace du tenant. C'est
#    l'arrêt définitif — les pods disparaissent.
kubectl -n tenant-<slug> get deploy,statefulset -o name \
  | xargs -I {} kubectl -n tenant-<slug> scale {} --replicas=0

# 2. deny-all « ceinture et bretelles » pour que tout ce qui redémarrerait (par
#    exemple depuis un opérateur bloqué en réconciliation) soit isolé.
kubectl -n tenant-<slug> apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: emergency-deny-all }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
EOF
```

Inversez en supprimant la NetworkPolicy, en remettant les charges de travail à l'échelle de leurs nombres de réplicas d'origine, et en appelant **Reprendre** dans l'interface. **Reprendre** ne met également à jour que l'état en base de données dans cette release — cela ne restaurera pas les nombres de réplicas à votre place.

## Soupçon de fuite de données inter-tenant

Si vous soupçonnez un accès inter-tenant :

1. Vérifiez les exécutions récentes de la suite de tests RLS ; elles réussissent en CI pour chaque release.
2. Sondez directement la base de données :
   ```bash
   kubectl -n soctalk-system exec -it statefulset/soctalk-system-postgres -- \
     psql -U soctalk_app -d soctalk \
     -c "SET app.current_tenant_id='<tenant-a>'; SELECT tenant_id FROM events LIMIT 5;"
   ```
3. Si une fuite est confirmée, ouvrez un incident P1. RLS combiné à `FORCE ROW LEVEL SECURITY` est la dernière ligne de défense ; une fuite non corrigée indique un bug applicatif ou une mauvaise configuration de rôle Postgres.

## Erreurs fréquentes

- Exécuter les migrations en tant que `soctalk_app`. Les migrations nécessitent des identifiants `soctalk_admin` ; sous `soctalk_app`, elles échouent.
- Modifier directement les valeurs `soctalk-tenant` dans Helm. Cela contourne l'état de la base de données de SocTalk ; passez par l'API.
- Créer des namespaces `tenant-*` à la main. Les labels requis ne seront pas présents et SocTalk ne reconnaîtra pas le namespace. Utilisez le flux de création de tenant.
