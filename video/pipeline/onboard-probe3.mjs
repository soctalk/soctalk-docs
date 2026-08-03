// Phase-3 probe: complete host creation, then dump the run-creation form.
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = 'http://127.0.0.1:8321'; const T = 'filmtoken'; const OUT = 'tmp/probe';
const env = (k) => process.env[k] || '';

async function fillByLabel(page, label, value) {
  const qa = await page.evaluate((lab) => {
    const want = lab.trim().toUpperCase();
    const nodes = Array.from(document.querySelectorAll('label, div, span, legend'))
      .filter(n => n.children.length < 4 && (n.textContent || '').trim().toUpperCase().startsWith(want));
    for (const n of nodes) {
      let inp = n.querySelector('input, select');
      if (!inp) {
        let cur = n;
        for (let hop = 0; hop < 4 && cur && !inp; hop++) {
          let sib = cur.nextElementSibling;
          while (sib && !inp) { inp = sib.matches('input,select') ? sib : sib.querySelector('input, select'); sib = sib.nextElementSibling; }
          cur = cur.parentElement;
        }
      }
      if (inp) { const id = 'qa-' + want.replace(/[^A-Z0-9]/g, ''); inp.setAttribute('data-qa', id); return id; }
    }
    return null;
  }, label);
  if (!qa) throw new Error(`no input found for label ${label}`);
  await page.fill(`[data-qa="${qa}"]`, String(value), { timeout: 8000 });
}
async function dumpAll(page, name) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  const rows = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('input, select, textarea, button, [role=button]')) {
      const r = el.getBoundingClientRect(); if (r.width < 4) continue;
      let label = '';
      const lab = el.closest('label');
      if (lab) label = lab.innerText.trim().split('\n')[0];
      out.push({ label: label.slice(0, 36), tag: el.tagName.toLowerCase(), type: el.type || null, text: (el.innerText || '').trim().slice(0, 36) || null, ph: el.placeholder || null });
    }
    return out;
  });
  console.log(`== ${name}`); rows.forEach(r => console.log('  ', JSON.stringify(r)));
}

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${BASE}/hosts?t=${T}`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /new host/i }).click();
await page.getByPlaceholder('nuc-qemu').fill('proxmox-nuc');
await page.locator('select').first().selectOption('proxmox');
await page.waitForTimeout(1200);
console.log('label texts:', await page.locator('label').allInnerTexts());
await page.screenshot({ path: `${OUT}/host-form-state.png` });
await fillByLabel(page, 'ENDPOINT', 'https://100.102.223.8:8006');
await fillByLabel(page, 'NODE', 'pve');
await fillByLabel(page, 'STORAGE', 'local-lvm');
await fillByLabel(page, 'TEMPLATE', '9000');
await fillByLabel(page, 'BRIDGE', 'vmbr1');
await fillByLabel(page, 'SNIPPETS ', 'local');
await fillByLabel(page, 'SNIPPETS_DIR', '/var/lib/vz/snippets');
await fillByLabel(page, 'SSH_HOST', 'root@100.102.223.8');
await fillByLabel(page, 'SSH_PORT', '2223');
await fillByLabel(page, 'PROXMOX_API_TOKEN_ID', 'root@pam!launchpad');
await fillByLabel(page, 'PROXMOX_API_TOKEN_SECRET', env('PVE_TOKEN'));
await page.getByRole('button', { name: /save host/i }).click();
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/host-saved.png` });
const tbtn = page.getByRole('button', { name: /^test$/i }).first();
if (await tbtn.count()) { await tbtn.click(); await page.waitForTimeout(4000); await page.screenshot({ path: `${OUT}/host-tested.png` }); console.log('host Test clicked'); }

await page.goto(`${BASE}/runs?t=${T}`, { waitUntil: 'networkidle' });
await dumpAll(page, 'runs-with-store');
const nb = page.getByRole('button', { name: /new run|create/i }).first();
if (await nb.count()) { await nb.click(); await dumpAll(page, 'run-form'); }
await b.close();
console.log('probe3 complete');
