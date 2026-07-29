---
title: What triage inference actually costs, measured
description: "The measured runs behind the cost guide: continuous batching on serverless GPUs, real consumer RTX silicon on a rental marketplace, and realistic golden-alert triage time with a small self-hostable model. Throughput, dollars per thousand, and triage seconds, with the method and the limits stated."
---

# What triage inference actually costs, measured

The [cost guide](/guides/inference-cost-optimization) makes claims about what triage inference costs. This page is the measurement behind them: our own benchmark runs, the tables in full, and the method and limits so you can judge how far they carry to your own setup. Every result here is a single measured run, not a statistical result and not a vendor figure. The throughput sweeps use synthetic triage-shaped requests, the prices are snapshots read at the time of the run, and the triage-time and accuracy figures use a fixed golden set of fabricated alerts (12 cases for the self-hosted triage-time runs, an expanded 25 for the hosted-model runs). Your model, hardware, and alert mix will move all of it.

Four things were measured, from synthetic throughput up to realistic triage: how much a full continuous batch saves on a serverless GPU, how real consumer silicon compares to the datacenter parts that stand in for it, how long a real triage takes on a small self-hostable model, and how inexpensive hosted open models score once the provider is pinned. Each self-hosted run tore its GPU down afterward, so nothing was left billing.

## Continuous batching fills the GPU

One open model was deployed per GPU and fired a rising number of identical triage-shaped requests at the SGLang OpenAI-compatible endpoint. This measures the backend side of what worker concurrency unlocks: as the client concurrency N rises the continuous batch fills, aggregate throughput climbs, and cost per request falls.

The serverless platform has no consumer RTX cards, so low-end datacenter GPUs stand in as proxies: A10G (Ampere 24GB) for RTX 3090, L4 (Ada 24GB) for an RTX 4090-class card. Qwen3-14B needs about 28GB at bf16 and does not fit a 24GB card with batch headroom, so the 24GB cards run DeepSeek-R1-Distill-Qwen-7B, which leaves KV-cache room for a larger batch.

| GPU (proxy) | model | N=1 tok/s | N=8 tok/s | N=8 speedup | $/1k req, N=1 to N=8 |
|---|---|---|---|---|---|
| L40S (mid, 48GB) | Qwen3-14B | 24.8 | 146.7 | 5.9x | 4.37 to 0.74 (down 83%) |
| A10G (approx RTX 3090) | DS-R1-7B | 29.2 | 216.7 | 7.4x | 2.09 to 0.28 (down 87%) |
| L4 (approx RTX 4090) | DS-R1-7B | 17.3 | 131.2 | 7.6x | 2.57 to 0.34 (down 87%) |

Serial (N=1) leaves the GPU under-used on every card. Filling the batch at N=8 measured 5.9x to 7.6x aggregate throughput and cost per request at 13 to 17 percent of the serial case. The 24GB cards showed a higher speedup (7.4 to 7.6x) than the mid card running the 14B (5.9x), because the smaller model leaves more KV-cache room for a larger batch. L4's lower absolute tok/s than A10G is expected, since L4 is a low-TDP inference part, so it reads as a conservative floor for a real RTX 4090. The scaling factors were similar across cards, which is the point: utilization, not the card, drives the saving.

## Real consumer silicon, on a rental marketplace

A GPU rental marketplace rents the literal consumer cards, so this checks the real hardware the serverless proxies could only stand in for. Same 7B model, same sweep, single GPU, pod terminated after.

Rental pricing at the time, community tier, read from the marketplace API: RTX 3090 $0.22/hr, RTX 4090 $0.34/hr, RTX 5090 $0.69/hr, against the serverless platform's A10G $1.10/hr and L4 $0.80/hr.

Measured on a real RTX 3090:

| N | tok/s (aggregate) | speedup | $/1k req |
|---|---|---|---|
| 1 | 45.8 | 1.00x | 0.267 |
| 4 | 179.0 | 3.91x | 0.068 |
| 8 | 352.2 | 7.69x | 0.035 |

The batching speedup held on real silicon (7.69x at N=8, against 7.42x on the A10G proxy and 7.58x on the L4 proxy). The real RTX 3090 ran faster than the A10G proxy (45.8 versus 29.2 tok/s at N=1, 352 versus 217 at N=8), because the A10G is a cut-down part. Measured cost was lower on the rented card: $0.035 per 1k requests at N=8 against the A10G's $0.282, about 8x lower in this run, from a cheaper card ($0.22 versus $1.10/hr) and higher throughput, with no upfront GPU purchase. The pod path has a slow cold start (image pull plus model download), so it ran decoupled: create, poll until ready, sweep, terminate.

## Realistic triage time, and whether a small model holds

The sweeps above measured synthetic token throughput. This measures realistic triage: SocTalk's triage eval driven over 12 golden alerts at concurrency 8, timing the real router and verdict nodes on real payloads.

DeepSeek-R1-Distill-Qwen-7B, 12 golden alerts, N=8:

| Provider / GPU | serving | total wall | verdict | routing | schema errors |
|---|---|---|---|---|---|
| Serverless A10G | SGLang | 43.2 s | 5/6 | 2/3 | 0 |
| Rented RTX 4090 (secure) | vLLM | 11.3 s | 6/6 | 2/3 | 0 |

Stock versus distilled, both on the rented RTX 4090 (secure), N=8:

| Model | total wall | verdict | routing | schema errors |
|---|---|---|---|---|
| DeepSeek-R1-Distill-Qwen-7B | 11.3 s | 6/6 | 2/3 | 0 |
| Qwen2.5-7B-Instruct (stock) | 16.7 s | 6/6 | 1/3 | 0 |

Realistic golden triage at N=8 finished the 12-alert set in 11 to 43 seconds across these runs, under a minute. The 7B produced zero schema errors and verdict scores of 5/6 to 6/6, so a small self-hostable model produced valid structured triage output here. Stock Qwen2.5-7B-Instruct also worked (valid structured output, zero schema errors, the same verdict score as the distill) and trailed the distill by one case on routing, which is too small a routing sample to read strongly.

Where the 7B fell short was routing: neither 7B model cleared more than two of three routing cases, the stock model took only one of three, and on authorization-sensitive routing that is a safety gap rather than a rounding error. The hosted open models in the next section held the full 16-case routing set with zero schema errors, which is why the bottom line leans on a pinned hosted model rather than a raw 7B.

Cost per realistic triage, measured per node (a full agentic run is a few calls, so multiply by roughly 2 to 3): the serverless A10G at $1.10/hr is about $1.10 per 1,000 alerts; the rented RTX 4090 secure at $0.69/hr is about $0.18 per 1,000, and community at $0.34/hr about $0.09 per 1,000.

## Hosted open models, pinned to a provider

The runs above self-host the model. The other cheap path rents inference by the token from a model marketplace, which serves open models from many providers behind one OpenAI-compatible endpoint. This checks whether an inexpensive hosted open model holds SocTalk's triage contract, and what it costs once the provider is pinned.

Each model ran over an expanded 25-alert golden set (16 routing, 6 verdict, 3 deterministic policy), larger than the 12-case set the self-hosted runs above use, at concurrency 8. The request was provider-pinned in configuration, so routing could not drift between providers or to a lower-precision copy between calls; the quantization shown is the one that provider serves. The cost column is the marketplace's own metered spend for the whole run, divided by the 22 model-backed cases and scaled to a thousand, so it sits on the same per-node footing as the self-host numbers above. Multiply by roughly 2 to 3 for a full multi-node run. Prices per million tokens are snapshots read at the time of the run.

| Model | Pinned provider | $/1M in / out | routing | verdict | schema errors | wall (25-case) | $/1k nodes |
|---|---|---|---|---|---|---|---|
| DeepSeek-V4-Flash | Parasail (US, fp8) | 0.14 / 0.28 | 16/16 | 6/6 | 0 | about 53 s | about 0.30 |
| Mistral-Nemo 12B | Mistral (EU, first-party) | 0.019 / 0.030 | 16/16 | 4/6 | 0 | about 11 s | about 0.08 |
| Mistral-Small-24B-2501 | DeepInfra (US, fp8) | 0.05 / 0.08 | 16/16 | 6/6 | 0 | about 17 s | about 0.09 |

All three held the structured contract with zero schema errors and full routing accuracy on this set. The three deterministic policy cases call no model, so they sit outside the 22-case cost denominator and are not a model result. The verdict scores split: DeepSeek-V4-Flash and the 24B Mistral scored 6/6 on the verdict cases, while the 12B Mistral took four of six, a small enough verdict sample to read only as a direction. The lowest-cost run that held both routing and the full verdict set was Mistral-Small-24B-2501 at about $0.09 per thousand nodes, pinned to a US provider; it also beat DeepSeek-V4-Flash on latency here, about 17 seconds for the set against 53, while matching its scores. The European first-party option cost the same order and keeps inference on the vendor's own endpoint, which matters when a tenant needs the data to stay in the EU, though the content still leaves your perimeter to reach it.

## The capabilities behind these numbers

The savings above are not incidental. They come from a small stack of inference capabilities, each tracked in the open, that together let one triage run target a frontier or self-hosted backend and pay the lowest defensible rate for it. Some are in place today and some are still being built; the issue links show where each stands.

- **A uniform request substrate** ([#32](https://github.com/soctalk/soctalk/issues/32)). Every triage run is expressed as one `InferenceRequest`, resolved to a tier, with per-token budgeting, whether it lands on a frontier API or a self-hosted GPU. Nothing downstream has to know which backend it hit.
- **A delivery abstraction** ([#63](https://github.com/soctalk/soctalk/issues/63), in progress). Each backend is classified by how it is delivered and billed, a warm frontier API, a scale-to-zero serverless GPU, an always-on rented GPU, or a local instance, so the dispatcher knows a per-GPU-second backend from a per-token one rather than treating every backend as a warm token-metered API. That classification and the shared dispatcher are in place; the per-backend driver registry and the serverless readiness and scheduling it enables are the next tier of work ([#64](https://github.com/soctalk/soctalk/issues/64)).
- **Worker concurrency that fills the batch** ([#61](https://github.com/soctalk/soctalk/issues/61)). Several investigations run at once, so multiple requests are in flight against the backend and the continuous batch fills. That filled batch is where the higher throughput and lower cost on this page come from.
- **Serverless alignment** ([#64](https://github.com/soctalk/soctalk/issues/64), in progress). The benchmarking hit this gap directly, cold RunPod workers returning a proxy 404 during spin-up. The first piece has landed: a worker that releases and retries a run rather than losing it to a cold backend ([#77](https://github.com/soctalk/soctalk/issues/77) Phase 1). Burst-release scheduling, a native async-job driver, and per-GPU-second accounting are the work that remains in [#64](https://github.com/soctalk/soctalk/issues/64), which is what makes the scale-to-zero economics usable in production rather than only in a benchmark.
- **First-class self-hosted serving** ([#13](https://github.com/soctalk/soctalk/issues/13), in progress). Running the model inside your own cluster is the deployment that keeps alert content in your perimeter, and it is the intended in-cluster target for the delivery abstraction above.
- **A benchmarking and qualification suite** ([#33](https://github.com/soctalk/soctalk/issues/33), in progress). These runs are the current benchmark evidence, produced by a two-axis harness that separates model quality from serving viability, so a small open model is checked against the structured triage contract before it is trusted with any decision; #33 tracks growing that harness into a maintained qualification suite.

Underneath sits the cost-accounting spine: per-tier provider selection ([#4](https://github.com/soctalk/soctalk/issues/4)) runs the lighter router on a cheaper model than the verdict; a price overlay ([#5](https://github.com/soctalk/soctalk/issues/5)) stops a self-hosted or unknown model being billed at frontier rates; and enforced structured output ([#3](https://github.com/soctalk/soctalk/issues/3)) is the contract a small model must hold to be usable at all, which is exactly what the schema-error column above measures.

## How to read these numbers

- **Directional, not statistical.** The self-hosted runs use a 12-case golden set (3 routing, 6 verdict, 3 deterministic policy); the hosted-model runs use an expanded 25-case set (16 routing, 6 verdict, 3 policy). Both are small, so the accuracy figures point a direction, they do not qualify a model. A representative benchmark is the real quality gate before trusting a small model with any close decision.
- **Per node, not per full run.** The eval times each node as one call, not a full multi-turn investigation, so the triage seconds are per node. Multiply by roughly 2 to 3 for a full run.
- **Prices are a snapshot.** GPU rental and serverless rates move, and were read at the time of the run. Treat them as a ratio between options, not a current quote.
- **Operations vary by tier.** RTX 3090 pods on both community and secure cloud repeatedly failed to serve within a 22-minute window, while an RTX 4090 on secure cloud came up reliably, so the higher-tier card on secure cloud was the steadier path in these runs. Rented pods have no scale-to-zero, so teardown is manual, and every pod was terminated after each run.

## Bottom line: best cost-to-value setups

If you want the short answer, here is what these runs point to, by situation. Every figure is from the measurements above, so read it with the same caveats: single measured runs, prices as snapshots, accuracy directional.

| Situation | The setup that measured best here | Cost seen | The tradeoff you accept |
|---|---|---|---|
| Low ops, EU data residency needed | Mistral-Nemo (12B) as an EU router tier on Mistral's own European endpoint, with a capable verdict model | about $0.08 per 1,000 triage nodes, 16/16 routing, 0 schema errors | Alert content leaves your perimeter to a third-party EU API; Nemo took only 4/6 verdict here, so the verdict tier needs a capable model on an EU-approved endpoint too, which this benchmark did not establish a cheap hosted option for; single measured run |
| Low ops, US data residency is fine | Mistral-Small-24B-2501, the cheapest measured option with 16/16 routing and 6/6 verdict, or DeepSeek-V4-Flash, pinned to a US provider, router and verdict both on it | about $0.09 (Small-24B) to $0.30 (DeepSeek) per 1,000 triage nodes, 16/16 routing and 6/6 verdict, 0 schema errors | Alert content leaves your perimeter to a third-party US API; single measured runs, prices as snapshots |
| Alert content cannot leave your perimeter | Self-host a model that holds the contract in-cluster once in-cluster serving ships, with a capable fallback and the safety floor in place; the rented consumer-GPU economics measured about $0.09 to $0.18 per 1,000 alerts at worker concurrency 8 | in-cluster serving not measured yet; the rented and serverless self-host figures are directional proxies until it lands ([#13](https://github.com/soctalk/soctalk/issues/13)) | You own the serving, and you pick the model: a raw 7B was weak on routing here, so it is not the default |
| The hardest cases, with minimal ops | A capable frontier model for the verdict with the Batch API and prompt caching on, and a cheap tier for the routine middle | The frontier rate, but on only a fraction of alerts | The most expensive per call, in exchange for no infrastructure and a more capable managed model tier for the hardest cases |

For most teams the cheapest path that held routing in these runs was a hosted open model with the provider pinned: Mistral-Nemo on an EU endpoint when residency requires it, which held routing but was weaker on verdict so pair it with a capable verdict tier, or Mistral-Small-24B-2501 and DeepSeek-V4-Flash on a US provider, which held routing and the full verdict set. Self-hosting is the only way to keep alert content in your perimeter; there the single choice that did the most work was **worker concurrency at 8** to fill the continuous batch, paired with a model that holds the contract at zero schema errors. A raw 7B was weak on routing, so the model choice matters as much as the card.

The sequence the [cost guide](/guides/inference-cost-optimization) lays out still holds: batching and caching first, the router on a cheaper model next, a pinned hosted model as the cheap tier, and a self-hosted tier only once the volume or a hard data-residency need justifies operating it.

**Disclaimer.** SocTalk is not affiliated with, endorsed by, or sponsored by any LLM or GPU service provider. The platforms behind these runs, and the model marketplace and serving providers named on this page (OpenRouter, Parasail, Mistral, DeepInfra among them), are named only as examples of where a model can run. The figures here are our own benchmark observations on a fixed golden set, not vendor-published numbers, and all product names and trademarks belong to their respective owners.
