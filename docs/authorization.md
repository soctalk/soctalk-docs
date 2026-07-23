# Authorization

## Was this activity authorized?

Most of what a SOC escalates is not malicious. It is a real person or system doing real work that happens to look like an attack: an admin using a break-glass account at 3am, a deploy pipeline touching a config file, a scanner sweeping a subnet during a sanctioned pentest. Whether an alert is benign often depends not on the alert itself but on the state of the organization around it. Two byte-identical alerts can have opposite dispositions depending only on whether a change ticket, a maintenance window, or an approved baseline covers the activity.

Authorization is the layer that gives SocTalk that org-state context. It binds typed records (change tickets, standing baselines, change freezes, prohibitions, and entity facts about assets and accounts) to the activity in an alert, and reasons about whether a single record fully covers it. It only ever lowers suspicion by finding covering evidence. It never raises it, and it never overrides a malicious signal.

It is not a separate step bolted onto triage. It is context the agentic loop gathers while it investigates, and it resolves to one of three states that shape the verdict. Everything downstream still passes through the safety floor, which authorization can never weaken.

![Where authorization fits in the triage workflow](/diagrams/authorization-in-triage.svg)

## Covered, contradicted, absent

Every alert's authorization resolves to one of three states, and the difference between the last two is the whole game:

- **Covered.** A single record fully covers the activity: the right subject, target, action, time window, calendar validity, and approvals. Suspicion is lowered.
- **Contradicted.** Records are on file but none of them covers, or a high-priority prohibition forbids the action. A change ticket exists but it expired, or it is for a different host, or the change freeze it needed was never excepted. This is a finding, not an absence, and it escalates to a human.
- **Absent.** There is no record of the right kind on file at all. Absence is never treated as authorization. SocTalk asks for more information rather than assuming the activity was approved.

Keeping absent and contradicted apart matters. A stale or wrong ticket must never be read as "close to authorized." It is the opposite: the paperwork that should have covered this does not, and that is worth a human's attention.

## Where authorization facts come from

Facts reach the store three ways, at increasing trust:

- **Tenants assert facts about their own environment.** A customer declares a maintenance window or a standing baseline from the Authorization area. Tenant-asserted facts land pending and do not influence triage until an MSSP analyst approves them.
- **Systems push facts through the ingest API.** Provisioning scripts, CI hooks, and connectors submit typed facts with a per-tenant credential. Trust is stamped from the credential, never from the payload, because whoever can push a fact can suppress a detection.
- **Analysts answer an authorization question.** When triage stalls specifically because authorization is absent, the analyst answers once and the answer becomes a reusable record. This is the flow below.

## Recording a fact from the console: a worked example

Facts do not have to come from a connector or an investigation. An MSSP analyst or a tenant admin can record one directly, and the console form is built around the fact model, so a valid fact is the only thing you can submit.

Take a common case. Acme's `svc-deploy` service account will run privileged commands on `db-01` during Friday's maintenance, approved under change ticket CHG-1001. Left unstated, the `sudo` those commands trigger looks like exactly the kind of privilege use a SOC escalates. Recording the change ticket as a grant is what tells SocTalk the activity is covered.

Open the **Authorization** area. On the MSSP side, pick the customer from the tenant switch first; a tenant admin sees their own org directly. The list shows every fact on file with a plain-English summary, its source and trust tier, its validity, and its review status.

![The Authorization facts list: a covered change ticket, a pending tenant assertion awaiting review, and a change freeze](/screenshots/authz-facts-list.png)

Choose **New fact** to open the guided editor. You pick the **kind** first (grant, prohibition, change freeze, or entity context) and the **track** (account, for host activity described as subject, target, and action; or FIM, for file changes described as a path and a change type). The form then shows only the fields that are legal for that combination, so you cannot build a fact the engine would reject: a change-ticket grant requires an end date, a FIM prohibition cannot carry an account action, an account freeze scopes by environment rather than by config class. A **Reads as** line restates the fact in plain English as you type, and the source and trust tier are stamped automatically rather than typed by hand.

![The guided New-fact editor, filled for the change-ticket grant, with the live plain-English preview](/screenshots/authz-new-fact.png)

For the maintenance case: kind **Grant**, track **Account**, subject `svc-deploy`, target `db-01`, action `sudo-exec`, grant class **Change ticket**, reference `CHG-1001`, valid until the end of the window. **Create fact** writes it, and it appears in the list at analyst-asserted trust. From then until the expiry, an alert for that account, action, and host resolves to covered and its suspicion drops; after the expiry the same alert is absent again, and SocTalk goes back to asking rather than assuming.

A tenant admin records facts the same way, with one difference: a tenant assertion lands **awaiting review** at the lowest trust tier and does not influence triage until an MSSP analyst approves it from this same list (the pending row above). Analysts who prefer to work in bulk, or to drive the store from automation, can switch the editor to **Advanced: edit JSON** and submit the raw fact; the same validation applies either way.

## Answering an authorization question

When an investigation cannot be decided because authorization is absent, and there is no malicious signal, the review carries a typed authorization question rather than a generic request for more information. The analyst is asked one thing: was this activity authorized?

![The typed authorization question on a review, with a save action](/screenshots/authz-ask-question.png)

The panel states the exact activity in question and offers a single action, distinct from approve or reject. If the activity was authorized, the analyst sets how long the authorization should hold and chooses **Confirm authorized, save reusable authorization**. This writes a durable analyst-asserted grant scoped to exactly that activity (this account, this action, this host) with the chosen expiry.

![The reusable authorization saved, and the review cleared from the queue](/screenshots/authz-ask-saved.png)

The saved grant is the point. The next time the same activity produces an alert, a record now covers it, so the question is not asked again. Ask once, remember. The authorization is scoped to the exact activity and carries an expiry, so it does not silently widen or live forever, and it appears in the Authorization area where it can be reviewed or revoked at any time.

One rule is deliberate: a fact is created only by this explicit answer. SocTalk never learns an authorization from a plain close or reject. An analyst clearing the queue is not the same as an analyst stating that an activity is sanctioned, and treating it that way would let queue pressure quietly poison the store.

## Engagements

A fact answers a standing question, is this account allowed to do this on this host. Some authorizations are not standing at all, they are bounded to a window of time during which otherwise-suspicious activity is expected. A sanctioned pentest, a red-team exercise, or a maintenance window is authorization that opens and then closes. SocTalk models this as an engagement, and an engagement is simply a kind of authorization: a scoped, time-bounded authorization window during which the activity it describes is expected rather than alarming.

Engagements live in the same tenant Authorization area as facts, on their own Engagements tab. The older `/engagements` path still works and deep-links straight into that tab, since engagements were folded into the unified Authorization area rather than kept as a separate surface. Declaring one is a structured form: a name and kind, the start and end of the window, and the scope it covers, given as source IPs or CIDRs (format-checked), in-scope host names, and ATT&CK technique IDs.

![Declaring an engagement: a bounded pentest window scoped by source, host, and ATT&CK technique](/screenshots/authz-engagement.png)

An engagement works differently from a fact, though. It is not gated: a tenant-authorized user declares it, and can revoke it, directly, with no MSSP review step. What an engagement does is deconflict activity by validated source, target, and time window. Alert activity that falls inside a declared engagement, an in-scope source acting on an in-scope target during the window, is attributed to the tester: SocTalk records the observation, takes the alert out of the open queue, and skips LLM triage for it. It is never auto-closed or marked a false positive, the observation row stays queryable and counted. Activity from the tester that lands outside the declared scope is flagged for a closer look rather than waved through. When the window closes, deconfliction no longer applies and the activity is triaged normally again.

## The guardrails

Authorization is a suppression surface, so its limits are enforced in code, not left to prompt wording:

- **Absence never auto-closes.** No covering record means a human decides, never an automatic close.
- **Authorization never overrides a malicious signal.** A saved "authorized" fact cannot close an alert that also carries an IOC hit, malicious enrichment, or an active-incident correlation. Correlation runs before suppression, and the safety floor vetoes those cases independently of any fact. A reusable authorization lowers routine suspicion; it does not blind the system to a real attack that reuses the same activity.
- **Memory is typed and governed.** Facts carry a source, a trust tier, a scope, and an expiry. They are never free-form prompt memory, and broad or privileged facts are meant to pass through review.
- **Trust is tiered.** Connector-verified records outrank system-asserted, which outrank analyst-asserted, which outrank routine telemetry, which outranks tenant-asserted. A higher-trust record corroborates or overrides a lower-trust one.

## Where it shows up

Authorization context is rendered into the AI's reasoning on every investigation that carries it, so the model weighs the covering evidence itself rather than being handed a yes or no. Saved facts, their review status, and their expiry are listed in the **Authorization** area of the UI, where an analyst can revoke any fact. See [Users and roles](/users-and-roles) for who can assert, review, and answer, and [Human review](/human-review) for the review queue the authorization question rides on.
