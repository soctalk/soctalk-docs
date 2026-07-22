---
layout: home

hero:
  name: SocTalk
  text: Plateforme SOC AI-first pour MSP et MSSP
  tagline: Exécutez une stack Wazuh dédiée par client sur votre propre Kubernetes, derrière un plan de contrôle unique.
  actions:
    - theme: brand
      text: Essayer la VM de démonstration
      link: /fr-fr/quickstart-vm
    - theme: brand
      text: Déploiement pilote MSSP
      link: /fr-fr/mssp-pilot
    - theme: alt
      text: Installation en production
      link: /fr-fr/install
    - theme: alt
      text: GitHub
      link: https://github.com/soctalk/soctalk

features:
  - title: Multi-tenant
    details: Un plan de contrôle unique exécute des stacks SOC par client dans des namespaces Kubernetes isolés, avec le RLS Postgres comme filet de sécurité pour l'isolation des données.
  - title: Plan de données Wazuh
    details: Chaque client dispose de son propre manager et indexer Wazuh. Les agents s'enrôlent via un ingress routé par nom d'hôte. Entièrement open source.
  - title: Triage par l'AI, contrôle humain
    details: Les workers LangGraph effectuent le triage et proposent des actions ; les analystes approuvent les escalades. BYO LLM par tenant.
---

## En trois étapes

**1. Évaluer, [VM de démonstration](/fr-fr/quickstart-vm).** Image unique, assistant dans le navigateur, 5 minutes jusqu'à une installation opérationnelle avec un tenant de démonstration. Disponible aux formats QCOW2, VMDK, VHDX, VHD et raw sur la [page de téléchargements](/fr-fr/downloads). Le meilleur moyen de voir l'analyste SOC AI répondre à de vraies requêtes Wazuh de bout en bout sur un ordinateur portable.

**2. Piloter, [déploiement pilote MSSP](/fr-fr/mssp-pilot).** L'étape suivante recommandée : deux environnements on-premise (plan de contrôle MSSP + 1 à 3 tenants), reliés par un mesh VPN compatible avec les pare-feu, exécutant le flux multi-tenant complet avec de vraies données client. État final : un analyste SOC AI répondant aux questions de vos premiers clients pilotes, et une capture d'écran prête à présenter aux parties prenantes.

**3. Production, [guide d'installation](/fr-fr/install).** K3s + Cilium + cert-manager + Helm. Comptez une heure, et terminez avec une installation multi-tenant durcie, prête pour votre base de clients.

## Ce que vous trouverez ici

- [Démarrer](/fr-fr/install), chemins d'installation (VM de démonstration + production), visite de l'interface MSSP.
- [Exploiter](/fr-fr/operations), opérations quotidiennes, cycle de vie des tenants, mises à niveau, dépannage.
- [Intégrer](/fr-fr/integrate/llm-providers), fournisseurs LLM, TheHive, Cortex, Slack.
- [Référence](/fr-fr/reference/architecture), architecture, modèle de sécurité, RLS, contrat de chart, REST API.
- [Contribuer](/fr-fr/contribute), environnement de développement, attentes sur les PR, processus de release.

Source : [github.com/soctalk/soctalk](https://github.com/soctalk/soctalk). Apache 2.0.
