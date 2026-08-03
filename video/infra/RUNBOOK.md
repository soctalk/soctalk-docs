# Onboarding-video infra runbook (NUC + nested Proxmox)

Internal record so the next session doesn't rediscover this. Target: film the
launchpad end-to-end SocTalk onboarding against a nested Proxmox on the NUC.

## The environment

- **NUC**: `gbrigandi-nuc13anhi7`, tailnet `tail6397c.ts.net`, IP `100.102.223.8`.
  Ubuntu 24.04, i7-1360P, 62 GB RAM, 760 GB free. SSH: `ssh -lgbrigandi
  gbrigandi-nuc13anhi7` (passwordless sudo, in `kvm` group, `sshpass` present).
  Nested KVM = Y. A separate `soc-clean-test` VM (12 GB) is usually running —
  leave it alone; it's why the Proxmox VM gets 24 GB not more.
- **Nested Proxmox VM** lives at `~/proxmox-film/` on the NUC:
  - `pve.qcow2` (250 GB sparse) — the Proxmox disk, with a `clean` snapshot.
  - Proxmox VE 8.4, root pw in `video/.env` as `PVE_ROOTPW` (throwaway lab; MASK on camera).
  - Reachable from the Mac over tailnet: **API** `https://100.102.223.8:8006`,
    **guest SSH** `ssh -p 2223 root@100.102.223.8` (both via qemu hostfwd bound
    0.0.0.0). Storages: `local` (dir: iso/vztmpl/backup/snippets) + `local-lvm`
    (lvmthin: VM images). Cloud-init template = **VM 9000** on local-lvm.
- **launchpad**: binary `~/.local/bin/launchpad` (0.2.0) on the Mac; profiles in
  `~/.launchpad/`. Host profile `proxmox-nuc` (endpoint, node `pve`, storage
  `local`, template 9000, bridge vmbr0). Network profile `tail6397c` (has the
  Tailscale API key). Models: OpenRouter (`OPENROUTER_API_KEY` in shell env) —
  tier1 Mistral-Small-24B-2501, tier2 DeepSeek-V4-Flash (US, FOSS, per
  docs/guides/inference-cost-benchmark.md).

## Scripts (video/infra/, committed)

- `deploy-proxmox-nuc.sh` — one-shot: assistant + ISO → auto-install → config
  → `clean` snapshot. Run ON the NUC. ~25 min.
- `proxmox-run.sh [reset]` — boot the VM (SATA/ich9-ahci bus). `reset` reverts
  to `clean` first (one-command per-take reset).
- `proxmox-finish-config.sh` — re-run just the template+snippets+snapshot step.

## Gotchas already paid for (do NOT rediscover)

1. **`-boot d` = reinstall loop.** Booting the installer ISO every reboot made
   the completed install re-run 10×. Use **`-boot once=d`** (installer once,
   then disk). FIXED in deploy script.
2. **VM disks can't go on `local`.** `qm importdisk ... local` → "storage local
   does not support vm images". Use **`local-lvm`** for the template disk +
   cloudinit drive. FIXED.
3. **Disk bus must match install.** Installed via SATA (ich9-ahci); boot with
   the SAME bus. An early `proxmox-run.sh` used `if=virtio` — a stale virtio
   qemu + a new ahci qemu on the same disk = two VMs fighting the disk, neither
   boots, 2223 stays closed. **Always `pkill -9 -f qemu.*pve.qcow2` before
   booting, and run exactly ONE instance.**
4. **Installed Proxmox has no serial output.** The installer's GRUB uses serial
   (visible in `pve-serial.log`); the installed system's GRUB uses VGA, so
   `-serial file` is empty after install — that's normal, NOT a hang. Judge
   boot by API:8006 / guest ssh:2223, not the serial log.
5. **24 GB VM start saturates the NUC → tailnet SSH 255s.** During install/boot
   the box is CPU-bound and the tailnet path is via **DERP relay (sfo)**, so
   interactive SSH drops mid-handshake ("banner exchange timeout"). This is
   environmental, not a real failure. **Coping pattern that works:**
   - Launch long/detached work with `setsid bash script >log 2>&1 </dev/null &
     exit 0` (nothing trailing that holds the channel) OR under `systemd-run`.
   - Then reconnect and read the log; the detached job survives the drop.
   - Wrap status checks in a retry loop (8–20 attempts, sleep 10–30s); the
     command that "failed" usually started fine.
   - SSH opts that help: `-o ServerAliveInterval=15 -o ConnectTimeout=25`.

## launchpad run (Stage 1)

- Run config: `video/infra/onboard-run.yaml` (`launchpad up --config … --headless
  --auto-resolve-gates [--recreate]`). Self-contained: target proxmox, inline
  plugin_config (endpoint/node/storage=local-lvm/snippets=local/template 9000/
  bridge/ssh_host=root@100.102.223.8:2223/tailnet). One MSSP + one tenant (acme).
- Required env before `up`: `PROXMOX_API_TOKEN_ID=root@pam!launchpad`,
  `PROXMOX_API_TOKEN_SECRET=<token>` (minted via `pveum user token add root@pam
  launchpad --privsep 0` on the guest), `TAILSCALE_API_KEY=<from
  ~/.launchpad/networks.json tail6397c>`. Also `ssh-add ~/.ssh/id_ed25519` and
  the Mac pubkey in the guest's `/root/.ssh/authorized_keys` (plugin uploads the
  cloud-init snippet over SSH; API rejects snippet content-type).
- GOTCHA (paid for): the **installed** proxmox plugin manifest
  `~/.launchpad/plugins/proxmox/plugin.yaml` was missing `TAILSCALE_API_KEY`
  from its `env` allowlist (repo manifest has it) → plugin never received the
  key → `vm.create` fails `tailscale.no_api_key` even with the key exported.
  Pluginhost only forwards allowlisted parent-env vars. Fix: add
  `- TAILSCALE_API_KEY` to the installed manifest env list (unsigned; the
  manifest `sha256` guards the binary, not itself). Upstream fix: reinstall the
  plugin from a build that carries the current manifest.
- LLM: launchpad only threads `SOCTALK_LLM_PROVIDER` + `_API_KEY` (no base_url /
  per-tier models). Dry run uses a placeholder key. FOSS models (Mistral-24B /
  DeepSeek-Flash via OpenRouter) get set post-onboarding in SocTalk's LLM
  settings page — a video beat, not a launchpad form field.

## launchpad profile reconciliation (done)

- `proxmox-nuc` profile `ssh_host` is `root@127.0.0.1:2223` (works only ON the
  NUC). For the Mac to drive launchpad it must be `root@100.102.223.8` port
  2223. Update the profile (or run launchpad on the NUC).
- Proxmox API needs auth: create a token on the guest
  (`pveum user token add root@pam launchpad ...`) and put it in the profile, or
  use root@pam + the `PVE_ROOTPW` from `video/.env`.

## Stage-1 dry run: COMPLETE (2026-08-02) — pinned facts

Full chain proven on nested Proxmox: launchpad up → 2 VMs → tailnet →
install.sh --demo → tenant onboard → agent → Wazuh chart → **complete** in
**10m55s** (20:03:32→20:14:27). Then: attack sim → alert → investigation →
runs-worker → OpenRouter triage (13k tokens) → disposition **escalate** →
**review queue** (3 pending). Alerts flowing ✓, AI triage working ✓.

More paid-for gotchas (7–12):
6. **L2 VMs need internet**: fresh PVE vmbr0 is user-net (single-client) — L2
   clones get no DHCP/net. Fix: NAT bridge **vmbr1** 10.10.10.1/24 + dnsmasq
   DHCP + MASQUERADE (needs repo fix first: drop enterprise repo, add
   bookworm + pve-no-subscription). Template must be on vmbr1 + `ipconfig0
   ip=dhcp`.
7. **Template sizing is the VM sizing** (proxmox plugin has no cpu/mem/disk
   config): template 9000 must be `--memory 8192 --cores 4`, disk resized to
   60G. 2 GB ⇒ Wazuh never becomes operational ("0 recovery attempts").
8. **Purge stale `lp-*` tailnet devices before EVERY run** (Tailscale API
   DELETE /device/{id}): duplicate MagicDNS names resolve to dead IPs → ssh
   timeouts mid-install.
9. **VM guest user is `ops`** (cloud-init snippet), agent-auth with the Mac
   key: `ssh ops@lp-mssp` / `ops@lp-acme`.
10. **CSRF = Origin header**: mutating API calls need `-H "Origin: <base>"`
    with the session cookie (cookie jar line is `#HttpOnly_…` — grep -v ^#
    hides it).
11. **LLM per tenant** via `PATCH /api/mssp/tenants/{id}/llm`:
    `{provider: openai, base_url: https://openrouter.ai/api/v1, model+
    fast_model: mistralai/mistral-small-24b-instruct-2501, reasoning_model:
    deepseek/deepseek-v4-flash, api_key: $OPENROUTER_API_KEY}`. Set for BOTH
    tenants (acme + demo). Escalations land in `/api/review/pending`, not
    `verdict_decision` (that fills on closure) — review queue is the on-screen
    proof.
12. **Attack simulator**: cron in linuxep pod fires every 15 min but has a
    **daily cap of 30**; install burst exhausts it. On-demand burst for
    filming: `kubectl exec -n tenant-demo tenant-demo-linuxep-0 -- bash -c
    'echo "$(date -u +%F):0" > /var/log/attack-simulator/.daily-count;
    /opt/scripts/run-attack.sh random'` (as ops@lp-mssp with sudo).
    Alert→investigation latency ≈60–90 s; triage verdict ≈1 min after.

MSSP console: https://lp-mssp.tail6397c.ts.net (admin@launchpad.demo /
LaunchpadDemo123! — mask on camera).

## Current state

- [x] Proxmox deployed; `clean` snapshot = **pre-onboarding baseline with all
      fixes** (vmbr1+dnsmasq+repos, template 8G/4c/60G/vmbr1/dhcp; no lp VMs).
      Per-take reset: `proxmox-run.sh reset` + purge lp-* devices + clear
      `~/.launchpad/runs/soctalk-onboard.json`.
- [x] Stage 1 dry run complete (see pinned facts).
- [ ] Stage 2: screenplay from outline (video/screenplays/
      onboarding-launchpad.outline.md) + capture engine (launchpad ui via
      Playwright, secret masking, crop-lags-at-edit) → gated silent draft.
