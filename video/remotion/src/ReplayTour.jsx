// "Dashboard tour → drill into the timelapse": wide establishing shot with a
// scroll tour, then an eased zoom into the fleet-replay card while the
// timelapse plays, easing back out at the end. Timings come from the capture's
// events file (already shifted onto the video timeline).
import React from 'react';
import { AbsoluteFill, Easing, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion';
import ev from './replay-tour.json';

const FPS = 30;
const W = 1920;
const H = 1080;
export const replayTourFrames = Math.round(ev.videoDur * FPS) - 1;

// zoom target: the fleet visualization card
const FOCUS = { x: 750, y: 440, scale: 1.5 };

export const ReplayTour = () => {
	const frame = useCurrentFrame();
	const t = frame / FPS;
	const zoomIn = [ev.replayClick + 0.2, ev.replayClick + 2.7];
	const zoomOut = [ev.videoDur - 2.4, ev.videoDur - 0.4];
	let p;
	if (t < zoomIn[0]) p = 0;
	else if (t < zoomIn[1])
		p = interpolate(t, zoomIn, [0, 1], { easing: Easing.inOut(Easing.cubic) });
	else if (t < zoomOut[0]) p = 1;
	else p = interpolate(t, zoomOut, [1, 0], { easing: Easing.inOut(Easing.cubic), extrapolateRight: 'clamp' });

	const s = 1 + (FOCUS.scale - 1) * p;
	const maxTx = ((W / 2) * (s - 1)) / s;
	const maxTy = ((H / 2) * (s - 1)) / s;
	const tx = Math.max(-maxTx, Math.min(maxTx, (W / 2 - FOCUS.x) * p));
	const ty = Math.max(-maxTy, Math.min(maxTy, (H / 2 - FOCUS.y) * p));

	return (
		<AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
			<AbsoluteFill style={{ transform: `scale(${s}) translate(${tx}px, ${ty}px)` }}>
				<OffthreadVideo src={staticFile('scenes/replay-tour.mp4')} muted />
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
