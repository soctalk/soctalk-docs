# Slack

SocTalk communique avec Slack de deux manières. Les deux utilisent les mêmes identifiants d'application Slack mais répondent à des besoins opérationnels différents :

| Backend | Direction | Câblage du chart V1 |
|---|---|---|
| **Notifications par webhook** | unidirectionnel (sortant) | Code câblé uniquement dans le point d'entrée hérité (`src/soctalk/main.py`). L'`app_v1` du chart V1 ne le monte **pas**. Considérez les notifications ci-dessous comme le câblage prévu ; aujourd'hui, la publication nécessite d'exécuter l'orchestrateur hérité aux côtés de V1 |
| **HIL en Socket Mode** | bidirectionnel | Code présent (`src/soctalk/hil/backends/slack.py`) ; non câblé dans V1 non plus |

La seule surface HIL fonctionnelle du chemin d'installation V1 est la file d'examen du tableau de bord. Les pages Slack ci-dessous décrivent le câblage prévu pour le moment où les deux backends seront livrés dans V1. Pour le flux d'examen côté analyste, consultez [Revue humaine (HIL)](/fr-fr/human-review).

## Créer l'application Slack

1. https://api.slack.com/apps → **Create New App** → From scratch.
2. Nom : `SocTalk` (ou le nom de votre installation). Espace de travail : celui utilisé par votre équipe SOC.
3. **OAuth & Permissions** → ajoutez les Bot Token Scopes :
   - `chat:write`
   - `chat:write.public` (permet au bot de publier dans des canaux dont il n'est pas membre)
   - `channels:read`
   - Pour l'examen interactif : `commands` (uniquement si vous souhaitez aussi des commandes slash) et `app_mentions:read`.
4. **Install App** → Install to Workspace. Copiez le **Bot User OAuth Token** (`xoxb-…`).
5. (HIL uniquement) **Socket Mode** → activez. Générez un **App-Level Token** avec le scope `connections:write` (`xapp-…`).
6. (HIL uniquement) **Interactivity & Shortcuts** → activez. Avec le Socket Mode activé, vous n'avez pas besoin de saisir une Request URL.
7. (HIL uniquement) **Event Subscriptions** → activez ; abonnez-vous à `interactive_message_actions` et `block_actions`.
8. Invitez le bot dans votre canal d'examen : `/invite @SocTalk`.

## Notifications par webhook

Pour les notifications unidirectionnelles, vous n'avez besoin que d'une URL d'Incoming Webhook, et non de toute la procédure d'application ci-dessus. Au choix :

- Installez une application **Incoming Webhooks** distincte dans l'espace de travail et récupérez l'URL.
- Ou utilisez la fonctionnalité Incoming Webhooks de l'application que vous avez créée ci-dessus.

### Configurer

MSSP UI → Settings → Slack :

| Champ | Notes |
|---|---|
| Webhook URL | `https://hooks.slack.com/services/T…/B…/…` |
| Channel | Remplacement de canal facultatif ; sinon le webhook publie dans son canal par défaut |
| Notify on escalation | Activé par défaut. Publie lorsqu'un verdict se clôture sur `escalate` |
| Notify on verdict | Désactivé par défaut. Publie également chaque disposition `close` — volume élevé |

**Il n'existe aucune API pour modifier les paramètres d'intégration Slack dans V1** — le chart V1 ne monte pas la route héritée `PUT /api/settings`. La configuration Slack se fait uniquement par variables d'environnement : fournissez `SLACK_WEBHOOK_URL`, `SLACK_CHANNEL`, `SLACK_NOTIFY_ON_ESCALATION` et `SLACK_NOTIFY_ON_VERDICT` comme variables d'environnement sur le Deployment `soctalk-system-api`.

Les notifications Slack couvrent uniquement les événements d'escalade et de verdict (aucun bouton `notify_on_capacity` n'existe).

Les jetons (URL de webhook, jeton de bot, jeton d'application) ne sont **pas** modifiables via ce point de terminaison — fournissez-les comme variables d'environnement sur le Deployment de l'orchestrateur (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) ou via des variables d'environnement montées depuis un Secret. Effectuez la rotation en corrigeant le Secret et en redémarrant l'orchestrateur.

### Format des messages

Exemple d'escalade :

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1
AI verdict: Escalate · confidence: medium · 1 malicious observable
View → https://mssp.your-mssp.example/investigations/abc123
```

Block Kit minimal ; pas de boutons (c'est le rôle du backend HIL).

## HIL en Socket Mode

> **Statut :** le backend HIL bidirectionnel Slack existe dans le code (`src/soctalk/hil/backends/slack.py`) mais n'est **pas câblé dans le runtime du chart V1 dans cette version**. La file d'examen du tableau de bord à `/review` est la seule surface HIL fonctionnelle. Considérez la configuration HIL Slack ci-dessous comme la conception prévue.

Pour le flux d'examen des analystes. La même application Slack, plus l'App-Level Token. Le backend HIL de SocTalk ouvre un WebSocket sortant vers Slack — aucun point de terminaison public requis ; fonctionne derrière un NAT.

### Configurer

Le bouton d'activation dans l'interface (Channel, Enable HIL, notify_on_*) se trouve dans MSSP UI → Settings → Slack. Les jetons eux-mêmes sont uniquement définis par variables d'environnement dans cette version :

```yaml
env:
  - name: SLACK_BOT_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: bot_token } }
  - name: SLACK_APP_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: app_token } }
```

Le routage par canal Slack propre à chaque tenant n'est **pas implémenté dans cette version** — le `slack_channel` configuré à l'échelle de l'installation reçoit chaque examen et notification, quel que soit le tenant auquel le cas appartient. Le routage par tenant figure dans la feuille de route.

### Ce qui est publié

Lorsque l'AI demande une revue humaine, SocTalk publie une carte dans le canal configuré :

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1

AI verdict: Escalate (confidence: medium)
Observables:
  · 198.51.100.7 (Cortex: malicious, 8/12 analyzers)
  · sshd (process)
  · alice@linux-ep-1 (user)

[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Les boutons déclenchent des événements `block_actions` ; le backend HIL de SocTalk les traite et réécrit la décision dans l'état du cas. Reject et Needs-more-info ouvrent une fenêtre modale pour la justification (obligatoire).

Une version future câblera le tableau de bord et Slack pour qu'ils partagent l'état d'examen. Dans V1, les deux backends ne partagent pas encore l'état — si le HIL Slack était activé, l'action Slack ne fermerait pas la carte du tableau de bord et inversement.

## Faire la rotation des jetons

1. Dans OAuth & Permissions de l'application Slack, **Reinstall app** pour faire la rotation du jeton de bot. Copiez le nouveau `xoxb-…`.
2. (HIL) **Basic Information → App-Level Tokens** → révoquez + régénérez. Copiez le nouveau `xapp-…`.
3. Corrigez le Secret :
   ```bash
   kubectl -n soctalk-system patch secret soctalk-slack-creds \
     -p '{"data":{"bot_token":"'$(echo -n xoxb-NEW | base64)'","app_token":"'$(echo -n xapp-NEW | base64)'"}}'
   ```
4. Redémarrez l'orchestrateur : `kubectl -n soctalk-system rollout restart deploy/soctalk-system-api`.
5. Le backend HIL se reconnecte avec les nouveaux jetons dans les ~10 s suivant la disponibilité du pod.

## Dépanner

| Symptôme | Vérification |
|---|---|
| Le bot ne publie pas | `kubectl -n soctalk-system logs deploy/soctalk-system-api | grep slack`. Cause fréquente : bot non invité dans le canal cible |
| Les boutons HIL renvoient « this action is no longer valid » | La proposition a été décidée par un autre chemin (tableau de bord ou expiration). Rafraîchissez la carte |
| Le bot publie mais ne réagit jamais aux clics sur les boutons | Socket Mode non activé, ou App-Level Token sans `connections:write`. Recréez le jeton d'application |
| Les cartes arrivent tronquées | Block Kit limite un message unique à 50 blocs. SocTalk répartit les longues listes d'observables sur plusieurs cartes ; un pied de page « X observables shown of Y » doit apparaître |

## Confidentialité

Le message Slack inclut des observables (IP, noms d'utilisateur, hachages de fichiers). Si votre espace de travail a des contraintes de conformité, conditionnez l'intégration aux paramètres propres à chaque tenant ou utilisez uniquement les notifications par webhook (aucun corps d'observable dans celles-ci).

## Références de code

| Concept | Fichier |
|---|---|
| Notifieur webhook Slack | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Backend HIL Slack | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Modèles Block Kit | [`src/soctalk/notifications/slack_templates/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/notifications) |
