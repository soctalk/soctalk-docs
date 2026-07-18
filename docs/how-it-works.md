# How it works

## The problem

A SOC drowns in alerts. A single scan can produce thousands of them, most of what gets escalated turns out to be benign, and analysts burn out clearing a queue that is mostly noise. The hard part is not detecting things. It is deciding, quickly and safely, which of the things that fired actually matter.

## Three generations of SOC triage

Triage tooling has been through three generations, and each one fixed the last one's problem while leaving a blind spot of its own.

The first generation is **rules**: signature and correlation rules in a SIEM, and deterministic automation in a SOAR. It is fast, auditable, and predictable, which is why it still runs underneath everything. It is also blunt. A rule fires on anything that matches it, so it is loud, and a human still has to read almost everything. It is a smoke alarm: reliable, but it cannot tell a real fire from burnt toast.

The second generation added **machine learning**: supervised classifiers, anomaly detection, and user-behavior analytics that learn what normal looks like and score what does not. This sorts the queue and surfaces the odd ones, but it needs labeled data, it drifts as the environment changes, and it hands you a score rather than a reason. It is a spam filter: it sorts the pile, but it gives you a number, not an explanation.

The third generation is **language models**, which can reason about an alert in context and explain themselves in plain language. The first wave of AI SOC tools used them the obvious way, pointing a model at each alert, prompt in and verdict out. The trouble is that a model reading one alert in isolation has no memory of what an analyst already decided, no picture of the organization's own state (so it cannot tell a sanctioned change from an attack that looks identical), no guarantee it will not confidently close over a real indicator, and no sense of the other alerts around it. Running a frontier model on every raw alert is also expensive, and expense pushes teams toward weaker models on exactly the cases where judgment matters most. It is a sharp analyst on their first day: it reasons well about any one alert, but it remembers nothing from yesterday and has not been handed the change calendar or the asset list.

![The evolution of SOC triage: rules, then machine learning, then language models, and where SocTalk sits](/diagrams/soc-evolution.svg)

Each generation is genuinely good at something, and none of them is wrong. The problem is that most products pick one and lean on it.

## What SocTalk does differently

SocTalk pairs the first generation with the third and deliberately skips the opaque middle. The rulebook's guarantees stay in code. The noise collapse that machine learning set out to do is done deterministically instead, by coalescing, correlation, and rule-based close, so nothing in the decision path is a trained black box. The language model is kept for the one thing it is uniquely good at, reasoning about the ambiguous cases, and it is spent only there. Then two things none of the earlier generations had are added on top: the pipeline remembers what analysts decide, and a human gates anything that reaches into a live system.

Put another way, the model is one component, not the whole system. Noise is collapsed before any model runs. The model is given real organizational context. The safety-critical decisions sit behind a **safety floor**, a small set of hard vetoes written in code that neither a rule nor the model can switch off, the way a circuit breaker cuts power no matter what the wiring is asking for. Analyst decisions are remembered. And the verdict drives governed action, the system's SOAR layer, with a human approving anything dangerous. The result is that the model reasons about the ambiguous middle, and the parts that must be guaranteed stay guaranteed.

![The SocTalk triage pipeline: a deterministic ingest funnel, an agentic run where the model is consulted in only two roles, and governed action](/diagrams/triage-pipeline.svg)

## Two planes and a settle window

The pipeline runs across two planes, or stages, and knowing which is which explains most of the design.

The **ingest plane** is server-side and fully deterministic. When an adapter (the tenant-side collector that forwards Wazuh and similar alerts) posts a batch of events, they are deduplicated, coalesced, correlated, deconflicted, and in many cases resolved without a model ever running. No model touches this plane.

The **graph plane** is the agentic loop, one per tenant, running as its own process. It is where the model reasons, and it consults the model in only two roles: routing and the final verdict. Many cases need even less, closing on a deterministic policy without a model call at all. The loop keeps no database of its own: the case is handed to it when the run starts and its result is handed back when the run finishes, and its enrichment happens through tool calls out to the SIEM and threat-intel services.

Between the two sits an optional **settle window**. When a tenant configures one, a promoted run is held back for a short delay so a burst of correlated alerts can accumulate first, and the model looks at the whole incident once rather than at each fragment as it arrives. A high-severity alert bypasses the wait.

Acting on the verdict happens back on the server, deterministically, after the run completes. That keeps the model out of the loop that reaches into external systems.

## On the way in: the deterministic funnel

Many alerts are resolved before a model is ever consulted, which helps keep the pipeline affordable and fast, and it is all deterministic code.

**Coalescing and deduplication collapse the storm.** Deduplication drops a replayed event that carries an ID already seen. Coalescing then groups repeated alerts from the same rule on the same asset within a five-minute window into a single case, so a burst of the same detection becomes one case instead of thousands. The model, and the analyst, see one case per incident rather than the raw firehose. ([correlation and coalescing in the IR core](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/triage.py))

**Correlation keeps one incident to one case.** With entity correlation enabled, a new alert that shares a strong entity (a reliable identifier like a host or file hash) with an active investigation attaches to it as evidence rather than starting a fresh, context-free run. A source that starts to dominate the correlation, such as a scanner IP that touches everything, is demoted so it cannot pull unrelated alerts into one case. Correlation runs ahead of the close paths, so a benign-looking alert that belongs to a live incident is not quietly suppressed.

**Engagement deconfliction keeps sanctioned testing out of the queue.** When it is enabled, a declared pentest or red-team window is matched by source, host, technique, and time. Activity inside it is flagged and audited but never auto-closed, and tester activity that strays out of scope is forced to a human look rather than closed. See [Users and roles](/users-and-roles) for how engagements are declared and reviewed.

**Deterministic close handles the obvious cases.** Low-severity, high-confidence false positives close by rule, and a recurring benign shape can close by reference to a prior decision, both without a model. The false-positive close bands and the operational close path deliberately hold out anything mapped to an ATT&CK technique (a standard attack-technique ID), so a technique-mapped alert is not closed as routine noise.

**The ingest safety floor guards all of it.** No deterministic close is allowed to fire over a known indicator (a suspicious observable such as a malicious IP or file hash), an active incident, or a kill switch (an operator setting that halts automatic action), and a volume cap acts as a circuit breaker so a runaway rule degrades to "humans look" rather than mass suppression.

Whatever survives the funnel is promoted: it becomes an investigation, scheduled for a triage run.

## The triage run: two model roles, and a lot of determinism

The run is an agentic loop, but the model's footprint inside it is small and deliberate.

The loop opens with a deterministic gate. If the alert matches a [triage policy](/triage-policies) whose disposition (the outcome to apply: close, escalate, or ask for more information) is guaranteed and unopposed, it is settled there, and the model is never consulted at all.

For everything else, a **supervisor** decides what to do next. This is the first of the two model roles, and its whole job is routing: investigate, enrich, contextualize, decide, or close. It does no domain work itself, and it may take several routing turns before it decides.

The work it routes to is deterministic. The **enrichment steps** pull host and process context from the SIEM, check observable reputation through Cortex analyzers, and look up threat-intel context in MISP. These are tool calls and heuristics, not model calls. A common misconception about AI triage is that the model does the enriching. Here it does not: enrichment is deterministic tool orchestration, and the model only reads the results.

Along the way the run gathers its [authorization context](/authorization): the org-state facts (change tickets, approved maintenance, account and asset context) that say whether this activity was sanctioned. Authorization is what lets the pipeline separate an authorized change from an attack that produces a byte-identical alert, a distinction no amount of reputation lookup can make.

When the supervisor has enough, it hands off to the **verdict**, the second model role. This is the one place a reasoning model weighs everything the run gathered and proposes a disposition: close, escalate, or ask for more information.

Then determinism takes over again. The verdict is a proposal, not a commit. A [triage-policy](/triage-policies) guard can only ever raise the model's decision, never lower it: a proposed close over a malicious signal or a contradicted authorization record is turned into an escalation, and the guard's vocabulary makes suppression impossible to express. If a proposed close touches a sensitive asset, it is held for human sign-off. The model proposes; deterministic code disposes.

## The guarantees: a safety floor in three places

The rule that authorization, and the model, can never close over a known malicious signal, an unverified indicator, or an active related case is not left to prompt wording. It is enforced in code, at three independent points on the close path:

- **On ingest**, before any deterministic close, keyed on a known indicator, an active incident, a kill switch, and the volume cap.
- **During the run**, when the model proposes a close, keyed on a known indicator, an unverified indicator, and a contradicted authorization record. This is the only floor that consults authorization at all.
- **On the server**, when the close is committed, keyed on the kill switch, another active case that shares the same entities, and the volume cap.

Each close path is floored at its own point: a deterministic ingest close clears the first, and a model-proposed close clears the second and then the third. Authorization can lower suspicion at that middle floor, but it can never talk any of them out of a known indicator or an active related case. See [Authorization](/authorization) for how covering evidence lowers suspicion without ever overriding a malicious signal.

## Acting on the verdict

Once the run completes, the server commits the disposition and acts on it, deterministically and in one transaction.

An escalation lands in the [human review](/human-review) queue with the real evidence attached. When the run stalled specifically because authorization was absent, the review carries a typed authorization question, and the analyst's answer is saved as a reusable fact, so the same activity is not asked again for as long as that authorization holds. That ask-once memory is described on the [Authorization](/authorization) page.

A verdict also drives [response playbooks](/response-playbooks). This is the system's SOAR layer, the same kind of deterministic, governed automation a SOAR analyst would recognize, except it is driven by a reasoned verdict rather than a brittle rule, and it is where the "governed action" stance shows. Safe actions, writing a note or notifying a webhook, run on their own. Actions that reach into a live system, isolating an endpoint or disabling an account, never run on their own: they are raised as a proposal and an analyst approves them first. A close may only ever annotate, a dispatch kill switch stops active response actions at once (shadow audits can still record what would have fired), and the whole dispatch happens server-side, never from the model's loop.

One last deterministic touch handles timing. If new correlated evidence arrived while the run was in flight and the case is still open, a follow-up run is started over the now-complete picture, so a late-arriving alert is not stranded outside the case it belongs to.

## What makes this different

Pulled together, a few properties set this apart from pointing a model at each alert:

- **Many alerts never reach a model.** Dedup, coalescing, deconfliction, and deterministic close resolve many of them on ingest, so the model is spent on the ambiguous cases.
- **A run consults the model in only two roles**, routing and the final verdict, and many cases close deterministically with no model call at all. Enrichment is deterministic tool orchestration, not per-alert model classification.
- **One incident is one case.** Coalescing and correlation give the model the whole correlated picture, not a lone alert stripped of its context.
- **The model proposes, code disposes.** A guard and a three-site safety floor make it structurally impossible for the model to close over a known indicator, a contradicted authorization record, or an active related case.
- **The pipeline reasons about authorization.** It can tell a sanctioned change from an identical-looking attack, a judgment reputation and signatures cannot make on their own.
- **It remembers.** An analyst's authorization decision becomes reusable memory, so the queue stops asking a question already answered for as long as that authorization holds.

## Where to go next

Each stage has its own page and its code:

- [Authorization](/authorization) — org-state reasoning and the ask-once memory.
- [Triage Policies](/triage-policies) — the deterministic guardrails on the run.
- [Response Playbooks](/response-playbooks) — turning a verdict into governed action.
- [Human review](/human-review) — the review queue and the analyst decision path.
- [AI pipeline](/ai-pipeline) — the agentic graph in more detail.
- [Architecture](/reference/architecture) — the deployment and data model.

The pipeline code lives under [`src/soctalk/core/ir/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/core/ir) (ingest plane), [`src/soctalk/graph/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/graph) and [`src/soctalk/supervisor/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/supervisor) (graph plane), and [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response) (response).
