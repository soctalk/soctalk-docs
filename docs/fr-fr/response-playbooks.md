# Playbooks de réponse

## D'un verdict à une action

Le [pipeline de triage AI](/fr-fr/ai-pipeline) de SocTalk existe pour répondre à une seule question à propos d'une alerte : est-elle réelle, et que doit-il advenir du cas. La boucle agentique enrichit l'alerte, rassemble le contexte, enquête et raisonne jusqu'à un verdict, et l'exécution se termine sur une disposition. La disposition est la décision finale, l'une parmi escalader vers un humain, clôturer automatiquement comme faux positif, ou demander davantage de preuves. Cette décision est le produit de l'ensemble du pipeline en amont, et c'est là que les [politiques de triage](/fr-fr/triage-policies) font leur travail, en gardant déterministes les parties du triage qui doivent l'être avec certitude tout en laissant le modèle raisonner sur le reste ambigu.

Une disposition à elle seule ne change rien dans le monde extérieur. Elle n'ouvre pas de ticket, ne notifie pas l'astreinte, ne transmet pas le cas à un SOAR et ne retire pas un ordinateur portable compromis du réseau. Un playbook de réponse est la couche qui agit sur la disposition. Il s'exécute strictement après que le triage a validé, il lit ce que le triage a produit, et il transforme cela en étapes concrètes.

Ce qu'il lit est un unique objet typé appelé l'enveloppe de disposition. SocTalk assemble l'enveloppe à l'instant où la disposition devient finale, à l'intérieur de la même transaction de base de données, et elle transporte tout ce sur quoi une réponse pourrait s'appuyer. Il s'agit de la disposition effective, c'est-à-dire la décision finale après que le seuil de sécurité a eu son mot à dire ; le verdict du modèle et sa confiance ; la sévérité de l'alerte ; ses groupes de règles et ses identifiants de règle ; les techniques et tactiques ATT&CK auxquelles elle a été rattachée ; les entités et IOC concernés ; et quels vetos du seuil de sécurité se sont déclenchés en cours de route. L'enveloppe est le contrat entre le triage et la réponse, et c'est aussi la charge utile exacte qu'un playbook transmet à tout système situé en aval.

![Comment un playbook de réponse consomme la disposition de triage et agit dessus](/diagrams/response-playbook-loop.svg)

Tout ce qui suit correspond à la partie droite de ce schéma : comment un playbook fait correspondre l'enveloppe, quelles actions il peut entreprendre, et comment les actions dangereuses restent derrière un humain. Le code se trouve dans [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response).

## Ce qui s'exécute tout seul, et ce qui nécessite une approbation

Les actions se répartissent en deux groupes selon l'ampleur de leur impact potentiel sur votre environnement. Écrire une note sur le cas ou envoyer une notification à un webhook peut se faire en toute sécurité de manière autonome, car le pire que cela puisse produire est du bruit, donc ces actions s'exécutent immédiatement sans que personne ne les approuve. Isoler un point de terminaison ou désactiver un compte est une tout autre affaire, donc ces actions ne se déclenchent jamais d'elles-mêmes. Lorsqu'un playbook en réclame une, il ne l'exécute pas. Il soulève une proposition sur le cas, et un analyste l'examine et l'approuve avant que quoi que ce soit ne se produise. Le modèle ne prend jamais d'action de confinement de lui-même durant le triage, et un playbook ne peut pas en prendre une de lui-même durant la réponse. Dans les deux cas, une personne valide toute action qui touche un système en production.

Trois règles vivent dans le code plutôt que dans les données de playbook, et aucun playbook ne peut les affaiblir. Une clôture est la direction qu'un attaquant voudrait le plus déclencher, donc sur le chemin de clôture un playbook peut uniquement annoter ou auditer, jamais entreprendre une action externe. Le coupe-circuit de dispatch, défini avec `SOCTALK_RESPONSE_DISPATCH_KILL` sur le processus API ou le drapeau `response_dispatch_kill` sur un tenant, arrête toute réponse sans déploiement progressif, ce qui est le contrôle à actionner quand un connecteur commence à se comporter anormalement au milieu d'un incident. Et une réponse ne se déclenche que si la disposition a réellement pris effet sur le cas. Si un analyste a clôturé ou fusionné l'enquête pendant que l'exécution était encore en cours, rien n'est dispatché contre un état qui n'a jamais eu lieu.

## Les trois capacités

Un playbook fait référence à une capacité par son nom et ne peut en nommer aucune autre. Un nom inconnu est rejeté lors de la validation du playbook. Trois capacités sont livrées aujourd'hui.

`annotate_investigation` écrit une note système sur le cas. Elle ne touche que SocTalk, elle s'exécute d'elle-même, et c'est la seule action autorisée sur une clôture.

`notify_webhook` poste l'enveloppe signée vers le webhook configuré du tenant. C'est le passage de relais vers un SOAR externe. SocTalk signe l'enveloppe et l'envoie, et le destinataire est propriétaire de tout ce qui se produit ensuite. Elle s'exécute également d'elle-même.

`external_action` est celle qui nécessite une approbation. Elle envoie une action nommée conjointement avec l'enveloppe signée vers un point de terminaison configuré par l'opérateur, et c'est là que se trouve le vrai travail, isoler un point de terminaison ou désactiver un compte, en dehors de SocTalk derrière un contrat stable. Elle ne s'exécute jamais sans qu'un analyste ne l'approuve au préalable.

Un détail garde `external_action` en sécurité. Un auteur de playbook nomme un point de terminaison et une action, jamais une URL. L'opérateur associe ce nom de point de terminaison à une URL réelle et à un secret de signature dans la politique de tenant `response_action_endpoints`, de sorte qu'un auteur peut demander d'isoler sur le point de terminaison `edr` mais ne peut pas choisir où la requête part réellement. Chaque requête est signée par HMAC, et elle refuse d'atteindre une adresse privée ou de type link-local.

## Le schéma

Un playbook de réponse est une donnée, et un unique interpréteur en exécute un nombre quelconque. Le playbook que le tutoriel ci-dessous construit ressemble à ceci :

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active or shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx), not names
  mitre_tactics: ["Lateral Movement"]   # tactic strings as your source emits them
response:
  on_escalate:
    - capability: external_action
      when: { ">=": [{ "var": "severity" }, 10] }
      params: { endpoint: edr, action: isolate_endpoint }
    - capability: notify_webhook
    - capability: annotate_investigation
      params: { body: "endpoint isolation proposed for lateral-movement alert" }
  on_close:
    - capability: annotate_investigation
      params: { body: "auto-closed as false positive" }
```

Le bloc `applies_to` décide quelles alertes le playbook prend en charge. Il fait correspondre sur les groupes de règles, les identifiants de règle, les identifiants de technique ATT&CK ou les tactiques ATT&CK, et les quatre sont combinés par OU, donc n'importe lequel qui correspond constitue une correspondance. Un `applies_to` vide correspond à toutes les alertes, ce qui est acceptable, car les listes de disposition décident déjà quand un playbook se déclenche réellement. La correspondance ATT&CK suit une règle. Les techniques sont mises en correspondance par leur identifiant canonique tel que `T1021`, jamais par leur nom, car les noms lisibles par un humain sont instables. Les tactiques sont mises en correspondance par la chaîne que la source de l'alerte émet, et Wazuh envoie des noms comme `Lateral Movement` plutôt que des références `TA`.

Sous `response`, `on_escalate` contient jusqu'à huit actions à entreprendre lorsque le cas est escaladé, et `on_close` contient jusqu'à quatre actions de niveau annotation pour une clôture automatique. Chaque action est un nom de capacité, une condition `when` optionnelle, et un ensemble de `params` que la capacité lit. Les params sont transmis tels quels. `external_action` extrait `endpoint` et `action` de ceux-ci et transmet le reste, et elle n'a pas besoin que l'hôte cible soit nommé dans les params, car l'enveloppe signée complète voyage avec chaque requête et les entités y sont embarquées.

## Conditions

Une condition `when` est la seule logique qu'un auteur écrit, et elle s'exécute dans le même petit langage cloisonné (sandboxed) que les garde-fous de triage. C'est un arbre de nœuds à opérateur unique sur un ensemble fixe de champs, sans accès aux attributs, sans appels de fonction, et sans aucun moyen de nommer quoi que ce soit en dehors du contrat. Les opérateurs sont `var`, les comparaisons `==`, `!=`, `<`, `<=`, `>` et `>=`, les logiques `and`, `or`, `!` et `!!`, ainsi que `in`. Une action ne se déclenche que lorsque sa condition est vérifiée, et une condition portant sur une donnée absente est simplement fausse plutôt qu'une erreur.

Les champs qu'une condition peut lire proviennent tous de l'enveloppe. Il y a la `disposition` effective et la `worker_disposition` que le modèle a proposée avant que le seuil ne la modifie ; `floor_vetoed`, qui indique si un veto de seuil a altéré le résultat ; `verdict_confidence` et `severity` ; les `rule.groups` et `rule.ids` de l'alerte ; et les champs ATT&CK, `mitre.techniques` contenant les identifiants canoniques `Txxxx` et `mitre.tactics` contenant les chaînes de tactiques de la source. Les quatre derniers sont des listes, donc vous les testez avec `in`. Écrire `{"in": ["T1021", {"var": "mitre.techniques"}]}` déclenche l'action lorsque l'alerte porte la technique T1021. Référencer un champ ou un opérateur que le contrat ne déclare pas fait rejeter le playbook lors de son enregistrement, bien avant qu'il ne puisse jamais s'exécuter.

## En construire un dans l'éditeur no-code

Les administrateurs créent des playbooks de réponse depuis la page **Response Playbooks** pendant qu'un tenant est épinglé, sans aucun YAML requis. Cette section détaille la construction du playbook `isolate-lateral-movement-endpoint` à partir du schéma ci-dessus, de bout en bout. Il propose d'isoler un point de terminaison lors d'une escalade de mouvement latéral à haute sévérité, notifie le SOC et annote le cas.

Ouvrez **« + New response playbook »** (ou naviguez vers `/response-playbooks/editor`). L'éditeur comporte deux colonnes. Le formulaire du document est à gauche, et un diagramme de flux dynamique est à droite, qui se réaffiche à chaque édition, montrant la disposition se déployant vers les actions, celles nécessitant une approbation étant d'abord acheminées par une étape d'approbation.

![L'éditeur no-code vierge](/screenshots/response-playbook-editor-01-blank.png)

Commencez par l'identité. Donnez au playbook un identifiant slug et une priorité, où un nombre plus petit l'emporte sur une correspondance multiple.

![Identité](/screenshots/response-playbook-editor-02-identity.png)

Ensuite, décidez quelles alertes il prend en charge. Les quatre matchers sont combinés par OU. Ce playbook prend en charge les groupes de règles `sudo` et `su` et, plus utilement, la technique ATT&CK `T1021` (Remote Services) ainsi que la tactique `Lateral Movement`, de sorte qu'il se déclenche sur toute alerte rattachée au mouvement latéral, quelle que soit la règle qui l'a levée. Le champ technique prend des identifiants, pas des noms, et le champ tactique prend la chaîne que votre source émet.

![Matchers, y compris ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

Maintenant l'action d'isolement. Sur escalade, ajoutez `external_action`, celle marquée « needs approval ». Nommez le point de terminaison que l'opérateur a configuré et l'action, qui est `isolate_endpoint`, dans ses params, et vous n'entrez jamais d'URL. Ajoutez une condition pour qu'elle ne se déclenche que sur une escalade à haute sévérité.

![L'action d'isolement avec une condition](/screenshots/response-playbook-editor-04-isolate.png)

Ajoutez les deux actions qui complètent la réponse et s'exécutent d'elles-mêmes. Un `notify_webhook` transmet le cas au SOAR du SOC, et un `annotate_investigation` laisse une piste d'audit.

![Les actions de notification et d'annotation, qui s'exécutent d'elles-mêmes](/screenshots/response-playbook-editor-05-tier0.png)

Lisez le flux pendant que vous construisez. La colonne de droite projette l'ensemble du document. L'enveloppe de disposition se déploie vers chaque action, l'action d'isolement est acheminée par une étape d'approbation avant de pouvoir s'exécuter, et les deux autres sont montrées s'exécutant d'elles-mêmes.

![Le diagramme de flux, avec l'action d'isolement acheminée par l'approbation](/screenshots/response-playbook-editor-06-flow.png)

Enregistrer avec **Create (shadow)** le persiste. Le formulaire et le document stocké sont le même artefact, et « Preview JSON » montre exactement ce qui est enregistré. La validation à l'enregistrement est fail-closed. L'identifiant doit être un slug, chaque capacité doit être l'un des noms vérifiés, `on_close` peut uniquement annoter, et les conditions doivent référencer le contrat déclaré. Une référence inconnue est rejetée pendant que vous créez, jamais silencieusement écartée à l'exécution.

![Le playbook terminé dans la liste, prêt à être activé](/screenshots/response-playbook-editor-07-list.png)

## En shadow, puis activation

Un playbook créé passe par quatre statuts : draft, shadow, active et retired.

En shadow, le playbook est mis en correspondance et ses actions sont sélectionnées exactement comme le serait un playbook actif, et ses actions qui se déclencheraient sont écrites dans la piste d'audit, mais rien n'est mis en file d'attente. Cela vous donne des preuves réelles de ce qu'il ferait face au trafic en direct avant qu'il ne fasse quoi que ce soit.

L'activer, avec l'action **Activate** sur la page Response Playbooks, le met en marche, et contrairement à une politique de triage, il prend effet en direct. SocTalk évalue les playbooks de réponse au fur et à mesure que chaque cas est décidé, de sorte qu'un playbook actif s'applique à la toute prochaine disposition sans déploiement progressif à attendre. Le désactiver le ramène immédiatement en shadow.

Lorsqu'une action nécessitant une approbation survient sur une escalade réelle, elle atterrit en tant que proposition sur le cas. L'analyste voit exactement ce qui s'exécuterait et contre quel hôte, et l'approuver est ce qui déclenche l'isolement. L'action s'exécute une seule fois, la réponse qu'elle a reçue est enregistrée, et une livraison répétée ne l'exécute jamais deux fois.

## Le câblage

Quelques éléments portent tout cela. `SOCTALK_RESPONSE_PLAYBOOK_DIR` sur le processus API est un répertoire de playbooks YAML chargés au démarrage, ce qui est le chemin géré par git pour les opérateurs qui préfèrent les playbooks sous forme de code. Les playbooks créés dans l'interface vivent dans la base de données à la place, conservés sous forme d'historique en ajout seul et cloisonnés de sorte qu'un tenant ne voie jamais que les siens, et SocTalk les fusionne avec les playbooks de fichiers de sorte que le playbook propre à un tenant l'emporte sur un playbook de fichier de même identifiant. `response_webhook_url`, avec un `response_webhook_secret` optionnel, définit la cible de `notify_webhook` sur un tenant. Et `response_action_endpoints` sur un tenant associe les noms de points de terminaison à leur url et leur secret pour `external_action`, ce qui est la façon dont l'opérateur garde le contrôle des cibles tandis qu'un playbook n'en nomme jamais qu'une seule.

Chaque correspondance, approbation, action et rejet est journalisé, et chaque action qui s'exécute enregistre l'identifiant et la version du playbook ainsi que la réponse qu'elle a reçue. Un playbook qui échoue à la validation est rejeté en entier et ne prend jamais effet, de sorte qu'une mauvaise édition finit en « ce playbook n'est pas actif » plutôt qu'en action erronée.
