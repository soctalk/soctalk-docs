# Sauvegarde et restauration

Ce qu'un MSSP sauvegarde, à quelle fréquence, et comment restaurer. SocTalk conserve trois couches d'état ; chacune dispose de son propre chemin de sauvegarde et de restauration.

Cette page approfondit [Opérations quotidiennes, Restauration de la base de données](/fr-fr/operations#database-restore-disaster-recovery), qui décrit la même procédure au niveau du runbook. Utilisez cette page pour planifier la stratégie ; utilisez les opérations pour les commandes concrètes.

## Ce qu'il faut sauvegarder

### 1. Postgres (le plan de contrôle)

`soctalk-system-postgres-0` contient :

- Les lignes de Tenant + les événements de cycle de vie
- Les utilisateurs, sessions, rôles
- Les Enquêtes, cas, exécutions, propositions
- Les paramètres (LLM, intégrations, image de marque)
- Le journal `audit_log` en ajout seul et les `case_events` en event-sourcing
- Les lignes d'outbox en attente de consommation par l'exécuteur

**Tolérance de perte : zéro**. Une perte de Postgres = perte de l'historique d'audit, aucune Enquête récupérable.

### 2. Secrets Kubernetes dans `soctalk-system`

| Secret (nom rendu par le chart) | Contenu |
|---|---|
| `soctalk-system-llm-api-key` | Clé API du fournisseur LLM (valeur par défaut à l'échelle de l'installation) |
| `soctalk-system-bootstrap-admin` | E-mail + mot de passe de l'administrateur initial (si `install.bootstrapAdmin.password` est défini dans les values) |
| `soctalk-system-jwt-signing-key` | Clé de signature des jetons de session |
| `soctalk-system-adapter-signing-key` | Clé de signature des jetons d'adaptateur |
| `soctalk-system-postgres-admin-creds` | Identifiants Postgres `soctalk_admin` (migrations) |
| `soctalk-system-postgres-app-creds` | Identifiants Postgres `soctalk_app` (exécution) |
| `soctalk-system-postgres-mssp-creds` | Identifiants Postgres `soctalk_mssp` (requêtes inter-Tenant) |
| `soctalk-slack-creds` | Jetons Slack (fournis par l'environnement ; non rendus par le chart) |
| `soctalk-thehive-creds` | Clé API TheHive (fournie par l'environnement) |
| `soctalk-cortex-creds` | Clé API Cortex (fournie par l'environnement) |

Un ensemble de Secrets régénéré est récupérable, mais les sessions en cours sont rompues et les identifiants d'intégration doivent être recollés.

### 3. PVC par Tenant

Pour chaque namespace `tenant-<slug>` :

| PVC | Contenu |
|---|---|
| `wazuh-indexer-data` | Tout l'historique des Alertes et événements Wazuh |
| `wazuh-manager-data` | Enregistrements des agents Wazuh + état du manager |
| `cortex-data` | Cortex Elasticsearch (si Cortex est activé) |
| `thehive-data` | TheHive Cassandra (si TheHive est activé) |

Les Tenants du profil `poc` utilisent `local-path`, qui **n'offre aucune véritable garantie de persistance**: un redémarrage de nœud peut entraîner une perte de données. Les Tenants du profil `persistent` utilisent la StorageClass que l'installation marque comme par défaut ; sauvegardez conformément à la documentation de ce provisionneur.

## Cadence

| Couche | Cadence suggérée | Rétention |
|---|---|---|
| Sauvegarde logique Postgres (`pg_dump`) | quotidienne | 30 jours |
| Archivage WAL Postgres | continu | 7 jours |
| Instantané des Secrets Kubernetes | hebdomadaire + à chaque rotation | 90 jours |
| PVC par Tenant | selon le SLA de votre client (généralement quotidien pour les travaux de conformité) | selon le contrat |

Les clients soumis à la conformité (PCI, HIPAA, SOC 2) exigent souvent une rétention plus longue. Considérez ce qui précède comme le plancher.

## Sauvegarde Postgres

### pg_dump (logique)

S'exécute sur la base de données active, sans interruption de service. Restauration plus lente qu'une sauvegarde physique, mais se comprime bien et est portable.

```bash
kubectl -n soctalk-system exec soctalk-system-postgres-0 -- \
  pg_dump -U soctalk_app -d soctalk -Fc -Z 9 \
  > soctalk-$(date +%Y%m%d).pgdump
```

Redirigez vers votre stockage hors site habituel (S3, GCS, Azure Blob).

### Archivage WAL (point-in-time)

**Non câblé via le chart dans cette version.** Le chart `soctalk-system` n'expose pas de value `postgres.archiveCommand`, de sorte que le PITR nécessite un déploiement Postgres en dehors du StatefulSet fourni par le chart. Deux options :

1. **Exécuter Postgres en externe** (RDS managé / Cloud SQL / Azure Database for PostgreSQL). Configurez l'archivage WAL / le PITR selon la documentation du fournisseur. **Pointer le chart vers un Postgres externe n'est pas câblé via les values en V1**: le chart code en dur les détails de connexion du StatefulSet fourni dans les Secrets d'identifiants de rôle. Aujourd'hui, cela implique soit d'exécuter votre propre overlay helm qui corrige l'env `DATABASE_URL` du Deployment de l'API, soit de modifier `soctalk-system-postgres-app-creds` / `-mssp-creds` / `-admin-creds` après l'installation. Un bouton de values `postgres.external` est prévu dans la feuille de route.
2. **Archiveur sidecar** dans votre propre overlay helm (par exemple, [`spilo`](https://github.com/zalando/spilo) ou [`wal-g`](https://github.com/wal-g/wal-g) en tant que sidecar). Hors périmètre du chart ; s'exécute comme un Deployment distinct qui diffuse le WAL vers le stockage objet.

Dans tous les cas, le côté SocTalk reste inchangé, le plan de données traite Postgres comme une dépendance externe. Le câblage d'un `archiveCommand` côté chart est prévu pour une version future.

## Restauration (Postgres)

Consultez le [runbook](/fr-fr/operations#database-restore-disaster-recovery). Résumé :

1. Réduisez l'API à zéro pour que rien n'écrive (le chart V1 intègre l'orchestrateur dans le pod de l'API, un seul Deployment).
2. `pg_restore` du dump (nettoyez d'abord la base).
3. En cas d'utilisation du WAL : rejouez le WAL jusqu'au point-in-time souhaité.
4. Remontez l'API.

Après la restauration, le pod de l'API (qui embarque l'orchestrateur dans le chart V1) peut nécessiter un coup de pouce pour reprendre les exécutions en attente :

```bash
kubectl -n soctalk-system rollout restart deploy soctalk-system-api
```

## Sauvegarde des Secrets

Les Secrets K8s sont fastidieux à sauvegarder en toute sécurité en raison du matériel secret. Deux modèles :

### Sealed Secrets (recommandé)

Installez [Bitnami sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) une fois par cluster. Convertissez vos Secrets en ressources `SealedSecret` ; committez-les dans git. Le contrôleur du cluster les déchiffre au moment de l'installation. La perte d'un Secret est récupérable depuis git.

### Velero avec restic / kopia

[Velero](https://velero.io) sauvegarde les ressources Kubernetes (y compris les Secrets) ainsi que les PVC vers le stockage objet. Utilisez le [snapshotter CSI in-tree](https://velero.io/docs/main/csi/) pour les PVC et la sauvegarde de ressources standard pour les Secrets.

```bash
velero backup create soctalk-system-daily \
  --include-namespaces soctalk-system \
  --snapshot-volumes \
  --schedule "0 2 * * *"
```

## Sauvegarde des PVC par Tenant

Les Tenants du profil `persistent` utilisent une véritable StorageClass ; utilisez les outils d'instantané de ce provisionneur :

- **Longhorn** : sauvegardes planifiées intégrées vers S3
- **Rook/Ceph** : instantanés RBD ou `cephfs-mirror`
- **Volumes cloud CSI (EBS/Persistent Disk/Azure Disk)** : API d'instantané natives

Pour les utilisateurs de Velero, `velero backup create tenant-<slug>-daily --include-namespaces tenant-<slug> --snapshot-volumes` couvre à la fois les PVC et les objets K8s en une seule opération.

## Restauration par Tenant

1. Décommissionnez le Tenant existant (le cas échéant), cela supprime le namespace.
2. Restaurez les PVC dans un nouveau namespace à partir de l'instantané.
3. Intégrez un Tenant avec le même slug et le même profil via `POST /api/mssp/tenants/onboard`: le provisionnement est idempotent sur le namespace, de sorte que l'installation Helm adoptera les PVC restaurés.
4. Vérifiez que Wazuh voit les agents existants (aucun réenrôlement nécessaire si la restauration des PVC s'est déroulée proprement).

Si seul le plan de données est corrompu (et non le plan de contrôle SocTalk), le chemin le plus simple est `helm rollback tenant-<slug>` puis restaurer les PVC sur place.

## Exercice de restauration

Réalisez un exercice de restauration chaque trimestre. Choisissez un cluster non-prod ou un Tenant temporairement mis en veille. Limitez à 4 h. Documentez ce qui a échoué et mettez à jour cette page.

Défaillances courantes que l'exercice permet de détecter :

- Trou dans le WAL (l'archivage a pris du retard lors d'une défaillance de nœud)
- Secrets ayant fait l'objet d'une rotation depuis la dernière sauvegarde
- Incohérence de StorageClass entre le cluster et l'instantané
- Politique réseau empêchant le pod restauré d'atteindre le nouveau Postgres

## Ce qui n'est pas couvert ici

- La reprise après sinistre à l'échelle du cluster (perte de nœud du plan de contrôle, etc.), cela relève des opérations Kubernetes, non spécifiques à SocTalk. Consultez la documentation de votre distribution.
- La récupération des identifiants du fournisseur LLM, hors périmètre ; à gérer avec votre runbook habituel de rotation des secrets.
- Les sauvegardes des endpoints côté client, la responsabilité du client, non celle du MSSP.
