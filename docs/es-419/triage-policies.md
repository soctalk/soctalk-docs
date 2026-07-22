# Políticas de triaje

Un LLM que hace triaje de una alerta de `sudo` es un analista brillante y una garantía deficiente. Hazle la misma pregunta dos veces y podrás obtener dos respuestas. Dile que siempre consulte el registro de cambios antes de decidir y lo hará, casi siempre, la mayoría de las veces. Pero parte del triaje no es una cuestión de criterio. Un paso de recolección de evidencia *tiene* que ejecutarse antes de que un veredicto cuente. Un cierre sobre un activo PCI *debe* pausarse para una revisión humana. Una avalancha de ruido de salud de agentes *no debería* costar siquiera una llamada al modelo. Para esos casos no quieres razonamiento. Quieres una regla.

Una **política de triaje** es esa regla, escrita como datos. No reemplaza al agente, envuelve unas cuantas compuertas deterministas alrededor del **bucle agéntico** (el ciclo de supervisor y herramientas que enriquece, investiga y razona hasta llegar a un veredicto). Cada una de ellas obedece la misma ley:

> **El LLM propone. Una compuerta determinista dispone.**

El modelo permanece libre para razonar. Una función pura decide si su salida surte efecto, y solo interviene en los bordes que puedas *demostrar*: un registro de autorización que contradice la actividad, un IOC en la alerta, un incidente activo que comparte una entidad con este. El ambiguo punto intermedio pasa directamente al modelo, donde corresponde.

![Cómo se evalúa una política de triaje dentro del bucle agéntico](/diagrams/triage-policy-loop.svg)

Léelo de arriba abajo: una alerta se resuelve contra el registro, ejecuta el bucle agéntico bajo las compuertas de la política y aterriza en una **disposición**: la decisión final del caso (autocierre, escalar a un humano o solicitar más evidencia). Debajo de cada cierre automático hay un **piso de seguridad**: un conjunto de vetos no anulables, a nivel de código, que ninguna política puede debilitar, definidos por completo [más abajo](#the-safety-floor). Las compuertas numeradas son toda la superficie, y la siguiente sección las recorre una por una.

La única propiedad que hace que todo esto sea seguro: una política de triaje **redactada por el tenant** puede hacer el triaje **más estricto**, nunca más laxo, sus guardrails solo elevan, y el piso duro debajo de cada cierre no puede debilitarse. (Las políticas *de archivo* integradas y verificadas o gestionadas por el operador son código de confianza y no están sujetas a esa restricción.) El código vive en [`src/soctalk/triage_policy/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/triage_policy).


## Dónde actúa una política de triaje

Una política de triaje gobierna una ejecución en cuatro puntos, las compuertas numeradas en el diagrama de arriba.

1. **Resolver.** Un nodo de entrada compara la alerta contra el registro y escribe la política de triaje activa en el estado de la ejecución. Si la alerta pertenece a una clase operacional conocida sin indicadores de seguridad, la ejecución puede cerrarse de forma determinista aquí mismo sin llegar a llamar al modelo.
2. **Compuerta previa a la decisión.** Una política puede requerir pasos deterministas (por ejemplo, recopilar contexto de autorización) antes de que un veredicto sea legal. Si el supervisor propone un veredicto demasiado pronto, la compuerta lo redirige primero al paso requerido. Una política también puede restringir qué acciones del supervisor son legales en cada fase, y esa restricción se aplica a la salida estructurada del modelo antes de la llamada, de modo que una acción ilegal ni siquiera puede muestrearse.
3. **Guardia posterior al veredicto.** Después de que el modelo redacta un veredicto, una función pura decide si se confirma. Puede anular el borrador (elevar un cierre a un escalamiento), interrumpirlo (mantener el borrador pero enrutarlo a la aprobación de un humano) o dejarlo en pie. Cada anulación queda registrada.
4. **Piso de seguridad.** Un conjunto no anulable de verificaciones protege cada ruta de autocierre. *No* es un único paso, los vetos de IOC/autorización se ejecutan dentro de la guardia posterior al veredicto, y los vetos de kill-switch, tope de volumen e incidente activo se ejecutan de nuevo cuando un cierre se confirma en los planos del worker, el servidor y la ingesta. El diagrama lo dibuja como un solo nodo por claridad; nada en una política de triaje puede debilitarlo, dondequiera que se ejecute.

## El piso de seguridad

El piso se aplica en el código, no en los datos de la política, y rige en cada plano donde un caso puede cerrarse automáticamente: la disposición del worker, el servidor que la confirma y las rutas rápidas de la ingesta (cierre memoizado y autocierre basado en reglas). Un cierre se veta y, en su lugar, el caso se promueve o escala cuando se cumple cualquiera de estos:

| Veto | Cuándo se activa |
|---|---|
| IOC presente | En la ruta del veredicto, un veredicto de enriquecimiento malicioso o una coincidencia en MISP; en las rutas rápidas de la ingesta, cualquier IOC en crudo en la alerta. |
| Autorización contradicha | Existen registros pero no cubren la actividad (expirados, fuera de ventana, alcance equivocado, prohibidos por política). |
| IOC no verificado | Un cierre a nivel del router con observables que ningún enriquecimiento llegó a verificar. |
| Incidente activo | Otra investigación activa comparte una entidad elegible para asociación con esta. |
| Kill switch | El autocierre está desactivado, por tenant o para toda la instalación. |
| Tope de volumen | El conteo móvil de cierres automáticos del tenant está agotado. |

El conjunto efectivo de compuertas en cualquier ejecución es el piso más lo que sea que añada la política activa. Una política de triaje solo puede volver las cosas más estrictas. Esto es lo que hace seguro permitir políticas redactadas por el tenant: una mal configurada u hostil no puede convertirse en un canal para suprimir detecciones.

Vale la pena conocer el kill switch y el tope de volumen por su nombre. `SOCTALK_AUTO_CLOSE_KILL` en el proceso de la API, o el flag de política `auto_close_kill` en un tenant, convierte cada cierre automático en una promoción sin necesidad de ningún despliegue, que es el control al que recurres a mitad de un incidente. `auto_close_volume_cap` (por defecto 500 por cada 24 horas) significa que un bucle de cierre descontrolado degrada a "los humanos revisan estos" en lugar de a una supresión masiva.

## Políticas de triaje integradas

Dos vienen con el producto. Ambas son código verificado y de solo lectura.

**`dual-use-privileged-exec`** maneja actividad de autenticación en el host como `sudo` y `su`, donde el mismo evento es administración rutinaria bajo un registro de cambios que lo cubre e incidente sin él. Requiere el paso `gather_authorization_context` antes de cualquier veredicto, elimina `CLOSE` de las acciones legales del supervisor (de modo que el barato nivel del router no pueda cortocircuitar un caso cuyo punto central es que lo benigno y lo hostil se ven idénticos) y requiere la aprobación de un humano en cualquier cierre que toque un activo clasificado como PCI.

**`agent-health-operational`** maneja el ruido de auto-monitoreo de los agentes de Wazuh, como la regla 202 "Agent event queue is flooded." Esto es una condición de infraestructura, no un evento de seguridad, así que la política lo cierra de forma determinista sin ninguna llamada al modelo, lo que además hace que el resultado sea consistente en lugar de variar de una ejecución a otra. Cualquier indicador de seguridad en la alerta (una técnica de MITRE, un IOC, una señal maliciosa, una clase no atestiguada o un nivel crítico de Wazuh, 12+) veta el cierre determinista y envía la alerta a triaje completo.

Puedes ver ambas, con cada compuerta y guardrail expandidos, en la página **Triage Policies** del panel MSSP.

## El esquema

Una política de triaje es datos. Un intérprete genérico ejecuta cualquier número de ellas.

```yaml
id: regulated-privileged-exec
version: 2
tenant: acme                       # a tenant slug or id; authored policies are always scoped
status: shadow                     # active | shadow
priority: 70                       # lower wins on a multi-match; authored/file >= 60
applies_to:
  rule_groups: [sudo]
  rule_ids: []
  authorization_tracks: [account]
required_steps: [gather_authorization_context]
decision_modules: [authorization_engine]
legal_actions:
  decide:  [VERDICT]               # an unlisted phase is unconstrained
close_signoff_data_classes: [pci]
guardrails:
  - when:
      "and":
        - "==": [{ "var": "authz.class" }, "contradicted"]
        - "==": [{ "var": "verdict" }, "close"]
    effect: override
    to: escalate
    reason: acted outside the terms of an authorization
```

Lee esa condición así: si la clase de autorización resultó `contradicted` y el modelo redactó un `close`, elévalo a `escalate`. Cada nodo es un único operador sobre sus argumentos, y `var` lee un campo del contrato de estado.

| Campo | Significado |
|---|---|
| `applies_to` | Qué alertas gobierna la política. Se compara por grupos de reglas, ids de reglas o el track de autorización de la actividad de la alerta, los tres se combinan con OR. |
| `required_steps` | Nodos deterministas que deben ejecutarse antes de que un veredicto sea legal. |
| `decision_modules` | Declara los motores verificados de los que depende la política (hoy: `authorization_engine`), validado contra los módulos conocidos. La consulta en tiempo de ejecución hoy la impulsan los `required_steps` (por ejemplo, `gather_authorization_context`), no este campo. |
| `legal_actions` | Las acciones del supervisor permitidas por fase (`triage` hasta que se hayan ejecutado los pasos requeridos, luego `decide`). Una fase no listada queda sin restricciones. |
| `close_signoff_data_classes` | Un cierre que se confirma sobre un activo en una de estas clases se interrumpe para la aprobación de un humano. |
| `guardrails` | Reglas declarativas de anulación o interrupción. Ver más abajo. |
| `priority` | Orden en el registro. Las integradas ocupan 10 y 50; cualquier cosa redactada o cargada desde archivo debe ser 60 o superior, de modo que nunca pueda superar en rango las protecciones de una integrada. |

Algunas capacidades están restringidas según de dónde provenga una política:

- **Las disposiciones deterministas** (lo que `agent-health-operational` usa para cerrar sin un modelo) son **exclusivas de las integradas**: acuñar una nueva clase de autocierre es una decisión de revisión de código, no de configuración.
- **Las políticas redactadas no pueden otorgar `CLOSE`** en `legal_actions`. Otorgarlo no añade nada sobre una fase sin restricciones (la línea base ya permite el cierre del router) pero permitiría que el remapeo de acción ilegal forzara cada propuesta a un autocierre sin veredicto que se sostiene únicamente sobre el tosco piso. Las decisiones terminales se enrutan a través de `VERDICT` en su lugar; la validación rechaza `CLOSE` en cualquier fase. Las políticas integradas y de archivo aún pueden listar el conjunto completo de acciones.

## Condiciones de guardrail

Las condiciones son la única lógica que un autor escribe, y se ejecutan en un pequeño lenguaje aislado sobre un contrato de estado documentado. No hay acceso a atributos, ni llamadas a funciones, ni forma de nombrar nada fuera del contrato. Una condición es un árbol de nodos de un solo operador.

Operadores: `var`, las comparaciones (`==`, `!=`, `<`, `<=`, `>`, `>=`), los lógicos `and` / `or` / `!` / `!!`, e `in`.

Los campos que una condición puede leer:

| Campo | Qué es |
|---|---|
| `authz.class` | `covered`, `contradicted` o `absent`, derivado del motor. |
| `authz.in_scope`, `authz.sanctioned_or_routine`, `authz.actor_genuine`, `authz.policy_allowed` | Los cuatro *componentes de expectativa*: los booleanos del motor de autorización para determinar si la actividad cayó dentro de un alcance aprobado, fue sancionada o rutinaria, la realizó un actor genuino y fue permitida por política. |
| `verdict` | La decisión en borrador del modelo. |
| `verdict_confidence` | Su confianza, de `0.0` a `1.0`. |
| `asset.data_classification`, `asset.environment`, `asset.criticality` | Atributos, resueltos por confianza, del activo de la actividad. |
| `enrichment.ioc` | Si hay presente una señal maliciosa. |
| `correlation.active_incident` | Si un incidente activo se solapa. |

Un `effect` es o bien `override` o bien `interrupt`. La supresión no es expresable: `close` no es un objetivo válido, y una anulación solo puede elevar una decisión hacia arriba en la escalera `close < needs_more_info < escalate`, nunca hacia abajo. Una condición que referencia un campo no declarado o un operador desconocido se rechaza cuando la política se valida, antes de que pueda siquiera ejecutarse. Ten en cuenta que `enrichment.ioc` y `correlation.active_incident` también los aplica el piso duro con independencia de cualquier guardrail, en una ejecución del worker ya desplegada `correlation.active_incident` normalmente solo se puebla en el piso al momento de confirmar, así que apóyate en el piso para esos en lugar de volver a derivarlos en un guardrail.

## Redacta una en el editor sin código

Los admins redactan políticas de triaje desde la página **Triage Policies** mientras hay un tenant fijado, sin YAML. Esto recorre la construcción de una política real y no trivial de principio a fin. El ejemplo, `prod-privileged-exec-strict`, gobierna alertas de ejecución privilegiada en un track de autorización de cuenta: exige evidencia de autorización, acota lo que el agente puede hacer y añade guardrails que solo elevan más una compuerta de cierre PCI.

Abre **"+ New triage policy"** (o `/triage-policies/editor`). El editor tiene dos columnas, el **formulario** del documento a la izquierda, y una **proyección del flujo de decisión** en vivo más un **simulador "Try it"** a la derecha que se vuelven a renderizar en cada edición.

![El editor sin código en blanco](/screenshots/triage-policy-editor-01-blank.png)

**1. Identidad.** Dale a la política un id de slug y una **priority**: un entero acotado por el piso (`≥ 60`) donde el menor gana en una doble coincidencia, de modo que una política redactada nunca pueda superar en rango las protecciones integradas.

![Identidad: slug y priority](/screenshots/triage-policy-editor-02-identity.png)

**2. ¿Qué alertas posee?** Los tres matchers se combinan con OR. Aquí la política posee los grupos de reglas `sudo, su, sudoers`, los ids de reglas `5402, 5501`, en el track `account`.

![Matchers](/screenshots/triage-policy-editor-03-matchers.png)

**3. Requisitos de investigación.** Requiere el paso `gather_authorization_context`, declara dependencia del módulo `authorization_engine` y acota la fase `decide` a solo `VERDICT`. Nota que `CLOSE` no se ofrece, las políticas redactadas no pueden otorgarlo.

![Requisitos de investigación](/screenshots/triage-policy-editor-04-requirements.png)

**4. Aprobación de cierre.** Un cierre que se confirma sobre un activo clasificado como `pci` o `phi` se retiene para un humano.

![Aprobación de cierre](/screenshots/triage-policy-editor-05-signoff.png)

**5. Guardrails.** Los guardrails se ejecutan después del piso de seguridad, en orden, gana la primera coincidencia. Cada condición puede redactarse como JSON, el dialecto aislado `{"op": [{"var": "field"}, value]}` con grupos `and`/`or`…

![Redactando una condición como JSON](/screenshots/triage-policy-editor-06-guardrail-json.png)

…o en el constructor visual, que va y vuelve con el JSON. Este guardrail se activa cuando la autorización está **contradicha** *y* el activo es **crítico**, y eleva la decisión a `escalate`.

![La misma condición en el constructor visual](/screenshots/triage-policy-editor-07-guardrail-visual.png)

Dos más completan la política: una anulación por baja confianza a `needs_more_info`, y un `interrupt` que retiene un cierre PCI para revisión humana. El orden importa, el primer guardrail que coincide dispone.

![Los tres guardrails](/screenshots/triage-policy-editor-08-guardrails-all.png)

**6. Lee el flujo, luego simula.** La columna derecha proyecta el documento completo sobre el pipeline: matchers → fases → borrador del LLM → **piso de seguridad (siempre activo)** → guardrails → aprobación → confirmación.

![Proyección del flujo de decisión](/screenshots/triage-policy-editor-09-decision-flow.png)

El panel **"Try it"** previsualiza la lógica de guardrail + piso que el editor puede modelar, un subconjunto de la ruta completa de aplicación de worker/servidor/ingesta, como retroalimentación para la redacción. Aliméntalo con un caso de autorización contradicha y activo crítico y el resultado es `escalate`: pero proviene del **piso de seguridad**, no de esta política. Ese es el invariante central hecho visible: la autorización contradicha es un veto no anulable del piso, y los guardrails de la política solo *elevan* por encima de él.

![El simulador Try-it mostrando el escalamiento del piso](/screenshots/triage-policy-editor-10-try-it.png)

`Create (shadow)` la guarda. El formulario y el documento almacenado son el mismo artefacto, "View as JSON" muestra exactamente lo que se persiste.

![La política completada](/screenshots/triage-policy-editor-11-complete.png)

La validación al guardar es fail-closed y aplica las mismas reglas que las políticas de archivo más algunas más estrictas: el id debe ser un slug, los pasos referenciados y los módulos de decisión y las fases de acción legal deben ser unos que el runtime realmente conozca, `CLOSE` no puede otorgarse, y la definición tiene un tope de tamaño. Una referencia desconocida se rechaza en tiempo de redacción en lugar de ignorarse silenciosamente en tiempo de ejecución. Cada revisión guardada se conserva como historial de solo anexado.

## Shadow, luego activar

Una política redactada tiene cuatro estados, **draft**, **shadow**, **active**, **retired**. La evaluación en shadow se recomienda encarecidamente pero no es obligatoria: una política puede activarse directamente desde draft.

En **shadow**, la política se compara y sus guardrails se evalúan exactamente como lo haría una activa, y sus decisiones que se dispararían se escriben en el rastro de auditoría, pero no cambia ninguna disposición. Esto te da evidencia real de lo que haría contra tráfico en vivo antes de que decida nada.

**Activarla** (la acción **Activate** en la página Triage Policies) la hace gobernar. Como el worker es un proceso separado cuyo registro se carga una sola vez al arrancar, la activación no puede simplemente cambiar un flag en la base de datos, materializa la definición en el ConfigMap del worker del tenant en el siguiente `tenant.reconcile`, y el **rollout del worker es la compuerta de activación**: la política empieza a gobernar solo cuando un worker fresco la lee. Editar una política activa la mantiene activa y vuelve a hacer el rollout con la nueva definición; desactivarla la devuelve a shadow.

![El ciclo de vida de la política redactada: shadow, luego activar para gobernar](/diagrams/triage-policy-lifecycle.svg)

Los operadores que prefieren gestionar las políticas como código aún pueden tomar la vía de git: escribe un archivo YAML en el directorio montado y haz el rollout de los workers. El mismo registro carga tanto las políticas redactadas y activadas como las políticas de archivo escritas a mano.

## El cableado

Dos variables de entorno lo transportan:

- `SOCTALK_TRIAGE_POLICY_DIR` en el runs-worker es el directorio desde el que el registro carga al arrancar.
- `SOCTALK_TENANT_TRIAGE_POLICIES_DIR` en el controlador es el directorio montado por el operador que la ruta de aprovisionamiento lee, valida y renderiza en los valores del chart de cada tenant como un ConfigMap montado.

En la ruta aprovisionada por el chart, las políticas son valores del chart del tenant (`runsWorker.triagePolicies`, renderizadas como el ConfigMap `soctalk-triage-policies`), y un cambio de contenido estampa un checksum en la plantilla del pod de modo que una edición hace el rollout del worker automáticamente. El rollout es la compuerta de activación: como el registro se carga una sola vez por proceso, una política solo empieza a gobernar cuando un worker fresco la lee.

Cada carga, omisión y rechazo queda registrado. Un archivo que falla la validación por cualquier motivo (esquema incorrecto, un campo desconocido, una condición malformada, una prioridad que superaría en rango a una integrada) se rechaza por completo y nunca gobierna nada, así que un mal rollout degrada a "esa política no está activa", nunca a una aplicación incorrecta.
