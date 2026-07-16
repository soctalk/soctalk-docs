# Triage Policies

An LLM triaging a `sudo` alert is a brilliant analyst and a poor guarantee. Ask it the same question twice and you can get two answers. Tell it to always pull the change record before deciding and it will — usually, mostly. But some of triage isn't a judgment call. An evidence step *has* to run before a verdict counts. A close on a PCI asset *must* pause for a human. A flood of agent-health noise *shouldn't* cost a model call at all. For those, you don't want reasoning. You want a rule.

A **triage policy** is that rule, written as data. It doesn't replace the agent — it wraps a few deterministic gates around the **agentic loop** (the supervisor-and-tools cycle that enriches, investigates, and reasons its way to a verdict). Every one of them obeys the same law:

> **The LLM proposes. A deterministic gate disposes.**

The model stays free to reason. A pure function decides whether its output takes effect, and it only ever steps in on edges you can *prove* — an authorization record that contradicts the activity, an IOC on the alert, an active incident that shares an entity with this one. The ambiguous middle passes straight through to the model, where it belongs.

![How a triage policy is evaluated inside the agentic loop](/diagrams/triage-policy-loop.svg)

Read it top to bottom: an alert resolves against the registry, runs the agentic loop under the policy's gates, and lands on a **disposition** — the final call on the case (auto-close, escalate to a human, or ask for more evidence). Underneath every automatic close sits a **safety floor**: a set of non-overridable, code-level vetoes that no policy can weaken, defined in full [below](#the-safety-floor). The numbered gates are the whole surface, and the next section walks them one at a time.

The one property that makes all of this safe: a **tenant-authored** triage policy can make triage **stricter**, never looser — its guardrails only raise, and the hard floor beneath every close can't be weakened. (Vetted built-in and operator-managed *file* policies are trusted code and aren't bound by that constraint.) The code lives in [`src/soctalk/triage_policy/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/triage_policy).


## Where a triage policy acts

A triage policy governs one run at four points — the numbered gates in the diagram above.

1. **Resolver.** An entry node matches the alert against the registry and writes the active triage policy into the run state. If the alert belongs to a known operational class with no security indicators, the run can close deterministically here without ever calling the model.
2. **Pre-decision gate.** A policy can require deterministic steps (for example, gathering authorization context) before a verdict is legal. If the supervisor proposes a verdict too early, the gate reroutes it to the required step first. A policy can also restrict which supervisor actions are legal in each phase, and that restriction is applied to the model's structured output before the call, so an illegal action cannot even be sampled.
3. **Post-verdict guard.** After the model drafts a verdict, a pure function decides whether it commits. It can override the draft (raise a close to an escalate), interrupt it (keep the draft but route to human sign-off), or let it stand. Every override is recorded.
4. **Safety floor.** A non-overridable set of checks guards every automatic-close path. It is *not* a single step — the IOC/authorization vetoes run inside the post-verdict guard, and the kill-switch, volume-cap, and active-incident vetoes run again when a close commits on the worker, server, and ingest planes. The diagram draws it as one node for clarity; nothing in a triage policy can weaken it wherever it runs.

## The safety floor

The floor is enforced in code, not in policy data, and it applies on every plane where a case can close automatically: the worker's disposition, the server that commits it, and the ingest fast-paths (memoized close and rules-based auto-close). A close is vetoed and the case is promoted or escalated instead when any of these hold:

| Veto | When it fires |
|---|---|
| IOC present | On the verdict path, a malicious enrichment verdict or a MISP match; on the ingest fast-paths, any raw IOC on the alert. |
| Contradicted authorization | Records exist but do not cover the activity (expired, out of window, wrong scope, forbidden by policy). |
| Unverified IOC | A router-tier close with observables that no enrichment ever checked. |
| Active incident | Another active investigation shares an attach-eligible entity with this one. |
| Kill switch | Auto-close is turned off, per tenant or install-wide. |
| Volume cap | The tenant's rolling count of automatic closes is spent. |

The effective set of gates on any run is the floor plus whatever the active policy adds. A triage policy can only make things stricter. This is what makes tenant-authored policies safe to allow: a misconfigured or hostile one cannot become a channel for suppressing detections.

The kill switch and volume cap are worth knowing by name. `SOCTALK_AUTO_CLOSE_KILL` on the API process, or the `auto_close_kill` policy flag on a tenant, flips every automatic close to a promotion with no rollout needed, which is the control you reach for mid-incident. `auto_close_volume_cap` (default 500 per 24 hours) means a runaway close loop degrades to "humans look at these" rather than mass suppression.

## Built-in triage policies

Two ship with the product. Both are vetted code and read-only.

**`dual-use-privileged-exec`** handles host-auth activity like `sudo` and `su`, where the same event is routine administration under a covering change record and an incident without one. It requires the `gather_authorization_context` step before any verdict, removes `CLOSE` from the supervisor's legal actions (so the cheap router tier cannot short-circuit a case whose whole point is that benign and hostile look identical), and requires human sign-off on any close touching a PCI-classified asset.

**`agent-health-operational`** handles Wazuh agent self-monitoring noise, such as rule 202 "Agent event queue is flooded." This is an infrastructure condition, not a security event, so the policy closes it deterministically with no model call at all, which also makes the outcome consistent instead of varying run to run. Any security indicator on the alert (a MITRE technique, an IOC, a malicious signal, an unattested class, or a critical Wazuh level — 12+) vetoes the deterministic close and sends the alert to full triage.

You can see both, with every gate and guardrail expanded, on the **Triage Policies** page in the MSSP dashboard.

## The schema

A triage policy is data. One generic interpreter runs any number of them.

```yaml
id: regulated-privileged-exec
version: 2
tenant: acme                       # a tenant slug or id; authored policies are always scoped
status: shadow                     # active | shadow
priority: 70                       # lower wins on a multi-match; authored/file >= 60
applies_to:
  rule_groups: [sudo]
  rule_ids: []
  authorization_tracks: [account]
required_steps: [gather_authorization_context]
decision_modules: [authorization_engine]
legal_actions:
  decide:  [VERDICT]               # an unlisted phase is unconstrained
close_signoff_data_classes: [pci]
guardrails:
  - when:
      "and":
        - "==": [{ "var": "authz.class" }, "contradicted"]
        - "==": [{ "var": "verdict" }, "close"]
    effect: override
    to: escalate
    reason: acted outside the terms of an authorization
```

Read that condition as: if the authorization class came out `contradicted` and the model drafted a `close`, raise it to `escalate`. Each node is a single operator over its arguments, and `var` reads a field from the state contract.

| Field | Meaning |
|---|---|
| `applies_to` | Which alerts the policy governs. Matched on rule groups, rule ids, or the authorization track of the alert's activity — the three are OR'd. |
| `required_steps` | Deterministic nodes that must run before a verdict is legal. |
| `decision_modules` | Declares the vetted engines the policy relies on (today: `authorization_engine`), validated against known modules. The runtime consultation is currently driven by `required_steps` (e.g. `gather_authorization_context`), not by this field. |
| `legal_actions` | The supervisor actions allowed per phase (`triage` until the required steps have run, then `decide`). An unlisted phase is unconstrained. |
| `close_signoff_data_classes` | A committing close on an asset in one of these classes is interrupted for human sign-off. |
| `guardrails` | Declarative override or interrupt rules. See below. |
| `priority` | Registry order. Built-ins occupy 10 and 50; anything authored or file-loaded must be 60 or higher, so it can never outrank a built-in's protections. |

Some capabilities are constrained by where a policy comes from:

- **Deterministic dispositions** (the thing `agent-health-operational` uses to close without a model) are **built-in-only** — minting a new auto-close class is a code-review decision, not configuration.
- **Authored policies may not grant `CLOSE`** in `legal_actions`. Granting it adds nothing over an unconstrained phase (the baseline already permits the router close) but would let the illegal-action remap force every proposal to a verdict-less auto-close standing only on the coarse floor. Terminal decisions route through `VERDICT` instead; validation rejects `CLOSE` in any phase. Built-in and file policies may still list the full action set.

## Guardrail conditions

Conditions are the only logic an author writes, and they run in a small sandboxed language over a documented state contract. There is no attribute access, no function calls, no way to name anything outside the contract. A condition is a tree of single-operator nodes.

Operators: `var`, the comparisons (`==`, `!=`, `<`, `<=`, `>`, `>=`), the logical `and` / `or` / `!` / `!!`, and `in`.

The fields a condition may read:

| Field | What it is |
|---|---|
| `authz.class` | `covered`, `contradicted`, or `absent`, derived from the engine. |
| `authz.in_scope`, `authz.sanctioned_or_routine`, `authz.actor_genuine`, `authz.policy_allowed` | The four *expectedness components* — the authorization engine's booleans for whether the activity fell in an approved scope, was sanctioned or routine, was performed by a genuine actor, and was permitted by policy. |
| `verdict` | The model's draft decision. |
| `verdict_confidence` | Its confidence, `0.0` to `1.0`. |
| `asset.data_classification`, `asset.environment`, `asset.criticality` | Trust-resolved attributes of the activity's asset. |
| `enrichment.ioc` | Whether a malicious signal is present. |
| `correlation.active_incident` | Whether an active incident overlaps. |

An `effect` is either `override` or `interrupt`. Suppression is not expressible: `close` is not a valid target, and an override may only raise a decision up the ladder `close < needs_more_info < escalate`, never down it. A condition that references an undeclared field or an unknown operator is rejected when the policy is validated, before it can ever run. Note that `enrichment.ioc` and `correlation.active_incident` are also enforced by the hard floor independently of any guardrail — in a shipped worker run `correlation.active_incident` is usually only populated at the commit-time floor, so lean on the floor for those rather than re-deriving them in a guardrail.

## Author one in the no-code editor

Admins author triage policies from the **Triage Policies** page while a tenant is pinned — no YAML required. This walks through building one real, non-trivial policy end to end. The example, `prod-privileged-exec-strict`, governs privileged-execution alerts on an account-authorization track: it demands authorization evidence, narrows what the agent may do, and adds raise-only guardrails plus a PCI close gate.

Open **“+ New triage policy”** (or `/triage-policies/editor`). The editor is two columns — the document **form** on the left, and a live **decision-flow projection** plus a **“Try it” simulator** on the right that re-render on every edit.

![The blank no-code editor](/screenshots/triage-policy-editor-01-blank.png)

**1 — Identity.** Give the policy a slug id and a **priority**: a floor-gated integer (`≥ 60`) where lower wins on a double match, so an authored policy can never outrank the built-in protections.

![Identity: slug and priority](/screenshots/triage-policy-editor-02-identity.png)

**2 — Which alerts does it own?** The three matchers are OR'd. Here the policy owns rule groups `sudo, su, sudoers`, rule ids `5402, 5501`, on the `account` track.

![Matchers](/screenshots/triage-policy-editor-03-matchers.png)

**3 — Investigation requirements.** Require the `gather_authorization_context` step, declare reliance on the `authorization_engine` module, and narrow the `decide` phase to `VERDICT` only. Note `CLOSE` is not offered — authored policies cannot grant it.

![Investigation requirements](/screenshots/triage-policy-editor-04-requirements.png)

**4 — Close sign-off.** A committing close on a `pci`- or `phi`-classified asset is held for a human.

![Close sign-off](/screenshots/triage-policy-editor-05-signoff.png)

**5 — Guardrails.** Guardrails run after the safety floor, in order, first match wins. Each condition can be authored as JSON — the sandboxed `{"op": [{"var": "field"}, value]}` dialect with `and`/`or` groups…

![Authoring a condition as JSON](/screenshots/triage-policy-editor-06-guardrail-json.png)

…or in the visual builder, which round-trips with the JSON. This guardrail fires when authorization is **contradicted** *and* the asset is **critical**, and raises the decision to `escalate`.

![The same condition in the visual builder](/screenshots/triage-policy-editor-07-guardrail-visual.png)

Two more complete the policy: a low-confidence override to `needs_more_info`, and an `interrupt` that holds a PCI close for human review. Order matters — the first matching guardrail disposes.

![All three guardrails](/screenshots/triage-policy-editor-08-guardrails-all.png)

**6 — Read the flow, then simulate.** The right column projects the whole document onto the pipeline: matchers → phases → LLM draft → **safety floor (always on)** → guardrails → sign-off → commit.

![Decision-flow projection](/screenshots/triage-policy-editor-09-decision-flow.png)

The **“Try it”** panel previews the guardrail + floor logic the editor can model — a subset of the full worker/server/ingest enforcement path, for authoring feedback. Feed it a contradicted-authorization, critical-asset case and the outcome is `escalate` — but it comes from the **safety floor**, not this policy. That is the core invariant made visible: contradicted authorization is a non-overridable floor veto, and the policy's guardrails only *raise* on top of it.

![The Try-it simulator showing the floor escalate](/screenshots/triage-policy-editor-10-try-it.png)

`Create (shadow)` saves it. The form and the stored document are the same artifact — “View as JSON” shows exactly what gets persisted.

![The completed policy](/screenshots/triage-policy-editor-11-complete.png)

Validation on save is fail-closed and applies the same rules as file policies plus a few stricter ones: the id must be a slug, referenced steps and decision modules and legal-action phases must be ones the runtime actually knows, `CLOSE` may not be granted, and the definition is size-capped. An unknown reference is rejected at author time rather than silently ignored at runtime. Every saved revision is kept as append-only history.

## Shadow, then activate

An authored policy has four statuses — **draft**, **shadow**, **active**, **retired**. Shadow evaluation is strongly recommended but not mandatory: a policy can be activated straight from draft.

In **shadow**, the policy is matched and its guardrails evaluated exactly as an active one would be, and its would-fire decisions are written to the audit trail — but it changes no disposition. This gives you real evidence of what it would do against live traffic before it decides anything.

**Activating** it (the **Activate** action on the Triage Policies page) makes it govern. Because the worker is a separate process whose registry loads once at startup, activation cannot just flip a database flag — it materializes the definition into the tenant's worker ConfigMap on the next `tenant.reconcile`, and the **worker rollout is the activation gate**: the policy starts governing only when a fresh worker reads it. Editing an active policy keeps it active and re-rolls with the new definition; deactivating returns it to shadow.

![The authored-policy lifecycle: shadow, then activate to govern](/diagrams/triage-policy-lifecycle.svg)

Operators who prefer to manage policies as code can still take the git path: write a YAML file into the mounted directory and roll the workers. The same registry loads both authored-and-activated policies and hand-written file policies.

## The wiring

Two environment variables carry it:

- `SOCTALK_TRIAGE_POLICY_DIR` on the runs-worker is the directory the registry loads from at startup.
- `SOCTALK_TENANT_TRIAGE_POLICIES_DIR` on the controller is the operator-mounted directory the provisioning path reads, validates, and renders into each tenant's chart values as a mounted ConfigMap.

On the chart-provisioned path, policies are tenant chart values (`runsWorker.triagePolicies`, rendered as the `soctalk-triage-policies` ConfigMap), and a content change stamps a checksum on the pod template so an edit rolls the worker automatically. The rollout is the activation gate: because the registry loads once per process, a policy only starts governing when a fresh worker reads it.

Every load, skip, and rejection is logged. A file that fails validation for any reason (bad schema, an unknown field, a malformed condition, a priority that would outrank a built-in) is rejected whole and never governs anything, so a bad rollout degrades to "that policy is not active," never to wrong enforcement.
