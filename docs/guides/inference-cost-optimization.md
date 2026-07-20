---
title: Cost and performance of AI triage inference
description: "Where to run the model behind AI triage and how to make it affordable: batching and caching, model tiering, cheaper hosted models, and self-hosting on rented or local GPUs, with measured cost and latency."
---

# Cost and performance of AI triage inference

The model calls are the running cost of AI triage. SocTalk keeps most alerts away from a model in the first place, through deduplication, coalescing, correlation, and deterministic close (see [How it works](/how-it-works)), so the spend that remains is concentrated on the alerts that actually need judgment. This guide is about serving those calls affordably, without giving up more quality than you have measured, and without moving sensitive alert content out of your perimeter.

The options below are ordered cheapest and safest first, and most deployments never reach the last one.

## Batch and cache before anything else

Two managed features on the frontier APIs cut cost with no change to model quality.

**The Batch API** processes requests asynchronously for a flat discount, and the output is identical. SocTalk fits this without effort. The settle window already holds a run back so correlated alerts accumulate, and a run is asynchronous to begin with, so triage is not a latency-sensitive path.

**Prompt caching** bills the repeated part of a prompt at a fraction of the input rate. SocTalk's supervisor and verdict prompts carry a large stable prefix, the system prompt and tool definitions, with the volatile per-case content at the tail, so the cacheable fraction is real and is already used on the Anthropic path.

Turn both on and measure the new per-run cost before you consider anything below. Neither touches quality, so there is no reason to skip them.

## Put a cheaper model on the cheaper work

A triage run uses a model in two roles: a supervisor that routes the investigation, deciding what to enrich next and when to decide, and a verdict that weighs the evidence. Routing is the lighter task. SocTalk resolves each role to its own tier, and each tier points at its own provider, model, and endpoint, so the router can run on a smaller model while the verdict keeps the capable one. This is configuration, not new infrastructure.

## Cheaper hosted models, with one caveat

Several providers serve near-frontier open models that can undercut the frontier APIs, depending on provider, model, and workload. They fit the routine, lower-risk cases where a near-frontier open model is enough. For security work the constraint is data governance rather than price: sending customer alerts to a third-party API, especially one in another jurisdiction, moves that data outside your control. If that is a hard no for your tenants, the next section keeps the data inside your boundary.

## Self-host the model

Self-hosting is the largest saving, and the only option that keeps alert content inside your perimeter. SocTalk consumes a self-hosted model the same way it consumes a frontier API, by pointing a tier at an OpenAI-compatible endpoint. It classifies the backend by its delivery model, a warm managed API, a scale-to-zero serverless GPU, an always-on rented GPU, or a local instance, so cost and scheduling behave correctly for each.

Where you run it is a real tradeoff.

- **A managed serverless GPU platform** (for example Modal) deploys the model behind an OpenAI-compatible endpoint, scales to zero when idle, and bills per GPU-second. You pay only while it runs and there is no server to operate, at a higher hourly rate than a raw rental.
- **A GPU rental marketplace** (for example RunPod) rents consumer GPUs close to what a small self-hosted deployment would buy, at a lower hourly rate. In exchange you run the lifecycle. A pod bills until you stop it, cold starts take minutes, and availability on the cheapest tiers varies.
- **A local instance** (for example [Ollama](/integrate/ollama)) runs on hardware you already own, with no metered per-request charge and nothing leaving the machine, bounded by that one machine's throughput.

## Utilization, not the card, drives the saving

A self-hosted server is only cheap when its continuous batch is full. One request at a time leaves the GPU under-utilized and makes self-hosting cost more than it should. SocTalk runs several investigations concurrently per worker, so multiple requests are in flight against the backend at once and the batch fills.

In our benchmarks, filling the batch to eight concurrent requests raised aggregate throughput by roughly six to eight times over one-at-a-time and cut cost-per-request to about 13 to 17 percent of the serial case, across the tested L40S, A10G, L4, RTX 3090, and RTX 4090 runs. Utilization did most of the work. The concurrency, not the card, moved self-hosting from inefficient to cheaper than the serial baseline in these runs.

## What it costs, measured

These numbers are from our own benchmark runs of one 7B open model over a fixed set of triage cases at eight-way concurrency. They are guidance, not a guarantee. Your model, hardware, and alert mix will move them.

Per full triage, self-hosting on a rented consumer GPU came out around two to three orders of magnitude cheaper than an unoptimized frontier API call, and several times cheaper than the same model on a managed serverless platform, because the tested rental card was both cheaper per hour and, in these runs, faster. The managed platform's higher rate buys scale-to-zero and no operations. The frontier API's higher price buys a managed model tier that may suit the harder cases, with no infrastructure to run.

Latency stayed practical. The 12-case set finished in around a minute on a Modal A10G and in 11 to 14 seconds on a RunPod 4090, both at eight-way concurrency, rather than the several minutes a single-stream estimate implies, because concurrency overlaps the calls and real verdicts fit inside the token budget.

## Whether a small model is good enough

Cost only matters if the cheap model holds up. In our runs a 7B open model kept SocTalk's structured triage contract: valid router and verdict output, no schema errors, and verdicts that matched a larger reasoning model on roughly 58 to 75 percent of a small benchmark sample. It was weaker on routing, and on the authorization-sensitive cases it sometimes closed activity that had no authorization on file and should have escalated.

A small self-hosted model is therefore a workable cheap tier for the routine middle, with a capable model behind it for the hard cases. Whether it is good enough for your environment is a measurement, not an assumption, and it belongs against a representative benchmark before a small model is trusted with any close decision. The safety floor still holds either way. No model can close over a known malicious signal or an active related case, however it was served.

## Limitations to plan around

- **Cold starts.** A scale-to-zero or freshly rented backend is not instantly ready. Model download and load take minutes, so a burst that arrives cold waits. Fine for routine triage, a problem for anything urgent, which is why a warm fallback tier earns its place.
- **Operational burden on rentals.** A rented GPU bills until you stop it and has no scale-to-zero, so idle time is wasted money and teardown is yours to remember. Availability on the cheapest tiers varies.
- **Cost accounting.** A per-token budget is the right unit for a frontier API and the wrong one for a per-GPU-second backend. Track the backend's own billing unit when you self-host.
- **Data governance is a spectrum.** Redaction removes secrets before anything leaves, but the operational context, hosts, accounts, log content, still travels to an external API. Only in-boundary self-hosting keeps that context inside your perimeter.

## Choosing where to run the model

Three questions settle it. **Utilization.** A steady, high-utilization load favors a rented card; sporadic bursty load favors a scale-to-zero platform or a managed API whose idle cost is zero. **Operations appetite.** A rental is cheapest but you run it; a serverless platform costs more and runs itself; an API costs the most with nothing to run. **Data sensitivity.** If alert content cannot leave your boundary, self-hosting is the only answer, and the work above is how you make it affordable.

For most teams the order is the same as this guide. Batching and caching first, the router on a cheaper model next, and a self-hosted tier only once the volume and the data-residency need justify operating it.

**Disclaimer.** SocTalk is not affiliated with, endorsed by, or sponsored by any LLM or GPU service provider. Modal, RunPod, Anthropic, OpenAI, Ollama, and any other services named in this guide are mentioned only as examples of where a model can run. The cost and performance figures are our own benchmark observations, not vendor-published numbers, and all product names and trademarks belong to their respective owners.
