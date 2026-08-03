import React from 'react';
import { AbsoluteFill, Audio, Sequence, OffthreadVideo, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import data from './onboard.json';

const FPS = data.fps || 30;
const FINAL = !!data.final;
const SILENT = !!data.silent;   // burned subtitles, no VO, no draft tag
const CRIMSON = '#fb3c4e';
const DARK = '#0b0e14';
const framesOf = (s) => Math.round(s.dur * FPS);

// burned subtitle band (cards render their own text, so skip it there)
function Subtitle({ scene }) {
  if (scene.kind === 'card' || scene.kind === 'prereq' || scene.kind === 'terminal') return null;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 70, textAlign: 'center', padding: '0 12%' }}>
      <span style={{ background: 'rgba(0,0,0,.72)', color: '#fff', font: '500 30px/1.4 -apple-system,Segoe UI,Roboto,sans-serif', padding: '10px 18px', borderRadius: 8, boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone' }}>
        {scene.narr}
      </span>
    </div>
  );
}

// draft subtitle (burned) + scene tag — only in draft mode
function DraftChrome({ scene, idx }) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  return (
    <>
      <Subtitle scene={scene} />
      <div style={{ position: 'absolute', left: 24, top: 20, color: '#8b93a7', font: '600 20px/1 ui-monospace,monospace', letterSpacing: 1 }}>
        DRAFT · {idx + 1}. {scene.label} · {t.toFixed(1)}s
      </div>
    </>
  );
}

// zoom/pan focus (optional) for clip scenes
function ClipScene({ scene }) {
  return (
    <AbsoluteFill style={{ background: DARK }}>
      <OffthreadVideo
        src={staticFile(`onboard/${scene.src}.mp4`)}
        startFrom={Math.round(scene.in * FPS)}
        endAt={Math.round(scene.out * FPS)}
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
      />
    </AbsoluteFill>
  );
}

// fast-forward card: honest compressed-time beat
function FFScene({ scene }) {
  const frame = useCurrentFrame();
  const spin = (frame / FPS) * 360;
  return (
    <AbsoluteFill style={{ background: DARK, alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: '-apple-system,Segoe UI,Roboto,sans-serif' }}>
      <div style={{ fontSize: 120, color: CRIMSON, letterSpacing: 6 }}>⏩</div>
      <div style={{ fontSize: 40, fontWeight: 700, marginTop: 10 }}>{scene.label}</div>
      <div style={{ fontSize: 26, color: '#8b93a7', marginTop: 12 }}>≈ {scene.minutes} minutes · compressed</div>
      <div style={{ position: 'absolute', bottom: 90, width: 320, height: 4, background: '#1b2130', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${interpolate(frame, [0, framesOf(scene)], [4, 100], { extrapolateRight: 'clamp' })}%`, background: CRIMSON }} />
      </div>
    </AbsoluteFill>
  );
}

// prerequisites checklist card
function PrereqScene({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const items = scene.items || [];
  return (
    <AbsoluteFill style={{ background: DARK, color: '#fff', fontFamily: '-apple-system,Segoe UI,Roboto,sans-serif', padding: '90px 140px', justifyContent: 'center' }}>
      <div style={{ fontSize: 44, fontWeight: 800, marginBottom: 8 }}>{scene.label || 'Before you start'}</div>
      <div style={{ width: 90, height: 4, background: CRIMSON, marginBottom: 40 }} />
      {items.map((it, i) => {
        const app = spring({ frame: frame - i * 8, fps, config: { damping: 200 }, durationInFrames: 16 });
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 18, marginBottom: 22, opacity: app, transform: `translateX(${interpolate(app, [0, 1], [-24, 0])}px)` }}>
            <span style={{ color: CRIMSON, fontSize: 30, lineHeight: '38px' }}>✓</span>
            <span style={{ fontSize: 30, lineHeight: '38px', color: '#dfe4ee' }}>{it}</span>
          </div>
        );
      })}
      {scene.footer && <div style={{ marginTop: 30, fontSize: 24, color: '#8b93a7' }}>{scene.footer}</div>}
    </AbsoluteFill>
  );
}

// animated terminal card for the CLI install
function TerminalScene({ scene }) {
  const frame = useCurrentFrame();
  const lines = scene.lines || [];
  const total = framesOf(scene);
  const perLine = total / (lines.length + 1);
  return (
    <AbsoluteFill style={{ background: DARK, alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,sans-serif' }}>
      <div style={{ width: 1500, background: '#0d1117', borderRadius: 12, border: '1px solid #222b3a', boxShadow: '0 20px 60px rgba(0,0,0,.5)', overflow: 'hidden' }}>
        <div style={{ background: '#161b22', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56', display: 'inline-block' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e', display: 'inline-block' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f', display: 'inline-block' }} />
          <span style={{ color: '#8b93a7', font: '500 18px/1 ui-monospace,monospace', marginLeft: 12 }}>{scene.term || 'workstation'}</span>
        </div>
        <div style={{ padding: '26px 30px', font: '500 26px/1.7 ui-monospace,SFMono-Regular,Menlo,monospace', minHeight: 320 }}>
          {lines.map((ln, i) => {
            const show = frame > i * perLine;
            if (!show) return null;
            const isCmd = ln.startsWith('$');
            const isComment = ln.trim().startsWith('#');
            return (
              <div key={i} style={{ color: isComment ? '#6b7488' : isCmd ? '#e6edf3' : '#8b93a7', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                {isCmd ? <span style={{ color: CRIMSON }}>$ </span> : null}{isCmd ? ln.slice(2) : ln}
              </div>
            );
          })}
        </div>
      </div>
      {scene.footer && <div style={{ marginTop: 26, fontSize: 24, color: '#8b93a7', fontFamily: 'ui-monospace,monospace' }}>{scene.footer}</div>}
    </AbsoluteFill>
  );
}

// browser chrome with the console URL typing into the address bar
function BrowserScene({ scene }) {
  const frame = useCurrentFrame();
  const url = scene.url || 'http://localhost:8321';
  const total = framesOf(scene);
  const typeFrames = Math.min(total * 0.6, url.length * 3.2);
  const shown = Math.min(url.length, Math.floor((frame / typeFrames) * url.length));
  const typed = url.slice(0, shown);
  const done = shown >= url.length;
  const caret = Math.floor(frame / 15) % 2 === 0;
  return (
    <AbsoluteFill style={{ background: DARK, alignItems: 'center', justifyContent: 'center', fontFamily: '-apple-system,Segoe UI,Roboto,sans-serif' }}>
      <div style={{ width: 1500, background: '#1b2130', borderRadius: 12, border: '1px solid #2a3346', boxShadow: '0 20px 60px rgba(0,0,0,.5)', overflow: 'hidden' }}>
        <div style={{ background: '#141922', padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56', display: 'inline-block' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e', display: 'inline-block' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f', display: 'inline-block' }} />
          <div style={{ flex: 1, marginLeft: 14, background: '#0b0e14', border: `1px solid ${done ? CRIMSON : '#2a3346'}`, borderRadius: 8, padding: '10px 16px', font: '500 24px/1 ui-monospace,monospace', color: '#e6edf3' }}>
            {typed}<span style={{ opacity: caret && !done ? 1 : 0, color: CRIMSON }}>|</span>
          </div>
        </div>
        <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8b93a7', flexDirection: 'column', gap: 14 }}>
          <img src={staticFile('brand/logo.png')} width={done ? 64 : 48} style={{ opacity: done ? 1 : 0.35, transition: 'all .3s' }} />
          <div style={{ fontSize: 26, fontWeight: 700, color: done ? '#fff' : '#8b93a7' }}>SocTalk Launchpad</div>
          {done && <div style={{ fontSize: 18, color: '#8b93a7' }}>console ready</div>}
        </div>
      </div>
    </AbsoluteFill>
  );
}

// brand bookend cards
function CardScene({ scene }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const enter = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 24 });
  const y = interpolate(enter, [0, 1], [24, 0]);
  const outro = scene.variant === 'outro';
  return (
    <AbsoluteFill style={{ background: DARK, alignItems: 'center', justifyContent: 'center', color: '#fff', fontFamily: '-apple-system,Segoe UI,Roboto,sans-serif' }}>
      <div style={{ opacity: enter, transform: `translateY(${y}px)`, textAlign: 'center', paddingBottom: 220 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, justifyContent: 'center', marginBottom: 30 }}>
          <img src={staticFile('brand/logo.png')} width={64} />
          <span style={{ fontSize: 40, fontWeight: 700 }}>SocTalk</span>
        </div>
        {outro ? (
          <>
            <div style={{ fontSize: 22, letterSpacing: 4, color: '#8b93a7' }}>VISIT US</div>
            <div style={{ fontSize: 72, fontWeight: 800, margin: '8px 0 20px' }}>soctalk.ai</div>
            <div style={{ width: 120, height: 4, background: CRIMSON, margin: '0 auto 22px' }} />
            <div style={{ fontSize: 26, color: '#8b93a7' }}>AI triage. Human judgment.</div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 60, fontWeight: 800, marginBottom: 16 }}>{scene.label}</div>
            <div style={{ width: 120, height: 4, background: CRIMSON, margin: '0 auto 22px' }} />
            <div style={{ fontSize: 26, color: '#8b93a7' }}>AI triage. Human judgment.</div>
          </>
        )}
      </div>
    </AbsoluteFill>
  );
}

export const Onboarding = () => {
  let acc = 0;
  return (
    <AbsoluteFill style={{ background: DARK }}>
      {data.scenes.map((scene, idx) => {
        const frames = framesOf(scene);
        const from = acc; acc += frames;
        return (
          <Sequence key={idx} from={from} durationInFrames={frames}>
            {scene.kind === 'clip' && <ClipScene scene={scene} />}
            {scene.kind === 'ff' && <FFScene scene={scene} />}
            {scene.kind === 'card' && <CardScene scene={scene} />}
            {scene.kind === 'prereq' && <PrereqScene scene={scene} />}
            {scene.kind === 'terminal' && <TerminalScene scene={scene} />}
            {scene.kind === 'browser' && <BrowserScene scene={scene} />}
            {!FINAL && !SILENT && <DraftChrome scene={scene} idx={idx} />}
            {SILENT && <Subtitle scene={scene} />}
            {FINAL && !SILENT && scene.audio && (
              <Sequence from={Math.round((scene.audioStart ?? 0.3) * FPS)}>
                <Audio src={staticFile(scene.audio)} />
              </Sequence>
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

export const onboardingFrames = data.scenes.reduce((a, s) => a + framesOf(s), 0);
