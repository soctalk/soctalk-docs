# FAQ

Questions préalables à l'installation ou à l'achat qui ne rentrent pas clairement dans l'installation ou la référence.

## Qu'est-ce que SocTalk ?

Une plateforme SOC multi-tenant conçue pour les MSP et les MSSP. Un plan de contrôle unique orchestre les stacks Wazuh propres à chaque client ; un pipeline AI trie les alertes et propose des actions ; des analystes humains approuvent les escalades. Entièrement open source.

## Qu'est-ce qui est open source par rapport au commercial ?

**Tout ce qui se trouve dans le dépôt [`soctalk/soctalk`](https://github.com/soctalk/soctalk) est sous licence Apache 2.0** — le plan de contrôle, le pipeline AI, l'intégration Wazuh, les charts, la VM de démonstration. Il n'existe aucune séparation de fonctionnalités « communauté vs entreprise ».

Un service d'hébergement géré (SocTalk Cloud) existe pour les MSP qui ne veulent pas exploiter la plateforme eux-mêmes. Le service hébergé utilise le même code que la distribution ouverte.

## Puis-je l'évaluer sans cluster Kubernetes ?

Oui — l'[image de VM de démonstration](/fr-fr/quickstart-vm) est une installation mono-machine. Démarrez-la sur KVM, VMware, Hyper-V, Azure, ou convertissez-la depuis un format raw. Cinq minutes suffisent pour obtenir une installation multi-tenant fonctionnelle avec un tenant `demo` intégré.

## Puis-je l'exécuter sur un seul nœud de façon permanente ?

Oui pour de très petits déploiements (1 à 2 clients, faible volume d'alertes). La VM de démonstration utilise le profil `poc`, qui suppose un stockage éphémère et n'est pas dimensionnée pour une charge soutenue. Pour un usage client réel :

- Augmentez les ressources de la VM (16 Go de RAM + 200 Go de SSD pour ~3 petits tenants).
- Utilisez le profil `persistent` lors de l'intégration des tenants.
- Ajoutez des sauvegardes (voir [Sauvegarde et restauration](/fr-fr/backup-restore)).

Pour plus de ~3 tenants, prévoyez un cluster multi-nœuds.

## Fonctionne-t-il en environnement isolé (air-gapped) ?

Oui, moyennant quelques étapes supplémentaires :

- **Images de conteneurs** : mettez en miroir `ghcr.io/soctalk/*` vers votre registre interne. Le chart accepte `image.registry: your.registry.example/soctalk`.
- **Chart Helm** : `helm pull oci://ghcr.io/soctalk/charts/soctalk-system` une fois, hébergez-le dans un registre OCI interne, puis pointez les installations vers celui-ci.
- **LLM** : utilisez un endpoint local compatible OpenAI (vLLM, proxy Ollama, proxy Bedrock on-prem). Voir [Fournisseurs LLM](/fr-fr/integrate/llm-providers).
- **Analyseurs Cortex** : tout analyseur nécessitant Internet ne fonctionnera pas. Utilisez uniquement des analyseurs on-prem (MaxMind GeoIP, MISP interne) ou désactivez Cortex.
- **GitHub Releases** : téléchargez l'[image de VM](/fr-fr/downloads) sur un hôte connecté et transférez-la manuellement (sneakernet).

Le flux [`scripts/dev-up.sh`](https://github.com/soctalk/soctalk/blob/main/scripts/dev-up.sh) s'exécute sans Internet une fois les images mises en miroir.

## Quel est le coût LLM par tenant ?

Très variable, il dépend de :

- Le volume d'alertes (une enquête par alerte qui survit à la corrélation)
- Le budget de tokens par exécution (`case_runs.tokens_budget`, valeur par défaut du modèle 200 000)
- La sélection du modèle (`fast_model` + `reasoning_model`)
- La fréquence à laquelle le verdict indique `needs_more_info` (ce qui provoque une nouvelle exécution)

Ordre de grandeur avec le budget par défaut de 200 000 tokens par exécution et un usage typique : 30 alertes/jour × ~60k tokens/enquête × 5 $/Mtok en entrée ≈ 9 $/jour par tenant sur une configuration compatible OpenAI à bas coût. Ce chiffre est divisé par 5 à 10 avec un fast model moins cher. Voir [Observabilité — Coût par tenant](/fr-fr/observability#per-tenant-cost) pour le mesurer.

## Différents clients peuvent-ils utiliser des modèles LLM différents ?

Oui — surcharge par tenant au moment de l'intégration. Le modèle défini à l'échelle de l'installation est la valeur par défaut ; les tenants s'en écartent en spécifiant le leur. Voir [Fournisseurs LLM — Surcharges par tenant](/fr-fr/integrate/llm-providers#per-tenant-overrides).

## Un client peut-il apporter sa propre clé LLM ?

Oui — la surcharge par tenant s'applique aussi à la clé API. Le magasin faisant autorité est `IntegrationConfig.llm_api_key_plain` dans Postgres ; le contrôleur la matérialise dans `Secret/tenant-llm-key` au sein du namespace **du tenant** (et non `soctalk-system`), que le runs-worker monte. Utile pour l'isolation de la facturation.

## SocTalk envoie-t-il les données des clients à Anthropic / OpenAI ?

Uniquement ce sur quoi le pipeline AI raisonne : le corps de l'alerte, les observables extraits et les sorties des workers. Le runtime n'exfiltre pas les données au repos — seulement ce qui figure dans l'état de l'enquête en cours. Si vous avez besoin d'une posture plus stricte, utilisez un endpoint LLM on-prem (vLLM, Ollama). Voir [Fournisseurs LLM — Basculer vers Anthropic / réglages runtime](/fr-fr/integrate/llm-providers#runtime-only-knobs-env-not-chart).

## Remplace-t-il mes analystes ?

Non. SocTalk est positionné comme un **copilote**, pas comme un remplacement. Le nœud de verdict décide `escalate | close | needs_more_info` ; une escalade passe toujours par une porte de [revue humaine](/fr-fr/human-review). Sans l'humain, un MSSP à fort volume aurait toujours besoin d'analystes pour traiter les décisions que SocTalk leur achemine.

La valeur réside dans la compression — la même équipe d'analystes peut gérer 5 à 10 fois le volume d'alertes, car les cas de routine se clôturent automatiquement et seuls les cas ambigus atteignent la revue humaine.

## Fonctionne-t-il sans Wazuh ?

Le plan de données actuel repose uniquement sur Wazuh. La surface d'outils MCP (`wazuh.*`, `cortex.*`, `thehive.*`, `misp.*`) est enfichable, si bien que d'autres SIEM constituent des ajouts envisageables. Aucun n'est livré à ce jour.

## Quelle est la posture de durcissement pour la production ?

- Row-Level Security de Postgres avec `FORCE ROW LEVEL SECURITY` comme filet de sécurité pour l'isolation des données inter-tenants.
- Cilium NetworkPolicy isolant chaque namespace `tenant-<slug>`.
- TLS partout (géré par cert-manager pour la production ; auto-signé pour l'assistant).
- Tout l'état du plan de contrôle est dans Postgres avec une sémantique de journal d'audit en ajout seul (append-only).
- Un administrateur bootstrap n'est créé que lorsqu'il est explicitement configuré dans les values (ou via un Secret pré-provisionné) ; changez son mot de passe après la première connexion avec `soctalk-auth set-password`.

Voir [Modèle de sécurité](/fr-fr/reference/security-model) pour la posture complète.

## Puis-je l'exécuter sur EKS / AKS / GKE ?

Oui — le chart cible un Kubernetes standard 1.30+. Branchez la StorageClass, le contrôleur d'ingress et le solveur DNS-01 cert-manager de votre cloud. Le [guide d'installation](/fr-fr/install) est centré sur K3s parce que c'est la distribution par défaut ; le chart lui-même n'y attache aucune importance.

## Passe-t-il à l'échelle de N clients ?

Testé jusqu'à ~50 tenants sur un cluster à 3 nœuds (16 vCPU / 64 Go / nœud). Le goulot d'étranglement est généralement l'indexeur Wazuh par tenant (chaque indexeur est un processus Java avec son propre heap) plutôt que le plan de contrôle SocTalk. Prévoyez ~6 à 8 Go de RAM et ~1,5 vCPU par tenant en profil `persistent` — voir [Dimensionnement](/fr-fr/reference/sizing).

## Qu'en est-il de la conformité (SOC 2, HIPAA, PCI) ?

La posture de la plateforme prend en charge les audits de type SOC 2 — journal d'audit en ajout seul, RBAC, chiffrement au repos (Postgres + indexeur Wazuh), chiffrement en transit. Elle n'est **pas** livrée avec une attestation SOC 2 ; c'est la responsabilité du MSSP pour son hébergement.

Pour HIPAA / PCI, le plan de données (Wazuh) contient souvent des données concernées par le périmètre. Traitez ce PVC comme faisant partie du périmètre et sauvegardez-le en conséquence (voir [Sauvegarde et restauration](/fr-fr/backup-restore)).

## Qu'y a-t-il sur la feuille de route ?

Les GitHub Issues et le tableau Projects de [`soctalk/soctalk`](https://github.com/soctalk/soctalk) font foi. Éléments à fort impact mentionnés dans la documentation comme prévus pour une prochaine version :

- Mode d'authentification par proxy exposé comme un réglage des values du chart (aujourd'hui : surcharge par variable d'environnement).
- API de mise à niveau de flotte (aujourd'hui : boucle manuelle `helm upgrade`).
- Émetteur de licences (identifiants d'installation signés hors ligne).
- Assistant d'intégration VPN géré par le client (aujourd'hui : modèle documenté uniquement).
- Onglet Agents par tenant sur la page de détail du tenant.

## Comment contribuer ?

Voir la page [Contribuer](/fr-fr/contribute).

## Où obtenir de l'aide ?

- Issues : https://github.com/soctalk/soctalk/issues
- Discussions : https://github.com/soctalk/soctalk/discussions
- Sécurité : voir SECURITY.md dans le dépôt
