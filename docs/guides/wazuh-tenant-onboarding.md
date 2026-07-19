---
description: "Wazuh MSSP customer onboarding, end to end: provision an isolated tenant SOC, enroll agents, hand out access, and baseline the first week."
---

# Onboarding a customer tenant to a multi-tenant Wazuh SOC: an MSSP checklist

"Onboarding" a customer to a multi-tenant Wazuh service breaks into four jobs: provisioning an isolated per-customer stack, enrolling the customer's agents into *their* manager and nobody else's, handing out access that respects the MSSP/customer boundary, and baselining the first week of operations. This guide walks the whole path on SocTalk, where each customer gets a dedicated Wazuh manager, indexer, and dashboard in its own Kubernetes namespace behind one MSSP control plane.

## Decisions to make before you click New Tenant

**Profile.** The profile is fixed at onboard time; switching later means decommission and recreate. Decide first:

- `poc`: evaluations and short-lived pilots. `local-path` storage with no real persistence guarantee, low resource requests, no backup hooks. This is also the **default if you don't specify one**; `local-path` storage carries no persistence guarantee, so production customers need `persistent`.
- `persistent`: production customer SOCs. Uses your install's default StorageClass, production-sized requests, backup hooks honored if configured.
- `provided`: the customer already runs Wazuh (BYO-SIEM). SocTalk installs only its adapter and runs-worker in the tenant namespace and reaches the customer's indexer (`:9200`) and Manager API (`:55000`) over the network. The external connection material *and* per-tenant LLM credentials are required at onboard time; the API returns 422 if they're missing.

**Sizing.** Plan roughly 6–8 GB RAM and ~1.5 vCPU per `persistent` tenant; the per-tenant Wazuh indexer is usually the bottleneck and drives disk (50 GB PVC default, 30-day hot retention, no hot→cold tiering yet). SocTalk is tested to ~50 tenants on a 3-node cluster of 16 vCPU / 64 GB nodes; treat anything beyond ~5 tenants on a single host as unvalidated. Details in [Sizing](/reference/sizing).

**LLM per tenant.** Triage runs on a per-tenant LLM configuration: Anthropic or any OpenAI-compatible endpoint (Azure OpenAI, vLLM, Ollama, LiteLLM). A customer can bring their own API key for billing isolation. The key is mounted as a Kubernetes Secret in their namespace, with the documented V1 caveat that it is also held in plaintext in the SocTalk database ([Secrets](/reference/secrets)). Alternatively, you can point the tenant at a fully local Ollama endpoint for a no-cloud, no-per-token-cost posture (budget for slow CPU inference). See [LLM providers](/integrate/llm-providers).

## Provisioning: the nine ordered phases

Create the tenant from the [MSSP UI](/mssp-ui) (Tenants → **+ New Tenant**) or the API. The tenant enters a server-enforced state machine, `pending → provisioning → active`, with `degraded`, `suspended`, `decommissioning`, `archived`, and `purged` beyond that. Invalid transitions are rejected with a 409.

The controller runs nine ordered, idempotent phases, each emitting a lifecycle event you can watch on the tenant detail page: preflight checks, per-tenant secret minting (`authd`, JWT, Postgres), namespace creation (`tenant-<slug>` with labels, ResourceQuota, and LimitRange scoped to the profile), secret application, the `soctalk-tenant` Helm install (which also auto-provisions the `tenant_admin` user), the Wazuh chart install, a readiness poll, integration-config write, and the transition to `active`.

If a phase fails, the tenant lands in `degraded` with the failing step captured in the event row. Fix the cause (stuck PVC, undersized quota, image pull) and hit **Retry Provisioning**. Retry resumes from phase 1, and every phase is idempotent, so re-runs are safe. Retry is only valid *from* `degraded`, not from `pending`. Runbooks for stuck states are in [Daily Operations](/operations).

## Agent enrollment: getting endpoints into the right tenant

Each tenant gets a dedicated DNS name (`acme.soc.mssp.example.com`) resolving to a per-tenant L4 endpoint for 1514/TCP (events) and 1515/TCP (enrollment). Routing is by destination address rather than SNI, since Wazuh's 1514 agent protocol isn't standard TLS and never presents a ClientHello.

**V1 caveat:** the chart creates the Wazuh manager Service as `ClusterIP` only. There is **no automatic LoadBalancer or DNS provisioning in this release**. You wire the edge yourself: a per-tenant LoadBalancer Service you apply manually, an edge HAProxy with per-tenant port pairs at a single IP, or a mesh-VPN path. DNS records are likewise operator-managed.

Enrollment itself is tenant-scoped by design. Retrieve the tenant's `authd` shared secret:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Hand the hostname, ports, and secret to the customer's endpoint admin over a secure channel; they run `agent-auth -m <hostname> -P "<secret>"`. An agent holding tenant A's secret can only register with tenant A's manager. A dedicated Agents tab and Agent Onboarding panel are on the roadmap; today, verify agents in the embedded Wazuh dashboard (Tenants → **Open SOC** → Agents). Full topology and firewall requirements: [Wazuh agent ingress](/reference/wazuh-ingress).

## People: who gets a login

Provisioning already minted a `tenant_admin`. That role is self-service: it manages its own org's users and its own LLM settings from the customer portal. For stakeholders who need visibility but should never act, assign `customer_viewer`: read-only dashboards and investigations, no review queue, no chat.

Every created user receives a one-time temporary password, shown once and forced to change on first sign-in. An audience wall separates the two sides: tenant roles can never hold MSSP capabilities and vice versa, enforced at the capability guard, so a customer login structurally cannot reach cross-tenant surfaces. There is no self-service forgot-password flow in this release; resets are admin-forced. Full catalog: [Users and roles](/users-and-roles).

## The first week

- **Heartbeat.** Watch `soctalk_tenant_adapter_heartbeat_age_seconds` on `/metrics`. In V1 it's the one actively updated gauge, and it does *not* auto-degrade tenant state, so alert on it yourself.
- **Review queue.** New tenants generate review traffic while baselines settle; every AI escalation waits on a human in the dashboard queue; there is no auto-approve bypass.
- **Engagement windows.** If the customer has a pentest scheduled, declare the engagement window (source, host, technique, time) before it starts so sanctioned activity is flagged and audited rather than escalated. Out-of-scope tester activity still forces a human look.
- **Suspend/decommission basics.** Suspend flips DB state and stops new investigations but does **not** scale workloads; the emergency cut-off is a manual runbook. Decommission tears down the data plane and keeps the tenant row plus audit history in `archived`; there is no `:purge` API endpoint yet.

## Onboarding checklist

- [ ] Profile chosen (`persistent` for production; `provided` needs SIEM URLs + LLM creds up front)
- [ ] Cluster headroom checked (~6–8 GB RAM, ~1.5 vCPU per `persistent` tenant)
- [ ] Per-tenant LLM decided (BYO key / install default / local Ollama)
- [ ] Tenant created; lifecycle events reached `active`
- [ ] Edge wired manually: LB or edge-proxy endpoint + DNS record for `<slug>.soc.<domain>`
- [ ] `authd` secret retrieved and shared over a secure channel
- [ ] First agent enrolled and visible in the tenant's Wazuh dashboard
- [ ] `tenant_admin` handed off; `customer_viewer` accounts created as needed
- [ ] Heartbeat alerting on `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Any scheduled pentest declared as an engagement window

## Go deeper

- [Tenant lifecycle](/tenant-lifecycle): state machine, phases, recovery paths
- [Wazuh agent ingress](/reference/wazuh-ingress): edge topologies, certs, revocation
- [Users and roles](/users-and-roles): the full role catalog and audience wall
- [Daily operations](/operations): the runbook side of everything above
- [Launchpad](/launchpad): rehearse this whole flow in a ~15–25 minute multi-VM pilot
