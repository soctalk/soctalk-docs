---
description: "Construisez une stack SOC open source avec Wazuh, TheHive, Cortex et MISP : le rôle de chaque outil, le coût réel de l'intégration et quand la packager."
---

# Construire une stack SOC open source : Wazuh, TheHive, Cortex et MISP — assemblés vs intégrés

Il existe une stack SOC libre et open source canonique, et elle repose grosso modo sur les quatre mêmes noms depuis des années : Wazuh pour la détection, TheHive pour la gestion des cas, Cortex pour l'analyse des observables, MISP pour le renseignement sur les menaces. Chaque projet excelle réellement dans son domaine, chacun est éprouvé, et ensemble ils couvrent l'essentiel de ce que vend une suite SOC commerciale. Le hic, c'est le mot *ensemble*. Les outils sont excellents ; l'intégration entre eux est un projet que vous construisez, puis dont vous assumez la charge.

Ce guide couvre le rôle de chaque brique, ce que leur assemblage coûte réellement, comment les exigences changent lorsque vous gérez la sécurité de plus d'une organisation, et où SocTalk s'inscrit — c'est-à-dire *au-dessus* de cette stack, pas à sa place.

## La stack SOC FOSS classique

**[Wazuh](https://wazuh.com/)** est la couche SIEM/XDR : un agent sur chaque terminal, un manager qui applique les règles de détection au flux d'événements, et un indexeur (basé sur OpenSearch) qui stocke et interroge les résultats. Il embarque d'origine la surveillance de l'intégrité des fichiers, la détection de vulnérabilités, l'analyse de journaux et un vaste jeu de règles par défaut. C'est là que naissent les alertes.

**[TheHive](https://thehive-project.org/)** est la couche de gestion des cas : une plateforme de réponse aux incidents de sécurité où les alertes deviennent des cas, où les cas portent des tâches et des observables, et où les équipes d'analystes collaborent avec une piste d'audit. Si Wazuh est le lieu où naissent les alertes, TheHive est celui où les enquêtes vivent et meurent.

**Cortex** est le compagnon de TheHive pour l'analyse des observables. Vous lui confiez une IP, un hash, un domaine ou une URL, et ses plugins d'analyse interrogent en parallèle des services de réputation et de sandbox — VirusTotal, AbuseIPDB, Hybrid Analysis et des dizaines d'autres — puis rapportent un verdict. Il transforme « voici un hash » en « voici ce que le monde sait de ce hash ».

**[MISP](https://www.misp-project.org/)** est la plateforme de renseignement sur les menaces : elle agrège, corrèle et partage des indicateurs de compromission entre flux et communautés de partage. Vérifier un observable dans MISP vous dit s'il appartient à une campagne ou à un acteur connus — un contexte qu'aucun des trois autres outils ne porte par lui-même.

Quatre outils, quatre missions distinctes, tous open source. Sur le papier, un SOC complet.

## La taxe d'intégration que personne ne budgète

Chacun de ces outils s'installe en un après-midi. C'est là que s'arrêtent les tutoriels de home lab et que commence le vrai travail, car aucun d'eux ne communique nativement avec les autres sous la forme dont un SOC de production a besoin.

La glu est à votre charge. Les alertes Wazuh ne deviennent pas des cas TheHive sans un forwarder que vous écrivez ou adoptez, puis maintenez à travers les changements d'API des deux côtés. Les analyseurs Cortex exigent des clés API par fournisseur, une gestion des limites de débit et une décision sur quel analyseur s'exécute pour quel type d'observable. MISP demande des flux configurés, des tâches de synchronisation planifiées et une curation des indicateurs sujets aux faux positifs avant d'oser automatiser à partir d'eux.

Vient ensuite la surface opérationnelle : quatre produits, cela signifie quatre systèmes d'authentification et calendriers de rotation des clés API, quatre cadences de mise à niveau susceptibles de casser votre glu à chaque version, quatre stratégies de sauvegarde et — depuis que TheHive repose sur Cassandra/Elasticsearch — une empreinte de datastore non négligeable rien que pour la gestion des cas. Ajoutez le TLS entre chaque paire, la supervision de chaque service, et la question de savoir qui est alerté quand le forwarder Wazuh-vers-TheHive cesse silencieusement de transférer.

Rien de tout cela n'est une critique des outils. C'est la nature même de la composition de projets indépendants : la couche d'intégration est un cinquième produit, sauf que personne ne le livre, ne le documente ni ne le met à niveau pour vous.

## Organisation unique vs MSSP : la bifurcation des exigences

Pour une organisation unique, la taxe ci-dessus est payable. Vous construisez la stack une fois, la glu sert un seul tenant, et un ingénieur compétent peut la maintenir en bonne santé à temps partiel.

Pour un MSP ou un MSSP, les exigences bifurquent brutalement :

- **L'isolation est non négociable.** Les alertes, cas et indicateurs du client A doivent être prouvablement invisibles pour le client B — contractuellement, et souvent réglementairement. Des outils mono-tenant partagés en font un exercice de configuration par outil, avec des modes de défaillance par outil.
- **Les stacks par client multiplient la taxe.** Dix clients sur des stacks dédiées, ce sont dix managers et indexeurs Wazuh à déployer, mettre à niveau et sauvegarder — et dix copies de votre glu.
- **L'onboarding doit être répétable.** Le onzième client doit être une commande, pas une semaine d'archéologie de wiki. Les stacks construites à la main dérivent ; la dérive devient incident.
- **Une vue unique.** Des analystes couvrant vingt clients ne peuvent pas alterner entre vingt tableaux de bord.

C'est l'écart entre « la stack SOC FOSS fonctionne » et « la stack SOC FOSS fonctionne en tant qu'activité commerciale ».

## Où SocTalk s'inscrit : un plan de contrôle au-dessus de la stack, pas un remplacement

[SocTalk](https://github.com/soctalk/soctalk) ne remplace aucun des quatre outils. C'est un plan de contrôle multi-tenant sous licence Apache 2.0 et une couche de triage AI construits *autour* de cette stack, pour les MSP et MSSP qui l'exploitent sur leur propre Kubernetes :

- **Wazuh est le plan de données.** Chaque client reçoit un manager et un indexeur Wazuh dédiés dans un namespace isolé, provisionnés par le plan de contrôle — ou vous apportez un Wazuh existant via le profil `provided`. Les agents s'enrôlent via un ingress routé par nom d'hôte, avec des secrets à portée tenant.
- **La couche de triage AI se place entre Wazuh et vos analystes.** Un entonnoir d'ingestion déterministe déduplique, regroupe et corrèle les alertes avant qu'un modèle ne s'exécute ; une boucle agentique LangGraph enquête sur ce qui survit ; les escalades passent toujours par un portail de revue humaine. Détails dans [Comment ça marche](/fr-fr/how-it-works).
- **TheHive, Cortex et MISP sont des intégrations**, consultées pendant l'exécution : Cortex pour la réputation des observables, MISP pour le contexte de renseignement sur les menaces, TheHive comme cible d'export des cas escaladés.
- **La machinerie multi-tenant est le produit** : isolation par namespace avec Cilium NetworkPolicy, la sécurité au niveau des lignes (RLS) de Postgres comme filet de sécurité côté données, une machine à états du cycle de vie des tenants, et une configuration LLM par tenant.

**Soyez au clair sur la surface d'intégration V1**, car c'est ici que l'honnêteté prime sur le marketing :

- L'[export TheHive](/fr-fr/integrate/thehive) est opt-in et **synchrone** — le worker appelle l'API de TheHive au moment du nœud de graphe, en créant le cas et les observables. Il n'y a ni outbox, ni boucle de retry, ni subchart TheHive embarqué ; si TheHive est injoignable, l'échec est journalisé et le cas continue dans SocTalk uniquement.
- [Cortex](/fr-fr/integrate/cortex) est **exclusivement géré par le client** en V1 — vous exploitez Cortex vous-même et SocTalk l'appelle. Pas de subchart embarqué ; la sélection des analyseurs utilise une table codée en dur, et les appels en échec ne sont pas fatals pour l'exécution.
- Les recherches **MISP** s'exécutent dans le `misp_worker` du pipeline contre votre instance MISP ; un subchart MISP embarqué est reporté à une version ultérieure.
- Le code de notification **Slack** et d'approbation bidirectionnelle existe dans le dépôt mais n'est **pas branché sur le runtime du chart V1** — la file de revue du tableau de bord est aujourd'hui la surface human-in-the-loop opérationnelle.

Autrement dit : SocTalk package le plan Wazuh multi-tenant et la couche de triage, et *se connecte aux* instances TheHive/Cortex/MISP que vous exploitez. La commodité des subcharts embarqués relève de la feuille de route, pas de la version publiée.

## Monter la stack soi-même, ou déployer SocTalk ?

Des critères honnêtes, puisque les deux voies sont open source :

**Montez vous-même la stack à quatre outils quand** vous êtes une organisation unique disposant de temps d'ingénierie, que vous voulez un contrôle maximal sur chaque composant, que votre volume d'alertes reste gérable pour votre effectif d'analystes et que la multi-tenance est hors sujet. La stack classique plus votre propre glu est un schéma éprouvé, et vous comprendrez chaque fil parce que vous l'aurez soudé vous-même.

**Regardez SocTalk quand** vous êtes un MSP/MSSP qui a besoin de stacks Wazuh par client répétables derrière un seul plan de contrôle, d'une isolation des tenants prouvable et d'un triage AI qui comprime le volume d'alertes avant qu'il n'atteigne les analystes — et que vous préférez exploiter une seule plateforme gérée par Helm plutôt que N stacks construites à la main. Vous exploitez toujours Kubernetes, et en V1 vous exploitez toujours vos propres TheHive, Cortex et MISP si vous en voulez.

Le moyen le plus rapide d'évaluer est la [VM de démo](/fr-fr/quickstart-vm) : une image, un assistant dans le navigateur, environ cinq minutes jusqu'à une installation multi-tenant opérationnelle avec un tenant de démo intégré. De là, [Comment ça marche](/fr-fr/how-it-works) explique le pipeline, et les pages [TheHive](/fr-fr/integrate/thehive) et [Cortex](/fr-fr/integrate/cortex) documentent précisément ce que font — et ne font pas — les intégrations V1, afin que vous puissiez planifier le reste de votre stack en conséquence.
