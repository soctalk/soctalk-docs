# Fonctionnement

## Le problème

Un SOC croule sous les alertes. Un seul scan peut en produire des milliers, la plupart de ce qui est escaladé se révèle bénin, et les analystes s'épuisent à vider une file d'attente qui n'est presque que du bruit. Le plus difficile n'est pas de détecter les choses. C'est de décider, rapidement et sans risque, lesquelles des choses qui se sont déclenchées comptent vraiment.

## Trois générations de triage SOC

L'outillage de triage a traversé trois générations, et chacune a corrigé le problème de la précédente tout en laissant son propre angle mort.

La première génération, ce sont les **règles** : règles de signature et de corrélation dans un SIEM, et automatisation déterministe dans un SOAR. C'est rapide, auditable et prévisible, et c'est pourquoi cela reste la couche sous-jacente de tout le reste. C'est aussi grossier. Une règle se déclenche sur tout ce qui lui correspond, elle est donc bruyante, et un humain doit encore lire presque tout. C'est un détecteur de fumée : fiable, mais incapable de distinguer un vrai incendie d'une tartine brûlée.

La deuxième génération a ajouté l'**apprentissage automatique** : classifieurs supervisés, détection d'anomalies et analyse du comportement des utilisateurs qui apprennent à quoi ressemble la normalité et notent ce qui s'en écarte. Cela trie la file d'attente et fait remonter les cas étranges, mais cela nécessite des données étiquetées, cela dérive à mesure que l'environnement évolue, et cela vous rend un score plutôt qu'une raison. C'est un filtre anti-spam : il trie le tas, mais il vous donne un chiffre, pas une explication.

La troisième génération, ce sont les **modèles de langage**, capables de raisonner sur une alerte en contexte et de s'expliquer en langage clair. La première vague d'outils SOC dopés à l'AI les a utilisés de la manière évidente, en pointant un modèle sur chaque alerte, prompt en entrée et verdict en sortie. L'ennui, c'est qu'un modèle lisant une alerte isolée n'a aucune mémoire de ce qu'un analyste a déjà décidé, aucune image de l'état propre à l'organisation (il ne peut donc pas distinguer un changement autorisé d'une attaque qui lui ressemble à l'identique), aucune garantie qu'il ne clôturera pas avec assurance sur un indicateur réel, et aucune conscience des autres alertes qui l'entourent. Faire tourner un modèle de pointe sur chaque alerte brute coûte aussi cher, et la dépense pousse les équipes vers des modèles plus faibles précisément sur les cas où le jugement compte le plus. C'est un analyste brillant à son premier jour : il raisonne bien sur n'importe quelle alerte prise isolément, mais il ne se souvient de rien de la veille et on ne lui a remis ni le calendrier des changements ni l'inventaire des actifs.

![L'évolution du triage SOC : règles, apprentissage automatique, modèles de langage et la génération agentique que représente SocTalk](/diagrams/soc-evolution.svg)

Chaque génération est réellement bonne à quelque chose, et aucune n'a tort. Le problème, c'est que la plupart des produits en choisissent une et s'appuient dessus.

## Ce que SocTalk fait différemment

SocTalk est la génération agentique. Là où la première vague pointait un modèle sur une seule alerte, SocTalk fait tourner une boucle agentique autour du modèle : le modèle pilote une enquête déterministe, raisonne sur l'ensemble du cas corrélé et rend un verdict qui déclenche une action gouvernée, un humain contrôlant tout ce qui est dangereux. Le tout s'exécute à l'intérieur de garde-fous déterministes. Cela conserve dans le code les garanties de l'ère des règles, et saute délibérément le milieu opaque. La réduction du bruit que l'apprentissage automatique cherchait à réaliser est faite de manière déterministe à la place, par coalescence, corrélation et clôture basée sur des règles, si bien que rien dans le chemin de décision n'est une boîte noire entraînée. Le modèle n'est dépensé que sur les cas ambigus. Puis deux choses qu'aucune des générations précédentes n'avait sont ajoutées par-dessus : le pipeline se souvient de ce que les analystes décident, et un humain contrôle tout ce qui atteint un système en production.

Autrement dit, le modèle est un composant, pas le système tout entier. Le bruit est réduit avant qu'aucun modèle ne tourne. On donne au modèle un véritable contexte organisationnel. Les décisions critiques pour la sécurité reposent derrière un **plancher de sécurité**, un petit ensemble de vetos stricts écrits dans le code que ni une règle ni le modèle ne peuvent désactiver, à la manière d'un disjoncteur qui coupe le courant quoi que le câblage réclame. Les décisions des analystes sont mémorisées. Et le verdict déclenche une action gouvernée, la couche SOAR du système, un humain approuvant tout ce qui est dangereux. Le résultat, c'est que le modèle raisonne sur le milieu ambigu, et que les parties qui doivent être garanties le restent.

![Le pipeline de triage SocTalk : un entonnoir d'ingestion déterministe, un run agentique où le modèle n'est consulté que dans deux rôles, et une action gouvernée](/diagrams/triage-pipeline.svg)

## Deux plans et une fenêtre de stabilisation

Le pipeline s'exécute sur deux plans, ou étapes, et savoir lequel est lequel explique l'essentiel de la conception.

Le **plan d'ingestion** est côté serveur et entièrement déterministe. Lorsqu'un adaptateur (le collecteur côté tenant qui relaie les alertes Wazuh et similaires) poste un lot d'événements, ceux-ci sont dédupliqués, coalescés, corrélés, déconflictés et, dans bien des cas, résolus sans qu'aucun modèle ne tourne. Aucun modèle ne touche à ce plan.

Le **plan graphe** est la boucle agentique, une par tenant, s'exécutant comme son propre processus. C'est là que le modèle raisonne, et il ne le consulte que dans deux rôles : le routage et le verdict final. Beaucoup de cas en demandent encore moins, se clôturant sur une politique déterministe sans aucun appel de modèle. La boucle ne conserve aucune base de données propre : le cas lui est confié au démarrage du run et son résultat lui est renvoyé à la fin du run, et son enrichissement se produit via des appels d'outils vers le SIEM et les services de renseignement sur les menaces.

Entre les deux se trouve une **fenêtre de stabilisation** optionnelle. Lorsqu'un tenant en configure une, un run promu est retenu pendant un court délai afin qu'une rafale d'alertes corrélées puisse d'abord s'accumuler, et le modèle examine l'incident entier une seule fois plutôt que chaque fragment à mesure qu'il arrive. Une alerte de haute gravité contourne l'attente.

Agir sur le verdict se produit de retour sur le serveur, de manière déterministe, une fois le run terminé. Cela maintient le modèle hors de la boucle qui atteint les systèmes externes.

## À l'entrée : l'entonnoir déterministe

Beaucoup d'alertes sont résolues avant même qu'un modèle ne soit consulté, ce qui aide à garder le pipeline abordable et rapide, et tout cela relève de code déterministe.

**La coalescence et la déduplication font retomber la tempête.** La déduplication rejette un événement rejoué qui porte un ID déjà vu. La coalescence regroupe ensuite les alertes répétées provenant de la même règle sur le même actif dans une fenêtre de cinq minutes en un seul cas, si bien qu'une rafale de la même détection devient un cas au lieu de milliers. Le modèle, et l'analyste, voient un cas par incident plutôt que le flot brut. ([corrélation et coalescence dans le cœur IR](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/triage.py))

**La corrélation maintient un incident pour un cas.** Avec la corrélation d'entités activée, une nouvelle alerte qui partage une entité forte (un identifiant fiable comme un hôte ou un hachage de fichier) avec une enquête active s'y attache comme preuve plutôt que de démarrer un nouveau run sans contexte. Une source qui commence à dominer la corrélation, comme l'IP d'un scanner qui touche tout, est rétrogradée afin qu'elle ne puisse pas attirer des alertes sans rapport dans un même cas. La corrélation s'exécute avant les chemins de clôture, si bien qu'une alerte d'apparence bénigne qui appartient à un incident en cours n'est pas discrètement supprimée.

**La déconfliction des engagements tient les tests autorisés hors de la file d'attente.** Lorsqu'elle est activée, une fenêtre de pentest ou de red-team déclarée est mise en correspondance par source, hôte, technique et heure. L'activité qui s'y déroule est signalée et auditée mais jamais clôturée automatiquement, et l'activité d'un testeur qui déborde du périmètre est forcée vers un examen humain plutôt que clôturée. Voir [Utilisateurs et rôles](/fr-fr/users-and-roles) pour la façon dont les engagements sont déclarés et examinés.

**La clôture déterministe gère les cas évidents.** Les faux positifs de faible gravité et de haute confiance se clôturent par règle, et une forme bénigne récurrente peut se clôturer par référence à une décision antérieure, l'un comme l'autre sans modèle. Les bandes de clôture de faux positifs et le chemin de clôture opérationnel écartent délibérément tout ce qui est mappé à une technique ATT&CK (un identifiant standard de technique d'attaque), si bien qu'une alerte mappée à une technique n'est pas clôturée comme du bruit de routine.

**Le plancher de sécurité de l'ingestion protège l'ensemble.** Aucune clôture déterministe n'est autorisée à se déclencher au-dessus d'un indicateur connu (un observable suspect tel qu'une IP ou un hachage de fichier malveillant), d'un incident actif ou d'un coupe-circuit (un réglage opérateur qui arrête l'action automatique), et un plafond de volume agit comme un disjoncteur, de sorte qu'une règle emballée se dégrade vers « les humains regardent » plutôt que vers une suppression de masse.

Tout ce qui survit à l'entonnoir est promu : cela devient une enquête, planifiée pour un run de triage.

## Le run de triage : deux rôles de modèle, et beaucoup de déterminisme

Le run est une boucle agentique, mais l'empreinte du modèle à l'intérieur est petite et délibérée.

La boucle s'ouvre sur une porte déterministe. Si l'alerte correspond à une [politique de triage](/fr-fr/triage-policies) dont la disposition (le résultat à appliquer : clôturer, escalader ou demander davantage d'informations) est garantie et incontestée, l'affaire est réglée là, et le modèle n'est jamais consulté.

Pour tout le reste, un **superviseur** décide de la prochaine étape. C'est le premier des deux rôles de modèle, et tout son travail est le routage : enquêter, enrichir, contextualiser, décider ou clôturer. Il ne fait lui-même aucun travail de domaine, et il peut lui falloir plusieurs tours de routage avant de décider.

Le travail vers lequel il route est déterministe. Les **étapes d'enrichissement** tirent le contexte hôte et processus du SIEM, vérifient la réputation d'un observable via les analyseurs Cortex et recherchent le contexte de renseignement sur les menaces dans MISP. Ce sont des appels d'outils et des heuristiques, pas des appels de modèle. Une idée reçue fréquente au sujet du triage par AI est que le modèle fait l'enrichissement. Ici il ne le fait pas : l'enrichissement est une orchestration d'outils déterministe, et le modèle ne fait que lire les résultats.

Chemin faisant, le run rassemble son [contexte d'autorisation](/fr-fr/authorization) : les faits d'état de l'organisation (tickets de changement, maintenance approuvée, contexte de compte et d'actif) qui disent si cette activité était autorisée. L'autorisation est ce qui permet au pipeline de séparer un changement autorisé d'une attaque qui produit une alerte identique à l'octet près, une distinction qu'aucune recherche de réputation ne peut faire.

Lorsque le superviseur en a assez, il transmet au **verdict**, le second rôle de modèle. C'est le seul endroit où un modèle de raisonnement pèse tout ce que le run a rassemblé et propose une disposition : clôturer, escalader ou demander davantage d'informations.

Puis le déterminisme reprend la main. Le verdict est une proposition, pas un engagement. Un garde-fou de [politique de triage](/fr-fr/triage-policies) ne peut jamais que rehausser la décision du modèle, jamais l'abaisser : une clôture proposée au-dessus d'un signal malveillant ou d'un enregistrement d'autorisation contredit est transformée en escalade, et le vocabulaire du garde-fou rend la suppression impossible à exprimer. Si une clôture proposée touche un actif sensible, elle est retenue pour une validation humaine. Le modèle propose ; le code déterministe dispose.

## Les garanties : un plancher de sécurité en trois endroits

La règle selon laquelle l'autorisation, et le modèle, ne peuvent jamais clôturer au-dessus d'un signal malveillant connu, d'un indicateur non vérifié ou d'un cas connexe actif n'est pas laissée à la formulation d'un prompt. Elle est appliquée dans le code, en trois points indépendants du chemin de clôture :

- **À l'ingestion**, avant toute clôture déterministe, indexée sur un indicateur connu, un incident actif, un coupe-circuit et le plafond de volume.
- **Pendant le run**, lorsque le modèle propose une clôture, indexée sur un indicateur connu, un indicateur non vérifié et un enregistrement d'autorisation contredit. C'est le seul plancher qui consulte l'autorisation.
- **Sur le serveur**, lorsque la clôture est validée, indexée sur le coupe-circuit, un autre cas actif partageant les mêmes entités et le plafond de volume.

Chaque chemin de clôture est planchéié à son propre point : une clôture d'ingestion déterministe passe le premier, et une clôture proposée par le modèle passe le deuxième puis le troisième. L'autorisation peut abaisser le soupçon à ce plancher intermédiaire, mais elle ne peut jamais faire renoncer aucun d'eux à un indicateur connu ou à un cas connexe actif. Voir [Autorisation](/fr-fr/authorization) pour la façon dont une preuve de couverture abaisse le soupçon sans jamais outrepasser un signal malveillant.

## Agir sur le verdict

Une fois le run terminé, le serveur valide la disposition et agit dessus, de manière déterministe et en une seule transaction.

Une escalade atterrit dans la file de [revue humaine](/fr-fr/human-review) avec les preuves réelles jointes. Lorsque le run a calé précisément parce que l'autorisation était absente, l'examen porte une question d'autorisation typée, et la réponse de l'analyste est enregistrée comme un fait réutilisable, si bien que la même activité n'est pas redemandée aussi longtemps que cette autorisation tient. Cette mémoire « demander une seule fois » est décrite sur la page [Autorisation](/fr-fr/authorization).

Un verdict déclenche aussi les [playbooks de réponse](/fr-fr/response-playbooks). C'est la couche SOAR du système, le même genre d'automatisation déterministe et gouvernée qu'un analyste SOAR reconnaîtrait, sauf qu'elle est pilotée par un verdict raisonné plutôt que par une règle fragile, et c'est là que se manifeste la posture d'« action gouvernée ». Les actions sûres, écrire une note ou notifier un webhook, s'exécutent d'elles-mêmes. Les actions qui atteignent un système en production, isoler un poste ou désactiver un compte, ne s'exécutent jamais d'elles-mêmes : elles sont soulevées comme une proposition et un analyste les approuve d'abord. Une clôture ne peut jamais qu'annoter, un coupe-circuit de dispatch arrête aussitôt les actions de réponse actives (les audits fantômes peuvent tout de même consigner ce qui se serait déclenché), et l'ensemble du dispatch se produit côté serveur, jamais depuis la boucle du modèle.

Une dernière touche déterministe gère le calendrier. Si de nouvelles preuves corrélées sont arrivées pendant que le run était en cours et que le cas est toujours ouvert, un run de suivi est démarré sur l'image désormais complète, si bien qu'une alerte arrivée tardivement n'est pas laissée à l'écart du cas auquel elle appartient.

## Ce qui rend cela différent

Rassemblées, quelques propriétés distinguent cela du fait de pointer un modèle sur chaque alerte :

- **Beaucoup d'alertes n'atteignent jamais un modèle.** La déduplication, la coalescence, la déconfliction et la clôture déterministe en résolvent beaucoup à l'ingestion, si bien que le modèle est dépensé sur les cas ambigus.
- **Un run consulte le modèle dans deux rôles seulement**, le routage et le verdict final, et beaucoup de cas se clôturent de manière déterministe sans aucun appel de modèle. L'enrichissement est une orchestration d'outils déterministe, pas une classification de modèle par alerte.
- **Un incident est un cas.** La coalescence et la corrélation donnent au modèle l'image corrélée entière, pas une alerte solitaire dépouillée de son contexte.
- **Le modèle propose, le code dispose.** Un garde-fou et un plancher de sécurité en trois endroits rendent structurellement impossible pour le modèle de clôturer au-dessus d'un indicateur connu, d'un enregistrement d'autorisation contredit ou d'un cas connexe actif.
- **Le pipeline raisonne sur l'autorisation.** Il peut distinguer un changement autorisé d'une attaque d'apparence identique, un jugement que la réputation et les signatures ne peuvent porter à elles seules.
- **Il se souvient.** La décision d'autorisation d'un analyste devient une mémoire réutilisable, si bien que la file cesse de poser une question déjà répondue aussi longtemps que cette autorisation tient.

## Où aller ensuite

Chaque étape a sa propre page et son code :

- [Autorisation](/fr-fr/authorization) — le raisonnement sur l'état de l'organisation et la mémoire « demander une seule fois ».
- [Politiques de triage](/fr-fr/triage-policies) — les garde-fous déterministes sur le run.
- [Playbooks de réponse](/fr-fr/response-playbooks) — transformer un verdict en action gouvernée.
- [Revue humaine](/fr-fr/human-review) — la file de revue et le chemin de décision de l'analyste.
- [Pipeline AI](/fr-fr/ai-pipeline) — le graphe agentique plus en détail.
- [Architecture](/fr-fr/reference/architecture) — le déploiement et le modèle de données.

Le code du pipeline se trouve sous [`src/soctalk/core/ir/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/core/ir) (plan d'ingestion), [`src/soctalk/graph/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/graph) et [`src/soctalk/supervisor/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/supervisor) (plan graphe), et [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response) (réponse).
