# Onboarding via Launchpad — screenplay outline (Stage 1 draft)

Source of truth: docs/launchpad.md ("Launchpad: one-command MSSP pilot").
Filmed surface: `launchpad ui` web console (localhost) + SocTalk MSSP dashboard
at the end. Voice: grounded SOC-operator narration, no promo language, UI
elements described by function. Lemma visual-only on cards.

## Scene skeleton (docs §2 maps 1:1)

1. **intro card** — brand card: "Onboard your SOC. One form."
   (title TBD at gate). Narration: what we're about to do — an MSSP control
   plane plus one tenant, on your own hardware, from one form.
2. **docs-context** (optional dive, docs page hero + hands-on table) —
   "about five minutes of hands-on; the rest is downloads."
3. **console-networks** — Networks screen: add tailnet name + API key
   (**API key field MASKED at capture**), press Test → green. Narration: the
   overlay every machine joins; test before you rely on it.
4. **console-hosts** — Hosts screen: the KVM box (ssh target, work dir;
   for film: the Proxmox host profile). Test → green. Narration: where VMs
   will live; credentials stay on this machine.
5. **console-run-form** — Runs screen: control node + tenant→host assignment,
   network pick, MSSP admin creds (password MASKED), LLM key (MASKED,
   placeholder ok per docs). Press **Launch**.
6. **progress-live** — the streaming run view: provisioning → tailnet join.
   Hold on real events briefly.
7. **fast-forward ⏩** — NEW SCENE KIND: compressed time-lapse of the install
   phase (k3s, helm, charts, Wazuh stack). Honest label on screen
   ("~18 minutes, compressed"). Narration: what's actually happening
   (public sources, no pre-staged images) while we skip the wait.
8. **run-complete** — the MSSP URL handed at the end; tenant states.
9. **soctalk-proof** — open MSSP dashboard: tenant `acme` registered and
   `active`; Wazuh running.
10. **llm-settings** — SocTalk LLM settings: point at OpenRouter (key MASKED),
    tier 1 Mistral-Small-24B, tier 2 DeepSeek-V4-Flash. Narration: any
    OpenAI-compatible endpoint; here, low-cost open-weight models (per our
    published benchmark).
11. **alerts-flowing** (REQUIRED) — tenant alerts arriving in the MSSP console.
    Dry-run must pin the trigger (e.g. a burst of failed SSH logins on the
    tenant VM → Wazuh authentication alerts → adapter forwards to MSSP).
12. **ai-triage-live** (REQUIRED climax) — AI triage processing those alerts:
    verdicts/queue movement on screen. Real model calls (OpenRouter FOSS
    stack). This is the payoff scene: machine first pass, human judgment.
13. **outro card** — URL-hero (VISIT US / soctalk.ai / crimson rule / lemma).

## Facts pinned by the Stage-1 dry run (2026-08-02)

- Full flow works on nested Proxmox (NUC): provision → tailnet join →
  install.sh --demo → tenant onboard → agent install → Wazuh chart.
- Wall clock: provisioning ≈3 min; MSSP install ≈4 min; tenant chart is the
  long pole (≥10 min nested). Total ≈20–25 min → fast-forward is mandatory.
- VM specs enforced by docs: 8 GB RAM/4 vCPU/60 GB disk per VM.
- Run identity: run_id soctalk-onboard, MSSP `lp-mssp`, tenant `lp-acme`
  on tail6397c.ts.net (MagicDNS).
- admin: admin@launchpad.demo / LaunchpadDemo123! (MASK password on camera).

## Capture requirements (new engine features, Stage 2)

- **Lag handling = crop at edit time** (user directive): capture continuously,
  cut the waiting in the edit (Remotion trims segments from long takes) with an
  honest on-screen "compressed" label over the cut. No special low-fps capture
  mode needed — film real time, keep segment in/out points in the scene JSON.
- **secret masking at capture**: CSS/DOM interception on password/token inputs
  (launchpad console fields for TS API key, LLM key, admin password) so
  secrets never reach footage. Placeholders where docs allow.
- Per-take reset: `proxmox-run.sh reset` + delete lp-* tailnet devices +
  clear ~/.launchpad/runs/soctalk-onboard.json. (Also stale lp-* device purge
  BEFORE every take — duplicate MagicDNS names break installs.)
- launchpad console: `launchpad ui --port <p> --no-open --token <t>`;
  Playwright drives http://localhost:<p> with ?token.
