# Cortex

[Cortex](https://thehive-project.org/) fournit l'analyse d'observables (réputation, détonation en sandbox, whois, etc.) via ses plugins « analyzer ». Le nœud [`cortex_worker`](/fr-fr/ai-pipeline) de SocTalk envoie les observables à Cortex pendant l'enrichissement.

## Modèle d'hébergement

Le chart `soctalk-tenant` en V1 n'a pas de sous-chart Cortex (`dependencies: []`). Les options sont les suivantes :

- **Cortex géré par le client**: le client exploite le sien ; le MSSP fournit l'URL et la clé API.
- **Pas de Cortex**: le pipeline AI tente tout de même la route `ENRICH` (le supervisor ignore que Cortex est absent) ; chaque invocation de `cortex_worker` échoue et l'échec est journalisé. Il n'existe pas de champ de statut par observable en V1 ; le worker se contente de renvoyer sans enrichissement et le supervisor poursuit.

Un « sous-chart Cortex intégré » était décrit dans des brouillons antérieurs comme une option prévue, mais il n'est **pas implémenté dans cette version**.

## Configurer (interface MSSP)

Détail du tenant → Settings → Cortex.

| Champ | Notes |
|---|---|
| Enable | Désactivé par défaut |
| URL | `https://cortex.<customer>.example` pour un Cortex géré par le client ; `http://cortex.tenant-<slug>.svc:9001` pour un Cortex intégré |
| API key | Clé API Cortex du client avec `analyze:any` |
| Verify TLS | Activé par défaut |
| Default TLP | `2` par défaut (Amber). Utilisé lorsque SocTalk soumet des observables qui ne portent pas de TLP |

**Il n'existe aucune API pour modifier les paramètres d'intégration Cortex en V1.** Les appels Cortex résident dans le **runs-worker par tenant**, et non dans le pod API central, si bien que les variables d'environnement sur `soctalk-system-api` sont sans effet. Pour configurer Cortex en V1, définissez les variables d'environnement sur le Deployment `soctalk-runs-worker` du tenant dans le namespace `tenant-<slug>` (`helm upgrade` du chart de tenant, ou `kubectl set env` + `rollout restart`). Faites tourner la clé API en patchant le Secret du namespace de tenant et en redémarrant le runs-worker. Une surface de configuration propre pilotée par API est prévue dans la feuille de route.

## Sélection de l'analyzer

Pour chaque observable, le worker essaie le **premier nom d'analyzer** dans une `ANALYZER_MAP` codée en dur (dans [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) pour le type de l'observable, sans vérifier si cet analyzer est effectivement installé sur l'instance Cortex. Si l'analyzer n'est pas installé (ou échoue), l'échec est journalisé et le worker renvoie sans l'enrichissement. Il n'y a pas de repli vers un second analyzer en V1 ; installez l'analyzer canonique nommé dans `ANALYZER_MAP` pour chaque type d'observable qui vous importe. L'exposition de l'ordre de préférence des analyzers en tant que valeur de chart est prévue dans la feuille de route.

## Coût

Cortex lui-même est gratuit ; les fournisseurs d'analyzers facturent les requêtes. SocTalk ne mesure pas directement les appels Cortex, mesurez-les côté fournisseur :

- VirusTotal : quota par clé
- AbuseIPDB : quota par clé
- Hybrid Analysis : quota par clé

Le débit d'observables par tenant est visible via `soctalk_tenant_events_ingested_total` (chaque événement ingéré déclenche environ 1 à 5 extractions d'observables) sur [Observabilité](/fr-fr/observability#per-tenant-counters-defined-surface).

## Comportement du worker

Le nœud `cortex_worker` possède une `ANALYZER_MAP` codée en dur (dans [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) qui associe chaque type d'observable à une courte liste de noms d'analyzers. Pour chaque observable, le worker soumet au **premier** analyzer de cette liste sans vérifier la disponibilité ; si cet analyzer n'est pas installé ou échoue, l'enrichissement de l'observable est enregistré comme ayant échoué.

Séquence :

1. Lit la liste d'observables actuelle du cas depuis l'état.
2. Pour chaque observable, recherche la liste d'analyzers dans `ANALYZER_MAP` pour son type.
3. Soumet au premier analyzer mappé via l'endpoint `/api/observable` de Cortex.
4. Interroge `/api/job/{id}/report` jusqu'à ce que le job se termine ou qu'un timeout par job se déclenche.
5. Ajoute le verdict (`safe`, `info`, `suspicious`, `malicious`) et le corps du rapport à l'état du cas. Les jobs en échec journalisent l'erreur et poursuivent.

Les appels Cortex en échec ne font pas échouer le run ; le worker journalise l'échec et revient au supervisor sans enrichissement pour cet observable. Le nœud de verdict raisonne à partir de tout contexte disponible.

## Cortex intégré : pas dans cette version

Le chart `soctalk-tenant` n'intègre pas Cortex en tant que sous-chart. Exploitez Cortex vous-même (géré par le client) si vous souhaitez l'enrichissement par analyzers. Un Cortex géré par SocTalk est prévu dans la feuille de route.

## Faire tourner la clé API

1. Générez une nouvelle clé dans Cortex avec `analyze:any`.
2. Patchez le Secret du namespace de tenant qui contient les identifiants Cortex et redémarrez le runs-worker : `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Révoquez l'ancienne clé dans Cortex.

## Ce qui ne figure pas ici

- Développement d'analyzers personnalisés, hors périmètre ; voir [TheHive-Project/Cortex-Analyzers](https://github.com/TheHive-Project/Cortex-Analyzers).
- Surcharges TLP/PAP par observable, prévues ; aujourd'hui, la valeur par défaut du tenant s'applique à chaque soumission.

## Pointeurs vers le code source

| Concept | Fichier |
|---|---|
| Nœud worker + ANALYZER_MAP | [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py) |
| Schéma des paramètres | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
