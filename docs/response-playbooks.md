# Response Playbooks

A [triage policy](/triage-policies) decides *what an alert is*. A **response playbook** decides *what happens next*. Triage runs the agentic loop and lands on a **disposition** — escalate, auto-close, needs-more-info. That's the judgment. But a judgment on its own doesn't open a ticket, page the on-call, hand the case to your SOAR, or pull a compromised laptop off the network. Someone still has to *act* on it, and for the parts of that action you want guaranteed — always notify, always annotate, never isolate a production host without a human — you don't want the model improvising. You want a rule.

A response playbook is that rule, written as data. It sits strictly **downstream of triage**: it fires only after the disposition is final, keyed on what triage produced, and it composes vetted **capabilities** — never arbitrary code. Every one of them obeys the same law:

> **Tier-0 actions fire automatically. Anything with blast radius waits for a human.**

Annotating a case or notifying an operator-chosen endpoint is safe to do autonomously — the worst case is noise. Disabling an account or isolating an endpoint is not, so those never fire on their own: the playbook *proposes* the action and a person approves it before it executes. The model never pulls a dangerous trigger; a playbook can't either. The code lives in [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response).

## Where a response playbook acts

Response is a single, deterministic step that runs **after** triage commits, not a loop the model steers.

1. **The disposition commits.** The triage run finishes, the server applies the [safety floor](/triage-policies#the-safety-floor), and the case lands on its **effective** disposition — the final call, after any floor veto flipped a close to an escalate.
2. **The envelope is built.** In the same transaction, SocTalk assembles a typed, versioned **disposition envelope** — the public contract every playbook and every downstream connector reads. It carries the effective disposition, the verdict and its confidence, severity, the rule ids and groups, the ATT&CK techniques and tactics, the entities and IOCs, and which floor vetoes fired.
3. **Playbooks match and dispatch.** Active playbooks are matched against the envelope, and each selected action is enqueued transactionally — it commits or rolls back *with the disposition*, so a case can never close while its response is lost, or vice versa.
4. **The executor acts.** A background executor drains the queue. A tier-0 action runs immediately; a gated one becomes a proposal a human must approve, and only then does it execute. Every outcome — routed, executed, failed — is written to an append-only ledger with the remote reference the action returned.

Matching is boring predicate logic over the envelope; it never re-reasons. The judgment already happened upstream — the playbook only decides what to *do* about it.

## The gate on every action

Each capability carries a **blast-radius tier** that decides how it fires, and this is enforced by the executor, not by playbook data:

| Tier | Fires how | Example |
|---|---|---|
| Tier-0 (autonomous) | Immediately, no human | Annotate the case; notify a configured webhook |
| Gated (`write_external`) | Only after a human approves the proposal | Isolate an endpoint; disable an account |

A gated action never executes at dispatch time. It is **routed** to the approval plane as a proposal; a person reviews it, and approval enqueues the real execution. This is the same "propose, then a deterministic gate disposes" discipline the triage layer uses, applied to response — with a human as the gate for anything that touches the outside world.

Three more rules sit outside the schema, in code, and no playbook can weaken them:

- **`on_close` is annotation-only.** A close is the suppression-shaped direction — the one an attacker would most want to trigger — so on the close path a playbook may only annotate or audit, never take an external action.
- **The dispatch kill switch.** `SOCTALK_RESPONSE_DISPATCH_KILL` on the API process, or the `response_dispatch_kill` policy flag on a tenant, stops every response enqueue with no rollout — the control you reach for when a connector misbehaves mid-incident.
- **Dispatch follows the real transition.** A response fires only if the disposition actually took effect on the case. If an analyst closed or merged the investigation while the run was in flight, nothing dispatches against the state that never happened.

## Capabilities

A playbook references a capability by name and can reference nothing else; an unknown name is rejected when the playbook is validated. Three ship today:

| Capability | Tier | What it does |
|---|---|---|
| `annotate_investigation` | Tier-0 | Writes a system note on the investigation. Local only. The only capability allowed on `on_close`. |
| `notify_webhook` | Tier-0 | POSTs the signed envelope to the tenant's configured webhook (`response_webhook_url`). The generic external-SOAR handoff — the receiver owns everything after. |
| `external_action` | **Gated** | POSTs a **named action** and the signed envelope to an operator-configured endpoint. This is the seam where concrete stack behavior — isolate an endpoint, disable an account — lives *outside* SocTalk, behind a stable contract. Never autonomous. |

The key design choice: a playbook author names an **endpoint id** and an **action**, never a URL. The operator maps that id to a real URL and signing secret in the `response_action_endpoints` tenant policy, so an author can request "isolate on the `edr` endpoint" but can never choose where the request goes. Every outbound request is HMAC-signed and passes an SSRF floor (https only, no private or link-local targets).

## The schema

A response playbook is data. One generic interpreter runs any number of them.

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active | shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  rule_ids: []
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx) — never names
  mitre_tactics: ["Lateral Movement"]   # tactic strings as your source emits them
response:
  on_escalate:
    - capability: external_action
      when: { ">=": [{ "var": "severity" }, 10] }
      params: { endpoint: edr, action: isolate_endpoint }
    - capability: notify_webhook
    - capability: annotate_investigation
      params: { body: "endpoint isolation proposed for lateral-movement alert" }
  on_close:
    - capability: annotate_investigation
      params: { body: "auto-closed as false positive" }
```

| Field | Meaning |
|---|---|
| `applies_to` | Which alerts the playbook governs, matched on rule groups, rule ids, ATT&CK technique ids (`Txxxx`), or ATT&CK tactics — the four are OR'd. Empty matches every alert (the disposition lists already scope when it fires). |
| `response.on_escalate` | Up to eight actions to take when the effective disposition is an escalate. |
| `response.on_close` | Up to four **annotation-tier** actions when the disposition is an auto-close. |
| `priority` | Registry order; lower wins on a multi-match. |

Each action is a `capability` name, an optional `when` condition, and opaque `params` the capability interprets. `params` are pass-through: `external_action` reads `endpoint` and `action` from them and forwards the rest to the connector. The connector doesn't need the target host spelled out in `params` — the full signed envelope travels with every request, and the entities (the host, the account) ride in it.

## Conditions

A `when` condition is the only logic an author writes, and it runs in the same small sandboxed language as triage guardrails — a tree of single-operator nodes over a documented contract, with no attribute access, no function calls, and no way to name anything outside it. Operators: `var`, the comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`), the logical `and` / `or` / `!` / `!!`, and `in`. An action fires only if its condition holds (a condition on absent data is simply falsy — it never errors).

The fields a condition may read, all projected from the envelope:

| Field | What it is |
|---|---|
| `disposition` | The effective disposition (`escalate`, `close_fp`). |
| `worker_disposition` | What the model's run proposed, before the floor. |
| `floor_vetoed` | Whether a safety-floor veto changed the disposition. |
| `verdict_confidence` | The model's confidence, `0.0` to `1.0`. |
| `severity` | The alert's severity. |
| `rule.groups`, `rule.ids` | The rule groups and ids on the alert (membership targets for `in`). |
| `mitre.techniques` | The canonical ATT&CK **technique ids** (`T1078`, `T1021`) — never the human-readable names, which are unstable. Membership target. |
| `mitre.tactics` | The ATT&CK **tactic** strings the alert source emits — Wazuh sends names like `Lateral Movement`, not `TA` refs, so match on those. Membership target. |

Read `{ "in": ["T1021", { "var": "mitre.techniques" }] }` as: fire when the alert carries ATT&CK technique T1021. Referencing an undeclared field or an unknown operator rejects the playbook at author time, before it can ever run.

## Author one in the no-code editor

Admins author response playbooks from the **Response Playbooks** page while a tenant is pinned — no YAML required. This walks through building one real playbook end to end: `isolate-lateral-movement-endpoint`, which proposes isolating an endpoint on a high-severity lateral-movement escalation, notifies the SOC, and annotates the case.

Open **"+ New response playbook"** (or `/response-playbooks/editor`). The editor is two columns — the document **form** on the left, and a live **flow diagram** on the right that re-renders on every edit, showing the disposition fanning out to the actions and gated actions routing through human approval.

![The blank no-code editor](/screenshots/response-playbook-editor-01-blank.png)

**1 — Identity.** Give the playbook a slug id and a **priority** (lower wins on a multi-match).

![Identity](/screenshots/response-playbook-editor-02-identity.png)

**2 — Which alerts does it own?** The four matchers are OR'd. This playbook owns rule groups `sudo, su` and, crucially, ATT&CK technique `T1021` (Remote Services) and the tactic `Lateral Movement` — so it fires on any alert ATT&CK-mapped to lateral movement, regardless of which rule raised it. Techniques are matched by **id** (`Txxxx`), never by name; tactics are matched by the string your source emits (Wazuh sends names).

![Matchers, including ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

**3 — The gated isolate action.** On escalate, add `external_action` — the capability marked **"needs approval."** Name the operator-configured `endpoint` and the `action` (`isolate_endpoint`) in its params; you never enter a URL. Add a **"Only when"** condition so it fires only on a high-severity escalation.

![The gated isolation action with a condition](/screenshots/response-playbook-editor-04-isolate.png)

**4 — Notify and annotate.** Add two tier-0 actions — a `notify_webhook` to hand the case to the SOC's SOAR, and an `annotate_investigation` for the audit trail. Both fire autonomously.

![Tier-0 notify and annotate actions](/screenshots/response-playbook-editor-05-tier0.png)

**5 — Read the flow.** The right column projects the whole document: the disposition envelope fans out to each action, the gated isolate action routes through a **Human approval** node before it can execute, and the tier-0 actions are marked autonomous.

![The flow diagram: gated action routes through approval](/screenshots/response-playbook-editor-06-flow.png)

`Create (shadow)` saves it. The form and the stored document are the same artifact — "Preview JSON" shows exactly what gets persisted. Validation on save is fail-closed: the id must be a slug, every capability must be one of the vetted names, `on_close` may only annotate, and conditions must reference the declared contract. An unknown reference is rejected at author time, never silently ignored.

![The completed playbook in the list, ready to activate](/screenshots/response-playbook-editor-07-list.png)

## Shadow, then activate

An authored playbook has four statuses — **draft**, **shadow**, **active**, **retired**.

In **shadow**, the playbook is matched and its actions selected exactly as an active one would be, and its would-fire actions are written to the audit trail — but nothing is enqueued. This gives you real evidence of what it would do against live traffic before it acts.

**Activating** it (the **Activate** action on the Response Playbooks page) makes it govern — and unlike a triage policy, activation is **live**. The response dispatcher runs on the control plane with database access, so an active playbook governs the very next disposition with no worker rollout to wait for. Deactivating returns it to shadow immediately.

When a gated action does fire on a real escalation, it lands as a **proposal** on the case — the analyst sees exactly what would run and against which host, and approving it is what triggers the isolation. The action executes once, its remote reference is recorded, and a replayed delivery never fires it twice.

## The wiring

A few pieces carry it:

- `SOCTALK_RESPONSE_PLAYBOOK_DIR` on the API process is a directory of YAML playbooks the registry loads at startup — the git-managed path, for operators who prefer playbooks as code.
- Authored playbooks live in the database (`authored_response_playbook_revisions`), append-only, tenant-scoped with row-level security, and the dispatcher merges them with the file registry — a tenant-authored playbook overrides a file playbook of the same id.
- `response_webhook_url` (and an optional `response_webhook_secret`) on a tenant configures the `notify_webhook` target.
- `response_action_endpoints` on a tenant maps endpoint ids to `{ url, secret }` for `external_action` — the operator owns the targets; a playbook only names an id.

Every dispatch, route, execution, and rejection is logged, and every executed action carries the playbook id and version plus the connector's reference into the ledger. A playbook that fails validation is rejected whole and never governs anything, so a bad edit degrades to "that playbook is not active," never to a wrong action.
