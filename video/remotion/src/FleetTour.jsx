// Wide dashboard establishing shot → eased zoom into the flowing replay card,
// hold through the active window, ease back out. No captions, no controls, no
// cursor anywhere in frame; MODEL SPEND was hidden at capture time.
import React from 'react';
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion';
import meta from './fleet-tour.json';

const FPS = 30;
const W = 1920;
const H = 1080;
const LEN = meta.videoDur - meta.segStart;
export const fleetTourFrames = Math.round(LEN * FPS) - 2;

const FOCUS = { x: 993, y: 445, scale: 1.62 };
const WIDE_HOLD = 3.5;
const RAMP = 2.0;
const OUT_RAMP = 2.2;

export const FleetTour = () => {
	const frame = useCurrentFrame();
	const t = frame / FPS;
	let p;
	if (t < WIDE_HOLD) p = 0;
	else if (t < WIDE_HOLD + RAMP)
		p = interpolate(t, [WIDE_HOLD, WIDE_HOLD + RAMP], [0, 1], { easing: Easing.inOut(Easing.cubic) });
	else if (t < LEN - OUT_RAMP - 0.3) p = 1;
	else
		p = interpolate(t, [LEN - OUT_RAMP - 0.3, LEN - 0.3], [1, 0], {
			easing: Easing.inOut(Easing.cubic),
			extrapolateRight: 'clamp'
		});

	const s = 1 + (FOCUS.scale - 1) * p;
	const maxTx = ((W / 2) * (s - 1)) / s;
	const maxTy = ((H / 2) * (s - 1)) / s;
	const tx = Math.max(-maxTx, Math.min(maxTx, (W / 2 - FOCUS.x) * p));
	const ty = Math.max(-maxTy, Math.min(maxTy, (H / 2 - FOCUS.y) * p));
	const fade = Math.min(
		interpolate(frame, [0, 10], [0, 1], { extrapolateRight: 'clamp' }),
		interpolate(frame, [fleetTourFrames - 12, fleetTourFrames - 2], [1, 0], { extrapolateLeft: 'clamp' })
	);

	return (
		<AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
			<AbsoluteFill style={{ transform: `scale(${s}) translate(${tx}px, ${ty}px)`, opacity: fade }}>
				<OffthreadVideo
					src={staticFile('scenes/fleet-tour.mp4')}
					startFrom={Math.round(meta.segStart * FPS)}
					muted
					style={{ width: '100%', height: '100%' }}
				/>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
