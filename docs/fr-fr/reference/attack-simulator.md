# Simulateur d'attaque et linux-ep

Une paire d'outils de démonstration qui génèrent des alertes Wazuh réalistes afin qu'un opérateur MSSP puisse voir le [pipeline d'IA](/fr-fr/ai-pipeline) de SocTalk réellement à l'œuvre. Fortement recommandée pour les évaluations et les démonstrations en direct, sans alertes, l'agent n'a rien à trier.

Les deux sont livrés avec la distribution FOSS. Source :

- [`attack-simulator/`](https://github.com/soctalk/soctalk/tree/main/attack-simulator), scripts et pack de règles
- [`charts/linux-ep/`](https://github.com/soctalk/soctalk/tree/main/charts/linux-ep), chart Kubernetes qui exécute le simulateur

## Chart linux-ep

`linux-ep` démarre N pods d'endpoint Linux, chacun :

1. Installe l'agent Wazuh et s'enrôle auprès du Wazuh manager du tenant.
2. Exécute des techniques MITRE ATT&CK scriptées contre lui-même à un intervalle configurable.
3. Plafonne le nombre quotidien d'alertes simulées par pod (par défaut 30/jour UTC) pour maîtriser les dépenses en LLM.

Les pods s'enregistrent sous `linux-ep-0`, `linux-ep-1`, … de sorte que l'interface de SocTalk affiche des noms d'hôtes réalistes dans le flux d'alertes.

### Installation

```bash
helm install linux-ep oci://ghcr.io/soctalk/charts/linux-ep \
  --version 0.2.0 \
  --namespace tenant-demo \
  --set wazuh.managerHost=wazuh-demo-wazuh-manager \
  --set wazuh.credsSecret.name=wazuh-demo-wazuh-creds \
  --set replicas=2 \
  --set simulator.enabled=true \
  --set simulator.dailyAlertCap=30
```

Pour l'[image de VM de démonstration](/fr-fr/quickstart-vm), le simulateur est désactivé par défaut afin d'éviter de consommer le budget LLM sans surveillance ; activez-le explicitement via `simulator.enabled=true`.

### Valeurs Helm (les principales)

| Clé | Défaut | Effet |
|---|---|---|
| `replicas` | 1 | Nombre de pods d'endpoint |
| `wazuh.managerHost` | "" (requis) | Le nom d'hôte du Service Wazuh manager du tenant (par ex. `wazuh-demo-wazuh-manager`) |
| `wazuh.credsSecret.name` | "" (requis) | Secret existant contenant le mot de passe d'enrôlement `authd` (généralement `wazuh-<slug>-wazuh-creds`) |
| `wazuh.credsSecret.authdPasswordKey` | `AUTHD_PASS` | Clé du Secret pour le mot de passe `authd` |
| `simulator.enabled` | `false` | Interrupteur principal. Désactivé par défaut, le laisser désactivé maintient les pods inactifs (aucune alerte synthétique) |
| `simulator.attackDelay` | 10 | Secondes après le démarrage du pod (agent enrôlé) avant le premier TTP |
| `simulator.attackInterval` | 120 | Secondes entre les TTP suivants |
| `simulator.dailyAlertCap` | 30 | Plafond par pod d'émissions `SOCTALK_ATTACK` par jour UTC. 0 désactive le plafond |
| `image.repository` | `ghcr.io/soctalk/soctalk-linux-ep` | — |
| `securityContext.privileged` | `true` | Requis pour les TTP touchant au noyau (espaces de noms de processus, ajustements de permissions de fichiers) |

### Note sur les coûts

Chaque alerte simulée déclenche une enquête par IA, qui consomme des tokens LLM (typiquement : ~50k en entrée / ~10k en sortie par cas avec les modèles par défaut). Avec 2 pods × 30 alertes/jour = 60 enquêtes/jour. Ajustez `dailyCapPerPod` en fonction de votre budget de démonstration.

## Techniques simulées

25 TTP Linux issus de la matrice MITRE ATT&CK Enterprise. La liste complète se trouve dans [`attack-simulator/scripts/linux-techniques.txt`](https://github.com/soctalk/soctalk/blob/main/attack-simulator/scripts/linux-techniques.txt) ; résumée ici par tactique :

| Tactique | Identifiants TTP (sélection) |
|---|---|
| **Initial Access / Persistence** | T1098 (manipulation de comptes), T1547.001 (scripts de démarrage/connexion) |
| **Privilege Escalation** | T1548.003 (abus de sudo) |
| **Defense Evasion** | T1027 (commande obfusquée : décodage base64 + exécution), T1070 (suppression d'indicateurs) |
| **Credential Access** | T1110 (force brute), T1003.008 (accès à `/etc/passwd` + `/etc/shadow`) |
| **Discovery** | T1046 (découverte de services réseau), T1082 (informations système), T1083 (découverte de fichiers/répertoires), T1057 (découverte de processus) |
| **Lateral Movement** | T1021.004 (SSH) |
| **Collection** | T1560.001 (archivage de données pour la préparation d'exfiltration) |
| **Command and Control** | T1105 (transfert d'outils entrant) |
| **Exfiltration** | T1041 (via canal C2) |
| **Impact** | T1485 (destruction de données), T1486 (chiffrement de données), T1496 (détournement de ressources) |
| **Execution / Scheduling** | T1053.003 (tâche planifiée / cron) |

Chaque script émet une ligne syslog étiquetée `SOCTALK_ATTACK <TTP>: <description>` afin que Wazuh ait quelque chose à faire correspondre.

## Pack de règles Wazuh

[`charts/wazuh/templates/manager-local-rules.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/wazuh/templates/manager-local-rules.yaml) fournit des règles personnalisées dans la plage 100200-100299 :

- **100200**: chain-root : correspond à toute ligne syslog `SOCTALK_ATTACK`
- **100210 – 100225**: règles par TTP : attribuent une sévérité (niveau 10–14) et des tags par technique MITRE
- **100299**: règle attrape-tout pour les TTP non mappés (sévérité 8)

Les alertes produites portent les champs MITRE `attack.tactic`, `attack.technique` et une description lisible par un humain, de sorte que le [`wazuh_worker`](/fr-fr/ai-pipeline) de SocTalk dispose d'un contexte structuré pour raisonner.

## Exécuter une attaque unique

En dehors du chart, vous pouvez exécuter des techniques individuelles contre n'importe quel hôte doté d'un agent Wazuh :

```bash
ssh ops@<linux-ep-pod>
sudo /opt/scripts/run-attack.sh T1110
sudo /opt/scripts/run-attack.sh T1027.001
```

`run-attack.sh` est le point d'entrée ; il redirige vers les scripts propres à chaque TTP. Utile pour les démonstrations en direct où vous souhaitez déclencher une alerte spécifique sur commande.

## Retirer le simulateur

Pour une installation client en production où vous ne voulez pas que les alertes du simulateur diluent la télémétrie réelle :

```bash
helm uninstall linux-ep -n tenant-<slug>
```

Retire les pods d'endpoint. Le pack de règles Wazuh personnalisées reste en place mais est inoffensif tant qu'aucune ligne syslog `SOCTALK_ATTACK` ne l'atteint.

## Ce qui n'est pas inclus ici

- **Simulation d'endpoint Windows**: Linux uniquement dans cette version. Prévu à la feuille de route.
- **Simulation d'endpoint macOS**: idem.
- **Campagnes d'émulation d'adversaire**: TTP unique uniquement ; nous ne chaînons pas les TTP en scénarios multi-étapes.
- **Intégration Atomic Red Team**: `attack-simulator` est artisanal ; il ne consomme pas directement le YAML d'Atomic. La compatibilité est prévue à la feuille de route.
