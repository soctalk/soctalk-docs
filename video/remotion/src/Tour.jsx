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
	useCurrentFrame,
	useVideoConfig
} from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import manifest from './manifest.json';

const FPS = manifest.fps;
const W = manifest.width;
const H = manifest.height;
const INTRO = 3 * FPS;
const OUTRO = 2.5 * FPS;
const TRANSITION = 15;

const sceneFrames = (s) => Math.round(s.videoDur * FPS) - 1;
const seqDurations = [INTRO, ...manifest.scenes.map(sceneFrames), OUTRO];
export const totalFrames =
	seqDurations.reduce((a, b) => a + b, 0) - TRANSITION * (seqDurations.length - 1);

// Zoom/pan: for each focus beat, ease in over 0.7s, hold, ease out over 0.7s.
// Translate is clamped so the scaled frame always covers the viewport.
function zoomAt(frame, focus) {
	const t = frame / FPS;
	let scale = 1;
	let tx = 0;
	let ty = 0;
	for (const f of focus) {
		const RAMP = 0.7;
		const start = f.atSec;
		const end = f.atSec + RAMP + f.hold + RAMP;
		if (t < start || t > end) continue;
		let p;
		if (t < start + RAMP) p = (t - start) / RAMP;
		else if (t > end - RAMP) p = (end - t) / RAMP;
		else p = 1;
		p = Easing.inOut(Easing.cubic)(Math.min(1, Math.max(0, p)));
		const s = 1 + (f.scale - 1) * p;
		const maxTx = ((W / 2) * (s - 1)) / s;
		const maxTy = ((H / 2) * (s - 1)) / s;
		scale = s;
		tx = Math.max(-maxTx, Math.min(maxTx, (W / 2 - f.x) * p));
		ty = Math.max(-maxTy, Math.min(maxTy, (H / 2 - f.y) * p));
	}
	return { scale, tx, ty };
}

const Scene = ({ scene }) => {
	const frame = useCurrentFrame();
	const frames = sceneFrames(scene);
	// Ambient Ken Burns drift under the focus zooms.
	const ambient = 1 + 0.035 * (frame / frames);
	const { scale, tx, ty } = zoomAt(frame, scene.focus);
	const labelIn = spring({ frame: frame - 12, fps: FPS, config: { damping: 200 } });
	const labelOut = interpolate(frame, [frames - 24, frames - 8], [1, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp'
	});
	return (
		<AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
			<AbsoluteFill
				style={{ transform: `scale(${scale * ambient}) translate(${tx}px, ${ty}px)` }}
			>
				<OffthreadVideo src={staticFile(scene.video)} muted />
			</AbsoluteFill>
			<Sequence from={Math.round(scene.audioStart * FPS)}>
				<Audio src={staticFile(scene.audio)} />
			</Sequence>
			<div
				style={{
					position: 'absolute',
					left: 48,
					bottom: 44,
					padding: '10px 22px',
					borderRadius: 10,
					background: 'rgba(10, 14, 22, 0.72)',
					border: '1px solid rgba(255,255,255,0.14)',
					borderLeft: '4px solid #fb3c4e',
					color: '#f2f5fa',
					fontFamily: 'Helvetica, Arial, sans-serif',
					fontSize: 26,
					fontWeight: 600,
					letterSpacing: 0.3,
					backdropFilter: 'blur(6px)',
					opacity: labelIn * labelOut,
					transform: `translateY(${(1 - labelIn) * 18}px)`
				}}
			>
				{scene.label}
			</div>
		</AbsoluteFill>
	);
};

// SocTalk brand: crimson #fb3c4e (sampled from the logo), app-dark #0b0e14.
const BRAND = '#fb3c4e';

const Card = ({ title, subtitle }) => {
	const frame = useCurrentFrame();
	const logoIn = spring({ frame, fps: FPS, config: { damping: 14, mass: 0.8 } });
	const wordIn = spring({ frame: frame - 6, fps: FPS, config: { damping: 200 } });
	const subIn = spring({ frame: frame - 14, fps: FPS, config: { damping: 200 } });
	const barIn = spring({ frame: frame - 18, fps: FPS, config: { damping: 200 } });
	const glow = interpolate(frame, [0, 40], [0, 0.55], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp'
	});
	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#0b0e14',
				alignItems: 'center',
				justifyContent: 'center',
				fontFamily: 'Helvetica, Arial, sans-serif',
				color: '#f2f5fa'
			}}
		>
			<AbsoluteFill
				style={{
					background: `radial-gradient(900px 600px at 50% 38%, rgba(251,60,78,${0.16 * glow}) 0%, rgba(251,60,78,0) 60%), radial-gradient(1400px 900px at 30% 15%, #151b26 0%, rgba(11,14,20,0) 70%)`
				}}
			/>
			<div style={{ display: 'flex', alignItems: 'center', gap: 42 }}>
				<img
					src={staticFile('brand/logo.png')}
					width={148}
					style={{
						opacity: Math.min(1, logoIn * 1.4),
						transform: `scale(${0.6 + 0.4 * logoIn}) rotate(${(1 - logoIn) * -8}deg)`,
						filter: `drop-shadow(0 0 ${34 * glow}px rgba(251,60,78,0.45))`
					}}
				/>
				<div
					style={{
						fontSize: 118,
						fontWeight: 800,
						letterSpacing: -3,
						opacity: wordIn,
						transform: `translateX(${(1 - wordIn) * 28}px)`
					}}
				>
					{title}
				</div>
			</div>
			<div
				style={{
					width: 260 * barIn,
					height: 5,
					borderRadius: 3,
					background: BRAND,
					marginTop: 34,
					opacity: barIn
				}}
			/>
			{subtitle ? (
				<div
					style={{
						fontSize: 36,
						fontWeight: 400,
						color: '#9fb0c8',
						letterSpacing: 0.5,
						marginTop: 26,
						opacity: subIn,
						transform: `translateY(${(1 - subIn) * 24}px)`
					}}
				>
					{subtitle}
				</div>
			) : null}
		</AbsoluteFill>
	);
};

export const Tour = () => (
	<TransitionSeries>
		<TransitionSeries.Sequence durationInFrames={INTRO}>
			<Card title={manifest.title} subtitle={manifest.subtitle} dur={INTRO} />
		</TransitionSeries.Sequence>
		{manifest.scenes.flatMap((scene) => [
			<TransitionSeries.Transition
				key={`t-${scene.id}`}
				presentation={fade()}
				timing={linearTiming({ durationInFrames: TRANSITION })}
			/>,
			<TransitionSeries.Sequence key={scene.id} durationInFrames={sceneFrames(scene)}>
				<Scene scene={scene} />
			</TransitionSeries.Sequence>
		])}
		<TransitionSeries.Transition
			presentation={fade()}
			timing={linearTiming({ durationInFrames: TRANSITION })}
		/>
		<TransitionSeries.Sequence durationInFrames={OUTRO}>
			<Card title={manifest.title} subtitle="AI triage. Human judgment." dur={OUTRO} />
		</TransitionSeries.Sequence>
	</TransitionSeries>
);
