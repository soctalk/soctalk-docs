# CLI and scripts

Operators do most things through the [MSSP UI](/mssp-ui) or the [REST API](/reference/api). The CLI surface is small and exists for bootstrap, dev environments, and offline operations.

## In-pod entry points

These run inside `soctalk-system-api` (or a one-shot Job). They use the pod's mounted Postgres credentials and chart config — no external state.

### Bootstrap

There is no separate bootstrap CLI in this release — the chart's API pod init command runs the bootstrap inline (migrations, role passwords, organization row, optional admin user). See [Install — Migrations and bootstrap](/install#migrations-and-bootstrap-run-automatically).

### LLM smoke test

There is no `soctalk.llm.smoke_test` CLI in this release. To sanity-check that a configured LLM is reachable, see [LLM providers — Sanity test](/integrate/llm-providers#sanity-test) for the one-liner Python expression.

### `soctalk-auth` (in-pod helper)

The only first-class CLI helper in this release. Single subcommand: `set-password`.

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password user@example.com
```

Prompts for a new password (or reads from `SOCTALK_PASSWORD`), looks up the user, sets the hashed password, and audits `auth.password.reset.admin`. Useful for forced resets without going through the API. The user row must already exist; `soctalk-auth` does not create rows.

### `soctalk` (orchestrator entry point)

`soctalk` is the orchestrator entry point — runs the LangGraph supervisor + workers. In V1 the API pod embeds the orchestrator (no separate `soctalk-system-orchestrator` Deployment). Not typically invoked by hand outside of dev.

### No general-purpose `soctalk-cli` yet

The earlier draft of this page listed tenant management commands under a `soctalk-cli` binary that does not exist in the current release. Tenant actions (suspend, resume, decommission, rotate-admin) today go through the [REST API](/reference/api). The CLI surface for tenant operations is tracked for a future release.

## Repo-side: `justfile` recipes

[`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) in the repo root has recipes used during development and release:

| Recipe | What it does |
|---|---|
| `just build-api` | Build the API container image |
| `just build-orchestrator` | Build the orchestrator container image |
| `just build-frontend` | Build the SvelteKit frontend container image |
| `just build-mock-endpoint` | Build the mock endpoint sim image |
| `just run` | Run the dev stack via docker-compose |
| `just push-all` | Push all images to the configured registry |
| `just release` | Tag + push images + chart + create a GitHub Release |

## Repo-side: `scripts/`

| Script | Purpose |
|---|---|
| `scripts/dev-up.sh` | Bring up a single-node k3d dev cluster with SocTalk and a seeded tenant |
| `scripts/local-up.sh` | Same, but on the host's k3s instead of k3d |
| `scripts/local-down.sh` | Tear down a `local-up.sh` cluster |
| `scripts/e2e-l1-l2-k3d.sh` | Two-cluster k3d setup (MSSP L1 + tenant L2) for full e2e validation |
| `scripts/seed-mssp-demo-data.py` | Populate Postgres with fixture tenants (`acme-corp`, `wayne-industries`, `stark-defense`) and replay Wazuh alerts via the indexer for screenshot prep |
| `scripts/inject_test_data.py` | Inject specific test payloads — useful when reproducing a customer-reported bug |
| `scripts/verify-pages-visual.py` | Playwright visual regression check against the dev SocTalk UI |

These all expect to run from the repo root. Read the script header for the exact arguments.

## Repo-side: Packer

For VM image builds, see [Downloads → Build it yourself](/downloads#build-it-yourself).

## Air-gapped operations

For installs without internet access, the API + `soctalk-auth` are sufficient to run SocTalk without touching the UI:

```bash
# Bootstrap happens automatically in the API pod's init command — no
# extra step. Just install the chart with install.bootstrapAdmin.* set.

# Or, if those weren't supplied, set the admin password after install:
kubectl -n soctalk-system exec deploy/soctalk-system-api -- \
  soctalk-auth set-password admin@example
# Read the admin credentials.
kubectl -n soctalk-system get secret soctalk-system-bootstrap-admin \
  -o jsonpath='{.data.password}' | base64 -d; echo

# Onboard a tenant via the API.
curl -k -c jar -X POST http://soctalk-system-api:8000/api/auth/login \
  -d '{"email":"admin@example","password":"..."}'
curl -k -b jar -X POST http://soctalk-system-api:8000/api/mssp/tenants/onboard \
  -d '{"slug":"acme","display_name":"Acme","profile":"persistent"}'
```

For the bootstrap admin's existing password the bootstrap Job emits, see [Install → Migrations and bootstrap](/install#migrations-and-bootstrap-run-automatically).

## Source pointers

| Concept | File |
|---|---|
| Bootstrap (inline) | [`charts/soctalk-system/templates/30-api.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/30-api.yaml) (init command) |
| LLM provider factory | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| `soctalk-auth` source | [`src/soctalk/core/cli/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/cli/auth.py) |
| `soctalk` orchestrator entry | [`src/soctalk/main.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/main.py) |
| `justfile` | [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) |
| `scripts/` | [`scripts/`](https://github.com/soctalk/soctalk/tree/main/scripts) |
