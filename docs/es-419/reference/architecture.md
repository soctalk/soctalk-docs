# Arquitectura

> **Nota de despliegue de V1.** La nomenclatura de la lista de entidades a continuación usa prefijos heredados "case_*" para varias tablas; los nombres reales del esquema de V1 son: `cases`, `investigation_runs`, `investigation_events`, `investigation_iocs`, `investigation_assets`, `investigation_links`, `investigation_outbox`, `proposals`. El nombre de la tabla `cases` no cambia por compatibilidad hacia atrás, pero todas las tablas hijas por investigación usan el prefijo `investigation_*`. De estas, las tablas cases / investigation_runs / investigation_events son ejercitadas por el orquestador actual; `proposals` e `investigation_outbox` están presentes en el esquema, pero el lado ejecutor que las consume está en la hoja de ruta. Lee esta página como la intención arquitectónica; consulta [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) para el esquema exacto.

## 1. Entidades centrales

Forma mínima. Las listas completas de columnas viven en la migración; aquí solo
se nombran los campos que soportan carga.

```
alerts               raw ingest from adapter; AI-triaged
cases                investigation unit; one run at a time
case_runs            a single AI execution span against a case
case_events          ordered event inbox per case (immutable)
proposals            AI-proposed actions awaiting human gate
execution_log        append-only audit of all meaningful actions
notes                markdown / evidence blocks
iocs                 typed artifacts; carry external_context
case_iocs, case_assets   bridge tables
case_links           related-case edges (shared IOC / asset / rule)
case_outbox          outbound work for executors and exports
```

Cada fila que porta contenido lleva `tenant_id`, `visibility` y
`created_at`. RLS aplica por tenancy.

## 2. Modelo de visibilidad

Clases (enum):

```
mssp_only         default; internal reasoning, raw tool output, hypotheses
customer_safe     approved for customer view
system            lifecycle and state-change events, always visible
tool_output       classified per-tool at registration time
```

Reglas:

1. `visibility` es una columna en cada fila visible para el usuario (mensajes, notas,
   propuestas, registros de tool_output, entradas de línea de tiempo, campos del panel de hechos).
2. El valor por defecto al insertar es `mssp_only`. La promoción a `customer_safe` es una
   operación explícita.
3. Las consultas del portal del cliente filtran en la capa de la política RLS, no en el
   renderizado. Una sesión de visor de cliente no puede leer filas `mssp_only` ni
   siquiera mediante SQL directo.
4. Las propuestas tienen visibilidad a nivel de campo: `{action, outcome}` puede ser
   `customer_safe` mientras `{rationale, blast_radius}` permanece `mssp_only`.
   Se renderizan como dos proyecciones.
5. Cada promoción de visibilidad emite una entrada en `execution_log` con el
   actor y la justificación.

Denegación-de-promoción-por-defecto: las políticas pueden degradar la visibilidad pero no pueden
elevarla sin una acción explícita de un principal autorizado.

## 3. Ciclo de vida de la ejecución (run)

Estados:

```
active           run consuming events and taking steps
waiting_on_gate  a proposal is pending; run does not mutate state
halted_budget    budget exceeded; requires analyst resume
paused           analyst-paused
completed        case closed
failed           unrecoverable error; requires analyst resume or restart
```

Transiciones:

```
active → waiting_on_gate     on proposal created (status = proposed)
waiting_on_gate → active     on proposal approved/rejected (new event)
active → halted_budget       on budget exceeded
halted_budget → active       on analyst resume (grants new budget)
active → paused              on analyst pause
paused → active              on analyst resume
active → completed           on case close
* → failed                   on uncaught error, preserved for diagnosis
```

Invariantes:

- Como máximo una ejecución (run) por caso en estado `active | waiting_on_gate |
  halted_budget | paused`. Se impone mediante un índice único parcial sobre
  `case_runs(case_id) WHERE status IN (...)`.
- Contadores de presupuesto en la ejecución: `tokens_used`, `dollars_used`,
  `tool_calls_used`, `wall_clock_ms`. Se imponen del lado del servidor; advertencia suave
  al 75%, detención dura al 100%.
- Una ejecución en `waiting_on_gate` no procesa eventos del inbox excepto
  eventos de resolución de gate (proposal.approved / .rejected).

## 4. Inbox de eventos, ordenamiento, coalescencia, idempotencia

Todo el trabajo entrante para un caso aterriza en `case_events`:

```
event_id              uuid PK
case_id               FK
run_id                FK nullable
seq                   bigint, case-scoped monotonic (sequence)
kind                  enum (alert_ingested, tool_result,
                            proposal_approved, proposal_rejected,
                            analyst_message, analyst_correction,
                            budget_warning, external_signal, ...)
payload               jsonb
causation_event_id    uuid nullable (which event caused this one)
correlation_id        uuid (spans a causally-related fan-out)
idempotency_key       text unique per case
created_at            timestamptz
```

Reglas:

1. `seq` se emite mediante una secuencia con alcance de caso al insertar. Los consumidores leen
   estrictamente en orden de `seq`.
2. `idempotency_key` es único por `case_id`. La inserción duplicada se
   descarta silenciosamente (devuelve la fila existente).
3. Coalescencia: antes de insertar, los eventos que coinciden con `(case_id, kind,
   payload.signature, window)` se fusionan en una sola fila. La firma es
   específica del kind (alerta: huella de IOC + regla + activo; tool_result:
   tool_id + hash de params).
4. `causation_event_id` enlaza causa → efecto para el replay.
   `correlation_id` agrupa eventos de un único disparador externo o
   acción del analista.
5. Los eventos son inmutables. Las actualizaciones se expresan como eventos de seguimiento.

Ejemplo de ráfaga: 100 alertas de host similares en 5 minutos se fusionan en un solo
evento `alert_ingested` que porta una lista `asset_ids: [...]`. La ejecución
lo procesa una vez.

## 5. Ciclo de vida de la propuesta y contrato de ejecución

Estados:

```
draft        being composed by the AI
proposed     submitted to human gate
approved     human approved (with typed reason if required)
rejected     human rejected (reason required)
executing    outbox picked up; executor running
executed     action complete, result recorded
rolled_back  post-execution reversal (rare, analyst-initiated)
failed       executor error
```

Idempotencia:

```
proposal.idempotency_key = sha256(case_id || action_type ||
                                   canonical_json(params))
```

Las propuestas duplicadas dentro de una ventana activa (por defecto 15 minutos) se
rechazan al insertar. Garantiza que la AI no pueda dispararse dos veces ni siquiera bajo
una re-ejecución.

Comportamiento del gate:

- En `proposed`: la ejecución transiciona a `waiting_on_gate`.
- En `approved`: inserta una fila en `case_outbox` con
  `kind = 'execute_proposal'`, `idempotency_key = proposal.idempotency_key`.
  Emite `proposal_approved` en `case_events`. La ejecución se reanuda.
- En `rejected`: emite `proposal_rejected` con la razón en
  `case_events`. La ejecución se reanuda. Sin fila en el outbox.

Ejecución:

- Un worker ejecutor separado consume `case_outbox` y realiza la
  acción.
- En caso de éxito: registra `execute_proposal_result` en `case_events`,
  actualiza la propuesta → `executed`, escribe una entrada en `execution_log`.
- En caso de fallo: registra el error, actualiza la propuesta → `failed`, escribe
  una entrada en `execution_log`. La ejecución puede proponer un reintento.
- Exactamente-una-vez mediante `idempotency_key`: las filas del outbox con claves duplicadas
  se rechazan. Los workers ejecutores reclaman filas con un lease (p. ej.,
  `FOR UPDATE SKIP LOCKED`).

La ejecución de la AI no ejecuta efectos secundarios en línea. Todo pasa
por el outbox.

## 6. Esquema e invariantes del registro de ejecución

Solo-anexar (append-only), separado de la conversación:

```
log_id              uuid PK
case_id             FK
run_id              FK nullable
actor_kind          enum (ai, human, system, executor)
actor_id            text
kind                enum (tool_call, proposal_state_change,
                          approval, override, visibility_promotion,
                          correction_applied, policy_bound,
                          export_emitted, ...)
subject_type        enum (case, proposal, ioc, asset, note, ...)
subject_id          text
before              jsonb nullable
after               jsonb nullable
versions            jsonb (model_id, prompt_version, template_version,
                           policy_version at time of action)
ts                  timestamptz default now()
```

Invariantes:

1. No se permite ningún UPDATE ni DELETE desde los roles de la aplicación. Solo INSERT + SELECT.
   Se impone en la capa de otorgamiento de roles de Postgres.
2. Cada cambio de estado de propuesta, cada llamada a herramienta, cada aprobación,
   cada anulación por parte del analista de una decisión de la AI, cada cambio de visibilidad,
   cada corrección, cada despacho al outbox escribe una fila.
3. `versions` captura el stack que produjo la acción. Requerido para
   la reproducibilidad y la calibración a posteriori.
4. La conversación es una vista renderizada de un subconjunto de eventos; no es
   auditoría. Destruir o compactar la conversación no destruye la auditoría.

## 7. Autoridad del panel de hechos y flujo de corrección

El estado estructurado del caso (hipótesis, IOCs, activos, resumen de la línea de tiempo,
confianza, directivas activas) es la salida de un reductor sobre `case_events`.
Nunca es mutado directamente por la conversación.

Reglas:

1. Los mensajes de la conversación no escriben estado estructurado.
2. Las actualizaciones de la AI al estado estructurado ocurren mediante eventos emitidos por la AI
   (`hypothesis_updated`, `ioc_added`, `asset_linked`).
3. Las ediciones del analista en el panel de hechos emiten eventos `analyst_correction`.
   El reductor las aplica. La AI consume la corrección como el siguiente
   evento del inbox y vuelve a razonar a partir del estado corregido.
4. El panel de hechos es eventualmente consistente con `case_events`. Se mantiene una
   proyección materializada (tabla o vista); las lecturas pueden
   acceder a ella directamente.
5. Las correcciones directas al registro de ejecución están prohibidas; las correcciones
   se expresan como eventos nuevos más un puntero al evento corregido.

## 8. Taxonomía de capacidades de herramientas

Cada herramienta se registra con una clase de capacidad, una política de aprobación
por defecto y un modelo de costo.

Clases de capacidad:

```
read_local               inspect SocTalk state only
read_external_silent     no target footprint (feeds, cached intel, vector)
read_external_attributed trace at target (SIEM query, EDR read)
write_sandbox            footprint without target mutation (detonation)
write_external           target state change (block, isolate, notify)
```

Política de aprobación por defecto por clase:

```
read_local                → autonomous
read_external_silent      → autonomous
read_external_attributed  → analyst_approve
write_sandbox             → analyst_approve
write_external            → typed_reason
```

Modelo de costo por herramienta: `{tokens_est, dollars_est, wall_ms_est, footprint}`.
El presupuesto de la ejecución rastrea la suma.

## 9. Precedencia de políticas

Las políticas se fusionan en este orden, las inferiores anulan a las superiores:

```
1. install default       (shipped in chart, read-only in v1)
2. tenant override       (MSSP sets per customer)
3. case template         (phishing, ransomware, etc.)
4. case-local override   (set for this one case by analyst)
```

Para cada clave de política (aprobación de herramienta, auto-cierre, promoción de visibilidad,
plantillas de respuesta, presupuesto), el valor efectivo es el alcance más profundo
que la define.

Invariantes:

1. La promoción de visibilidad nunca se establece en `permissive` por defecto en el
   alcance de instalación. El valor por defecto es "se requiere promoción explícita".
2. Una política de tenant no puede anular un tope duro a nivel de instalación (p. ej.,
   `max_tokens_per_case`).
3. Las anulaciones locales del caso tienen alcance del caso y no persisten a
   casos futuros.

## 10. Semántica de auto-cierre / reapertura

Auto-cierre para falsos positivos de alta confianza:

```
Trigger:
  AI assessment = fp, confidence ≥ policy.auto_close_threshold
  AND policy.auto_close_enabled is true for the tenant
  AND no active directive prevents auto-close

Action:
  case.status = 'auto_closed_fp'
  case.reopen_window_until = now() + policy.reopen_window
  case.reopen_signature = {
    ioc_fingerprints: [...],
    asset_ids: [...],
    time_window: {start, end}
  }
  run transitions to completed
  execution_log row written
```

Reapertura:

```
Trigger:
  new case_events row with kind ∈ {alert_ingested, external_signal}
  whose signature intersects a case's reopen_signature
  where case.status = 'auto_closed_fp'
    AND now() < case.reopen_window_until

Action:
  case.status = 'active'
  emit reopened event into case_events
  new run created
  execution_log row written
  conversation receives a system message noting the reopen
```

Interruptor de emergencia (kill switch):
- `IntegrationConfig.auto_close_enabled` por tenant (por defecto: activado).
- `CaseTemplate.auto_close_disabled` por tipo de caso.

## 11. Contrato de exportación a TheHive (basado en outbox, unidireccional)

Refleja casos, IOCs y notas seleccionadas hacia afuera a TheHive cuando el
tenant tiene `thehive_export_enabled`. Nunca acepta cambios entrantes.

Fila del outbox (en `case_outbox`):

```
id                  uuid PK
kind                'export.thehive.case' | 'export.thehive.ioc' | ...
external_system     'thehive'
external_ref        TheHive object id (filled on first successful mirror)
object_type         case | ioc | note
object_id           internal subject id
idempotency_key     sha256(object_type || object_id || state_hash)
payload             jsonb
export_status       pending | in_flight | succeeded | failed | skipped
attempts            int
last_error          text nullable
next_attempt_at     timestamptz
created_at, updated_at
```

Reglas:

1. Un cambio de estado en un objeto reflejado encola una fila de exportación con una
   `idempotency_key` fresca (incorpora el hash del estado).
2. El worker reclama con `FOR UPDATE SKIP LOCKED`. En caso de éxito, registra
   `external_ref` (creando o actualizando del lado de TheHive según sea necesario) y
   escribe en execution_log.
3. Los webhooks entrantes de TheHive se aceptan solo para casos de dashboard de solo
   lectura (no en v1). Cualquier intento de aceptar estado entrante se
   rechaza y registra explícitamente.
4. Sin bucle de reconciliación: TheHive es un espejo aguas abajo, la fuente
   de verdad es SocTalk.
5. Las exportaciones fallidas reintentan con retroceso exponencial hasta un tope; el fallo
   permanente aparece en el panel de salud de integraciones.

## 12. Pruebas obligatorias e invariantes

La suite de pruebas (unitarias + integración) debe cubrir:

1. **Inmutabilidad del registro de ejecución.** UPDATE y DELETE contra
   `execution_log` desde el rol de la aplicación fallan en la capa de Postgres.
2. **Una única ejecución activa por caso.** Los intentos concurrentes de crear una
   segunda ejecución activa fallan con una violación de restricción única.
3. **Idempotencia de propuestas.** Enviar dos propuestas con la misma
   clave de idempotencia dentro de la ventana: la segunda se rechaza.
4. **Comportamiento de pausa por gate.** Una ejecución con una propuesta `proposed` no
   consume eventos que no sean de gate de su inbox.
5. **Exactamente-una-vez del outbox.** Dos workers reclamando la misma fila del outbox
   resultan en uno que tiene éxito y uno que no hace nada.
6. **Aplicación de visibilidad.** Una sesión de visor de cliente no puede seleccionar
   filas `mssp_only` de ninguna tabla, ni siquiera con SQL directo.
7. **Promoción de visibilidad registrada.** Cada promoción de `mssp_only`
   a `customer_safe` produce una fila en `execution_log`.
8. **Flujo de corrección.** El evento de corrección del analista produce un nuevo evento
   que el reductor aplica; la proyección del panel de hechos refleja la
   corrección.
9. **Reapertura por auto-cierre.** Un evento que coincide con una reopen_signature dentro
   de la ventana reabre el caso e inicia una nueva ejecución.
10. **Idempotencia de la exportación a TheHive.** Reejecutar una exportación para un objeto
    cuyo estado no ha cambiado es una operación nula (misma idempotency_key).
11. **Política de aprobación de herramientas.** Una llamada a una herramienta `write_external` sin una
    aprobación typed_reason no puede llegar al ejecutor.
12. **Precedencia de políticas.** La anulación local del caso gana sobre la del tenant, que
    gana sobre la de instalación para la misma clave de política.

## 13. Fuera de esta especificación

- Modelos de componentes, comportamiento visual, análisis de la barra de comandos → el workstream de la UI de conversación.
- Correlación de campañas, puntuación, mecánicas cross-tenant → el workstream de campañas.
- Biblioteca de prompts, contenidos del registro de herramientas de LLM, política de versión de modelo
  → separar el workstream del runtime de LLM (LLM runtime) cuando lleguemos ahí.
