// Smoke test: synthetic "live commenter" in the bottom-right corner.
// The character is code-drawn SVG, animated from the actual narration
// waveform (mouth), plus deterministic blinks, brow raises and head sway.
// The corner slot is avatar-agnostic: swap <Analyst/> for an <OffthreadVideo>
// of a HeyGen/D-ID render later without touching the composition.
import React from 'react';
import {
	AbsoluteFill,
	Audio,
	OffthreadVideo,
	Sequence,
	interpolate,
	spring,
	staticFile,
	useCurrentFrame,
	useVideoConfig
} from 'remotion';
import { useAudioData, visualizeAudio } from '@remotion/media-utils';
import manifest from './manifest.json';
import presenterConfig from './presenter-config.json';

const BRAND = '#fb3c4e';
const scene = manifest.scenes.find((s) => s.id === 'dashboard');
export const presenterFrames = Math.round(scene.videoDur * manifest.fps) - 1;

// mean of a few low-frequency bins ≈ speech amplitude envelope
const ampAt = (audioData, frame, fps) => {
	if (!audioData) return 0;
	const v = visualizeAudio({ audioData, frame, fps, numberOfSamples: 16 });
	return (v[0] + v[1] + v[2] + v[3]) / 4;
};

const Analyst = ({ amp, frame }) => {
	// blink ~ every 3.4s, 5 frames long; second pattern offsets it
	const b = frame % 102;
	const blink = b < 5 ? Math.sin((b / 5) * Math.PI) : 0;
	const sway = 2.2 * Math.sin(frame / 41) + 1.1 * Math.sin(frame / 17);
	const nod = amp * 5;
	const brow = -amp * 7;
	const mouthH = 3.5 + amp * 30;
	const mouthW = 30 - amp * 8;
	return (
		<svg
			viewBox="0 0 200 200"
			width="100%"
			height="100%"
			style={{ transform: `rotate(${sway}deg) translateY(${nod}px)` }}
		>
			{/* torso: dark hoodie */}
			<path d="M 40 200 C 42 158, 70 142, 100 142 C 130 142, 158 158, 160 200 Z" fill="#1d2635" />
			<path d="M 78 148 L 100 168 L 122 148 L 122 200 L 78 200 Z" fill="#141b27" />
			{/* neck */}
			<rect x="88" y="118" width="24" height="30" rx="10" fill="#d9a077" />
			{/* head */}
			<g>
				<ellipse cx="100" cy="88" rx="42" ry="46" fill="#e8b98f" />
				{/* ears */}
				<ellipse cx="58" cy="92" rx="7" ry="10" fill="#e0ad82" />
				<ellipse cx="142" cy="92" rx="7" ry="10" fill="#e0ad82" />
				{/* hair */}
				<path d="M 56 78 C 54 44, 78 32, 100 32 C 126 32, 148 48, 146 80 C 140 62, 128 54, 118 56 C 122 62, 122 66, 120 70 C 108 56, 84 54, 74 62 C 66 66, 60 72, 56 78 Z" fill="#2a2018" />
				{/* headset band + earcup */}
				<path d="M 54 70 C 60 30, 140 30, 146 70" stroke="#0e1420" strokeWidth="7" fill="none" strokeLinecap="round" />
				<rect x="46" y="80" width="14" height="26" rx="7" fill="#0e1420" />
				<path d="M 53 106 C 53 122, 70 128, 82 124" stroke="#0e1420" strokeWidth="4.5" fill="none" strokeLinecap="round" />
				<circle cx="85" cy="125" r="4" fill={BRAND} />
				{/* brows */}
				<path d={`M 70 ${72 + brow} q 10 -6 20 -1`} stroke="#3a2c1e" strokeWidth="4" fill="none" strokeLinecap="round" />
				<path d={`M 110 ${71 + brow} q 10 -5 20 1`} stroke="#3a2c1e" strokeWidth="4" fill="none" strokeLinecap="round" />
				{/* eyes (blink via scaleY) */}
				<g transform={`translate(0 ${blink * 2})`}>
					<ellipse cx="81" cy="84" rx="6.5" ry={5.5 * (1 - blink)} fill="#fff" />
					<ellipse cx="119" cy="84" rx="6.5" ry={5.5 * (1 - blink)} fill="#fff" />
					<circle cx={82 + Math.sin(frame / 53) * 1.6} cy="84.5" r={2.6 * (1 - blink)} fill="#241a12" />
					<circle cx={120 + Math.sin(frame / 53) * 1.6} cy="84.5" r={2.6 * (1 - blink)} fill="#241a12" />
				</g>
				{/* nose */}
				<path d="M 99 92 q 4 8 -1 12" stroke="#cf9a70" strokeWidth="3" fill="none" strokeLinecap="round" />
				{/* mouth: amplitude-driven */}
				<ellipse cx="100" cy="116" rx={mouthW / 2} ry={mouthH / 2} fill="#5d2a26" />
				{mouthH > 10 ? <rect x={100 - mouthW / 4} y={116 - mouthH / 4} width={mouthW / 2} height={mouthH / 8} rx="2" fill="#f4efe9" /> : null}
			</g>
		</svg>
	);
};

export const Presenter = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const audioData = useAudioData(staticFile(scene.audio));
	// small attack/decay smoothing across 3 frames
	const amp = Math.min(
		1,
		(ampAt(audioData, frame, fps) * 3 + ampAt(audioData, frame - 1, fps) * 2 + ampAt(audioData, frame - 2, fps)) / 6 * 2.4
	);
	const bubbleIn = spring({ frame: frame - 8, fps, config: { damping: 14 } });
	const drift = 1 + 0.03 * (frame / presenterFrames);
	const live = Math.sin(frame / 9) > -0.4;
	return (
		<AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
			<AbsoluteFill style={{ transform: `scale(${drift})` }}>
				<OffthreadVideo src={staticFile(scene.video)} muted />
			</AbsoluteFill>
			<Sequence from={Math.round(scene.audioStart * fps)}>
				<Audio src={staticFile(scene.audio)} />
			</Sequence>
			{/* presenter bubble */}
			<div
				style={{
					position: 'absolute',
					right: 56,
					bottom: 56,
					width: 290,
					transform: `scale(${bubbleIn})`,
					transformOrigin: 'bottom right'
				}}
			>
				<div
					style={{
						width: 290,
						height: 290,
						borderRadius: '50%',
						overflow: 'hidden',
						background: 'radial-gradient(140% 120% at 30% 20%, #202b3d 0%, #10161f 70%)',
						border: `3px solid ${BRAND}`,
						boxShadow: '0 18px 60px rgba(0,0,0,0.6)'
					}}
				>
					{presenterConfig.avatarClip ? (
						<Sequence from={Math.round(scene.audioStart * fps)} layout="none">
							<OffthreadVideo
								src={staticFile(presenterConfig.avatarClip)}
								muted
								style={{
									width: '100%',
									height: '100%',
									objectFit: 'cover',
									transform: `scale(${presenterConfig.zoom ?? 1}) translateY(${presenterConfig.shiftY ?? 0}%)`
								}}
							/>
						</Sequence>
					) : (
						<Analyst amp={amp} frame={frame} />
					)}
				</div>
				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: 10,
						justifyContent: 'center',
						marginTop: 14,
						padding: '8px 18px',
						borderRadius: 999,
						background: 'rgba(10,14,22,0.8)',
						border: '1px solid rgba(255,255,255,0.15)',
						fontFamily: 'Helvetica, Arial, sans-serif',
						fontSize: 20,
						fontWeight: 600,
						color: '#f2f5fa'
					}}
				>
					<span
						style={{
							width: 10,
							height: 10,
							borderRadius: '50%',
							background: BRAND,
							opacity: live ? 1 : 0.35
						}}
					/>
					Alex — SOC Analyst
				</div>
			</div>
		</AbsoluteFill>
	);
};
