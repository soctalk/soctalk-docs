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
	id: 'alert-walkthrough-es',
	title: 'SocTalk',
	subtitle: 'La vida de una alerta',
	discovery: 'alert-walkthrough.discovery.json',
	scenes: [
		{
			id: 'river-dawn',
			kind: 'river',
			window: 'dawn',
			narration:
				'Un tenant, un día, reproducido. Doscientas setenta y seis alertas. Cada alerta comienza igual: una primera pasada contra reglas conocidas. Lo que las reglas no pueden resolver pasa a un veredicto del modelo, y una verificación de seguridad se ejecuta antes de actuar.',
			assert: ['The fleet —']
		},
		{
			id: 'dive-auto-closed',
			kind: 'dive',
			enterVia: { clickDot: 'normal' },
			route: '/investigations/9060b022-8169-43e9-8a81-08ccadaf0ce5?view=replay',
			ready: 'Auto-closed FP',
			narration:
				'Cada punto es una investigación; haz clic para abrirla. Este es un falso positivo recurrente de Wazuh. Las reglas lo detectaron en la primera pasada y lo cerraron como actividad benigna recurrente: sin usar el modelo, con una ventana de reapertura por si el patrón regresa. La línea de tiempo muestra cada paso, y la ejecución del agente muestra el costo: cero tokens de un presupuesto de doscientos mil.',
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
				'A media mañana el flujo es denso. Los falsos positivos conocidos se siguen cerrando en la primera pasada sin usar el modelo. El resto recibe un veredicto del modelo, y cada veredicto pasa por una verificación de seguridad antes de que tenga efecto.',
			assert: []
		},
		{
			id: 'dive-veto',
			kind: 'dive',
			enterVia: { clickDot: 'veto' },
			route: '/investigations/ba961795-4d11-4b78-819a-2f1b58ed3457?view=replay',
			ready: 'wazuh rule 5402',
			narration:
				'Aquí el veredicto del modelo fue cerrar, con noventa por ciento de confianza: un sudo de una cuenta de servicio que interpretó como rutinario. La verificación de seguridad comparó ese veredicto con lo que realmente estaba autorizado: permisos, tickets de cambio, líneas base. Nada cubría este sudo, así que el cierre quedó bloqueado. Un bloqueo directo. La investigación pasó a revisión.',
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
				'Los casos escalados llegan aquí con el contexto completo: la cadena de alertas, el veredicto, por qué el modelo lo interpretó así y qué faltaba cuando se bloqueó el cierre. Este es un sudo exitoso a root en fin-v5fx. En esta cola, el analista toma la decisión.',
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
				'Abre el caso. La recomendación es escalar, con noventa por ciento, y la intervención queda clara: el modelo propuso cerrar; la verificación de seguridad forzó el escalamiento porque ninguna autorización cubre esta actividad. Debajo están los hallazgos clave y el enriquecimiento. La decisión queda en manos del analista: pedir información, rechazar y cerrar, o aprobar y escalar, con un comentario escrito obligatorio para rechazar.',
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
				'Fin del día: doscientas setenta y seis alertas recibidas, doscientas treinta y dos cerradas por el pipeline antes de revisión humana, cuarenta y cuatro atendidas por analistas, treinta y tres cierres automáticos bloqueados. Todo queda en el registro de auditoría, y cualquier investigación se reproduce como acaban de ver.',
			assert: ['276', '232', '44', '33']
		},
		{
			id: 'outro-site',
			kind: 'card',
			narration: 'Visítanos en soctalk punto A I.'
		}
	]
};
