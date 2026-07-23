---
description: "Intégration d'un client MSSP sur Wazuh, de bout en bout : provisionner un SOC tenant isolé, enrôler les agents, distribuer les accès et cadrer la première semaine."
---

# Intégrer un tenant client dans un SOC Wazuh multi-tenant : la checklist MSSP

« Intégrer » un client à un service Wazuh multi-tenant se décompose en quatre tâches : provisionner une pile isolée par client, enrôler les agents du client dans *leur* manager et aucun autre, distribuer des accès qui respectent la frontière MSSP/client, et établir la référence de la première semaine d'exploitation. Ce guide parcourt tout le chemin sur SocTalk, où chaque client reçoit un manager Wazuh, un indexeur et un dashboard dédiés dans son propre namespace Kubernetes, derrière un plan de contrôle MSSP unique.

## Décisions à prendre avant de cliquer sur New Tenant

**Profil.** Le profil est figé au moment de l'intégration ; en changer plus tard implique de décommissionner puis recréer. Décidez d'abord :

- `poc` : évaluations et pilotes de courte durée. Stockage `local-path` sans réelle garantie de persistance, demandes de ressources faibles, pas de hooks de sauvegarde. C'est aussi le **profil par défaut si vous n'en précisez aucun** ; le stockage `local-path` n'offre aucune garantie de persistance, les clients en production ont donc besoin de `persistent`.
- `persistent` : SOC clients en production. Utilise la StorageClass par défaut de votre installation, des demandes dimensionnées pour la production, et les hooks de sauvegarde sont honorés s'ils sont configurés.
- `provided` : le client exploite déjà Wazuh (BYO-SIEM). SocTalk n'installe que son adaptateur et son runs-worker dans le namespace du tenant et atteint l'indexeur du client (`:9200`) et l'API du Manager (`:55000`) via le réseau. Les éléments de connexion externes *et* les identifiants LLM par tenant sont exigés au moment de l'intégration ; l'API renvoie 422 s'ils manquent.

**Dimensionnement.** Prévoyez environ 6 à 8 Go de RAM et ~1,5 vCPU par tenant `persistent` ; l'indexeur Wazuh par tenant est généralement le goulot d'étranglement et détermine le disque (PVC de 50 Go par défaut, rétention chaude de 30 jours, pas encore de hiérarchisation chaud→froid). SocTalk est testé jusqu'à ~50 tenants sur un cluster de 3 nœuds de 16 vCPU / 64 Go ; considérez tout ce qui dépasse ~5 tenants sur un hôte unique comme non validé. Détails dans [Dimensionnement](/fr-fr/reference/sizing).

**LLM par tenant.** Le triage s'exécute sur une configuration LLM par tenant : Anthropic ou tout endpoint compatible OpenAI (Azure OpenAI, vLLM, Ollama, LiteLLM). Un client peut apporter sa propre clé API pour isoler la facturation. La clé est montée comme Secret Kubernetes dans son namespace, avec la réserve documentée en V1 qu'elle est aussi conservée en clair dans la base de données SocTalk ([Secrets](/fr-fr/reference/secrets)). Vous pouvez aussi pointer le tenant vers un endpoint Ollama entièrement local pour une posture sans cloud et sans coût au token (prévoyez une inférence CPU lente). Voir [Fournisseurs LLM](/fr-fr/integrate/llm-providers).

## Provisionnement : les neuf phases ordonnées

Créez le tenant depuis l'[UI MSSP](/fr-fr/mssp-ui) (Tenants → **+ New Tenant**) ou via l'API. Le tenant entre dans une machine à états imposée côté serveur, `pending → provisioning → active`, avec `degraded`, `suspended`, `decommissioning`, `archived` et `purged` au-delà. Les transitions invalides sont rejetées avec un 409.

Le contrôleur exécute neuf phases ordonnées et idempotentes, chacune émettant un événement de cycle de vie que vous pouvez suivre sur la page de détail du tenant : vérifications préalables, création des secrets par tenant (`authd`, JWT, Postgres), création du namespace (`tenant-<slug>` avec labels, ResourceQuota et LimitRange calés sur le profil), application des secrets, l'installation Helm `soctalk-tenant` (qui provisionne aussi automatiquement l'utilisateur `tenant_admin`), l'installation du chart Wazuh, une attente de disponibilité, l'écriture de la configuration d'intégration et la transition vers `active`.

Si une phase échoue, le tenant se retrouve en `degraded` avec l'étape fautive consignée dans la ligne d'événement. Corrigez la cause (PVC bloqué, quota sous-dimensionné, échec de pull d'image) et cliquez sur **Retry Provisioning**. La reprise repart de la phase 1, et chaque phase est idempotente, donc les réexécutions sont sûres. La reprise n'est valide que *depuis* `degraded`, pas depuis `pending`. Les runbooks pour les états bloqués sont dans [Exploitation quotidienne](/fr-fr/operations).

## Enrôlement des agents : amener les endpoints dans le bon tenant

Chaque tenant reçoit un nom DNS dédié (`acme.soc.mssp.example.com`) qui résout vers un endpoint L4 par tenant pour 1514/TCP (événements) et 1515/TCP (enrôlement). Le routage se fait par adresse de destination plutôt que par SNI, car le protocole agent 1514 de Wazuh n'est pas du TLS standard et ne présente jamais de ClientHello.

**Réserve V1 :** le chart crée le Service du manager Wazuh en `ClusterIP` uniquement. Il n'y a **pas de provisionnement automatique de LoadBalancer ni de DNS dans cette version**. Vous câblez la bordure vous-même : un Service LoadBalancer par tenant appliqué manuellement, un HAProxy en bordure avec des paires de ports par tenant sur une seule IP, ou un chemin via VPN maillé. Les enregistrements DNS sont de même à la charge de l'opérateur.

L'enrôlement lui-même est cloisonné par tenant, par conception. Récupérez le secret partagé `authd` du tenant :

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Transmettez le nom d'hôte, les ports et le secret à l'administrateur des endpoints du client via un canal sécurisé ; il exécute `agent-auth -m <hostname> -P "<secret>"`. Un agent détenant le secret du tenant A ne peut s'enregistrer qu'auprès du manager du tenant A. Un onglet Agents dédié et un panneau Agent Onboarding sont sur la feuille de route ; aujourd'hui, vérifiez les agents dans le dashboard Wazuh embarqué (Tenants → **Open SOC** → Agents). Topologie complète et exigences de pare-feu : [Ingress des agents Wazuh](/fr-fr/reference/wazuh-ingress).

## Les personnes : qui reçoit un identifiant

Le provisionnement a déjà créé un `tenant_admin`. Ce rôle est en libre-service : il gère les utilisateurs de sa propre organisation et ses propres réglages LLM depuis le portail client. Pour les parties prenantes qui ont besoin de visibilité mais ne doivent jamais agir, attribuez `customer_viewer` : dashboards et enquêtes en lecture seule, pas de file de revue, pas de chat.

Chaque utilisateur créé reçoit un mot de passe temporaire à usage unique, affiché une seule fois et à changer obligatoirement à la première connexion. Un mur d'audience sépare les deux côtés : les rôles tenant ne peuvent jamais détenir de capacités MSSP et inversement, ce qui est appliqué au niveau du garde de capacités, donc un identifiant client ne peut structurellement pas atteindre les surfaces inter-tenants. Il n'existe pas de flux de réinitialisation de mot de passe en libre-service dans cette version ; les réinitialisations sont forcées par un administrateur. Catalogue complet : [Utilisateurs et rôles](/fr-fr/users-and-roles).

## La première semaine

- **Heartbeat.** Surveillez `soctalk_tenant_adapter_heartbeat_age_seconds` sur `/metrics`. En V1, c'est la seule jauge activement mise à jour, et elle ne fait *pas* passer automatiquement l'état du tenant en dégradé, donc mettez vous-même une alerte dessus.
- **File de revue.** Les nouveaux tenants génèrent du trafic de revue le temps que les références se stabilisent ; chaque escalade de l'AI attend un humain dans la file du dashboard ; il n'y a pas de contournement par approbation automatique.
- **Fenêtres d'engagement.** Si le client a un pentest planifié, déclarez la fenêtre d'engagement (source, hôte, technique, horaire) avant son début, afin que l'activité autorisée soit marquée et auditée plutôt qu'escaladée. L'activité d'un testeur hors périmètre force toujours un regard humain.
- **Bases de suspension et décommission.** La suspension bascule l'état en base et arrête les nouvelles enquêtes, mais ne réduit **pas** les workloads ; la coupure d'urgence est un runbook manuel. La décommission démonte le plan de données et conserve la ligne du tenant ainsi que l'historique d'audit en `archived` ; il n'existe pas encore d'endpoint API `:purge`.

## Checklist d'intégration

- [ ] Profil choisi (`persistent` pour la production ; `provided` exige les URL SIEM + identifiants LLM dès le départ)
- [ ] Marge du cluster vérifiée (~6 à 8 Go de RAM, ~1,5 vCPU par tenant `persistent`)
- [ ] LLM par tenant décidé (clé BYO / défaut de l'installation / Ollama local)
- [ ] Tenant créé ; les événements de cycle de vie ont atteint `active`
- [ ] Bordure câblée manuellement : endpoint LB ou proxy de bordure + enregistrement DNS pour `<slug>.soc.<domain>`
- [ ] Secret `authd` récupéré et partagé via un canal sécurisé
- [ ] Premier agent enrôlé et visible dans le dashboard Wazuh du tenant
- [ ] `tenant_admin` remis au client ; comptes `customer_viewer` créés au besoin
- [ ] Alerte de heartbeat en place sur `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Tout pentest planifié déclaré comme fenêtre d'engagement

## Pour aller plus loin

- [Intégrer un tenant](/fr-fr/tenant-onboarding) : la procédure pas à pas de l'assistant et des phases ci-dessous
- [Cycle de vie des tenants](/fr-fr/tenant-lifecycle) : machine à états, phases, chemins de récupération
- [Ingress des agents Wazuh](/fr-fr/reference/wazuh-ingress) : topologies de bordure, certificats, révocation
- [Utilisateurs et rôles](/fr-fr/users-and-roles) : le catalogue complet des rôles et le mur d'audience
- [Exploitation quotidienne](/fr-fr/operations) : le versant runbook de tout ce qui précède
- [Launchpad](/fr-fr/launchpad) : répétez tout ce flux dans un pilote multi-VM d'environ 15 à 25 minutes
