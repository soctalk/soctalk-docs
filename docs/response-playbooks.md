# Response Playbooks

## From a verdict to an action

SocTalk's [AI triage pipeline](/ai-pipeline) exists to answer one question about an alert: is this real, and what should happen to the case. The agentic loop enriches the alert, gathers context, investigates, and reasons its way to a verdict, and the run ends on a disposition. The disposition is the final call, one of escalate to a human, auto-close as a false positive, or ask for more evidence. That decision is the product of the whole upstream pipeline, and it is where [triage policies](/triage-policies) do their work, keeping the parts of triage that must be guaranteed deterministic and letting the model reason about the ambiguous rest.

A disposition on its own changes nothing in the outside world. It does not open a ticket, page the on-call, hand the case to a SOAR, or pull a compromised laptop off the network. A response playbook is the layer that acts on the disposition. It runs strictly after triage commits, it reads what triage produced, and it turns that into concrete steps.

What it reads is a single typed object called the disposition envelope. SocTalk assembles the envelope the moment the disposition becomes final, inside the same database transaction, and it carries everything a response might key on. That is the effective disposition, meaning the final call after the safety floor has had its say; the model's verdict and its confidence; the alert's severity; its rule groups and rule ids; the ATT&CK techniques and tactics it was mapped to; the entities and IOCs involved; and which safety-floor vetoes fired along the way. The envelope is the contract between triage and response, and it is also the exact payload a playbook hands to any system downstream of it.

![How a response playbook consumes the triage disposition and acts on it](/diagrams/response-playbook-loop.svg)

Everything below is the right-hand side of that picture: how a playbook matches the envelope, which actions it can take, and how the dangerous ones stay behind a human. The code lives in [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response).

## Tier-0 runs, anything with blast radius waits

Every action a playbook can take carries a blast-radius tier, and the tier decides how it fires. Annotating a case or notifying an operator-chosen webhook is safe to do on its own, because the worst outcome is noise, so those run immediately with nobody in the loop. Isolating an endpoint or disabling an account is not safe to do on a hunch, so those never fire automatically. The playbook proposes the action, it becomes a proposal on the case, and an analyst has to approve it before it executes. The model never pulls a dangerous trigger during triage, and a playbook cannot pull one during response either. This is the same discipline the triage layer runs on: a proposal, then a gate, with a person as the gate for anything that reaches into the world.

Three rules live in code rather than in playbook data, and no playbook can weaken them. A close is the direction an attacker would most want to trigger, so on the close path a playbook may only annotate or audit, never take an external action. The dispatch kill switch, set with `SOCTALK_RESPONSE_DISPATCH_KILL` on the API process or the `response_dispatch_kill` flag on a tenant, stops every response with no rollout, which is the control to reach for when a connector starts misbehaving mid-incident. And a response fires only if the disposition actually took effect on the case. If an analyst closed or merged the investigation while the run was still going, nothing dispatches against a state that never happened.

## The three capabilities

A playbook refers to a capability by name and can name nothing else. An unknown name is rejected when the playbook is validated. Three capabilities ship today.

`annotate_investigation` writes a system note on the case. It is local, it is tier-0, and it is the only capability allowed on the close path.

`notify_webhook` posts the signed envelope to the tenant's configured webhook. This is the generic handoff to an external SOAR. SocTalk signs the envelope and sends it, and the receiver owns everything that happens after.

`external_action` is the gated one. It posts a named action together with the signed envelope to an operator-configured endpoint, and this is the seam where concrete stack behavior, isolating an endpoint or disabling an account, lives outside SocTalk behind a stable contract. It is never autonomous.

One detail keeps `external_action` safe. A playbook author names an endpoint and an action, never a URL. The operator maps that endpoint name to a real URL and a signing secret in the `response_action_endpoints` tenant policy, so an author can ask to isolate on the `edr` endpoint but cannot choose where the request actually goes. Every request is HMAC-signed, and it refuses to reach a private or link-local address.

## The schema

A response playbook is data, and one interpreter runs any number of them. The playbook that the tutorial below builds looks like this:

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active or shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx), not names
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

The `applies_to` block decides which alerts the playbook owns. It matches on rule groups, rule ids, ATT&CK technique ids, or ATT&CK tactics, and the four are OR'd together, so any one of them hitting is a match. An empty `applies_to` matches every alert, which is fine, because the disposition lists already decide when a playbook actually fires. ATT&CK matching follows one rule. Techniques are matched by their canonical id such as `T1021`, never by name, because the human-readable names are unstable. Tactics are matched by whatever string the alert source emits, and Wazuh sends names like `Lateral Movement` rather than `TA` refs.

Under `response`, `on_escalate` holds up to eight actions to take when the case escalates, and `on_close` holds up to four annotation-tier actions for an auto-close. Each action is a capability name, an optional `when` condition, and a bag of `params` that the capability reads. The params are pass-through. `external_action` pulls `endpoint` and `action` out of them and forwards the rest, and it does not need the target host named in params, because the full signed envelope travels with every request and the entities ride inside it.

## Conditions

A `when` condition is the only logic an author writes, and it runs in the same small sandboxed language as triage guardrails. It is a tree of single-operator nodes over a fixed set of fields, with no attribute access, no function calls, and no way to name anything outside the contract. The operators are `var`, the comparisons `==`, `!=`, `<`, `<=`, `>`, and `>=`, the logical `and`, `or`, `!`, and `!!`, and `in`. An action fires only when its condition holds, and a condition over data that is absent is simply false rather than an error.

The fields a condition may read all come from the envelope. There is the effective `disposition` and the `worker_disposition` the model proposed before the floor changed it; `floor_vetoed`, which says whether a floor veto altered the outcome; `verdict_confidence` and `severity`; the alert's `rule.groups` and `rule.ids`; and the ATT&CK fields, `mitre.techniques` holding the canonical `Txxxx` ids and `mitre.tactics` holding the source's tactic strings. The last four are lists, so you test them with `in`. Writing `{"in": ["T1021", {"var": "mitre.techniques"}]}` fires the action when the alert carries technique T1021. Referencing a field or operator that the contract does not declare rejects the playbook when it is saved, well before it could ever run.

## Build one in the no-code editor

Admins author response playbooks from the **Response Playbooks** page while a tenant is pinned, with no YAML required. This walks through building the `isolate-lateral-movement-endpoint` playbook from the schema above, end to end. It proposes isolating an endpoint on a high-severity lateral-movement escalation, notifies the SOC, and annotates the case.

Open **"+ New response playbook"** (or navigate to `/response-playbooks/editor`). The editor is two columns. The document form is on the left, and a live flow diagram is on the right that re-renders on every edit, showing the disposition fanning out to the actions and the gated ones routing through human approval.

![The blank no-code editor](/screenshots/response-playbook-editor-01-blank.png)

Start with identity. Give the playbook a slug id and a priority, where a lower number wins on a multi-match.

![Identity](/screenshots/response-playbook-editor-02-identity.png)

Next, decide which alerts it owns. The four matchers are OR'd. This playbook owns rule groups `sudo` and `su` and, more usefully, ATT&CK technique `T1021` (Remote Services) and the tactic `Lateral Movement`, so it fires on any alert mapped to lateral movement, whichever rule raised it. The technique field takes ids, not names, and the tactic field takes the string your source emits.

![Matchers, including ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

Now the gated isolate action. On escalate, add `external_action`, the capability marked "needs approval." Name the operator-configured `endpoint` and the `action`, which is `isolate_endpoint`, in its params, and you never enter a URL. Add a condition so it only fires on a high-severity escalation.

![The gated isolation action with a condition](/screenshots/response-playbook-editor-04-isolate.png)

Add the two tier-0 actions that round out the response. A `notify_webhook` hands the case to the SOC's SOAR, and an `annotate_investigation` leaves an audit trail. Both fire on their own.

![The tier-0 notify and annotate actions](/screenshots/response-playbook-editor-05-tier0.png)

Read the flow while you build. The right column projects the whole document. The disposition envelope fans out to each action, the gated isolate action routes through a human-approval step before it can execute, and the tier-0 actions are marked autonomous.

![The flow diagram, with the gated action routing through approval](/screenshots/response-playbook-editor-06-flow.png)

Saving with **Create (shadow)** persists it. The form and the stored document are the same artifact, and "Preview JSON" shows exactly what gets saved. Validation on save is fail-closed. The id must be a slug, every capability must be one of the vetted names, `on_close` may only annotate, and conditions must reference the declared contract. An unknown reference is rejected while you are authoring, never silently dropped at runtime.

![The completed playbook in the list, ready to activate](/screenshots/response-playbook-editor-07-list.png)

## Shadow, then activate

An authored playbook moves through four statuses: draft, shadow, active, and retired.

In shadow, the playbook is matched and its actions are selected exactly as an active one would be, and its would-fire actions are written to the audit trail, but nothing is enqueued. This gives you real evidence of what it would do against live traffic before it does anything.

Activating it, with the **Activate** action on the Response Playbooks page, makes it govern, and unlike a triage policy that activation is live. The response dispatcher runs on the control plane with database access, so an active playbook governs the very next disposition with no worker rollout to wait for. Deactivating returns it to shadow at once.

When a gated action does fire on a real escalation, it lands as a proposal on the case. The analyst sees exactly what would run and against which host, and approving it is what triggers the isolation. The action executes once, its remote reference is recorded, and a replayed delivery never fires it twice.

## The wiring

A few pieces carry all of this. `SOCTALK_RESPONSE_PLAYBOOK_DIR` on the API process is a directory of YAML playbooks the registry loads at startup, which is the git-managed path for operators who prefer playbooks as code. Authored playbooks live in the database instead, append-only and tenant-scoped with row-level security, and the dispatcher merges them with the file registry so that a tenant-authored playbook overrides a file playbook of the same id. `response_webhook_url`, with an optional `response_webhook_secret`, configures the `notify_webhook` target on a tenant. And `response_action_endpoints` on a tenant maps endpoint names to their url and secret for `external_action`, which is how the operator keeps ownership of the targets while a playbook only ever names one.

Every dispatch, route, execution, and rejection is logged, and every executed action carries the playbook id and version along with the connector's reference into the ledger. A playbook that fails validation is rejected whole and never governs anything, so a bad edit degrades to "that playbook is not active" rather than to a wrong action.
