# Audit du chart Helm de tenant


> **Méthodologie d'audit** : ce document consigne la classification attendue à partir de l'inspection du chart. Des exécutions réelles de `helm template` et une comparaison rendu-vs-classification sont requises lors de la validation de pré-version. Tout objet trouvé dans un rendu réel qui n'est pas listé ici devient un point de contrôle d'examen.

## Périmètre de l'audit

Charts à auditer :

| Amont | Source amont | Version cible |
|---|---|---|
| Wazuh | Chart Helm `wazuh/wazuh-kubernetes` (communautaire) ou chart OCI officiel | Dernière version stable 4.x prenant en charge la HA à manager unique |
| linux-ep | Sous-chart SocTalk d'agent d'endpoint L2 (clé de composant `components.linuxep`) | `0.2.0` |
| MISP | **reporté à une version future** | |

Le chart `soctalk-tenant` vend exactement deux sous-charts, `wazuh` et `linux-ep`. Pour chacun, nous vendons les templates de manifeste (avec correctifs si nécessaire) comme dépendances de sous-chart de `charts/soctalk-tenant/` : l'épinglage de version est strict. `Chart.yaml` utilise un semver exact avec digest (OCI) lorsque disponible.

TheHive et Cortex sont des **intégrations externes**, atteintes sur le réseau et configurées par tenant (voir /fr-fr/integrate/thehive et /fr-fr/integrate/cortex). Ce ne sont pas des sous-charts vendus, ils sont donc hors périmètre pour cet audit de chart.

## Règles de classification

Pour chaque objet rendu, classer comme :

- **NS-OK** : objet à portée de namespace qui réside dans `tenant-<slug>`. Sûr, attendu.
- **CLUSTER-PREREQ** : objet à portée de cluster qui doit être installé une seule fois par le chart `soctalk-system` ou documenté comme relevant de la responsabilité de l'administrateur de cluster MSSP. Le chart de tenant ne doit pas les réinstaller par tenant.
- **FORBIDDEN** : type d'objet ou capacité que nous refusons d'autoriser dans un chart de tenant même lorsque l'amont le déclare (par exemple, un `ClusterRoleBinding` à l'échelle du cluster donnant à Wazuh un accès privilégié). Doit être supprimé par correctif.
- **PATCH** : conserver l'objet mais le modifier (par exemple, retirer les volumes `hostPath`, supprimer le `securityContext` privilégié, réduire les requêtes de ressources par défaut).

## Classification attendue par chart amont

### Wazuh

Les charts Wazuh rendent typiquement :

| Objet | Classe attendue | Notes |
|---|---|---|
| `Deployment` / `StatefulSet` (manager, indexer, dashboard) | NS-OK | Pods du cœur de la stack |
| `Service` (manager API, indexer, dashboard, agent ingress 1514/1515) | NS-OK | |
| `ConfigMap` (ossec.conf, indexer.yml, dashboard.yml) | NS-OK | |
| `Secret` (mot de passe admin, certificats TLS mutuels) | NS-OK | Amorcé par tenant lors du provisionnement |
| `PersistentVolumeClaim` (données indexer, données manager) | NS-OK | Taille définie via les values du tenant |
| `ServiceAccount` | NS-OK | SA par tenant |
| `Role` + `RoleBinding` (pour l'élection de leader si utilisée) | NS-OK | À portée de namespace uniquement |
| `NetworkPolicy` (fournie par le chart) | PATCH | Remplacer par une NP rendue par SocTalk pour une posture cohérente ; ne pas laisser les valeurs par défaut de l'amont écraser le default-deny |
| Références `StorageClass` | CLUSTER-PREREQ | Le MSSP doit fournir un provisionneur dynamique ; `storageClassName` est une entrée de values |
| `Ingress` | PATCH ou désactiver | Le protocole agent de Wazuh sur 1514 n'est pas du TLS standard, donc un `Ingress` HTTP/HTTPS n'est pas approprié. Retirer toute ressource `Ingress`. Pour le `Service` d'agent-ingress, le chart doit rendre la variante correspondant à `tenant.wazuhIngress.mode` : un Service `LoadBalancer` pour des IP de LB par tenant (par défaut) ou un Service `ClusterIP` lorsque l'installation utilise le repli HAProxy in-cluster. Voir [Wazuh Ingress](/fr-fr/reference/wazuh-ingress). |
| `PodSecurityPolicy` / `SecurityContextConstraints` | CLUSTER-PREREQ si présent ; interdit sinon | PSP est déprécié ; si présent, supprimer. Le SCC OpenShift n'est pas dans le périmètre de cette version |
| `CustomResourceDefinition` | **FORBIDDEN** dans le chart de tenant | Si le chart tente d'installer une CRD, déplacer vers le chart `soctalk-system` ou documenter comme prérequis |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** dans le chart de tenant | Ne jamais installer de RBAC à l'échelle du cluster depuis un namespace de tenant |
| Pods privileged/host-network/hostPath | **FORBIDDEN** ; supprimer par correctif | Le manager Wazuh n'en a pas besoin pour un fonctionnement standard ; l'indexer non plus. Si un sous-chart exige `hostPath` pour les logs, corriger en `emptyDir` + PVC |
| `PodDisruptionBudget` | NS-OK | Optionnel ; dépend du mode HA de Wazuh. La topologie à manager unique peut l'omettre |

**Correctifs attendus** :
1. Retirer tout `ClusterRole`/`ClusterRoleBinding` du rendu.
2. Retirer toute ressource à portée de cluster (`ValidatingWebhookConfiguration`, etc.).
3. Rendre le `Service` d'agent-ingress pour correspondre à `tenant.wazuhIngress.mode` (`LoadBalancer` pour des IP de LB par tenant, `ClusterIP` pour le repli HAProxy in-cluster).
4. Retirer les ressources `Ingress`. Les dashboards Wazuh sont exposés via un chemin séparé géré par SocTalk ; le protocole agent sur 1514 n'est pas du HTTP, donc l'`Ingress` K8s ne s'applique pas.
5. S'assurer que tous les pods possèdent `securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }` ; corriger si l'amont configure autrement.
6. Épingler les images sur des digests, pas sur `latest`.

### linux-ep

Le sous-chart d'agent d'endpoint L2 (`components.linuxep`). Son inventaire rendu est restreint : le chart émet un unique `StatefulSet` et consomme un Secret existant par `secretKeyRef` plutôt que de rendre ses propres objets d'identifiants.

| Objet | Classe attendue | Notes |
|---|---|---|
| `StatefulSet` (agent d'endpoint) | NS-OK | La seule charge de travail que le sous-chart rend ; à portée de namespace |
| `Secret` (identifiants d'enrôlement / d'agent) | Consommé, pas rendu | Référencé via `secretKeyRef` ; amorcé par tenant lors du provisionnement, en dehors de ce sous-chart |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** dans le chart de tenant | Ne jamais installer de RBAC à l'échelle du cluster depuis un namespace de tenant |

**État actuel et correctifs attendus** :
1. Le sous-chart définit par défaut `securityContext.privileged: true` sur le pod de l'agent. C'est un comportement uniquement PoC et un risque réel, il doit être restreint (retirer privileged, `allowPrivilegeEscalation: false`) avant tout usage en production.
2. Confirmer qu'aucun `ClusterRole`/`ClusterRoleBinding` n'apparaît dans le rendu.
3. Épingler les images sur des digests, pas sur `latest`.

### Intégrations externes (hors périmètre de l'audit)

TheHive et Cortex sont des **intégrations externes**, pas des sous-charts vendus, ils sont donc hors périmètre pour cet audit de chart. SocTalk les atteint sur le réseau par tenant ; il n'y a aucun objet TheHive/Cortex in-namespace à classer. Configurez-les via /fr-fr/integrate/thehive et /fr-fr/integrate/cortex.

## Liste des prérequis de cluster (intégrée au guide d'installation + vérification des prérequis du chart `soctalk-system`)

À l'issue de l'audit, les éléments suivants sont **hors périmètre pour le chart de tenant** et doivent exister dans le cluster avant que `soctalk-tenant` ne soit appliqué à un namespace :

| Prérequis | Pourquoi | source |
|---|---|---|
| K3s 1.30+ (ou K8s 1.30+ compatible) | Base plus `ValidatingAdmissionPolicy` v1 | Responsabilité du MSSP |
| CNI appliquant les NP (Cilium en principal, Calico en alternative) | Application de l'isolation | Responsabilité du MSSP |
| cert-manager | TLS pour l'Ingress, émission de certificats Wazuh par tenant | Responsabilité du MSSP ; le guide d'installation fournit une recette `helm install` |
| Contrôleur d'Ingress (Traefik par défaut dans K3s, ingress-nginx courant) | Routage de l'UI MSSP + UI Client + WebUI par tenant | Responsabilité du MSSP |
| `StorageClass` dynamique (local-path, longhorn, CSI de fournisseur cloud, etc.) | Provisionnement des PVC | Responsabilité du MSSP |
| `VolumeSnapshotClass` en cas d'utilisation de snapshots CSI | Runbook de sauvegarde/restauration (docs uniquement) | Optionnel |

Le chart `soctalk-system` inclut un hook de pré-installation (`helm.sh/hook: pre-install`) qui vérifie :
- CNI appliquant les NP actif (sonde les marqueurs de Cilium ou Calico)
- Présence des CRD de cert-manager
- `StorageClass` par défaut définie

Le hook échoue rapidement avec un message d'erreur exploitable si l'un d'eux est manquant.

## Stratégie de correctifs

Deux voies :

1. **Surcharges pilotées par les values** : privilégier les values de chart amont qui désactivent l'objet indésirable (par exemple, `ingress.enabled: false`, `networkPolicy.enabled: false` si celle de l'amont est plus permissive que la nôtre, `rbac.create: true` limité au namespace uniquement).
2. **Overlay de type Kustomize** (l'intégration `kustomize` de Helm ou un hook post-render) pour les objets qui ne peuvent pas être désactivés via les values : retirer les `ClusterRole`, supprimer les volumes `hostPath`, définir le `securityContext`.

Nous vendons les charts amont comme charts frères sous `charts/` (`charts/wazuh`, `charts/linux-ep`) référencés par chemin relatif, et non comme références `helm repo` (helm les copie dans le package au moment du build). Cela nous permet de :
- Épingler des versions exactes (pas de mises à jour surprises de l'amont)
- Appliquer les correctifs au besoin sans dépendre de l'acceptation d'une PR amont
- Signer notre bundle comme un artefact unique (une version future lorsque cosign arrivera)

Si l'amont ne répond pas à nos besoins après correctifs, le repli consiste à écrire des templates natifs SocTalk qui appellent les mêmes images de conteneur avec nos propres manifestes. La validation de pré-version décide de cela par chart.

## Inconnues connues (résolues par la validation de pré-version)

Éléments qui nécessitent des exécutions réelles de `helm template` + inspection pour confirmation :

- [ ] **Wazuh** : la version de chart choisie nécessite-t-elle des CRD pour un déploiement piloté par opérateur ? Si oui, déplacer les CRD vers le chart `soctalk-system`.
- [ ] **linux-ep** : l'agent d'endpoint nécessite-t-il un accès au niveau de l'hôte (hostPath, host network) qui doit être corrigé ou restreint ?
- [ ] **Tous les charts** : y a-t-il un `Job` ou un `CronJob` qui s'exécute avec un `ServiceAccount` au-delà du namespace ? Corriger vers un SA local au namespace.
- [ ] **Tous les charts** : y a-t-il un `initContainer` avec `privileged: true` ou des montages `hostPath` ? Corriger ou remplacer.
- [ ] **Tous les charts** : les `resources.requests` et `limits` par défaut : comparer au profil de dimensionnement ; surcharger dans les values au besoin.

Chaque élément ouvert devient une entrée de checklist de validation de pré-version. Le résultat du spike est un tableau de classification renseigné et le chart corrigé maintenu sous `charts/wazuh` / `charts/linux-ep`.

## Artefact de sortie (produit avant la livraison)

Le spike produit :

1. **Inventaire d'objets classifiés** (remplissage des tableaux de la section 3 avec les objets réellement rendus).
2. **Bundles de charts corrigés** maintenus sous `charts/wazuh/` et `charts/linux-ep/` avec des versions épinglées.
3. **Liste des prérequis de cluster** fusionnée dans le guide d'installation.
4. **Fragment de schéma de values** pour chaque sous-chart (entrées que SocTalk fournira par tenant).

La complétion du spike est un prérequis pour l'implémentation du chart Helm.
