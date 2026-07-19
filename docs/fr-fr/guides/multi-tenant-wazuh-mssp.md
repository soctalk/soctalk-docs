---
title: "Wazuh multi-tenant pour MSSP : des architectures qui isolent vraiment les tenants"
description: "Exploiter Wazuh en multi-tenant comme MSSP : manager par tenant sur Kubernetes, RLS Postgres, isolation réseau, enrôlement des agents et dimensionnement par tenant."
---

# Wazuh multi-tenant pour MSSP : des architectures qui isolent vraiment les tenants

Wazuh n'offre aucune multi-location native. Il n'existe pas d'objet « tenant » dans le manager, pas de frontière par client dans le jeu de règles, et pas de cloisonnement par client de l'enrôlement `authd`. Chaque MSSP qui standardise sur Wazuh finit par construire la tenancy autour de l'outil, et le modèle choisi détermine vos garanties d'isolation, votre vitesse d'onboarding et votre plancher de coût par client.

Ce guide couvre ce qu'un MSSP attend d'un déploiement Wazuh multi-tenant, les trois modèles que les équipes essaient en pratique, et ce que l'isolation de niveau production exige au-delà du SIEM lui-même. C'est l'architecture que SocTalk implémente en open source (Apache 2.0) ; les pages de référence liées tout au long du guide approfondissent chaque couche.

## Ce dont un MSSP a besoin et que Wazuh ne fournit pas

Trois exigences reviennent dans chaque discussion de déploiement MSSP :

1. **Une isolation défendable lors d'une revue de sécurité client.** Un simple filtre de tableau de bord ne convaincra personne ; « le client A ne peut pas lire les alertes du client B » doit tenir au niveau de la couche données, de la couche réseau et de la couche d'enrôlement des agents.
2. **La vitesse d'onboarding.** Si provisionner le SOC d'un nouveau client demande une semaine de travail manuel, le modèle ne passe pas à l'échelle au-delà d'une poignée de clients.
3. **La maîtrise des coûts par tenant.** Vous devez savoir ce qu'un client coûte en RAM, CPU et disque, le plafonner, et empêcher un tenant bruyant d'affamer les autres.

## Les trois modèles que les MSSP essaient

### Modèle 1 : manager partagé, séparation au niveau des index

Un seul manager Wazuh, les agents de tous les clients enrôlés dessus, la séparation faite en aval : multi-tenancy OpenSearch Dashboards pour les objets de tableau de bord, patterns d'index et rôles de sécurité pour le cloisonnement en lecture. C'est le modèle décrit dans la plupart des discussions sur la multi-tenancy Wazuh, parce que c'est le seul que l'on peut construire sans sortir de l'outillage propre à Wazuh.

Le problème est que la séparation se fait au moment de la lecture et ne trace aucune frontière autour des données. Le manager lui-même est partagé : un seul jeu de règles, un seul secret `authd`, une seule API, une seule fenêtre de mise à niveau pour tout le monde. Un rôle mal configuré expose tous les clients d'un coup, et des packs de règles ou des politiques de rétention par client sont impossibles sans affecter les autres.

### Modèle 2 : manager par tenant sur des VM

Une VM (ou un groupe de VM) par client, exécutant un manager et un indexeur dédiés. L'isolation est réelle : processus, disques et identifiants séparés. C'est là que les MSSP atterrissent après avoir été échaudés par le modèle du manager partagé. Le coût est opérationnel : l'onboarding suppose de provisionner des machines, les mises à niveau imposent de toucher chaque VM, et le plancher de ressources par tenant est une VM complète sans ordonnancement partagé pour récupérer la capacité inutilisée. Cela fonctionne à 5 clients et devient douloureux à 30.

### Modèle 3 : manager par tenant sur Kubernetes, derrière un plan de contrôle

Chaque client reçoit un manager, un indexeur et un tableau de bord Wazuh dédiés dans son propre namespace Kubernetes, avec une ResourceQuota et une LimitRange qui plafonnent son empreinte. Un plan de contrôle possède le cycle de vie : l'onboarding rend une release Helm par tenant, le démantèlement la supprime, et l'état des tenants vit dans une base de données plutôt que dans un tableur. L'isolation vient de la frontière du namespace plus NetworkPolicy ; la densité vient de l'ordonnanceur qui regroupe les tenants sur des nœuds partagés.

### Comparaison des modèles

| | Manager partagé + séparation par index | Manager par tenant sur VM | Manager par tenant sur Kubernetes |
|---|---|---|---|
| Frontière d'isolation | Filtres en lecture sur des données partagées | Frontière machine | Namespace + NetworkPolicy + quota |
| Rayon d'impact d'une compromission | Tous les clients | Un client | Un client |
| Règles / rétention / mises à niveau par tenant | Non | Oui | Oui |
| Onboarding d'un client | Rapide (changement de config) | Lent (provisionner des machines) | Rapide, si automatisé (release Helm) |
| Densité / coût par tenant | Meilleur | Pire | Bon (regroupé par l'ordonnanceur, plafonné par quota) |
| Compétence opérationnelle requise | Sécurité Wazuh + OpenSearch | Automatisation de parc/VM | Kubernetes |
| Opérations de parc à 30 tenants et plus | N/A (une seule pile) | Pénible | Gérable avec un plan de contrôle |

Des trois, le modèle 3 est celui conçu pour offrir à la fois une isolation réelle et une vitesse d'onboarding, mais seulement si le plan de contrôle existe. Des namespaces seuls se réduisent à une convention de nommage ; une frontière de sécurité doit être construite par-dessus. La suite de ce guide porte sur ce qui rend cette frontière réelle.

## L'isolation en production ne se limite pas au SIEM

Une pile Wazuh par tenant isole les données du SIEM. Une plateforme MSSP possède aussi un état inter-tenants, des cas et files de revue jusqu'aux journaux d'audit et configurations d'intégration, et cette couche exige sa propre mise en application.

### Couche données : row-level security Postgres, forcée et testée

Avec un filtrage applicatif `WHERE tenant_id = ?`, une seule clause oubliée fait fuiter des données entre tenants. La base de données doit appliquer elle-même la tenancy. Le modèle :

- Chaque table cloisonnée par tenant porte des politiques RLS indexées sur un paramètre par transaction `app.current_tenant_id`. Un contexte non défini renvoie **zéro ligne** ; le mode de défaillance est un résultat vide, jamais les données d'un autre tenant.
- `FORCE ROW LEVEL SECURITY` sur chaque table cloisonnée par tenant, afin que même le propriétaire de la table (le rôle de migration) soit soumis aux politiques. Par défaut, Postgres exempte les propriétaires ; une migration qui lit des données de tenants pourrait sinon traverser les tenants en silence.
- Une séparation en trois rôles : un propriétaire des migrations, un rôle d'exécution soumis au RLS, et un rôle `BYPASSRLS` séparé, réservé aux chemins inter-tenants audités. Aucune application ne se connecte en superutilisateur.
- Des tests d'isolation en CI : sondes sur les endpoints, SQL brut sous le rôle applicatif, workers sans contexte, sondes sous le rôle propriétaire, flux d'événements inter-tenants. SocTalk exécute sept tests de ce type, tous obligatoires ; aucun n'est optionnel.
- Des clés d'idempotence cloisonnées `UNIQUE (tenant_id, idempotency_key)`, afin que les pipelines d'alertes de deux clients puissent émettre le même identifiant d'alerte externe sans collision.

Modèles de politiques complets, DDL des rôles et suite de tests : [RLS Postgres](/fr-fr/reference/postgres-rls).

### Couche réseau : NetworkPolicy par namespace

La frontière du namespace ne vaut rien sans un CNI qui applique les règles ; le Flannel par défaut de K3s n'applique pas du tout NetworkPolicy. La posture cible est une base default-deny par namespace de tenant avec des autorisations explicites : trafic intra-namespace, DNS, accès du plan de contrôle aux ports du plan de données du tenant, et ingress des agents sur 1514/1515. Le trafic de tenant à tenant et l'egress général des tenants sont bloqués.

SocTalk utilise Cilium comme CNI pris en charge (application de NetworkPolicy, egress basé sur les FQDN pour les endpoints LLM adressés par nom d'hôte, observabilité des flux via Hubble pour déboguer les questions d'isolation). Gardez en tête la réserve V1 : la liste d'autorisation d'egress par tenant entièrement épinglée sur les FQDN est la destination de conception, et le chart actuel rend des politiques plus simples, avec un egress permissif pour le plan de contrôle et un egress TCP/443 large pour le worker par tenant. Les templates rendus sont dans le dépôt ; lisez [Conception NetworkPolicy](/fr-fr/reference/network-policy) pour les politiques livrées comme pour l'architecture cible.

### Enrôlement des agents : endpoints et secrets par tenant

Le mode de défaillance le plus subtil : un agent du client A qui s'enregistre auprès du manager du client B. Le protocole agent de Wazuh sur 1514/TCP est un flux chiffré propriétaire plutôt que du TLS standard. Il n'y a pas de SNI sur lequel router, donc les proxys L4 qui inspectent le nom d'hôte cassent silencieusement. Le routage doit se faire par adresse de destination : chaque tenant reçoit son propre nom DNS (`acme.soc.mssp.example.com`) résolvant vers un endpoint L4 par tenant, avec un repli sur un port par tenant lorsque les IP sont rares.

Les secrets d'enrôlement sont cloisonnés par tenant : le secret partagé `authd` de chaque tenant vit dans le namespace de ce tenant, si bien qu'un agent détenant le secret du tenant A ne peut s'enregistrer qu'auprès du manager de A : l'adressage l'y conduit et le manager vérifie le secret. En V1, le provisionnement des LoadBalancer et du DNS relève d'un câblage manuel côté MSSP, non automatisé. Détails et runbook d'enrôlement : [Ingress des agents Wazuh](/fr-fr/reference/wazuh-ingress).

## Capacité : ce qu'un tenant coûte

Les chiffres que les MSSP demandent en premier, issus du travail de dimensionnement de SocTalk :

- **Empreinte par tenant (pile complète) :** ~8 Go de RAM en requête (~16 Go en limite), ~2,2 vCPU en requête, ~120 Go de disque. L'usage soutenu suit les requêtes ; les limites sont des plafonds de pics.
- **Le goulot d'étranglement est en général l'indexeur Wazuh par tenant.** Chacun est un processus Java avec son propre tas. Prévoyez ~6 à 8 Go de RAM et ~1,5 vCPU par tenant de production.
- **Le disque dépend du débit d'ingestion :** environ 5 Go/jour d'index à 10 alertes/s en continu ; le PVC d'indexeur par défaut est de 50 Go avec 30 jours de rétention chaude.
- **Échelle testée :** jusqu'à ~50 tenants sur un cluster de 3 nœuds (16 vCPU / 64 Go par nœud). Des profils mono-installation plus grands sont documentés mais non validés dans cette version ; ne planifiez pas au-delà de ce nombre sur une seule installation sans tester.

Profils d'hôtes de référence et formule du nombre maximal de tenants par nœud : [Dimensionnement](/fr-fr/reference/sizing) et la [FAQ sur le passage à l'échelle](/fr-fr/faq#does-it-scale-to-n-customers).

## Comment SocTalk package ce modèle

SocTalk est une implémentation open source (Apache 2.0, sans scission community/enterprise) du modèle 3 : un plan de contrôle, une release Helm `soctalk-tenant` par client, sur votre propre Kubernetes 1.30+, qu'il s'agisse de K3s, EKS, AKS ou GKE.

```mermaid
flowchart TB
    subgraph cp["soctalk-system namespace (control plane)"]
        api["API + orchestrator"]
        ctrl["Provisioning controller"]
        pg[("Postgres: RLS, FORCE, 3 roles")]
        api --> pg
        ctrl --> pg
    end
    subgraph ta["tenant-acme namespace"]
        ma["Wazuh manager"]
        ia["Wazuh indexer"]
        wa["runs-worker + adapter"]
    end
    subgraph tb["tenant-beta namespace"]
        mb["Wazuh manager"]
        ib["Wazuh indexer"]
        wb["runs-worker + adapter"]
    end
    ctrl -- "Helm: soctalk-tenant" --> ta
    ctrl -- "Helm: soctalk-tenant" --> tb
    agA["Customer A agents"] -- "acme.soc.mssp.example.com : 1514/1515" --> ma
    agB["Customer B agents"] -- "beta.soc.mssp.example.com : 1514/1515" --> mb
```

L'onboarding exécute une séquence de provisionnement en neuf phases (preflight, génération des secrets, namespace avec quotas, installations Helm, sondage de disponibilité), chaque phase émettant un événement de cycle de vie et pouvant être rejouée de façon idempotente depuis `degraded`. L'état d'un tenant est une machine à états appliquée côté serveur (`pending → provisioning → active`, avec les états suspended, decommissioning, archived et purged ; les transitions invalides renvoient un 409). Trois profils d'onboarding couvrent les démos (`poc`), la production (`persistent`) et le BYO-Wazuh (`provided`, où SocTalk se connecte à la pile existante d'un client au lieu d'en déployer une). Le démantèlement détruit le plan de données mais conserve la ligne du tenant et l'historique d'audit.

Le cycle de vie complet, des états et phases jusqu'aux quotas et chemins de récupération, se trouve dans [Cycle de vie des tenants](/fr-fr/tenant-lifecycle). Pour le mettre en œuvre : le [guide d'installation](/fr-fr/install) couvre un cluster de production en une heure environ, et la [VM de démonstration](/fr-fr/quickstart-vm) démarre une installation multi-tenant fonctionnelle avec un tenant de démonstration en cinq minutes environ.
