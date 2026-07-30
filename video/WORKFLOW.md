# t2v workflow — brief to published video

Operating prompt for producing SocTalk walkthrough/tutorial videos from the
live demo (demo.soctalk.ai). Optimized for LOW HUMAN EFFORT: the agent infers
sensible defaults and conventions from this repo (existing screenplays,
pipeline, compositions are the house style) and only involves the human where
listed. Don't ask questions a look at the repo or demo can answer.

```
brief → 1 DISCOVER → 2 SILENT DRAFT  ⛔ human approval → 3 VOICE + FINAL
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
