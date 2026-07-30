// Stage 2: capture. Logs into the live demo, records one video per scene
// (new page per scene → one webm each), glides a fake cursor to the focus
// targets, and emits remotion/src/manifest.json with zoom keyframes.
//
// Readiness is strict (missing heading aborts the run — better no video than
// a broken one); individual focus targets are best-effort (a moved button
// downgrades to a skipped beat, not a failed render).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { BASE, EMAIL, PASSWORD, FPS, WIDTH, HEIGHT } from '../config.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');

if (!PASSWORD) throw new Error('SOCTALK_PASSWORD not set — export it or add it to video/.env');

const root = path.join(import.meta.dirname, '..');
const tmpDir = path.join(root, 'tmp', 'rec');
const sceneDir = path.join(root, 'remotion', 'public', 'scenes');
rmSync(tmpDir, { recursive: true, force: true });
mkdirSync(tmpDir, { recursive: true });
mkdirSync(sceneDir, { recursive: true });

const screenplay = (await import(process.argv[2])).default;
const narration = (await import(path.join(root, 'tmp', 'narration.json'), { with: { type: 'json' } })).default;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOut = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

// Fake cursor: pointer-events-none overlay that chases real mousemove events
// with slight smoothing, plus a ripple on mousedown. Re-injected on every
// navigation via addInitScript.
const CURSOR_JS = `
(() => {
	if (window.__tourCursor) return;
	window.__tourCursor = true;
	const mk = () => {
		const c = document.createElement('div');
		c.id = '__tour_cursor';
		c.style.cssText = 'position:fixed;left:0;top:0;width:26px;height:26px;z-index:2147483647;pointer-events:none;transition:none;filter:drop-shadow(0 1px 2px rgba(0,0,0,.6))';
		c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 2 L5 19 L9.5 15.5 L12.5 21.5 L15 20 L12 14.5 L18 14 Z" fill="#fff" stroke="#111" stroke-width="1.2"/></svg>';
		document.documentElement.appendChild(c);
		let tx = innerWidth / 2, ty = innerHeight / 2, x = tx, y = ty;
		addEventListener('mousemove', (e) => { tx = e.clientX; ty = e.clientY; }, true);
		addEventListener('mousedown', (e) => {
			const r = document.createElement('div');
			r.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:3px solid #4da3ff;border-radius:50%;width:14px;height:14px;left:' + (e.clientX - 7) + 'px;top:' + (e.clientY - 7) + 'px;opacity:.9;transform:scale(1)';
			document.documentElement.appendChild(r);
			r.animate([{ transform: 'scale(1)', opacity: .9 }, { transform: 'scale(3.2)', opacity: 0 }], { duration: 550, easing: 'ease-out' }).onfinish = () => r.remove();
		}, true);
		const tick = () => { x += (tx - x) * .22; y += (ty - y) * .22; c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; requestAnimationFrame(tick); };
		tick();
	};
	document.readyState === 'loading' ? addEventListener('DOMContentLoaded', mk) : mk();
})();`;

const consoleErrors = [];
// Known-benign demo noise: pre-auth session probe 401, engagements-tab 403.
const ALLOWLIST = [/\[login\].*401/, /my-authorization.*403/];

const browser = await chromium.launch();
const context = await browser.newContext({
	viewport: { width: WIDTH, height: HEIGHT },
	recordVideo: { dir: tmpDir, size: { width: WIDTH, height: HEIGHT } }
});
await context.addInitScript(CURSOR_JS);

const mousePos = { x: WIDTH / 2, y: HEIGHT / 2 };
async function glide(page, x, y, ms = 650) {
	const from = { ...mousePos };
	const steps = Math.max(12, Math.round(ms / 25));
	for (let i = 1; i <= steps; i++) {
		const p = easeInOut(i / steps);
		await page.mouse.move(from.x + (x - from.x) * p, from.y + (y - from.y) * p);
		await sleep(ms / steps);
	}
	mousePos.x = x;
	mousePos.y = y;
}

function attachErrorCollector(page, sceneId) {
	page.on('console', (m) => {
		if (m.type() === 'error') consoleErrors.push(`[${sceneId}] ${m.text()}`);
	});
}

// --- login (this page's recording is discarded) ---
const login = await context.newPage();
attachErrorCollector(login, 'login');
await login.goto(`${BASE}/login`, { waitUntil: 'load', timeout: 30000 });
await login.locator('input[type=email]').fill(EMAIL);
await login.locator('input[type=password]').fill(PASSWORD);
await login.getByRole('button', { name: 'Sign in' }).click();
await login.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 20000 });
await login.close();
console.log('capture: login OK');

// --- scenes ---
const scenes = [];
for (const scene of screenplay.scenes) {
	const audio = narration[scene.id];
	if (!audio) throw new Error(`no narration for scene "${scene.id}"`);
	const page = await context.newPage();
	attachErrorCollector(page, scene.id);
	const t0 = Date.now();
	const now = () => (Date.now() - t0) / 1000;

	await page.goto(`${BASE}${scene.route}`, { waitUntil: 'load', timeout: 30000 });
	await page.locator(`:is(h1,h2):has-text("${scene.ready}")`).first()
		.waitFor({ timeout: 15000 })
		.catch(() => {
			throw new Error(`scene "${scene.id}": readiness heading "${scene.ready}" never appeared — aborting`);
		});
	await page.mouse.move(mousePos.x, mousePos.y); // materialize cursor
	await sleep(600); // let data below the heading settle
	const audioStart = now() + 0.3;

	const focusEvents = [];
	for (const f of [...(scene.focus ?? [])].sort((a, b) => a.frac - b.frac)) {
		const at = audioStart + f.frac * audio.dur;
		if (now() < at) await sleep((at - now()) * 1000);
		const box = await page.locator(f.selector).first().boundingBox({ timeout: 2500 }).catch(() => null);
		if (!box) {
			console.log(`capture: [${scene.id}] focus target not found, skipping: ${f.selector}`);
			continue;
		}
		const cx = Math.round(box.x + box.width / 2);
		const cy = Math.round(box.y + box.height / 2);
		// Keyframe at glide start so the zoom ramps while the cursor travels;
		// recording it after the glide made every zoom ~0.9s late.
		focusEvents.push({ atSec: now(), x: cx, y: cy, scale: f.scale ?? 1.4, hold: f.hold ?? 2.2 });
		await glide(page, cx, cy);
	}

	// Hold until both the narration AND the last zoom (ramp+hold+ramp) finish,
	// so a late beat is never truncated by the scene cut.
	const ZOOM_RAMP = 0.7;
	const lastZoomEnd = focusEvents.reduce(
		(m, e) => Math.max(m, e.atSec + ZOOM_RAMP + e.hold + ZOOM_RAMP),
		0
	);
	const end = Math.max(audioStart + audio.dur, lastZoomEnd) + 1.2;
	if (now() < end) await sleep((end - now()) * 1000);

	const wallDur = now();
	const video = page.video();
	await page.close();
	const webm = await video.path();
	const mp4 = path.join(sceneDir, `${scene.id}.mp4`);
	execFileSync('ffmpeg', [
		'-y', '-loglevel', 'error', '-i', webm,
		'-vf', `fps=${FPS},scale=${WIDTH}:${HEIGHT}`,
		'-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-an', mp4
	]);
	const videoDur = parseFloat(
		execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', mp4]).toString()
	);
	// The recording starts at first paint, not page creation, so the encoded
	// clip is shorter than the wall clock. Shift all wall-clock timestamps
	// onto the video timeline by the measured head offset, then verify
	// narration and zooms actually fit inside the clip.
	const offset = Math.max(0, wallDur - videoDur);
	const shiftedStart = Math.max(0, audioStart - offset);
	const shiftedFocus = focusEvents.map((e) => ({ ...e, atSec: Math.max(0, e.atSec - offset) }));
	const shiftedZoomEnd = shiftedFocus.reduce(
		(m, e) => Math.max(m, e.atSec + ZOOM_RAMP + e.hold + ZOOM_RAMP),
		0
	);
	const needed = Math.max(shiftedStart + audio.dur, shiftedZoomEnd) + 0.3;
	if (videoDur < needed)
		throw new Error(
			`scene "${scene.id}": clip is ${videoDur.toFixed(2)}s but narration/zooms need ${needed.toFixed(2)}s — aborting`
		);
	scenes.push({
		id: scene.id,
		label: scene.label,
		video: `scenes/${scene.id}.mp4`,
		videoDur,
		audio: audio.file,
		audioDur: audio.dur,
		audioStart: shiftedStart,
		focus: shiftedFocus
	});
	console.log(
		`capture: ${scene.id} — ${videoDur.toFixed(1)}s video, narration ${audio.dur.toFixed(1)}s @ ${audioStart.toFixed(1)}s, ${focusEvents.length} focus beat(s)`
	);
}

await browser.close();
rmSync(tmpDir, { recursive: true, force: true });

const unexpected = [...new Set(consoleErrors)].filter((e) => !ALLOWLIST.some((re) => re.test(e)));
if (unexpected.length) {
	console.log(`capture: ${unexpected.length} unexpected console error(s):`);
	for (const e of unexpected.slice(0, 10)) console.log('  ' + e);
	// Unattended runs must not publish footage of a broken UI. Set
	// SOCTALK_IGNORE_CONSOLE_ERRORS=1 to tolerate known-noisy demo states.
	if (!process.env.SOCTALK_IGNORE_CONSOLE_ERRORS)
		throw new Error('capture: unexpected console errors — aborting (SOCTALK_IGNORE_CONSOLE_ERRORS=1 to override)');
}

const manifest = {
	title: screenplay.title,
	subtitle: screenplay.subtitle,
	fps: FPS,
	width: WIDTH,
	height: HEIGHT,
	scenes
};
writeFileSync(path.join(root, 'remotion', 'src', 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`capture: done — ${scenes.length} scenes → remotion/src/manifest.json`);
