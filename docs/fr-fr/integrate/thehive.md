# TheHive

[TheHive](https://thehive-project.org/) est optionnel (opt-in). Lorsqu'il est configuré par tenant, SocTalk exporte les clôtures de disposition `escalate` sous forme de cas TheHive. L'historique d'enquête (observables, justification de l'AI, décision de revue humaine) devient le premier ensemble d'observables et la chronologie du cas.

Pour le modèle mental, voir [Pipeline AI → Clôture](/fr-fr/ai-pipeline). Pour la mise hors service d'un tenant avec TheHive activé, voir [Cycle de vie du tenant → Mise hors service](/fr-fr/tenant-lifecycle#decommission-vs-purge).

## Modèle d'hébergement

En V1, le chart `soctalk-tenant` n'a pas de sous-chart TheHive (`dependencies: []`). Les choix sont :

- **TheHive géré par le client**: le client exécute son propre TheHive ailleurs ; le MSSP fournit l'URL et une clé d'API par tenant.
- **Pas de TheHive**: les escalades restent uniquement dans l'interface SocTalk. Par défaut.

Un chemin « sous-chart TheHive intégré » était décrit dans les versions antérieures de cette page comme une option prévue, mais il n'est **pas implémenté dans cette version**. Il n'y a pas de StatefulSet Cassandra ni de Deployment TheHive géré par SocTalk pour le tenant.

## Configuration (interface MSSP)

Détail du tenant → Paramètres → TheHive. Champs :

| Champ | Notes |
|---|---|
| Enable | Désactivé par défaut |
| URL | `https://thehive.<customer>.example` pour un TheHive géré par le client ; `http://thehive.tenant-<slug>.svc:9000` pour un TheHive intégré |
| Organisation | Slug d'organisation TheHive (instances TheHive multi-tenant) |
| API key | Clé d'API TheHive du client avec `case:create`, `observable:create`, `task:create` |
| Verify TLS | Activé par défaut ; désactivez-le pour un TheHive de développement auto-signé |

**Il n'existe aucune API pour modifier les paramètres d'intégration de TheHive en V1.** L'appel à TheHive réside dans le **runs-worker par tenant** (qui détient les liaisons MCP), et non dans le pod d'API central ; par conséquent, définir les variables d'environnement `THEHIVE_*` sur `soctalk-system-api` n'a aucun effet sur le worker. Pour configurer TheHive en V1, définissez les variables d'environnement sur le Deployment `soctalk-runs-worker` du tenant dans l'espace de noms `tenant-<slug>` (et effectuez un nouveau rendu via `helm upgrade` du chart de tenant, ou `kubectl set env` suivi d'un `rollout restart`). Une surface de configuration propre pilotée par l'API est prévue dans la feuille de route.

## Ce qui est exporté

En V1, l'export vers TheHive se produit **de manière synchrone au moment du nœud de graphe** via le nœud `thehive_worker` qui appelle l'API de TheHive à travers MCP. Aujourd'hui, cela crée le cas (titre + sévérité reflétés depuis le verdict SocTalk) et les observables. La surface plus riche, tâches dérivées de `next_actions`, mise en miroir dans la chronologie des justifications des workers / décisions de revue humaine, **outbox asynchrone + réessai**: est décrite dans les versions antérieures comme la cible de conception, mais n'est **pas implémentée dans cette version**. Si TheHive est injoignable, le nœud worker journalise l'échec et le cas se poursuit dans SocTalk sans contrepartie exportée. Il n'y a pas de boucle de réessai, pas d'outbox, pas de champ « dernière erreur » persisté, et pas de surface de tableau de bord pour les exports échoués, les échecs ne sont visibles que dans les logs structurés de l'orchestrateur.

Correspondance des types d'observables (selon l'implémentation V1) :

| Type SocTalk | `dataType` TheHive |
|---|---|
| `ip` | `ip` |
| `fqdn` | `fqdn` |
| `url` | `url` |
| `hash_md5`, `hash_sha1`, `hash_sha256` | `hash` |
| `email` | `mail` |
| `filename` | `filename` |
| `user` | `other` (avec `tags: user`) |
| `process` | `other` (avec `tags: process`) |
| `registry_key` | `registry` |

## TheHive intégré : pas dans cette version

Le chart `soctalk-tenant` en V1 n'intègre pas TheHive en tant que sous-chart, `Chart.yaml` liste `dependencies: []`. Les opérateurs qui souhaitent une instance TheHive par tenant l'exécutent eux-mêmes (`helm install` manuel dans l'espace de noms du tenant, ou géré par le client ailleurs). Un sous-chart intégré avec des secrets d'administration gérés par le chart est décrit dans les versions antérieures comme la cible de conception, mais figure dans la feuille de route.

## TheHive géré par le client : notes

- Le TheHive du client doit être joignable depuis le plan de contrôle SocTalk (sortie vers l'URL du TheHive du client).
- Le client crée la clé d'API avec les portées minimales listées ci-dessus. SocTalk n'a pas besoin d'une portée d'administration.
- Si le TheHive du client applique des listes d'autorisation d'adresses IP source, ajoutez l'IP de NAT de sortie du plan de contrôle SocTalk à la liste d'autorisation.

## État / santé

Dans cette version, il n'y a **aucune boucle de ping de santé en arrière-plan** pour TheHive, SocTalk ne contacte TheHive que lorsqu'une enquête a quelque chose à exporter. Les échecs lors de cet appel sont journalisés uniquement dans la sortie structurée de l'orchestrateur ; il n'y a pas de champ d'erreur persisté ni de réessai basé sur une outbox. L'interface MSSP n'expose pas d'indicateur distinct « TheHive joignable ».

Pour surveiller la santé de TheHive, utilisez votre sonde externe habituelle (Prometheus blackbox exporter contre le `/api/status` de TheHive, etc.), c'est une responsabilité côté MSSP, et non une partie de SocTalk dans cette version.

## Faire tourner la clé d'API

1. Dans le TheHive du client, générez une nouvelle clé d'API avec les mêmes portées.
2. Corrigez le Secret de l'espace de noms du tenant qui contient les identifiants TheHive et redémarrez le runs-worker : `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Révoquez l'ancienne clé dans TheHive.

Un chemin de rechargement à chaud (surveillance du fichier Secret monté) est prévu.

## Pointeurs vers les sources

| Concept | Fichier |
|---|---|
| Worker / export TheHive | [`src/soctalk/workers/thehive.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/thehive.py) |
| Schéma des paramètres | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
| Pont d'outils MCP | [`src/soctalk/chat/mcp_tools.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/chat/mcp_tools.py) |
