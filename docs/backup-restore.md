# Backup and restore

What an MSSP backs up, how often, and how to restore. SocTalk holds three layers of state; each has its own backup and restore path.

This page expands on [Daily Operations — Database restore](/operations#database-restore-disaster-recovery), which is the same procedure documented at runbook level. Use this page to plan the strategy; use ops for the keystrokes.

## What to back up

### 1. Postgres (the control plane)

`soctalk-system-postgres-0` holds:

- Tenant rows + lifecycle events
- Users, sessions, roles
- Investigations, cases, runs, proposals
- Settings (LLM, integrations, branding)
- Append-only `audit_log` and event-sourced `case_events`
- Outbox rows pending executor consumption

**Loss tolerance: zero**. A lost Postgres = lost audit history, no recoverable investigations.

### 2. Kubernetes Secrets in `soctalk-system`

| Secret (chart-rendered name) | What's in it |
|---|---|
| `soctalk-system-llm-api-key` | LLM provider API key (install-wide default) |
| `soctalk-system-bootstrap-admin` | Initial admin email + password (if `install.bootstrapAdmin.password` set in values) |
| `soctalk-system-jwt-signing-key` | Session token signing key |
| `soctalk-system-adapter-signing-key` | Adapter-token signing key |
| `soctalk-system-postgres-admin-creds` | Postgres `soctalk_admin` (migrations) creds |
| `soctalk-system-postgres-app-creds` | Postgres `soctalk_app` (runtime) creds |
| `soctalk-system-postgres-mssp-creds` | Postgres `soctalk_mssp` (cross-tenant queries) creds |
| `soctalk-slack-creds` | Slack tokens (env-provided; not chart-rendered) |
| `soctalk-thehive-creds` | TheHive API key (env-provided) |
| `soctalk-cortex-creds` | Cortex API key (env-provided) |

A regenerated set of Secrets is recoverable, but in-flight sessions break and integration creds need re-pasting.

### 3. Per-tenant PVCs

For each `tenant-<slug>` namespace:

| PVC | What's in it |
|---|---|
| `wazuh-indexer-data` | All Wazuh alert and event history |
| `wazuh-manager-data` | Wazuh agent registrations + manager state |
| `cortex-data` | Cortex Elasticsearch (if Cortex enabled) |
| `thehive-data` | TheHive Cassandra (if TheHive enabled) |

`poc`-profile tenants use `local-path`, which **has no real persistence guarantee** — a node restart can lose data. `persistent`-profile tenants use whatever StorageClass the install marks default; back up according to that provisioner's documentation.

## Cadence

| Layer | Suggested cadence | Retention |
|---|---|---|
| Postgres logical backup (`pg_dump`) | daily | 30 days |
| Postgres WAL archiving | continuous | 7 days |
| Kubernetes Secrets snapshot | weekly + on every rotation | 90 days |
| Per-tenant PVCs | matches your customer SLA (typically daily for compliance work) | per-contract |

Compliance customers (PCI, HIPAA, SOC 2) often require longer retention. Treat the above as the floor.

## Postgres backup

### pg_dump (logical)

Runs against the live database, no downtime. Slower restore than physical backup but compresses well and is portable.

```bash
kubectl -n soctalk-system exec soctalk-system-postgres-0 -- \
  pg_dump -U soctalk_app -d soctalk -Fc -Z 9 \
  > soctalk-$(date +%Y%m%d).pgdump
```

Pipe to your usual offsite store (S3, GCS, Azure Blob).

### WAL archiving (point-in-time)

**Not wired through the chart in this release.** The `soctalk-system` chart does not expose a `postgres.archiveCommand` value, so PITR requires a Postgres deployment outside the chart's bundled StatefulSet. Two paths:

1. **Run Postgres externally** (managed RDS / Cloud SQL / Azure Database for PostgreSQL). Configure WAL archiving / PITR per the provider's docs. **Pointing the chart at an external Postgres is not wired through values in V1** — the chart hard-codes the bundled StatefulSet's connection details into the role-creds Secrets. Today this means either running your own helm overlay that patches the API Deployment's `DATABASE_URL` env, or modifying `soctalk-system-postgres-app-creds` / `-mssp-creds` / `-admin-creds` after install. A `postgres.external` values knob is on the roadmap.
2. **Sidecar archiver** in your own helm overlay (e.g., [`spilo`](https://github.com/zalando/spilo) or [`wal-g`](https://github.com/wal-g/wal-g) as a sidecar). Out of scope for the chart; runs as a separate Deployment that streams WAL to object storage.

Either way, the SocTalk side is unchanged — the data plane treats Postgres as an external dependency. Wiring a chart-side `archiveCommand` is tracked for a future release.

## Restore (Postgres)

See the [runbook](/operations#database-restore-disaster-recovery). Summary:

1. Scale API to zero so nothing is writing (the V1 chart bundles the orchestrator into the API pod — one Deployment).
2. `pg_restore` the dump (clean DB first).
3. If using WAL: replay WAL to the desired point-in-time.
4. Scale API back up.

After restore, the API pod (which embeds the orchestrator in the V1 chart) may need a kick to re-pick up pending runs:

```bash
kubectl -n soctalk-system rollout restart deploy soctalk-system-api
```

## Secrets backup

K8s Secrets are tedious to back up safely because of the secret material. Two patterns:

### Sealed Secrets (recommended)

Install [Bitnami sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) once per cluster. Convert your Secrets to `SealedSecret` resources; commit those to git. The cluster's controller decrypts them at install time. Loss of a Secret is recoverable from git.

### Velero with restic / kopia

[Velero](https://velero.io) backs up Kubernetes resources (including Secrets) plus PVCs to object storage. Use the [in-tree CSI snapshotter](https://velero.io/docs/main/csi/) for PVCs and standard resource backup for Secrets.

```bash
velero backup create soctalk-system-daily \
  --include-namespaces soctalk-system \
  --snapshot-volumes \
  --schedule "0 2 * * *"
```

## Per-tenant PVC backup

`persistent`-profile tenants use real StorageClass; use that provisioner's snapshot tools:

- **Longhorn**: built-in scheduled backups to S3
- **Rook/Ceph**: RBD snapshots or `cephfs-mirror`
- **CSI cloud volumes (EBS/Persistent Disk/Azure Disk)**: native snapshot APIs

For Velero users, `velero backup create tenant-<slug>-daily --include-namespaces tenant-<slug> --snapshot-volumes` covers both the PVCs and the K8s objects in one go.

## Per-tenant restore

1. Decommission the existing tenant (if any) — this deletes the namespace.
2. Restore the PVCs to a fresh namespace from the snapshot.
3. Onboard a tenant with the same slug and profile via `POST /api/mssp/tenants/onboard` — provisioning is idempotent on the namespace, so the Helm install will adopt the restored PVCs.
4. Verify Wazuh sees existing agents (no re-enrollment needed if PVC restore was clean).

If only the data plane is corrupted (not the SocTalk control plane), the simpler path is `helm rollback tenant-<slug>` then restore the PVCs in-place.

## Restore drill

Run a restore drill quarterly. Pick a non-prod cluster or a temporarily-quiesced tenant. Time-box at 4 h. Document what failed and update this page.

Common failures the drill catches:

- WAL gap (archiving fell behind during a node failure)
- Secrets that were rotated since the last backup
- StorageClass mismatch between cluster and snapshot
- Network policy blocking the restored pod from reaching the new Postgres

## What's not covered here

- Cluster-wide disaster recovery (control plane node loss, etc.) — that's Kubernetes operations, not SocTalk-specific. See your distribution's documentation.
- LLM provider credential recovery — out of scope; manage with your normal secret-rotation runbook.
- Customer-side endpoint backups — the customer's responsibility, not the MSSP's.
