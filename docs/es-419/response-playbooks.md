# Response Playbooks

## De un veredicto a una acción

El [pipeline de triaje con AI](/es-419/ai-pipeline) de SocTalk existe para responder una sola pregunta sobre una alerta: ¿es real y qué debería pasar con el caso? El bucle agéntico enriquece la alerta, reúne contexto, investiga y razona hasta llegar a un veredicto, y la ejecución termina en una disposición. La disposición es la decisión final, una de estas: escalar a un humano, cerrar automáticamente como falso positivo o pedir más evidencia. Esa decisión es el producto de todo el pipeline previo, y es donde las [políticas de triaje](/es-419/triage-policies) hacen su trabajo, manteniendo deterministas las partes del triaje que deben estar garantizadas y dejando que el modelo razone sobre el resto ambiguo.

Una disposición por sí sola no cambia nada en el mundo exterior. No abre un ticket, no notifica al on-call, no entrega el caso a un SOAR ni desconecta de la red una laptop comprometida. Un response playbook es la capa que actúa sobre la disposición. Se ejecuta estrictamente después de que el triaje se confirma, lee lo que el triaje produjo y lo convierte en pasos concretos.

Lo que lee es un único objeto tipado llamado el sobre de disposición (disposition envelope). SocTalk arma el sobre en el momento en que la disposición se vuelve definitiva, dentro de la misma transacción de base de datos, y contiene todo aquello sobre lo que una respuesta podría basarse. Eso es: la disposición efectiva, es decir, la decisión final después de que el piso de seguridad haya dicho lo suyo; el veredicto del modelo y su confianza; la severidad de la alerta; sus grupos de reglas e ids de reglas; las técnicas y tácticas de ATT&CK a las que fue mapeada; las entidades e IOCs involucrados; y qué vetos del piso de seguridad se activaron en el camino. El sobre es el contrato entre triaje y respuesta, y también es el payload exacto que un playbook entrega a cualquier sistema aguas abajo.

![Cómo un response playbook consume la disposición del triaje y actúa sobre ella](/diagrams/response-playbook-loop.svg)

Todo lo que sigue es el lado derecho de esa imagen: cómo un playbook hace match con el sobre, qué acciones puede tomar y cómo las peligrosas quedan detrás de un humano. El código vive en [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response).

## Qué se ejecuta por sí solo y qué necesita aprobación

Las acciones se dividen en dos grupos según cuánto pueden afectar tu entorno. Escribir una nota en el caso o enviar una notificación a un webhook es seguro de hacer por sí solo, porque lo peor que puede pasar es agregar ruido, así que esas se ejecutan de inmediato sin que nadie las apruebe. Aislar un endpoint o deshabilitar una cuenta es otro asunto, así que esas nunca se disparan por sí solas. Cuando un playbook requiere una de ellas, no la ejecuta. Levanta una propuesta sobre el caso, y un analista la revisa y aprueba antes de que ocurra algo. El modelo nunca toma una acción de contención por sí solo durante el triaje, y un playbook no puede tomar una por sí solo durante la respuesta. En ambos casos una persona da el visto bueno a cualquier cosa que alcance un sistema en vivo.

Tres reglas viven en el código en lugar de en los datos del playbook, y ningún playbook puede debilitarlas. Un cierre es la dirección que un atacante más querría desencadenar, así que en la ruta de cierre un playbook solo puede anotar o auditar, nunca tomar una acción externa. El kill switch de despacho, configurado con `SOCTALK_RESPONSE_DISPATCH_KILL` en el proceso de la API o con el flag `response_dispatch_kill` en un tenant, detiene toda respuesta sin rollout, que es el control al que recurrir cuando un conector empieza a comportarse mal en medio de un incidente. Y una respuesta se dispara solo si la disposición efectivamente surtió efecto sobre el caso. Si un analista cerró o fusionó la investigación mientras la ejecución seguía en curso, no se despacha nada contra un estado que nunca ocurrió.

## Las tres capacidades

Un playbook se refiere a una capacidad por nombre y no puede nombrar nada más. Un nombre desconocido se rechaza cuando el playbook se valida. Hoy se incluyen tres capacidades.

`annotate_investigation` escribe una nota del sistema en el caso. Solo toca SocTalk, se ejecuta por sí solo y es la única acción permitida en un cierre.

`notify_webhook` publica el sobre firmado en el webhook configurado del tenant. Este es el traspaso a un SOAR externo. SocTalk firma el sobre y lo envía, y el receptor es dueño de todo lo que pasa después. También se ejecuta por sí solo.

`external_action` es la que necesita aprobación. Envía una acción nombrada junto con el sobre firmado a un endpoint que el operador configuró, y aquí es donde el trabajo real —aislar un endpoint o deshabilitar una cuenta— vive fuera de SocTalk detrás de un contrato estable. Nunca se ejecuta sin que un analista la apruebe primero.

Un detalle mantiene seguro a `external_action`. El autor de un playbook nombra un endpoint y una acción, nunca una URL. El operador mapea ese nombre de endpoint a una URL real y a un secreto de firma en la política de tenant `response_action_endpoints`, de modo que un autor puede pedir aislar en el endpoint `edr` pero no puede elegir a dónde va realmente la solicitud. Cada solicitud se firma con HMAC y se niega a alcanzar una dirección privada o link-local.

## El esquema

Un response playbook es dato, y un solo intérprete ejecuta cualquier cantidad de ellos. El playbook que el tutorial de abajo construye se ve así:

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active or shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx), not names
  mitre_tactics: ["Lateral Movement"]   # tactic strings as your source emits them
response:
  on_escalate:
    - capability: external_action
      when: { ">=": [{ "var": "severity" }, 10] }
      params: { endpoint: edr, action: isolate_endpoint }
    - capability: notify_webhook
    - capability: annotate_investigation
      params: { body: "endpoint isolation proposed for lateral-movement alert" }
  on_close:
    - capability: annotate_investigation
      params: { body: "auto-closed as false positive" }
```

El bloque `applies_to` decide qué alertas posee el playbook. Hace match según grupos de reglas, ids de reglas, ids de técnica de ATT&CK o tácticas de ATT&CK, y los cuatro se combinan con OR, así que basta con que cualquiera de ellos coincida para que haya match. Un `applies_to` vacío hace match con todas las alertas, lo cual está bien, porque las listas de disposición ya deciden cuándo un playbook realmente se dispara. El matching de ATT&CK sigue una regla. Las técnicas se hacen match por su id canónico, como `T1021`, nunca por nombre, porque los nombres legibles por humanos son inestables. Las tácticas se hacen match por cualquiera que sea el string que emita la fuente de la alerta, y Wazuh envía nombres como `Lateral Movement` en lugar de referencias `TA`.

Bajo `response`, `on_escalate` contiene hasta ocho acciones a tomar cuando el caso escala, y `on_close` contiene hasta cuatro acciones de nivel anotación para un cierre automático. Cada acción es un nombre de capacidad, una condición `when` opcional y una bolsa de `params` que la capacidad lee. Los params son de paso directo. `external_action` extrae de ellos `endpoint` y `action` y reenvía el resto, y no necesita el host de destino nombrado en los params, porque el sobre firmado completo viaja con cada solicitud y las entidades van dentro de él.

## Condiciones

Una condición `when` es la única lógica que un autor escribe, y se ejecuta en el mismo pequeño lenguaje aislado (sandboxed) que los guardrails del triaje. Es un árbol de nodos de un solo operador sobre un conjunto fijo de campos, sin acceso a atributos, sin llamadas a funciones y sin forma de nombrar nada fuera del contrato. Los operadores son `var`, las comparaciones `==`, `!=`, `<`, `<=`, `>` y `>=`, los lógicos `and`, `or`, `!` y `!!`, e `in`. Una acción se dispara solo cuando su condición se cumple, y una condición sobre datos que están ausentes es simplemente falsa en lugar de un error.

Los campos que una condición puede leer provienen todos del sobre. Está la `disposition` efectiva y la `worker_disposition` que el modelo propuso antes de que el piso la cambiara; `floor_vetoed`, que indica si un veto del piso alteró el resultado; `verdict_confidence` y `severity`; los `rule.groups` y `rule.ids` de la alerta; y los campos de ATT&CK, `mitre.techniques` que contiene los ids canónicos `Txxxx` y `mitre.tactics` que contiene los strings de tácticas de la fuente. Los últimos cuatro son listas, así que los pruebas con `in`. Escribir `{"in": ["T1021", {"var": "mitre.techniques"}]}` dispara la acción cuando la alerta lleva la técnica T1021. Referenciar un campo u operador que el contrato no declara rechaza el playbook cuando se guarda, mucho antes de que pudiera siquiera ejecutarse.

## Construye uno en el editor no-code

Los admins crean response playbooks desde la página **Response Playbooks** mientras un tenant está fijado, sin necesidad de YAML. Esto recorre la construcción del playbook `isolate-lateral-movement-endpoint` del esquema de arriba, de principio a fin. Propone aislar un endpoint ante una escalación de movimiento lateral de alta severidad, notifica al SOC y anota el caso.

Abre **"+ New response playbook"** (o navega a `/response-playbooks/editor`). El editor tiene dos columnas. El formulario del documento está a la izquierda, y a la derecha hay un diagrama de flujo en vivo que se vuelve a renderizar en cada edición, mostrando la disposición desplegándose hacia las acciones, con las que necesitan aprobación enrutándose primero a través de un paso de aprobación.

![El editor no-code en blanco](/screenshots/response-playbook-editor-01-blank.png)

Empieza por la identidad. Dale al playbook un id de slug y una prioridad, donde un número más bajo gana en un match múltiple.

![Identidad](/screenshots/response-playbook-editor-02-identity.png)

Luego, decide qué alertas posee. Los cuatro matchers se combinan con OR. Este playbook posee los grupos de reglas `sudo` y `su` y, de forma más útil, la técnica de ATT&CK `T1021` (Remote Services) y la táctica `Lateral Movement`, así que se dispara ante cualquier alerta mapeada a movimiento lateral, sin importar qué regla la levantó. El campo de técnica toma ids, no nombres, y el campo de táctica toma el string que emite tu fuente.

![Matchers, incluido ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

Ahora la acción de aislamiento. En escalate, agrega `external_action`, la marcada como "needs approval". Nombra el endpoint que el operador configuró y la acción, que es `isolate_endpoint`, en sus params, y nunca ingresas una URL. Agrega una condición para que solo se dispare en una escalación de alta severidad.

![La acción de aislamiento con una condición](/screenshots/response-playbook-editor-04-isolate.png)

Agrega las dos acciones que completan la respuesta y se ejecutan por sí solas. Un `notify_webhook` entrega el caso al SOAR del SOC, y un `annotate_investigation` deja un rastro de auditoría.

![Las acciones notify y annotate, que se ejecutan por sí solas](/screenshots/response-playbook-editor-05-tier0.png)

Lee el flujo mientras construyes. La columna derecha proyecta el documento completo. El sobre de disposición se despliega hacia cada acción, la acción de aislamiento se enruta a través de un paso de aprobación antes de poder ejecutarse, y las otras dos se muestran ejecutándose por sí solas.

![El diagrama de flujo, con la acción de aislamiento enrutándose a través de aprobación](/screenshots/response-playbook-editor-06-flow.png)

Guardar con **Create (shadow)** lo persiste. El formulario y el documento almacenado son el mismo artefacto, y "Preview JSON" muestra exactamente lo que se guarda. La validación al guardar es fail-closed. El id debe ser un slug, cada capacidad debe ser uno de los nombres verificados, `on_close` solo puede anotar, y las condiciones deben referenciar el contrato declarado. Una referencia desconocida se rechaza mientras estás creando, nunca se descarta silenciosamente en tiempo de ejecución.

![El playbook completado en la lista, listo para activar](/screenshots/response-playbook-editor-07-list.png)

## Shadow, luego activa

Un playbook creado pasa por cuatro estados: draft, shadow, active y retired.

En shadow, el playbook se hace match y sus acciones se seleccionan exactamente como lo haría uno activo, y sus acciones que se dispararían se escriben en el rastro de auditoría, pero no se encola nada. Esto te da evidencia real de lo que haría contra tráfico en vivo antes de que haga algo.

Activarlo, con la acción **Activate** en la página Response Playbooks, lo enciende, y a diferencia de una política de triaje surte efecto en vivo. SocTalk evalúa los response playbooks a medida que se decide cada caso, así que un playbook activo aplica a la siguiente disposición sin ningún rollout que esperar. Desactivarlo lo devuelve a shadow de inmediato.

Cuando una acción que necesita aprobación surge en una escalación real, aterriza como una propuesta sobre el caso. El analista ve exactamente qué se ejecutaría y contra qué host, y aprobarla es lo que dispara el aislamiento. La acción se ejecuta una vez, la respuesta que recibió se registra, y una entrega repetida nunca la ejecuta dos veces.

## El cableado

Unas cuantas piezas soportan todo esto. `SOCTALK_RESPONSE_PLAYBOOK_DIR` en el proceso de la API es un directorio de playbooks YAML cargados al arranque, que es la ruta gestionada por git para operadores que prefieren playbooks como código. Los playbooks creados en la UI viven en la base de datos, mantenidos como un historial de solo agregado (append-only) y con alcance de modo que un tenant solo vea los suyos, y SocTalk los fusiona con los playbooks de archivo de manera que el playbook propio de un tenant sobrescribe uno de archivo con el mismo id. `response_webhook_url`, con un `response_webhook_secret` opcional, fija el destino de `notify_webhook` en un tenant. Y `response_action_endpoints` en un tenant mapea nombres de endpoint a su url y secreto para `external_action`, que es como el operador mantiene el control de los destinos mientras un playbook solo nombra uno.

Cada match, aprobación, acción y rechazo se registra, y cada acción que se ejecuta registra el id y la versión del playbook junto con la respuesta que recibió. Un playbook que falla la validación se rechaza por completo y nunca surte efecto, así que una edición mala termina como "ese playbook no está activo" en lugar de una acción equivocada.
