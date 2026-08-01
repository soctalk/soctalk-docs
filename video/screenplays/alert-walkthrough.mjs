// BRIEF — "Life of an alert" walkthrough (~2:30, Chris narrating)
// Goal: show the system as ALIVE. The fleet replay is the spine; every act
// dives out of it and returns to it with the day further along. Causal chain:
// volume flows → AI reasons → the guard stops the risky edge → a human
// decides. Audience: SOC leads / MSSP operators evaluating SocTalk.
// Constraints: shared demo tenant is read-only on camera (hover the review
// decision); no play-button/scrubber/cursor-chrome visible during river
// shots; numbers spoken must be asserted at capture time.
// Data: see alert-walkthrough.discovery.json (capturedAt 2026-07-30).
export default {
	id: 'alert-walkthrough',
	title: 'SocTalk',
	subtitle: 'The life of an alert',
	discovery: 'alert-walkthrough.discovery.json',
	scenes: [
		{
			id: 'river-dawn',
			kind: 'river',
			window: 'dawn',
			narration:
				'One tenant, one day, replayed. Two hundred seventy-six alerts. Every alert starts the same way: a first pass against known rules. What the rules cannot settle goes on for a model verdict — and a safety check runs before anything is acted on.',
			assert: ['The fleet —']
		},
		{
			id: 'dive-auto-closed',
			kind: 'dive',
			enterVia: { clickDot: 'normal' },
			route: '/investigations/9060b022-8169-43e9-8a81-08ccadaf0ce5?view=replay',
			ready: 'Auto-closed FP',
			narration:
				'Each dot is an investigation; click one to open it. This is a recurring Wazuh false positive. The rules caught it on the first pass and closed it as recurring benign activity — no model involved, with a reopen window in case the pattern returns. The timeline shows each step, and the agent run shows the cost: zero tokens of a two-hundred-thousand budget.',
			focus: [
				{ selector: ':text("Event Timeline")', frac: 0.35, scale: 1.35, hold: 2.6 },
				{ selector: ':text("0 / 200,000")', frac: 0.78, scale: 1.45, hold: 2.6 }
			],
			assert: ['Agent Run', 'Verdict', '0 / 200,000', 'recurring benign activity', 'reopen window']
		},
		{
			id: 'river-swarm',
			kind: 'river',
			window: 'mid-morning',
			narration:
				'By mid-morning the stream is dense. Known false positives keep closing on the first pass without using the model. The rest get a model verdict — and every verdict gets a safety check before it counts.',
			assert: []
		},
		{
			id: 'dive-veto',
			kind: 'dive',
			enterVia: { clickDot: 'veto' },
			route: '/investigations/ba961795-4d11-4b78-819a-2f1b58ed3457?view=replay',
			ready: 'wazuh rule 5402',
			narration:
				'Here the model’s verdict was close at ninety percent confidence: a service-account sudo it read as routine. The safety check compared that verdict with what is actually allowed — grants, change tickets, baselines. Nothing covers this sudo, so the close was blocked. A hard stop. The investigation went to review instead.',
			focus: [
				{ selector: ':text("Verdict")', frac: 0.28, scale: 1.35, hold: 2.4 },
				{ selector: ':text("HARD FLOOR")', frac: 0.68, scale: 1.5, hold: 2.8 }
			],
			assert: ['90%', 'HARD FLOOR', 'Verdict']
		},
		{
			id: 'review-consequence',
			kind: 'page',
			route: '/review',
			ready: 'Human Review Queue',
			narration:
				'Escalations arrive here with the case attached: the alert chain, the verdict, why the model read it that way, and what was missing when the close was blocked. This one is a successful sudo to root on fin-v5fx. The queue is where an analyst makes the call.',
			focus: [
				{ selector: ':text("Successful sudo to ROOT")', frac: 0.35, scale: 1.45, hold: 3.4 }
			],
			assert: ['Successful sudo to ROOT']
		},
		{
			id: 'review-detail',
			kind: 'page',
			route: '/review',
			ready: 'Human Review Queue',
			// filmed click: expands the case panel inline (read-only; decision
			// buttons are never touched)
			preClick: {
				nearRow: 'Successful sudo to ROOT',
				button: 'Review',
				expect: ['AI Recommendation', 'Escalate (90%)', 'GUARD OVERRIDE', 'do not cover this activity', 'Key Findings', 'Request Info', 'Reject & Close', 'Approve & Escalate', 'Analyst Feedback (required for rejection)']
			},
			narration:
				'Open the case. The recommendation is escalate at ninety percent, and the override is spelled out: the model drafted close, the safety check enforced escalate, because no authorization covers this activity. Key findings and enrichment sit below. The decision stays with the analyst: request info, reject and close, or approve and escalate — with written feedback required to reject.',
			focus: [
				{ selector: ':text("Escalate (90%)")', frac: 0.12, scale: 1.4, hold: 2.4 },
				{ selector: ':text("GUARD OVERRIDE")', frac: 0.38, scale: 1.45, hold: 2.8 },
				{ selector: ':text("Key Findings")', frac: 0.62, scale: 1.35, hold: 2.2 },
				{ selector: 'button:has-text("Approve & Escalate")', frac: 0.84, scale: 1.4, hold: 2.4, hoverOnly: true }
			],
			assert: ['Successful sudo to ROOT']
		},
		{
			id: 'river-midnight',
			kind: 'river',
			window: 'day-complete',
			narration:
				'End of day: two hundred seventy-six alerts in, two hundred thirty-two closed by the pipeline before analyst review, forty-four handled by analysts, thirty-three auto-closes blocked. It is all in the audit trail, and any investigation replays the way you just saw.',
			assert: ['276', '232', '44', '33']
		},
		{
			id: 'outro-site',
			kind: 'card',
			narration: 'Visit us at soctalk dot A I.'
		}
	]
};
