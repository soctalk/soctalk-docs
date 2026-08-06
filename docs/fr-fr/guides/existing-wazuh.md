---
description: "Connectez le triage AI de SocTalk à un Wazuh que vous exploitez déjà : installez depuis le paquet OS, intégrez un tenant au profil provided et voyez la première alerte devenir un cas triagé et escaladé."
---

# Connecter SocTalk à un Wazuh existant

La plupart des équipes Wazuh ne partent pas de zéro. Il y a déjà un manager qui surveille des agents, un indexeur qui conserve des mois d'alertes et un dashboard depuis lequel l'équipe enquête au quotidien. Le profil de tenant `provided` de SocTalk est conçu exactement pour cette situation : SocTalk n'installe que ses propres composants, se connecte à votre Wazuh via le réseau et commence à triager les alertes que votre déploiement produit déjà. Rien ne change côté Wazuh, aucun agent ne se réenrôle et aucune donnée ne migre.

Ce guide parcourt tout le chemin sur un hôte Linux unique, du paquet OS jusqu'à la première escalade triagée par l'AI, et a été vérifié de bout en bout avec SocTalk v0.2.0 et Wazuh 4.12.0. Là où cette version présente des aspérités, le guide le signale et donne le contournement.

Si vous préférez que SocTalk déploie et gère Wazuh pour vous, c'est le rôle des profils `poc` et `persistent` ; voir [Intégrer un tenant client](/fr-fr/guides/wazuh-tenant-onboarding).

## Ce qu'il vous faut avant de commencer

Votre Wazuh existant doit être joignable depuis l'hôte SocTalk sur deux ports : l'API OpenSearch de l'indexeur (`:9200`) et l'API REST du manager (`:55000`). SocTalk s'authentifie séparément auprès de chacun, préparez donc les deux paires d'identifiants :

- un utilisateur de l'indexeur autorisé à interroger `wazuh-alerts-*` (le compte intégré `admin` fonctionne, même si un utilisateur en lecture seule est une meilleure pratique),
- un utilisateur de l'API du manager, comme le compte intégré `wazuh-wui`.

Les certificats auto-signés côté Wazuh sont la norme et sont pris en charge ; vous passerez `verify_ssl: false` au moment de l'intégration. Il vous faut aussi une clé API LLM par tenant. Le profil `provided` l'exige dès l'intégration, car un tenant BYO-SIEM n'a pas de solution de repli partagée par l'installation : la requête d'intégration est rejetée avec un 422 si la clé manque.

L'hôte SocTalk lui-même a besoin de l'empreinte habituelle : un Linux basé sur systemd (Ubuntu 24.04 et Rocky 9 forment le duo vérifié), 4 vCPU et 8 Go de RAM au minimum pour le plan de contrôle plus un tenant provided, et les ports 80/443/6443 libres. Comme le tenant n'exécute aucun Wazuh en propre, un tenant provided est nettement plus léger qu'un tenant `persistent`.

## Installer SocTalk depuis le paquet OS

Téléchargez le paquet correspondant à votre distribution depuis la [page des releases](https://github.com/soctalk/soctalk/releases) et installez-le ; la matrice complète des variantes est dans [Installer depuis un paquet OS](/fr-fr/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

Le paquet fournit un modèle d'environnement dans `/etc/soctalk/soctalk.env.example`. Copiez-le, renseignez votre identité MSSP, les identifiants administrateur, le nom d'hôte et la clé LLM, et gardez-le accessible à root uniquement :

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Lancez ensuite l'installeur en mode non interactif :

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Passez `--skip-consent` (ou `-y`) explicitement. En v0.2.0, l'invite de consentement se déclenche encore sur un terminal non interactif même quand toutes les variables `SOCTALK_*` sont définies, et sans TTY l'installation s'interrompt avec `/dev/tty: No such device or address`.

L'installeur met en place k3s et Helm si l'hôte en est dépourvu, installe le chart `soctalk-system` épinglé sur la version de la release, et affiche l'URL et les identifiants de connexion une fois terminé. Trois pods dans le namespace `soctalk-system` (`api`, `app-ui`, `postgres`) signifient que le plan de contrôle est opérationnel :

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## Un réglage avant l'intégration : les politiques réseau

Voici l'écueil de la v0.2.0, annoncé d'emblée pour que vous ne le rencontriez pas en plein milieu de l'intégration : un tenant `provided` génère une politique d'egress FQDN Cilium pour les hôtes SIEM externes, mais le k3s installé par `soctalk install` s'appuie sur flannel, qui n'a pas les CRD Cilium. Le provisionnement d'un tenant provided sur une installation v0.2.0 standard échoue donc à l'étape Helm avec

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

et le tenant termine en `degraded`. C'est corrigé après la v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)) : le chart conditionne désormais cet objet à l'existence effective de la CRD et ajoute un egress `NetworkPolicy` classique pour les hôtes SIEM en IP littérale, si bien qu'une installation flannel standard se provisionne proprement. En v0.2.0, le contournement sur une installation mono-hôte consiste à désactiver les politiques réseau des tenants avant l'intégration :

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Soyez lucide sur le compromis : cela désactive les NetworkPolicies d'isolation de namespace pour les tenants provisionnés ensuite, ce qui est acceptable sur un hôte de lab ou de pilote dédié à une seule classe de tenant, mais pas ce que vous voulez sur un cluster de production multi-tenant partagé. Si vous utilisez Cilium comme CNI, rien de tout cela ne s'applique et vous devez laisser les politiques activées.

Si vous avez déjà intégré le tenant et qu'il reste en `degraded` avec l'erreur ci-dessus, positionnez le réglage puis cliquez sur **Retry Provisioning** sur la page du tenant ; les reprises sont idempotentes et repartent proprement.

Un dernier point propre à un lab mono-hôte, où le Wazuh « existant » tourne souvent dans Docker sur l'hôte même où vous avez installé SocTalk, joint via l'IP propre de l'hôte. k3s applique les NetworkPolicy via son contrôleur intégré, et un pod qui atteint l'IP propre du nœud pour un port publié par Docker constitue un hairpin que la couche de politique ne route pas proprement, même lorsqu'une règle d'egress l'autorise. Le symptôme est l'adaptateur qui consigne `ingest_failed: All connection attempts failed` alors que le même Wazuh répond sans problème depuis l'hôte. Désactiver les politiques réseau des tenants comme ci-dessus règle le problème. Un Wazuh sur un hôte séparé emprunte un chemin sortant ordinaire et ne rencontre pas ce cas.

## Intégrer le tenant

Dans l'UI MSSP, Tenants, puis **+ New Tenant**, choisissez le profil `provided` et l'assistant demande les éléments de connexion externes. La même opération via l'API tient en un seul POST sur l'endpoint d'intégration. Attention au chemin : `POST /api/mssp/tenants/onboard` est l'endpoint de l'assistant, celui qui comprend les profils et les éléments SIEM externes. Le simple `POST /api/mssp/tenants` est une création d'identité seule qui ignore silencieusement ces champs, ce qui vous laisse un tenant `poc` qui ne se provisionne jamais.

```bash
# authenticate once; the cookie jar carries the MSSP session
curl -sk -c cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/auth/login" \
  -d '{"email": "<admin-email>", "password": "<admin-password>"}'

curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/mssp/tenants/onboard" -d '{
  "slug": "orion-soc",
  "display_name": "Orion Labs",
  "profile": "provided",
  "llm_provider": "anthropic",
  "llm_base_url": "https://api.anthropic.com",
  "llm_model": "claude-sonnet-4-6",
  "llm_api_key": "sk-ant-...",
  "external_siem": {
    "indexer_url": "https://198.51.100.20:9200",
    "indexer_username": "admin",
    "indexer_password": "...",
    "api_url": "https://198.51.100.20:55000",
    "api_username": "wazuh-wui",
    "api_password": "...",
    "verify_ssl": false
  }
}'
```

Un 202 avec `"profile": "provided"` dans le corps confirme le bon chemin. Choisissez le slug avec soin : les slugs restent réservés par les tenants archivés, un tenant de test décommissionné ne libère donc pas son nom pour réutilisation.

Le provisionnement d'un tenant provided est rapide puisqu'il n'y a pas de chart Wazuh à installer ; le contrôleur saute cette phase et consigne à la place un événement de cycle de vie `wazuh_skipped_provided`. Lors du parcours vérifié, le tenant est passé de `pending` à `active` en moins de vingt secondes.

## Vérifier la connexion

Le namespace du tenant doit contenir exactement deux workloads, l'adaptateur et le runs-worker, et aucun pod Wazuh :

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

Vos éléments de connexion atterrissent dans un Secret local au namespace nommé `tenant-external-siem-creds`, contenant `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` et `WAZUH_API_PASSWORD`, plus `WAZUH_API_TOKEN` si vous en avez fourni un. L'adaptateur lit l'URL de l'indexeur depuis son environnement et les identifiants depuis ce Secret. Son journal vous dit en quelques secondes si la connexion fonctionne, car il interroge l'index des alertes en continu :

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

Un 401 ici signifie que les identifiants de l'indexeur sont incorrects ; une erreur TLS signifie que `verify_ssl` ne correspond pas à votre situation de certificats ; un timeout signifie que l'hôte SocTalk n'atteint pas le port de l'indexeur.

Les identifiants tournent sans réintégration. `PATCH /api/mssp/tenants/{id}/external-siem` accepte n'importe quel sous-ensemble des champs d'intégration, réécrit le Secret et redémarre le pod de l'adaptateur pour qu'il prenne en compte les nouveaux éléments :

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## La première alerte triagée

À partir de là, le pipeline se comporte exactement comme pour un Wazuh géré par SocTalk : l'adaptateur transmet les nouvelles alertes égales ou supérieures à la sévérité minimale (niveau de règle 10 par défaut, configurable avec `SOCTALK_ADAPTER_MIN_SEVERITY`), le plan de contrôle promeut ce qui compte en enquêtes, et le runs-worker du tenant exécute le triage AI avec la clé LLM propre au tenant.

La façon la plus honnête de tester est de faire produire à votre Wazuh existant une véritable alerte de haute sévérité, par exemple une rafale de connexions SSH échouées contre un agent surveillé suivie d'un succès. Si vous préférez ne pas toucher aux endpoints de production, indexer un document d'alerte synthétique directement dans `wazuh-alerts-4.x-<date>` avec un `rule.level` de 12 exerce exactement le même chemin, puisque l'adaptateur lit depuis l'index et non depuis le manager.

Lors du parcours vérifié, une alerte de force brute SSH suivie d'un succès est passée du document dans l'indexeur au triage terminé en environ une minute : transmise par l'adaptateur, promue, investiguée par le superviseur au fil de plusieurs appels LLM, et close en `escalate` avec une confiance de 0,95, pour atterrir dans la [file de revue MSSP](/fr-fr/mssp-ui#reviews-human-in-the-loop) en attente d'un humain. La dépense totale du run était d'environ trente cents sur la clé Anthropic du tenant, suivie via le budget de tokens par run décrit dans [Pipeline AI](/fr-fr/ai-pipeline).

## Limitations actuelles

Les deux réserves ci-dessous ont été vérifiées en v0.2.0 et sont corrigées dans la release qui la suit, donc sur une build plus récente vous pouvez ignorer les contournements. Consultez les notes de version correspondant à votre version.

- **L'enrichissement atteignant le Wazuh externe (v0.2.0 uniquement).** En v0.2.0, l'outillage MCP Wazuh du runs-worker n'était pas raccordé à l'API du manager d'un tenant provided, si bien que le triage s'exécutait sur la seule charge utile de l'alerte, sans pivots en direct vers l'état des agents ni l'historique des journaux. Corrigé après la v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)) : le worker connecte désormais le serveur MCP `mcp-server-wazuh` embarqué au Wazuh propre du tenant, si bien que le graphe de triage interroge les agents, les processus, les ports, les vulnérabilités et les journaux du manager pendant une enquête, exactement comme le fait un tenant géré par SocTalk.
- **Le provisionnement sur une installation flannel standard (v0.2.0 uniquement).** Le problème de politique d'egress Cilium décrit plus haut, avec son contournement par les politiques réseau. Corrigé après la v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
