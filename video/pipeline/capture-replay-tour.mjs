// Capture for the ReplayTour composition: dashboard scroll tour, then
// Replay day + play with a fake cursor, dead-steady during the timelapse.
// Scrollbars are hidden at the CSS level for the whole take.
// Output: remotion/public/scenes/replay-tour.mp4 + remotion/src/replay-tour.json
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, EMAIL, PASSWORD } from '../config.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
if (!PASSWORD) throw new Error('SOCTALK_PASSWORD not set — export it or add it to video/.env');

const root = path.join(import.meta.dirname, '..');
const REC = path.join(root, 'tmp', 'rec-replay-tour');
rmSync(REC, { recursive: true, force: true });
mkdirSync(REC, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

const INIT_JS = `
(() => {
	const style = () => {
		const s = document.createElement('style');
		s.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important} html{scrollbar-width:none!important}';
		document.documentElement.appendChild(s);
	};
	document.readyState === 'loading' ? addEventListener('DOMContentLoaded', style) : style();
	if (window.__tourCursor) return;
	window.__tourCursor = true;
	const mk = () => {
		const c = document.createElement('div');
		c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))';
		c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 2 L5 19 L9.5 15.5 L12.5 21.5 L15 20 L12 14.5 L18 14 Z" fill="#fff" stroke="#111" stroke-width="1.2"/></svg>';
		document.documentElement.appendChild(c);
		let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty;
		addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; }, true);
		addEventListener('mousedown', (e) => {
			const r = document.createElement('div');
			r.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:3px solid #4da3ff;border-radius:50%;width:14px;height:14px;left:' + (e.clientX - 7) + 'px;top:' + (e.clientY - 7) + 'px;opacity:.9';
			document.documentElement.appendChild(r);
			r.animate([{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 550, easing: 'ease-out' }).onfinish = () => r.remove();
		}, true);
		const tick = () => { x += (tx - x) * .22; y += (ty - y) * .22; c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; requestAnimationFrame(tick); };
		tick();
	};
	document.readyState === 'loading' ? addEventListener('DOMContentLoaded', mk) : mk();
})();`;

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: 1920, height: 1080 },
	recordVideo: { dir: REC, size: { width: 1920, height: 1080 } }
});
await context.addInitScript(INIT_JS);

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
const ev = {};
await page.goto(`${BASE}/`, { waitUntil: 'load' });
await page.locator(':is(h1,h2):has-text("Dashboard")').first().waitFor({ timeout: 15000 });
await page.mouse.move(960, 800);
ev.readyAt = now();
await sleep(2000);

ev.scrollStart = now();
const maxY = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
for (let i = 1; i <= 90; i++) {
	await page.evaluate((y) => window.scrollTo(0, y), maxY * easeInOut(i / 90));
	await sleep(6000 / 90);
}
ev.scrollBottom = now();
await sleep(1200);
for (let i = 1; i <= 50; i++) {
	await page.evaluate((y) => window.scrollTo(0, y), maxY * (1 - easeInOut(i / 50)));
	await sleep(2600 / 50);
}
await page.evaluate(() => window.scrollTo(0, 0));
ev.scrollTop = now();
await sleep(1000);

async function glideTo(x, y, ms = 700) {
	const cur = (await page.evaluate(() => window.__gp)) ?? { x: 960, y: 800 };
	for (let i = 1; i <= 30; i++) {
		const p = easeInOut(i / 30);
		await page.mouse.move(cur.x + (x - cur.x) * p, cur.y + (y - cur.y) * p);
		await sleep(ms / 30);
	}
	await page.evaluate(([a, b]) => (window.__gp = { x: a, y: b }), [x, y]);
}

const replayBtn = page.locator('button:has-text("Replay day")').first();
const b1 = await replayBtn.boundingBox();
await glideTo(b1.x + b1.width / 2, b1.y + b1.height / 2);
await sleep(300);
ev.replayClick = now();
await replayBtn.click();
await page.locator('text=Press play to replay').waitFor({ timeout: 10000 });
await sleep(1200);
const playBtn = page.locator('button:left-of(:text("Press play to replay"))').first();
const b2 = await playBtn.boundingBox();
await glideTo(b2.x + b2.width / 2, b2.y + b2.height / 2);
await sleep(300);
ev.playClick = now();
await playBtn.click();
await sleep(500);
await glideTo(400, 1010, 600);

const label = page.locator('text=/\\d{1,2}:\\d{2}\\s*\\/\\s*24h/').first();
for (let i = 0; i < 90; i++) {
	await sleep(1000);
	const t = ((await label.textContent().catch(() => '')) || '').trim();
	const h = parseInt(t.split(':')[0] || '0', 10);
	if (h >= 15) break;
}
await sleep(2000);
ev.endAt = now();
const video = page.video();
await page.close();
const webm = await video.path();
await browser.close();

const dest = path.join(root, 'remotion', 'public', 'scenes', 'replay-tour.mp4');
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', 'fps=30,scale=1920:1080', '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', dest]);
const videoDur = parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', dest]).toString());
const offset = Math.max(0, ev.endAt - videoDur);
const shifted = Object.fromEntries(Object.entries(ev).map(([k, v]) => [k, Math.max(0, v - offset)]));
shifted.videoDur = videoDur;
writeFileSync(path.join(root, 'remotion', 'src', 'replay-tour.json'), JSON.stringify(shifted, null, 2));
console.log('done:', dest, videoDur.toFixed(1) + 's — events', JSON.stringify(shifted));
