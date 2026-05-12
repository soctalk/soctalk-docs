# Troubleshooting

Symptom → diagnostic → fix. Runbook for the most common failure modes.

| Symptom | First check | Fix |
|---|---|---|
| `helm install soctalk-system` fails in pre-install hook | `kubectl logs -n soctalk-system job/<release>-preinstall-check` | Install the missing cluster prereq (CNI, cert-manager, StorageClass) per the [Install](/install#cluster-prerequisites) guide |
| API pod `CrashLoopBackOff` on startup | `kubectl logs -n soctalk-system deploy/soctalk-system-api` | Most often: bad `DATABASE_URL` Secret, Postgres not ready yet, or Alembic migration failure. Check the Postgres pod first |
| `helm install` succeeds but MSSP UI returns 502 | Ingress controller logs; verify ingress Service `endpoints` populated | OIDC proxy not deployed or not injecting trusted headers. Check trusted-proxy CIDR |
| Tenant create returns 500 | API logs show `ProvisionError` | Usually `helm install tenant-*` failed. Check `helm status tenant-<slug>`. Namespace and resource-quota issues are most common |
| Tenant stuck `provisioning` > 15 min | `kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp` | See [Tenant stuck in provisioning](/operations#tenant-stuck-in-provisioning) in operations |
| Tenant goes `degraded` | Adapter logs in the tenant namespace | NetworkPolicy egress, adapter pod crash, or DNS misresolved |
| Cross-tenant data visible | Run isolation test suite | **P1 incident.** RLS is the last line of defense; a failure indicates an application bug or Postgres role misconfiguration |
| LLM calls failing for one tenant | Worker logs: look for 401/403 from the LLM provider | `tenant-<id>-llm` Secret `api_key` is empty or wrong. Rotate via the UI |
| Wazuh agent can't connect | Tenant's LB IP (or edge HAProxy IP+port) reachable from the agent host; DNS for `<slug>.soc.mssp.*` resolves to it; 1514/1515 open through any intermediate firewall | See [Wazuh Ingress](/reference/wazuh-ingress). 1514 is Wazuh's proprietary protocol — there is no SNI to inspect; routing is by destination address or port. Verify the tenant's `Service` (`type: LoadBalancer` or the HAProxy port) is the address the agent is targeting |
| Postgres StatefulSet won't start (PVC Pending) | `kubectl describe pvc -n soctalk-system` | No default StorageClass, the class doesn't support RWO, or the cluster is out of disk |
| `PolicyViolation` messages from ingress controller | NetworkPolicy allow rules | Make sure the ingress namespace is labeled `kubernetes.io/metadata.name=ingress-system` |
| Cilium Hubble shows DROPPED flows between tenant and `soctalk-system` | NetworkPolicies + Cilium identities | Adapter egress policy missing or wrong `namespaceSelector` |
| Customer user login returns 403 on `/api/tenant/*` | JWT claims | Ensure the user row has `tenant_id` set and `role=customer_viewer` |
| MSSP user impersonation not showing in customer audit | Audit query | Verify `acting_as` column populated on write; the customer audit view joins on `tenant_id = own AND acting_as IS NOT NULL` |
| Isolation test fails in CI (FORCE RLS admin can see rows) | Migration applied? | Re-run `alembic upgrade head`; ensure `FORCE ROW LEVEL SECURITY` applied to every tenant-scoped table |

## Collecting diagnostic bundles

When escalating to support, collect:

```bash
# SocTalk system-level state
kubectl get all,events,networkpolicies,resourcequotas \
  -n soctalk-system -o yaml > soctalk-system.yaml
kubectl -n soctalk-system logs deploy/soctalk-system-api --tail=500 > api.log
kubectl -n soctalk-system logs deploy/soctalk-system-orchestrator --tail=500 > orch.log

# Specific tenant
kubectl get all,events,networkpolicies,resourcequotas,limitranges \
  -n tenant-<slug> -o yaml > tenant.yaml
kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=500 > adapter.log

# Helm state
helm status -n soctalk-system soctalk-system > helm-system.txt
helm status -n tenant-<slug> tenant-<slug> > helm-tenant.txt

# SocTalk version + lifecycle events for the tenant
soctalk-cli debug-bundle --tenant <slug> > bundle.json

tar czf soctalk-debug-$(date +%s).tgz *.yaml *.log *.txt bundle.json
```

**Review the tarball for customer data before sharing externally.** Logs may contain alert excerpts.
