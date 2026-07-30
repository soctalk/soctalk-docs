// Stage 2 capture for the alert-walkthrough silent draft.
// Emits: scenes/walk-river.mp4, walk-<scene>.mp4 per dive/page scene, and
// remotion/src/walkthrough.json (windows, focus beats, narration, dot coords).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, EMAIL, PASSWORD } from '../config.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
if (!PASSWORD) throw new Error('SOCTALK_PASSWORD not set — export it or add it to video/.env');

const root = path.join(import.meta.dirname, '..');
const screenplay = (await import(path.join(root, 'screenplays', 'alert-walkthrough.mjs'))).default;
const sceneDir = path.join(root, 'remotion', 'public', 'scenes');
mkdirSync(sceneDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const estSec = (text) => text.length / 14;

const CURSOR_JS = `
(() => {
	if (window.__tourCursor) return;
	window.__tourCursor = true;
	const mk = () => {
		const c = document.createElement('div');
		c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))';
		c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 2 L5 19 L9.5 15.5 L12.5 21.5 L15 20 L12 14.5 L18 14 Z" fill="#fff" stroke="#111" stroke-width="1.2"/></svg>';
		document.documentElement.appendChild(c);
		let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty;
		addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; }, true);
		const tick = () => { x += (tx - x) * .22; y += (ty - y) * .22; c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; requestAnimationFrame(tick); };
		tick();
	};
	document.readyState === 'loading' ? addEventListener('DOMContentLoaded', mk) : mk();
})();`;
const HIDE_SCROLLBARS = `
(() => {
	const style = () => {
		const s = document.createElement('style');
		s.textContent = '*::-webkit-scrollbar{width:0!important;height:0!important} html{scrollbar-width:none!important}';
		document.documentElement.appendChild(s);
	};
	document.readyState === 'loading' ? addEventListener('DOMContentLoaded', style) : style();
})();`;

async function login(context) {
	const page = await context.newPage();
	await page.goto(`${BASE}/login`, { waitUntil: 'load' });
	await page.locator('input[type=email]').fill(EMAIL);
	await page.locator('input[type=password]').fill(PASSWORD);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL((u) => !u.pathname.includes('/login'));
	await page.close();
}

function encode(webm, dest, scale) {
	const vf = scale ? `fps=30,scale=${scale}` : 'fps=30';
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', dest]);
	return parseFloat(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', dest]).toString());
}

// ---------------------------------------------------------------- river take
async function captureRiver() {
	const REC = path.join(root, 'tmp', 'rec-walk-river');
	rmSync(REC, { recursive: true, force: true });
	mkdirSync(REC, { recursive: true });
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width: 2560, height: 1440 },
		recordVideo: { dir: REC, size: { width: 2560, height: 1440 } }
	});
	await context.addInitScript(HIDE_SCROLLBARS);
	await login(context);
	const page = await context.newPage();
	const t0 = Date.now();
	const now = () => (Date.now() - t0) / 1000;
	await page.goto(`${BASE}/`, { waitUntil: 'load' });
	await page.locator(':is(h1,h2):has-text("Dashboard")').first().waitFor({ timeout: 15000 });
	await sleep(1200);
	await page.locator('button:has-text("Replay day")').first().click();
	await page.locator('text=Press play to replay').waitFor({ timeout: 10000 });
	await sleep(600);
	// hide MODEL SPEND
	await page.evaluate(() => {
		const leaf = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && /^MODEL SPEND$/i.test(e.textContent.trim()));
		if (leaf) {
			let cell = leaf;
			while (cell.parentElement && cell.parentElement.childElementCount <= 2) cell = cell.parentElement;
			cell.style.visibility = 'hidden';
		}
	});
	const playBtn = page.locator('button:left-of(:text("Press play to replay"))').first();
	await playBtn.click();
	await page.evaluate(() => {
		const hint = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && /Press play to replay/.test(e.textContent));
		if (hint) {
			const row = hint.parentElement;
			row.style.display = 'none';
			const next = row.nextElementSibling;
			if (next && /Click a dot/i.test(next.textContent)) next.style.display = 'none';
		}
	});
	await sleep(800);
	const segStart = now();

	const readStat = (label) =>
		page.evaluate((l) => {
			const leaf = [...document.querySelectorAll('*')].find((e) => e.childElementCount === 0 && new RegExp(`^${l}$`, 'i').test(e.textContent.trim()));
			return parseInt(leaf?.parentElement?.textContent.replace(/[^0-9]/g, '') || '0', 10);
		}, label);

	let swarmAt = null;
	let plateauAt = null;
	let dots = { normal: null, veto: null };
	let last = -1;
	let stable = 0;
	for (let i = 0; i < 120; i++) {
		await sleep(1500);
		const v = await readStat('ALERTS IN');
		if (!swarmAt && v >= 150) swarmAt = now();
		// sample dot positions while the stream is dense
		if (v >= 100) {
			const s = await page.evaluate(() => {
				const pick = (sel) => {
					const el = document.querySelector(sel);
					if (!el) return null;
					const r = el.getBoundingClientRect();
					return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
				};
				return { normal: pick('circle.fdot.clickable:not(.veto)'), veto: pick('circle.fdot.veto.clickable') };
			});
			if (s.normal) dots.normal = s.normal;
			if (s.veto) dots.veto = s.veto;
		}
		if (v === last && v > 150) {
			stable++;
			if (stable >= 3 && !plateauAt) {
				plateauAt = now();
				break;
			}
		} else stable = 0;
		last = v;
	}
	// hold for the endcard window
	await sleep(15000);
	const counters = {
		alertsIn: await readStat('ALERTS IN'),
		closed: await readStat('CLOSED BY PIPELINE'),
		human: await readStat('REACHED A HUMAN')
	};
	const endAt = now();
	const video = page.video();
	await page.close();
	const webm = await video.path();
	await browser.close();

	const dest = path.join(sceneDir, 'walk-river.mp4');
	const videoDur = encode(webm, dest);
	const offset = Math.max(0, endAt - videoDur);
	const d = (t) => (t == null ? null : Math.max(0, t - offset));
	console.log(`river: ${videoDur.toFixed(1)}s, counters ${JSON.stringify(counters)}, dots ${JSON.stringify(dots)}`);
	// assert the numbers the narration speaks
	const spoken = { alertsIn: 276, closed: 232, human: 44 };
	for (const k of Object.keys(spoken))
		if (counters[k] !== spoken[k])
			throw new Error(`river counters diverged from narration: ${k} observed ${counters[k]}, narration says ${spoken[k]} — update screenplay or re-discover`);
	return { file: 'scenes/walk-river.mp4', videoDur, segStart: d(segStart), swarmAt: d(swarmAt), plateauAt: d(plateauAt), counters, dots };
}

// ------------------------------------------------------- dive / page scenes
async function capturePage(scene) {
	const REC = path.join(root, 'tmp', `rec-walk-${scene.id}`);
	rmSync(REC, { recursive: true, force: true });
	mkdirSync(REC, { recursive: true });
	const browser = await chromium.launch();
	const context = await browser.newContext({
		viewport: { width: 1920, height: 1080 },
		recordVideo: { dir: REC, size: { width: 1920, height: 1080 } }
	});
	await context.addInitScript(HIDE_SCROLLBARS + CURSOR_JS);
	await login(context);
	const page = await context.newPage();
	const t0 = Date.now();
	const now = () => (Date.now() - t0) / 1000;
	const mousePos = { x: 960, y: 540 };
	async function glide(x, y, ms = 650) {
		for (let i = 1; i <= 30; i++) {
			const p = easeInOut(i / 30);
			await page.mouse.move(mousePos.x + (x - mousePos.x) * p, mousePos.y + (y - mousePos.y) * p);
			await sleep(ms / 30);
		}
		mousePos.x = x;
		mousePos.y = y;
	}
	await page.goto(`${BASE}${scene.route}`, { waitUntil: 'load' });
	await page.locator(`:text("${scene.ready}")`).first().waitFor({ timeout: 15000 });
	for (const a of scene.assert ?? [])
		await page
			.locator(`:text("${a}")`)
			.first()
			.waitFor({ timeout: 5000 })
			.catch(() => {
				throw new Error(`scene "${scene.id}": assertion text "${a}" not found — demo drifted, re-discover`);
			});
	await page.mouse.move(960, 540);
	await sleep(1000);
	const est = estSec(scene.narration);
	const audioStart = now() + 0.3;
	const focusEvents = [];
	for (const f of [...(scene.focus ?? [])].sort((a, b) => a.frac - b.frac)) {
		const at = audioStart + f.frac * est;
		if (now() < at) await sleep((at - now()) * 1000);
		const box = await page.locator(f.selector).first().boundingBox({ timeout: 2500 }).catch(() => null);
		if (!box) {
			console.log(`capture: [${scene.id}] focus target missing (skipping): ${f.selector}`);
			continue;
		}
		const cx = Math.round(box.x + box.width / 2);
		const cy = Math.round(box.y + box.height / 2);
		focusEvents.push({ atSec: now(), x: cx, y: cy, scale: f.scale ?? 1.4, hold: f.hold ?? 2.2 });
		await glide(cx, cy);
	}
	const ZOOM_RAMP = 0.7;
	const lastZoomEnd = focusEvents.reduce((m, e) => Math.max(m, e.atSec + ZOOM_RAMP + e.hold + ZOOM_RAMP), 0);
	const end = Math.max(audioStart + est, lastZoomEnd) + 1.5;
	if (now() < end) await sleep((end - now()) * 1000);
	const wallDur = now();
	const video = page.video();
	await page.close();
	const webm = await video.path();
	await browser.close();
	const dest = path.join(sceneDir, `walk-${scene.id}.mp4`);
	const videoDur = encode(webm, dest, '1920:1080');
	const offset = Math.max(0, wallDur - videoDur);
	console.log(`${scene.id}: ${videoDur.toFixed(1)}s, ${focusEvents.length} focus beat(s)`);
	return {
		file: `scenes/walk-${scene.id}.mp4`,
		videoDur,
		audioStart: Math.max(0, audioStart - offset),
		focus: focusEvents.map((e) => ({ ...e, atSec: Math.max(0, e.atSec - offset) }))
	};
}

// ------------------------------------------------------------------ assemble
const river = await captureRiver();
const out = { river, scenes: [] };
for (const scene of screenplay.scenes) {
	const est = estSec(scene.narration);
	if (scene.kind === 'river') {
		let win;
		if (scene.window === 'dawn') win = [river.segStart, Math.min(river.segStart + est + 2, river.videoDur)];
		else if (scene.window === 'mid-morning') {
			const s = Math.max(river.segStart, (river.swarmAt ?? river.segStart + 20) - 2);
			win = [s, Math.min(s + est + 2, river.videoDur)];
		} else win = [Math.max(0, river.videoDur - est - 2.5), river.videoDur];
		out.scenes.push({ id: scene.id, kind: 'river', narration: scene.narration, estSec: est, window: win, endCard: !!scene.endCard, enterNextVia: null });
	} else {
		const cap = await capturePage(scene);
		out.scenes.push({ id: scene.id, kind: scene.kind, narration: scene.narration, estSec: est, ...cap, enterVia: scene.enterVia ?? null });
	}
}
// mark river scenes that precede a clickDot dive (for the ring transition)
for (let i = 0; i < out.scenes.length - 1; i++) {
	const nxt = out.scenes[i + 1];
	if (out.scenes[i].kind === 'river' && nxt.enterVia?.clickDot)
		out.scenes[i].enterNextVia = { clickDot: nxt.enterVia.clickDot, dot: river.dots[nxt.enterVia.clickDot] ?? null };
}
writeFileSync(path.join(root, 'remotion', 'src', 'walkthrough.json'), JSON.stringify(out, null, 2));
console.log('capture-walkthrough: done —', out.scenes.map((s) => `${s.id}(${s.kind})`).join(', '));
