// Phase-4 probe: dump the New run form now that host+network exist.
import { chromium } from 'playwright';
const BASE = 'http://127.0.0.1:8321'; const T = 'filmtoken'; const OUT = 'tmp/probe';
const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${BASE}/?t=${T}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/run-form.png`, fullPage: true });
const rows = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('input, select, textarea, button')) {
    const r = el.getBoundingClientRect(); if (r.width < 4) continue;
    let label = '';
    const lab = el.closest('label');
    if (lab) label = lab.innerText.trim().split('\n')[0];
    if (!label) {
      let p = el.parentElement;
      for (let i = 0; i < 3 && p && !label; i++, p = p.parentElement) {
        const t = (p.querySelector('.label,.field-label,legend,label') || {}).innerText;
        if (t) label = t.trim().split('\n')[0];
      }
    }
    out.push({ label: label.slice(0, 34) || null, tag: el.tagName.toLowerCase(), type: el.type || null, ph: el.placeholder || null, text: (el.tagName === 'BUTTON' ? (el.innerText || '').trim().slice(0, 30) : null), opts: el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.text).slice(0, 6) : undefined });
  }
  return out;
});
rows.forEach(r => console.log(JSON.stringify(r)));
await b.close();
