# Revisión humana (HIL)

Cómo un analista de un MSSP procesa las acciones propuestas por la AI que esperan una compuerta humana.

Existen dos backends en la base de código: la **cola del dashboard** (siempre activa) y **Slack bidireccional** (opt-in). El backend del dashboard es el único conectado al runtime del chart V1 en esta versión; el backend bidireccional de Slack existe en el código pero aún no lo activa la ruta de instalación V1.

Para el lado del modelo, cuando la AI transfiere el control a la revisión humana, consulta [Pipeline de AI → Compuerta de revisión humana](/es-419/ai-pipeline#human-review-gate).

## Estados de decisión

Toda revisión tiene el mismo contrato de tres decisiones, sin importar el backend:

| Decisión | Efecto en esta versión |
|---|---|
| `approve` | La fila pendiente de la revisión se marca como completada y el texto de `feedback` se agrega al registro de auditoría. El caso **no** se reanuda ni se cierra automáticamente con approve, hoy eso es un seguimiento del lado del analista. |
| `reject` | El caso se cierra como falso positivo (`auto_closed_fp`). Terminal, el grafo no se vuelve a invocar con el `feedback` de la persona. |
| `more_info` | La fila de la revisión se actualiza a `info_requested` con la lista de preguntas. El grafo **no** se vuelve a invocar automáticamente; el analista retoma el caso manualmente. |

Las decisiones escriben filas de auditoría de solo anexado (append-only) etiquetadas con la identidad de la persona, la marca de tiempo y una justificación en texto libre. Nunca son editables después de enviarse.

## Backend del dashboard

La [Cola de revisiones](/es-419/mssp-ui#reviews-human-in-the-loop) en `/review` muestra todas las revisiones pendientes de todos los tenants. Las tarjetas muestran:

- Título de la investigación + tenant
- Chip del veredicto de la AI (`AI: Escalate / Close / Needs More Info`)
- Severidad
- Cantidad de alertas + fecha límite (si hay un SLA configurado)

Al hacer clic en **Review** se abre el detalle de la investigación, desplazado hasta el panel de propuesta. El panel muestra:

- La justificación de la AI (markdown completo)
- La evidencia observable (IPs, hashes, usuarios) con reputación/enriquecimiento de Cortex / MISP
- Tres botones: **Approve**, **Reject**, **Needs more info**
- Un área de texto para la justificación (obligatoria para Reject / Needs more info)

Al enviar se actualiza la fila de revisión pendiente en la base de datos (`approve` / `reject` / `more_info` más el `feedback` o las `questions` del operador). **No existe un outbox de propuestas en V1**: borradores anteriores describían un outbox indexado por clave de idempotencia y consumido por ejecutores posteriores (creación de casos en TheHive, notificación de Slack), pero ese pipeline no está implementado en esta versión. Las decisiones del revisor se detienen en la fila de revisión + el registro de auditoría; cualquier efecto posterior (por ejemplo, la creación de un caso en TheHive) solo ocurre si el worker de AI lo creó en línea durante la ejecución del grafo.

## Backend bidireccional de Slack

Se usa el Socket Mode de Slack para que SocTalk no necesite un endpoint de webhook público; la instalación de SocTalk inicia un WebSocket saliente hacia Slack.

### Requisitos previos

- Una app de Slack en tu workspace con Socket Mode habilitado
- Un token a nivel de app con `connections:write`
- Un token de bot con `chat:write`, `chat:write.public`, `channels:read`
- Un canal donde el bot esté invitado

### Configurar SocTalk

En la UI del MSSP → Settings → Slack:

- **Enable Slack** → on
- **Bot token** → `xoxb-…`
- **App token** → `xapp-…`
- **Channel** → `#soc-reviews` (o el que prefieras)
- **Notify on escalation** → on (envía cada veredicto de escalate)
- **Notify on verdict** → opcional (también envía veredictos de cierre; alto volumen)

Toda la configuración de Slack (tokens, canal, toggles de notificación) es solo por entorno en V1; la ruta heredada `PUT /api/settings` no está montada por el chart V1. Consulta [Slack, Configurar](/es-419/integrate/slack#configure) para el patrón de inyección de variables de entorno.

### Experiencia del operador

Cuando la AI solicita una revisión humana, SocTalk publica una tarjeta en el canal configurado:

```text
[Critical] T1110 brute-force technique simulated on linux-ep-1 (Demo Tenant)
AI verdict: Escalate (confidence: medium)
Observables: 198.51.100.7 (Cortex: malicious, 8/12), sshd, alice@linux-ep-1
[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Los botones responden a través de Socket Mode; la instalación de SocTalk registra la decisión indexada por la clave de idempotencia de la propuesta. La misma propuesta en la cola del dashboard se actualiza en tiempo real; aprobar en Slack cierra la tarjeta del dashboard.

Si el analista hace clic en **Reject** o **Needs more info**, se abre un diálogo de Slack para la justificación (obligatoria).

El enlace **View in UI →** lleva directamente al detalle de la investigación con el panel de propuesta ya desplazado.

### Enrutamiento multi-tenant

En esta versión, todas las revisiones van al único canal de alcance global de la instalación configurado en Settings → Slack. El enrutamiento de canales de Slack por tenant **no** está implementado; un campo `slack_channel_override` en el payload de onboarding se mencionó en documentación anterior, pero el runtime lo ignora. El enrutamiento por tenant está en el roadmap.

### Notificaciones salientes (unidireccionales)

Las mismas credenciales de Slack impulsarían notificaciones de webhook unidireccionales (cierres de casos, decisiones de veredicto) en una versión futura. El código del notificador de webhook existe en `src/soctalk/notifications/slack_webhook.py` pero solo está conectado en el punto de entrada heredado; el `app_v1` del chart V1 no lo invoca. No existe ningún toggle `notify_on_capacity` en ninguna versión.

## Contabilidad de resultados

Las decisiones de revisión escriben una fila de auditoría. El gauge `soctalk_tenant_pending_reviews` está **definido** en el código de observabilidad pero **no se actualiza activamente** en V1; se mantiene en 0. El seguimiento de la profundidad real de la cola de revisiones está en el roadmap. Un contador planificado `human_review_decisions_total` (por analista) tampoco está instrumentado todavía.

## Bypass: modo solo AI

Un modo "auto-aprobar cada escalate" sin compuerta humana **no** está implementado en esta versión. El nodo de veredicto siempre enruta `escalate` a través de `human_review`. Eliminar la compuerta humana está en el roadmap como un toggle explícito restringido solo a `platform_admin`, con la justificación auditada, no como un valor predeterminado silencioso.

## Punteros al código fuente

| Concepto | Archivo |
|---|---|
| Interfaz del backend de HIL | [`src/soctalk/hil/backends/__init__.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Backend bidireccional de Slack | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Backend del dashboard | [`src/soctalk/hil/backends/dashboard.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Webhook unidireccional de Slack | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Enum de estado de propuesta | [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) |
