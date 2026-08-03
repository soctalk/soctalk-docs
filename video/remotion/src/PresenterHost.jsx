import React from 'react';
import { AbsoluteFill, OffthreadVideo, Audio, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import cfg from './presenter-host.json';

const FPS = cfg.fps || 30;
const CRIMSON = '#fb3c4e';
const DARK = '#0b0e14';
const sec = (s) => Math.round(s * FPS);

// screen recording fills the frame; falls back to dark if absent
function Screen() {
  if (!cfg.screen) return <AbsoluteFill style={{ background: DARK }} />;
  return (
    <AbsoluteFill style={{ background: DARK }}>
      <OffthreadVideo src={staticFile(cfg.screen)} muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  );
}

// the webcam — a real clip if provided, else a labeled placeholder bubble
function Cam({ full }) {
  const size = full ? 1080 : 320;
  const content = cfg.webcam
    ? <OffthreadVideo src={staticFile(cfg.webcam)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    : (
      <AbsoluteFill style={{ background: 'linear-gradient(135deg,#1b2130,#2a3346)', alignItems: 'center', justifyContent: 'center', color: '#8b93a7', font: '600 18px/1.3 -apple-system,sans-serif', textAlign: 'center' }}>
        {full ? 'PRESENTER\n(full frame intro/outro)' : 'PRESENTER\nCAM'}
      </AbsoluteFill>
    );
  if (full) {
    return <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', background: DARK }}>
      <div style={{ width: 1080, height: 1080, overflow: 'hidden', whiteSpace: 'pre-line' }}>{content}</div>
    </AbsoluteFill>;
  }
  // corner bubble with crimson ring
  return (
    <div style={{ position: 'absolute', right: 48, bottom: 48, width: size, height: size, borderRadius: '50%', overflow: 'hidden', border: `4px solid ${CRIMSON}`, boxShadow: '0 8px 30px rgba(0,0,0,.5)', whiteSpace: 'pre-line' }}>
      {content}
    </div>
  );
}

// lower-third name card, slides in early
function LowerThird() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const inn = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 18 });
  const out = interpolate(frame, [sec(cfg.introSec + 4), sec(cfg.introSec + 5)], [1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const op = Math.min(inn, out);
  return (
    <div style={{ position: 'absolute', left: 56, bottom: 90, opacity: op, transform: `translateX(${interpolate(inn, [0, 1], [-30, 0])}px)` }}>
      <div style={{ background: 'rgba(11,14,20,.82)', borderLeft: `4px solid ${CRIMSON}`, padding: '12px 20px', borderRadius: 6 }}>
        <div style={{ color: '#fff', font: '700 30px/1.1 -apple-system,sans-serif' }}>{cfg.name}</div>
        <div style={{ color: '#8b93a7', font: '500 20px/1.3 -apple-system,sans-serif', marginTop: 4 }}>{cfg.title}</div>
      </div>
    </div>
  );
}

function BrandOutro() {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const e = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  return (
    <AbsoluteFill style={{ background: DARK, alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: '-apple-system,sans-serif', opacity: e }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 26 }}>
        <img src={staticFile('brand/logo.png')} width={64} /><span style={{ fontSize: 40, fontWeight: 700 }}>SocTalk</span>
      </div>
      <div style={{ fontSize: 22, letterSpacing: 4, color: '#8b93a7' }}>VISIT US</div>
      <div style={{ fontSize: 72, fontWeight: 800, margin: '8px 0 20px' }}>soctalk.ai</div>
      <div style={{ width: 120, height: 4, background: CRIMSON, marginBottom: 22 }} />
      <div style={{ fontSize: 26, color: '#8b93a7' }}>AI triage. Human judgment.</div>
    </AbsoluteFill>
  );
}

export const PresenterHost = () => {
  const introEnd = sec(cfg.introSec);
  const outroStart = sec(cfg.totalSec - cfg.outroSec);
  const end = sec(cfg.totalSec);
  return (
    <AbsoluteFill style={{ background: DARK }}>
      {/* middle: screen + corner bubble */}
      <Sequence from={introEnd} durationInFrames={outroStart - introEnd}>
        <Screen />
        <Cam full={false} />
      </Sequence>
      {/* intro: full-frame presenter + lower third */}
      <Sequence from={0} durationInFrames={introEnd}>
        <Cam full={true} />
        <LowerThird />
      </Sequence>
      {/* outro: brand card */}
      <Sequence from={outroStart} durationInFrames={end - outroStart}>
        <BrandOutro />
      </Sequence>
      {cfg.audio && <Audio src={staticFile(cfg.audio)} />}
    </AbsoluteFill>
  );
};

export const presenterHostFrames = sec(cfg.totalSec);
