// "One Alert, Two Clocks" — a single alert races through machine time, then
// stops at the human judgment gate. Concept storyboard by Codex review; all
// cuts are performed by the continuous crimson thread + procedural masks (no
// stock transitions). 810 frames @ 30fps.
import React from 'react';
import {
	AbsoluteFill,
	Audio,
	Easing,
	OffthreadVideo,
	Sequence,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame
} from 'remotion';

const FPS = 30;
export const promo2Frames = 810;
const BRAND = '#fb3c4e';
const BG = '#07090d';
const MONO = 'Menlo, Consolas, monospace';
const SANS = 'Helvetica, Arial, sans-serif';

const GRAIN =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

const Grain = () => {
	const f = useCurrentFrame();
	return (
		<AbsoluteFill
			style={{
				backgroundImage: GRAIN,
				backgroundPosition: `${(f * 97) % 300}px ${(f * 61) % 300}px`,
				opacity: 0.07,
				mixBlendMode: 'overlay'
			}}
		/>
	);
};

const Vignette = () => (
	<AbsoluteFill
		style={{
			background: 'radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)'
		}}
	/>
);

// --- persistent machine clock (top right) --------------------------------
const clockMs = (f) => {
	const RATE = 13.37; // machine-fast ms per frame
	if (f < 300) return f * RATE;
	if (f < 390) return 300 * RATE; // held at the gate
	if (f < 570) return 300 * RATE + (f - 390) * RATE;
	return 300 * RATE + 180 * RATE; // synced, frozen
};

const MachineClock = () => {
	const f = useCurrentFrame();
	if (f > 660) return null;
	const held = (f >= 300 && f < 390) || f >= 570;
	const label = f >= 570 ? 'SYNCED' : held ? 'PAUSED FOR REVIEW' : 'MACHINE TIME';
	return (
		<div style={{ position: 'absolute', top: 54, right: 80, textAlign: 'right', fontFamily: MONO }}>
			<div style={{ fontSize: 44, fontWeight: 700, color: held ? '#f5f7fb' : BRAND, letterSpacing: 1 }}>
				T+{(clockMs(f) / 1000).toFixed(3)}s
			</div>
			<div style={{ fontSize: 17, letterSpacing: 5, color: held ? BRAND : '#8f9fb8', marginTop: 6 }}>
				{label}
			</div>
		</div>
	);
};

// --- persistent incident thread (bottom spine) ----------------------------
const NODES = [340, 620, 880, 1150, 1400];
const NODE_AT = [45, 120, 210, 390, 480];
const headX = (f) =>
	interpolate(f, [0, 45, 120, 210, 300, 390, 480, 570, 675], [120, 340, 620, 880, 955, 955, 1150, 1400, 1600], {
		easing: Easing.inOut(Easing.quad),
		extrapolateRight: 'clamp'
	});

const Thread = () => {
	const f = useCurrentFrame();
	const fade = interpolate(f, [660, 700], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	if (fade <= 0) return null;
	const hx = headX(f);
	const pulse = 1 + 0.25 * Math.sin(f / 2.5);
	return (
		<svg width="1920" height="1080" style={{ position: 'absolute', inset: 0, opacity: fade }}>
			<line x1={120} y1={1000} x2={hx} y2={1000} stroke={BRAND} strokeWidth={3} />
			{NODES.map((x, i) =>
				f > NODE_AT[i] ? (
					<circle key={x} cx={x} cy={1000} r={6} fill={BRAND} opacity={0.9} />
				) : null
			)}
			<circle cx={hx} cy={1000} r={9 * pulse} fill={BRAND} style={{ filter: `drop-shadow(0 0 12px ${BRAND})` }} />
		</svg>
	);
};

// --- alert packets (intake swarm) -----------------------------------------
const Packets = () => {
	const f = useCurrentFrame();
	if (f < 45 || f > 140) return null;
	const fade = interpolate(f, [45, 55, 120, 140], [0, 1, 1, 0]);
	return (
		<AbsoluteFill style={{ opacity: fade * 0.6 }}>
			{Array.from({ length: 80 }, (_, i) => {
				const y = (i * 137) % 1040;
				const speed = 18 + (i % 7) * 4;
				const x = (((i * 211 + f * speed) % 2200) + 2200) % 2200 - 140;
				return (
					<div
						key={i}
						style={{
							position: 'absolute',
							left: x,
							top: y,
							width: 30 + (i % 3) * 24,
							height: 3,
							background: BRAND,
							opacity: 0.25 + (i % 5) * 0.11
						}}
					/>
				);
			})}
		</AbsoluteFill>
	);
};

// --- scenes ----------------------------------------------------------------
const Origin = () => {
	const f = useCurrentFrame();
	const pulse = 1 + 0.5 * Math.sin(f / 2.2);
	const on = interpolate(f, [4, 10], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<img src={staticFile('brand/logo.png')} width={44} style={{ position: 'absolute', left: 98, top: 924, opacity: 0.85 * on }} />
			<div
				style={{
					position: 'absolute',
					left: 120 - 10 * pulse,
					top: 1000 - 10 * pulse,
					width: 20 * pulse,
					height: 20 * pulse,
					borderRadius: '50%',
					background: BRAND,
					opacity: on,
					filter: `drop-shadow(0 0 ${18 * pulse}px ${BRAND})`
				}}
			/>
			<div style={{ position: 'absolute', left: 160, top: 988, fontFamily: MONO, fontSize: 22, color: '#8f9fb8', opacity: on }}>
				ALERT RECEIVED
			</div>
		</AbsoluteFill>
	);
};

// dashboard revealed by a slit sweeping with the thread head
const Intake = () => {
	const f = useCurrentFrame(); // local: 0..74 (global 45..119)
	const g = f + 45;
	const edge = interpolate(f, [0, 60], [80, 1980], { easing: Easing.out(Easing.quad), extrapolateRight: 'clamp' });
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<AbsoluteFill style={{ clipPath: `inset(0 ${Math.max(0, 1920 - edge)}px 0 0)` }}>
				<OffthreadVideo src={staticFile('scenes/dashboard.mp4')} startFrom={120} muted />
				<AbsoluteFill style={{ background: 'rgba(7,9,13,0.35)' }} />
			</AbsoluteFill>
			{edge < 1920 ? (
				<div
					style={{
						position: 'absolute',
						left: edge - 2,
						top: 0,
						width: 4,
						height: 1080,
						background: BRAND,
						opacity: 0.9,
						filter: `drop-shadow(0 0 14px ${BRAND})`
					}}
				/>
			) : null}
		</AbsoluteFill>
	);
};

// investigations: angled strips recombine, then drift toward the focus point
const Branching = () => {
	const f = useCurrentFrame(); // 0..89
	const settle = interpolate(f, [0, 18], [1, 0], { easing: Easing.out(Easing.cubic), extrapolateRight: 'clamp' });
	const zoom = interpolate(f, [20, 89], [1, 1.12], { extrapolateLeft: 'clamp' });
	const strips = 5;
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<AbsoluteFill
				style={{ transform: `scale(${zoom}) translate(${(960 - 1004) * (zoom - 1)}px, ${(540 - 344) * (zoom - 1)}px)` }}
			>
				{Array.from({ length: strips }, (_, i) => (
					<AbsoluteFill
						key={i}
						style={{
							clipPath: `inset(${(i * 1080) / strips}px 0 ${1080 - ((i + 1) * 1080) / strips}px 0)`,
							transform: `translateX(${(i - 2) * 90 * settle}px)`
						}}
					>
						<OffthreadVideo src={staticFile('scenes/investigations.mp4')} startFrom={90} muted />
					</AbsoluteFill>
				))}
				<AbsoluteFill style={{ background: 'rgba(7,9,13,0.28)' }} />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};

// authorization facts: evidence layer with dashed connectors from the spine
const Evidence = () => {
	const f = useCurrentFrame(); // 0..89
	const draw = interpolate(f, [6, 40], [900, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const targets = [
		[420, 315],
		[930, 315],
		[1420, 315]
	];
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<OffthreadVideo src={staticFile('scenes/authorization.mp4')} startFrom={90} muted />
			<AbsoluteFill style={{ background: 'rgba(7,9,13,0.3)' }} />
			<svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
				{targets.map(([tx, ty], i) => (
					<line
						key={i}
						x1={880}
						y1={1000}
						x2={tx}
						y2={ty}
						stroke={BRAND}
						strokeWidth={2}
						strokeDasharray="8 7"
						strokeDashoffset={draw + i * 40}
						opacity={0.65}
					/>
				))}
				{targets.map(([tx, ty], i) => (
					<circle key={`c${i}`} cx={tx} cy={ty} r={5} fill={BRAND} opacity={f > 40 + i * 4 ? 0.9 : 0} />
				))}
			</svg>
			<div style={{ position: 'absolute', left: 90, top: 60, fontFamily: MONO, fontSize: 20, letterSpacing: 4, color: '#8f9fb8' }}>
				EVIDENCE: AUTHORIZATION FACTS
			</div>
		</AbsoluteFill>
	);
};

// the human judgment gate: everything stops
const Gate = () => {
	const f = useCurrentFrame(); // 0..89
	const cursorH = spring({ frame: f, fps: FPS, config: { damping: 15 } });
	const lens = interpolate(f, [8, 60], [90, 2300], { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const calm = interpolate(f, [10, 50], [0.55, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<AbsoluteFill style={{ clipPath: `circle(${lens}px at 422px 106px)` }}>
				<OffthreadVideo src={staticFile('scenes/review.mp4')} startFrom={90} muted />
				<AbsoluteFill style={{ background: 'rgba(7,9,13,0.25)' }} />
			</AbsoluteFill>
			<AbsoluteFill style={{ background: `linear-gradient(90deg, rgba(251,60,78,${calm * 0.25}) 0%, rgba(7,9,13,0) 50%)` }} />
			<div
				style={{
					position: 'absolute',
					left: 958,
					top: 0,
					width: 4,
					height: 1080 * cursorH,
					background: '#f5f7fb',
					filter: 'drop-shadow(0 0 16px rgba(245,247,251,0.8))'
				}}
			/>
			<div
				style={{
					position: 'absolute',
					left: 990,
					top: 500,
					fontFamily: MONO,
					fontSize: 24,
					letterSpacing: 5,
					color: '#f5f7fb',
					opacity: interpolate(f, [18, 30], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
				}}
			>
				HUMAN JUDGMENT GATE
			</div>
		</AbsoluteFill>
	);
};

// chat: ask why
const AskWhy = () => {
	const f = useCurrentFrame(); // 0..89
	const q = 'WHY THIS PRIORITY?';
	const typed = q.slice(0, Math.max(0, Math.floor((f - 12) * 1.1)));
	const bars = [
		['SIGNAL', 320],
		['CONTEXT', 410],
		['ACTION', 260]
	];
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<OffthreadVideo src={staticFile('scenes/chat.mp4')} startFrom={90} muted />
			<AbsoluteFill style={{ background: 'rgba(7,9,13,0.4)' }} />
			<div
				style={{
					position: 'absolute',
					left: 90,
					bottom: 150,
					padding: '26px 34px',
					background: 'rgba(10,14,22,0.85)',
					border: '1px solid rgba(255,255,255,0.14)',
					borderLeft: `4px solid ${BRAND}`,
					borderRadius: 12,
					fontFamily: MONO
				}}
			>
				<div style={{ fontSize: 34, color: '#f5f7fb', letterSpacing: 2 }}>
					{typed}
					<span style={{ opacity: Math.floor(f / 8) % 2 ? 1 : 0 }}>▌</span>
				</div>
				<div style={{ marginTop: 24, opacity: interpolate(f, [42, 54], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }) }}>
					{bars.map(([label, w], i) => {
						const bw = spring({ frame: f - 46 - i * 6, fps: FPS, config: { damping: 200 } }) * w;
						return (
							<div key={label} style={{ display: 'flex', alignItems: 'center', gap: 18, marginTop: 12 }}>
								<div style={{ width: 130, fontSize: 18, letterSpacing: 3, color: '#8f9fb8' }}>{label}</div>
								<div style={{ width: bw, height: 12, background: BRAND, borderRadius: 3, opacity: 0.85 }} />
							</div>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

// analytics: the thread becomes the plotted proof line
const Proof = () => {
	const f = useCurrentFrame(); // 0..89
	const draw = interpolate(f, [4, 60], [2400, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const labels = ['DASHBOARD', 'INVESTIGATIONS', 'REVIEW', 'CHAT', 'AUTH FACTS', 'ANALYTICS'];
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<OffthreadVideo src={staticFile('scenes/analytics.mp4')} startFrom={120} muted />
			<AbsoluteFill style={{ background: 'rgba(7,9,13,0.3)' }} />
			<svg width="1920" height="1080" style={{ position: 'absolute', inset: 0 }}>
				<path
					d="M 0 760 C 380 700, 620 560, 960 600 S 1560 480, 1920 430"
					fill="none"
					stroke={BRAND}
					strokeWidth={4}
					strokeDasharray={2400}
					strokeDashoffset={draw}
					opacity={0.9}
					style={{ filter: `drop-shadow(0 0 10px ${BRAND})` }}
				/>
			</svg>
			{labels.map((l, i) => (
				<div
					key={l}
					style={{
						position: 'absolute',
						left: 240 + i * 265,
						top: 1010,
						fontFamily: MONO,
						fontSize: 15,
						letterSpacing: 2,
						color: '#8f9fb8',
						opacity: f > 20 + i * 6 ? 0.9 : 0
					}}
				>
					{l}
				</div>
			))}
		</AbsoluteFill>
	);
};

// two clocks sync: all six clips align on one incident timeline
const Sync = () => {
	const f = useCurrentFrame(); // 0..104
	const clips = [
		['scenes/dashboard.mp4', 284],
		['scenes/investigations.mp4', 162],
		['scenes/review.mp4', 175],
		['scenes/chat.mp4', 153],
		['scenes/authorization.mp4', 161],
		['scenes/analytics.mp4', 191]
	];
	const ring = interpolate(f, [10, 90], [439.8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	return (
		<AbsoluteFill style={{ backgroundColor: BG, alignItems: 'center' }}>
			<svg width="180" height="180" style={{ position: 'absolute', top: 150, left: 870 }}>
				<circle cx="90" cy="90" r="70" stroke="rgba(255,255,255,0.15)" strokeWidth="6" fill="none" />
				<circle
					cx="90"
					cy="90"
					r="70"
					stroke="#f5f7fb"
					strokeWidth="6"
					fill="none"
					strokeDasharray={439.8}
					strokeDashoffset={ring}
					transform="rotate(-90 90 90)"
				/>
			</svg>
			<div style={{ position: 'absolute', top: 350, width: '100%', textAlign: 'center', fontFamily: MONO, fontSize: 20, letterSpacing: 6, color: '#8f9fb8' }}>
				ONE INCIDENT. ONE TIMELINE.
			</div>
			<div style={{ position: 'absolute', top: 460, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 18 }}>
				{clips.map(([src, from], i) => {
					const s = spring({ frame: f - 8 - i * 5, fps: FPS, config: { damping: 16 } });
					return (
						<div
							key={src}
							style={{
								width: 280,
								height: 158,
								overflow: 'hidden',
								borderRadius: 8,
								border: '1px solid rgba(255,255,255,0.15)',
								opacity: s,
								transform: `translateY(${(1 - s) * (i % 2 ? 120 : -120)}px)`
							}}
						>
							<div style={{ width: 1920, height: 1080, transform: 'scale(0.1458)', transformOrigin: 'top left' }}>
								<OffthreadVideo src={staticFile(src)} startFrom={from} muted />
							</div>
						</div>
					);
				})}
			</div>
			<div style={{ position: 'absolute', top: 640, left: 320, right: 320, height: 3, background: BRAND, opacity: 0.8 }} />
		</AbsoluteFill>
	);
};

const End = () => {
	const f = useCurrentFrame(); // 0..134
	const curve = interpolate(f, [0, 40], [1400, 0], { extrapolateRight: 'clamp' });
	const curveFade = interpolate(f, [55, 75], [0.9, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const in1 = spring({ frame: f - 30, fps: FPS, config: { damping: 200 } });
	const snap = spring({ frame: f - 45, fps: FPS, config: { damping: 12, mass: 0.5 } });
	const breathe = interpolate(f, [60, 86], [0, 1], { easing: Easing.inOut(Easing.quad), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const url = interpolate(f, [95, 110], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	return (
		<AbsoluteFill style={{ backgroundColor: BG, alignItems: 'center', justifyContent: 'center', fontFamily: SANS, color: '#f5f7fb' }}>
			<AbsoluteFill style={{ background: `radial-gradient(800px 520px at 50% 42%, rgba(251,60,78,0.13) 0%, rgba(251,60,78,0) 60%)` }} />
			<svg width="1920" height="1080" style={{ position: 'absolute', inset: 0, opacity: curveFade }}>
				<path
					d="M 1600 1000 C 1400 940, 1150 760, 960 520"
					fill="none"
					stroke={BRAND}
					strokeWidth={3}
					strokeDasharray={1400}
					strokeDashoffset={curve}
				/>
			</svg>
			<div style={{ display: 'flex', alignItems: 'center', gap: 34, opacity: in1 }}>
				<img src={staticFile('brand/logo.png')} width={116} />
				<div style={{ fontSize: 92, fontWeight: 800, letterSpacing: -2 }}>SocTalk</div>
			</div>
			<div style={{ marginTop: 34, fontSize: 46, fontWeight: 700, display: 'flex', gap: 16 }}>
				<span style={{ opacity: snap, transform: `scale(${0.7 + 0.3 * snap})`, display: 'inline-block' }}>AI triage.</span>
				<span style={{ color: BRAND, opacity: breathe, letterSpacing: (1 - breathe) * 6 }}>Human judgment.</span>
			</div>
			<div style={{ marginTop: 28, fontSize: 28, color: '#8f9fb8', opacity: url }}>soctalk.ai</div>
		</AbsoluteFill>
	);
};

// --- assembly ---------------------------------------------------------------
const VO_AT = [12, 108, 264, 369, 456, 582, 708]; // frames

export const Promo2 = () => {
	const frame = useCurrentFrame();
	const musicA = interpolate(frame, [0, 12, 288, 302], [0, 0.3, 0.3, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	const musicB = interpolate(frame, [315, 340, 770, 808], [0, 0.24, 0.24, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
	return (
		<AbsoluteFill style={{ backgroundColor: BG }}>
			<Sequence durationInFrames={45}><Origin /></Sequence>
			<Sequence from={45} durationInFrames={75}><Intake /></Sequence>
			<Sequence from={120} durationInFrames={90}><Branching /></Sequence>
			<Sequence from={210} durationInFrames={90}><Evidence /></Sequence>
			<Sequence from={300} durationInFrames={90}><Gate /></Sequence>
			<Sequence from={390} durationInFrames={90}><AskWhy /></Sequence>
			<Sequence from={480} durationInFrames={90}><Proof /></Sequence>
			<Sequence from={570} durationInFrames={105}><Sync /></Sequence>
			<Sequence from={675} durationInFrames={135}><End /></Sequence>

			<Packets />
			<Thread />
			<MachineClock />
			<Vignette />
			<Grain />

			{VO_AT.map((at, i) => (
				<Sequence key={i} from={at}>
					<Audio src={staticFile(`audio/p2-vo-${i + 1}.mp3`)} />
				</Sequence>
			))}
			<Audio src={staticFile('audio/p2-music-a.mp3')} volume={musicA} />
			<Sequence from={315}>
				<Audio src={staticFile('audio/p2-music-b.mp3')} volume={musicB} />
			</Sequence>
		</AbsoluteFill>
	);
};
