---
description: Onboarding d'un client Wazuh MSSP de bout en bout — provisionnez un SOC tenant isolé, enrôlez les agents, distribuez les accès et établissez la base de référence de la première semaine.
---

# Onboarder un tenant client sur un SOC Wazuh multi-tenant : la checklist MSSP

« Onboarder » un client sur un service Wazuh multi-tenant recouvre quatre tâches, pas une : provisionner une stack isolée par client, enrôler les agents du client dans *leur* manager et aucun autre, distribuer des accès qui respectent la frontière MSSP/client, et établir la base de référence de la première semaine d'exploitation. Ce guide parcourt l'ensemble du chemin sur SocTalk, où chaque client reçoit un manager Wazuh, un indexer et un dashboard dédiés dans son propre namespace Kubernetes, derrière un unique plan de contrôle MSSP.

## Décisions à prendre avant de cliquer sur New Tenant

**Profil.** Le profil est figé au moment de l'onboarding — en changer plus tard implique un décommissionnement + une recréation — décidez donc d'abord :

- `poc` — évaluations et pilotes de courte durée. Stockage `local-path` sans réelle garantie de persistance, faibles requêtes de ressources, pas de hooks de sauvegarde. C'est aussi la **valeur par défaut si vous n'en précisez aucun**, ce qui est le mauvais défaut pour un client payant.
- `persistent` — SOC clients de production. Utilise la StorageClass par défaut de votre installation, des requêtes dimensionnées pour la production, et honore les hooks de sauvegarde s'ils sont configurés.
- `provided` — le client exploite déjà Wazuh (BYO-SIEM). SocTalk n'installe que son adaptateur et son runs-worker dans le namespace du tenant et atteint l'indexer du client (`:9200`) et l'API du Manager (`:55000`) via le réseau. Le matériel de connexion externe *et* les identifiants LLM par tenant sont requis au moment de l'onboarding — l'API renvoie 422 s'ils sont absents.

**Dimensionnement.** Prévoyez environ 6–8 Go de RAM et ~1,5 vCPU par tenant `persistent` ; l'indexer Wazuh par tenant est généralement le goulot d'étranglement et détermine le disque (PVC de 50 Go par défaut, rétention chaude de 30 jours, pas encore de tiering hot→cold). SocTalk est testé jusqu'à ~50 tenants sur un cluster de 3 nœuds de 16 vCPU / 64 Go ; considérez tout ce qui dépasse ~5 tenants sur un hôte unique comme non validé. Détails dans [Dimensionnement](/fr-fr/reference/sizing).

**LLM par tenant.** Le triage s'exécute sur une configuration LLM propre à chaque tenant : Anthropic ou tout endpoint compatible OpenAI (Azure OpenAI, vLLM, Ollama, LiteLLM). Un client peut apporter sa propre clé API pour isoler la facturation — montée comme Secret Kubernetes dans son namespace, avec la réserve documentée en V1 que la clé est aussi conservée en clair dans la base de données SocTalk ([Secrets](/fr-fr/reference/secrets)) — ou vous pouvez pointer le tenant vers un endpoint Ollama entièrement local pour une posture sans cloud et sans coût par token (prévoyez une inférence CPU lente). Voir [Fournisseurs LLM](/fr-fr/integrate/llm-providers).

## Provisionnement : ce qui se passe réellement

Créez le tenant depuis l'[interface MSSP](/fr-fr/mssp-ui) (Tenants → **+ New Tenant**) ou via l'API. Le tenant entre dans une machine à états imposée côté serveur — `pending → provisioning → active`, avec `degraded`, `suspended`, `decommissioning`, `archived` et `purged` au-delà ; les transitions invalides sont rejetées avec un 409.

Le contrôleur exécute neuf phases ordonnées et idempotentes, chacune émettant un événement de cycle de vie observable sur la page de détail du tenant : vérifications préalables, génération des secrets par tenant (`authd`, JWT, Postgres), création du namespace (`tenant-<slug>` avec labels, ResourceQuota et LimitRange calés sur le profil), application des secrets, installation Helm de `soctalk-tenant` (qui provisionne aussi automatiquement l'utilisateur `tenant_admin`), installation du chart Wazuh, sonde de disponibilité, écriture de la configuration d'intégration, et transition vers `active`.

Si une phase échoue, le tenant se retrouve en `degraded` avec l'étape fautive capturée dans la ligne d'événement. Corrigez la cause (PVC bloqué, quota sous-dimensionné, échec de pull d'image) et cliquez sur **Retry Provisioning** — la reprise repart de la phase 1 et chaque phase est idempotente, donc les ré-exécutions sont sûres. Retry n'est valide que *depuis* `degraded`, pas depuis `pending`. Les runbooks pour les états bloqués se trouvent dans [Exploitation quotidienne](/fr-fr/operations).

## Enrôlement des agents : amener les endpoints dans le bon tenant

Chaque tenant reçoit un nom DNS dédié (`acme.soc.mssp.example.com`) résolvant vers un endpoint L4 par tenant pour 1514/TCP (événements) et 1515/TCP (enrôlement). Le routage se fait par adresse de destination, pas par SNI — le protocole agent 1514 de Wazuh n'est pas du TLS standard et ne présente jamais de ClientHello.

**Réserve honnête pour la V1 :** le chart crée le Service du manager Wazuh en `ClusterIP` uniquement. Il n'y a **aucun provisionnement automatique de LoadBalancer ou de DNS dans cette version** — vous câblez la bordure vous-même : un Service LoadBalancer par tenant appliqué manuellement, un HAProxy en bordure avec des paires de ports par tenant sur une IP unique, ou un chemin via un VPN maillé. Les enregistrements DNS sont eux aussi gérés par l'opérateur.

L'enrôlement lui-même est cloisonné par tenant, par conception. Récupérez le secret partagé `authd` du tenant :

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Transmettez le nom d'hôte, les ports et le secret à l'administrateur des endpoints du client via un canal sécurisé ; il exécute `agent-auth -m <hostname> -P "<secret>"`. Un agent détenant le secret du tenant A ne peut s'enregistrer qu'auprès du manager du tenant A. Un onglet Agents dédié et un panneau d'onboarding des agents sont sur la feuille de route ; aujourd'hui, vérifiez les agents dans le dashboard Wazuh embarqué (Tenants → **Open SOC** → Agents). Topologie complète et exigences de pare-feu : [Ingress des agents Wazuh](/fr-fr/reference/wazuh-ingress).

## Les personnes : qui reçoit un login

Le provisionnement a déjà créé un `tenant_admin`. Ce rôle est en libre-service : il gère les utilisateurs de sa propre organisation et ses propres réglages LLM depuis le portail client. Pour les parties prenantes qui ont besoin de visibilité mais ne doivent jamais agir, assignez `customer_viewer` — dashboards et enquêtes en lecture seule, pas de file de revue, pas de chat.

Chaque utilisateur créé reçoit un mot de passe temporaire à usage unique, affiché une seule fois, avec changement forcé à la première connexion. Un mur d'audience sépare les deux côtés : les rôles tenant ne peuvent jamais détenir de capacités MSSP et inversement, ce qui est imposé au niveau du garde de capacités — un login client ne peut donc structurellement pas atteindre les surfaces inter-tenants. Notez qu'il n'existe pas de flux « mot de passe oublié » en libre-service dans cette version — les réinitialisations sont forcées par un administrateur. Catalogue complet : [Utilisateurs et rôles](/fr-fr/users-and-roles).

## La première semaine

- **Heartbeat.** Surveillez `soctalk_tenant_adapter_heartbeat_age_seconds` sur `/metrics` — en V1, c'est la seule jauge activement mise à jour, et elle ne fait *pas* passer automatiquement le tenant en état dégradé : configurez donc vous-même l'alerte.
- **File de revue.** Les nouveaux tenants génèrent du trafic de revue le temps que les bases de référence se stabilisent ; chaque escalade de l'AI attend un humain dans la file du dashboard — il n'existe aucun contournement d'approbation automatique.
- **Fenêtres d'engagement.** Si le client a un pentest planifié, déclarez la fenêtre d'engagement (source, hôte, technique, horaire) avant son démarrage, afin que l'activité sanctionnée soit marquée et auditée plutôt qu'escaladée — et l'activité des testeurs hors périmètre force toujours un regard humain.
- **Bases de la suspension et du décommissionnement.** La suspension bascule l'état en base et arrête les nouvelles enquêtes mais ne réduit **pas** les workloads — la coupure d'urgence est un runbook manuel. Le décommissionnement démantèle le plan de données et conserve la ligne du tenant ainsi que l'historique d'audit en `archived` ; il n'existe pas encore d'endpoint API `:purge`.

## Checklist d'onboarding

- [ ] Profil choisi (`persistent` pour la production ; `provided` exige les URLs SIEM + identifiants LLM dès le départ)
- [ ] Marge du cluster vérifiée (~6–8 Go de RAM, ~1,5 vCPU par tenant `persistent`)
- [ ] LLM par tenant décidé (clé propre / défaut de l'installation / Ollama local)
- [ ] Tenant créé ; les événements de cycle de vie ont atteint `active`
- [ ] Edge câblé manuellement : endpoint LB ou edge-proxy + enregistrement DNS pour `<slug>.soc.<domain>`
- [ ] Secret `authd` récupéré et partagé via un canal sécurisé
- [ ] Premier agent enrôlé et visible dans le dashboard Wazuh du tenant
- [ ] `tenant_admin` transmis ; comptes `customer_viewer` créés au besoin
- [ ] Alerte de heartbeat sur `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Tout pentest planifié déclaré comme fenêtre d'engagement

## Pour aller plus loin

- [Cycle de vie du tenant](/fr-fr/tenant-lifecycle) — machine à états, phases, chemins de récupération
- [Ingress des agents Wazuh](/fr-fr/reference/wazuh-ingress) — topologies de bordure, certificats, révocation
- [Utilisateurs et rôles](/fr-fr/users-and-roles) — le catalogue complet des rôles et le mur d'audience
- [Exploitation quotidienne](/fr-fr/operations) — le versant runbook de tout ce qui précède
- [Launchpad](/fr-fr/launchpad) — répétez l'ensemble de ce flux dans un pilote multi-VM de ~15–25 minutes
