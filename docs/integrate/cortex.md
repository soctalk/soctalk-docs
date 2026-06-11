# Cortex

[Cortex](https://thehive-project.org/) provides observable analysis (reputation, sandbox detonation, whois, etc.) via its "analyzer" plugins. SocTalk's [`cortex_worker`](/ai-pipeline) node sends observables through Cortex during enrichment.

## Hosting model

The `soctalk-tenant` chart in V1 has no Cortex subchart (`dependencies: []`). The choices are:

- **Customer-managed Cortex** — customer runs their own; MSSP supplies URL + API key.
- **No Cortex** — the AI pipeline still attempts the `ENRICH` route (the supervisor doesn't know Cortex is missing); each `cortex_worker` invocation fails and the failure is logged. There is no per-observable status field in V1; the worker simply returns without enrichment and the supervisor moves on.

A "bundled Cortex subchart" was described in earlier drafts as a planned option but is **not implemented in this release**.

## Configure (MSSP UI)

Tenant detail → Settings → Cortex.

| Field | Notes |
|---|---|
| Enable | Off by default |
| URL | `https://cortex.<customer>.example` for customer-managed; `http://cortex.tenant-<slug>.svc:9001` for bundled |
| API key | Customer's Cortex API key with `analyze:any` |
| Verify TLS | Default on |
| Default TLP | Default `2` (Amber). Used when SocTalk submits observables that don't carry a TLP |

**There is no API to mutate Cortex integration settings in V1.** Cortex calls live in the **per-tenant runs-worker**, not the central API pod, so env vars on `soctalk-system-api` are ineffective. To configure Cortex in V1, set the env vars on the tenant's `soctalk-runs-worker` Deployment in `tenant-<slug>` namespace (`helm upgrade` of the tenant chart, or `kubectl set env` + `rollout restart`). Rotate the API key by patching the tenant-namespace Secret and rolling the runs-worker. A clean API-driven configuration surface is on the roadmap.

## Analyzer selection

For each observable, the worker tries the **first analyzer name** in a hard-coded `ANALYZER_MAP` (in [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) for the observable's type — without checking whether that analyzer is actually installed on the Cortex instance. If the analyzer isn't installed (or fails), the failure is logged and the worker returns without the enrichment. There is no fallback to a second analyzer in V1; install the canonical analyzer named in `ANALYZER_MAP` for each observable type you care about. Exposing the analyzer-preference order as a chart value is on the roadmap.

## Cost

Cortex itself is free; analyzer providers charge for queries. SocTalk doesn't meter Cortex calls directly — meter them at the provider:

- VirusTotal: per-key quota
- AbuseIPDB: per-key quota
- Hybrid Analysis: per-key quota

Per-tenant observable throughput is visible via `soctalk_tenant_events_ingested_total` (each ingested event triggers ~1–5 observable extractions) at [Observability](/observability#per-tenant-counters-defined-surface).

## Worker behaviour

The `cortex_worker` node has a hard-coded `ANALYZER_MAP` (in [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) that maps each observable type to a small list of analyzer names. For each observable, the worker submits to the **first** analyzer in that list without checking availability; if that analyzer isn't installed or fails, the observable's enrichment is recorded as failed.

Sequence:

1. Reads the case's current observable list from state.
2. For each observable, looks up the analyzer list in `ANALYZER_MAP` for its type.
3. Submits to the first mapped analyzer via Cortex's `/api/observable` endpoint.
4. Polls `/api/job/{id}/report` until the job finishes or a per-job timeout fires.
5. Appends the verdict (`safe`, `info`, `suspicious`, `malicious`) and report body to the case state. Failed jobs log the error and continue.

Failed Cortex calls don't fail the run — the worker logs the failure and returns to the supervisor without enrichment for that observable. The verdict node reasons about whatever context is available.

## Bundled Cortex: not in this release

The `soctalk-tenant` chart does not bundle Cortex as a subchart. Run Cortex yourself (customer-managed) if you want analyzer enrichment. SocTalk-managed Cortex is on the roadmap.

## Rotate the API key

1. Generate a new key in Cortex with `analyze:any`.
2. Patch the tenant-namespace Secret holding the Cortex creds and roll the runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revoke the old key in Cortex.

## What's not in here

- Custom analyzer development — out of scope; see [TheHive-Project/Cortex-Analyzers](https://github.com/TheHive-Project/Cortex-Analyzers).
- Per-observable TLP/PAP overrides — planned; today the tenant-default applies to every submission.

## Source pointers

| Concept | File |
|---|---|
| Worker node + ANALYZER_MAP | [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py) |
| Settings schema | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
