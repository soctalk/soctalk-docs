# Upgrades

Both chart classes upgrade via `helm upgrade`. Today this is a runbook; a fleet-wide upgrade API is on the roadmap.

## Pre-flight checklist

Before any upgrade:

1. **Read the release notes** for the target version. Migrations are forward-only; a surprise schema change cannot be reverted with `helm rollback`.
2. **Verify the compatibility matrix.** MSSP UI → System → Versions shows which `soctalk-tenant` versions are supported by the target `soctalk-system`. Upgrade `soctalk-system` first, then tenants.
3. **Back up.** Snapshot Postgres + all tenant PVCs. See the [database restore section](/operations#database-restore-disaster-recovery) in operations.
4. **Dry-run** with `helm diff`:
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## Upgrade `soctalk-system` (install-level)

Order matters: migrations must finish before the new API pods are gated on readiness. The API pod only has the `soctalk_app` role and never runs migrations; if it starts against an old schema with new code, readiness fails and `helm upgrade --wait` hangs. Run the Alembic Job first, then upgrade the chart.

`soctalk-system-values.yaml` from the install pins `image.tag` to the original release (e.g. `"0.1.0"`). Override that on each upgrade so the new chart actually renders the new image. Either bump the file in version control, or pass `--set image.tag=<new-version>` on every command below.

```bash
# 1. Delete any previous Alembic Job so a new Pod can spawn.
kubectl -n soctalk-system delete job soctalk-system-alembic-upgrade \
  --ignore-not-found

# 2. Render and apply the Alembic Job at the target chart + image version.
helm template soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --show-only templates/jobs/alembic-upgrade.yaml \
  | kubectl apply -n soctalk-system -f -

# 3. Wait for migrations to complete.
kubectl -n soctalk-system wait --for=condition=complete \
  job/soctalk-system-alembic-upgrade --timeout=10m
kubectl -n soctalk-system logs job/soctalk-system-alembic-upgrade

# 4. Now run the chart upgrade. The new API image starts against the
#    already-migrated schema, so --wait can succeed.
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 10m
```

If the release notes confirm no schema changes, steps 1–3 still work (Alembic no-ops at head); you can also skip them and go straight to step 4.

### Rollback

```bash
helm rollback soctalk-system <revision> -n soctalk-system --wait
```

If the upgrade introduced a migration that touched data, `helm rollback` will not revert the schema. Restore Postgres from the pre-upgrade backup in addition.

## Upgrade a single tenant's data plane

```bash
helm upgrade tenant-<slug> oci://ghcr.io/soctalk/charts/soctalk-tenant \
  --version <new-tenant-chart-version> \
  --namespace tenant-<slug> \
  -f /tmp/tenant-<slug>-values.yaml \
  --wait --timeout 15m
```

`/tmp/tenant-<slug>-values.yaml` is the SocTalk-rendered values file. Retrieve it from the SocTalk API or regenerate:

```bash
soctalk-cli render-values --tenant <slug> > /tmp/tenant-<slug>-values.yaml
```

### Per-tenant rollback

```bash
helm rollback tenant-<slug> <revision> -n tenant-<slug> --wait
```

Tenant data plane rollbacks are safer than system-level ones: the OSS stacks (Wazuh, TheHive, Cortex) store their own data in PVCs that `helm rollback` leaves untouched.

## Fleet upgrade (manual loop)

```bash
# List tenants.
kubectl get ns -l tenant=true,managed-by=soctalk \
  -o jsonpath='{.items[*].metadata.name}'

# Upgrade each, pausing between.
for ns in tenant-acme tenant-beta tenant-gamma; do
  echo "upgrading $ns..."
  helm upgrade ${ns} oci://ghcr.io/soctalk/charts/soctalk-tenant \
    --version <new> -n $ns -f /tmp/${ns}-values.yaml --wait --timeout 15m
  kubectl -n $ns rollout status deploy/soctalk-adapter
  sleep 60   # let heartbeat settle before next.
done
```

A future release replaces this loop with a canary-aware fleet-upgrade API.

## Upgrade ordering

1. Cluster prereqs (CNI, cert-manager, ingress). Update these independently.
2. The `soctalk-system` chart. Runs migrations as part of the install-level upgrade.
3. The `soctalk-tenant` chart, one tenant at a time, watching for regressions.

Never upgrade tenant charts ahead of `soctalk-system`. The compatibility matrix rejects out-of-range combinations and the API refuses to provision new tenants on mismatched versions.

## Breaking-change tenant chart upgrades

If the tenant chart bumps a Wazuh, TheHive, or Cortex major version with a schema change:

1. Snapshot tenant PVCs first.
2. Upgrade in a low-traffic window.
3. Verify alerts flow end-to-end immediately afterwards.
4. Be prepared to `helm rollback` plus restore PVCs if the data plane's schema-migration process fails.

Upstream OSS projects occasionally ship breaking changes. The [chart audit](/reference/chart-audit) pins exact subchart versions; bumping those versions is explicit and tested before release.
