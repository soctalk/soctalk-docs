// Adapter so pipeline/narrate.mjs can voice the onboarding video.
// Presents onboard.json scenes as {id, narration} (narrate keys audio by id).
import { readFileSync } from 'node:fs';
import path from 'node:path';
const o = JSON.parse(readFileSync(path.join(import.meta.dirname, '..', 'remotion', 'src', 'onboard.json'), 'utf8'));
export default { scenes: o.scenes.map((s) => ({ id: s.id, narration: s.narr })) };
