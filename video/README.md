# SocTalk video tutorials

Fully automated tutorial videos: Playwright drives the live demo UI, ElevenLabs
narrates, Remotion adds the cinematic layer (crossfades, zoom/pan, title
cards), ffmpeg encodes. One command, mp4 out, no manual steps.

## Run

```sh
cd video
npm install          # first time only
node run.mjs screenplays/quick-tour.mjs
# → out/quick-tour.mp4
```

Secrets live in the gitignored `video/.env` (KEY=VALUE lines), auto-loaded by
`config.mjs`: `SOCTALK_PASSWORD` (required for capture), `ELEVENLABS_API_KEY`
(optional — falls back to macOS `say`). Overrides: `SOCTALK_BASE`,
`SOCTALK_EMAIL`, `ELEVENLABS_VOICE_ID`.

The `Presenter` composition's corner bubble uses the code-drawn, audio-reactive
analyst by default. It can host a talking-head avatar clip instead: drop an mp4
in `remotion/public/` and point `remotion/src/presenter-config.json` at it.

Beyond the tutorial pipeline there are one-shot captures + compositions:
`pipeline/capture-replay-tour.mjs` → `ReplayTour` (dashboard tour → zoom into
the fleet timelapse) and `pipeline/capture-fleet-tour.mjs` → `FleetTour` (the
LinkedIn cut: wide dashboard, then zoom, no controls/cursor on film). Render
any composition with
`npx remotion render remotion/src/index.jsx <Id> out/<name>.mp4 --public-dir=remotion/public`.

## How it works

1. **narrate** (`pipeline/narrate.mjs`) — one TTS clip per scene, cached by
   content hash in `cache/`, durations measured with ffprobe.
2. **capture** (`pipeline/capture.mjs`) — logs in once, records each scene as
   its own clip (new page per scene), glides a fake cursor to the screenplay's
   focus targets paced against the narration duration, and writes
   `remotion/src/manifest.json` with zoom keyframes. A missing readiness
   heading aborts the run; a missing focus target only skips that beat.
3. **render** — the Remotion composition (`remotion/src/Tour.jsx`) sequences
   intro card → scenes → outro card with fade transitions, applies eased
   zoom/pan onto the recorded focus coordinates (clamped so edges never show),
   overlays lower-third labels, and mixes the narration per scene.

## Adding a tutorial

Copy `screenplays/quick-tour.mjs`, edit scenes (route, `ready` heading,
narration, focus beats), then `node run.mjs screenplays/<name>.mjs`. Keep
actions read-only against the shared demo tenant.
