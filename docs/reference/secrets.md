# Secret Placement Policy

> **V1 deployment note.** Several entries below reference "orchestrator pods" as a distinct workload — in the V1 chart the orchestrator is co-located in the `soctalk-system-api` Deployment, so references to "orchestrator pod" mean "API pod" in this release. Specific K8s Secret names may also vary slightly from the chart's rendered names (see [`charts/soctalk-system/templates/60-secrets.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/60-secrets.yaml) for the source of truth).

## Invariant (aspirational)

**Target:** no raw secret material in the SocTalk database. Postgres tables that track secrets store references only: `(namespace, name, version_label)`. The material itself is in a Kubernetes `Secret` object, mounted into the pod that needs it.

**Today (V1):** there is **one documented exception** — `IntegrationConfig.llm_api_key_plain` in the database stores per-tenant LLM API keys in plaintext. This is required because the runs-worker reads the key from its tenant context at investigation pickup time and the V1 chart doesn't yet wire per-tenant LLM Secrets through the pod spec. Treat the Postgres credentials as protecting these keys, and rotate the LLM provider keys as if they were exposed if the DB credential rotates.

Other secret categories — JWT signing, Postgres roles, integration credentials, Wazuh authd — all live in K8s Secrets and are referenced by name from the DB, not stored inline. The architecture goals (below) describe the destination state for all secret classes:

- Limits blast radius of a SocTalk DB compromise (no material leaks).
- Lets K8s-native rotation mechanisms work (Secret update → pod picks up new value on remount or on next Secret read).
- Aligns with External Secrets Operator integration path in a future release.

## V1 Secret inventory (what the chart actually renders today)

| Secret | Material | Location | Accessed by | Rotation |
|---|---|---|---|---|
| `soctalk-system-postgres-admin-creds` | user/pw | `soctalk-system` ns | API pod `db-init` container only (migrations + bootstrap) | Manual |
| `soctalk-system-postgres-app-creds` | user/pw | `soctalk-system` ns | API pod (runtime, RLS-subject) | Manual |
| `soctalk-system-postgres-mssp-creds` | user/pw | `soctalk-system` ns | API pod (`system_context()` cross-tenant queries) | Manual |
| `soctalk-system-jwt-signing-key` | HMAC secret | `soctalk-system` ns | API pod | Manual |
| `soctalk-system-adapter-signing-key` | HMAC key | `soctalk-system` ns | API pod (mints per-tenant adapter tokens) | Manual |
| `soctalk-system-bootstrap-admin` | email + password | `soctalk-system` ns | API pod `db-init` container only | Manual |
| `soctalk-system-llm-api-key` | provider API keys (anthropic-api-key + openai-api-key) | `soctalk-system` ns | API pod (install-wide default) | Manual |
| `adapter-token` | bearer token | `tenant-<slug>` ns | Tenant adapter pod | Minted on provisioning; rotation via re-provisioning |
| `runs-worker-token` | bearer token | `tenant-<slug>` ns | Tenant runs-worker pod (calls `/api/internal/worker/runs/*`) | Same as above |
| `tenant-llm-key` | LLM API key | `tenant-<slug>` ns | Tenant runs-worker pod (mounted via `secretKeyRef`) | MSSP-initiated via `PATCH /api/mssp/tenants/{id}/llm`; controller materializes from `IntegrationConfig.llm_api_key_plain` + restarts runs-worker |
| `tenant-<id>-llm` | LLM API key (legacy / audit copy) | `soctalk-system` ns | Not mounted by any V1 pod | Same as above; this copy is written for audit but is **not the authoritative source** the runs-worker reads |
| `wazuh-authd-secret` | shared secret | `tenant-<slug>` ns | Wazuh manager (enrollment) | Regenerate to force re-enrollment of all agents |
| `wazuh-<slug>-wazuh-creds` | user/pw | `tenant-<slug>` ns | Wazuh manager + linux-ep pods (agent enrollment) | Generated at provisioning |

**Triage executes in `soctalk-runs-worker` in each `tenant-<slug>` namespace** (not in the central API pod). That's why per-tenant secrets are mounted into the tenant namespace, not into `soctalk-system`.

The LLM API key is **also stored in plaintext in `IntegrationConfig.llm_api_key_plain`** in Postgres — see the invariant disclaimer above. The K8s Secret is materialized from the DB value at provisioning / rotation time.

Stale items from earlier drafts (now removed): `tenant-<id>-wazuh`, `tenant-<id>-thehive`, `tenant-<id>-cortex`, `wazuh-bootstrap`, `thehive-bootstrap`, `cortex-bootstrap`, `cassandra-creds`, `soctalk-license`. `tenant-<id>-llm` in `soctalk-system` still exists in V1 as a legacy/audit copy, but it is **not** what the runs-worker reads. The architecture section below describes the design rationale; only the inventory above is current.

## Per-tenant LLM key placement

Triage executes in the per-tenant `soctalk-runs-worker` pod (in `tenant-<slug>` namespace), **not** in the central API pod. That's why per-tenant LLM keys live in the tenant namespace:

- **Authoritative store:** `IntegrationConfig.llm_api_key_plain` in Postgres.
- **Mounted source:** `Secret/tenant-llm-key` in `tenant-<slug>`, materialized by the controller from the DB value.
- **On rotation (`PATCH /api/mssp/tenants/{id}/llm`):** controller rewrites the tenant-namespace Secret and restarts `Deployment/soctalk-runs-worker` so the new key takes effect on the next investigation claim.

`Secret/tenant-<id>-llm` in `soctalk-system` namespace also exists as a legacy / audit copy from earlier design iterations, but is **not** mounted by any V1 pod. There is no cross-namespace Secret mount in V1.

The alternative (per-tenant ns for each tenant's LLM key) is re-evaluated in a future release with External Secrets Operator, where ESO can sync external-vault-stored secrets into whichever namespace needs them.

## Data plane bootstrap secrets

Wazuh/TheHive/Cortex admin credentials live in their respective tenant namespaces because:

- These pods need them at startup (init containers, first-run setup).
- Cross-ns mounting complications as above.
- Blast radius of namespace compromise already exposes the pods themselves; putting the bootstrap secret in the same namespace doesn't add risk.

Bootstrap secrets are generated by the SocTalk controller at tenant-provisioning time:
1. Controller generates random values (e.g., `openssl rand -hex 32`).
2. Controller creates `Secret` in target `tenant-<slug>` ns.
3. Controller records the reference `(tenant-<slug>, wazuh-bootstrap, v1)` in `TenantSecret` table.
4. Controller renders tenant chart values referencing the Secret by name.
5. `helm install` proceeds; data plane pods read creds at startup.

If the material is lost (e.g., Secret deleted), re-provisioning regenerates new credentials. Data plane pods restart; any dependent services reinitialize. Customer-endpoint agents (which rely on the Wazuh enrollment secret) need re-enrollment if that specific secret rotates: documented in the ops runbook.

## Secret generation conventions

At tenant-provisioning time, SocTalk controller generates:

```python
import secrets

# Administrative passwords: 32-char high-entropy
wazuh_admin_pw = secrets.token_urlsafe(32)
thehive_admin_pw = secrets.token_urlsafe(32)
cortex_admin_pw = secrets.token_urlsafe(32)

# Enrollment shared secret: 48-char
wazuh_authd = secrets.token_urlsafe(48)

# API tokens (for SocTalk → data plane): 48-char
thehive_api_token = secrets.token_urlsafe(48)
cortex_api_key = secrets.token_urlsafe(48)

# Cassandra: 32-char
cassandra_pw = secrets.token_urlsafe(32)
```

SocTalk stores references and version labels; it does not keep the material in memory beyond the provisioning call.

## Rotation (V1 reality)

1. **Per-tenant LLM key rotation** (MSSP initiates via `PATCH /api/mssp/tenants/{id}/llm`):
   - Authoritative store updated in Postgres (`IntegrationConfig.llm_api_key_plain`).
   - Controller rewrites `Secret/tenant-llm-key` in `tenant-<slug>` (not the system namespace).
   - Controller restarts `Deployment/soctalk-runs-worker` in the tenant namespace so the new key takes effect on the next claim. **Pod restart is required** — V1 does not reload secrets at runtime.

2. **Wazuh / TheHive / Cortex admin credential rotation** (manual, runbook):
   - `kubectl patch secret <name> -n tenant-<slug> ...` to rewrite the credential.
   - `kubectl rollout restart` the affected workload so it re-reads.
   - A wrapper CLI for this (`soctalk-cli rotate-admin`) was documented in earlier drafts but is **not implemented** in V1.

3. **Postgres credentials rotation** (manual, runbook):
   - `ALTER ROLE soctalk_app WITH PASSWORD ...` in Postgres.
   - `kubectl patch secret soctalk-system-postgres-app-creds ...` (mind the chart-rendered name).
   - `kubectl rollout restart deploy soctalk-system-api` — there is no separate orchestrator pod in V1 (the orchestrator is co-located in the API pod).

4. **JWT signing key rotation** (a future release): zero-downtime rotation requires supporting two valid keys during transition. This release defers this; manual rotation forces a window where all users re-auth.

## Access control

Kubernetes RBAC restricts which ServiceAccounts can read which Secrets:

- `soctalk-system-api` SA in `soctalk-system`: can read Secrets in `soctalk-system` (Postgres creds, JWT/adapter signing keys). Also bound to write Secrets in `tenant-*` namespaces (needed to create/rotate tenant bootstrap secrets) — the V1 chart consolidates the API + controller roles into this SA.
- Per-tenant `ServiceAccount` in `tenant-<slug>`: can read only secrets in its own namespace. It can read its own `adapter-token` / `runs-worker-token` / `tenant-llm-key`, but never the system signing key.
- The `soctalk-orchestrator-sa` from earlier drafts does not exist in V1 — the orchestrator runs inside the API pod under the API SA.

`Role`/`RoleBinding` templates are part of `soctalk-system` chart (for SocTalk SAs) and `soctalk-tenant` chart (for per-tenant SAs).

## Anti-patterns explicitly rejected

- **Env-var secret injection from `.env` file** (current V0 pattern): fine for single-org, not for multi-tenant. All secrets move to K8s Secrets.
- **Secrets in Helm values.yaml**: never: values files end up in Git, CI logs, Helm history. SocTalk controller renders Secret objects separately and uses `valueFrom.secretKeyRef` in templates.
- **Single shared LLM key for all tenants**: explicitly out-of-scope for BYO LLM. Per-tenant keys always.
- **Secrets in ConfigMaps**: prohibited. ConfigMaps are for non-sensitive config; Secrets for sensitive.

## External Secrets Operator (a future release path)

a future release introduces External Secrets Operator integration:

- MSSP provides a secret backend (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
- `ExternalSecret` resources reference backend paths; ESO syncs to K8s Secrets.
- Per-tenant LLM keys stored in backend with paths like `secret/mssp-abc/tenants/acme/llm`.
- Rotation done in backend; ESO propagates within refresh interval.

The structure (refs in Postgres → K8s Secret → mount) is compatible: only the Secret source changes (ESO-managed vs SocTalk-controller-written).

