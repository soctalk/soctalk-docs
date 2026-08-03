// Phase-2 probe: create network + host in the scratch store, then open the
// run-creation flow and dump labeled fields. Store is reset before filming.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8321';
const T = 'filmtoken';
const OUT = 'tmp/probe';
const env = (k) => process.env[k] || '';

async function labeled(page, name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const rows = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, select, textarea')) {
      const r = el.getBoundingClientRect();
      if (r.width < 4) continue;
      let label = '';
      const lab = el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`));
      if (lab) label = lab.innerText.trim().split('\n')[0];
      if (!label) {
        let p = el.parentElement;
        for (let i = 0; i < 3 && p && !label; i++, p = p.parentElement) {
          const t = (p.querySelector('label,.label,.field-label,legend') || {}).innerText;
          if (t) label = t.trim().split('\n')[0];
        }
      }
      out.push({ label: label.slice(0, 40), tag: el.tagName.toLowerCase(), type: el.type, placeholder: el.placeholder || null, value: (el.type === 'password' ? '***' : (el.value || '').slice(0, 30)) });
    }
    return out;
  });
  console.log(`== ${name}`);
  rows.forEach(r => console.log('  ', JSON.stringify(r)));
  return rows;
}

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });

// --- network ---
await page.goto(`${BASE}/networks?t=${T}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new network/i }).click();
await page.getByPlaceholder('tail6397c').fill('tail6397c');
await page.getByPlaceholder('tailxxxx.ts.net').fill('tail6397c.ts.net');
await page.getByPlaceholder(/tskey-api/).fill(env('TAILSCALE_API_KEY'));
await page.getByRole('button', { name: /save network/i }).click();
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/network-saved.png` });
// try Test button
const tbtn = page.getByRole('button', { name: /^test$/i }).first();
if (await tbtn.count()) { await tbtn.click(); await page.waitForTimeout(2500); await page.screenshot({ path: `${OUT}/network-tested.png` }); }

// --- host (proxmox) ---
await page.goto(`${BASE}/hosts?t=${T}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new host/i }).click();
await page.getByPlaceholder('nuc-qemu').fill('proxmox-nuc');
await page.locator('select').first().selectOption('proxmox');
await page.waitForTimeout(500);
await labeled(page, 'host-form-proxmox');
await b.close();
console.log('probe2 phase A complete — inspect labels, fill mapping next');
