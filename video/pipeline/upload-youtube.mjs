// YouTube upload smoke test.
//   node pipeline/upload-youtube.mjs --auth          one-time consent → refresh token into .env
//   node pipeline/upload-youtube.mjs <video.mp4> <captions.srt>   upload UNLISTED + captions
// Credentials: YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN in video/.env
// (config.mjs auto-loads .env). The OAuth client JSON in ~/Downloads seeds the
// first two on --auth if they're not in .env yet.
import { google } from 'googleapis';
import { createReadStream, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import '../config.mjs'; // loads .env into process.env

const root = path.join(import.meta.dirname, '..');
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const PORT = 8085;

// Newest client_secret*.json in ~/Downloads (so a freshly downloaded OAuth
// client just works — no filename juggling). Override with YT_CLIENT_JSON.
function clientFromDownloads() {
	if (process.env.YT_CLIENT_JSON) {
		const c = JSON.parse(readFileSync(process.env.YT_CLIENT_JSON, 'utf8'));
		const o = c.installed ?? c.web;
		return { id: o.client_id, secret: o.client_secret, project: o.project_id };
	}
	const dl = path.join(homedir(), 'Downloads');
	const files = readdirSync(dl)
		.filter((f) => f.startsWith('client_secret') && f.endsWith('.json'))
		.map((f) => ({ f, m: statSync(path.join(dl, f)).mtimeMs }))
		.sort((a, b) => b.m - a.m);
	if (!files.length) throw new Error('no YT_CLIENT_ID in .env and no client_secret*.json in ~/Downloads');
	const c = JSON.parse(readFileSync(path.join(dl, files[0].f), 'utf8'));
	const o = c.installed ?? c.web;
	console.log(`auth: using ${files[0].f} (project ${o.project_id})`);
	return { id: o.client_id, secret: o.client_secret, project: o.project_id };
}

// --auth always trusts the freshest client JSON (stale .env creds must not
// shadow a newly downloaded client); upload/update modes use .env.
const AUTH_MODE = process.argv[2] === '--auth';
const fresh = AUTH_MODE ? clientFromDownloads() : null;
let clientId, clientSecret;
if (fresh) ({ id: clientId, secret: clientSecret } = fresh);
else if (process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET) ({ YT_CLIENT_ID: clientId, YT_CLIENT_SECRET: clientSecret } = process.env);
else ({ id: clientId, secret: clientSecret } = clientFromDownloads());
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${PORT}`);

// upsert KEY=VALUE lines in .env (no duplicate keys on repeated --auth)
function saveEnv(entries) {
	const envPath = path.join(root, '.env');
	let lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split('\n') : [];
	for (const [k, v] of Object.entries(entries)) {
		lines = lines.filter((l) => !l.startsWith(`${k}=`));
		lines.push(`${k}=${v}`);
	}
	writeFileSync(envPath, lines.filter(Boolean).join('\n') + '\n');
}

if (AUTH_MODE) {
	const url = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
	const timeout = setTimeout(() => {
		console.error('auth: no consent within 5 minutes — giving up');
		process.exit(1);
	}, 300000);
	const server = createServer(async (req, res) => {
		const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
		if (!code) {
			res.end('no code');
			return;
		}
		server.close();
		clearTimeout(timeout);
		try {
			const { tokens } = await oauth2.getToken(code);
			if (!tokens.refresh_token)
				throw new Error('Google returned no refresh_token — revoke the app at myaccount.google.com/permissions and re-run --auth');
			saveEnv({ YT_CLIENT_ID: clientId, YT_CLIENT_SECRET: clientSecret, YT_REFRESH_TOKEN: tokens.refresh_token });
			res.end('SocTalk uploader authorized — you can close this tab.');
			console.log('auth: refresh token saved to video/.env');
			process.exit(0);
		} catch (e) {
			res.end('Authorization FAILED: ' + e.message);
			console.error('auth failed:', e.message);
			process.exit(1);
		}
	});
	server.on('error', (e) => {
		throw new Error(`auth listener failed on port ${PORT} (${e.code}) — is another --auth still running?`);
	});
	server.listen(PORT, () => {
		console.log('auth: opening browser for consent…');
		execFileSync('open', [url]);
	});
} else {
	if (!process.env.YT_REFRESH_TOKEN) throw new Error('no YT_REFRESH_TOKEN — run with --auth first');
	oauth2.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
	const yt = google.youtube({ version: 'v3', auth: oauth2 });

	const TITLE = 'SocTalk: The Life of an Alert';
	// Content-only description, plain punctuation (no em dashes). The
	// altered-content disclosure is YouTube's Studio flag, not description
	// text.
	const DESCRIPTION = [
		"One tenant, one day of alerts, replayed end to end. This walkthrough follows real alerts through SocTalk's triage pipeline and shows where automation stops and a human decides.",
		'',
		'0:00 The day, replayed: 276 alerts through the pipeline',
		'0:16 A false positive closed on the first pass, zero model cost',
		'0:55 A model verdict overruled: the guard blocks an auto-close with no authorization behind it',
		'1:21 The human review queue, with the full case in front of an analyst',
		'2:14 End of day: what closed automatically, what reached a person',
		'',
		'Built for SOC and MSSP teams drowning in alert volume.',
		'Docs and a live demo: https://soctalk.ai'
	].join('\n');
	const TAGS = ['SocTalk', 'SOC', 'security operations', 'AI triage', 'MSSP', 'alert triage'];

	// --delete <videoId>: remove a superseded upload
	if (process.argv[2] === '--delete') {
		const videoId = process.argv[3];
		if (!videoId) throw new Error('usage: --delete <videoId>');
		await yt.videos.delete({ id: videoId });
		console.log(`deleted: ${videoId}`);
		process.exit(0);
	}

	// --update <videoId>: patch metadata on an existing video (keeps the link)
	if (process.argv[2] === '--update') {
		const videoId = process.argv[3];
		if (!videoId) throw new Error('usage: --update <videoId>');
		const cur = await yt.videos.list({ part: ['snippet'], id: [videoId] });
		const snippet = cur.data.items?.[0]?.snippet;
		if (!snippet) throw new Error(`video ${videoId} not found`);
		Object.assign(snippet, { title: TITLE, description: DESCRIPTION, tags: TAGS, categoryId: '28' });
		await yt.videos.update({ part: ['snippet'], requestBody: { id: videoId, snippet } });
		console.log(`metadata updated: https://youtu.be/${videoId}`);
		process.exit(0);
	}

	const [videoFile, srtFile] = [process.argv[2], process.argv[3]];
	if (!videoFile) throw new Error('usage: upload-youtube.mjs <video.mp4> [captions.srt] | --update <id> | --auth');

	for (const f of [videoFile, srtFile].filter(Boolean))
		if (!existsSync(f)) throw new Error(`file not found: ${f}`);
	console.log('uploading', videoFile, '…');
	const res = await yt.videos.insert({
		part: ['snippet', 'status'],
		requestBody: {
			snippet: { title: TITLE, description: DESCRIPTION, tags: TAGS, categoryId: '28' },
			status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false }
		},
		notifySubscribers: false,
		media: { body: createReadStream(videoFile) }
	});
	const videoId = res.data.id;
	console.log(`video uploaded: https://youtu.be/${videoId} (unlisted)`);

	if (srtFile) {
		await yt.captions.insert({
			part: ['snippet'],
			requestBody: { snippet: { videoId, language: 'en', name: 'English' } },
			media: { mimeType: 'application/octet-stream', body: createReadStream(srtFile) }
		});
		console.log('captions uploaded (en)');
	}
	console.log('smoke test complete');
}
