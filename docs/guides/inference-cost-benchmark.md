---
title: What triage inference actually costs, measured
description: "The measured runs behind the cost guide: continuous batching on serverless GPUs, real consumer RTX silicon on a rental marketplace, and realistic golden-alert triage time with a small self-hostable model. Throughput, dollars per thousand, and triage seconds, with the method and the limits stated."
---

# What triage inference actually costs, measured

The [cost guide](/guides/inference-cost-optimization) makes claims about what triage inference costs. This page is the measurement behind them: our own benchmark runs, the tables in full, and the method and limits so you can judge how far they carry to your own setup. Every result here is a single measured run, not a statistical result and not a vendor figure. The throughput sweeps use synthetic triage-shaped requests, the prices are snapshots read at the time of the run, and the triage-time and accuracy figures use a fixed 12-alert golden set. Your model, hardware, and alert mix will move all of it.

Three things were measured, from synthetic throughput up to realistic triage: how much a full continuous batch saves on a serverless GPU, how real consumer silicon compares to the datacenter parts that stand in for it, and how long a real triage actually takes on a small self-hostable model. Each run tore its GPU down afterward, so nothing was left billing.

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

Cost per realistic triage, measured per node (a full agentic run is a few calls, so multiply by roughly 2 to 3): the serverless A10G at $1.10/hr is about $1.10 per 1,000 alerts; the rented RTX 4090 secure at $0.69/hr is about $0.18 per 1,000, and community at $0.34/hr about $0.09 per 1,000.

## The capabilities behind these numbers

The savings above are not incidental. They come from a small stack of inference capabilities, each tracked in the open, that together let one triage run target a frontier or self-hosted backend and pay the lowest defensible rate for it. Some are in place today and some are still being built; the issue links show where each stands.

- **A uniform request substrate** ([#32](https://github.com/soctalk/soctalk/issues/32)). Every triage run is expressed as one `InferenceRequest`, resolved to a tier, with per-token budgeting, whether it lands on a frontier API or a self-hosted GPU. Nothing downstream has to know which backend it hit.
- **A delivery abstraction** ([#63](https://github.com/soctalk/soctalk/issues/63)). Each backend is classified by how it is delivered and billed, a warm frontier API, a scale-to-zero serverless GPU, an always-on rented GPU, or a local instance, so the substrate selects the right driver and knows a per-GPU-second backend from a per-token one, rather than treating every backend as a warm token-metered API. The serverless readiness and scheduling that this classification enables are the next tier of work ([#64](https://github.com/soctalk/soctalk/issues/64)).
- **Worker concurrency that fills the batch** ([#61](https://github.com/soctalk/soctalk/issues/61)). Several investigations run at once, so multiple requests are in flight against the backend and the continuous batch fills. That filled batch is where the throughput and cost drops on this page come from.
- **Serverless alignment** ([#64](https://github.com/soctalk/soctalk/issues/64), in progress). Cold-start tolerance, burst-release scheduling, and an async-job driver are designed to let a scale-to-zero GPU be consumed without losing runs to a cold worker, so the scale-to-zero economics become usable in production, not just in a benchmark. The benchmarking hit exactly this gap, cold RunPod workers returning a proxy 404 during spin-up.
- **First-class self-hosted serving** ([#13](https://github.com/soctalk/soctalk/issues/13), in progress). Running the model inside your own cluster is the deployment that keeps alert content in your perimeter, and it is the intended in-cluster target for the delivery abstraction above.
- **A benchmarking and qualification suite** ([#33](https://github.com/soctalk/soctalk/issues/33)). The evidence on this page is produced by a two-axis suite that separates model quality from serving viability, so a small open model is checked against the structured triage contract before it is trusted with any decision.

Underneath sits the cost-accounting spine: per-tier provider selection ([#4](https://github.com/soctalk/soctalk/issues/4)) runs the lighter router on a cheaper model than the verdict; a price overlay ([#5](https://github.com/soctalk/soctalk/issues/5)) stops a self-hosted or unknown model being billed at frontier rates; and enforced structured output ([#3](https://github.com/soctalk/soctalk/issues/3)) is the contract a small model must hold to be usable at all, which is exactly what the schema-error column above measures.

## How to read these numbers

- **Directional, not statistical.** The golden set is 12 cases (3 routing, 6 verdict, 3 deterministic policy), so the accuracy figures point a direction, they do not qualify a model. A representative benchmark is the real quality gate before trusting a small model with any close decision.
- **Per node, not per full run.** The eval times each node as one call, not a full multi-turn investigation, so the triage seconds are per node. Multiply by roughly 2 to 3 for a full run.
- **Prices are a snapshot.** GPU rental and serverless rates move, and were read at the time of the run. Treat them as a ratio between options, not a current quote.
- **Operations vary by tier.** RTX 3090 pods on both community and secure cloud repeatedly failed to serve within a 22-minute window, while an RTX 4090 on secure cloud came up reliably, so the higher-tier card on secure cloud was the steadier path in these runs. Rented pods have no scale-to-zero, so teardown is manual, and every pod was terminated after each run.

**Disclaimer.** SocTalk is not affiliated with, endorsed by, or sponsored by any LLM or GPU service provider, and the platforms behind these runs are named in the [cost guide](/guides/inference-cost-optimization) only as examples of where a model can run. The figures here are our own benchmark observations on a fixed golden set, not vendor-published numbers, and all product names and trademarks belong to their respective owners.
