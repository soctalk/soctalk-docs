# Profil de dimensionnement pour les installations pilotes


## Profils de référence

Deux tailles d'hôte de référence pour cette version.

### small-dev

Destiné à : le développement, les démonstrations, les POC mono-tenant.

| Ressource | Valeur |
|---|---|
| CPU | 4 vCPU |
| RAM | 16 Go |
| Disque | 100 Go SSD |
| Tenants max | **1–2** |
| Plan de contrôle SocTalk réservé | ~2 Go RAM, 1 vCPU |
| Budget par tenant | ~6–8 Go RAM, 1–1,5 vCPU |

Les temps de démarrage sont plus lents ici ; le SLO `<30 min to OSS stack healthy` s'applique.

### pilot-prod

Destiné à : un MSSP exécutant de vrais clients pilotes, 3–5 tenants.

| Ressource | Valeur |
|---|---|
| CPU | 8 vCPU |
| RAM | 32 Go |
| Disque | 500 Go SSD |
| Tenants max | **3–5** |
| Plan de contrôle SocTalk réservé | ~3 Go RAM, 1–2 vCPU |
| Budget par tenant | ~5–7 Go RAM, 1–1,5 vCPU |

Les temps de démarrage relèvent du SLO `<15 min to OSS stack healthy`.

## Empreinte par tenant (estimations)

Ce sont des valeurs de départ pour `ResourceQuota` et `LimitRange` dans le chart du tenant. La validation pré-version mesure les valeurs réelles ; celles-ci remplacent ces estimations dans les valeurs finales.

| Composant | Requête RAM | Limite RAM | Requête CPU | Limite CPU | Disque (PVC) |
|---|---|---|---|---|---|
| Wazuh manager | 512 Mo | 1 Go | 200 m | 500 m | 20 Go |
| Wazuh indexer (fork OpenSearch) | 2 Go (heap 1 Go) | 4 Go (heap 2 Go) | 500 m | 2000 m | 50 Go |
| Wazuh dashboard | 512 Mo | 1 Go | 100 m | 500 m | |
| Filebeat | 128 Mo | 256 Mo | 50 m | 200 m | |
| linux-ep (agent d'endpoint L2) | 256 Mo | 512 Mo | 100 m | 500 m | |
| Adaptateur SocTalk | 128 Mo | 256 Mo | 50 m | 200 m | |
| **Budget réservé par tenant** | **~8 Go en requête, ~16 Go en limite** | | **~2,2 vCPU en requête, ~7,7 vCPU en limite** | | **~120 Go** |

TheHive et Cortex sont des intégrations externes, pas des sous-charts fournis d'office, ils s'exécutent donc en dehors du namespace du tenant et ne font pas partie de cette empreinte par tenant ; dimensionnez-les là où ils sont hébergés. La pile in-namespace fournie d'office est Wazuh plus l'agent linux-ep, de sorte que le budget réservé ci-dessus conserve une marge sur les pods in-namespace actuels.

Note : les limites sont des plafonds de pointe ; l'usage soutenu est plus proche des requêtes. Exécuter 3 tenants sur un hôte 8 vCPU / 32 Go / 500 Go signifie :
- RAM : ~24 Go de requêtes (tient), ~48 Go de limites (nécessite un réglage soigneux du surengagement).
- CPU : ~6,6 vCPU de requêtes (tient avec le plan de contrôle), les pointes se partagent le total.
- Disque : ~360 Go de PVC de tenants (tient avec une marge pour le plan de contrôle + la base de données SocTalk).

C'est pourquoi `pilot-prod` plafonne à 5 tenants ; au-delà de 5, les limites de mémoire commencent à se heurter à la capacité du nœud, même en tenant compte du surengagement.

## Formule du nombre maximal de tenants par nœud

Approximation :

```
max_tenants = floor((node_total_RAM - control_plane_RAM - safety_margin) / per_tenant_RAM_request)
```

- `control_plane_RAM` : 2 Go (small-dev) ou 3 Go (pilot-prod) pour SocTalk + Postgres + contrôleur d'ingress + Cilium + cert-manager.
- `safety_margin` : 10 % de la RAM du nœud pour les pods système K8s, le CNI, le DNS, la supervision.
- `per_tenant_RAM_request` : 8 Go de référence.

Pour un pilot-prod de 32 Go : `floor((32 - 3 - 3.2) / 8) = floor(25.8 / 8) = 3` tenants garantis sans surengagement. Avec surengagement, 4–5 est sûr pour des volumes d'alertes typiques.

## Facteurs de dimensionnement du disque

Le principal consommateur de disque est le Wazuh indexer (stocke les événements indexés). Le taux d'ingestion détermine la croissance :

| Taux d'alertes | Taille d'index quotidienne (approx.) | Rétention 30 jours | Rétention 90 jours |
|---|---|---|---|
| 10 alertes/sec en continu | ~5 Go/jour | 150 Go | 450 Go |
| 1 alerte/sec en continu | ~500 Mo/jour | 15 Go | 45 Go |
| 100 alertes/jour | ~10 Mo/jour | 300 Mo | 900 Mo |

Les tailles de PVC de tenant dans le chart ont pour valeur par défaut **50 Go** pour le Wazuh indexer ; les MSSP la surchargent par tenant pour les clients à fort volume.

La politique de rétention est par défaut de 30 jours de données chaudes dans l'indexer ; les données plus anciennes sont supprimées ou archivées (le tiering chaud→froid n'est pas implémenté ; une future version l'ajoutera).

## Garde-fous de dimensionnement

### Vérification pré-provisionnement

Lorsqu'un opérateur MSSP crée un nouveau tenant, le contrôleur SocTalk exécute un contrôle de cohérence :

```
available_RAM = node.allocatable.memory - sum(ns.resourceQuota.requests.memory for ns in existing_tenant_namespaces) - control_plane_reserve
if (new_tenant.resourceQuota.requests.memory > available_RAM):
    refuse with "insufficient cluster capacity for new tenant"
    or
    prompt MSSP: "this will overcommit; proceed? [y/N]"
```

Ce garde-fou est plus souple dans cette version (avertissement plutôt qu'échec bloquant) car les MSSP peuvent délibérément surengager pour les clients à faible usage.

### Application du LimitRange par tenant

Chaque namespace de tenant possède un `LimitRange` :

```yaml
apiVersion: v1
kind: LimitRange
metadata: { name: tenant-limits, namespace: tenant-acme }
spec:
  limits:
    - type: Container
      default:
        memory: "2Gi"
        cpu: "500m"
      defaultRequest:
        memory: "256Mi"
        cpu: "100m"
      max:
        memory: "6Gi"
        cpu: "2"
```

Empêche un pod accidentellement mal configuré de demander 30 Go et d'affamer le nœud.

## Profils au-delà

Documentés mais non validés dans cette version :

| Profil | CPU | RAM | Disque | Tenants max |
|---|---|---|---|---|
| **mid-host** | 16 vCPU | 64 Go | 1 To | 10–15 |
| **large-host** | 32 vCPU | 128 Go | 2 To | 25–30 |
| **cluster multi-nœuds** | 3 nœuds × large | | - | 50+ (une future installation multi-nœuds est recommandée à la place) |

Recommandation pour les MSSP dépassant la capacité de `pilot-prod` :
- : ajoutez un second hôte, exécutez une seconde installation SocTalk (le schéma le prend en charge, l'outillage est manuel).
- une future version : automatisation multi-installations dans la couche Cloud.
- une future version : K3s en cluster avec une planification appropriée entre les nœuds.

## Plan de mesure (validation pré-version)

Le spike produit des chiffres réels pour remplacer les estimations du §2 :

1. Déployez `soctalk-tenant` avec un tenant sur `k3d` (dev-harness).
2. Mesure à vide : prenez un instantané `kubectl top pod -n tenant-acme`.
3. Test de charge : injectez 10 alertes/sec pendant 10 minutes ; mesurez le pic.
4. Arrêtez la charge ; mesurez ~5 minutes plus tard pour les chiffres « à chaud au repos ».
5. Répétez avec trois tenants en parallèle pour observer les interférences.
6. Mettez à jour les tableaux de ce document avec les valeurs mesurées.
