// Capture for the FleetTour composition (the LinkedIn cut): wide dashboard
// with the replay already flowing, no cursor, no play press in the kept
// footage (controls hidden after pressing), MODEL SPEND cell hidden.
// Output: remotion/public/scenes/fleet-tour.mp4 + remotion/src/fleet-tour.json
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, EMAIL, PASSWORD } from '../config.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
if (!PASSWORD) throw new Error('SOCTALK_PASSWORD not set — export it or add it to video/.env');

const root = path.join(import.meta.dirname, '..');
const REC = path.join(root, 'tmp', 'rec-fleet-tour');
rmSync(REC, { recursive: true, force: true });
mkdirSync(REC, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HIDE_SCROLLBARS = `
(() => {
	const style = () => {
		const s = document.createElement('style');
		s.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important} html{scrollbar-width:none!important}';
		document.documentElement.appendChild(s);
	};
	document.readyState === 'loading' ? addEventListener('DOMContentLoaded', style) : style();
})();`;

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 2560, height: 1440 },
	recordVideo: { dir: REC, size: { width: 2560, height: 1440 } }
});
await context.addInitScript(HIDE_SCROLLBARS);

const login = await context.newPage();
await login.goto(`${BASE}/login`, { waitUntil: 'load' });
await login.locator('input[type=email]').fill(EMAIL);
await login.locator('input[type=password]').fill(PASSWORD);
await login.getByRole('button', { name: 'Sign in' }).click();
await login.waitForURL((u) => !u.pathname.includes('/login'));
await login.close();

const page = await context.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.locator(':is(h1,h2):has-text("Dashboard")').first().waitFor({ timeout: 15000 });
await sleep(1200);

await page.locator('button:has-text("Replay day")').first().click();
await page.locator('text=Press play to replay').waitFor({ timeout: 10000 });
await sleep(600);

// hide the MODEL SPEND stat (unrealistic $0 in the demo)
await page.evaluate(() => {
	const leaf = [...document.querySelectorAll('*')].find(
		(e) => e.childElementCount === 0 && /^MODEL SPEND$/i.test(e.textContent.trim())
	);
	if (leaf) {
		let cell = leaf;
		while (cell.parentElement && cell.parentElement.childElementCount <= 2) cell = cell.parentElement;
		cell.style.visibility = 'hidden';
	}
});

// press play, then hide the controls row so it never appears on film
const playBtn = page.locator('button:left-of(:text("Press play to replay"))').first();
await playBtn.click();
const playAt = now();
await page.evaluate(() => {
	const hint = [...document.querySelectorAll('*')].find(
		(e) => e.childElementCount === 0 && /Press play to replay/.test(e.textContent)
	);
	if (hint) {
		const row = hint.parentElement;
		row.style.display = 'none';
		const next = row.nextElementSibling;
		if (next && /Click a dot/i.test(next.textContent)) next.style.display = 'none';
	}
});
await sleep(1000);
const segStart = now();

// controls (and the scrubber) are hidden — watch ALERTS IN until it plateaus
let last = -1;
let stable = 0;
for (let i = 0; i < 90; i++) {
	await sleep(2000);
	const v = await page.evaluate(() => {
		const leaf = [...document.querySelectorAll('*')].find(
			(e) => e.childElementCount === 0 && /^ALERTS IN$/i.test(e.textContent.trim())
		);
		return parseInt(leaf?.parentElement?.textContent.replace(/[^0-9]/g, '') || '0', 10);
	});
	if (v === last && v > 150) {
		stable++;
		if (stable >= 3) break;
	} else stable = 0;
	last = v;
}
await sleep(2000);
const endAt = now();
const video = page.video();
await page.close();
const webm = await video.path();
await browser.close();

const dest = path.join(root, 'remotion', 'public', 'scenes', 'fleet-tour.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', dest]);
const videoDur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', dest]).toString());
const offset = Math.max(0, endAt - videoDur);
const meta = { segStart: Math.max(0, segStart - offset), playAt: Math.max(0, playAt - offset), endAt: endAt - offset, videoDur };
writeFileSync(path.join(root, 'remotion', 'src', 'fleet-tour.json'), JSON.stringify(meta, null, 2));
console.log('done:', dest, videoDur.toFixed(1) + 's — meta', JSON.stringify(meta));
