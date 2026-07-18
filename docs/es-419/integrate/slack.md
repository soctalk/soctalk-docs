# Slack

SocTalk se comunica con Slack de dos maneras. Ambas usan las mismas credenciales de la app de Slack, pero cubren necesidades operativas distintas:

| Backend | Dirección | Cableado en el chart V1 |
|---|---|---|
| **Notificaciones por webhook** | unidireccional (salida) | Código cableado únicamente en el punto de entrada heredado (`src/soctalk/main.py`). El `app_v1` del chart V1 **no** lo monta. Trata las notificaciones descritas más abajo como el cableado previsto; hoy, publicar requiere ejecutar el orquestador heredado junto con V1 |
| **HIL por Socket Mode** | bidireccional | Código presente (`src/soctalk/hil/backends/slack.py`); tampoco está cableado en V1 |

La única superficie HIL funcional en la ruta de instalación de V1 es la cola de revisión del dashboard. Las páginas de Slack a continuación describen el cableado previsto para cuando ambos backends se entreguen en V1. Para el flujo de revisión del lado del analista, consulta [Revisión humana (HIL)](/es-419/human-review).

## Crea la app de Slack

1. https://api.slack.com/apps → **Create New App** → From scratch.
2. Nombre: `SocTalk` (o el nombre de tu instalación). Workspace: el que usa tu equipo SOC.
3. **OAuth & Permissions** → agrega Bot Token Scopes:
   - `chat:write`
   - `chat:write.public` (permite que el bot publique en canales de los que no es miembro)
   - `channels:read`
   - Para revisión interactiva: `commands` (solo si además quieres slash commands) y `app_mentions:read`.
4. **Install App** → Install to Workspace. Copia el **Bot User OAuth Token** (`xoxb-…`).
5. (Solo HIL) **Socket Mode** → habilítalo. Genera un **App-Level Token** con el scope `connections:write` (`xapp-…`).
6. (Solo HIL) **Interactivity & Shortcuts** → habilítalo. Con Socket Mode habilitado, no necesitas ingresar una Request URL.
7. (Solo HIL) **Event Subscriptions** → habilítalo; suscríbete a `interactive_message_actions` y `block_actions`.
8. Invita al bot a tu canal de revisión: `/invite @SocTalk`.

## Notificaciones por webhook

Para notificaciones unidireccionales solo necesitas una URL de Incoming Webhook, no todo el proceso de la app descrito arriba. Puedes:

- Instalar una app de **Incoming Webhooks** separada en el workspace y obtener la URL.
- O usar la función de Incoming Webhooks de la app que creaste arriba.

### Configura

MSSP UI → Settings → Slack:

| Campo | Notas |
|---|---|
| Webhook URL | `https://hooks.slack.com/services/T…/B…/…` |
| Channel | Anulación opcional de canal; de lo contrario, el webhook publica en su canal predeterminado |
| Notify on escalation | Activado por defecto. Publica cuando un veredicto se cierra como `escalate` |
| Notify on verdict | Desactivado por defecto. Publica también cada disposición `close` — volumen alto |

**No existe una API para modificar la configuración de la integración con Slack en V1** — el chart V1 no monta la ruta heredada `PUT /api/settings`. La configuración de Slack es solo por entorno: proporciona `SLACK_WEBHOOK_URL`, `SLACK_CHANNEL`, `SLACK_NOTIFY_ON_ESCALATION` y `SLACK_NOTIFY_ON_VERDICT` como variables de entorno en el Deployment `soctalk-system-api`.

Las notificaciones de Slack cubren únicamente eventos de escalación y de veredicto (no existe un interruptor `notify_on_capacity`).

Los tokens (webhook URL, bot token, app token) **no** se pueden escribir a través de este endpoint — proporciónalos como variables de entorno en el Deployment del orquestador (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) o mediante env montado desde un Secret. Rótalos aplicando un parche al Secret y reiniciando el orquestador.

### Formato de mensaje

Ejemplo de escalación:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1
AI verdict: Escalate · confidence: medium · 1 malicious observable
View → https://mssp.your-mssp.example/investigations/abc123
```

Block Kit mínimo; sin botones (esos son tarea del backend HIL).

## HIL por Socket Mode

> **Estado:** el backend HIL bidireccional de Slack existe en el código (`src/soctalk/hil/backends/slack.py`) pero **no está cableado al runtime del chart V1 en esta versión**. La cola de revisión del dashboard en `/review` es la única superficie HIL funcional. Trata la configuración de HIL de Slack a continuación como el diseño previsto.

Para el flujo de revisión del analista. La misma app de Slack, más el App-Level Token. El backend HIL de SocTalk abre un WebSocket saliente hacia Slack — no se necesita un endpoint público; funciona detrás de NAT.

### Configura

El interruptor de la UI (Channel, Enable HIL, notify_on_*) está en MSSP UI → Settings → Slack. Los tokens en sí son solo por entorno en esta versión:

```yaml
env:
  - name: SLACK_BOT_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: bot_token } }
  - name: SLACK_APP_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: app_token } }
```

El enrutamiento de canal de Slack por tenant **no está implementado en esta versión** — el `slack_channel` configurado a nivel de instalación recibe todas las revisiones y notificaciones sin importar a qué tenant pertenezca el caso. El enrutamiento por tenant está en el roadmap.

### Qué se publica

Cuando la AI solicita revisión humana, SocTalk publica una tarjeta en el canal configurado:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1

AI verdict: Escalate (confidence: medium)
Observables:
  · 198.51.100.7 (Cortex: malicious, 8/12 analyzers)
  · sshd (process)
  · alice@linux-ep-1 (user)

[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Los botones disparan eventos `block_actions`; el backend HIL de SocTalk los procesa y escribe la decisión de vuelta en el estado del caso. Reject y Needs-more-info abren un modal para la justificación (obligatoria).

Una versión futura cableará el dashboard y Slack para que compartan el estado de revisión. En V1 los dos backends aún no comparten estado — si HIL de Slack estuviera habilitado, la acción en Slack no descartaría la tarjeta del dashboard ni viceversa.

## Rota los tokens

1. En OAuth & Permissions de la app de Slack, usa **Reinstall app** para rotar el bot token. Copia el nuevo `xoxb-…`.
2. (HIL) **Basic Information → App-Level Tokens** → revoca + regenera. Copia el nuevo `xapp-…`.
3. Aplica el parche al Secret:
   ```bash
   kubectl -n soctalk-system patch secret soctalk-slack-creds \
     -p '{"data":{"bot_token":"'$(echo -n xoxb-NEW | base64)'","app_token":"'$(echo -n xapp-NEW | base64)'"}}'
   ```
4. Reinicia el orquestador: `kubectl -n soctalk-system rollout restart deploy/soctalk-system-api`.
5. El backend HIL se reconecta con los nuevos tokens en ~10 s desde que el pod está listo.

## Solución de problemas

| Síntoma | Verificación |
|---|---|
| El bot no publica | `kubectl -n soctalk-system logs deploy/soctalk-system-api | grep slack`. Causa común: el bot no fue invitado al canal de destino |
| Los botones de HIL devuelven "this action is no longer valid" | La propuesta fue decidida por otra vía (dashboard o expiró). Refresca la tarjeta |
| El bot publica pero nunca reacciona a los clics de botón | Socket Mode no está habilitado, o el App-Level Token no tiene `connections:write`. Vuelve a crear el app token |
| Las tarjetas llegan truncadas | Block Kit limita un mensaje individual a 50 blocks. SocTalk agrupa listas largas de observables en varias tarjetas; deberías ver un pie de página "X observables shown of Y" |

## Privacidad

El mensaje de Slack incluye observables (IPs, nombres de usuario, hashes de archivos). Si tu workspace tiene restricciones de cumplimiento, condiciona la integración a la configuración por tenant o usa solo notificaciones por webhook (esas no incluyen cuerpos de observables).

## Punteros de código

| Concepto | Archivo |
|---|---|
| Notificador webhook de Slack | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Backend HIL de Slack | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Plantillas de Block Kit | [`src/soctalk/notifications/slack_templates/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/notifications) |
