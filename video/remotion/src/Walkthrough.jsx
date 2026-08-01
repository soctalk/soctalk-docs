// "Life of an alert" — silent DRAFT composition (Stage 2 gate artifact).
// River slices from one canonical take are the spine; dives enter via a
// composited click-ring on a sampled dot. Narration is burned in as
// subtitles; scene id + timecode in the corner. The final (Stage 3) version
// strips draft chrome and re-paces to real audio.
import React from 'react';
import { AbsoluteFill, Audio, Easing, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import data from './walkthrough.json';

const FINAL = !!data.final; // Stage 3: voice on, draft chrome off

const FPS = 30;
const W = 1920;
const H = 1080;
const BRAND = '#fb3c4e';
const RIVER_FOCUS = { x: 993, y: 445, scale: 1.62 }; // FleetTour framing
const RING_LEAD = 1.1; // seconds of ring/zoom at the end of a river scene

const sceneFrames = (s) =>
	s.kind === 'river'
		? Math.round((s.window[1] - s.window[0]) * FPS)
		: s.kind === 'card'
			? Math.round(s.dur * FPS)
			: Math.round(s.videoDur * FPS) - 1;

const SceneAudio = ({ scene }) =>
	FINAL && scene.audio ? (
		<Sequence from={Math.round((scene.audioStart ?? 0.3) * FPS)}>
			<Audio src={staticFile(scene.audio)} />
		</Sequence>
	) : null;
export const walkthroughFrames = data.scenes.reduce((a, s) => a + sceneFrames(s), 0);

const clamp = (v, m) => Math.max(-m, Math.min(m, v));
const zoomTransform = (p, focus) => {
	const s = 1 + (focus.scale - 1) * p;
	const maxTx = ((W / 2) * (s - 1)) / s;
	const maxTy = ((H / 2) * (s - 1)) / s;
	const tx = clamp((W / 2 - focus.x) * p, maxTx);
	const ty = clamp((H / 2 - focus.y) * p, maxTy);
	return { s, tx, ty };
};
const toScreen = (pt, s, tx, ty) => ({
	x: W / 2 + s * (pt.x + tx - W / 2),
	y: H / 2 + s * (pt.y + ty - H / 2)
});

const Subtitle = ({ text }) => (
	<div
		style={{
			position: 'absolute',
			left: 160,
			right: 160,
			bottom: 34,
			padding: '16px 26px',
			borderRadius: 10,
			background: 'rgba(8,11,17,0.82)',
			border: '1px solid rgba(255,255,255,0.12)',
			color: '#f2f5fa',
			fontFamily: 'Helvetica, Arial, sans-serif',
			fontSize: 27,
			lineHeight: 1.35,
			textAlign: 'center'
		}}
	>
		{text}
	</div>
);

const DraftTag = ({ scene, frame }) => (
	<div
		style={{
			position: 'absolute',
			top: 18,
			left: 22,
			fontFamily: 'Menlo, monospace',
			fontSize: 17,
			letterSpacing: 1,
			color: '#8f9fb8',
			background: 'rgba(8,11,17,0.7)',
			padding: '6px 12px',
			borderRadius: 6
		}}
	>
		DRAFT · {scene.id} · {Math.floor(frame / FPS / 60)}:{String(Math.floor((frame / FPS) % 60)).padStart(2, '0')}
	</div>
);

const RiverScene = ({ scene, globalFrame }) => {
	const frame = useCurrentFrame();
	const frames = sceneFrames(scene);
	const t = frame / FPS;
	// dawn opens wide and drills in; other river scenes hold the drilled framing
	const isDawn = scene.id.endsWith('dawn');
	let p = 1;
	if (isDawn) p = interpolate(t, [2.2, 4.4], [0, 1], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	// ring transition into a dive: extra push toward the dot at the tail
	const dot = scene.enterNextVia?.dot;
	const tail = frames / FPS - RING_LEAD;
	const ringP = dot
		? interpolate(t, [tail, frames / FPS - 0.08], [0, 1], { easing: Easing.in(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
		: 0;
	// interpolate the camera from the river framing toward the dot — no jump
	const focus =
		dot && ringP > 0
			? {
					x: RIVER_FOCUS.x + (dot.x * 0.75 - RIVER_FOCUS.x) * ringP,
					y: RIVER_FOCUS.y + (dot.y * 0.75 - RIVER_FOCUS.y) * ringP,
					scale: RIVER_FOCUS.scale + 0.5 * ringP
				}
			: RIVER_FOCUS;
	const { s, tx, ty } = zoomTransform(ringP > 0 ? 1 : p, focus);
	const ring = dot ? toScreen({ x: dot.x * 0.75, y: dot.y * 0.75 }, s, tx, ty) : null;
	return (
		<AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
			<AbsoluteFill style={{ transform: `scale(${s}) translate(${tx}px, ${ty}px)` }}>
				<OffthreadVideo src={staticFile(data.river.file)} startFrom={Math.round(scene.window[0] * FPS)} muted style={{ width: '100%', height: '100%' }} />
			</AbsoluteFill>
			{ring && ringP > 0 ? (
				<div
					style={{
						position: 'absolute',
						left: ring.x - 26,
						top: ring.y - 26,
						width: 52,
						height: 52,
						borderRadius: '50%',
						border: `4px solid #fff`,
						opacity: 0.95 * (1 - Math.abs(ringP - 0.5) * 0.6),
						transform: `scale(${0.4 + ringP * 1.1})`,
						filter: 'drop-shadow(0 0 12px rgba(255,255,255,0.7))'
					}}
				/>
			) : null}
			{scene.endCard ? <EndCardOverlay frames={frames} /> : null}
			{!FINAL ? <SubtitleUnlessEndcard scene={scene} frames={frames} /> : null}
			{!FINAL ? <DraftTag scene={scene} frame={globalFrame} /> : null}
			<SceneAudio scene={scene} />
		</AbsoluteFill>
	);
};

// closing slide: logo, lemma, and the site URL
const CardScene = ({ scene, globalFrame }) => {
	const frame = useCurrentFrame();
	const frames = sceneFrames(scene);
	const in1 = interpolate(frame, [0, 14], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const in2 = interpolate(frame, [10, 26], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const in3 = interpolate(frame, [22, 38], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const out = interpolate(frame, [frames - 10, frames - 2], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#0b0e14',
				alignItems: 'center',
				justifyContent: 'center',
				fontFamily: 'Helvetica, Arial, sans-serif',
				color: '#f2f5fa',
				opacity: out
			}}
		>
			<AbsoluteFill style={{ background: 'radial-gradient(800px 520px at 50% 42%, rgba(251,60,78,0.13) 0%, rgba(251,60,78,0) 60%)' }} />
			<div style={{ display: 'flex', alignItems: 'center', gap: 18, opacity: 0.9 * in1 }}>
				<img src={staticFile('brand/logo.png')} width={56} />
				<div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>SocTalk</div>
			</div>
			<div style={{ marginTop: 64, fontFamily: 'Menlo, monospace', fontSize: 22, letterSpacing: 8, color: '#8f9fb8', opacity: in2 }}>
				VISIT US
			</div>
			<div style={{ marginTop: 18, fontSize: 76, fontWeight: 800, letterSpacing: -1, opacity: in2, transform: `translateY(${(1 - in2) * 16}px)` }}>
				soctalk.ai
			</div>
			<div style={{ marginTop: 26, width: 220 * in3, height: 5, borderRadius: 3, background: BRAND, opacity: in3 }} />
			<div style={{ marginTop: 30, fontSize: 28, fontWeight: 600, color: '#9fb0c8', opacity: in3 }}>
				AI triage. <span style={{ color: BRAND }}>Human judgment.</span>
			</div>
			{!FINAL ? <SubtitleUnlessEndcard scene={scene} frames={frames} /> : null}
			{!FINAL ? <DraftTag scene={scene} frame={globalFrame} /> : null}
			<SceneAudio scene={scene} />
		</AbsoluteFill>
	);
};

const SubtitleUnlessEndcard = ({ scene, frames }) => {
	const frame = useCurrentFrame();
	const fadeOut = scene.endCard
		? interpolate(frame, [frames - 4.5 * FPS, frames - 4 * FPS], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
		: 1;
	if (fadeOut <= 0) return null;
	return (
		<div style={{ opacity: fadeOut }}>
			<Subtitle text={scene.narration} />
		</div>
	);
};

const EndCardOverlay = ({ frames }) => {
	const frame = useCurrentFrame();
	const inP = interpolate(frame, [frames - 4 * FPS, frames - 2.8 * FPS], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	if (inP <= 0) return null;
	return (
		<AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: `rgba(7,9,13,${0.55 * inP})` }}>
			<div style={{ display: 'flex', alignItems: 'center', gap: 26, opacity: inP, fontFamily: 'Helvetica, Arial, sans-serif' }}>
				<img src={staticFile('brand/logo.png')} width={84} />
				<div style={{ fontSize: 72, fontWeight: 800, letterSpacing: -2, color: '#f2f5fa' }}>SocTalk</div>
			</div>
			<div style={{ marginTop: 22, fontSize: 34, fontWeight: 700, color: '#f2f5fa', opacity: inP, fontFamily: 'Helvetica, Arial, sans-serif' }}>
				AI triage. <span style={{ color: BRAND }}>Human judgment.</span>
			</div>
		</AbsoluteFill>
	);
};

const PageScene = ({ scene, globalFrame }) => {
	const frame = useCurrentFrame();
	const t = frame / FPS;
	let s = 1;
	let tx = 0;
	let ty = 0;
	for (const f of scene.focus ?? []) {
		const RAMP = 0.7;
		const start = f.atSec;
		const end = f.atSec + RAMP + f.hold + RAMP;
		if (t < start || t > end) continue;
		let p;
		if (t < start + RAMP) p = (t - start) / RAMP;
		else if (t > end - RAMP) p = (end - t) / RAMP;
		else p = 1;
		p = Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, p)));
		const z = zoomTransform(p, { x: f.x, y: f.y, scale: f.scale });
		s = z.s;
		tx = z.tx;
		ty = z.ty;
	}
	return (
		<AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
			<AbsoluteFill style={{ transform: `scale(${s}) translate(${tx}px, ${ty}px)` }}>
				<OffthreadVideo src={staticFile(scene.file)} muted style={{ width: '100%', height: '100%' }} />
			</AbsoluteFill>
			{!FINAL ? <Subtitle text={scene.narration} /> : null}
			{!FINAL ? <DraftTag scene={scene} frame={globalFrame} /> : null}
			<SceneAudio scene={scene} />
		</AbsoluteFill>
	);
};

export const Walkthrough = () => {
	const frame = useCurrentFrame();
	let acc = 0;
	const parts = data.scenes.map((scene) => {
		const frames = sceneFrames(scene);
		const el = (
			<Sequence key={scene.id} from={acc} durationInFrames={frames}>
				{scene.kind === 'river' ? (
					<RiverScene scene={scene} globalFrame={frame} />
				) : scene.kind === 'card' ? (
					<CardScene scene={scene} globalFrame={frame} />
				) : (
					<PageScene scene={scene} globalFrame={frame} />
				)}
			</Sequence>
		);
		acc += frames;
		return el;
	});
	return <AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>{parts}</AbsoluteFill>;
};
