// Stage-2 capture B: the payoff beats on the live MSSP after onboarding —
// tenant active, alerts flowing, AI triage → review queue. Filmed continuously;
// the attack burst is triggered off-camera (ssh) just before.
// Output: remotion/public/onboard/triage.webm (+ triage.json marks).
import { chromium } from 'playwright';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const MSSP = process.env.MSSP_URL || 'https://lp-mssp.tail6397c.ts.net';
const EMAIL = 'admin@launchpad.demo';
const PW = 'LaunchpadDemo123!';
const OUTDIR = 'remotion/public/onboard';
const VIDDIR = path.join(OUTDIR, 'vid-triage');
fs.mkdirSync(VIDDIR, { recursive: true });

const marks = []; let t0 = 0;
const now = () => Date.now() - t0;
const mark = (id) => { marks.push({ id, t: now() }); console.log(`  [${(now()/1000).toFixed(1)}s] ${id}`); };

const CURSOR = `
const c=document.createElement('div');c.id='__cur';
c.style.cssText='position:fixed;z-index:99999;width:22px;height:22px;margin:-6px 0 0 -6px;pointer-events:none;transition:left .35s cubic-bezier(.4,0,.2,1),top .35s cubic-bezier(.4,0,.2,1)';
c.innerHTML='<svg width=22 height=22 viewBox="0 0 24 24"><path d="M4 2l6 16 2.5-6.5L19 9z" fill="#fff" stroke="#fb3c4e" stroke-width="1.5"/></svg>';
document.body.appendChild(c);window.__moveCur=(x,y)=>{c.style.left=x+'px';c.style.top=y+'px'};`;
async function moveTo(page, sel) {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded().catch(()=>{});
  const b = await el.boundingBox().catch(()=>null);
  if (b) await page.evaluate(([x,y])=>window.__moveCur(x,y), [b.x+b.width/2, b.y+b.height/2]);
  await page.waitForTimeout(450);
}

// fire an attack burst on the tenant endpoint, off-camera
function attackBurst() {
  try {
    execFileSync('ssh', ['-o','BatchMode=yes','-o','StrictHostKeyChecking=no','-o','UserKnownHostsFile=/dev/null','-o','ConnectTimeout=12',
      'ops@lp-acme',
      `sudo kubectl exec -n tenant-acme tenant-acme-linuxep-0 -- bash -c 'echo "$(date -u +%F):0" > /var/log/attack-simulator/.daily-count; for n in 1 2 3 4 5; do /opt/scripts/run-attack.sh random; sleep 2; done'`],
      { timeout: 90000, stdio: 'inherit' });
    console.log('attack burst fired');
  } catch (e) { console.log('burst warn:', e.message.slice(0,100)); }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true,
  recordVideo: { dir: VIDDIR, size: { width: 1920, height: 1080 } },
});
const page = await ctx.newPage();

// login
await page.goto(`${MSSP}/login`, { waitUntil: 'load' });
await page.locator('input[type=email]').fill(EMAIL);
await page.locator('input[type=password]').fill(PW);
await page.getByRole('button', { name: /sign in/i }).click();
await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
await page.evaluate(CURSOR);
t0 = Date.now();
mark('mssp-dashboard');
await page.waitForTimeout(2500);

// tenants — acme active
for (const r of ['/tenants', '/mssp/tenants', '/']) {
  try { await page.goto(`${MSSP}${r}`, { waitUntil: 'load' }); await page.evaluate(CURSOR);
    if (await page.locator('text=/active/i').count()) break; } catch {}
}
mark('tenant-active');
await page.waitForTimeout(2500);

// investigations before
await page.goto(`${MSSP}/investigations`, { waitUntil: 'load' }).catch(()=>{});
await page.evaluate(CURSOR);
mark('investigations-before');
await page.waitForTimeout(2000);

// fire the burst, then watch alerts arrive
attackBurst();
mark('burst-fired');
for (let i = 0; i < 10; i++) {
  await page.reload({ waitUntil: 'load' }).catch(()=>{});
  await page.evaluate(CURSOR);
  await page.waitForTimeout(12000);
  if (i === 3) mark('alerts-arriving');
}
mark('alerts-flowing');
await page.waitForTimeout(2000);

// review queue — AI-escalated cases awaiting human decision
for (const r of ['/review', '/reviews', '/review/pending', '/']) {
  try { await page.goto(`${MSSP}${r}`, { waitUntil: 'load' }); await page.evaluate(CURSOR);
    if (await page.locator('text=/review|escalat|pending/i').count()) break; } catch {}
}
mark('review-queue');
await page.waitForTimeout(3500);
mark('end');

fs.writeFileSync(path.join(OUTDIR, 'triage.json'), JSON.stringify({ marks, mssp: MSSP }, null, 2));
await ctx.close();
const vids = fs.readdirSync(VIDDIR).filter(f => f.endsWith('.webm'));
if (vids.length) fs.renameSync(path.join(VIDDIR, vids[0]), path.join(OUTDIR, 'triage.webm'));
await browser.close();
console.log('triage capture done:', marks.length, 'marks');
