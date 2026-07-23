---
description: "Onboard a customer tenant end to end in SocTalk: choose a profile, run the Create Customer wizard, watch provisioning reach active, connect the customer's endpoints, and hand off access."
---

# Onboard a tenant

Onboarding turns a customer into an isolated tenant SOC on your control plane. Each tenant gets its own Kubernetes namespace (`tenant-<slug>`) with its own secrets, resource budget, and (for the `poc` and `persistent` profiles) a dedicated Wazuh manager, indexer, and dashboard. This page walks the full path an MSSP admin follows in the UI, from the first decision to the moment the customer's analysts can open their SOC.

For the conceptual overview (sizing, the four jobs, first-week baselining) see the [onboarding checklist guide](/guides/wazuh-tenant-onboarding). For the state machine and profile internals see [Tenant lifecycle](/tenant-lifecycle). This page is the operator walkthrough.

## Before you start

- Your control plane is installed and you can sign in as an MSSP admin. If it is not up yet, follow [Production install](/install) or the [demo VM quickstart](/quickstart-vm) first.
- You have decided the tenant's profile. It is fixed for the tenant's lifetime, so read the next section before you click **New tenant**.
- For a `provided` tenant only, collect the customer's existing Wazuh connection material out of band before you open the wizard: the Indexer URL with a Basic-auth user and password, the Manager API URL with a user and password, and the per-tenant LLM credentials. The wizard blocks on these, so gathering them first avoids parking a half-filled form. See [Coordinating external Wazuh creds](/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Choose a profile

The profile is chosen once and fixed. Switching later means decommission and re-onboard, so pick deliberately.

- **`poc`** is for evaluations and short-lived pilots. The tenant chart installs Wazuh plus a linux-ep simulator with `local-path` storage and tight resource budgets. This is also the default if you do not specify one, and `local-path` carries no persistence guarantee, so it is the wrong choice for a real customer.
- **`persistent`** is for production customer SOCs. Same Wazuh-included shape as `poc`, but sized for sustained load on the cluster's default StorageClass with full chart resource ranges and backup hooks honored where configured.
- **`provided`** is for a customer who already runs Wazuh (bring your own SIEM). The chart installs only the SocTalk adapter and runs-worker; SocTalk reaches the customer's indexer and Manager API over the network. The external connection material and per-tenant LLM credentials are required at onboard time.

Plan roughly 6 to 8 GB of RAM and about 1.5 vCPU per `persistent` tenant; the per-tenant Wazuh indexer is usually the bottleneck. Capacity details are in [Sizing](/reference/sizing), and each profile is expanded in [Tenant lifecycle](/tenant-lifecycle#profiles).

## Run the Create Customer wizard

In the MSSP dashboard, click **Tenants** in the left rail, then **New tenant** at the top of the list. This opens the **Create Customer** wizard. It is four steps for `poc` and `persistent` (Identity, Profile, Branding, Review) and five for `provided`, where an External SIEM step appears between Profile and Branding.

### Step 1: Identity

- **Display name**, for example `Acme Corp`.
- **Slug**: short, lowercase, dash-separated, 3 to 32 characters, validated against `[a-z0-9-]+`. The slug becomes the `tenant-<slug>` namespace and is substituted into downstream identifiers, so choose it carefully. In a tailnet pilot it must match the tenant's Tailscale tag.
- **Contact email**.

### Step 2: Profile

Pick one of `poc`, `persistent`, or `provided`. The same step carries an **LLM (advanced)** disclosure for overriding the install-shared LLM provider, base URL, key, and optionally the Fast and Thinking model IDs. Leave it collapsed on `poc` and `persistent` to inherit the install defaults. On `provided` the LLM credentials are required and gate the step, because there is no install-shared fallback for that profile.

Changing the profile after provisioning requires decommissioning and re-onboarding, so confirm the choice before you continue.

### Step 3: External SIEM (provided only)

This step is hidden unless you picked `provided`. Fill in two endpoint and credential pairs:

- **Wazuh Indexer URL**, for example `https://wazuh.acme.example:9200`, with the indexer user and password used for Basic auth.
- **Wazuh Manager API URL**, for example `https://wazuh.acme.example:55000`, with the API user and password used to mint JWTs.

Both must be reachable from the tenant VM. The controller turns the URLs into a Cilium FQDN egress allow-list on the tenant namespace; the adapter never reaches Wazuh directly from the MSSP cluster. Sanity-check the manager credentials before you submit:

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (a long base64 string)
```

If that returns a token, the tenant's chat tools will resolve once the tenant data plane is up.

### Step 4 (or 3 for poc and persistent): Branding

Optional. A display name and a small logo that surface in the tenant header. You can skip this step entirely.

### Final step: Review

Confirm everything and click **Create**. The API responds `202` and returns you to the tenants list. The new tenant starts in `pending` and moves through `provisioning` toward `active`.

## Watch provisioning reach active

Open the tenant detail page and refresh it to follow the **Lifecycle Events** table. The controller runs nine ordered, idempotent phases, each emitting one event:

1. `preflight_ok`: cluster prerequisites and naming conflicts pass.
2. `secrets_minted`: per-tenant secrets generated (`authd`, JWT signing, Postgres).
3. `namespace_ready`: `tenant-<slug>` created with labels, ResourceQuota, and LimitRange.
4. `secrets_applied`: secrets pushed into the namespace as Kubernetes Secret objects.
5. `helm_applied` (tenant chart): the `soctalk-tenant` chart installs the adapter, runs-worker, and ingress. The `tenant_admin` user is auto-provisioned as part of this step.
6. `helm_applied` (Wazuh chart): the standalone Wazuh chart installs the manager, indexer, and dashboard. The event payload identifies which chart was applied. This phase does not run for `provided` tenants.
7. `workloads_ready`: all data-plane pods report Ready.
8. `integration_config_written`: per-tenant integration configs (LLM, TheHive URLs) written to the database.
9. `active`: the tenant transitions to `active` and is ready to use.

When the tenant reaches `active`, use **Open SOC** from the tenants list to enter its dashboard.

If it stalls, the failing phase is named in the events table:

- **Stuck in `pending`**: the controller was rescheduled before phase 1. Retry is not allowed directly from `pending`; wait for the attempt to transition to `degraded`, then click **Retry Provisioning**. Provisioning resumes from phase 1.
- **In `provisioning` for over 15 minutes**: usually a stuck pod (ImagePullBackOff, a `Pending` PVC, or a ResourceQuota that is too small). See [Daily Operations](/operations#tenant-stuck-in-provisioning).
- **In `degraded`**: a provisioning phase failed. Read the event row to see which one, then **Retry Provisioning**, which is a valid transition from `degraded`. More detail in [Tenant lifecycle](/tenant-lifecycle#recovery-paths).

## Enroll the customer's endpoints

Endpoint enrollment means getting the customer's machines to report into the right tenant's Wazuh manager. It applies to `poc` and `persistent` tenants, which run Wazuh inside their namespace. A `provided` tenant already sends its endpoints to the customer's own Wazuh, so there is nothing to enroll here; skip to the next section.

Each tenant's Wazuh manager listens on 1514/TCP (events) and 1515/TCP (enrollment). In this release the chart creates that manager as a `ClusterIP` Service only: there is no automatic LoadBalancer or DNS provisioning, so you wire the edge yourself (a per-tenant LoadBalancer Service, an edge HAProxy with per-tenant port pairs at a single IP, or a mesh-VPN path) and manage the DNS record. Full topology and firewall requirements are in [Wazuh agent ingress](/reference/wazuh-ingress).

Enrollment is scoped to the tenant by the manager's `authd` shared secret. Retrieve it:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Hand the manager hostname, the two ports, and that secret to the customer's endpoint admin over a secure channel. They enroll each endpoint with:

```bash
agent-auth -m <tenant-manager-hostname> -P "<authd-secret>"
```

An agent holding one tenant's secret can only register with that tenant's manager, which is what keeps enrollment isolated. Confirm agents landed in the embedded Wazuh dashboard: Tenants, then **Open SOC**, then Agents.

If instead the tenant's data plane runs on separate infrastructure (the remote pilot model, where a tenant VM joins over a tailnet), that VM is registered with the control plane through a `:issue-agent` cloud-agent flow, which is a different thing from the endpoint enrollment above. That path is covered end to end in the [MSSP pilot walkthrough](/mssp-pilot#_4-tenant-side-stand-up-the-data-plane).

## Hand off access

The `tenant_admin` user is created automatically during phase 5, so the tenant has an administrator as soon as it reaches `active`. To give that administrator a usable credential, force a password reset from the MSSP side (the actor must be `mssp_admin` or `platform_admin`):

```bash
curl -X POST 'https://<mssp-host>/api/mssp/users/<user-id>/password/reset' \
  -b jar -H 'Origin: https://<mssp-host>'
```

The response returns a one-time `temporary_password` flagged `must_change=true`, and the reset revokes any existing sessions for that user. Share that password together with the customer's portal URL over an end-to-end encrypted channel such as a shared password manager, never an unencrypted email or a public chat channel. The tenant admin picks a new password on first sign-in.

From there the tenant is self-service: the `tenant_admin` signs into the customer portal, opens **Users**, and provisions the org's own logins (for example `customer_viewer` for read-only stakeholders). MSSP staff and tenant users sit on opposite sides of an audience boundary that the capability guard enforces, so a tenant login structurally cannot reach cross-tenant surfaces. Roles and that boundary are described in [Users and roles](/users-and-roles).

## Verify

- The tenant shows `active` on the tenants list, and **Open SOC** loads its dashboard.
- For `poc` and `persistent`, confirm the enrolled endpoints appear under Open SOC, then Agents, and that events from them land in the tenant's Wazuh dashboard.
- For `provided`, confirm the `soctalk-adapter` pod is Ready, then run a Wazuh-backed query in SocTalk chat (for example, ask for recent alerts on a known host). It resolves once the adapter can reach the customer's External SIEM endpoints; if it does not, recheck reachability per [Coordinating external Wazuh creds](/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## See also

- [Onboarding checklist](/guides/wazuh-tenant-onboarding) for the conceptual overview and first-week baseline.
- [Tenant lifecycle](/tenant-lifecycle) for the state machine, profiles, quotas, and recovery paths.
- [MSSP UI Tour](/mssp-ui#tenants) for the tenants list and detail pages.
- [MSSP pilot: do it yourself](/mssp-pilot) for the full tailnet-based rollout including the tenant-side data plane.
