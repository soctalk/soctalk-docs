# How it works

## The problem, and what we set out to do

A SOC drowns in alerts. A single scan can produce thousands of them, most of what gets escalated turns out to be benign, and analysts burn out clearing a queue that is mostly noise. Traditional SIEM and SOAR tooling is deterministic and auditable but blunt: it fires on rules, so it is loud, and a human still has to read almost everything.

The first wave of AI SOC tools answered this by pointing a large language model at each alert: prompt in, verdict out. That helps with wording, but it inherits the model's weaknesses at exactly the job security depends on. A model reading one alert in isolation has no memory of what an analyst already decided, no model of the organization's own state (so it cannot tell a sanctioned change from an attack that looks identical), no guarantee it will not confidently close over a real indicator, and no sense of the other alerts around it. Running a frontier model on every raw alert is also expensive, and expense pushes teams toward cheaper models on the exact cases where judgment matters most.

SocTalk takes a different position: the model is one component, not the whole system. It is spent only on the judgment that genuinely needs reasoning, and everything around it stays deterministic and auditable. Noise is collapsed before any model runs. The model is given real organizational context. The safety-critical decisions live in code, where the model informs them but can never override them. Analyst decisions are remembered. And the verdict drives governed action, with a human gating anything that reaches into a live system. The result is that the model reasons about the ambiguous middle, and the parts that must be guaranteed stay guaranteed.

![The SocTalk triage pipeline: a deterministic ingest funnel, an agentic run with only two model calls, and governed action](/diagrams/triage-pipeline.svg)

## Two planes and a settle window

The pipeline runs across two planes, and knowing which is which explains most of the design.

The **ingest plane** is server-side and fully deterministic. When an adapter posts a batch of events, they are deduplicated, coalesced, correlated, deconflicted, and in many cases resolved without a model ever running. No LLM touches this plane.

The **graph plane** is a per-tenant agentic loop that runs in a separate worker process. It is where the model reasons, and it consults the model in only two roles: routing and the final verdict. Many cases need even less, closing on a deterministic policy without a model call at all. The worker keeps no database of its own. The case state it needs crosses to it as the claim payload and its result crosses back when it finishes, while enrichment happens through tool calls out to the SIEM and threat-intel services.

Between the two sits an optional **settle window**. When a tenant configures one, a promoted run is held un-claimable for a short delay so a burst of correlated alerts can accumulate first, and the model looks at the whole incident once rather than at each fragment as it arrives. A high-severity alert bypasses the wait.

Acting on the verdict happens back on the server, deterministically, after the worker completes. That keeps the model out of the loop that reaches into external systems.

## On the way in: the deterministic funnel

Most alerts are resolved before a model is ever consulted. This is the single biggest reason the pipeline is affordable and fast, and it is all deterministic code.

**Coalescing and deduplication collapse the storm.** A replayed event is a no-op. Beyond that, alerts are coalesced on a signature of rule, assets, and a five-minute bucket, so a burst of the same detection on the same asset becomes one case instead of thousands. The value is that the model, and the analyst, see one case per incident rather than the raw firehose. ([correlation and coalescing in the IR core](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/triage.py))

**Correlation keeps one incident to one case.** With entity correlation enabled, a new alert that shares a strong entity with an active investigation attaches to it as evidence rather than starting a fresh, context-free run. A source that starts to dominate the correlation, such as a scanner IP that touches everything, is demoted so it cannot pull unrelated alerts into one case. Correlation runs ahead of the close paths, so a benign-looking alert that belongs to a live incident is not quietly suppressed.

**Engagement deconfliction keeps sanctioned testing out of the queue.** A declared pentest or red-team window is matched by source, host, technique, and time. Activity inside it is flagged and audited but never auto-closed, and tester activity that strays out of scope is forced to a human look rather than closed. See [Users and roles](/users-and-roles) for how engagements are declared and reviewed.

**Deterministic close handles the obvious cases.** Low-severity, high-confidence false positives close by rule, and a recurring benign shape can close by reference to a prior decision, both without a model. The false-positive close bands and the operational close path deliberately hold out anything mapped to an ATT&CK technique, so a technique-mapped alert is not closed as routine noise.

**The ingest safety floor guards all of it.** No deterministic close is allowed to fire over a known indicator, an active incident, or a kill switch, and a volume cap acts as a circuit breaker so a runaway rule degrades to "humans look" rather than mass suppression.

Whatever survives the funnel is promoted to a triage run.

## The triage run: two model calls, and a lot of determinism

The run is an agentic loop, but the model's footprint inside it is small and deliberate.

The loop opens with a deterministic gate. If the alert matches a [triage policy](/triage-policies) whose disposition is guaranteed and unopposed, it is disposed there, and the model is never consulted at all.

For everything else, a **supervisor** decides what to do next. This is the first of the two model roles, and its whole job is routing: investigate, enrich, contextualize, decide, or close. It does no domain work itself, and it may take several routing turns before it decides.

The work it routes to is deterministic. The **enrichment workers** pull host and process context from the SIEM, check observable reputation through Cortex analyzers, and look up threat-intel context in MISP. These are tool calls and heuristics, not model calls. A common misconception about AI triage is that the model does the enriching. Here it does not: enrichment is deterministic tool orchestration, and the model only reads the results.

Along the way the run gathers its [authorization context](/authorization): the org-state facts that say whether this activity was sanctioned. Authorization is what lets the pipeline separate an authorized change from an attack that produces a byte-identical alert, a distinction no amount of reputation lookup can make.

When the supervisor has enough, it hands off to the **verdict**, the second model role. This is the one place a reasoning model weighs everything the run gathered and proposes a disposition: close, escalate, or ask for more information.

Then determinism takes over again. The verdict is a proposal, not a commit. A [triage-policy](/triage-policies) guard can only ever raise the model's decision, never lower it: a proposed close over a malicious signal or a contradicted authorization record is turned into an escalation, and the guard's vocabulary makes suppression impossible to express. If a proposed close touches a sensitive asset, it is held for human sign-off. The model proposes; deterministic code disposes.

## The guarantees: a safety floor in three places

The rule that authorization, and the model, can never override a real threat is not left to prompt wording. It is enforced in code, at three independent points on the close path:

- **On ingest**, before any deterministic close, keyed on a known indicator, an active incident, a kill switch, and the volume cap.
- **In the worker**, when the model proposes a close, keyed on indicators, unverified indicators, a contradicted authorization record, and active incidents. This is the only floor that consults authorization at all.
- **On the server**, when the close is committed, keyed on the kill switch, a sibling investigation sharing entities, and the volume cap.

Each close path is floored at its own point: a deterministic ingest close clears the first, and a model-proposed close clears the second and then the third. Authorization can lower suspicion at the worker floor, but it can never talk any of them out of a real indicator. See [Authorization](/authorization) for how covering evidence lowers suspicion without ever overriding a malicious signal.

## Acting on the verdict

Once the worker completes, the server commits the disposition and acts on it, deterministically and in one transaction.

An escalation lands in the [human review](/human-review) queue with the real evidence attached. When the run stalled specifically because authorization was absent, the review carries a typed authorization question, and the analyst's answer is saved as a reusable fact, so the same activity is not asked again for as long as that authorization holds. That ask-once memory is described on the [Authorization](/authorization) page.

A verdict also drives [response playbooks](/response-playbooks), and this is where the "governed action" stance shows. Safe actions, writing a note or notifying a webhook, run on their own. Actions that reach into a live system, isolating an endpoint or disabling an account, never run on their own: they are raised as a proposal and an analyst approves them first. A close may only ever annotate, a dispatch kill switch stops everything at once, and the whole dispatch happens server-side, never from the model's loop.

One last deterministic touch handles timing. If new correlated evidence arrived while the run was in flight and the case is still open, a follow-up run is started over the now-complete picture, so a late-arriving alert is not stranded outside the case it belongs to.

## What makes this different

Pulled together, a few properties set this apart from pointing a model at each alert:

- **Most alerts never reach a model.** Dedup, coalescing, deconfliction, and deterministic close resolve the bulk on ingest, so the model is spent on the ambiguous minority.
- **A run consults the model in only two roles**, routing and the final verdict, and many cases close deterministically with no model call at all. Enrichment is deterministic tool orchestration, not per-alert model classification.
- **One incident is one case.** Coalescing and correlation give the model the whole correlated picture, not a lone alert stripped of its context.
- **The model proposes, code disposes.** A guard and a three-site safety floor make it structurally impossible for the model to suppress a real threat.
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
