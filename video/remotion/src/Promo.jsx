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
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { slide } from '@remotion/transitions/slide';
import { wipe } from '@remotion/transitions/wipe';
import { fade } from '@remotion/transitions/fade';

const FPS = 30;
const BRAND = '#fb3c4e';
const T = 8; // snappy transition length

const BEATS = [
	{ src: 'scenes/dashboard.mp4', from: 120, dur: 130, lines: ['ALERTS', 'NEVER SLEEP.'], accent: 1 },
	{ src: 'scenes/investigations.mp4', from: 90, dur: 130, lines: ['AI TRIAGE.', 'IN SECONDS.'], accent: 0 },
	{ src: 'scenes/review.mp4', from: 90, dur: 130, lines: ['HUMANS STAY', 'IN COMMAND.'], accent: 1 },
	{ src: 'scenes/chat.mp4', from: 90, dur: 130, lines: ['ASK YOUR SOC', 'ANYTHING.'], accent: 0 },
	{ src: 'scenes/analytics.mp4', from: 120, dur: 100, lines: ['SEE THE PROOF.'], accent: 0 }
];
const INTRO = 70;
const OUTRO = 180;
export const promoFrames =
	INTRO + OUTRO + BEATS.reduce((a, b) => a + b.dur, 0) - T * (BEATS.length + 1);

// Deterministic grain: feTurbulence tile, drifted per frame.
const GRAIN =
	"url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='300' height='300' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

const Grain = () => {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill
			style={{
				backgroundImage: GRAIN,
				backgroundPosition: `${(frame * 97) % 300}px ${(frame * 61) % 300}px`,
				opacity: 0.08,
				mixBlendMode: 'overlay',
				pointerEvents: 'none'
			}}
		/>
	);
};

const Vignette = () => (
	<AbsoluteFill
		style={{
			background:
				'radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%)'
		}}
	/>
);

const Word = ({ children, i, accent }) => {
	const frame = useCurrentFrame();
	const s = spring({ frame: frame - 6 - i * 4, fps: FPS, config: { damping: 13, mass: 0.6 } });
	return (
		<span
			style={{
				display: 'inline-block',
				marginRight: 26,
				color: accent ? BRAND : '#f5f7fb',
				opacity: s,
				transform: `translateY(${(1 - s) * 60}px) skewY(${(1 - s) * -3}deg)`
			}}
		>
			{children}
		</span>
	);
};

const Beat = ({ beat }) => {
	const frame = useCurrentFrame();
	// Punch-in, then slow drift.
	const punch = spring({ frame, fps: FPS, config: { damping: 12, mass: 0.7 } });
	const scale = 1.05 + punch * 0.1 + 0.0006 * frame;
	const barW = spring({ frame: frame - 4, fps: FPS, config: { damping: 200 } });
	let w = 0;
	return (
		<AbsoluteFill style={{ backgroundColor: '#07090d' }}>
			<AbsoluteFill style={{ transform: `scale(${scale})` }}>
				<OffthreadVideo src={staticFile(beat.src)} startFrom={beat.from} muted />
			</AbsoluteFill>
			<AbsoluteFill
				style={{
					background:
						'linear-gradient(180deg, rgba(7,9,13,0.25) 0%, rgba(7,9,13,0.05) 45%, rgba(7,9,13,0.86) 100%)'
				}}
			/>
			<div style={{ position: 'absolute', left: 90, top: 64, display: 'flex', alignItems: 'center', gap: 16 }}>
				<div style={{ width: 12, height: 12, background: BRAND, transform: 'rotate(45deg)' }} />
				<div style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 26, fontWeight: 700, letterSpacing: 6, color: '#cdd6e4' }}>
					SOCTALK
				</div>
			</div>
			<div style={{ position: 'absolute', left: 90, bottom: 120 }}>
				<div style={{ width: 340 * barW, height: 6, background: BRAND, marginBottom: 30 }} />
				<div
					style={{
						fontFamily: 'Helvetica, Arial, sans-serif',
						fontWeight: 900,
						fontSize: 104,
						lineHeight: 1.04,
						letterSpacing: -2
					}}
				>
					{beat.lines.map((line, li) => (
						<div key={li}>
							{line.split(' ').map((word) => (
								<Word key={word + w} i={w++} accent={beat.accent === li ? 1 : 0}>
									{word}
								</Word>
							))}
						</div>
					))}
				</div>
			</div>
			<Vignette />
			<Grain />
		</AbsoluteFill>
	);
};

const FLICKER = [0, 0.9, 0.2, 1, 0.5, 1, 0.85, 1, 1, 1];

const Intro = () => {
	const frame = useCurrentFrame();
	const slam = spring({ frame, fps: FPS, config: { damping: 11, mass: 0.9 } });
	const glow = interpolate(frame, [8, 22, 55], [0, 1, 0.35], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp'
	});
	const flicker = frame < FLICKER.length ? FLICKER[frame] : 1;
	return (
		<AbsoluteFill style={{ backgroundColor: '#07090d', alignItems: 'center', justifyContent: 'center' }}>
			<img
				src={staticFile('brand/logo.png')}
				width={230}
				style={{
					opacity: flicker,
					transform: `scale(${2.4 - 1.4 * slam})`,
					filter: `drop-shadow(0 0 ${60 * glow}px rgba(251,60,78,0.8))`
				}}
			/>
			<Vignette />
			<Grain />
		</AbsoluteFill>
	);
};

const Outro = () => {
	const frame = useCurrentFrame();
	const in1 = spring({ frame, fps: FPS, config: { damping: 200 } });
	const in2 = spring({ frame: frame - 10, fps: FPS, config: { damping: 200 } });
	const in3 = spring({ frame: frame - 22, fps: FPS, config: { damping: 200 } });
	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#07090d',
				alignItems: 'center',
				justifyContent: 'center',
				fontFamily: 'Helvetica, Arial, sans-serif',
				color: '#f5f7fb'
			}}
		>
			<AbsoluteFill
				style={{
					background: `radial-gradient(800px 520px at 50% 40%, rgba(251,60,78,0.14) 0%, rgba(251,60,78,0) 60%)`
				}}
			/>
			<div style={{ display: 'flex', alignItems: 'center', gap: 36, opacity: in1 }}>
				<img src={staticFile('brand/logo.png')} width={120} />
				<div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -2 }}>SocTalk</div>
			</div>
			<div
				style={{
					fontSize: 44,
					fontWeight: 700,
					marginTop: 34,
					opacity: in2,
					transform: `translateY(${(1 - in2) * 20}px)`
				}}
			>
				AI triage. <span style={{ color: BRAND }}>Human judgment.</span>
			</div>
			<div style={{ fontSize: 30, color: '#8f9fb8', marginTop: 26, opacity: in3 }}>soctalk.ai</div>
			<Vignette />
			<Grain />
		</AbsoluteFill>
	);
};

export const Promo = () => {
	const frame = useCurrentFrame();
	const musicVolume = interpolate(frame, [0, 15, 570, 655], [0, 0.26, 0.26, 0], {
		extrapolateLeft: 'clamp',
		extrapolateRight: 'clamp'
	});
	const transitions = [slide({ direction: 'from-right' }), wipe({ direction: 'from-left' })];
	return (
		<AbsoluteFill style={{ backgroundColor: '#07090d' }}>
			<TransitionSeries>
				<TransitionSeries.Sequence durationInFrames={INTRO}>
					<Intro />
				</TransitionSeries.Sequence>
				{BEATS.flatMap((beat, i) => [
					<TransitionSeries.Transition
						key={`t${i}`}
						presentation={i === 0 ? fade() : transitions[i % 2]}
						timing={linearTiming({ durationInFrames: T })}
					/>,
					<TransitionSeries.Sequence key={i} durationInFrames={beat.dur}>
						<Beat beat={beat} />
					</TransitionSeries.Sequence>
				])}
				<TransitionSeries.Transition presentation={fade()} timing={linearTiming({ durationInFrames: T })} />
				<TransitionSeries.Sequence durationInFrames={OUTRO}>
					<Outro />
				</TransitionSeries.Sequence>
			</TransitionSeries>
			<Sequence from={55}>
				<Audio src={staticFile('audio/promo-vo.mp3')} />
			</Sequence>
			<Audio src={staticFile('audio/promo-music.mp3')} volume={musicVolume} />
		</AbsoluteFill>
	);
};
