// Sidecar .srt for the onboarding final. Scene offsets from onboard.json
// (uniform scene.dur), narration start/duration from the real TTS clips;
// multi-sentence lines split into cues proportional to character share.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const data = JSON.parse(readFileSync(path.join(root, 'remotion', 'src', 'onboard.json'), 'utf8'));
const narr = JSON.parse(readFileSync(path.join(root, 'tmp', 'narration.json'), 'utf8'));
const FPS = data.fps || 30;

const fmt = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
};

let cues = [], offset = 0;
for (const scene of data.scenes) {
  const dur = narr[scene.id]?.dur;
  const text = scene.narr;
  if (dur && text) {
    const start = offset + (scene.audioStart ?? 0.35);
    const sentences = text.match(/[^.!?]+[.!?]+[\s”’"']*/g) ?? [text];
    const totalChars = sentences.reduce((a, s) => a + s.length, 0);
    let t = start;
    for (const s of sentences) {
      const d = Math.max(1.0, (s.length / totalChars) * dur);
      cues.push({ start: t, end: Math.min(t + d, start + dur), text: s.trim() });
      t += d;
    }
  }
  offset += scene.dur;
}
const srt = cues.map((c, i) => `${i + 1}\n${fmt(c.start)} --> ${fmt(c.end)}\n${c.text}\n`).join('\n');
const out = path.join(root, 'out', `${process.argv[2] ?? 'onboarding'}.srt`);
writeFileSync(out, srt);
console.log(`onboard-srt: ${cues.length} cues → ${out} (video span ${fmt(offset)})`);
