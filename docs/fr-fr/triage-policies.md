# Politiques de triage

Un LLM qui trie une alerte `sudo` est un analyste brillant et une piètre garantie. Posez-lui deux fois la même question et vous pouvez obtenir deux réponses. Dites-lui de toujours consulter l'enregistrement de changement avant de décider, et il le fera — le plus souvent, en général. Mais une partie du triage ne relève pas du jugement. Une étape de collecte de preuves *doit* s'exécuter avant qu'un verdict ne compte. Une clôture sur un actif PCI *doit* marquer une pause pour un humain. Un déluge de bruit lié à la santé des agents *ne devrait* coûter aucun appel de modèle. Pour ces cas, vous ne voulez pas de raisonnement. Vous voulez une règle.

Une **politique de triage** est cette règle, écrite sous forme de données. Elle ne remplace pas l'agent — elle enveloppe quelques barrières déterministes autour de la **boucle agentique** (le cycle superviseur-et-outils qui enrichit, enquête et raisonne jusqu'à un verdict). Chacune d'elles obéit à la même loi :

> **Le LLM propose. Une barrière déterministe dispose.**

Le modèle reste libre de raisonner. Une fonction pure décide si sa sortie prend effet, et elle n'intervient que sur des cas limites que vous pouvez *prouver* — un enregistrement d'autorisation qui contredit l'activité, un IOC sur l'alerte, un incident actif qui partage une entité avec celui-ci. Le milieu ambigu passe directement au modèle, là où il a sa place.

![Comment une politique de triage est évaluée à l'intérieur de la boucle agentique](/diagrams/triage-policy-loop.svg)

Lisez-le de haut en bas : une alerte est résolue par rapport au registre, exécute la boucle agentique sous les barrières de la politique, et aboutit à une **disposition** — la décision finale sur le cas (clôture automatique, escalade vers un humain, ou demande de preuves supplémentaires). Sous chaque clôture automatique repose un **plancher de sécurité** : un ensemble de vetos non contournables, au niveau du code, qu'aucune politique ne peut affaiblir, défini en détail [ci-dessous](#the-safety-floor). Les barrières numérotées constituent toute la surface, et la section suivante les parcourt une à une.

La seule propriété qui rend tout cela sûr : une politique de triage **rédigée par un tenant** peut rendre le triage **plus strict**, jamais plus laxiste — ses garde-fous ne font qu'élever le niveau, et le plancher dur sous chaque clôture ne peut être affaibli. (Les politiques *fichier* intégrées et vérifiées, ou gérées par l'opérateur, sont du code de confiance et ne sont pas liées par cette contrainte.) Le code se trouve dans [`src/soctalk/triage_policy/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/triage_policy).


## Où agit une politique de triage

Une politique de triage régit une exécution en quatre points — les barrières numérotées dans le diagramme ci-dessus.

1. **Résolveur.** Un nœud d'entrée met en correspondance l'alerte avec le registre et écrit la politique de triage active dans l'état de l'exécution. Si l'alerte appartient à une classe opérationnelle connue sans indicateurs de sécurité, l'exécution peut se clôturer de façon déterministe ici même, sans jamais appeler le modèle.
2. **Barrière de pré-décision.** Une politique peut exiger des étapes déterministes (par exemple, la collecte du contexte d'autorisation) avant qu'un verdict ne soit légal. Si le superviseur propose un verdict trop tôt, la barrière le réachemine d'abord vers l'étape requise. Une politique peut aussi restreindre quelles actions du superviseur sont légales à chaque phase, et cette restriction est appliquée à la sortie structurée du modèle avant l'appel, de sorte qu'une action illégale ne peut même pas être échantillonnée.
3. **Garde post-verdict.** Après que le modèle a rédigé un verdict, une fonction pure décide s'il est validé. Elle peut remplacer le brouillon (élever une clôture en escalade), l'interrompre (conserver le brouillon mais l'acheminer vers une validation humaine), ou le laisser tel quel. Chaque remplacement est enregistré.
4. **Plancher de sécurité.** Un ensemble de contrôles non contournables protège chaque chemin de clôture automatique. Ce n'est *pas* une seule étape — les vetos IOC/autorisation s'exécutent à l'intérieur de la garde post-verdict, et les vetos coupe-circuit, plafond de volume et incident actif s'exécutent à nouveau lorsqu'une clôture est validée sur les plans worker, serveur et ingestion. Le diagramme le représente comme un seul nœud par souci de clarté ; rien dans une politique de triage ne peut l'affaiblir, où qu'il s'exécute.

## Le plancher de sécurité

Le plancher est appliqué dans le code, et non dans les données de politique, et il s'applique sur chaque plan où un cas peut se clôturer automatiquement : la disposition du worker, le serveur qui la valide, et les chemins rapides d'ingestion (clôture mémoïsée et clôture automatique basée sur des règles). Une clôture est mise en veto et le cas est promu ou escaladé à la place lorsque l'une de ces conditions est vraie :

| Veto | Quand il se déclenche |
|---|---|
| IOC présent | Sur le chemin du verdict, un verdict d'enrichissement malveillant ou une correspondance MISP ; sur les chemins rapides d'ingestion, tout IOC brut sur l'alerte. |
| Autorisation contredite | Des enregistrements existent mais ne couvrent pas l'activité (expirés, hors fenêtre, périmètre incorrect, interdits par la politique). |
| IOC non vérifié | Une clôture au niveau du routeur avec des observables qu'aucun enrichissement n'a jamais vérifiés. |
| Incident actif | Une autre enquête active partage une entité éligible au rattachement avec celle-ci. |
| Coupe-circuit | La clôture automatique est désactivée, par tenant ou à l'échelle de l'installation. |
| Plafond de volume | Le nombre glissant de clôtures automatiques du tenant est épuisé. |

L'ensemble effectif de barrières sur toute exécution est le plancher plus tout ce que la politique active ajoute. Une politique de triage ne peut que rendre les choses plus strictes. C'est ce qui rend sûr d'autoriser des politiques rédigées par les tenants : une politique mal configurée ou hostile ne peut pas devenir un canal de suppression des détections.

Le coupe-circuit et le plafond de volume valent la peine d'être connus par leur nom. `SOCTALK_AUTO_CLOSE_KILL` sur le processus API, ou l'indicateur de politique `auto_close_kill` sur un tenant, bascule chaque clôture automatique en promotion sans aucun déploiement nécessaire, ce qui est le contrôle vers lequel vous vous tournez en pleine gestion d'incident. `auto_close_volume_cap` (500 par défaut sur 24 heures) signifie qu'une boucle de clôture emballée dégénère en « des humains examinent ceux-ci » plutôt qu'en suppression de masse.

## Politiques de triage intégrées

Deux sont livrées avec le produit. Les deux sont du code vérifié et en lecture seule.

**`dual-use-privileged-exec`** gère l'activité d'authentification hôte comme `sudo` et `su`, où le même événement est une administration de routine sous un enregistrement de changement couvrant, et un incident sans celui-ci. Elle exige l'étape `gather_authorization_context` avant tout verdict, retire `CLOSE` des actions légales du superviseur (afin que le niveau routeur, peu coûteux, ne puisse pas court-circuiter un cas dont tout l'enjeu est que le bénin et l'hostile se ressemblent), et exige une validation humaine sur toute clôture touchant un actif classé PCI.

**`agent-health-operational`** gère le bruit d'auto-surveillance des agents Wazuh, comme la règle 202 « Agent event queue is flooded ». Il s'agit d'une condition d'infrastructure, pas d'un événement de sécurité, donc la politique le clôture de façon déterministe sans aucun appel de modèle, ce qui rend aussi le résultat cohérent au lieu de varier d'une exécution à l'autre. Tout indicateur de sécurité sur l'alerte (une technique MITRE, un IOC, un signal malveillant, une classe non attestée, ou un niveau Wazuh critique — 12+) met en veto la clôture déterministe et envoie l'alerte au triage complet.

Vous pouvez voir les deux, avec chaque barrière et garde-fou détaillés, sur la page **Triage Policies** du tableau de bord MSSP.

## Le schéma

Une politique de triage est constituée de données. Un interpréteur générique unique en exécute un nombre quelconque.

```yaml
id: regulated-privileged-exec
version: 2
tenant: acme                       # a tenant slug or id; authored policies are always scoped
status: shadow                     # active | shadow
priority: 70                       # lower wins on a multi-match; authored/file >= 60
applies_to:
  rule_groups: [sudo]
  rule_ids: []
  authorization_tracks: [account]
required_steps: [gather_authorization_context]
decision_modules: [authorization_engine]
legal_actions:
  decide:  [VERDICT]               # an unlisted phase is unconstrained
close_signoff_data_classes: [pci]
guardrails:
  - when:
      "and":
        - "==": [{ "var": "authz.class" }, "contradicted"]
        - "==": [{ "var": "verdict" }, "close"]
    effect: override
    to: escalate
    reason: acted outside the terms of an authorization
```

Lisez cette condition ainsi : si la classe d'autorisation est ressortie `contradicted` et que le modèle a rédigé une `close`, élevez-la en `escalate`. Chaque nœud est un opérateur unique appliqué à ses arguments, et `var` lit un champ du contrat d'état.

| Champ | Signification |
|---|---|
| `applies_to` | Quelles alertes la politique régit. Mise en correspondance sur les groupes de règles, les identifiants de règles, ou le rail d'autorisation de l'activité de l'alerte — les trois sont combinés par OU. |
| `required_steps` | Nœuds déterministes qui doivent s'exécuter avant qu'un verdict ne soit légal. |
| `decision_modules` | Déclare les moteurs vérifiés sur lesquels la politique s'appuie (aujourd'hui : `authorization_engine`), validés par rapport aux modules connus. La consultation au runtime est actuellement pilotée par `required_steps` (par exemple `gather_authorization_context`), et non par ce champ. |
| `legal_actions` | Les actions du superviseur autorisées par phase (`triage` jusqu'à ce que les étapes requises se soient exécutées, puis `decide`). Une phase non listée n'est pas contrainte. |
| `close_signoff_data_classes` | Une clôture validée sur un actif appartenant à l'une de ces classes est interrompue pour validation humaine. |
| `guardrails` | Règles déclaratives de remplacement ou d'interruption. Voir ci-dessous. |
| `priority` | Ordre du registre. Les politiques intégrées occupent 10 et 50 ; tout ce qui est rédigé ou chargé depuis un fichier doit être 60 ou plus, afin de ne jamais pouvoir surclasser les protections d'une politique intégrée. |

Certaines capacités sont contraintes par l'origine d'une politique :

- **Les dispositions déterministes** (ce qu'`agent-health-operational` utilise pour clôturer sans modèle) sont **réservées aux politiques intégrées** — créer une nouvelle classe de clôture automatique est une décision de revue de code, pas une configuration.
- **Les politiques rédigées ne peuvent pas accorder `CLOSE`** dans `legal_actions`. L'accorder n'apporte rien de plus qu'une phase non contrainte (la ligne de base permet déjà la clôture par le routeur) mais permettrait au remappage d'action illégale de forcer chaque proposition vers une clôture automatique sans verdict, reposant uniquement sur le plancher grossier. Les décisions terminales passent plutôt par `VERDICT` ; la validation rejette `CLOSE` dans toute phase. Les politiques intégrées et fichier peuvent toujours lister l'ensemble complet d'actions.

## Conditions des garde-fous

Les conditions sont la seule logique qu'un auteur écrit, et elles s'exécutent dans un petit langage en bac à sable sur un contrat d'état documenté. Il n'y a pas d'accès aux attributs, pas d'appels de fonction, aucun moyen de nommer quoi que ce soit en dehors du contrat. Une condition est un arbre de nœuds à opérateur unique.

Opérateurs : `var`, les comparaisons (`==`, `!=`, `<`, `<=`, `>`, `>=`), les opérateurs logiques `and` / `or` / `!` / `!!`, et `in`.

Les champs qu'une condition peut lire :

| Champ | Ce que c'est |
|---|---|
| `authz.class` | `covered`, `contradicted`, ou `absent`, dérivé du moteur. |
| `authz.in_scope`, `authz.sanctioned_or_routine`, `authz.actor_genuine`, `authz.policy_allowed` | Les quatre *composantes d'attendu* — les booléens du moteur d'autorisation indiquant si l'activité relevait d'un périmètre approuvé, était sanctionnée ou de routine, était effectuée par un acteur authentique, et était permise par la politique. |
| `verdict` | La décision brouillon du modèle. |
| `verdict_confidence` | Sa confiance, de `0.0` à `1.0`. |
| `asset.data_classification`, `asset.environment`, `asset.criticality` | Attributs à confiance résolue de l'actif de l'activité. |
| `enrichment.ioc` | Si un signal malveillant est présent. |
| `correlation.active_incident` | Si un incident actif se chevauche. |

Un `effect` est soit `override`, soit `interrupt`. La suppression n'est pas exprimable : `close` n'est pas une cible valide, et un remplacement ne peut qu'élever une décision le long de l'échelle `close < needs_more_info < escalate`, jamais l'abaisser. Une condition qui référence un champ non déclaré ou un opérateur inconnu est rejetée lors de la validation de la politique, avant qu'elle ne puisse jamais s'exécuter. Notez que `enrichment.ioc` et `correlation.active_incident` sont aussi appliqués par le plancher dur indépendamment de tout garde-fou — dans une exécution worker livrée, `correlation.active_incident` n'est généralement renseigné qu'au plancher du moment de la validation, donc appuyez-vous sur le plancher pour ceux-là plutôt que de les redériver dans un garde-fou.

## En rédiger une dans l'éditeur no-code

Les administrateurs rédigent les politiques de triage depuis la page **Triage Policies** pendant qu'un tenant est épinglé — aucun YAML requis. Ce guide décrit la construction d'une politique réelle et non triviale de bout en bout. L'exemple, `prod-privileged-exec-strict`, régit les alertes d'exécution privilégiée sur un rail d'autorisation de type compte : il exige des preuves d'autorisation, restreint ce que l'agent peut faire, et ajoute des garde-fous à élévation seule ainsi qu'une barrière de clôture PCI.

Ouvrez **« + New triage policy »** (ou `/triage-policies/editor`). L'éditeur comporte deux colonnes — le **formulaire** du document à gauche, et une **projection du flux de décision** en direct plus un **simulateur « Try it »** à droite qui se re-rendent à chaque modification.

![L'éditeur no-code vierge](/screenshots/triage-policy-editor-01-blank.png)

**1 — Identité.** Donnez à la politique un identifiant de type slug et une **priorité** : un entier contraint par le plancher (`≥ 60`) où le plus bas l'emporte en cas de double correspondance, de sorte qu'une politique rédigée ne puisse jamais surclasser les protections intégrées.

![Identité : slug et priorité](/screenshots/triage-policy-editor-02-identity.png)

**2 — Quelles alertes possède-t-elle ?** Les trois filtres de correspondance sont combinés par OU. Ici, la politique possède les groupes de règles `sudo, su, sudoers`, les identifiants de règles `5402, 5501`, sur le rail `account`.

![Filtres de correspondance](/screenshots/triage-policy-editor-03-matchers.png)

**3 — Exigences d'enquête.** Exigez l'étape `gather_authorization_context`, déclarez la dépendance au module `authorization_engine`, et restreignez la phase `decide` à `VERDICT` uniquement. Notez que `CLOSE` n'est pas proposé — les politiques rédigées ne peuvent pas l'accorder.

![Exigences d'enquête](/screenshots/triage-policy-editor-04-requirements.png)

**4 — Validation de clôture.** Une clôture validée sur un actif classé `pci` ou `phi` est retenue pour un humain.

![Validation de clôture](/screenshots/triage-policy-editor-05-signoff.png)

**5 — Garde-fous.** Les garde-fous s'exécutent après le plancher de sécurité, dans l'ordre, la première correspondance l'emporte. Chaque condition peut être rédigée en JSON — le dialecte en bac à sable `{"op": [{"var": "field"}, value]}` avec des groupes `and`/`or`…

![Rédaction d'une condition en JSON](/screenshots/triage-policy-editor-06-guardrail-json.png)

…ou dans le constructeur visuel, qui fait l'aller-retour avec le JSON. Ce garde-fou se déclenche lorsque l'autorisation est **contredite** *et* que l'actif est **critique**, et élève la décision en `escalate`.

![La même condition dans le constructeur visuel](/screenshots/triage-policy-editor-07-guardrail-visual.png)

Deux autres complètent la politique : un remplacement en basse confiance vers `needs_more_info`, et un `interrupt` qui retient une clôture PCI pour revue humaine. L'ordre compte — le premier garde-fou correspondant dispose.

![Les trois garde-fous](/screenshots/triage-policy-editor-08-guardrails-all.png)

**6 — Lisez le flux, puis simulez.** La colonne de droite projette tout le document sur le pipeline : filtres de correspondance → phases → brouillon du LLM → **plancher de sécurité (toujours actif)** → garde-fous → validation → commit.

![Projection du flux de décision](/screenshots/triage-policy-editor-09-decision-flow.png)

Le panneau **« Try it »** prévisualise la logique garde-fou + plancher que l'éditeur peut modéliser — un sous-ensemble du chemin complet d'application worker/serveur/ingestion, pour un retour lors de la rédaction. Alimentez-le avec un cas autorisation-contredite, actif-critique et le résultat est `escalate` — mais il provient du **plancher de sécurité**, pas de cette politique. C'est l'invariant central rendu visible : une autorisation contredite est un veto de plancher non contournable, et les garde-fous de la politique ne font qu'*élever* par-dessus.

![Le simulateur « Try it » montrant l'escalade du plancher](/screenshots/triage-policy-editor-10-try-it.png)

`Create (shadow)` l'enregistre. Le formulaire et le document stocké sont le même artefact — « View as JSON » montre exactement ce qui est persisté.

![La politique terminée](/screenshots/triage-policy-editor-11-complete.png)

La validation à l'enregistrement est fail-closed et applique les mêmes règles que les politiques fichier plus quelques-unes plus strictes : l'identifiant doit être un slug, les étapes, modules de décision et phases d'actions légales référencés doivent être ceux que le runtime connaît réellement, `CLOSE` ne peut pas être accordé, et la définition est plafonnée en taille. Une référence inconnue est rejetée au moment de la rédaction plutôt qu'ignorée silencieusement au runtime. Chaque révision enregistrée est conservée en historique append-only.

## Shadow, puis activation

Une politique rédigée a quatre statuts — **draft**, **shadow**, **active**, **retired**. L'évaluation en shadow est fortement recommandée mais pas obligatoire : une politique peut être activée directement depuis draft.

En **shadow**, la politique est mise en correspondance et ses garde-fous évalués exactement comme le seraient ceux d'une politique active, et ses décisions qui se seraient déclenchées sont écrites dans la piste d'audit — mais elle ne change aucune disposition. Cela vous donne des preuves réelles de ce qu'elle ferait face au trafic réel avant qu'elle ne décide quoi que ce soit.

**L'activer** (l'action **Activate** sur la page Triage Policies) la fait entrer en gouvernance. Parce que le worker est un processus distinct dont le registre se charge une fois au démarrage, l'activation ne peut pas simplement basculer un indicateur en base de données — elle matérialise la définition dans le ConfigMap du worker du tenant lors du prochain `tenant.reconcile`, et le **déploiement du worker est la barrière d'activation** : la politique commence à gouverner uniquement lorsqu'un worker frais la lit. Modifier une politique active la maintient active et re-déploie avec la nouvelle définition ; la désactiver la ramène en shadow.

![Le cycle de vie de la politique rédigée : shadow, puis activation pour gouverner](/diagrams/triage-policy-lifecycle.svg)

Les opérateurs qui préfèrent gérer les politiques sous forme de code peuvent toujours emprunter la voie git : écrivez un fichier YAML dans le répertoire monté et déployez les workers. Le même registre charge à la fois les politiques rédigées-et-activées et les politiques fichier écrites à la main.

## Le câblage

Deux variables d'environnement le transportent :

- `SOCTALK_TRIAGE_POLICY_DIR` sur le runs-worker est le répertoire depuis lequel le registre se charge au démarrage.
- `SOCTALK_TENANT_TRIAGE_POLICIES_DIR` sur le contrôleur est le répertoire monté par l'opérateur que le chemin de provisionnement lit, valide, et rend dans les valeurs de chart de chaque tenant sous forme de ConfigMap monté.

Sur le chemin provisionné par chart, les politiques sont des valeurs de chart du tenant (`runsWorker.triagePolicies`, rendues comme le ConfigMap `soctalk-triage-policies`), et un changement de contenu appose une somme de contrôle sur le modèle de pod, de sorte qu'une modification déploie le worker automatiquement. Le déploiement est la barrière d'activation : parce que le registre se charge une fois par processus, une politique ne commence à gouverner que lorsqu'un worker frais la lit.

Chaque chargement, saut et rejet est journalisé. Un fichier qui échoue à la validation pour une raison quelconque (schéma incorrect, un champ inconnu, une condition malformée, une priorité qui surclasserait une politique intégrée) est rejeté en entier et ne gouverne jamais rien, de sorte qu'un mauvais déploiement dégénère en « cette politique n'est pas active », jamais en application erronée.
