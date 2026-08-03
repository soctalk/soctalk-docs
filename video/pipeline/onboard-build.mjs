// Assemble the onboarding video scene list from captured footage.
// Encodes console.webm (+ triage.webm if present) to mp4, then defines scenes
// as [in,out] segments of that footage with draft narration. "Crop lags at
// edit" = each scene picks only the seconds worth showing; long waits become a
// fast-forward card. Draft paces by narration length (chars/14 ≈ sec).
// Output: remotion/src/onboard.json
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const OUT = 'remotion/public/onboard';
const FPS = 30;
const enc = (webm, mp4) => {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-an', mp4]);
  return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4]).toString());
};
const loadMarks = (f) => { const m = {}; for (const x of JSON.parse(fs.readFileSync(f)).marks) m[x.id] = x.t / 1000; return m; };

// --- console footage ---
const consoleDur = enc(path.join(OUT, 'console.webm'), path.join(OUT, 'console.mp4'));
const c = loadMarks(path.join(OUT, 'onboard.json'));
console.log('console.mp4', consoleDur.toFixed(1), 's; marks:', Object.keys(c).length);

// helper: a footage scene = clip [in,out] of a source with narration + label
const seg = (src, from, to, label, narr, focus) => ({ kind: 'clip', src, in: +from.toFixed(2), out: +to.toFixed(2), label, narr, focus });

const scenes = [];
// bookend intro — reframed as an AI SOC rollout
scenes.push({ kind: 'card', variant: 'intro', label: 'Roll out a SocTalk-based AI SOC in 20 minutes',
  narr: 'Rolling out a SocTalk-based AI SOC: an MSSP control plane and one tenant, on your own Proxmox host. Start to finish, about twenty minutes.' });

// prerequisites
scenes.push({ kind: 'prereq', label: 'Before you start',
  items: [
    'A Proxmox host, KVM enabled, with 8 GB of RAM, 4 vCPU, and 60 GB of disk per VM',
    'A Tailscale tailnet, and an API key with the keys:write scope',
    'An SSH public key to authorize on every provisioned VM',
    'A model API key for triage (any OpenAI-compatible provider)',
  ],
  footer: 'Full prerequisites: soctalk.ai/launchpad',
  narr: 'You need four things. A Proxmox host with room for the VMs. A Tailscale tailnet and an API key. An SSH key for the machines. And a model key for triage.' });

// CLI install (real shell commands + release URL)
scenes.push({ kind: 'terminal', term: 'workstation',
  lines: [
    '# from github.com/soctalk/soctalk-launchpad/releases',
    '$ curl -fsSL "$base/launchpad_linux_amd64" -o launchpad',
    '$ chmod +x launchpad && sudo mv launchpad /usr/local/bin/',
    '$ launchpad init      # download + verify the plugins',
    '$ launchpad ui        # open the console',
  ],
  footer: 'github.com/soctalk/soctalk-launchpad',
  narr: 'Install the launchpad binary from the GitHub releases. Let it verify its plugins, then start the console.' });

// how to reach the console: the local URL in the browser
scenes.push({ kind: 'browser', url: 'http://localhost:8321', label: 'Open the console',
  narr: 'The console is a local web app. Point your browser at localhost, and you drive the whole rollout from three screens.' });

// console flow (cropped to the meaningful beats). Cut points are aligned so
// consecutive scenes do not replay the same frames (Codex #8).
const cNetOut = (c['networks-tested'] ?? 14.4) + 2.0;
const cHostOut = (c['hosts-tested'] ?? 35.7) + 2.0;
scenes.push(seg('console', c['networks'] ?? 2.7, cNetOut, 'Network',
  'Every machine in the run joins one tailnet. Add the tailnet and its key here, then test that the key works before you rely on it.'));
scenes.push(seg('console', cNetOut, cHostOut, 'Host',
  'The host is your Proxmox server. Choose the Proxmox platform, give it the API endpoint, and test the token before you rely on it.'));
scenes.push(seg('console', cHostOut, (c['run-install-settings'] ?? 39.1) + 2.4, 'The run form',
  'The run assigns the machines to that host and takes the admin login for the control plane. On screen, the secrets stay masked.'));
scenes.push(seg('console', c['run-launch'] ?? 41.3, Math.min(consoleDur, (c['run-progress-start'] ?? 43.9) + 4.0), 'Launch',
  'Launch starts the rollout. It creates the machines, joins them to the tailnet, and installs the SOC stack on each.'));

// fast-forward over the install wait (docs: ~15-25 min, mostly downloads)
scenes.push({ kind: 'ff', label: 'Provisioning + install', minutes: 15,
  narr: 'The install runs on its own, about fifteen minutes, mostly waiting on downloads. k3s and Helm, then the control plane and the tenant SOC stack. We fast forward past it.' });

// proof: the two VMs on the Proxmox host
if (fs.existsSync(path.join(OUT, 'proxmox.webm'))) {
  const pveDur = enc(path.join(OUT, 'proxmox.webm'), path.join(OUT, 'proxmox.mp4'));
  console.log('proxmox.mp4', pveDur.toFixed(1), 's');
  scenes.push(seg('proxmox', Math.max(pveDur - 8, 0), pveDur, 'On Proxmox',
    'On the Proxmox host, both machines are up: the MSSP control plane and the tenant, cloned from one template.'));
}

// triage footage (added when triage.webm exists)
if (fs.existsSync(path.join(OUT, 'triage.webm'))) {
  const triageDur = enc(path.join(OUT, 'triage.webm'), path.join(OUT, 'triage.mp4'));
  const t = loadMarks(path.join(OUT, 'triage.json'));
  console.log('triage.mp4', triageDur.toFixed(1), 's; marks:', Object.keys(t).length);
  scenes.push(seg('triage', t['tenant-active'] ?? 0, (t['tenant-active'] ?? 0) + 6, 'Tenant online',
    'In the console, the tenant comes online within a minute or two, running its own SOC stack.'));
  // alerts flowing: a tight window on the populating investigations list, and
  // honest that a built-in attack simulator drives the activity (Codex #1,#7)
  const aStart = (t['alerts-arriving'] ?? t['burst-fired'] ?? 0) + 6;
  scenes.push(seg('triage', aStart, aStart + 14, 'Alerts flowing',
    'A built-in attack simulator runs techniques against the tenant endpoint. Each one arrives here as an investigation, newest first.'));
  // review-queue payoff: the dashboard shot with real counts (Codex #2,#6)
  const rEnd = (t['end'] ?? triageDur);
  scenes.push(seg('triage', Math.max((t['review-queue'] ?? rEnd) - 8, aStart + 14), rEnd, 'Cross-tenant dashboard',
    'This is the cross-tenant fleet view. Every investigation gets a first pass from the model, and what it cannot close on its own becomes a pending review for an analyst.'));
}

// bookend outro (URL-hero, lemma visual-only)
scenes.push({ kind: 'card', variant: 'outro', label: 'soctalk.ai',
  narr: 'Start your pilot at soctalk dot A I.' });

// stable ids for narration keying (order is deterministic)
scenes.forEach((s, i) => { s.id = `s${i + 1}`; });

// FINAL mode when narration exists: pace every scene to its real audio.
const narrPath = 'tmp/narration.json';
const FINAL = fs.existsSync(narrPath);
const narr = FINAL ? JSON.parse(fs.readFileSync(narrPath)) : {};
const LEAD = 0.35, TAIL = 0.9;

// minimum on-screen time so cards/commands stay readable regardless of narration
const readMin = (s) =>
  s.kind === 'prereq' ? Math.max(8, (s.items?.length ?? 0) * 1.7) :
  s.kind === 'terminal' ? Math.max(9, (s.lines?.length ?? 0) * 1.4) :
  s.kind === 'browser' ? 6.5 :
  s.kind === 'ff' ? 6 :
  s.variant === 'outro' ? 6.5 : 0;

for (const s of scenes) {
  const rm = readMin(s);
  if (FINAL && narr[s.id]) {
    const a = narr[s.id];
    s.audio = a.file;
    s.audioStart = LEAD;
    s.dur = Math.max(+(LEAD + a.dur + TAIL).toFixed(2), rm);
    // a clip should not outrun its own footage window by much; if audio is
    // shorter than the captured window, trim the window to the audio length.
    if (s.kind === 'clip') s.out = +Math.min(s.out, s.in + s.dur).toFixed(2);
  } else {
    // draft pacing (chars/14 ≈ seconds), floored at the readable minimum
    if (s.kind === 'clip') s.dur = Math.max(s.out - s.in, Math.ceil(s.narr.length / 14));
    else s.dur = Math.max(rm || 4.5, Math.ceil(s.narr.length / 14));
  }
}
const SILENT = !!process.env.SILENT;   // burned-subtitle, no-VO cut
const total = scenes.reduce((a, s) => a + s.dur, 0);
fs.writeFileSync('remotion/src/onboard.json', JSON.stringify({ fps: FPS, final: FINAL, silent: SILENT, consoleDur, scenes }, null, 2));
console.log(`onboard.json: ${scenes.length} scenes, ${total.toFixed(1)}s total, final=${FINAL} silent=${SILENT}`);
