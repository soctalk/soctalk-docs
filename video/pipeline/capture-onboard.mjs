// Stage-2 capture: film the launchpad console first-run flow end to end against
// the pristine scratch store, then the live run's progress. Continuous take;
// lags cropped at edit via segment marks. Secrets masked at capture time.
//
// Output: remotion/public/onboard/console.webm (+ onboard.json scene marks).
// Env: TAILSCALE_API_KEY, PVE_TOKEN required. LP_URL/LP_TOKEN optional.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = process.env.LP_URL || 'http://127.0.0.1:8321';
const TOKEN = process.env.LP_TOKEN || 'filmtoken';
const FILM_HOME = process.env.FILM_HOME;              // scratch launchpad HOME
const OUTDIR = 'remotion/public/onboard';
const VIDDIR = path.join(OUTDIR, 'vid');
fs.mkdirSync(VIDDIR, { recursive: true });

const TSKEY = process.env.TAILSCALE_API_KEY || '';
const PVETOK = process.env.PVE_TOKEN || '';
if (!TSKEY || !PVETOK) { console.error('need TAILSCALE_API_KEY + PVE_TOKEN'); process.exit(1); }

// --- reset scratch store: drop saved networks/hosts/runs, keep plugins ---
if (FILM_HOME) {
  const lp = path.join(FILM_HOME, '.launchpad');
  for (const f of ['networks.json', 'hosts.json']) {
    try { fs.rmSync(path.join(lp, f)); } catch {}
  }
  try { fs.rmSync(path.join(lp, 'runs'), { recursive: true }); } catch {}
  console.log('scratch store reset (plugins kept)');
}

// Secret values to redact anywhere they appear in inputs, + a mask overlay.
const SECRETS = [TSKEY, PVETOK, 'LaunchpadDemo123!'];
const MASK_INIT = `
window.__mask = ${JSON.stringify(SECRETS)};
(function(){
  function dot(v){ return v ? '•'.repeat(Math.min(v.length, 24)) : v; }
  function scrub(){
    for (const el of document.querySelectorAll('input')) {
      const v = el.value || '';
      if (window.__mask.some(s => s && v.includes(s)) && el.type !== 'password') {
        // visually mask without changing the real value: overlay dots
        if (!el.dataset.maskShadow) {
          el.dataset.maskShadow = '1';
          el.style.color = 'transparent';
          el.style.textShadow = 'none';
          const ov = document.createElement('div');
          ov.className = '__maskov';
          ov.style.cssText = 'position:absolute;pointer-events:none;font:inherit;color:#e6e6e6;letter-spacing:2px;';
          el.parentElement.style.position = el.parentElement.style.position || 'relative';
          el.parentElement.appendChild(ov);
          el.__ov = ov;
        }
        const r = el.getBoundingClientRect(), pr = el.parentElement.getBoundingClientRect();
        el.__ov.style.left = (r.left - pr.left + 12) + 'px';
        el.__ov.style.top = (r.top - pr.top + (r.height/2) - 8) + 'px';
        el.__ov.textContent = dot(v);
      }
    }
  }
  setInterval(scrub, 120);
  document.addEventListener('input', scrub, true);
})();
`;

const marks = [];  // {id, t} scene offsets in ms from record start
let t0 = 0;
const now = () => Date.now() - t0;
const mark = (id) => { marks.push({ id, t: now() }); console.log(`  [${(now()/1000).toFixed(1)}s] ${id}`); };

// cursor overlay for cinematic pointer
const CURSOR = `
const c = document.createElement('div');
c.id='__cur'; c.style.cssText='position:fixed;z-index:99999;width:22px;height:22px;margin:-6px 0 0 -6px;pointer-events:none;transition:left .35s cubic-bezier(.4,0,.2,1),top .35s cubic-bezier(.4,0,.2,1);';
c.innerHTML='<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l6 16 2.5-6.5L19 9z" fill="#fff" stroke="#fb3c4e" stroke-width="1.5"/></svg>';
document.body.appendChild(c);
window.__moveCur=(x,y)=>{c.style.left=x+'px';c.style.top=y+'px';};
`;

async function moveTo(page, sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  if (box) await page.evaluate(([x, y]) => window.__moveCur(x, y), [box.x + box.width / 2, box.y + box.height / 2]);
  await page.waitForTimeout(450);
}
async function typeInto(page, sel, text) {
  await moveTo(page, sel);
  await page.locator(sel).first().click();
  await page.locator(sel).first().fill('');
  await page.locator(sel).first().type(text, { delay: 28 });
}
// fill a proxmox host field by its uppercase label prefix (data-qa tag)
async function fillLabel(page, label, value) {
  const qa = await page.evaluate((lab) => {
    const want = lab.trim().toUpperCase();
    for (const n of document.querySelectorAll('label,div,span,legend')) {
      if (n.children.length < 4 && (n.textContent || '').trim().toUpperCase().startsWith(want)) {
        let inp = n.querySelector('input,select'), cur = n;
        for (let h = 0; h < 4 && cur && !inp; h++) { let s = cur.nextElementSibling; while (s && !inp) { inp = s.matches('input,select') ? s : s.querySelector('input,select'); s = s.nextElementSibling; } cur = cur.parentElement; }
        if (inp) { const id = 'qa' + want.replace(/[^A-Z0-9]/g, ''); inp.setAttribute('data-qa', id); return id; }
      }
    }
    return null;
  }, label);
  if (qa) await typeInto(page, `[data-qa="${qa}"]`, value);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  recordVideo: { dir: VIDDIR, size: { width: 1920, height: 1080 } },
});
await ctx.addInitScript(MASK_INIT);
const page = await ctx.newPage();

// ---- SCENE 1: empty home ----
await page.goto(`${BASE}/?t=${TOKEN}`, { waitUntil: 'networkidle' });
await page.evaluate(CURSOR);
t0 = Date.now();
mark('home-empty');
await page.waitForTimeout(2200);

// ---- SCENE 2: Networks ----
await page.goto(`${BASE}/networks?t=${TOKEN}`, { waitUntil: 'networkidle' });
await page.evaluate(CURSOR);
mark('networks');
await page.waitForTimeout(1200);
await moveTo(page, 'button:has-text("New network")'); await page.getByRole('button', { name: /new network/i }).click();
await page.waitForTimeout(500);
await typeInto(page, 'input[placeholder="tail6397c"]', 'tail6397c');
await typeInto(page, 'input[placeholder="tailxxxx.ts.net"]', 'tail6397c.ts.net');
await typeInto(page, 'input[placeholder^="tskey"]', TSKEY);
mark('networks-filled');
await moveTo(page, 'button:has-text("Save network")'); await page.getByRole('button', { name: /save network/i }).click();
await page.waitForTimeout(1200);
const tnet = page.getByRole('button', { name: /^test$/i }).first();
if (await tnet.count()) { await moveTo(page, 'button:has-text("Test")'); await tnet.click(); await page.waitForTimeout(3000); mark('networks-tested'); }

// ---- SCENE 3: Hosts ----
await page.goto(`${BASE}/hosts?t=${TOKEN}`, { waitUntil: 'networkidle' });
await page.evaluate(CURSOR);
mark('hosts');
await page.waitForTimeout(1000);
await moveTo(page, 'button:has-text("New host")'); await page.getByRole('button', { name: /new host/i }).click();
await page.waitForTimeout(500);
await typeInto(page, 'input[placeholder="nuc-qemu"]', 'proxmox-nuc');
await page.locator('select').first().selectOption('proxmox');
await page.waitForTimeout(900);
await fillLabel(page, 'ENDPOINT', 'https://100.102.223.8:8006');
await fillLabel(page, 'NODE', 'pve');
await fillLabel(page, 'STORAGE', 'local-lvm');
await fillLabel(page, 'TEMPLATE', '9000');
await fillLabel(page, 'BRIDGE', 'vmbr1');
await fillLabel(page, 'SNIPPETS ', 'local');
await fillLabel(page, 'SNIPPETS_DIR', '/var/lib/vz/snippets');
await fillLabel(page, 'SSH_HOST', 'root@100.102.223.8');
await fillLabel(page, 'SSH_PORT', '2223');
await fillLabel(page, 'PROXMOX_API_TOKEN_ID', 'root@pam!launchpad');
await fillLabel(page, 'PROXMOX_API_TOKEN_SECRET', PVETOK);
mark('hosts-filled');
await moveTo(page, 'button:has-text("Save host")'); await page.getByRole('button', { name: /save host/i }).click();
await page.waitForTimeout(1200);
const thost = page.getByRole('button', { name: /^test$/i }).first();
if (await thost.count()) { await moveTo(page, 'button:has-text("Test")'); await thost.click(); await page.waitForTimeout(4500); mark('hosts-tested'); }

// ---- SCENE 4: New run form ----
await page.goto(`${BASE}/?t=${TOKEN}`, { waitUntil: 'networkidle' });
await page.evaluate(CURSOR);
mark('run-form');
await page.waitForTimeout(1500);
await moveTo(page, 'text=Install settings'); await page.getByText('Install settings').click();
await page.waitForTimeout(800);
mark('run-install-settings');
await page.waitForTimeout(1800);
if (process.env.DRY) {
  await page.screenshot({ path: path.join(OUTDIR, 'dry-run-form.png') });
  console.log('DRY: stopped before Launch; screenshot saved'); await ctx.close(); await browser.close(); process.exit(0);
}
await moveTo(page, 'button:has-text("Launch")');
mark('run-launch');
await page.getByRole('button', { name: /^launch$/i }).click();
await page.waitForTimeout(2500);
mark('run-progress-start');

// ---- SCENE 5: live progress until complete (crop at edit) ----
const RUN_MAX_MS = 20 * 60 * 1000;
const startRun = Date.now();
let done = false;
while (!done && Date.now() - startRun < RUN_MAX_MS) {
  await page.waitForTimeout(15000);
  const body = (await page.locator('body').innerText().catch(() => '')) || '';
  // require the tenant SOC-stack completion signal, not just the word "complete"
  if (/wazuh ready|SOC stack operational|tenant .*active|all machines? ready/i.test(body)) { done = true; mark('run-complete'); }
  else if (/\bfailed\b|orchestrator\.failed/i.test(body)) { mark('run-failed'); break; }
}
await page.waitForTimeout(3000);
mark('end');

fs.writeFileSync(path.join(OUTDIR, 'onboard.json'), JSON.stringify({ marks, base: BASE }, null, 2));
await ctx.close();
const vids = fs.readdirSync(VIDDIR).filter(f => f.endsWith('.webm'));
if (vids.length) fs.renameSync(path.join(VIDDIR, vids[0]), path.join(OUTDIR, 'console.webm'));
await browser.close();
console.log('capture done:', marks.length, 'marks →', path.join(OUTDIR, 'console.webm'));
