---
description: "Build an open source SOC stack with Wazuh, TheHive, Cortex, and MISP: what each tool does, the real integration cost, and when to package it."
---

# Building an open-source SOC stack: Wazuh, TheHive, Cortex, and MISP — assembled vs integrated

There is a canonical free-and-open-source SOC stack, and it has been roughly the same four names for years: Wazuh for detection, TheHive for case management, Cortex for observable analysis, MISP for threat intelligence. Each project is genuinely good at its job, each is battle-tested, and together they cover most of what a commercial SOC suite sells. The catch is the word *together*. The tools are excellent; the integration between them is a project you build and then own.

This guide covers what each piece does, what assembling them actually costs, how the requirements change when you run more than one organization's security, and where SocTalk fits — which is *on top of* this stack, not in place of it.

## The classic FOSS SOC stack

**[Wazuh](https://wazuh.com/)** is the SIEM/XDR layer: an agent on every endpoint, a manager that applies detection rules to the event stream, and an indexer (OpenSearch-based) that stores and searches the results. It ships file-integrity monitoring, vulnerability detection, log analysis, and a large default ruleset out of the box. It is where alerts are born.

**[TheHive](https://thehive-project.org/)** is the case-management layer: a security incident response platform where alerts become cases, cases carry tasks and observables, and analyst teams collaborate with an audit trail. If Wazuh is where alerts are born, TheHive is where investigations live and die.

**Cortex** is TheHive's companion for observable analysis. You hand it an IP, hash, domain, or URL, and its analyzer plugins fan out to reputation and sandbox services — VirusTotal, AbuseIPDB, Hybrid Analysis, and dozens more — and bring back a verdict. It turns "here's a hash" into "here's what the world knows about this hash."

**[MISP](https://www.misp-project.org/)** is the threat-intelligence platform: it aggregates, correlates, and shares indicators of compromise across feeds and sharing communities. Checking an observable against MISP tells you whether it belongs to a known campaign or actor — context none of the other three tools carries on their own.

Four tools, four distinct jobs, all open source. On paper, a complete SOC.

## The integration tax nobody budgets

Every one of these tools installs in an afternoon. That is where the home-lab tutorials end, and where the actual work begins, because none of them talk to each other out of the box in the shape a production SOC needs.

The glue is on you. Wazuh alerts don't become TheHive cases without a forwarder you write or adopt and then maintain across API changes on both sides. Cortex analyzers need API keys per provider, rate-limit handling, and a decision about which analyzer runs for which observable type. MISP needs feeds configured, sync jobs scheduled, and false-positive-prone indicators curated before you dare automate on them.

Then the operational surface: four products means four authentication systems and API-key rotation schedules, four upgrade cadences that can break your glue on any given release, four backup stories, and — since TheHive moved to Cassandra/Elasticsearch underneath — a nontrivial datastore footprint just for case management. Add TLS between every pair, monitoring for each service, and the question of who gets paged when the Wazuh-to-TheHive forwarder silently stops forwarding.

None of this is a criticism of the tools. It is the nature of composing independent projects: the integration layer is a fifth product, except nobody ships it, documents it, or upgrades it for you.

## Single-org vs MSSP: the requirements fork

For a single organization, the tax above is payable. You build the stack once, the glue serves one tenant, and a capable engineer can keep it healthy as a part-time job.

For an MSP or MSSP, the requirements fork hard:

- **Isolation is non-negotiable.** Customer A's alerts, cases, and indicators must be provably invisible to customer B — contractually, and often regulatorily. Shared single-tenant tools make that a per-tool configuration exercise with per-tool failure modes.
- **Per-customer stacks multiply the tax.** Ten customers on dedicated stacks means ten Wazuh managers and indexers to deploy, upgrade, and back up — and ten copies of your glue.
- **Onboarding must be repeatable.** Customer eleven should be a command, not a week of wiki archaeology. Hand-built stacks drift; drift becomes incident.
- **One pane of glass.** Analysts covering twenty customers cannot rotate through twenty dashboards.

This is the gap between "the FOSS SOC stack works" and "the FOSS SOC stack works as a business."

## Where SocTalk fits: a control plane on the stack, not a replacement

[SocTalk](https://github.com/soctalk/soctalk) does not replace any of the four tools. It is an Apache 2.0 multi-tenant control plane and AI triage layer built *around* this stack, for MSPs and MSSPs running it on their own Kubernetes:

- **Wazuh is the data plane.** Each customer gets a dedicated Wazuh manager and indexer in an isolated namespace, provisioned by the control plane — or you bring an existing Wazuh via the `provided` profile. Agents enroll over hostname-routed ingress with tenant-scoped secrets.
- **The AI triage layer sits between Wazuh and your analysts.** A deterministic ingest funnel dedups, coalesces, and correlates alerts before any model runs; a LangGraph agentic loop investigates what survives; escalations always pass a human review gate. Details in [How it works](/how-it-works).
- **TheHive, Cortex, and MISP are integrations**, consulted during the run: Cortex for observable reputation, MISP for threat-intel context, TheHive as the export target for escalated cases.
- **The multi-tenant machinery is the product**: namespace isolation with Cilium NetworkPolicy, Postgres row-level security as the data backstop, a tenant lifecycle state machine, and per-tenant LLM configuration.

**Be clear about the V1 integration surface**, because this is where honesty beats marketing:

- [TheHive export](/integrate/thehive) is opt-in and **synchronous** — the worker calls TheHive's API at graph-node time, creating the case and observables. There is no outbox, no retry loop, and no bundled TheHive subchart; if TheHive is unreachable, the failure is logged and the case proceeds in SocTalk only.
- [Cortex](/integrate/cortex) is **customer-managed only** in V1 — you run Cortex yourself and SocTalk calls it. No bundled subchart; analyzer selection uses a hard-coded map, and failed calls are non-fatal to the run.
- **MISP** lookups run in the pipeline's `misp_worker` against your MISP instance; a bundled MISP subchart is deferred to a future release.
- **Slack** notification and two-way approval code exists in the repo but is **not wired into the V1 chart runtime** — the dashboard review queue is the working human-in-the-loop surface today.

In other words: SocTalk packages the multi-tenant Wazuh plane and the triage layer, and *connects to* the TheHive/Cortex/MISP instances you operate. The bundled-subchart convenience is roadmap, not release.

## DIY the stack, or deploy SocTalk?

Honest criteria, since both paths are open source:

**DIY the four-tool stack when** you are a single organization with engineering time, you want maximum control over every component, your alert volume is manageable for your analyst headcount, and multi-tenancy is irrelevant. The classic stack plus your own glue is a proven pattern, and you will understand every wire because you soldered it.

**Look at SocTalk when** you are an MSP/MSSP that needs repeatable per-customer Wazuh stacks behind one control plane, provable tenant isolation, and AI triage that compresses alert volume before analysts see it — and you would rather operate one Helm-managed platform than N hand-built stacks. You still run Kubernetes, and in V1 you still operate your own TheHive, Cortex, and MISP if you want them.

The fastest way to evaluate is the [demo VM](/quickstart-vm): one image, a browser wizard, about five minutes to a running multi-tenant install with a demo tenant onboarded. From there, [How it works](/how-it-works) explains the pipeline, and the [TheHive](/integrate/thehive) and [Cortex](/integrate/cortex) pages document exactly what the V1 integrations do — and don't — so you can plan the rest of your stack around them.
