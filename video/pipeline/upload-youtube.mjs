// YouTube upload smoke test.
//   node pipeline/upload-youtube.mjs --auth          one-time consent → refresh token into .env
//   node pipeline/upload-youtube.mjs <video.mp4> <captions.srt>   upload UNLISTED + captions
// Credentials: YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN in video/.env
// (config.mjs auto-loads .env). The OAuth client JSON in ~/Downloads seeds the
// first two on --auth if they're not in .env yet.
import { google } from 'googleapis';
import { createReadStream, readFileSync, appendFileSync, readdirSync, statSync } from 'node:fs';
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

const clientId = process.env.YT_CLIENT_ID ?? clientFromDownloads().id;
const clientSecret = process.env.YT_CLIENT_SECRET ?? clientFromDownloads().secret;
const oauth2 = new google.auth.OAuth2(clientId, clientSecret, `http://localhost:${PORT}`);

if (process.argv[2] === '--auth') {
	const url = oauth2.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: SCOPES });
	const server = createServer(async (req, res) => {
		const code = new URL(req.url, `http://localhost:${PORT}`).searchParams.get('code');
		if (!code) {
			res.end('no code');
			return;
		}
		res.end('SocTalk uploader authorized — you can close this tab.');
		server.close();
		const { tokens } = await oauth2.getToken(code);
		const envPath = path.join(root, '.env');
		appendFileSync(
			envPath,
			`YT_CLIENT_ID=${clientId}\nYT_CLIENT_SECRET=${clientSecret}\nYT_REFRESH_TOKEN=${tokens.refresh_token}\n`
		);
		console.log('auth: refresh token saved to video/.env');
		process.exit(0);
	});
	server.listen(PORT, () => {
		console.log('auth: opening browser for consent…');
		execFileSync('open', [url]);
	});
} else {
	const [videoFile, srtFile] = [process.argv[2], process.argv[3]];
	if (!videoFile) throw new Error('usage: upload-youtube.mjs <video.mp4> [captions.srt]');
	if (!process.env.YT_REFRESH_TOKEN) throw new Error('no YT_REFRESH_TOKEN — run with --auth first');
	oauth2.setCredentials({ refresh_token: process.env.YT_REFRESH_TOKEN });
	const yt = google.youtube({ version: 'v3', auth: oauth2 });

	console.log('uploading', videoFile, '…');
	const res = await yt.videos.insert({
		part: ['snippet', 'status'],
		requestBody: {
			snippet: {
				title: 'SocTalk — The Life of an Alert (walkthrough)',
				description:
					'One tenant, one day, replayed: how SocTalk triages alerts — rules first, model verdicts checked by a safety guard, and humans making the calls that matter.\n\nVisit us: https://soctalk.ai\n\nNarration is AI-generated. Screens show a demo environment.',
				tags: ['SocTalk', 'SOC', 'security operations', 'AI triage'],
				categoryId: '28'
			},
			status: { privacyStatus: 'unlisted', selfDeclaredMadeForKids: false }
		},
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
