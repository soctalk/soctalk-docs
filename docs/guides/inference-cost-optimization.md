---
title: Keeping the AI triage bill as low as it goes
description: "The moment AI triage works, the next question is the bill. Batching and caching, model tiering, cheaper hosted models, and self-hosting on rented and serverless GPUs, with measured cost and latency for driving the model bill as low as possible."
---

# Keeping the AI triage bill as low as it goes

The moment AI triage works, the next question is the bill. Every alert that reaches a model costs money, and at real alert volume that number climbs quickly. Most of that bill is optional.

SocTalk keeps most alerts away from a model in the first place, through deduplication, coalescing, correlation, and deterministic close (see [How it works](/how-it-works)), so the spend that remains is concentrated on the alerts that actually need judgment. This guide is about driving that remaining spend as low as it goes, without giving up more quality than you have measured, and being clear about which options keep alert content inside your perimeter and which send it to a third-party API.

The options below are ordered cheapest and safest first, and most deployments never reach the last one.

## Batch and cache before anything else

Two managed features on the frontier APIs cut cost with no change to model quality.

**The Batch API** processes requests asynchronously for a flat discount, and the output is identical. SocTalk fits this without effort. The settle window already holds a run back so correlated alerts accumulate, and a run is asynchronous to begin with, so triage is not a latency-sensitive path.

**Prompt caching** bills the repeated part of a prompt at a fraction of the input rate. SocTalk's supervisor and verdict prompts carry a large stable prefix, the system prompt and tool definitions, with the volatile per-case content at the tail, so the cacheable fraction is real and is already used on the Anthropic path.

Turn both on and measure the new per-run cost before you consider anything below. Neither touches quality, so there is no reason to skip them.

## Put a cheaper model on the cheaper work

A triage run uses a model in two roles: a supervisor that routes the investigation, deciding what to enrich next and when to decide, and a verdict that weighs the evidence. Routing is the lighter task. SocTalk resolves each role to its own tier, and each tier points at its own provider, model, and endpoint, so the router can run on a smaller model while the verdict keeps the capable one. This is configuration, not new infrastructure.

## Cheaper hosted models

A model marketplace, for example OpenRouter, serves open models from many providers at low per-token prices. In our own measured runs over the triage golden set, three inexpensive open models held routing with no schema errors, at a metered cost of roughly $0.08 to $0.30 per thousand triage nodes, and two of the three also held the full verdict set. The lowest-cost of the three was the weaker one on verdict, which is the same split the tiering above relies on, a cheaper model on routing and a capable one on the verdict. The [benchmark page](/guides/inference-cost-benchmark) has the per-model table and the method.

Two things decide whether a hosted model is cheap enough and good enough, and neither is obvious from the model card.

The first is which model, and it is not the parameter count. A 12B open model held the full routing set in these runs, so choose by whether a model holds the triage contract on a representative benchmark, rather than by how many parameters it carries.

The second is which provider and numeric precision serve it. A marketplace routes each request across providers that host the same model at different quantizations, and a lower-precision copy can score worse on the same prompts at a similar price. Pin the request to a named provider and quantization and measure that pairing, rather than trusting the per-call default. SocTalk pins the provider per tier for this reason.

For security work the constraint that remains is data governance, not price. Sending customer alerts to a third-party API moves that data outside your perimeter, whichever provider serves it. You can pin the jurisdiction, a US provider or a model vendor's own European endpoint, so a hosted model need not sit in an unknown country, but the alert content still leaves your boundary to reach it. If that is a hard no for your tenants, self-hosting below keeps the data inside it.

## The hosted models, one by one

Three open models held SocTalk's routing contract with no schema errors in our runs, and they differ enough that the right one depends on your residency need and on whether the cheap tier also has to carry the verdict. The [benchmark page](/guides/inference-cost-benchmark) has the scores and costs in full. Provider availability and prices move, so read the specifics below as a snapshot to re-check.

### Mistral-Nemo 12B

The cheapest of the three, and the only one of them with a first-party European endpoint. It scored 16/16 on routing at about $0.08 per thousand triage nodes and finished the set fastest, around 11 seconds, but took only 4/6 on the verdict cases, so it suits the router tier with a more capable model on the verdict rather than carrying both.

Mistral serves it on its own European infrastructure, which is the endpoint to pin for EU data residency. DeepInfra and other providers also serve it, in the US and elsewhere and at different numeric precisions, so pin the jurisdiction and quantization you want and measure that pairing. Its fit is the EU-residency case, and the lowest per-token price when it runs as a router paired with a separate verdict model.

### Mistral-Small-24B-2501

The cheapest model that held both routing and the full verdict set: 16/16 routing and 6/6 verdict, no schema errors, at about $0.09 per thousand triage nodes and about 17 seconds for the set. It cost less and ran faster than DeepSeek-V4-Flash for the same scores.

At the time we checked, this exact revision was served on the marketplace by a single US provider, DeepInfra, at fp8. That keeps the jurisdiction simple, US only, and it also means no first-party European option for this model and one provider to depend on. It was the lowest-cost model here that carried both routing and the verdict on its own, where US processing is acceptable.

### DeepSeek-V4-Flash

A flash model that also scored 16/16 on routing and 6/6 on the verdict cases with no schema errors. It was the priciest of the three at about $0.30 per thousand triage nodes and the slowest, around 53 seconds for the set, so Mistral-Small-24B-2501 undercut it on both cost and latency for the same scores.

It is served across many providers, several of them in the US, while its first-party endpoint is outside the US, so provider pinning matters more here than usual. Pin a US provider, we measured it on Parasail at fp8, and check the quantization, since some providers serve it at a lower precision. Its role is a second US option with full verdict strength, and its wider provider spread offers availability a single-provider model does not.

## Self-host the model

Self-hosting is the only option that keeps alert content inside your perimeter, and at sustained high-utilization load it can be the cheapest. SocTalk consumes a self-hosted model the same way it consumes a frontier API, by pointing a tier at an OpenAI-compatible endpoint. It classifies the backend by its delivery model, a warm managed API, a scale-to-zero serverless GPU, an always-on rented GPU, or a local instance, so cost accounting behaves correctly for each; the serverless scheduling that classification enables is still being built.

Where you run it is a real tradeoff.

- **A managed serverless GPU platform** (for example Modal) deploys the model behind an OpenAI-compatible endpoint, scales to zero when idle, and bills per GPU-second. You pay only while it runs and there is no server to operate, at a higher hourly rate than a raw rental.
- **A GPU rental marketplace** (for example RunPod) rents consumer GPUs close to what a small self-hosted deployment would buy, at a lower hourly rate. In exchange you run the lifecycle. A pod bills until you stop it, cold starts take minutes, and availability on the cheapest tiers varies.
- **A local instance** (for example [Ollama](/integrate/ollama)) runs on hardware you already own, with no metered per-request charge and nothing leaving the machine, bounded by that one machine's throughput.

## Utilization, not the card, drives the saving

A self-hosted server is only cheap when its continuous batch is full. One request at a time leaves the GPU under-utilized and makes self-hosting cost more than it should. SocTalk runs several investigations concurrently per worker, so multiple requests are in flight against the backend at once and the batch fills.

In our benchmarks, filling the batch to eight concurrent requests raised aggregate throughput by roughly six to eight times over one-at-a-time and cut cost-per-request to about 13 to 17 percent of the serial case, across the tested L40S, A10G, L4, RTX 3090, and RTX 4090 runs. Utilization did most of the work. The concurrency, not the card, moved self-hosting from inefficient to cheaper than the serial baseline in these runs.

## What it costs, measured

Two cheap paths measured well, and they differ mainly on whether alert content leaves your perimeter. A hosted open model on a marketplace, with the provider pinned, held routing with no schema errors at roughly $0.08 to $0.30 per thousand triage nodes, and two of the three also matched on the full verdict set. Self-hosting a small model on a rented consumer GPU measured about $0.09 to $0.18 per 1,000 alerts at eight-way concurrency, and it is the only path that keeps alert content inside your boundary. These are guidance, not a guarantee, and your model, hardware, and alert mix will move them.

Latency stayed practical. The self-hosted 12-case set finished in around a minute on a Modal A10G and about 11 seconds on a RunPod 4090, both at eight-way concurrency, rather than the several minutes a single-stream estimate implies.

For the full tables behind these numbers, the throughput sweeps, the real-RTX pricing, and the per-run triage times, see [what triage inference actually costs, measured](/guides/inference-cost-benchmark).

## Whether a small model is good enough

Cost only matters if the cheap model holds up, and the model matters more than its size. A raw 7B open model fell short where it matters most, routing: neither of the two 7B models tested cleared more than two of three routing cases, the stock model took only one of three, and on the authorization-sensitive cases one closed activity that had no authorization on file and should have escalated. The models that held the full 16-case routing set with no schema errors were larger-family open models, Mistral-Nemo 12B, DeepSeek-V4-Flash, and Mistral-Small-24B-2501, each measured hosted here with the provider pinned. Self-hosting them in-cluster is a later option once that serving lands. Choose by whether a model holds the triage contract on a representative benchmark, not by parameter count.

Even among those, the roles still split. The cheapest, Mistral-Nemo, held routing but was weaker on the verdict cases, so it fits the router tier with a more capable model on the verdict. The safety floor holds regardless of the model. No model can close over a known malicious signal or an active related case, however it was served.

## Limitations to plan around

- **Cold starts.** A scale-to-zero or freshly rented backend is not instantly ready. Model download and load take minutes, so a burst that arrives cold waits. Fine for routine triage, a problem for anything urgent, which is why a warm fallback tier earns its place.
- **Operational burden on rentals.** A rented GPU bills until you stop it and has no scale-to-zero, so idle time is wasted money and teardown is yours to remember. Availability on the cheapest tiers varies.
- **Cost accounting.** A per-token budget is the right unit for a frontier API and the wrong one for a per-GPU-second backend. Track the backend's own billing unit when you self-host.
- **Data governance is a spectrum.** Redaction removes secrets before anything leaves, but the operational context, hosts, accounts, log content, still travels to an external API. Only in-boundary self-hosting keeps that context inside your perimeter.

## Choosing where to run the model

Three questions settle it. **Utilization.** A steady, high-utilization load favors a rented card; sporadic bursty load favors a scale-to-zero platform or a managed API whose idle cost is zero. **Operations appetite.** A rental is cheapest but you run it; a serverless platform costs more and runs itself; an API costs the most with nothing to run. **Data sensitivity.** If alert content cannot leave your boundary, self-hosting is the only answer, and the work above is how you make it affordable.

For most teams the order is the same as this guide. Batching and caching first, then the router on a cheaper model. For the cheap tier itself, a hosted open model with the provider pinned is the least-effort option that measured well: Mistral-Nemo on a European endpoint when you need EU residency, or Mistral-Small-24B-2501 and DeepSeek-V4-Flash on a US provider otherwise. A self-hosted tier earns its operational cost once the volume or a hard data-residency requirement justifies it.

**Disclaimer.** SocTalk is not affiliated with, endorsed by, or sponsored by any LLM or GPU service provider. Modal, RunPod, OpenRouter, Anthropic, OpenAI, Ollama, and any other services named in this guide are mentioned only as examples of where a model can run. The cost and performance figures are our own benchmark observations, not vendor-published numbers, and all product names and trademarks belong to their respective owners.
