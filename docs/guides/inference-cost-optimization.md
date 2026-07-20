# Cost and performance of AI triage inference

Running a capable model on every alert that reaches a triage decision can be a major running cost of model-backed triage. SocTalk keeps most alerts away from a model in the first place through deduplication, coalescing, correlation, and deterministic close (see [How it works](/how-it-works)), so this guide is about the alerts that remain, the ones that genuinely need a model, and how to serve them affordably, with the quality tradeoffs measured, and without moving sensitive data out of your perimeter.

The guidance below is ordered cheapest-and-safest first. Work down the list; each step is independent, and most deployments never need the last one.

## Step 1: batch and cache before anything else

Two managed frontier features reduce cost without changing model quality, and apply immediately.

The **Batch API** processes requests asynchronously for a flat discount, with no change to the output. SocTalk's design tolerates this: the settle window already holds a run back so correlated alerts accumulate, and the run itself is asynchronous, so triage is a natural fit for asynchronous batching rather than a latency-sensitive path.

**Prompt caching** bills the repeated part of a prompt at a fraction of the input rate. SocTalk's supervisor and verdict prompts are built with a large, stable prefix (the system prompt and tool definitions) and the volatile per-case content at the tail, so the cacheable fraction is real and is already exploited on the Anthropic path.

These two combine, and they require no self-hosting and no quality tradeoff. Turn them on first and measure the new per-run cost before considering anything below.

## Step 2: put a cheaper model on the cheaper work

A triage run uses a model in two roles: a supervisor that routes the investigation (what to enrich next, when to decide) and a verdict that weighs the evidence. Routing is the lighter cognitive task. SocTalk resolves each role to its own tier, and each tier can point at a different provider, model, and endpoint, so you can run the router on a smaller or cheaper model and reserve the most capable model for the verdict. This is configuration, not new infrastructure.

## Step 3: consider a cheaper hosted model, with one caveat

Several providers serve near-frontier open models that can be cheaper than the frontier APIs, depending on provider, model, and workload. They are a real cost lever for the ambiguous middle. The caveat is specific to security work: sending customer alerts to a third-party API, especially one outside your jurisdiction, is a data-governance decision, not only a pricing one. If that matters for your tenants, the next step keeps the data inside your boundary.

## Step 4: self-host the model

Self-hosting is the largest cost lever and the only one that keeps the alert content inside your perimeter. SocTalk can consume a self-hosted model the same way it consumes a frontier API, by pointing a tier at an OpenAI-compatible endpoint. The model classifies the backend by its delivery model (a warm managed API, a scale-to-zero serverless GPU, an always-on rented GPU, or a local instance) so cost and scheduling behave correctly per backend.

Where you run it is a real choice:

- **A managed serverless GPU platform** (for example Modal) deploys a model behind an OpenAI-compatible endpoint, scales to zero when idle, and bills per GPU-second. You pay only while it runs, and there is no server to operate, at a higher per-hour rate than a raw rental.
- **A GPU rental marketplace** (for example RunPod) rents consumer GPUs similar to what a small self-hosted deployment might buy, at a lower per-hour rate. In exchange you operate the lifecycle yourself: a pod bills continuously until you stop it, cold starts take minutes, and node availability varies.
- **A local instance** (for example [Ollama](/integrate/ollama)) runs on hardware you already own, with no metered per-request charge and nothing leaving the machine, bounded by that one machine's throughput.

## Filling the batch matters as much as the card

A self-hosted server is only cheap when its continuous batch is full. A single request at a time leaves the GPU under-utilized and makes self-hosting cost more than it should. SocTalk runs multiple investigations concurrently per worker, so several requests are in flight against the backend at once and the batch fills.

In our benchmarks, filling the batch to eight concurrent requests raised aggregate throughput by roughly six to eight times over one-at-a-time and cut cost-per-request to about 13 to 17 percent of the serial case, across the tested L40S, A10G, L4, RTX 3090, and RTX 4090 runs. The important result is that utilization drove most of the saving: the concurrency, not the card, moved self-hosting from inefficient to cheaper than the serial baseline in these runs.

## What it costs, measured

The numbers below are from our own benchmark runs of one 7B open model over a fixed set of triage cases at eight-way concurrency. They are guidance, not a guarantee; your model, hardware, and alert mix will move them.

Per full triage, self-hosting on a rented consumer GPU came out around two to three orders of magnitude cheaper than an unoptimized frontier API call, and several times cheaper than the same model on a managed serverless platform, because the tested rental card was both cheaper per hour and, in these runs, faster. The managed platform's higher price buys scale-to-zero and no operations. The frontier API's higher price buys a managed model tier that may suit the harder cases, with no infrastructure to run.

The realistic latency was around a minute for the 12-case set on the Modal A10G, and 11 to 14 seconds on the RunPod 4090, at eight-way concurrency, not the several minutes a naive single-stream estimate suggests, because concurrency overlaps the calls and real verdicts fit inside the token budget.

## Can a small self-hosted model actually do the triage?

Cost only matters if the cheap model is good enough. In our runs, a 7B open model held SocTalk's structured triage contract: it produced valid router and verdict output with no schema errors, and its verdicts matched a larger reasoning model on roughly 58 to 75 percent of a small benchmark sample. It was weaker on routing, and on the authorization-sensitive cases it sometimes closed activity that had no authorization on file and should have escalated.

Read that honestly. A small self-hosted model is a viable cheap tier for the routine middle, with a capable model as the fallback for the hard cases. Whether it is good enough for your environment is a measurement, not an assumption, and it should be made against a representative benchmark before a small model is trusted with any close decision. SocTalk's safety floor still applies regardless: a model cannot close over a known malicious signal or an active related case, however it was served.

## Limitations to plan around

- **Cold starts.** A scale-to-zero or freshly rented backend is not instantly ready. Model download and load take minutes, so a burst that arrives cold waits. This is fine for routine triage and a problem for anything urgent, which is why a warm fallback tier matters.
- **Operational burden on rentals.** A rented GPU bills until you stop it and has no scale-to-zero, so idle time is wasted money and teardown is your responsibility. Availability on the cheapest tiers varies.
- **Cost accounting.** A per-token budget is the right unit for a frontier API and the wrong unit for a per-GPU-second backend. Track the backend's own billing unit when you self-host.
- **Data governance is a spectrum.** Redaction removes secrets before anything leaves, but the operational context (hosts, accounts, log content) still travels to an external API. Only in-boundary self-hosting keeps that context inside your perimeter.

## Choosing

The decision comes down to three questions. How steadily will the GPU be busy: a steady, high-utilization load favors a rented card, while sporadic bursty load favors a scale-to-zero platform or a managed API whose idle cost is zero. How much operations appetite do you have: a rental is cheapest but you run it, a serverless platform costs more but runs itself, an API costs the most but there is nothing to run. And how sensitive is the data: if the alert content cannot leave your boundary, self-hosting is the only answer, and the cost work above is how you make it affordable.

For most teams the sequence is: turn on batching and caching, split the router onto a cheaper model, and only then decide whether a self-hosted tier is worth operating for your volume and your data-residency needs.
