# FAQ

Pre-install / pre-purchase questions that don't fit cleanly into install or reference.

## What is SocTalk?

A multi-tenant SOC platform built for MSPs and MSSPs. One control plane orchestrates per-customer Wazuh stacks; an AI pipeline triages alerts and proposes actions; human analysts approve escalations. Fully open source.

## What's open source vs commercial?

**Everything in the [`soctalk/soctalk`](https://github.com/soctalk/soctalk) repo is Apache 2.0**: the control plane, the AI pipeline, the Wazuh integration, the charts, the demo VM. There is no "community vs enterprise" feature split.

A managed hosting service (SocTalk Cloud) exists for MSPs who don't want to run the platform themselves. The hosted service uses the same code as the open distribution.

## Can I evaluate it without a Kubernetes cluster?

Yes, the [demo VM image](/quickstart-vm) is a single-box install. Boot it on KVM, VMware, Hyper-V, Azure, or convert from raw. Five minutes to a running multi-tenant install with a `demo` tenant onboarded.

## Can I run it on a single node permanently?

Yes for very small deployments (1–2 customers, low alert volume). The demo VM uses the `poc` profile, which assumes ephemeral storage and doesn't size for sustained load. For real customer use:

- Bump VM resources (16 GB RAM + 200 GB SSD for ~3 small tenants).
- Use the `persistent` profile when onboarding tenants.
- Add backups (see [Backup and restore](/backup-restore)).

For more than ~3 tenants, plan a multi-node cluster.

## Does it work air-gapped?

Yes with a few additional steps:

- **Container images**: mirror `ghcr.io/soctalk/*` to your internal registry. The chart accepts `image.registry: your.registry.example/soctalk`.
- **Helm chart**: `helm pull oci://ghcr.io/soctalk/charts/soctalk-system` once, host in an internal OCI registry, point installs at it.
- **LLM**: use a local OpenAI-compatible endpoint (vLLM, Ollama proxy, on-prem Bedrock proxy). See [LLM providers](/integrate/llm-providers).
- **Cortex analyzers**: any analyzer that needs internet won't work. Use only on-prem analyzers (MaxMind GeoIP, internal MISP) or disable Cortex.
- **GitHub Releases**: download the [VM image](/downloads) on a connected host and sneakernet in.

The [`scripts/dev-up.sh`](https://github.com/soctalk/soctalk/blob/main/scripts/dev-up.sh) flow runs without internet once images are mirrored.

## How much LLM cost per tenant?

Highly variable, depends on:

- Alert volume (one investigation per alert that survives correlation)
- Token budget per run (`case_runs.tokens_budget`, model default 200,000)
- Model selection (`fast_model` + `reasoning_model`)
- How often the verdict says `needs_more_info` (causes a re-run)

Order of magnitude with the default 200,000-token-per-run budget and typical use: 30 alerts/day × ~60k tokens/investigation × $5/Mtok input ≈ $9/day per tenant on a budget OpenAI-compatible setup. Drops 5–10× with a cheaper fast model. See [Observability, Per-tenant cost](/observability#per-tenant-cost) for measuring it.

## Can different customers use different LLM models?

Yes, per-tenant override at onboard time. The install-wide model is the default; tenants opt out by specifying their own. See [LLM providers, Per-tenant overrides](/integrate/llm-providers#per-tenant-overrides).

## Can a customer bring their own LLM key?

Yes, the per-tenant override applies to the API key too. The authoritative store is `IntegrationConfig.llm_api_key_plain` in Postgres; the controller materializes it into `Secret/tenant-llm-key` in the **tenant's** namespace (not `soctalk-system`), which the runs-worker mounts. Useful for billing isolation.

## Does SocTalk send customer data to Anthropic / OpenAI?

Only what the AI pipeline reasons about: the alert body, extracted observables, and worker outputs. The runtime does not exfiltrate at-rest data, only what's in the current investigation state. If you need a stricter posture, use an on-prem LLM endpoint (vLLM, Ollama). See [LLM providers, Switch to Anthropic / runtime knobs](/integrate/llm-providers#runtime-only-knobs-env-not-chart).

## Does it replace my analysts?

No. SocTalk is positioned as a **copilot**, not a replacement. The verdict node decides `escalate | close | needs_more_info`; escalation always passes through a [human review](/human-review) gate. Without the human, a high-volume MSSP would still need analysts to handle the decisions SocTalk routes to them.

The value is in compression, the same analyst team can handle 5–10× the alert volume because routine cases auto-close and only the unclear ones reach human review.

## Does it work without Wazuh?

The current data plane is Wazuh-only. The MCP tool surface (`wazuh.*`, `cortex.*`, `thehive.*`, `misp.*`) is pluggable, so other SIEMs are feasible additions. None ship today.

## What's the production hardening posture?

- Postgres Row-Level Security with `FORCE ROW LEVEL SECURITY` as the cross-tenant data isolation backstop.
- Cilium NetworkPolicy isolating each `tenant-<slug>` namespace.
- TLS everywhere (cert-manager-managed for production; self-signed for the wizard).
- All control-plane state in Postgres with audit-log append-only semantics.
- Bootstrap admin created only when explicitly configured in values (or via a pre-provisioned Secret); rotate it after first sign-in with `soctalk-auth set-password`.

See [Security Model](/reference/security-model) for the full posture.

## Can I run it on EKS / AKS / GKE?

Yes, the chart targets stock Kubernetes 1.30+. Plug in your cloud's StorageClass, ingress controller, and cert-manager DNS-01 solver. The [install guide](/install) is K3s-focused because that's the default distribution; the chart itself doesn't care.

## Does it scale to N customers?

Tested up to ~50 tenants on a 3-node cluster (16 vCPU / 64 GB / node). Bottleneck is usually the Wazuh indexer per tenant (each indexer is a Java process with its own heap) rather than the SocTalk control plane. Plan ~6–8 GB RAM and ~1.5 vCPU per `persistent`-profile tenant, see [Sizing](/reference/sizing).

## What about compliance (SOC 2, HIPAA, PCI)?

The platform's posture supports SOC 2-style audits, append-only audit log, RBAC, encryption at rest (Postgres + Wazuh indexer), encryption in transit. It does **not** ship with a SOC 2 attestation; that's the MSSP's responsibility for their hosting.

For HIPAA / PCI, the data plane (Wazuh) often holds in-scope data. Treat that PVC as in-scope and back it up accordingly (see [Backup and restore](/backup-restore)).

## What's on the roadmap?

GitHub Issues and the [`soctalk/soctalk`](https://github.com/soctalk/soctalk) Projects board are the source of truth. High-impact items mentioned in the docs as future-release:

- Proxy auth mode exposed as a chart values knob (today: env var override).
- Fleet upgrade API (today: manual `helm upgrade` loop).
- License issuer (offline-signed install credentials).
- Customer-managed VPN onboarding helper (today: documented pattern only).
- Per-tenant Agents tab on tenant detail.

## How do I contribute?

See the [Contribute](/contribute) page.

## Where do I get help?

- Issues: https://github.com/soctalk/soctalk/issues
- Discussions: https://github.com/soctalk/soctalk/discussions
- Security: see SECURITY.md in the repo
