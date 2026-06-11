# TheHive

[TheHive](https://thehive-project.org/) is opt-in. When configured per tenant, SocTalk exports `escalate`-disposition closures as TheHive cases. Investigation history (observables, AI rationale, human-review decision) becomes the case's first observable set and timeline.

For the mental model see [AI pipeline → Closure](/ai-pipeline). For decommissioning a tenant with TheHive enabled, see [Tenant lifecycle → Decommissioning](/tenant-lifecycle#decommission-vs-purge).

## Hosting model

In V1 the `soctalk-tenant` chart has no TheHive subchart (`dependencies: []`). The choices are:

- **Customer-managed TheHive** — the customer runs their own TheHive elsewhere; the MSSP supplies the URL and a per-tenant API key.
- **No TheHive** — escalations stay in the SocTalk UI only. Default.

A "bundled TheHive subchart" path was described in earlier drafts of this page as a planned option but is **not implemented in this release**. There is no SocTalk-managed Cassandra StatefulSet or TheHive Deployment for the tenant.

## Configure (MSSP UI)

Tenant detail → Settings → TheHive. Fields:

| Field | Notes |
|---|---|
| Enable | Off by default |
| URL | `https://thehive.<customer>.example` for customer-managed; `http://thehive.tenant-<slug>.svc:9000` for bundled |
| Organisation | TheHive organisation slug (multi-tenant TheHive instances) |
| API key | Customer's TheHive API key with `case:create`, `observable:create`, `task:create` |
| Verify TLS | Default on; turn off for self-signed dev TheHive |

**There is no API to mutate TheHive integration settings in V1.** The TheHive call lives in the **per-tenant runs-worker** (which holds MCP bindings), not in the central API pod, so setting `THEHIVE_*` env vars on `soctalk-system-api` has no effect on the worker. To configure TheHive in V1, set the env vars on the tenant's `soctalk-runs-worker` Deployment in `tenant-<slug>` namespace (and re-render via `helm upgrade` of the tenant chart, or `kubectl set env` followed by `rollout restart`). A clean API-driven configuration surface is on the roadmap.

## What gets exported

In V1, TheHive export happens **synchronously at graph-node time** via the `thehive_worker` node calling TheHive's API through MCP. Today this creates the case (title + severity mirrored from the SocTalk verdict) and the observables. The richer surface — tasks derived from `next_actions`, timeline mirroring of worker rationales / human review decisions, **asynchronous outbox + retry** — is described in earlier drafts as the design target but is **not implemented in this release**. If TheHive is unreachable, the worker node logs the failure and the case proceeds in SocTalk without an exported counterpart. There is no retry loop, no outbox, no persisted "last error" field, and no dashboard surface for failed exports — failures are visible only in the orchestrator's structured logs.

Observable type mapping (per the V1 implementation):

| SocTalk type | TheHive `dataType` |
|---|---|
| `ip` | `ip` |
| `fqdn` | `fqdn` |
| `url` | `url` |
| `hash_md5`, `hash_sha1`, `hash_sha256` | `hash` |
| `email` | `mail` |
| `filename` | `filename` |
| `user` | `other` (with `tags: user`) |
| `process` | `other` (with `tags: process`) |
| `registry_key` | `registry` |

## Bundled TheHive: not in this release

The `soctalk-tenant` chart in V1 does not bundle TheHive as a subchart — `Chart.yaml` lists `dependencies: []`. Operators who want a per-tenant TheHive instance run it themselves (manual `helm install` in the tenant namespace, or customer-managed elsewhere). A bundled subchart with chart-managed admin secrets is described in earlier drafts as the design target but is on the roadmap.

## Customer-managed TheHive: notes

- The customer's TheHive must be reachable from the SocTalk control plane (egress to the customer's TheHive URL).
- The customer creates the API key with the minimum scopes listed above. SocTalk does not need admin scope.
- If the customer's TheHive enforces source-IP allowlists, allowlist the SocTalk control plane's egress NAT IP.

## Status / health

In this release there is **no background health-ping loop** for TheHive — SocTalk only touches TheHive when an investigation has something to export. Failures during that call are logged in the orchestrator's structured output only; there is no persisted error field and no outbox-based retry. The MSSP UI does not surface a separate "TheHive reachable" indicator.

To monitor TheHive health, use your usual external probe (Prometheus blackbox exporter against TheHive's `/api/status`, etc.) — that's an MSSP-side responsibility, not part of SocTalk in this release.

## Rotate the API key

1. In the customer's TheHive, generate a new API key with the same scopes.
2. Patch the tenant-namespace Secret holding the TheHive creds and roll the runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revoke the old key in TheHive.

A live-reload path (watch the mounted Secret file) is planned.

## Source pointers

| Concept | File |
|---|---|
| TheHive worker / export | [`src/soctalk/workers/thehive.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/thehive.py) |
| Settings schema | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
| MCP tool bridge | [`src/soctalk/chat/mcp_tools.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/chat/mcp_tools.py) |
