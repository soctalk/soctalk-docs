# t2v workflow — brief to published video

Operating prompt for producing SocTalk walkthrough/tutorial videos from the
live demo (demo.soctalk.ai). Optimized for LOW HUMAN EFFORT: the agent infers
sensible defaults and conventions from this repo (existing screenplays,
pipeline, compositions are the house style) and only involves the human where
listed. Don't ask questions a look at the repo or demo can answer.

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
Locales: translate the narration strings, reuse everything else; re-gate only
if something material changed.

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
- Every video ends on the standing closing slide (the "URL hero" layout,
  implemented in Walkthrough.jsx's CardScene): small logo + wordmark row, a
  spaced "VISIT US" eyebrow, `soctalk.ai` large and plain (no container), a
  crimson rule, and the lemma small and muted beneath — on the app-dark
  background. Optional one plain spoken line ("Visit us at soctalk dot
  A I.") — nothing salesy.
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
