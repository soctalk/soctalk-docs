#!/usr/bin/env node
// Generate the REST API endpoint catalog in docs/reference/api.md straight from
// the OpenAPI schema (docs/public/openapi.json, itself emitted from the FastAPI
// code by soctalk's scripts/dump_openapi.py). The catalog can therefore never
// drift from the code. Only the region between the GENERATED markers in api.md
// is rewritten; the curated prose around it is left untouched.
//
//   npm run gen:api
//
// Regenerate the spec first (in the soctalk repo):
//   python scripts/dump_openapi.py <this-repo>/docs/public/openapi.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SPEC = resolve(here, '../docs/public/openapi.json');
const PAGE = resolve(here, '../docs/reference/api.md');
const BEGIN = '<!-- BEGIN GENERATED:endpoints (do not edit — npm run gen:api) -->';
const END = '<!-- END GENERATED:endpoints -->';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

const spec = JSON.parse(readFileSync(SPEC, 'utf8'));

// Collect operations grouped by their first tag.
const groups = new Map();
let opCount = 0;
for (const [path, item] of Object.entries(spec.paths ?? {})) {
	for (const method of METHODS) {
		const op = item[method];
		if (!op) continue;
		opCount++;
		const tag = (op.tags && op.tags[0]) || 'other';
		if (!groups.has(tag)) groups.set(tag, []);
		groups.get(tag).push({
			method: method.toUpperCase(),
			path,
			summary: (op.summary || '').trim(),
			auth: op['x-soctalk-auth'] || '—',
		});
	}
}

const esc = (s) => s.replace(/\|/g, '\\|');
const methodOrder = { GET: 0, POST: 1, PUT: 2, PATCH: 3, DELETE: 4 };

const lines = [];
lines.push(BEGIN);
lines.push('');
lines.push(
	`_${opCount} operations across ${groups.size} groups, generated from the OpenAPI schema ` +
		`(API version \`${spec.info?.version ?? '?'}\`). Auth is derived from the route's ` +
		'`require_role` / `require_tenant_role` guards._',
);
lines.push('');

for (const tag of [...groups.keys()].sort()) {
	const rows = groups.get(tag).sort(
		(a, b) => a.path.localeCompare(b.path) || methodOrder[a.method] - methodOrder[b.method],
	);
	lines.push(`### \`${tag}\``);
	lines.push('');
	lines.push('| Method | Path | Summary | Auth |');
	lines.push('|---|---|---|---|');
	for (const r of rows) {
		lines.push(
			`| \`${r.method}\` | \`${esc(r.path)}\` | ${esc(r.summary) || '—'} | ${esc(r.auth)} |`,
		);
	}
	lines.push('');
}
lines.push(END);

const page = readFileSync(PAGE, 'utf8');
const b = page.indexOf(BEGIN);
const e = page.indexOf(END);
if (b === -1 || e === -1) {
	console.error(`Markers not found in ${PAGE}. Add:\n${BEGIN}\n${END}`);
	process.exit(1);
}
const next = page.slice(0, b) + lines.join('\n') + page.slice(e + END.length);
writeFileSync(PAGE, next);
console.error(`gen:api — wrote ${opCount} operations, ${groups.size} groups into ${PAGE}`);
