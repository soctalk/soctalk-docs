// Stage 1: narration. ElevenLabs when ELEVENLABS_API_KEY is set, macOS `say`
// otherwise (placeholder voice, same pipeline). Clips are cached by content
// hash so tweaking one sentence only regenerates that scene.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { ELEVEN_KEY, ELEVEN_VOICE, ELEVEN_MODEL } from '../config.mjs';

const root = path.join(import.meta.dirname, '..');
const cacheDir = path.join(root, 'cache');
const audioDir = path.join(root, 'remotion', 'public', 'audio');
mkdirSync(cacheDir, { recursive: true });
mkdirSync(audioDir, { recursive: true });
mkdirSync(path.join(root, 'tmp'), { recursive: true });

const screenplay = (await import(process.argv[2])).default;

function probeDuration(file) {
	return parseFloat(
		execFileSync('ffprobe', [
			'-v', 'error',
			'-show_entries', 'format=duration',
			'-of', 'default=nw=1:nk=1',
			file
		]).toString()
	);
}

// Timeout + one retry so a network stall can't hang an unattended run. A
// definitive API failure still throws: silently shipping the fallback voice
// would be worse than no video.
async function elevenlabs(text, out, attempt = 1) {
	try {
		const res = await fetch(
			`https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE}?output_format=mp3_44100_128`,
			{
				method: 'POST',
				headers: { 'xi-api-key': ELEVEN_KEY, 'content-type': 'application/json' },
				signal: AbortSignal.timeout(60000),
				body: JSON.stringify({
					text,
					model_id: ELEVEN_MODEL,
					voice_settings: { stability: 0.5, similarity_boost: 0.75 }
				})
			}
		);
		if (res.status === 429 || res.status >= 500)
			throw new Error(`ElevenLabs ${res.status} (retryable)`);
		if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${await res.text()}`);
		writeFileSync(out, Buffer.from(await res.arrayBuffer()));
	} catch (e) {
		const retryable = /retryable|TimeoutError|fetch failed/i.test(String(e.name) + String(e));
		if (attempt < 3 && retryable) {
			console.log(`narrate: ${e} — retrying (${attempt}/2)`);
			await new Promise((r) => setTimeout(r, 3000 * attempt));
			return elevenlabs(text, out, attempt + 1);
		}
		throw e;
	}
}

function macSay(text, out) {
	const aiff = out.replace(/\.mp3$/, '.aiff');
	execFileSync('say', ['-v', 'Samantha', '-r', '178', '-o', aiff, text]);
	execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff, '-b:a', '128k', out]);
	rmSync(aiff);
}

const engine = ELEVEN_KEY ? `elevenlabs/${ELEVEN_VOICE}` : 'macos-say/Samantha (fallback)';
console.log(`narrate: engine = ${engine}`);
if (!ELEVEN_KEY)
	console.log('narrate: WARNING — no ELEVENLABS_API_KEY set, using placeholder voice');

const narration = {};
for (const scene of screenplay.scenes) {
	const hash = createHash('sha256')
		.update([engine, ELEVEN_MODEL, scene.narration].join('\x00'))
		.digest('hex')
		.slice(0, 16);
	const cached = path.join(cacheDir, `${hash}.mp3`);
	if (!existsSync(cached)) {
		console.log(`narrate: generating "${scene.id}" (${scene.narration.length} chars)`);
		if (ELEVEN_KEY) await elevenlabs(scene.narration, cached);
		else macSay(scene.narration, cached);
	} else {
		console.log(`narrate: cache hit for "${scene.id}"`);
	}
	const dest = path.join(audioDir, `${scene.id}.mp3`);
	copyFileSync(cached, dest);
	narration[scene.id] = { file: `audio/${scene.id}.mp3`, dur: probeDuration(dest) };
}

writeFileSync(path.join(root, 'tmp', 'narration.json'), JSON.stringify(narration, null, 2));
console.log(
	`narrate: done — ${Object.keys(narration).length} clips, total ${Object.values(narration)
		.reduce((a, n) => a + n.dur, 0)
		.toFixed(1)}s`
);
