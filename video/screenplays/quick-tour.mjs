// Screenplay: the single source of truth for one tutorial.
// Each scene: route, readiness gate, narration, and "focus" beats — the
// capture harness glides the cursor to `selector` at `frac` (fraction of the
// narration's duration) and the Remotion composition zooms into it.
export default {
	id: 'quick-tour',
	title: 'SocTalk',
	subtitle: 'A quick tour of the console',
	scenes: [
		{
			id: 'dashboard',
			route: '/',
			ready: 'Dashboard',
			label: 'Dashboard',
			narration:
				'Welcome to SocTalk. The dashboard is your at-a-glance view of the SOC: open investigations, reviews waiting on a human, and triage throughput over the last twenty-four hours.',
			focus: [
				{ selector: 'text=Pending Reviews', frac: 0.35, scale: 1.5, hold: 2.4 },
				{ selector: 'text=Investigation Throughput', frac: 0.75, scale: 1.3, hold: 2.2 }
			]
		},
		{
			id: 'investigations',
			route: '/investigations',
			ready: 'Investigations',
			label: 'Investigations',
			narration:
				'Every alert SocTalk picks up becomes an investigation. The list shows what the AI is working on right now, together with its current status and verdict.',
			focus: [{ selector: 'tbody tr', frac: 0.45, scale: 1.45, hold: 2.6 }]
		},
		{
			id: 'review',
			route: '/review',
			ready: 'Human Review Queue',
			label: 'Human Review',
			narration:
				'SocTalk never acts alone on consequential decisions. The human review queue is where analysts approve, correct, or reject what the AI proposes.',
			focus: [{ selector: ':is(h1,h2):has-text("Human Review Queue")', frac: 0.4, scale: 1.3, hold: 2.4 }]
		},
		{
			id: 'chat',
			route: '/chat',
			ready: 'Conversations',
			label: 'Chat',
			narration:
				'Chat gives you a direct line to the analyst A I. Ask about an investigation, a host, or an indicator, and get an answer grounded in your own telemetry.',
			focus: [{ selector: ':is(h1,h2):has-text("Conversations")', frac: 0.4, scale: 1.3, hold: 2.4 }]
		},
		{
			id: 'authorization',
			route: '/authorization',
			ready: 'Authorization facts',
			label: 'Authorization Facts',
			narration:
				'Authorization facts record what is legitimately allowed in your environment, like an approved change ticket. The triage engine reasons over them, so expected activity stops raising alarms.',
			focus: [
				{ selector: 'tbody tr', frac: 0.35, scale: 1.5, hold: 2.6 },
				{ selector: 'button:has-text("New fact")', frac: 0.8, scale: 1.45, hold: 2.0 }
			]
		},
		{
			id: 'analytics',
			route: '/analytics',
			ready: 'AI Analytics',
			label: 'AI Analytics',
			narration:
				'Finally, A I analytics shows how the system itself is performing: verdict accuracy, triage times, and where human reviewers had to step in. That is the quick tour. Explore the docs to go deeper.',
			focus: [{ selector: ':is(h1,h2):has-text("AI Analytics")', frac: 0.3, scale: 1.25, hold: 2.4 }]
		}
	]
};
