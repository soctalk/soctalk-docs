# t2v workflow — from tutorial brief to published video

This is the operating prompt for producing any SocTalk walkthrough/tutorial
video from the live demo (demo.soctalk.ai). An AI agent executes the stages;
a human gates them. Do not skip stages, reorder gates, or spend TTS credits
before approval. (`run.mjs` is the legacy one-shot; it may only be used on a
screenplay that already has an approval artifact.)

```
brief → [1 DISCOVER] → committed data manifest
      → [2 SILENT DRAFT] → screenplay + silent mp4 + review kit  ⛔ HUMAN GATE → approval artifact
      → [3 VOICE + FINAL] → narrated mp4 + conformance report (+ locales)
```

## Stage 1 — Discover (LLM, read-only, off-camera)

Purpose: pin down the EXACT data the video will feature, before any filming,
so capture is deterministic and the story is verified rather than hoped for.

- Explore the demo read-only (Playwright, no recording): enumerate candidate
  entities for the brief — e.g. clickable replay dots (`.fdot.clickable` /
  `.fdot.veto.clickable`), investigations, pending reviews, authorization
  facts. Open candidates off-camera and judge story quality: does this
  investigation have a legible evidence trail? does this veto have a clean
  blocked-close-vs-authorization-fact story?
- Emit `screenplays/<id>.discovery.json` (COMMITTED beside the screenplay —
  it is the durable record of what was chosen on a drifting live demo): per
  scene, the chosen entity IDs, canonical routes, readiness headings,
  selectors, expected on-screen text (reused verbatim as capture assertions),
  replay-day time windows, plus `capturedAt` and an expiry after which
  discovery must be re-verified.
- Emit a short human-readable summary (chosen, rejected, why). Discovery is
  non-blocking unless the human objects.
- Hard rule: everything here is read-only against the shared tenant.

## Stage 2 — Silent draft (Playwright capture + script, ⛔ gated)

Purpose: give the human a reviewable film and script before any voice exists.

- Write the screenplay from the manifest. Scenes carry: `route`, `ready`,
  `narration`, `actions[]` (navigate / focus / click — clicks only on targets
  pinned in discovery), `assertions[]` (from discovery's expected text), and
  `sourceDiscovery` (path + hash). Validate the shape before capture.
- Before ANY capture (draft or final), re-verify every discovery assertion;
  a missing pinned target fails the run unless the beat is marked `optional`.
  Skips must be reported, never silent.
- Pace scenes with the standard estimate (narration chars ÷ 14 ≈ seconds,
  plus settle margins) and record the per-scene estimate in a draft timing
  manifest — Stage 3 diffs real audio against it.
- Render the DRAFT mp4: no voiceover; narration text burned in as subtitles;
  scene labels + timecodes in a corner. Assemble a review kit under
  `out/review/<id>/` — draft mp4, script, one representative still per scene,
  and (on iterations) what changed since the last draft.
- ⛔ Gate: a human approves explicitly. On approval, write
  `screenplays/<id>.approval.json`: screenplay hash, narration-text hash,
  discovery hash, approver, timestamp. Iterate freely inside this stage —
  every iteration stays silent and free.

## Stage 3 — Voice + final (post-approval only)

- Refuse to start without a valid `<id>.approval.json` whose hashes match the
  current screenplay + discovery. Any text or beat change re-opens the gate.
- Generate narration via ElevenLabs (default voice from `config.mjs`,
  content-hash cached) for exactly the approved text.
- Re-run capture paced to real audio durations; render the final composition
  (no subtitles; standard polish: brand cards, lower thirds, zoom/pan,
  crossfades); produce master + web encode.
- Emit a conformance report beside the output: draft-vs-final per-scene
  duration deltas, assertion results, and a representative frame per scene.
  If any scene's duration shifted beyond ~20% of the approved draft, stop and
  show the report for re-approval instead of publishing.
- Locale variants: one screenplay copy per locale translating only the
  narration strings, carrying the source narration hash and voice ID. A
  locale renders without a fresh gate only if its timing diff stays within
  the same threshold; otherwise its draft goes back through the gate.

## Standing guardrails (all stages)

- Shared demo tenant is read-only on camera: hover decisions, never submit
  state-changing actions. Filmed mutations require a disposable tenant.
- Fail loudly, publish nothing: readiness/assertion misses abort the run.
- Secrets from `video/.env` (gitignored) — never in committed files.
- Don't fabricate product data or metrics; hiding a broken/unrealistic cell
  at capture time is acceptable, inventing values is not.
- Every artifact regenerates from the repo: screenplay + discovery manifest +
  approval artifact + this workflow are the durable inputs; footage, audio
  and renders are disposable outputs.
