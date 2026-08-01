// Generate a sidecar .srt for a walkthrough final (YouTube Captions API).
// Cue timing mirrors the composition: scene offsets from walkthrough.json,
// narration start/duration from the real TTS clips; multi-sentence lines are
// split into cues proportional to character share.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(path.join(root, 'remotion', 'src', 'walkthrough.json'), 'utf8'));
const narr = JSON.parse(readFileSync(path.join(root, 'tmp', 'narration.json'), 'utf8'));
const FPS = 30;

const sceneFrames = (s) =>
	s.kind === 'river'
		? Math.round((s.window[1] - s.window[0]) * FPS)
		: s.kind === 'card'
			? Math.round(s.dur * FPS)
			: Math.round(s.videoDur * FPS) - 1;

const fmt = (sec) => {
	const ms = Math.max(0, Math.round(sec * 1000));
	const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
	const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
	const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
	const f = String(ms % 1000).padStart(3, '0');
	return `${h}:${m}:${s},${f}`;
};

let cues = [];
let offset = 0;
for (const scene of data.scenes) {
	const dur = narr[scene.id]?.dur;
	if (dur) {
		const start = offset + (scene.audioStart ?? 0.3);
		const sentences = scene.narration.match(/[^.!?]+[.!?]+[\s”’"']*/g) ?? [scene.narration];
		const totalChars = sentences.reduce((a, s) => a + s.length, 0);
		let t = start;
		for (const s of sentences) {
			const d = Math.max(1.0, (s.length / totalChars) * dur);
			cues.push({ start: t, end: Math.min(t + d, start + dur), text: s.trim() });
			t += d;
		}
	}
	offset += sceneFrames(scene) / FPS;
}
const srt = cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join('\n');
const out = path.join(root, 'out', 'alert-walkthrough.srt');
writeFileSync(out, srt);
console.log(`make-srt: ${cues.length} cues → ${out} (video span ${fmt(offset)})`);
