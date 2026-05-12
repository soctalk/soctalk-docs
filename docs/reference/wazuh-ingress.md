# Wazuh Agent Ingress and Cert Enrollment


## Problem

Each tenant has a dedicated Wazuh manager running in `tenant-<slug>` namespace. Wazuh agents are installed on the customer's endpoints (outside the MSSP's cluster) and must connect to **their tenant's** Wazuh manager on:

- **1514/TCP**: agent event stream (encrypted with Wazuh's native protocol over TLS)
- **1515/TCP**: agent enrollment / `authd` (registration using shared secret)

Constraints:

- Many tenants on one cluster → cannot expose 1514/1515 on a single NodePort (port collision).
- Agents must reach only *their* tenant's manager (not another tenant's).
- Customer endpoints are on unknown networks (corporate LAN, cloud VMs, laptops): Connectivity via public internet most commonly.
- TLS certificates must be tenant-specific (chain of trust scoped per-customer).

## Chosen pattern: per-tenant address at the MSSP edge

Each tenant gets a dedicated DNS name (`acme.soc.mssp.example.com`) that resolves to a per-tenant L4 endpoint at the MSSP edge. Routing to the right Wazuh manager is by destination address, not by hostname inspection.

**Why not SNI-based L4 routing.** Wazuh's agent protocol on 1514/TCP is a proprietary AES-encrypted stream, not standard TLS, so connections do not carry an SNI ClientHello. An L4 proxy that branches on `req.ssl_sni` won't see one and agent traffic falls through to the default backend. The 1515/TCP enrollment channel does negotiate TLS, but routing has to use the same discriminator as 1514 or the two ports diverge.

Two implementations of per-tenant addressing are supported:

1. **Per-tenant LoadBalancer Service (recommended).** The `soctalk-tenant` chart creates a `Service` of type `LoadBalancer` in each tenant namespace for the Wazuh manager on 1514/1515. On a cloud cluster the cloud LB controller assigns a unique public IP; on bare metal use MetalLB (or kube-vip) to draw from a pool. DNS for `<slug>.soc.mssp.example.com` points at that tenant's LB IP.
2. **Per-tenant port at a single edge IP (fallback).** When unique IPs are scarce, allocate a port range at one edge IP and assign `(1514, 1515)` offsets per tenant (e.g., acme → 15140/15141, beta → 15142/15143). DNS uses `SRV` records or the agent's `manager_address:port` config to dispatch. Operationally awkward but works.

### Topology

```
Customer endpoint (Wazuh agent)
        │
        │ TCP 1514 to acme.soc.mssp.example.com
        │ (Wazuh agent protocol; not standard TLS)
        ▼
DNS resolves to the LoadBalancer IP for tenant-acme
        │
        ▼
┌───────────────────────────────────┐
│ MSSP cluster ingress for          │
│ tenant-acme/wazuh-manager         │
│ (cloud LB IP or MetalLB-assigned) │
└─────────────┬──────────────────────┘
              │ cluster-internal forward
              ▼
  tenant-acme namespace
  ┌─────────────────┐
  │ wazuh-manager   │
  │ Service: 1514   │
  │ Pod with        │
  │ tenant-specific │
  │ TLS cert (1515) │
  └─────────────────┘
```

### DNS

Per-tenant `A`/`AAAA` record: `<slug>.soc.mssp.example.com → <tenant LB IP>`. SocTalk emits the record into the MSSP's DNS provider when the tenant becomes `active` (via external-dns or an explicit provider integration; see the tenant-provisioning flow).

Wildcard DNS does not work for the LoadBalancer pattern because each tenant has its own IP. It only works under the fallback (per-tenant port) topology, where every name resolves to the same edge IP.

### TLS certificates

Each tenant gets a certificate whose SAN covers `<slug>.soc.mssp.example.com`. Options:

- **Per-tenant cert via cert-manager + Let's Encrypt** (recommended for MVP): cert-manager `Certificate` CR per tenant, issued by a DNS-01 or HTTP-01 `ClusterIssuer`: Cert stored in `tenant-<slug>` ns as `Secret/wazuh-tls`: Renewed automatically.
- **Wildcard cert for `*.soc.mssp.example.com`**: one cert covers all tenants. Simpler, but means any tenant's Wazuh manager can present the cert for any tenant's agent during MSSP-side proxy failures: acceptable risk for this release since the routing is the real enforcement.
- **MSSP-provided internal CA**: for MSSPs running their own PKI, cert-manager can issue from an in-cluster `Issuer` backed by the MSSP CA.

Install guide documents all three; pilot defaults to Let's Encrypt per-tenant.

### LoadBalancer provisioning

The MSSP runs one of:

| Environment | LoadBalancer source |
|---|---|
| Managed cloud (EKS, GKE, AKS, …) | The cloud's load-balancer controller assigns a public IP per `Service` of type `LoadBalancer`. |
| Bare-metal or on-prem | MetalLB (L2 or BGP mode) with an address pool, or kube-vip. |
| Single-IP edge with port mapping | Run an external L4 proxy (HAProxy, Envoy, nginx-stream) that forwards `(IP, port)` pairs to the tenant `Service`. Use this only under the fallback per-port topology. |

The `soctalk-tenant` chart's `Service` is annotated so cloud controllers and MetalLB can apply pool/IP-class selection (e.g., `metallb.universe.tf/address-pool: wazuh-agents`). The SocTalk controller records the resulting LB IP and writes the per-tenant DNS record.

If you must use a single edge IP (fallback), a reference HAProxy mapping looks like this:

```
# Per-port routing — each tenant has its own 1514/1515 pair at the edge.
frontend wazuh-15140
    mode tcp
    bind *:15140
    default_backend tenant-acme-events
frontend wazuh-15141
    mode tcp
    bind *:15141
    default_backend tenant-acme-enroll
frontend wazuh-15142
    mode tcp
    bind *:15142
    default_backend tenant-beta-events

backend tenant-acme-events
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1514
backend tenant-acme-enroll
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1515
backend tenant-beta-events
    mode tcp
    server wazuh wazuh-manager.tenant-beta.svc.cluster.local:1514
```

Do not branch on `req.ssl_sni` for Wazuh 1514. Wazuh's agent protocol is not standard TLS and never produces a ClientHello there. SNI is available only on 1515 (enrollment), which is insufficient — events would still need a working discriminator.

## Agent enrollment flow

Wazuh's `authd` registration on 1515/TCP requires a shared secret. Each tenant has its own `authd` secret (stored in `Secret/wazuh-authd-secret` in the tenant namespace). Enrollment:

1. **MSSP operator** onboards a new customer. SocTalk generates the `authd` shared secret at tenant-provisioning time.
2. **MSSP operator** provides customer-endpoint admin with:
   - Tenant's Wazuh manager hostname (`acme.soc.mssp.example.com`)
   - Ports (1514 events, 1515 enrollment)
   - `authd` shared secret (via secure channel: secrets management platform, encrypted email, whatever the MSSP uses)
   - Wazuh agent installer (standard upstream package)
3. **Customer endpoint admin** installs Wazuh agent with the hostname and enrolls:
   ```bash
   /var/ossec/bin/agent-auth \
       -m acme.soc.mssp.example.com \
       -P "<authd-shared-secret>"
   ```
4. Agent registers with tenant's manager, receives its own per-agent certificate.
5. Subsequent connections on 1514 are per-agent mTLS.

Routing at 1515 uses the same per-tenant address as 1514 (LB IP or edge port). The `authd` shared secret is tenant-scoped: an agent using `acme`'s secret can only register with `acme`'s manager — the addressing enforces it, and the secret is verified by the manager.

## Firewall / network requirements

MSSP-side:
- Public IPs for edge proxy (one IP, or per-region IPs for MSSPs with geo-distributed MSSP regions).
- Edge proxy allows inbound 1514/TCP, 1515/TCP from 0.0.0.0/0 (or customer-specific CIDRs if MSSP prefers).
- Cluster-internal firewall (NodePort range or internal CIDR) allows edge proxy → tenant namespace Wazuh manager.

Customer-side:
- Agents allow outbound 1514/1515/TCP to the MSSP's edge hostname.
- No inbound from MSSP to customer endpoints (Wazuh is pull-less: events originate from agent).

## Certificate revocation / agent removal

To revoke a specific agent:
1. MSSP operator opens tenant in MSSP UI → Agents tab → revokes.
2. SocTalk calls Wazuh manager API to remove the agent's registration.
3. Customer-endpoint admin uninstalls the agent (optional, housekeeping).

To revoke all agents for a tenant (e.g., customer offboarding):
1. Rotate tenant's `authd` shared secret (re-enrollment required for new agents).
2. Delete all existing agent registrations via Wazuh API.
3. Tenant decommission  eventually tears down the manager.

## Alternative connectivity patterns (documented, not built)

### Customer-managed VPN / tunnel

If a customer's network policy disallows agents sending telemetry over public internet:
- Customer provisions a WireGuard/IPsec tunnel to MSSP's private network.
- MSSP routes tunnel traffic to the same edge proxy (or directly to cluster on internal addresses).
- Agent configuration points at an internal hostname.

Not implemented in this release tooling; documented as a setup pattern for MSSPs who need it.

### Tailscale / overlay network

Similar to 6.1; MSSP and customer join a Tailscale network, agent reaches `acme.soc.mssp.ts.net` directly. Good for small customers; documented.

### Per-region MSSP edge

For MSSPs with geographic separation (EU, US, APAC), run multiple edge proxies in different regions. Each tenant is assigned to its nearest region and the DNS reflects that (`acme.soc.eu.mssp.example.com`, `acme.soc.us.mssp.example.com`). The design supports this because edge-proxy-to-tenant-namespace routing is just a cluster-internal DNS lookup. Automated multi-region dispatch is on the roadmap.

## Runbook: onboarding a customer's first agent

1. MSSP operator creates tenant in MSSP UI → SocTalk provisions stack, generates `authd` secret.
2. MSSP operator navigates to tenant detail → "Agent Onboarding" section.
3. Section displays:
   - Tenant hostname: `acme.soc.mssp.example.com`
   - Ports: 1514/TCP (events), 1515/TCP (enrollment)
   - `authd` shared secret (masked; copy-to-clipboard + one-time reveal)
   - Sample `agent-auth` command
   - Firewall requirements
4. MSSP operator copies to secure channel, shares with customer endpoint admin.
5. Customer endpoint admin installs + enrolls.
6. MSSP operator watches tenant detail → Agents tab, sees agent appear within ~30 seconds.

## Testing (pre-release + pilot validation)

Pre-release validation:
- Per-tenant `Service` template renders correctly for both `tenant.wazuhIngress.mode` values (`loadbalancer` and `edge-haproxy`).
- cert-manager per-tenant cert issuance for the agent enrollment channel (1515).
- End-to-end in `k3d` with two tenants, MetalLB providing two LB IPs (`loadbalancer` mode): for each tenant, run `agent-auth -m <lb-ip> -P <secret>` from a host pod and confirm the agent appears in that tenant's Wazuh indexer and not the other.
- Same end-to-end in `edge-haproxy` mode: HAProxy renders one `(IP, port-pair)` per tenant, agents enroll using `-m <edge-ip> -p <tenant-port>`, and the event stream lands in the right indexer.
- Negative: an agent pointed at tenant A's address with tenant B's `authd` secret is rejected by the manager.

Pilot validation (later release):
- Real customer endpoint over the public internet enrolls cleanly.
- Cross-tenant probe: enroll an `acme` agent with `beta`'s `authd` secret against `beta`'s address — expect rejection. Vice versa. Both fail.

There is no SNI step in any of these checks: Wazuh's agent protocol on 1514 does not produce a ClientHello, so any test that "overrides SNI" is exercising a routing path the production ingress will not take. Validate the address/port discriminator instead.

