// LinkedIn cut: the fleet triage flow only — no chrome, no controls, no
// cursor. 1920x800 (2.4:1) canvas; the viz+stats strip from the 1440p capture
// is cropped spatially (controls row excluded) and starts mid-flow.
import React from 'react';
import { AbsoluteFill, OffthreadVideo, interpolate, staticFile, useCurrentFrame } from 'remotion';

const FPS = 30;
const START = 5.5; // seconds into the capture (after the play press)
const SRC_DUR = 44.7;
export const fleetFlowFrames = Math.round((SRC_DUR - START - 0.5) * FPS);

// crop region in the 2560x1440 source
const CROP = { x: 572, y: 116, w: 1504, h: 396 };
const SCALE = 1920 / CROP.w; // → 1920-wide strip
const STRIP_H = Math.round(CROP.h * SCALE); // ≈ 505
const TOP = Math.round((800 - STRIP_H) / 2);

export const FleetFlow = () => {
	const frame = useCurrentFrame();
	const fade = Math.min(
		interpolate(frame, [0, 12], [0, 1], { extrapolateRight: 'clamp' }),
		interpolate(frame, [fleetFlowFrames - 14, fleetFlowFrames - 2], [1, 0], { extrapolateLeft: 'clamp' })
	);
	return (
		<AbsoluteFill style={{ backgroundColor: '#0b0e14' }}>
			<div style={{ position: 'absolute', top: TOP, left: 0, width: 1920, height: STRIP_H, overflow: 'hidden', opacity: fade }}>
				<OffthreadVideo
					src={staticFile('scenes/fleet-flow.mp4')}
					startFrom={Math.round(START * FPS)}
					muted
					style={{
						position: 'absolute',
						left: -Math.round(CROP.x * SCALE),
						top: -Math.round(CROP.y * SCALE),
						width: Math.round(2560 * SCALE),
						height: 'auto'
					}}
				/>
			</div>
			<div
				style={{
					position: 'absolute',
					top: 44,
					left: 56,
					fontFamily: 'Menlo, Consolas, monospace',
					fontSize: 19,
					letterSpacing: 4,
					color: '#8f9fb8',
					opacity: 0.9 * fade
				}}
			>
				REPLAY · ONE DAY OF AI TRIAGE
			</div>
			<div
				style={{
					position: 'absolute',
					right: 56,
					bottom: 38,
					display: 'flex',
					alignItems: 'center',
					gap: 14,
					opacity: 0.9 * fade
				}}
			>
				<img src={staticFile('brand/logo.png')} width={36} />
				<div style={{ fontFamily: 'Helvetica, Arial, sans-serif', fontSize: 27, fontWeight: 700, color: '#f2f5fa' }}>
					SocTalk
				</div>
			</div>
		</AbsoluteFill>
	);
};
