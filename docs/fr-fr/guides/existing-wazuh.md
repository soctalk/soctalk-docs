---
description: "Connectez le triage AI de SocTalk à un Wazuh que vous exploitez déjà : installez depuis le paquet système, intégrez un tenant au profil provided, et regardez la première alerte devenir un cas trié et escaladé."
---

# Connecter SocTalk à un Wazuh existant

La plupart des exploitations Wazuh ne partent pas de zéro. Il y a déjà un manager qui surveille des agents, un indexeur qui conserve des mois d'alertes, et un dashboard depuis lequel l'équipe enquête déjà. Le profil de tenant `provided` de SocTalk est conçu exactement pour cette situation : SocTalk n'installe que ses propres composants, se connecte à votre Wazuh via le réseau, et commence à trier les alertes que votre déploiement produit déjà. Rien ne change dans votre Wazuh, aucun agent ne se ré-enrôle, et aucune donnée ne migre.

Ce guide parcourt tout le chemin sur un hôte Linux unique, du paquet système à la première escalade triée par l'AI, et a été vérifié de bout en bout avec SocTalk v0.2.0 et Wazuh 4.12.0. Là où cette version a des aspérités, le guide le dit et donne le contournement.

Si vous préférez que SocTalk déploie et gère Wazuh à votre place, c'est le profil `poc` ou `persistent` ; voir [Intégrer un tenant client](/fr-fr/guides/wazuh-tenant-onboarding).

## Ce qu'il vous faut avant de commencer

Votre Wazuh existant doit être joignable depuis l'hôte SocTalk sur deux ports : l'API OpenSearch de l'indexeur (`:9200`) et l'API REST du manager (`:55000`). SocTalk s'authentifie séparément auprès de chacun, ayez donc les deux paires d'identifiants prêtes :

- un utilisateur indexeur autorisé à interroger `wazuh-alerts-*` (l'utilisateur intégré `admin` fonctionne, même si un utilisateur en lecture seule est une meilleure pratique),
- un utilisateur de l'API du manager comme l'utilisateur intégré `wazuh-wui`.

Les certificats auto-signés côté Wazuh sont la norme et sont pris en charge ; vous passerez `verify_ssl: false` au moment de l'intégration. Il vous faut aussi une clé d'API LLM par tenant. Le profil `provided` l'exige à l'intégration, car un tenant qui apporte son propre SIEM n'a pas de repli partagé au niveau de l'installation : la requête d'intégration est rejetée avec un 422 si la clé manque.

L'hôte SocTalk lui-même a besoin de l'empreinte habituelle : un Linux basé sur systemd (Ubuntu 24.04 et Rocky 9 sont la paire vérifiée), 4 vCPU et 8 Go de RAM comme plancher pour le plan de contrôle plus un tenant provided, et les ports 80/443/6443 libres. Comme le tenant n'exploite aucun Wazuh à lui, un tenant provided est bien plus léger qu'un tenant `persistent`.

## Installer SocTalk depuis le paquet système

Téléchargez le paquet correspondant à votre distribution depuis la [page des releases](https://github.com/soctalk/soctalk/releases) et installez-le ; la matrice complète des variantes est sur [Installer depuis un paquet système](/fr-fr/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

Le paquet fournit un modèle d'environnement à `/etc/soctalk/soctalk.env.example`. Copiez-le, renseignez votre identité MSSP, vos identifiants d'administration, le nom d'hôte et la clé LLM, et gardez-le réservé à root :

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Lancez ensuite l'installateur sans interaction :

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Passez `--skip-consent` (ou `-y`) explicitement. En v0.2.0 l'invite de consentement se déclenche encore sur un terminal non interactif même quand toutes les variables `SOCTALK_*` sont définies, et sans TTY l'installation s'interrompt avec `/dev/tty: No such device or address`.

L'installateur met en place k3s et Helm si l'hôte ne les a pas, installe le chart `soctalk-system` épinglé à la version de la release, et affiche l'URL et l'identifiant de connexion une fois terminé. Trois pods dans le namespace `soctalk-system` (`api`, `app-ui`, `postgres`) signifient que le plan de contrôle est en place :

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

## Un réglage avant l'intégration : les network policies

Voici l'aspérité de la v0.2.0, annoncée d'emblée pour que vous ne la rencontriez pas en pleine intégration : un tenant `provided` génère une politique d'égress FQDN Cilium pour les hôtes SIEM externes, mais le k3s que `soctalk install` met en place utilise flannel, qui n'a aucune CRD Cilium. Provisionner un tenant provided sur une installation v0.2.0 standard échoue donc à l'étape Helm avec

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

et le tenant se retrouve en `degraded`. Ceci est corrigé après la v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)) : le chart conditionne désormais cet objet à l'existence réelle de la CRD et ajoute une politique `NetworkPolicy` d'égress classique pour les hôtes SIEM désignés par une IP littérale, si bien qu'une installation flannel standard provisionne proprement. Sur la v0.2.0, le contournement pour une installation mono-hôte est de désactiver les network policies des tenants avant l'intégration :

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo /usr/local/bin/k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Soyez clair sur le compromis : cela désactive les NetworkPolicies d'isolation par namespace pour les tenants provisionnés ensuite, ce qui est acceptable sur un hôte de lab ou de pilote dédié à une seule classe de tenant, mais pas ce que vous voulez sur un cluster de production mutualisé. Si vous exploitez Cilium comme CNI, rien de tout ceci ne s'applique et vous devez laisser les politiques activées.

Si vous avez déjà intégré le tenant et qu'il se trouve en `degraded` avec l'erreur ci-dessus, appliquez le réglage et cliquez sur **Retry Provisioning** sur la page du tenant ; les reprises sont idempotentes et repartent proprement.

Un point supplémentaire propre à un lab mono-machine, où le Wazuh « existant » tourne souvent dans Docker sur l'hôte même où vous avez installé SocTalk, joint par l'IP propre de l'hôte. k3s applique les NetworkPolicy via son contrôleur embarqué, et un pod qui atteint l'IP propre du nœud pour un port publié par Docker est un aller-retour en épingle (hairpin) que la couche de politique ne route pas proprement même quand une règle d'égress l'autorise. Le symptôme est l'adaptateur qui journalise `ingest_failed: All connection attempts failed` alors que le même Wazuh répond très bien depuis l'hôte. Désactiver les network policies des tenants comme ci-dessus règle le problème. Un Wazuh sur un hôte distinct est un chemin sortant ordinaire et ne rencontre pas ce cas.

## Intégrer le tenant

Dans l'UI MSSP, Tenants, puis **+ New Tenant**, choisissez le profil `provided` et l'assistant insère une étape External SIEM qu'un tenant PoC ou persistent n'a pas.

![L'étape Profile de l'assistant New Tenant avec Provided sélectionné, décrit comme « apportez votre propre Wazuh » ; le fil d'Ariane inclut désormais une étape External SIEM](/screenshots/existing-wazuh-profile.png)

C'est à cette étape que vous pointez SocTalk vers votre Wazuh. L'indexeur (OpenSearch, port 9200) et l'API du manager (port 55000) s'authentifient avec des identifiants distincts, et un tenant provided fournit sa propre clé LLM parce que la clé partagée de l'installation MSSP ne s'applique pas à ce profil.

![L'étape External SIEM de l'assistant : URL et identifiants de l'indexeur, URL et identifiants de l'API du manager, un jeton d'API pré-généré facultatif, une case « Verify TLS certificates » à décocher pour les certificats auto-signés, et la clé LLM par tenant requise](/screenshots/existing-wazuh-siem-form.png)

La même opération via l'API est un unique POST vers l'endpoint d'intégration. Notez le chemin : `POST /api/mssp/tenants/onboard` est l'endpoint de l'assistant qui comprend les profils et les éléments SIEM externes. Le `POST /api/mssp/tenants` simple est une création d'identité seule ; en v0.2.0 il ignore silencieusement ces champs et vous laisse un tenant `poc` qui ne se provisionne jamais, envoyez donc toujours une intégration provided vers `/onboard`.

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

Provisionner un tenant provided est rapide car il n'y a pas de chart Wazuh à installer ; le contrôleur saute cette phase et enregistre à la place un événement de cycle de vie `wazuh_skipped_provided`. Sur l'exécution vérifiée, le tenant est passé de `pending` à `active` en moins de vingt secondes.

## Vérifier la connexion

Le namespace du tenant doit contenir exactement deux workloads, l'adaptateur et le runs-worker, et aucun pod Wazuh :

```bash
sudo /usr/local/bin/k3s kubectl -n tenant-orion-soc get pods
```

Vos éléments de connexion atterrissent dans un Secret local au namespace nommé `tenant-external-siem-creds` contenant `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` et `WAZUH_API_PASSWORD`, plus `WAZUH_API_TOKEN` si vous en avez fourni un. L'adaptateur lit l'URL de l'indexeur depuis son environnement et les identifiants depuis ce Secret. Son journal vous indique en quelques secondes si la connexion fonctionne, car il interroge en continu l'index des alertes :

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

La page de détail du tenant montre la même chose sans lire les journaux. Le panneau External SIEM reprend les URL de l'indexeur et de l'API que vous avez fournies, et la ligne d'état d'ingestion de l'adaptateur indique `reachable` avec un décompte d'alertes transmises une fois que les premières alertes circulent.

![La page de détail du tenant Orion Labs : profil provided, état active, un panneau External SIEM avec les URL de l'indexeur et de l'API, et un état d'ingestion de l'adaptateur reachable avec trois alertes transmises](/screenshots/existing-wazuh-tenant-detail.png)

Un 401 dans le journal de l'adaptateur signifie que les identifiants de l'indexeur sont erronés ; une erreur TLS signifie que `verify_ssl` ne correspond pas à votre situation de certificat ; un timeout signifie que l'hôte SocTalk ne peut pas atteindre le port de l'indexeur.

Les identifiants tournent sans ré-intégration. `PATCH /api/mssp/tenants/{id}/external-siem` accepte n'importe quel sous-ensemble des champs d'intégration, réécrit le Secret, et relance le pod de l'adaptateur pour qu'il reprenne les éléments frais :

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## La première alerte triée

À partir d'ici, l'ingestion, la promotion, l'exécution des runs et le workflow de revue se comportent comme pour un Wazuh géré par SocTalk (la profondeur d'enrichissement diffère en v0.2.0, voir Limitations actuelles) : l'adaptateur transmet les nouvelles alertes au niveau de sévérité minimum ou au-dessus (niveau de règle 10 par défaut, configurable avec `SOCTALK_ADAPTER_MIN_SEVERITY`), le plan de contrôle promeut ce qui compte en enquêtes, et le runs-worker du tenant exécute le triage AI avec la clé LLM propre du tenant.

La façon honnête de tester est de faire produire à votre Wazuh existant une véritable alerte de haute sévérité, par exemple une rafale de connexions SSH échouées contre un agent surveillé suivie d'un succès. Si vous préférez ne pas toucher aux endpoints de production, indexer un document d'alerte synthétique directement dans `wazuh-alerts-4.x-<date>` avec un `rule.level` de 12 exerce le chemin identique, puisque l'adaptateur lit depuis l'index plutôt que depuis le manager.

Sur l'exécution vérifiée, une alerte de force brute SSH suivie d'un succès est passée du document indexeur au triage terminé en environ une minute : transmise par l'adaptateur, promue, investiguée par le superviseur à travers plusieurs appels LLM, et clôturée en `escalate` avec une confiance de 0.95, atterrissant dans la [file de revue MSSP](/fr-fr/mssp-ui#reviews-human-in-the-loop) pour un humain. La dépense totale de l'exécution a été d'environ trente cents sur la clé Anthropic du tenant, comptabilisée par rapport au budget de tokens par run décrit dans [Pipeline AI](/fr-fr/ai-pipeline). Après quelques alertes de test de ce genre, la file de revue les tient côte à côte.

![La file de revue humaine avec trois cas Critical, chacun marqué AI: Escalate et proposant une action Review](/screenshots/existing-wazuh-review-queue.png)

Chaque ligne porte le verdict de l'AI et ouvre l'enquête complète, de sorte qu'un analyste confirme ou infirme sur la base des preuves plutôt que de démarrer le triage lui-même.

## Limitations actuelles

Les deux réserves ci-dessous ont été vérifiées en v0.2.0 et sont corrigées dans la release qui la suit, donc sur une version plus récente vous pouvez ignorer les contournements. Consultez les notes de version pour votre version.

- **Enrichissement atteignant le Wazuh externe (v0.2.0 uniquement).** En v0.2.0, l'outillage MCP Wazuh du runs-worker n'était pas raccordé à l'API du manager d'un tenant provided, si bien que le triage s'exécutait sur la seule charge utile de l'alerte, sans pivots en direct vers l'état des agents ou l'historique des journaux. Corrigé après la v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)) : le worker connecte désormais le serveur MCP `mcp-server-wazuh` embarqué au Wazuh propre du tenant, de sorte que le graphe de triage interroge agents, processus, ports, vulnérabilités et journaux du manager pendant une enquête, exactement comme le fait un tenant géré par SocTalk.
- **Provisionnement sur une installation flannel standard (v0.2.0 uniquement).** Le problème de politique d'égress Cilium décrit plus haut, avec son contournement par network policy. Corrigé après la v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
- **Ports SIEM non standard (jusqu'à la v0.2.1 incluse).** La NetworkPolicy d'egress du tenant déduit l'*hôte* du SIEM externe des URL que vous fournissez, mais fige les *ports* à 9200 et 55000. Un Wazuh joignable sur un autre port est bloqué au niveau réseau alors même que le tenant passe à `active`, que le Secret de identifiants est écrit et que l'adapter continue d'émettre ses heartbeats : le seul symptôme est `ingest_failed: All connection attempts failed` dans le log de l'adapter. Vérifié sur un même cluster en ne faisant varier que les ports : un indexer publié en NodePort `:31437` ne s'est jamais connecté, tandis que le même Wazuh sur `:9200` s'est connecté et authentifié. En attendant le correctif ([soctalk#147](https://github.com/soctalk/soctalk/issues/147)), exposez l'indexer et la Manager API à SocTalk sur les ports 9200 et 55000. Ensuite, les ports sont lus depuis les URL fournies et n'importe quel port fonctionne.
