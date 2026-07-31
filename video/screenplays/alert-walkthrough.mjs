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
				'A full day of alerts at one tenant, replayed. Two hundred seventy-six events off the SIEM. Every one takes the same path: a deterministic policy gate, a supervisor that routes, a reasoning tier that issues the verdict, and a guard with the power to overrule it.',
			assert: ['The fleet —']
		},
		{
			id: 'dive-auto-closed',
			kind: 'dive',
			enterVia: { clickDot: 'normal' },
			route: '/investigations/9060b022-8169-43e9-8a81-08ccadaf0ce5?view=replay',
			ready: 'Auto-closed FP',
			narration:
				'Each dot opens the investigation behind it. This one is a recurring Wazuh false positive: closed operationally at the policy gate — no model invoked. Disposition close, with a reopen window guarding against drift. The event timeline replays every pipeline step, and the agent run shows the cost: token spend zero, out of a two-hundred-thousand token budget.',
			focus: [
				{ selector: ':text("Event Timeline")', frac: 0.35, scale: 1.35, hold: 2.6 },
				{ selector: ':text("0 / 200,000")', frac: 0.78, scale: 1.45, hold: 2.6 }
			],
			assert: ['Agent Run', 'Verdict', '0 / 200,000']
		},
		{
			id: 'river-swarm',
			kind: 'river',
			window: 'mid-morning',
			narration:
				'Mid-morning, intake peaks. Operational closes absorb the known-benign volume without ever touching the reasoning tier. Everything else gets a model verdict — and no verdict executes unchecked.',
			assert: []
		},
		{
			id: 'dive-veto',
			kind: 'dive',
			enterVia: { clickDot: 'veto' },
			route: '/investigations/ba961795-4d11-4b78-819a-2f1b58ed3457?view=replay',
			ready: 'wazuh rule 5402',
			narration:
				'Here the reasoning tier issued close at ninety percent confidence: a service-account sudo it judged routine. Before execution, the guard evaluated that verdict against the tenant’s authorization facts — grants, change tickets, baselines. No fact covers this activity, so the close is vetoed at the hard floor and the investigation routes to review instead.',
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
				'Guard escalations land in the review queue with the full case attached: alert chain, model verdict, reasoning, and the authorization gap that blocked the close. A successful sudo to root on a finance host is exactly the class of decision that stays with an analyst.',
			focus: [
				{ selector: ':text("Successful sudo to ROOT")', frac: 0.3, scale: 1.45, hold: 3.0 },
				{ selector: 'button:has-text("Review")', nearRow: 'Successful sudo to ROOT', frac: 0.78, scale: 1.4, hold: 2.2, hoverOnly: true }
			],
			assert: ['Successful sudo to ROOT']
		},
		{
			id: 'river-midnight',
			kind: 'river',
			window: 'day-complete',
			narration:
				'End-of-day totals: two hundred seventy-six alerts in. Two hundred thirty-two closed by the pipeline. Forty-four routed to analysts. Thirty-three auto-closes blocked by the guard. Every decision on this board is auditable, and every investigation replays exactly like the ones you just saw.',
			assert: ['276', '232', '44', '33'],
			endCard: true
		}
	]
};
