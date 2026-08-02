// Stage 2 capture for the alert-walkthrough silent draft.
// Emits: scenes/walk-river.mp4, walk-<scene>.mp4 per dive/page scene, and
// remotion/src/walkthrough.json (windows, focus beats, narration, dot coords).
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, EMAIL, PASSWORD } from '../config.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
if (!PASSWORD) throw new Error('SOCTALK_PASSWORD not set — export it or add it to video/.env');

const root = path.join(import.meta.dirname, '..');
// screenplay path is parameterized for future tutorials; outputs keep the
// walk-* / walkthrough.json names until a second tutorial needs its own set
const screenplayPath = process.argv[2]
	? path.resolve(process.argv[2])
	: path.join(root, 'screenplays', 'alert-walkthrough.mjs');
const screenplay = (await import(screenplayPath)).default;
const sceneDir = path.join(root, 'remotion', 'public', 'scenes');
mkdirSync(sceneDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const estSec = (text) => text.length / 14;

// If narrate.mjs has run (Stage 3), pace scenes to the REAL audio durations
// and mark the output as final so the composition adds voice + drops chrome.
let narr = {};
try {
	narr = JSON.parse(readFileSync(path.join(root2(), 'tmp', 'narration.json'), 'utf8'));
} catch {}
function root2() {
	return path.join(import.meta.dirname, '..');
}
const paceSec = (scene) => narr[scene.id]?.dur ?? estSec(scene.narration);

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
	// hold long enough that the endcard window can start AT the plateau
	await sleep(26000);
	const counters = {
		alertsIn: await readStat('ALERTS IN'),
		closed: await readStat('CLOSED BY PIPELINE'),
		human: await readStat('REACHED A HUMAN'),
		blocked: await readStat('BLOCKED AUTO-CLOSES')
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
	const spoken = { alertsIn: 276, closed: 232, human: 44, blocked: 33 };
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
	if (scene.preClick) {
		// filmed, read-only click (e.g. expanding a case panel)
		const box = await page.evaluate(
			([rowText, btnText]) => {
				const row = [...document.querySelectorAll('*')].find(
					(e) => e.childElementCount === 0 && e.textContent.includes(rowText)
				);
				if (!row) return null;
				const ry = row.getBoundingClientRect().y;
				const btn = [...document.querySelectorAll('button')].find(
					(b) => b.textContent.trim() === btnText && Math.abs(b.getBoundingClientRect().y - ry) < 40
				);
				if (!btn) return null;
				const r = btn.getBoundingClientRect();
				return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
			},
			[scene.preClick.nearRow, scene.preClick.button]
		);
		if (!box) throw new Error(`scene "${scene.id}": preClick target not found — demo drifted, re-discover`);
		await glide(box.x, box.y);
		await sleep(250);
		await page.mouse.down();
		await page.mouse.up();
		for (const t of scene.preClick.expect ?? [])
			await page
				.locator(`:text("${t}")`)
				.first()
				.waitFor({ timeout: 6000 })
				.catch(() => {
					throw new Error(`scene "${scene.id}": after click, expected "${t}" — not found`);
				});
		await sleep(900);
	}
	const est = paceSec(scene);
	const audioStart = now() + 0.3;
	const focusEvents = [];
	for (const f of [...(scene.focus ?? [])].sort((a, b) => a.frac - b.frac)) {
		const at = audioStart + f.frac * est;
		if (now() < at) await sleep((at - now()) * 1000);
		let box;
		if (f.nearRow) {
			// scope the target to the pinned row (e.g. the row's Review button)
			box = await page.evaluate(
				([rowText, btnText]) => {
					const row = [...document.querySelectorAll('*')].find(
						(e) => e.childElementCount === 0 && e.textContent.includes(rowText)
					);
					if (!row) return null;
					const ry = row.getBoundingClientRect().y;
					const btn = [...document.querySelectorAll('button')].find(
						(b) => b.textContent.trim() === btnText && Math.abs(b.getBoundingClientRect().y - ry) < 40
					);
					if (!btn) return null;
					const r = btn.getBoundingClientRect();
					return { x: r.x, y: r.y, width: r.width, height: r.height };
				},
				[f.nearRow, 'Review']
			);
		} else {
			box = await page.locator(f.selector).first().boundingBox({ timeout: 2500 }).catch(() => null);
		}
		if (!box) {
			if (f.optional) {
				console.log(`capture: [${scene.id}] optional focus target missing (skipping): ${f.selector}`);
				continue;
			}
			throw new Error(`scene "${scene.id}": required focus target missing: ${f.selector} — demo drifted, re-discover`);
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
const out = { river, final: screenplay.scenes.every((s) => narr[s.id]), scenes: [] };
for (const scene of screenplay.scenes) {
	const est = paceSec(scene);
	if (scene.kind === 'card') {
		out.scenes.push({
			id: scene.id,
			kind: 'card',
			narration: scene.narration,
			estSec: est,
			dur: est + 2.5,
			audio: narr[scene.id]?.file ?? null,
			audioStart: 0.6
		});
		continue;
	}
	if (scene.kind === 'river') {
		let win;
		if (scene.window === 'dawn') win = [river.segStart, Math.min(river.segStart + est + 2, river.videoDur)];
		else if (scene.window === 'mid-morning') {
			const s = Math.max(river.segStart, (river.swarmAt ?? river.segStart + 20) - 2);
			win = [s, Math.min(s + est + 2, river.videoDur)];
		} else {
			// day-complete: start AT the plateau so final counters are on screen
			// for the whole closing line
			const s = Math.min((river.plateauAt ?? river.videoDur - est - 2.5) + 0.5, Math.max(0, river.videoDur - est - 2));
			// cap the tail: narration + a short beat, no dead air before the outro
			win = [s, Math.min(river.videoDur, s + est + 2.3)];
		}
		out.scenes.push({
			id: scene.id,
			kind: 'river',
			narration: scene.narration,
			estSec: est,
			window: win,
			endCard: !!scene.endCard,
			enterNextVia: null,
			audio: narr[scene.id]?.file ?? null,
			audioStart: 0.3
		});
	} else {
		const cap = await capturePage(scene);
		out.scenes.push({
			id: scene.id,
			kind: scene.kind,
			narration: scene.narration,
			estSec: est,
			...cap,
			enterVia: scene.enterVia ?? null,
			audio: narr[scene.id]?.file ?? null
		});
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
