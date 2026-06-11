# Slack

SocTalk talks to Slack in two ways. Both use the same Slack app credentials but cover different operational needs:

| Backend | Direction | V1 chart wiring |
|---|---|---|
| **Webhook notifications** | one-way (out) | Code wired only in the legacy entry point (`src/soctalk/main.py`). The V1 chart's `app_v1` does **not** mount it. Treat the notifications below as the planned wiring; today, posting requires running the legacy orchestrator alongside V1 |
| **Socket Mode HIL** | two-way | Code present (`src/soctalk/hil/backends/slack.py`); not wired into V1 either |

The V1 install path's only working HIL surface is the dashboard review queue. The Slack pages below describe the planned wiring for when both backends ship in V1. For the analyst-side review workflow see [Human review (HIL)](/human-review).

## Create the Slack app

1. https://api.slack.com/apps → **Create New App** → From scratch.
2. Name: `SocTalk` (or your install's name). Workspace: the one your SOC team uses.
3. **OAuth & Permissions** → add Bot Token Scopes:
   - `chat:write`
   - `chat:write.public` (lets the bot post in channels it's not a member of)
   - `channels:read`
   - For interactive review: `commands` (only if you also want slash commands) and `app_mentions:read`.
4. **Install App** → Install to Workspace. Copy the **Bot User OAuth Token** (`xoxb-…`).
5. (HIL only) **Socket Mode** → enable. Generate an **App-Level Token** with `connections:write` scope (`xapp-…`).
6. (HIL only) **Interactivity & Shortcuts** → enable. With Socket Mode enabled, you don't need to enter a Request URL.
7. (HIL only) **Event Subscriptions** → enable; subscribe to `interactive_message_actions` and `block_actions`.
8. Invite the bot to your review channel: `/invite @SocTalk`.

## Webhook notifications

For one-way notifications you only need an Incoming Webhook URL, not the full app dance above. Either:

- Install a separate **Incoming Webhooks** app to the workspace and grab the URL.
- Or use the app you created above's Incoming Webhooks feature.

### Configure

MSSP UI → Settings → Slack:

| Field | Notes |
|---|---|
| Webhook URL | `https://hooks.slack.com/services/T…/B…/…` |
| Channel | Optional channel override; otherwise the webhook posts to its default channel |
| Notify on escalation | Default on. Posts when a verdict closes as `escalate` |
| Notify on verdict | Default off. Posts every `close`-disposition as well — high volume |

**There is no API to mutate Slack integration settings in V1** — the V1 chart doesn't mount the legacy `PUT /api/settings` route. Slack config is environment-only: provide `SLACK_WEBHOOK_URL`, `SLACK_CHANNEL`, `SLACK_NOTIFY_ON_ESCALATION`, and `SLACK_NOTIFY_ON_VERDICT` as env vars on the `soctalk-system-api` Deployment.

Slack notifications cover escalation and verdict events only (no `notify_on_capacity` toggle exists).

Tokens (webhook URL, bot token, app token) are **not** writable via this endpoint — provide them as environment variables on the orchestrator Deployment (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) or via Secret-mounted env. Rotate by patching the Secret and rolling the orchestrator.

### Message format

Escalation example:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1
AI verdict: Escalate · confidence: medium · 1 malicious observable
View → https://mssp.your-mssp.example/investigations/abc123
```

Minimal Block Kit; no buttons (those are the HIL backend's job).

## Socket Mode HIL

> **Status:** the Slack two-way HIL backend exists in code (`src/soctalk/hil/backends/slack.py`) but is **not wired into the V1 chart's runtime in this release**. The dashboard review queue at `/review` is the only working HIL surface. Treat the Slack HIL setup below as the planned design.

For the analyst review workflow. The same Slack app, plus the App-Level Token. SocTalk's HIL backend opens an outbound WebSocket to Slack — no public endpoint needed; works behind NAT.

### Configure

UI toggle (Channel, Enable HIL, notify_on_*) is in MSSP UI → Settings → Slack. Tokens themselves are env-only in this release:

```yaml
env:
  - name: SLACK_BOT_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: bot_token } }
  - name: SLACK_APP_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: app_token } }
```

Per-tenant Slack channel routing is **not implemented in this release** — the configured install-wide `slack_channel` receives every review and notification regardless of which tenant the case belongs to. Per-tenant routing is on the roadmap.

### What gets posted

When the AI requests human review, SocTalk posts a card to the configured channel:

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

Buttons fire `block_actions` events; the SocTalk HIL backend processes them and writes the decision back to the case state. Reject and Needs-more-info open a modal for the rationale (required).

A future release wires the dashboard and Slack to share review state. In V1 the two backends do not yet share state — if Slack HIL were enabled, the Slack action would not dismiss the dashboard card and vice versa.

## Rotate tokens

1. In the Slack app's OAuth & Permissions, **Reinstall app** to rotate the bot token. Copy the new `xoxb-…`.
2. (HIL) **Basic Information → App-Level Tokens** → revoke + regenerate. Copy the new `xapp-…`.
3. Patch the Secret:
   ```bash
   kubectl -n soctalk-system patch secret soctalk-slack-creds \
     -p '{"data":{"bot_token":"'$(echo -n xoxb-NEW | base64)'","app_token":"'$(echo -n xapp-NEW | base64)'"}}'
   ```
4. Roll the orchestrator: `kubectl -n soctalk-system rollout restart deploy/soctalk-system-api`.
5. The HIL backend reconnects on the new tokens within ~10 s of pod ready.

## Troubleshoot

| Symptom | Check |
|---|---|
| Bot doesn't post | `kubectl -n soctalk-system logs deploy/soctalk-system-api | grep slack`. Common cause: bot not invited to the target channel |
| HIL buttons return "this action is no longer valid" | The proposal was decided by another path (dashboard or expired). Refresh the card |
| Bot posts but never reacts to button clicks | Socket Mode not enabled, or App-Level Token missing `connections:write`. Re-create the app token |
| Cards arrive truncated | Block Kit limits a single message to 50 blocks. SocTalk batches long observable lists into multiple cards; you should see a "X observables shown of Y" footer |

## Privacy

The Slack message includes observables (IPs, usernames, file hashes). If your workspace has compliance constraints, gate the integration on per-tenant settings or use webhook-only notifications (no observable bodies in those).

## Source pointers

| Concept | File |
|---|---|
| Slack webhook notifier | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Slack HIL backend | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Block Kit templates | [`src/soctalk/notifications/slack_templates/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/notifications) |
