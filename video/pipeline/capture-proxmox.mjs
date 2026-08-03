// Short capture of the Proxmox web UI showing the pilot's VMs, for the
// "on your own Proxmox" beat. Output: remotion/public/onboard/proxmox.webm
import '../config.mjs';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const PVE = 'https://100.102.223.8:8006';
const OUTDIR = 'remotion/public/onboard';
const VIDDIR = path.join(OUTDIR, 'vid-pve');
fs.mkdirSync(VIDDIR, { recursive: true });

const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1920, height: 1080 }, ignoreHTTPSErrors: true,
  recordVideo: { dir: VIDDIR, size: { width: 1920, height: 1080 } } });
const page = await ctx.newPage();
await page.goto(PVE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
// login (ExtJS): username / password / Login
try {
  await page.fill('input[name="username"]', 'root');
  await page.fill('input[name="password"]', process.env.PVE_ROOTPW || '');
  await page.getByText('Login', { exact: true }).click();
} catch (e) { console.log('login step:', e.message.slice(0, 80)); }
await page.waitForTimeout(4000);
// dismiss the no-subscription dialog (retry: it can appear a beat late)
for (let i = 0; i < 4; i++) {
  try { await page.getByText('No valid subscription').waitFor({ timeout: 2500 });
    await page.getByRole('button', { name: 'OK' }).click({ timeout: 2000 }); break;
  } catch { await page.waitForTimeout(800); }
}
await page.waitForTimeout(1200);
await page.screenshot({ path: path.join(OUTDIR, 'proxmox-shot.png') });
await page.waitForTimeout(5000);   // hold on the clean VM list
await ctx.close();
const vids = fs.readdirSync(VIDDIR).filter(f => f.endsWith('.webm'));
if (vids.length) fs.renameSync(path.join(VIDDIR, vids[0]), path.join(OUTDIR, 'proxmox.webm'));
await b.close();
console.log('proxmox capture done');
