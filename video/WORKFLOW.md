# t2v workflow — brief to published video

Operating prompt for producing ANY SocTalk video from the live demo
(demo.soctalk.ai): walkthrough tutorials, screen tours, promo and social
cuts. The stages, gate, voice, bookends and hard rules below apply to all of
them; formats differ only in which pipeline films them (see Formats).
Optimized for LOW HUMAN EFFORT: the agent infers sensible defaults and
conventions from this repo (existing screenplays, pipeline, compositions are
the house style) and only involves the human where listed. Don't ask
questions a look at the repo or demo can answer.

```
brief → 1 DISCOVER → 2 SILENT DRAFT  ⛔ human approval → 3 VOICE + FINAL → 4 PUBLISH
```

**Stage 1 — Discover.** Explore the demo read-only, off-camera. Find and
verify the exact data the video will feature (entities with a good on-screen
story — legible evidence, clean causality). Record what was chosen — IDs,
routes, expected text usable as capture assertions — beside the screenplay,
and tell the human what you picked in a few sentences. Don't wait for a
reply.

**Stage 2 — Silent draft.** Write the screenplay (scenes, actions, narration
text) and produce a watchable draft: real capture, no voiceover, narration
burned in as subtitles so script and visuals are judged in one viewing.
Deliver it with anything else the reviewer needs (script text, notable
choices). ⛔ This is the one hard gate: no TTS, no publishing, until the
human explicitly approves. Iterate here freely — iterations are silent and
free.

**Stage 3 — Voice + final.** Voice exactly the approved narration
(ElevenLabs, default voice, cached), re-pace capture to the real audio,
render with the house polish, deliver master + web encode. If the final
meaningfully diverges from what was approved (data changed on the live demo,
timing shifted enough to alter a scene), show the human instead of shipping.
Locales (not automated yet): translate the narration strings, reuse
everything else; re-gate only if something material changed. Automating a
locale also needs per-locale output ids, caption language/name, and
localized upload metadata in `upload-youtube.mjs`.

**Narration voice (applies to every screenplay):**
- Audience is SOC analysts. Write like an engineer explaining to a peer:
  plain declarative sentences, grounded, zero promotional cadence. If a line
  would fit in an ad, rewrite it.
- Use everyday SOC vocabulary — alerts, rules, false positives, triage,
  verdict, escalation, queue, grants, change tickets, baselines, audit
  trail. Avoid software/design-doc jargon (deterministic, disposition,
  operational, reasoning tier, router) unless plainly explaining a label
  that is on screen at that moment.
- Do not recite UI component names (Policy Gate, Supervisor, Guard, Hard
  Floor). Describe the function — "a first pass against known rules",
  "routing", "a safety check", "a hard stop" — and let the camera land on
  the label so the viewer makes the mapping.
- Every number or factual claim spoken must be visible on screen and
  capture-asserted. Never imply causality between separate entities the
  data doesn't prove ("that same path leaves alerts like this…", not
  "which is why this one…").
- The lemma "AI triage. Human judgment." is the visual end card only; it is
  not spoken.
- Voice: the ElevenLabs default in config.mjs (currently Chris), measured
  read, no style exaggeration.
- Captions: drafts burn the narration in (that is the review surface).
  Finals ship CLEAN plus a sidecar `.srt` (`pipeline/make-srt.mjs`): clip
  start/duration come from the real TTS audio; sentence cues within a clip
  are proportionally timed by character share (upgrade path: ElevenLabs
  character timestamps). Uploaded via the YouTube Captions API so viewers
  toggle, search and auto-translate. A burned-in variant is produced only
  for muted-autoplay feeds (e.g. LinkedIn) when needed.

**Bookends (the intro and the last slide follow the same principles):**
- Open on the product, alive — a cold open on real UI (e.g. the fleet replay
  already flowing) is the house default. If a title card is used at all, it
  is minimal: logo + wordmark + video title on the app-dark background,
  no taglines, no motion flourish. The first narration line obeys the
  narration-voice rules like every other line.
- Every video ends on the standing closing slide: `Walkthrough.jsx`'s
  `CardScene` is the normative implementation (URL-hero layout: brand row,
  VISIT US eyebrow, plain `soctalk.ai`, crimson rule, muted lemma). Legacy
  `Tour`/promo intro-outro cards are not normative. Optional one plain
  spoken line ("Visit us at soctalk dot A I.") — nothing salesy.
- An mp4 cannot carry a clickable link: the URL must be large and legible on
  the slide, and the publish surface (docs page, YouTube description, post
  text) carries the actual hyperlink.
- Brand constants everywhere: crimson #fb3c4e, app-dark #0b0e14, logo from
  `remotion/public/brand/logo.png`.

**Stage 4 — Publish.** Upload the clean final + sidecar `.srt` to YouTube via
`pipeline/upload-youtube.mjs <video.mp4> <captions.srt>` (videos.insert +
captions.insert; unlisted by default — a human flips to public). The
description is content-only and carries the https://soctalk.ai link (the mp4
URL is not clickable); the AI-narration disclosure is YouTube's
altered-content flag, set once per video in Studio (not writable via the
Data API). OAuth lives in `video/.env`
(`YT_CLIENT_ID/SECRET/REFRESH_TOKEN`); `--auth` runs the one-time consent.
Per-locale finals each upload their own caption track.

**Operations — the walkthrough format's command palette (as production-run on
alert-walkthrough, Jul–Aug 2026; other formats swap the capture/render lines):**

Preflight: run from `video/` after `npm install`; ffmpeg/ffprobe on PATH.
`.env` needs `SOCTALK_PASSWORD` (capture), `ELEVENLABS_API_KEY` (Stage 3),
`YT_*` (publish only).

**Formats.** One process, several filming pipelines:
- Narrative walkthrough (the flagship format): `capture-walkthrough.mjs` +
  the `Walkthrough` composition — assertion-gated capture, filmed clicks,
  river/dive scene kinds, real-audio pacing. Reference screenplay:
  `screenplays/alert-walkthrough.mjs`; its `.discovery.json` shows what a
  discovery file records (verified dates, IDs/routes, assertion text, spoken
  numbers, read-only notes, rejected candidates, caveats).
- Simple screen tour: `run.mjs` + the `Tour` composition (reference:
  `screenplays/quick-tour.mjs`). Predates assertions/clicks; fine for
  low-stakes tours, prefer the walkthrough engine for anything gated.
- Promo/social cuts (`Promo*`, `FleetFlow`, `FleetTour`, …): remix existing
  footage, no gate needed while internal — but anything PUBLISHED passes the
  same hard rules and publish stage.
The two capture engines stay separate until the second walkthrough exists;
generalize from two real cases, not one (parameterize or fork
`capture-walkthrough`'s outputs before reusing them).

```sh
# STAGE 2 — silent draft (no TTS; the gate lives here)
rm -f tmp/narration.json                             # guarantees draft mode
node pipeline/capture-walkthrough.mjs [screenplays/<id>.mjs]
npx remotion render remotion/src/index.jsx Walkthrough out/<id>.draft.mp4 --public-dir=remotion/public

# STAGE 3 — after explicit approval only
node pipeline/narrate.mjs $(pwd)/screenplays/<id>.mjs   # TTS, hash-cached: unchanged lines are free
node pipeline/capture-walkthrough.mjs [screenplays/<id>.mjs]  # re-paces to real audio; final mode
npx remotion render remotion/src/index.jsx Walkthrough out/<id>.mp4 --public-dir=remotion/public
node pipeline/make-srt.mjs [<id>]

# STAGE 4 — publish
# 1. edit TITLE/DESCRIPTION/TAGS in pipeline/upload-youtube.mjs; recompute
#    description chapters from walkthrough.json cumulative scene frames
node pipeline/upload-youtube.mjs out/<id>.mp4 out/<id>.srt   # unlisted + captions
#    --auth (one-time consent)  --update <videoId>  --delete <videoId>
# 2. Studio: set the altered-content flag; flip public when ready
# 3. web embed encode when needed:
#    ffmpeg -i out/<id>.mp4 -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p \
#      -movflags +faststart -c:a aac -b:a 160k out/<id>.web.mp4
```

- Stage 2 iterations are free and fast: capture+render only, ~8 min a cycle.
  No TTS runs before the gate; after it, the narration cache means a text
  edit re-bills only the changed lines.
- The composition switches draft/final automatically: if `tmp/narration.json`
  covers every scene, the render is voiced with no draft chrome; otherwise
  it burns subtitles + scene labels for review.
- Capture is drift-sensitive on purpose. Missing pinned text, focus targets
  or counters ABORT the run — the answer is re-discovery (and a narration
  update if a spoken number changed), never forcing the capture through.
- Regeneration is reproducible to within sub-second live-capture jitter:
  identical narration (cache hits prove the text), identical SRT cue text,
  ±1s duration. Verified end-to-end on 2026-08-01.
- Description chapters must be recomputed from `walkthrough.json` scene
  offsets after ANY re-capture (scene starts shift by up to ~1s).
- YouTube: metadata is mutable in place (`--update` merges the snippet so
  omitted fields survive); MEDIA is not — a re-render is a new upload with a
  new ID; `--delete` the superseded one. Give YouTube the master (it
  re-transcodes); the `.web.mp4` re-encode is for docs/social embeds.
- Long-running steps go in background tasks; anything invoking a CLI that
  might read stdin gets `< /dev/null` or it hangs silently.

**YouTube links & CTA practice (verified against YouTube docs, Aug 2026):**
- Video pixels are never clickable. The click surfaces, cheapest first:
  description first line (full `https://soctalk.ai/` form), a language-
  matched link comment (the uploader posts it automatically; PINNING has no
  API — pin it in Studio), and the channel's first profile link. All of
  these need the channel's "Advanced features" enabled (phone verification),
  not YPP.
- The real on-slide click is an end-screen Link element: YPP-only and
  Studio-only. The closing card is kept end-screen-ready anyway: >=6s hold
  and a clear bottom band reserved for the overlay.
- External-link info cards: same YPP gate, worse visibility — skip. Branding
  watermark links only to the channel — not a website CTA. QR on the slide
  only if TV/conference viewing becomes a real channel (small, UTM'd).
- Per-video Studio clicks after upload: pin the link comment, set the
  altered-content flag. One-time channel setup: Advanced features,
  `https://soctalk.ai/` as first profile link.

**Hard rules (everything else is agent judgment):**
- The shared demo tenant is read-only on camera — hover decisions, never
  submit state changes. Filmed mutations need a disposable tenant.
- No ElevenLabs spend and nothing published before Stage 2 approval; voice
  only the text that was approved.
- Fail loudly, publish nothing broken: if the demo doesn't show what
  discovery pinned, stop and say so.
- Never fabricate product data or metrics (hiding a broken cell is fine).
- Secrets stay in the gitignored `video/.env`.
- Screenplay + discovery notes are committed; footage, audio and renders are
  disposable and regenerable.
