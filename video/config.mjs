// Shared pipeline config. Everything is overridable via env so CI can inject
// its own target/credentials; secrets come from env or the gitignored .env
// beside this file (KEY=VALUE lines) — never from committed code.
import { readFileSync } from 'node:fs';
import path from 'node:path';
try {
	for (const line of readFileSync(path.join(import.meta.dirname, '.env'), 'utf8').split('\n')) {
		const m = line.match(/^([A-Z_]+)=(.*)$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
	}
} catch {}

export const BASE = process.env.SOCTALK_BASE ?? 'https://demo.soctalk.ai';
export const EMAIL = process.env.SOCTALK_EMAIL ?? 'ops@demo.soctalk.ai';
// no fallback: capture scripts check and fail loudly if unset
export const PASSWORD = process.env.SOCTALK_PASSWORD ?? null;

export const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY ?? null;
// "Chris" — premade voice (charming, down-to-earth American), usable via API
// on the free tier. Override per-locale with ELEVENLABS_VOICE_ID.
export const ELEVEN_VOICE = process.env.ELEVENLABS_VOICE_ID ?? 'iP95p4xoKVk53GoZ742B';
export const ELEVEN_MODEL = 'eleven_multilingual_v2';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
