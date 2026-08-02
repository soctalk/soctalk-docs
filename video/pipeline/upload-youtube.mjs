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

	const LOCALES = {
		en: {
			title: 'SocTalk: The Life of an Alert',
			captionLang: 'en',
			captionName: 'English',
			linkComment: 'Docs and a live demo: https://soctalk.ai/',
			description: [
				"One tenant, one day of alerts, replayed end to end. This walkthrough follows real alerts through SocTalk's triage pipeline and shows where automation stops and a human decides.",
				'',
				'0:00 The day, replayed: 276 alerts through the pipeline',
				'0:16 A false positive closed on the first pass, zero model cost',
				'0:55 A model verdict overruled: the guard blocks an auto-close with no authorization behind it',
				'1:21 The human review queue, with the full case in front of an analyst',
				'2:14 End of day: what closed automatically, what reached a person',
				'',
				'Built for SOC and MSSP teams drowning in alert volume.',
				'En español: https://youtu.be/dTIXCcVF4v8',
				'Em português: https://youtu.be/TEVrV3pulq0',
				'Docs and a live demo: https://soctalk.ai/'
			].join('\n')
		},
		es: {
			title: 'SocTalk: La vida de una alerta',
			captionLang: 'es-419',
			captionName: 'Español (Latinoamérica)',
			linkComment: 'Documentación y demo en vivo: https://soctalk.ai/',
			description: [
				'Un tenant, un día completo de alertas, reproducido de principio a fin. Este recorrido sigue alertas reales a través del pipeline de triaje de SocTalk y muestra dónde termina la automatización y decide una persona.',
				'',
				'0:00 El día, reproducido: 276 alertas por el pipeline',
				'0:21 Un falso positivo cerrado en la primera pasada, costo cero del modelo',
				'1:12 Un veredicto del modelo corregido: la verificación de seguridad bloquea un cierre automático sin autorización',
				'1:43 La cola de revisión humana, con el caso completo frente al analista',
				'2:46 Fin del día: qué se cerró automáticamente y qué llegó a una persona',
				'',
				'Hecho para equipos SOC y MSSP saturados de alertas.',
				'In English: https://youtu.be/zXTcyIOf_Nc',
				'Em português: https://youtu.be/TEVrV3pulq0',
				'Documentación y demo en vivo: https://soctalk.ai/'
			].join('\n')
		},
		'pt-br': {
			title: 'SocTalk: A vida de um alerta',
			captionLang: 'pt-BR',
			captionName: 'Português (Brasil)',
			linkComment: 'Documentação e demo ao vivo: https://soctalk.ai/',
			description: [
				'Um tenant, um dia inteiro de alertas, reproduzido do início ao fim. Este tour segue alertas reais pelo pipeline de triagem do SocTalk e mostra onde a automação para e uma pessoa decide.',
				'',
				'0:00 O dia, reproduzido: 276 alertas pelo pipeline',
				'0:23 Um falso positivo fechado na primeira checagem, custo zero de modelo',
				'1:14 Um veredicto do modelo corrigido: a verificação de segurança bloqueia um fechamento automático sem autorização',
				'1:50 A fila de revisão humana, com o caso completo diante do analista',
				'2:50 Fim do dia: o que fechou automaticamente e o que chegou a uma pessoa',
				'',
				'Feito para times de SOC e MSSP afogados em alertas.',
				'In English: https://youtu.be/zXTcyIOf_Nc',
				'En español: https://youtu.be/dTIXCcVF4v8',
				'Documentação e demo ao vivo: https://soctalk.ai/'
			].join('\n')
		}
	};
	const localeIdx = process.argv.indexOf('--locale');
	const L = LOCALES[localeIdx > -1 ? process.argv[localeIdx + 1] : 'en'];
	if (!L) throw new Error('unknown locale');
	if (localeIdx > -1) process.argv.splice(localeIdx, 2);
	const TITLE = L.title;
	const DESCRIPTION = L.description;
	if (/CHAPTERS_[A-Z]+/.test(DESCRIPTION)) throw new Error('chapters placeholder not filled — compute chapters from walkthrough.json first');
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
			requestBody: { snippet: { videoId, language: L.captionLang, name: L.captionName } },
			media: { mimeType: 'application/octet-stream', body: createReadStream(srtFile) }
		});
		console.log(`captions uploaded (${L.captionLang})`);
	}
	if (L.linkComment) {
		await yt.commentThreads.insert({
			part: ['snippet'],
			requestBody: { snippet: { videoId, topLevelComment: { snippet: { textOriginal: L.linkComment } } } }
		});
		console.log('link comment posted (pin it in Studio — pinning has no API)');
	}
	console.log('upload complete');
}
