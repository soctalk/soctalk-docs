---
description: "Construisez une stack SOC open source avec Wazuh, TheHive, Cortex et MISP : le rôle de chaque outil, le vrai coût d'intégration, et quand la packager."
---

# Construire une stack SOC open source avec Wazuh, TheHive, Cortex et MISP : assemblée ou intégrée

Il existe une stack SOC libre et open source canonique, et elle repose à peu près sur les quatre mêmes noms depuis des années : Wazuh pour la détection, TheHive pour la gestion des cas, Cortex pour l'analyse des observables, MISP pour le renseignement sur les menaces. Les quatre sont des projets matures avec des années d'utilisation en production derrière eux, et ensemble ils couvrent l'essentiel de ce que vend une suite SOC commerciale. Le piège tient au mot *ensemble*. L'intégration entre les outils est un projet que vous construisez puis que vous assumez.

Ce guide couvre le rôle de chaque brique, ce que leur assemblage coûte réellement, comment les exigences changent quand vous gérez la sécurité de plus d'une organisation, et où SocTalk se situe, à savoir *au-dessus* de cette stack plutôt qu'à sa place.

## La stack SOC FOSS classique

**[Wazuh](https://wazuh.com/)** est la couche SIEM/XDR : un agent sur chaque endpoint, un manager qui applique les règles de détection au flux d'événements, et un indexeur (basé sur OpenSearch) qui stocke et recherche les résultats. Il embarque d'origine la surveillance d'intégrité des fichiers, la détection de vulnérabilités, l'analyse de logs et un vaste jeu de règles par défaut. C'est là que naissent les alertes.

**[TheHive](https://thehive-project.org/)** est la couche de gestion des cas : une plateforme de réponse aux incidents de sécurité où les alertes deviennent des cas, où les cas portent des tâches et des observables, et où les équipes d'analystes collaborent avec une piste d'audit. Si Wazuh est l'endroit où naissent les alertes, TheHive est l'endroit où les enquêtes vivent et meurent.

**Cortex** est le compagnon de TheHive pour l'analyse des observables. Vous lui confiez une IP, un hash, un domaine ou une URL, et ses plugins d'analyse interrogent en parallèle des services de réputation et de sandbox, de VirusTotal et AbuseIPDB jusqu'à Hybrid Analysis et des dizaines d'autres, puis rapportent un verdict. Il transforme « voici un hash » en « voici ce que le monde sait de ce hash ».

**[MISP](https://www.misp-project.org/)** est la plateforme de renseignement sur les menaces : elle agrège, corrèle et partage des indicateurs de compromission entre flux et communautés de partage. Vérifier un observable dans MISP vous dit s'il appartient à une campagne ou à un acteur connu, un contexte qu'aucun des trois autres outils ne porte à lui seul.

Cela fait quatre outils couvrant quatre métiers distincts, tous open source, et sur le papier un SOC complet.

## Le vrai coût d'intégration

Chacun de ces outils s'installe en un après-midi. C'est là que s'arrêtent les tutoriels de home lab, et que commence le vrai travail, car aucun d'eux ne parle aux autres d'origine sous la forme dont un SOC de production a besoin.

La glu est à votre charge. Les alertes Wazuh ne deviennent pas des cas TheHive sans un forwarder que vous écrivez ou adoptez, puis maintenez à travers les changements d'API des deux côtés. Les analyseurs Cortex exigent des clés API par fournisseur, une gestion des limites de débit, et une décision sur quel analyseur s'exécute pour quel type d'observable. MISP demande des flux configurés, des tâches de synchronisation planifiées, et des indicateurs sujets aux faux positifs à trier avant d'oser automatiser dessus.

Vient ensuite la surface opérationnelle : quatre produits signifient quatre systèmes d'authentification et calendriers de rotation de clés API, quatre cadences de mise à niveau qui peuvent casser votre glu à chaque version, quatre stratégies de sauvegarde, et, depuis que TheHive repose sur Cassandra/Elasticsearch, une empreinte de datastore non triviale rien que pour la gestion des cas. Ajoutez le TLS entre chaque paire, la supervision de chaque service, et la question de savoir qui est alerté quand le forwarder Wazuh vers TheHive cesse silencieusement de transférer.

Les outils eux-mêmes n'y sont pour rien ; c'est simplement ce qu'implique la composition de projets indépendants. La couche d'intégration équivaut à un cinquième produit, sauf que personne ne le livre, ne le documente ni ne le met à niveau pour vous.

## Organisation unique vs MSSP : la bifurcation des exigences

Pour une organisation seule, la taxe ci-dessus est payable. Vous construisez la stack une fois, la glu sert un seul tenant, et un ingénieur compétent peut la maintenir en bonne santé à temps partiel.

Pour un MSP ou un MSSP, les exigences bifurquent nettement :

- **L'isolation est non négociable.** Les alertes, cas et indicateurs du client A doivent être prouvablement invisibles pour le client B, contractuellement et souvent réglementairement. Des outils mono-tenant partagés en font un exercice de configuration par outil, avec des modes de défaillance par outil.
- **Les stacks par client multiplient la taxe.** Dix clients sur des stacks dédiées, ce sont dix managers et indexeurs Wazuh à déployer, mettre à niveau et sauvegarder, plus dix copies de votre glu.
- **L'onboarding doit être répétable.** Le onzième client devrait tenir en une commande plutôt qu'en une semaine d'archéologie de wiki. Les stacks montées à la main dérivent, et la dérive finit par se manifester en incident.
- **Une vue unique.** Des analystes couvrant vingt clients ne peuvent pas tourner entre vingt tableaux de bord.

C'est l'écart entre « la stack SOC FOSS fonctionne » et « la stack SOC FOSS fonctionne comme une activité commerciale ».

## Où SocTalk se situe : un plan de contrôle au-dessus de la stack

[SocTalk](https://github.com/soctalk/soctalk) laisse les quatre outils en place. C'est un plan de contrôle multi-tenant sous licence Apache 2.0 et une couche de triage AI construits *autour* de cette stack, pour les MSP et MSSP qui l'exécutent sur leur propre Kubernetes :

- **Wazuh est le plan de données.** Chaque client reçoit un manager et un indexeur Wazuh dédiés dans un namespace isolé, provisionnés par le plan de contrôle, ou vous apportez un Wazuh existant via le profil `provided`. Les agents s'enrôlent via un ingress routé par nom d'hôte avec des secrets à portée tenant.
- **La couche de triage AI se place entre Wazuh et vos analystes.** Un entonnoir d'ingestion déterministe déduplique, regroupe et corrèle les alertes avant qu'aucun modèle ne s'exécute ; une boucle agentique LangGraph enquête sur ce qui survit ; les escalades passent toujours par un portail de revue humaine. Détails dans [Comment ça marche](/fr-fr/how-it-works).
- **TheHive, Cortex et MISP sont des intégrations**, consultées pendant le run : Cortex pour la réputation des observables, MISP pour le contexte de renseignement sur les menaces, TheHive comme cible d'export des cas escaladés.
- **La machinerie multi-tenant est le produit** : isolation par namespace avec NetworkPolicy Cilium, sécurité au niveau des lignes de Postgres comme filet de sécurité des données, une machine à états du cycle de vie des tenants, et une configuration LLM par tenant.

**Connaissez la surface d'intégration V1 avant de bâtir vos plans dessus :**

- L'[export TheHive](/fr-fr/integrate/thehive) est opt-in et **synchrone** : le worker appelle l'API de TheHive au moment du nœud de graphe, en créant le cas et les observables. Il n'y a pas d'outbox, pas de boucle de retry, et pas de subchart TheHive embarqué ; si TheHive est injoignable, l'échec est journalisé et le cas se poursuit dans SocTalk uniquement.
- [Cortex](/fr-fr/integrate/cortex) est **géré par le client uniquement** en V1. Vous exécutez Cortex vous-même et SocTalk l'appelle. Pas de subchart embarqué ; la sélection des analyseurs utilise une table codée en dur, et les appels en échec ne sont pas fatals pour le run.
- Les recherches **MISP** s'exécutent dans le `misp_worker` du pipeline contre votre instance MISP ; un subchart MISP embarqué est reporté à une version future.
- Le code de notification **Slack** et d'approbation bidirectionnelle existe dans le dépôt mais n'est **pas branché dans le runtime du chart V1**. La file de revue du tableau de bord est aujourd'hui la surface human-in-the-loop opérationnelle.

SocTalk package le plan Wazuh multi-tenant et la couche de triage, et *se connecte aux* instances TheHive/Cortex/MISP que vous opérez. La commodité des subcharts embarqués reste sur la feuille de route ; cette version ne l'inclut pas.

## Quand construire la stack vous-même, et quand déployer SocTalk

Les deux voies sont open source, donc le choix repose sur des critères opérationnels :

**Montez vous-même la stack à quatre outils quand** vous êtes une organisation unique avec du temps d'ingénierie, que vous voulez un contrôle maximal sur chaque composant, que votre volume d'alertes reste gérable pour votre effectif d'analystes, et que la multi-tenancy est hors sujet. La stack classique plus votre propre glu est un schéma éprouvé, et vous comprendrez chaque fil parce que vous l'avez soudé vous-même.

**Regardez SocTalk quand** vous êtes un MSP/MSSP qui a besoin de stacks Wazuh par client répétables derrière un seul plan de contrôle, d'une isolation des tenants prouvable, et d'un triage AI qui comprime le volume d'alertes avant que les analystes ne le voient, et que vous préférez opérer une seule plateforme gérée par Helm plutôt que N stacks montées à la main. Vous exécutez toujours Kubernetes, et en V1 vous opérez toujours vos propres TheHive, Cortex et MISP si vous les voulez.

Le moyen le plus rapide d'évaluer est la [VM de démo](/fr-fr/quickstart-vm) : une image, un assistant dans le navigateur, environ cinq minutes jusqu'à une installation multi-tenant fonctionnelle avec un tenant de démo onboardé. De là, [Comment ça marche](/fr-fr/how-it-works) explique le pipeline, et les pages [TheHive](/fr-fr/integrate/thehive) et [Cortex](/fr-fr/integrate/cortex) documentent exactement ce que les intégrations V1 font et ne font pas, pour que vous puissiez planifier le reste de votre stack autour d'elles.
