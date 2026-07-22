# Human review (HIL)

How an MSSP analyst processes AI-proposed actions waiting on a human gate.

Two backends exist in the codebase: the **dashboard queue** (always on) and **Slack two-way** (opt-in). The dashboard backend is the only one wired into the V1 chart's runtime in this release; the Slack two-way backend exists in code but is not yet activated by the V1 install path.

For the model side, when the AI hands off to human review, see [AI pipeline → Human review gate](/ai-pipeline#human-review-gate).

## Decision states

Every review has the same three-decision contract regardless of backend:

| Decision | Effect in this release |
|---|---|
| `approve` | The review's pending row is marked completed and the `feedback` text is appended to the audit trail. The case is **not** automatically resumed or closed by approve, that's analyst-side follow-up today. |
| `reject` | The case is closed as a false positive (`auto_closed_fp`). Terminal, the graph is not re-invoked with the human's `feedback`. |
| `more_info` | The review row is updated to `info_requested` with the questions list. The graph is **not** automatically re-invoked; the analyst manually picks the case back up. |

Decisions write append-only audit rows tagged with the human's identity, timestamp, and free-text rationale. They are never editable after submit.

## Dashboard backend

The [Review queue](/mssp-ui#reviews-human-in-the-loop) at `/review` shows every pending review across every tenant. Cards display:

- Investigation title + tenant
- AI verdict chip (`AI: Escalate / Close / Needs More Info`)
- Severity
- Alert count + deadline (if a SLA is configured)

Clicking **Review** opens the investigation detail, scrolled to the proposal panel. The panel shows:

- The AI's rationale (full markdown)
- The observable evidence (IPs, hashes, users) with reputation/enrichment from Cortex / MISP
- Three buttons: **Approve**, **Reject**, **Needs more info**
- A rationale text area (required for Reject / Needs more info)

Submitting updates the pending review row in the database (`approve` / `reject` / `more_info` plus the operator's `feedback` or `questions`). **There is no proposal outbox in V1**: earlier drafts described an outbox-keyed-by-idempotency-key consumed by downstream executors (TheHive case creation, Slack notification), but that pipeline is not implemented in this release. Reviewer decisions stop at the review row + audit log; any downstream effect (e.g., TheHive case creation) only happens if the AI worker created it inline during the graph run.

## Slack two-way backend

Slack's Socket Mode is used so SocTalk doesn't need a public webhook endpoint, the SocTalk install initiates an outbound WebSocket to Slack.

### Prerequisites

- A Slack app in your workspace with Socket Mode enabled
- An app-level token with `connections:write`
- A bot token with `chat:write`, `chat:write.public`, `channels:read`
- A channel where the bot is invited

### Configure SocTalk

In the MSSP UI → Settings → Slack:

- **Enable Slack** → on
- **Bot token** → `xoxb-…`
- **App token** → `xapp-…`
- **Channel** → `#soc-reviews` (or whichever)
- **Notify on escalation** → on (sends every escalate-verdict)
- **Notify on verdict** → optional (also sends close-verdicts; high volume)

All Slack configuration (tokens, channel, notify toggles) is environment-only in V1, the legacy `PUT /api/settings` route is not mounted by the V1 chart. See [Slack, Configure](/integrate/slack#configure) for the env-var injection pattern.

### Operator experience

When the AI requests a human review, SocTalk posts a card to the configured channel:

```text
[Critical] T1110 brute-force technique simulated on linux-ep-1 (Demo Tenant)
AI verdict: Escalate (confidence: medium)
Observables: 198.51.100.7 (Cortex: malicious, 8/12), sshd, alice@linux-ep-1
[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Buttons post back through Socket Mode; the SocTalk install records the decision keyed by the proposal's idempotency key. The same proposal in the dashboard queue updates in real time, approving in Slack closes the dashboard card.

If the analyst clicks **Reject** or **Needs more info**, a Slack dialog opens for the rationale (required).

The **View in UI →** link deep-links to the investigation detail with the proposal panel pre-scrolled.

### Multi-tenant routing

In this release, all reviews go to the one install-wide channel configured at Settings → Slack. Per-tenant Slack channel routing is **not** implemented; a `slack_channel_override` field on the onboard payload was mentioned in earlier docs but the runtime ignores it. Per-tenant routing is on the roadmap.

### Outbound (one-way) notifications

The same Slack credentials would drive one-way webhook notifications (case closures, verdict decisions) in a future release. The webhook notifier code exists in `src/soctalk/notifications/slack_webhook.py` but is only wired in the legacy entry point; the V1 chart's `app_v1` does not invoke it. No `notify_on_capacity` toggle exists in any release.

## Outcome accounting

Review decisions write an audit row. The `soctalk_tenant_pending_reviews` gauge is **defined** in the observability code but is **not actively updated** in V1, it stays at 0. Tracking real review queue depth is on the roadmap. A planned `human_review_decisions_total` counter (per-analyst) is also not yet instrumented.

## Bypass: AI-only mode

A no-human-gate "auto-approve every escalate" mode is **not implemented** in this release. The verdict node always routes `escalate` through `human_review`. Removing the human gate is on the roadmap as an explicit toggle gated to `platform_admin` only, with the rationale being audited, not as a quiet default.

## Source pointers

| Concept | File |
|---|---|
| HIL backend interface | [`src/soctalk/hil/backends/__init__.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Slack two-way backend | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Dashboard backend | [`src/soctalk/hil/backends/dashboard.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Slack one-way webhook | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Proposal status enum | [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) |
