// Probe the launchpad console UI: screenshot each screen and dump the
// interactive elements (inputs, buttons, selects) so the capture script can
// use real selectors. Output: tmp/probe/*.png + tmp/probe/ui-map.json
import { chromium } from 'playwright';
import fs from 'fs';

const BASE = process.env.LP_URL || 'http://127.0.0.1:8321';
const TOKEN = process.env.LP_TOKEN || 'filmtoken';
const OUT = 'tmp/probe';
fs.mkdirSync(OUT, { recursive: true });

const map = {};
async function dump(page, name) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  map[name] = await page.evaluate(() => {
    const els = [];
    for (const el of document.querySelectorAll('input, button, select, textarea, a[href], [role=button]')) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      els.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        name: el.name || null,
        id: el.id || null,
        placeholder: el.placeholder || null,
        text: (el.innerText || el.value || '').trim().slice(0, 40) || null,
        href: el.getAttribute && el.getAttribute('href'),
        cls: (el.className || '').toString().slice(0, 60) || null,
      });
    }
    return els;
  });
  console.log(`--- ${name}: ${map[name].length} elements`);
}

const b = await chromium.launch();
const page = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`${BASE}/?t=${TOKEN}`, { waitUntil: 'networkidle' });
await dump(page, 'home');
for (const route of ['networks', 'hosts', 'platforms', 'runs']) {
  try {
    await page.goto(`${BASE}/${route}?t=${TOKEN}`, { waitUntil: 'networkidle' });
    await dump(page, route);
  } catch (e) { console.log(`${route}: ${e.message.slice(0, 80)}`); }
}
// try opening "add" flows on networks and hosts
for (const [route, label] of [['networks', /add|new/i], ['hosts', /add|new/i]]) {
  try {
    await page.goto(`${BASE}/${route}?t=${TOKEN}`, { waitUntil: 'networkidle' });
    const btn = page.getByRole('button', { name: label }).first();
    if (await btn.count()) { await btn.click(); await dump(page, `${route}-add`); }
  } catch (e) { console.log(`${route}-add: ${e.message.slice(0, 80)}`); }
}
fs.writeFileSync(`${OUT}/ui-map.json`, JSON.stringify(map, null, 1));
console.log('probe complete');
await b.close();
