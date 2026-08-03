# "Your first 10 minutes in SocTalk", presenter script

Entry-level, human-hosted. Layout: full-frame webcam for the open/close;
webcam bubble (bottom-right, crimson ring) over the screen recording in between.
Target 4-5 min. Voice: warm, plain, grounded, a colleague showing you around,
not a pitch. Screen actions in [brackets] cue what to capture/drive.

Read at a natural pace; the bracketed cues are where the screen does the work.

---

## 0. OPEN, full-frame webcam (~12s)
Hi, I'm [NAME]. If you've just gotten access to SocTalk and you're staring at
the login screen wondering where to start, this one is for you. In the next few
minutes I'll take one security alert from "something happened" all the way to a
decision, so you can see how the whole thing fits together. Let's jump in.

## 1. Sign in and dashboard (bubble on, screen main) (~35s)
[Screen: log in; land on the dashboard.]
This is the dashboard. Think of it as the front desk. Up here [top counters] is
the day at a glance, how much came in, how much was already handled, and how
much is waiting on a person. The big idea with SocTalk is simple: the machine
takes the first pass at everything, and a human makes the calls that actually
need judgment. Everything you'll see follows that rhythm.

## 2. Open the alert list (~30s)
[Screen: open Investigations / alert list.]
Here's the work itself. Each row is an investigation, a cluster of related
activity the system pulled together. You don't have to read all of these; that's
the point. The ones that need you are marked. Let's open one.

## 3. Read the first-pass verdict  (~55s)
[Screen: open a single triaged investigation with a verdict.]
So, something tried to run a suspicious command on one of the endpoints.
Notice what the system already did before I got here: it checked the activity
against known-bad patterns, pulled the context around it, and wrote down what it
found. This line [verdict] is its call, and just as important, *why*. When it's
confident something's harmless, it closes it quietly so it never reaches your
queue. When it's not sure, it stops and asks. That's this case.

## 4. Make the human decision (review queue) (~50s)
[Screen: open the review queue; open the escalated case.]
This is the review queue, the short list of things the machine deliberately
handed to a person. This is where you come in. You get the summary, the
evidence, and the system's reasoning, and then *you* decide: is this real, or is
it fine? [hover the decision, do NOT click if on shared/demo] You approve it,
or you send it back, and you leave a note that teaches the system for next time.
That's the whole loop: machine first pass, human judgment.

## 5. Where to go next (~25s)
[Screen: brief pan of nav, settings / chat / analytics.]
That's the core. From here, everything else is support for that loop, you can
ask questions in plain language over here, tune what gets escalated, and see how
the team's doing over time. But you already know the important part.

## 6. CLOSE, full-frame webcam (~15s)
So that's your first ten minutes: sign in, open the thing that needs you, and
make one good call. That's the job, SocTalk just clears everything that
*isn't*. Thanks for watching, and welcome aboard. Everything's at soctalk dot A
I if you want to go deeper.

---

### Capture notes
- Record webcam + mic in one take (OBS/Loom). Separate clean screen capture can
  be filmed with our Playwright pipeline against the demo tenant and synced
  under the bubble, OR she drives live, either works.
- Shared/demo tenant is read-only on camera: hover decision buttons, don't click
  (clicking Review to expand the panel is fine).
- No secrets on screen (LLM keys, tokens), mask if any settings page is shown.
- Bookend cards + captions handled in the Remotion Presenter composition.
