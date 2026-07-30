// Orchestrator: screenplay in, mp4 out, no manual steps.
//   node run.mjs [screenplays/quick-tour.mjs]
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const root = import.meta.dirname;
const screenplay = path.resolve(root, process.argv[2] ?? 'screenplays/quick-tour.mjs');
const id = path.basename(screenplay, '.mjs');
mkdirSync(path.join(root, 'out'), { recursive: true });

const run = (label, cmd) => {
	console.log(`\n=== ${label} ===`);
	const t = Date.now();
	execSync(cmd, { cwd: root, stdio: 'inherit' });
	console.log(`=== ${label} done in ${((Date.now() - t) / 1000).toFixed(0)}s ===`);
};

run('1/3 narrate', `node pipeline/narrate.mjs "${screenplay}"`);
run('2/3 capture', `node pipeline/capture.mjs "${screenplay}"`);
run(
	'3/3 render',
	`npx remotion render remotion/src/index.jsx Tour "out/${id}.mp4" --public-dir=remotion/public --log=error`
);
console.log(`\nDone → ${path.join(root, 'out', `${id}.mp4`)}`);
