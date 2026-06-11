# Upgrades

Both chart classes upgrade via `helm upgrade`. Today this is a runbook; a fleet-wide upgrade API is on the roadmap.

## Pre-flight checklist

Before any upgrade:

1. **Read the [release notes](https://github.com/soctalk/soctalk/releases)** for the target version. Migrations are forward-only; a surprise schema change cannot be reverted with `helm rollback`.
2. **Upgrade `soctalk-system` before tenants.** A formal compatibility-matrix surface (System → Versions UI, `controller.can_upgrade` validation) is described in [Chart Contract](/reference/chart-contract) as the architectural target but is **not implemented in this release**. Until it ships, follow the release notes' "tested combinations" line, upgrade `soctalk-system` first, then bump each tenant once you've verified the system-side upgrade.
3. **Back up.** Snapshot Postgres + all tenant PVCs. See the [database restore section](/operations#database-restore-disaster-recovery) in operations.
4. **Dry-run** with `helm diff`:
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## Upgrade `soctalk-system` (install-level)

`soctalk-system-values.yaml` from the install pins `image.tag` to the original release. Override on each upgrade so the new chart renders the new image. Either bump the file in version control, or pass `--set image.tag=<new-version>` on every command below.

Migrations run inside the API pod's init command (see [Install → Migrations and bootstrap](/install#migrations-and-bootstrap-run-automatically)). A `helm upgrade` rolls the API pod; the init command runs `alembic upgrade head` before the new app starts. Alembic is idempotent — re-running on a current schema is a no-op.

```bash
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 15m
```

Watch the migration:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

If `--wait` hangs, the most common cause is a migration failure — read the init logs.

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

`/tmp/tenant-<slug>-values.yaml` is the SocTalk-rendered values file. Today there is no operator-facing CLI to dump it; pull the last-rendered values from the tenant's Helm release secret:

```bash
helm get values tenant-<slug> -n tenant-<slug> -a > /tmp/tenant-<slug>-values.yaml
```

A `soctalk-cli render-values` command was previously mentioned in this guide but does not exist — the only CLI tool today is `soctalk-auth`.

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
