# Cómo funciona

## El problema

Un SOC se ahoga en alertas. Un solo escaneo puede producir miles de ellas, la mayor parte de lo que se escala termina siendo benigno, y los analistas se agotan despejando una cola que es principalmente ruido. Lo difícil no es detectar cosas. Es decidir, rápido y con seguridad, cuáles de las cosas que se dispararon realmente importan.

## Tres generaciones de triaje de SOC

Las herramientas de triaje han pasado por tres generaciones, y cada una resolvió el problema de la anterior mientras dejaba un punto ciego propio.

La primera generación son las **reglas**: reglas de firma y correlación en un SIEM, y automatización determinista en un SOAR. Es rápida, auditable y predecible, razón por la cual sigue funcionando por debajo de todo. También es tosca. Una regla se dispara ante cualquier cosa que coincida con ella, así que es ruidosa, y un humano todavía tiene que leer casi todo. Es una alarma de humo: confiable, pero no puede distinguir un incendio real de una tostada quemada.

La segunda generación agregó **machine learning**: clasificadores supervisados, detección de anomalías y análisis de comportamiento de usuarios que aprenden cómo se ve lo normal y puntúan lo que no lo es. Esto ordena la cola y hace aflorar las rarezas, pero necesita datos etiquetados, se degrada a medida que el entorno cambia, y te entrega una puntuación en lugar de una razón. Es un filtro de spam: ordena la pila, pero te da un número, no una explicación.

La tercera generación son los **modelos de lenguaje**, que pueden razonar sobre una alerta en contexto y explicarse en lenguaje sencillo. La primera ola de herramientas de SOC con AI los usó de la forma obvia, apuntando un modelo a cada alerta, entra el prompt y sale el veredicto. El problema es que un modelo que lee una alerta de forma aislada no tiene memoria de lo que un analista ya decidió, no tiene una imagen del estado propio de la organización (así que no puede distinguir un cambio autorizado de un ataque que se ve idéntico), no garantiza que no cerrará con confianza sobre un indicador real, y no tiene noción de las otras alertas a su alrededor. Ejecutar un modelo de frontera sobre cada alerta cruda también es caro, y el costo empuja a los equipos hacia modelos más débiles precisamente en los casos donde más importa el criterio. Es un analista agudo en su primer día: razona bien sobre cualquier alerta individual, pero no recuerda nada de ayer y no le han entregado el calendario de cambios ni la lista de activos.

![La evolución del triaje de SOC: reglas, machine learning, modelos de lenguaje, y la generación agéntica que representa SocTalk](/diagrams/soc-evolution.svg)

Cada generación es genuinamente buena en algo, y ninguna de ellas está equivocada. El problema es que la mayoría de los productos elige una y se apoya en ella.

## Qué hace SocTalk de manera diferente

SocTalk es la generación agéntica. Donde la primera ola apuntaba un modelo a una alerta, SocTalk ejecuta un bucle agéntico alrededor del modelo: el modelo dirige una investigación determinista, razona sobre el caso correlacionado completo, y devuelve un veredicto que impulsa una acción gobernada, con un humano controlando cualquier cosa peligrosa. Todo ello corre dentro de guardrails deterministas. Mantiene las garantías de la era de las reglas en código, y deliberadamente omite el medio opaco. El colapso de ruido que el machine learning se propuso lograr se hace de manera determinista en su lugar, mediante coalescencia, correlación y cierre basado en reglas, de modo que nada en la ruta de decisión es una caja negra entrenada. El modelo se gasta solo en los casos ambiguos. Luego se agregan encima dos cosas que ninguna de las generaciones anteriores tenía: el pipeline recuerda lo que deciden los analistas, y un humano controla cualquier cosa que alcance un sistema en vivo.

Dicho de otro modo, el modelo es un componente, no todo el sistema. El ruido se colapsa antes de que corra cualquier modelo. Al modelo se le da contexto organizacional real. Las decisiones críticas para la seguridad se sitúan detrás de un **piso de seguridad**, un pequeño conjunto de vetos duros escritos en código que ni una regla ni el modelo pueden desactivar, de la misma forma en que un disyuntor corta la corriente sin importar lo que pida el cableado. Las decisiones de los analistas se recuerdan. Y el veredicto impulsa una acción gobernada, la capa SOAR del sistema, con un humano aprobando cualquier cosa peligrosa. El resultado es que el modelo razona sobre el medio ambiguo, y las partes que deben estar garantizadas siguen garantizadas.

![El pipeline de triaje de SocTalk: un embudo de ingesta determinista, una ejecución agéntica donde el modelo se consulta en solo dos roles, y una acción gobernada](/diagrams/triage-pipeline.svg)

## Dos planos y una ventana de asentamiento

El pipeline corre a través de dos planos, o etapas, y saber cuál es cuál explica la mayor parte del diseño.

El **plano de ingesta** es del lado del servidor y completamente determinista. Cuando un adaptador (el recolector del lado del tenant que reenvía alertas de Wazuh y similares) publica un lote de eventos, estos se deduplican, coalescen, correlacionan, deconflictan, y en muchos casos se resuelven sin que ningún modelo llegue a ejecutarse. Ningún modelo toca este plano.

El **plano de grafo** es el bucle agéntico, uno por tenant, corriendo como su propio proceso. Es donde el modelo razona, y consulta al modelo en solo dos roles: enrutamiento y el veredicto final. Muchos casos necesitan incluso menos, cerrando con una política determinista sin ninguna llamada al modelo en absoluto. El bucle no mantiene base de datos propia: el caso se le entrega cuando comienza la ejecución y su resultado se devuelve cuando la ejecución termina, y su enriquecimiento ocurre a través de llamadas de herramientas hacia el SIEM y los servicios de threat-intel.

Entre los dos se sitúa una **ventana de asentamiento** opcional. Cuando un tenant configura una, una ejecución promovida se retiene durante un breve retraso para que primero pueda acumularse una ráfaga de alertas correlacionadas, y el modelo mira el incidente completo una sola vez en lugar de cada fragmento a medida que llega. Una alerta de alta severidad omite la espera.

Actuar sobre el veredicto ocurre de vuelta en el servidor, de manera determinista, después de que la ejecución se completa. Eso mantiene al modelo fuera del bucle que alcanza los sistemas externos.

## En la entrada: el embudo determinista

Muchas alertas se resuelven antes de que se consulte a un modelo, lo que ayuda a mantener el pipeline económico y rápido, y todo es código determinista.

**La coalescencia y la deduplicación colapsan la tormenta.** La deduplicación descarta un evento reproducido que lleva un ID ya visto. La coalescencia luego agrupa alertas repetidas de la misma regla sobre el mismo activo dentro de una ventana de cinco minutos en un único caso, de modo que una ráfaga de la misma detección se convierte en un caso en lugar de miles. El modelo, y el analista, ven un caso por incidente en lugar de la manguera de datos cruda. ([correlación y coalescencia en el núcleo de IR](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/triage.py))

**La correlación mantiene un incidente en un caso.** Con la correlación de entidades habilitada, una alerta nueva que comparte una entidad fuerte (un identificador confiable como un host o un hash de archivo) con una investigación activa se adjunta a ella como evidencia en lugar de iniciar una ejecución nueva y sin contexto. Una fuente que empieza a dominar la correlación, como una IP de escáner que toca todo, se degrada para que no pueda arrastrar alertas no relacionadas hacia un solo caso. La correlación corre por delante de las rutas de cierre, de modo que una alerta de apariencia benigna que pertenece a un incidente en vivo no se suprime silenciosamente.

**La deconflicción de compromisos mantiene las pruebas autorizadas fuera de la cola.** Cuando está habilitada, una ventana declarada de pentest o red-team se empareja por fuente, host, técnica y tiempo. La actividad dentro de ella se marca y audita pero nunca se cierra automáticamente, y la actividad de los evaluadores que se desvía fuera de alcance se fuerza a una mirada humana en lugar de cerrarse. Consulta [Usuarios y roles](/es-419/users-and-roles) para saber cómo se declaran y revisan los compromisos.

**El cierre determinista maneja los casos obvios.** Los falsos positivos de baja severidad y alta confianza cierran por regla, y una forma benigna recurrente puede cerrar por referencia a una decisión previa, ambos sin un modelo. Las bandas de cierre de falsos positivos y la ruta de cierre operacional deliberadamente excluyen cualquier cosa mapeada a una técnica de ATT&CK (un ID estándar de técnica de ataque), de modo que una alerta mapeada a una técnica no se cierra como ruido rutinario.

**El piso de seguridad de ingesta protege todo esto.** No se permite que ningún cierre determinista se dispare sobre un indicador conocido (un observable sospechoso como una IP o un hash de archivo malicioso), un incidente activo, o un interruptor de corte (kill switch, un ajuste del operador que detiene la acción automática), y un tope de volumen actúa como un disyuntor de modo que una regla desbocada se degrada a "los humanos miran" en lugar de a una supresión masiva.

Todo lo que sobrevive al embudo se promueve: se convierte en una investigación, programada para una ejecución de triaje.

## La ejecución de triaje: dos roles de modelo, y mucho determinismo

La ejecución es un bucle agéntico, pero la huella del modelo dentro de él es pequeña y deliberada.

El bucle abre con una compuerta determinista. Si la alerta coincide con una [política de triaje](/es-419/triage-policies) cuya disposición (el resultado a aplicar: cerrar, escalar o pedir más información) está garantizada y sin oposición, se resuelve allí, y el modelo nunca se consulta en absoluto.

Para todo lo demás, un **supervisor** decide qué hacer a continuación. Este es el primero de los dos roles de modelo, y todo su trabajo es enrutamiento: investigar, enriquecer, contextualizar, decidir o cerrar. No realiza trabajo de dominio por sí mismo, y puede tomar varios turnos de enrutamiento antes de decidir.

El trabajo al que enruta es determinista. Los **pasos de enriquecimiento** obtienen contexto de host y proceso del SIEM, verifican la reputación de observables a través de los analizadores de Cortex, y buscan contexto de threat-intel en MISP. Estas son llamadas de herramientas y heurísticas, no llamadas al modelo. Un malentendido común sobre el triaje con AI es que el modelo hace el enriquecimiento. Aquí no lo hace: el enriquecimiento es orquestación determinista de herramientas, y el modelo solo lee los resultados.

En el camino, la ejecución reúne su [contexto de autorización](/es-419/authorization): los hechos del estado de la organización (tickets de cambio, mantenimiento aprobado, contexto de cuenta y activo) que dicen si esta actividad fue autorizada. La autorización es lo que le permite al pipeline separar un cambio autorizado de un ataque que produce una alerta byte a byte idéntica, una distinción que ninguna cantidad de búsqueda de reputación puede hacer.

Cuando el supervisor tiene suficiente, entrega al **veredicto**, el segundo rol de modelo. Este es el único lugar donde un modelo de razonamiento pondera todo lo que la ejecución reunió y propone una disposición: cerrar, escalar o pedir más información.

Luego el determinismo toma el control de nuevo. El veredicto es una propuesta, no una confirmación. Un guardián de [política de triaje](/es-419/triage-policies) solo puede elevar la decisión del modelo, nunca bajarla: un cierre propuesto sobre una señal maliciosa o un registro de autorización contradicho se convierte en una escalación, y el vocabulario del guardián hace imposible expresar la supresión. Si un cierre propuesto toca un activo sensible, se retiene para la aprobación de un humano. El modelo propone; el código determinista dispone.

## Las garantías: un piso de seguridad en tres lugares

La regla de que la autorización, y el modelo, nunca pueden cerrar sobre una señal maliciosa conocida, un indicador no verificado, o un caso relacionado activo no se deja a la redacción del prompt. Se aplica en código, en tres puntos independientes de la ruta de cierre:

- **En la ingesta**, antes de cualquier cierre determinista, con clave en un indicador conocido, un incidente activo, un kill switch, y el tope de volumen.
- **Durante la ejecución**, cuando el modelo propone un cierre, con clave en un indicador conocido, un indicador no verificado, y un registro de autorización contradicho. Este es el único piso que consulta la autorización en absoluto.
- **En el servidor**, cuando el cierre se confirma, con clave en el kill switch, otro caso activo que comparte las mismas entidades, y el tope de volumen.

Cada ruta de cierre tiene su piso en su propio punto: un cierre determinista de ingesta pasa el primero, y un cierre propuesto por el modelo pasa el segundo y luego el tercero. La autorización puede bajar la sospecha en ese piso intermedio, pero nunca puede convencer a ninguno de ellos de descartar un indicador conocido o un caso relacionado activo. Consulta [Autorización](/es-419/authorization) para saber cómo la evidencia de cobertura baja la sospecha sin nunca anular una señal maliciosa.

## Actuar sobre el veredicto

Una vez que la ejecución se completa, el servidor confirma la disposición y actúa sobre ella, de manera determinista y en una sola transacción.

Una escalación aterriza en la cola de [revisión humana](/es-419/human-review) con la evidencia real adjunta. Cuando la ejecución se estancó específicamente porque faltaba la autorización, la revisión lleva una pregunta de autorización tipada, y la respuesta del analista se guarda como un hecho reutilizable, de modo que no se vuelve a preguntar por la misma actividad mientras esa autorización se mantenga. Esa memoria de preguntar-una-vez se describe en la página de [Autorización](/es-419/authorization).

Un veredicto también impulsa los [playbooks de respuesta](/es-419/response-playbooks). Esta es la capa SOAR del sistema, el mismo tipo de automatización determinista y gobernada que un analista de SOAR reconocería, salvo que está impulsada por un veredicto razonado en lugar de por una regla frágil, y es donde se muestra la postura de "acción gobernada". Las acciones seguras, escribir una nota o notificar a un webhook, corren por sí solas. Las acciones que alcanzan un sistema en vivo, aislar un endpoint o deshabilitar una cuenta, nunca corren por sí solas: se plantean como una propuesta y un analista las aprueba primero. Un cierre solo puede anotar, un kill switch de despacho detiene las acciones de respuesta activas de inmediato (las auditorías en sombra todavía pueden registrar lo que se habría disparado), y todo el despacho ocurre del lado del servidor, nunca desde el bucle del modelo.

Un último toque determinista maneja el momento. Si llegó nueva evidencia correlacionada mientras la ejecución estaba en vuelo y el caso sigue abierto, se inicia una ejecución de seguimiento sobre la imagen ahora completa, de modo que una alerta de llegada tardía no queda varada fuera del caso al que pertenece.

## Qué hace la diferencia

Reunidas, unas cuantas propiedades distinguen esto de apuntar un modelo a cada alerta:

- **Muchas alertas nunca llegan a un modelo.** La deduplicación, la coalescencia, la deconflicción y el cierre determinista resuelven muchas de ellas en la ingesta, de modo que el modelo se gasta en los casos ambiguos.
- **Una ejecución consulta al modelo en solo dos roles**, enrutamiento y el veredicto final, y muchos casos cierran de manera determinista sin ninguna llamada al modelo en absoluto. El enriquecimiento es orquestación determinista de herramientas, no clasificación de modelo por alerta.
- **Un incidente es un caso.** La coalescencia y la correlación le dan al modelo la imagen correlacionada completa, no una alerta solitaria despojada de su contexto.
- **El modelo propone, el código dispone.** Un guardián y un piso de seguridad de tres sitios hacen estructuralmente imposible que el modelo cierre sobre un indicador conocido, un registro de autorización contradicho, o un caso relacionado activo.
- **El pipeline razona sobre la autorización.** Puede distinguir un cambio autorizado de un ataque de apariencia idéntica, un juicio que la reputación y las firmas no pueden hacer por sí solas.
- **Recuerda.** La decisión de autorización de un analista se convierte en memoria reutilizable, de modo que la cola deja de hacer una pregunta ya respondida mientras esa autorización se mantenga.

## A dónde ir después

Cada etapa tiene su propia página y su código:

- [Autorización](/es-419/authorization), el razonamiento sobre el estado de la organización y la memoria de preguntar-una-vez.
- [Políticas de triaje](/es-419/triage-policies), los guardrails deterministas en la ejecución.
- [Playbooks de respuesta](/es-419/response-playbooks), convertir un veredicto en acción gobernada.
- [Revisión humana](/es-419/human-review), la cola de revisión y la ruta de decisión del analista.
- [Pipeline de AI](/es-419/ai-pipeline), el grafo agéntico con más detalle.
- [Arquitectura](/es-419/reference/architecture), el modelo de despliegue y de datos.

El código del pipeline vive en [`src/soctalk/core/ir/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/core/ir) (plano de ingesta), [`src/soctalk/graph/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/graph) y [`src/soctalk/supervisor/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/supervisor) (plano de grafo), y [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response) (respuesta).
