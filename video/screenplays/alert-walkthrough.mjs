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
				'This is a real day at one SocTalk tenant, replayed. Two hundred seventy-six alerts will arrive before midnight. Each one flows through the same pipeline: a policy gate, a supervisor, a verdict, and a guard. Most will never need a human.',
			assert: ['The fleet —']
		},
		{
			id: 'dive-auto-closed',
			kind: 'dive',
			enterVia: { clickDot: 'normal' },
			route: '/investigations/9060b022-8169-43e9-8a81-08ccadaf0ce5?view=replay',
			ready: 'Auto-closed FP',
			narration:
				'Pick one out of the stream. A Wazuh alert the pipeline recognized as a false positive and closed on its own, without invoking a model at all. The investigation replay shows every step it took: hours of real time, played back in seconds. Evidence gathered, context checked, closed. Cost of this alert: nothing.',
			focus: [
				{ selector: ':text("Event Timeline")', frac: 0.35, scale: 1.35, hold: 2.6 },
				{ selector: ':text("Verdict")', frac: 0.75, scale: 1.4, hold: 2.4 }
			],
			assert: ['Agent Run', 'Verdict']
		},
		{
			id: 'river-swarm',
			kind: 'river',
			window: 'mid-morning',
			narration:
				'By mid-morning the stream is dense. Most alerts close themselves at machine speed. But watch the guard, because the model does not get the last word.',
			assert: []
		},
		{
			id: 'dive-veto',
			kind: 'dive',
			enterVia: { clickDot: 'veto' },
			route: '/investigations/ba961795-4d11-4b78-819a-2f1b58ed3457?view=replay',
			ready: 'wazuh rule 5402',
			narration:
				'This one, the model wanted to close. A successful sudo by a service account, judged routine with ninety percent confidence. The guard checked that verdict against the tenant’s authorization facts, found nothing that permits it, and vetoed the close. Hard floor. The alert stays alive, and a human gets the call.',
			focus: [
				{ selector: ':text("GUARD")', frac: 0.45, scale: 1.45, hold: 2.6 },
				{ selector: ':text("Verdict")', frac: 0.8, scale: 1.35, hold: 2.2 }
			],
			assert: ['GUARD', 'Verdict']
		},
		{
			id: 'review-consequence',
			kind: 'page',
			route: '/review',
			ready: 'Human Review Queue',
			narration:
				'Which is why a successful sudo to root on a finance host is sitting here, in front of a person, with the AI’s full reasoning attached, waiting for a decision only a human is allowed to make.',
			focus: [
				{ selector: ':text("Successful sudo to ROOT")', frac: 0.3, scale: 1.45, hold: 3.0 },
				{ selector: 'button:has-text("Review")', frac: 0.75, scale: 1.4, hold: 2.2, hoverOnly: true }
			],
			assert: ['Successful sudo to ROOT']
		},
		{
			id: 'river-midnight',
			kind: 'river',
			window: 'day-complete',
			narration:
				'By midnight: two hundred seventy-six alerts in. Two hundred thirty-two closed by the pipeline. Forty-four decided by people, with every risky close the guard caught along the way. That is the shape of a day with SocTalk. AI triage. Human judgment.',
			assert: ['276', '232', '44'],
			endCard: true
		}
	]
};
