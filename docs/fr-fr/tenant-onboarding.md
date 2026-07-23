---
description: "Intégrer un tenant client de bout en bout dans SocTalk : choisir un profil, exécuter l'assistant Create Customer, suivre le provisionnement jusqu'à active, connecter les endpoints du client et distribuer les accès."
---

# Intégrer un tenant

L'intégration transforme un client en un SOC tenant isolé sur votre plan de contrôle. Chaque tenant reçoit son propre namespace Kubernetes (`tenant-<slug>`) avec ses propres secrets, son budget de ressources et (pour les profils `poc` et `persistent`) un manager Wazuh, un indexeur et un dashboard dédiés. Cette page parcourt tout le chemin qu'un administrateur MSSP suit dans l'interface, de la première décision au moment où les analystes du client peuvent ouvrir leur SOC.

Pour la vue d'ensemble conceptuelle (dimensionnement, les quatre tâches, référence de la première semaine), voir le [guide de checklist d'intégration](/fr-fr/guides/wazuh-tenant-onboarding). Pour la machine à états et le fonctionnement interne des profils, voir [Cycle de vie du Tenant](/fr-fr/tenant-lifecycle). Cette page est le tutoriel côté opérateur.

## Avant de commencer

- Votre plan de contrôle est installé et vous pouvez vous connecter en tant qu'administrateur MSSP. S'il n'est pas encore en service, suivez d'abord l'[Installation en production](/fr-fr/install) ou le [démarrage rapide sur VM de démonstration](/fr-fr/quickstart-vm).
- Vous avez décidé du profil du tenant. Il est figé pour toute la durée de vie du tenant, alors lisez la section suivante avant de cliquer sur **New tenant**.
- Pour un tenant `provided` uniquement, rassemblez hors bande le matériel de connexion au Wazuh existant du client avant d'ouvrir l'assistant : l'URL de l'indexeur avec un utilisateur et un mot de passe en authentification Basic, l'URL de l'API Manager avec un utilisateur et un mot de passe, ainsi que les identifiants LLM par tenant. L'assistant se bloque tant qu'ils manquent, donc les rassembler d'abord évite de laisser un formulaire à moitié rempli. Voir [Coordonner les identifiants Wazuh externes](/fr-fr/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Choisir un profil

Le profil est choisi une seule fois et figé. En changer plus tard implique de décommissionner puis réintégrer, choisissez donc délibérément.

- **`poc`** est destiné aux évaluations et aux pilotes de courte durée. Le chart du tenant installe Wazuh plus un simulateur linux-ep avec un stockage `local-path` et des budgets de ressources serrés. C'est aussi la valeur par défaut si vous n'en précisez aucune, et `local-path` n'offre aucune garantie de persistance, c'est donc un mauvais choix pour un vrai client.
- **`persistent`** est destiné aux SOC clients en production. Même forme Wazuh-inclus que `poc`, mais dimensionné pour une charge soutenue sur la StorageClass par défaut du cluster, avec les plages de ressources complètes du chart et les hooks de sauvegarde honorés là où ils sont configurés.
- **`provided`** est destiné à un client qui exploite déjà Wazuh (apportez votre propre SIEM). Le chart installe uniquement l'adaptateur SocTalk et le runs-worker ; SocTalk atteint l'indexeur et l'API Manager du client via le réseau. Le matériel de connexion externe et les identifiants LLM par tenant sont exigés au moment de l'intégration.

Prévoyez environ 6 à 8 Go de RAM et à peu près 1,5 vCPU par tenant `persistent` ; l'indexeur Wazuh par tenant est généralement le goulot d'étranglement. Les détails de capacité figurent dans [Dimensionnement](/fr-fr/reference/sizing), et chaque profil est développé dans [Cycle de vie du Tenant](/fr-fr/tenant-lifecycle#profiles).

## Exécuter l'assistant Create Customer

Dans le tableau de bord MSSP, cliquez sur **Tenants** dans le rail de gauche, puis sur **New tenant** en haut de la liste. Cela ouvre l'assistant **Create Customer**. Il comporte quatre étapes pour `poc` et `persistent` (Identity, Profile, Branding, Review) et cinq pour `provided`, où une étape External SIEM apparaît entre Profile et Branding.

### Étape 1 : Identity

- **Display name**, par exemple `Acme Corp`.
- **Slug** : court, en minuscules, séparé par des tirets, 3 à 32 caractères, validé par `[a-z0-9-]+`. Le slug devient le namespace `tenant-<slug>` et est substitué dans les identifiants en aval, choisissez-le donc avec soin. Dans un pilote sur tailnet, il doit correspondre au tag Tailscale du tenant.
- **Contact email**.

### Étape 2 : Profile

Choisissez l'un des profils `poc`, `persistent` ou `provided`. La même étape comporte un volet **LLM (advanced)** pour surcharger le fournisseur LLM partagé à l'installation, l'URL de base, la clé et, optionnellement, les ID des modèles Fast et Thinking. Laissez-le replié pour `poc` et `persistent` afin d'hériter des valeurs par défaut de l'installation. Pour `provided`, les identifiants LLM sont requis et conditionnent l'étape, car il n'existe pas de repli partagé à l'installation pour ce profil.

Changer le profil après le provisionnement nécessite un décommissionnement et une réintégration, confirmez donc le choix avant de continuer.

### Étape 3 : External SIEM (provided uniquement)

Cette étape est masquée sauf si vous avez choisi `provided`. Remplissez deux paires endpoint et identifiants :

- **Wazuh Indexer URL**, par exemple `https://wazuh.acme.example:9200`, avec l'utilisateur et le mot de passe de l'indexeur utilisés pour l'authentification Basic.
- **Wazuh Manager API URL**, par exemple `https://wazuh.acme.example:55000`, avec l'utilisateur et le mot de passe de l'API utilisés pour émettre les JWT.

Les deux doivent être joignables depuis la VM tenant. Le contrôleur transforme les URL en une liste d'autorisation d'egress FQDN Cilium sur le namespace du tenant ; l'adaptateur n'atteint jamais Wazuh directement depuis le cluster MSSP. Vérifiez la validité des identifiants du manager avant de soumettre :

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (a long base64 string)
```

Si cela renvoie un jeton, les outils de chat du tenant se résoudront une fois le plan de données du tenant en service.

### Étape 4 (ou 3 pour poc et persistent) : Branding

Optionnel. Un nom d'affichage et un petit logo qui apparaissent dans l'en-tête du tenant. Vous pouvez ignorer entièrement cette étape.

### Étape finale : Review

Confirmez tout et cliquez sur **Create**. L'API répond `202` et vous renvoie à la liste des tenants. Le nouveau tenant démarre en `pending` et progresse par `provisioning` vers `active`.

## Suivre le provisionnement jusqu'à active

Ouvrez la page de détail du tenant et rafraîchissez-la pour suivre la table **Lifecycle Events**. Le contrôleur exécute neuf phases ordonnées et idempotentes, chacune émettant un événement :

1. `preflight_ok` : les prérequis du cluster et les conflits de nommage passent.
2. `secrets_minted` : génération des secrets par tenant (`authd`, signature JWT, Postgres).
3. `namespace_ready` : création de `tenant-<slug>` avec labels, ResourceQuota et LimitRange.
4. `secrets_applied` : injection des secrets dans le namespace sous forme d'objets Kubernetes Secret.
5. `helm_applied` (chart du tenant) : le chart `soctalk-tenant` installe l'adaptateur, le runs-worker et l'ingress. L'utilisateur `tenant_admin` est auto-provisionné dans le cadre de cette étape.
6. `helm_applied` (chart Wazuh) : le chart Wazuh autonome installe le manager, l'indexeur et le dashboard. La charge utile de l'événement identifie quel chart a été appliqué. Cette phase ne s'exécute pas pour les tenants `provided`.
7. `workloads_ready` : tous les pods du plan de données signalent l'état Ready.
8. `integration_config_written` : écriture des configurations d'intégration par tenant (LLM, URLs TheHive) dans la base de données.
9. `active` : le tenant passe à `active` et est prêt à l'emploi.

Lorsque le tenant atteint `active`, utilisez **Open SOC** depuis la liste des tenants pour entrer dans son tableau de bord.

En cas de blocage, la phase fautive est nommée dans la table des événements :

- **Bloqué en `pending`** : le contrôleur a été replanifié avant la phase 1. Le retry n'est pas autorisé directement depuis `pending` ; attendez que la tentative passe à `degraded`, puis cliquez sur **Retry Provisioning**. Le provisionnement reprend à la phase 1.
- **En `provisioning` depuis plus de 15 minutes** : généralement un pod bloqué (ImagePullBackOff, un PVC en `Pending` ou un ResourceQuota trop petit). Voir [Opérations quotidiennes](/fr-fr/operations#tenant-stuck-in-provisioning).
- **En `degraded`** : une phase de provisionnement a échoué. Lisez la ligne d'événement pour voir laquelle, puis **Retry Provisioning**, qui est une transition valide depuis `degraded`. Plus de détails dans [Cycle de vie du Tenant](/fr-fr/tenant-lifecycle#recovery-paths).

## Enrôler les endpoints du client

L'enrôlement des endpoints consiste à faire remonter les machines du client vers le manager Wazuh du bon tenant. Cela s'applique aux tenants `poc` et `persistent`, qui exécutent Wazuh dans leur namespace. Un tenant `provided` envoie déjà ses endpoints vers le Wazuh du client, il n'y a donc rien à enrôler ici ; passez à la section suivante.

Le manager Wazuh de chaque tenant écoute sur 1514/TCP (événements) et 1515/TCP (enrôlement). Dans cette version, le chart crée ce manager uniquement en Service `ClusterIP` : il n'y a pas de provisionnement automatique de LoadBalancer ni de DNS, vous câblez donc la bordure vous-même (un Service LoadBalancer par tenant, un HAProxy en bordure avec des paires de ports par tenant sur une seule IP, ou un chemin via VPN maillé) et gérez l'enregistrement DNS. La topologie complète et les exigences de pare-feu figurent dans [Ingress des agents Wazuh](/fr-fr/reference/wazuh-ingress).

L'enrôlement est cloisonné au tenant par le secret partagé `authd` du manager. Récupérez-le :

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Transmettez le nom d'hôte du manager, les deux ports et ce secret à l'administrateur des endpoints du client via un canal sécurisé. Il enrôle chaque endpoint avec :

```bash
agent-auth -m <tenant-manager-hostname> -P "<authd-secret>"
```

Un agent détenant le secret d'un tenant ne peut s'enregistrer qu'auprès du manager de ce tenant, ce qui maintient l'enrôlement cloisonné. Vérifiez que les agents sont bien arrivés dans le dashboard Wazuh embarqué : Tenants, puis **Open SOC**, puis Agents.

Si au lieu de cela le plan de données du tenant tourne sur une infrastructure séparée (le modèle de pilote distant, où une VM tenant rejoint via un tailnet), cette VM est enregistrée auprès du plan de contrôle par un flux de cloud-agent `:issue-agent`, ce qui est différent de l'enrôlement des endpoints ci-dessus. Ce chemin est couvert de bout en bout dans le [tutoriel du pilote MSSP](/fr-fr/mssp-pilot#_4-tenant-side-stand-up-the-data-plane).

## Distribuer les accès

L'utilisateur `tenant_admin` est créé automatiquement pendant la phase 5, le tenant dispose donc d'un administrateur dès qu'il atteint `active`. Pour donner à cet administrateur un identifiant utilisable, forcez une réinitialisation de mot de passe côté MSSP (l'acteur doit être `mssp_admin` ou `platform_admin`) :

```bash
curl -X POST 'https://<mssp-host>/api/mssp/users/<user-id>/password/reset' \
  -b jar -H 'Origin: https://<mssp-host>'
```

La réponse renvoie un `temporary_password` à usage unique marqué `must_change=true`, et la réinitialisation révoque toutes les sessions existantes de cet utilisateur. Partagez ce mot de passe avec l'URL du portail client via un canal chiffré de bout en bout tel qu'un gestionnaire de mots de passe partagé, jamais par un e-mail non chiffré ni un canal de chat public. L'administrateur du tenant choisit un nouveau mot de passe à la première connexion.

À partir de là, le tenant est en libre-service : le `tenant_admin` se connecte au portail client, ouvre **Users** et provisionne les comptes de sa propre organisation (par exemple `customer_viewer` pour les parties prenantes en lecture seule). Le personnel MSSP et les utilisateurs tenant se trouvent de part et d'autre d'une frontière d'audience appliquée par le garde de capacités, de sorte qu'un identifiant tenant ne peut structurellement pas atteindre les surfaces inter-tenants. Les rôles et cette frontière sont décrits dans [Utilisateurs et rôles](/fr-fr/users-and-roles).

## Vérifier

- Le tenant apparaît en `active` dans la liste des tenants, et **Open SOC** charge son tableau de bord.
- Pour `poc` et `persistent`, vérifiez que les endpoints enrôlés apparaissent sous Open SOC, puis Agents, et que leurs événements arrivent dans le dashboard Wazuh du tenant.
- Pour `provided`, vérifiez que le pod `soctalk-adapter` est Ready, puis exécutez une requête adossée à Wazuh dans le chat SocTalk (par exemple, demandez les alertes récentes sur un hôte connu). Elle se résout dès que l'adaptateur peut atteindre les endpoints External SIEM du client ; si ce n'est pas le cas, revérifiez la joignabilité selon [Coordonner les identifiants Wazuh externes](/fr-fr/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Voir aussi

- [Checklist d'intégration](/fr-fr/guides/wazuh-tenant-onboarding) pour la vue d'ensemble conceptuelle et la référence de la première semaine.
- [Cycle de vie du Tenant](/fr-fr/tenant-lifecycle) pour la machine à états, les profils, les quotas et les chemins de récupération.
- [Visite de l'UI MSSP](/fr-fr/mssp-ui#tenants) pour la liste des tenants et les pages de détail.
- [Pilote MSSP : faites-le vous-même](/fr-fr/mssp-pilot) pour le déploiement complet basé sur un tailnet, y compris le plan de données côté tenant.
