# Revue humaine (HIL)

Comment un analyste MSSP traite les actions proposées par l'AI en attente d'une validation humaine.

Deux backends existent dans le code : la **file du tableau de bord** (toujours active) et **Slack bidirectionnel** (opt-in). Le backend du tableau de bord est le seul câblé au runtime du chart V1 dans cette version ; le backend Slack bidirectionnel existe dans le code mais n'est pas encore activé par le chemin d'installation V1.

Pour le côté modèle — lorsque l'AI passe la main à la revue humaine — voir [Pipeline AI → Passerelle de revue humaine](/fr-fr/ai-pipeline#human-review-gate).

## États de décision

Chaque examen respecte le même contrat à trois décisions, quel que soit le backend :

| Décision | Effet dans cette version |
|---|---|
| `approve` | La ligne en attente de l'examen est marquée comme terminée et le texte `feedback` est ajouté à la piste d'audit. Le cas n'est **pas** automatiquement repris ni clos par l'approbation — c'est un suivi côté analyste aujourd'hui. |
| `reject` | Le cas est clos comme faux positif (`auto_closed_fp`). Terminal — le graphe n'est pas ré-invoqué avec le `feedback` de l'humain. |
| `more_info` | La ligne d'examen passe à `info_requested` avec la liste des questions. Le graphe n'est **pas** automatiquement ré-invoqué ; l'analyste reprend le cas manuellement. |

Les décisions écrivent des lignes d'audit en ajout seul, marquées de l'identité de l'humain, de l'horodatage et d'une justification en texte libre. Elles ne sont jamais modifiables après soumission.

## Backend du tableau de bord

La [File d'examen](/fr-fr/mssp-ui#reviews-human-in-the-loop) à `/review` affiche tous les examens en attente sur l'ensemble des tenants. Les cartes affichent :

- Titre de l'enquête + tenant
- Puce de verdict AI (`AI: Escalate / Close / Needs More Info`)
- Sévérité
- Nombre d'alertes + échéance (si un SLA est configuré)

Un clic sur **Review** ouvre le détail de l'enquête, positionné sur le panneau de proposition. Le panneau affiche :

- La justification de l'AI (markdown complet)
- Les preuves observables (IP, hachages, utilisateurs) avec réputation/enrichissement depuis Cortex / MISP
- Trois boutons : **Approve**, **Reject**, **Needs more info**
- Une zone de texte de justification (obligatoire pour Reject / Needs more info)

La soumission met à jour la ligne d'examen en attente dans la base de données (`approve` / `reject` / `more_info` plus le `feedback` ou les `questions` de l'opérateur). **Il n'y a pas d'outbox de propositions en V1** — des ébauches antérieures décrivaient un outbox indexé par clé d'idempotence, consommé par des exécuteurs en aval (création de cas TheHive, notification Slack), mais ce pipeline n'est pas implémenté dans cette version. Les décisions du relecteur s'arrêtent à la ligne d'examen + au journal d'audit ; tout effet en aval (par ex. la création de cas TheHive) ne se produit que si le worker AI l'a créé en ligne pendant l'exécution du graphe.

## Backend Slack bidirectionnel

Le Socket Mode de Slack est utilisé pour que SocTalk n'ait pas besoin d'un point de terminaison webhook public — l'installation SocTalk initie un WebSocket sortant vers Slack.

### Prérequis

- Une application Slack dans votre espace de travail avec le Socket Mode activé
- Un token de niveau application avec `connections:write`
- Un token de bot avec `chat:write`, `chat:write.public`, `channels:read`
- Un canal où le bot est invité

### Configurer SocTalk

Dans l'UI MSSP → Settings → Slack :

- **Enable Slack** → activé
- **Bot token** → `xoxb-…`
- **App token** → `xapp-…`
- **Channel** → `#soc-reviews` (ou celui de votre choix)
- **Notify on escalation** → activé (envoie chaque verdict d'escalade)
- **Notify on verdict** → facultatif (envoie aussi les verdicts de clôture ; volume élevé)

Toute la configuration Slack (tokens, canal, bascules de notification) est uniquement basée sur l'environnement en V1 — l'ancienne route `PUT /api/settings` n'est pas montée par le chart V1. Voir [Slack — Configurer](/fr-fr/integrate/slack#configure) pour le motif d'injection de variables d'environnement.

### Expérience de l'opérateur

Lorsque l'AI demande une revue humaine, SocTalk publie une carte dans le canal configuré :

```text
[Critical] T1110 brute-force technique simulated on linux-ep-1 (Demo Tenant)
AI verdict: Escalate (confidence: medium)
Observables: 198.51.100.7 (Cortex: malicious, 8/12), sshd, alice@linux-ep-1
[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Les boutons renvoient via le Socket Mode ; l'installation SocTalk enregistre la décision indexée par la clé d'idempotence de la proposition. La même proposition dans la file du tableau de bord se met à jour en temps réel — approuver dans Slack ferme la carte du tableau de bord.

Si l'analyste clique sur **Reject** ou **Needs more info**, une boîte de dialogue Slack s'ouvre pour la justification (obligatoire).

Le lien **View in UI →** pointe directement vers le détail de l'enquête, avec le panneau de proposition déjà positionné.

### Routage multi-tenant

Dans cette version, tous les examens sont dirigés vers l'unique canal à l'échelle de l'installation configuré dans Settings → Slack. Le routage par canal Slack propre à chaque tenant n'est **pas** implémenté ; un champ `slack_channel_override` sur le payload d'onboarding était mentionné dans des docs antérieures mais le runtime l'ignore. Le routage par tenant est sur la feuille de route.

### Notifications sortantes (unidirectionnelles)

Les mêmes identifiants Slack alimenteraient des notifications webhook unidirectionnelles (clôtures de cas, décisions de verdict) dans une version future. Le code du notificateur webhook existe dans `src/soctalk/notifications/slack_webhook.py` mais n'est câblé que dans l'ancien point d'entrée ; l'`app_v1` du chart V1 ne l'invoque pas. Aucune bascule `notify_on_capacity` n'existe dans aucune version.

## Comptabilité des résultats

Les décisions d'examen écrivent une ligne d'audit. La jauge `soctalk_tenant_pending_reviews` est **définie** dans le code d'observabilité mais **n'est pas activement mise à jour** en V1 — elle reste à 0. Le suivi de la profondeur réelle de la file d'examen est sur la feuille de route. Un compteur `human_review_decisions_total` prévu (par analyste) n'est pas non plus encore instrumenté.

## Contournement : mode AI seul

Un mode « auto-approuver chaque escalade » sans validation humaine n'est **pas** implémenté dans cette version. Le nœud de verdict achemine toujours `escalate` via `human_review`. La suppression de la validation humaine est sur la feuille de route sous forme de bascule explicite réservée au seul `platform_admin`, avec justification auditée — et non comme un comportement par défaut silencieux.

## Pointeurs vers le code source

| Concept | Fichier |
|---|---|
| Interface de backend HIL | [`src/soctalk/hil/backends/__init__.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Backend Slack bidirectionnel | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Backend du tableau de bord | [`src/soctalk/hil/backends/dashboard.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Webhook Slack unidirectionnel | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Enum de statut de proposition | [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) |
