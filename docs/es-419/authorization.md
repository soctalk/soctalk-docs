# Autorización

## ¿Esta actividad estaba autorizada?

La mayor parte de lo que un SOC escala no es malicioso. Se trata de una persona o un sistema real haciendo trabajo real que resulta parecerse a un ataque: un administrador que usa una cuenta de emergencia (break-glass) a las 3 de la mañana, un pipeline de despliegue que toca un archivo de configuración, un escáner que barre una subred durante un pentest autorizado. Que una alerta sea benigna a menudo no depende de la alerta en sí, sino del estado de la organización que la rodea. Dos alertas idénticas byte a byte pueden tener disposiciones opuestas dependiendo únicamente de si un ticket de cambio, una ventana de mantenimiento o una línea base aprobada cubren la actividad.

La autorización es la capa que le da a SocTalk ese contexto del estado de la organización. Vincula registros tipados (tickets de cambio, líneas base permanentes, congelamientos de cambios, prohibiciones y hechos de entidad sobre activos y cuentas) con la actividad de una alerta, y razona sobre si un único registro la cubre por completo. Solo puede reducir la sospecha al encontrar evidencia que la cubra. Nunca la aumenta y nunca anula una señal maliciosa.

No es un paso separado atornillado al triaje. Es contexto que el bucle agéntico reúne mientras investiga, y se resuelve en uno de tres estados que dan forma al veredicto. Todo lo que está aguas abajo aún pasa por el piso de seguridad, que la autorización nunca puede debilitar.

![Dónde encaja la autorización en el flujo de trabajo de triaje](/diagrams/authorization-in-triage.svg)

## Cubierta, contradicha, ausente

La autorización de cada alerta se resuelve en uno de tres estados, y la diferencia entre los dos últimos lo es todo:

- **Cubierta.** Un único registro cubre por completo la actividad: el sujeto, el objetivo, la acción, la ventana de tiempo, la validez del calendario y las aprobaciones correctos. La sospecha se reduce.
- **Contradicha.** Hay registros archivados pero ninguno de ellos cubre, o una prohibición de alta prioridad prohíbe la acción. Existe un ticket de cambio pero expiró, o es para un host diferente, o el congelamiento de cambios que necesitaba nunca tuvo una excepción. Esto es un hallazgo, no una ausencia, y se escala a un humano.
- **Ausente.** No hay ningún registro del tipo correcto archivado en absoluto. La ausencia nunca se trata como autorización. SocTalk pide más información en lugar de asumir que la actividad fue aprobada.

Mantener separadas la ausencia y la contradicción importa. Un ticket obsoleto o incorrecto nunca debe leerse como "casi autorizado". Es lo contrario: el papeleo que debería haber cubierto esto no lo hace, y eso merece la atención de un humano.

## De dónde vienen los hechos de autorización

Los hechos llegan al almacén de tres maneras, con confianza creciente:

- **Los tenants afirman hechos sobre su propio entorno.** Un cliente declara una ventana de mantenimiento o una línea base permanente desde el área de Autorización. Los hechos afirmados por el tenant quedan pendientes y no influyen en el triaje hasta que un analista de MSSP los aprueba.
- **Los sistemas envían hechos a través de la API de ingesta.** Los scripts de aprovisionamiento, los hooks de CI y los conectores envían hechos tipados con una credencial por tenant. La confianza se estampa a partir de la credencial, nunca del payload, porque quien puede enviar un hecho puede suprimir una detección.
- **Los analistas responden una pregunta de autorización.** Cuando el triaje se estanca específicamente porque la autorización está ausente, el analista responde una vez y la respuesta se convierte en un registro reutilizable. Este es el flujo que se describe a continuación.

## Responder una pregunta de autorización

Cuando una investigación no puede decidirse porque la autorización está ausente, y no hay señal maliciosa, la revisión lleva una pregunta de autorización tipada en lugar de una solicitud genérica de más información. Al analista se le pregunta una sola cosa: ¿esta actividad estaba autorizada?

![La pregunta de autorización tipada en una revisión, con una acción de guardado](/screenshots/authz-ask-question.png)

El panel expone la actividad exacta en cuestión y ofrece una única acción, distinta de aprobar o rechazar. Si la actividad estaba autorizada, el analista define cuánto tiempo debe mantenerse la autorización y elige **Confirmar autorizada, guardar autorización reutilizable**. Esto escribe una concesión duradera afirmada por el analista, acotada exactamente a esa actividad (esta cuenta, esta acción, este host) con la expiración elegida.

![La autorización reutilizable guardada, y la revisión retirada de la cola](/screenshots/authz-ask-saved.png)

La concesión guardada es el punto. La próxima vez que la misma actividad produzca una alerta, ahora un registro la cubre, así que la pregunta no se vuelve a hacer. Pregunta una vez, recuerda. La autorización está acotada a la actividad exacta y lleva una expiración, de modo que no se amplía silenciosamente ni vive para siempre, y aparece en el área de Autorización donde puede ser revisada o revocada en cualquier momento.

Una regla es deliberada: un hecho se crea únicamente mediante esta respuesta explícita. SocTalk nunca aprende una autorización a partir de un cierre o un rechazo simple. Un analista que despeja la cola no es lo mismo que un analista que declara que una actividad está autorizada, y tratarlo así permitiría que la presión de la cola envenenara silenciosamente el almacén.

## Compromisos

Un hecho responde una pregunta permanente, ¿está permitido que esta cuenta haga esto en este host? Algunas autorizaciones no son permanentes en absoluto, están acotadas a una ventana de tiempo durante la cual se espera una actividad que de otro modo sería sospechosa. Un pentest autorizado, un ejercicio de red team o una ventana de mantenimiento son autorizaciones que se abren y luego se cierran. SocTalk modela esto como un compromiso (engagement), y un compromiso es simplemente un tipo de autorización: una ventana de autorización acotada y limitada en el tiempo durante la cual la actividad que describe se espera en lugar de alarmar.

Los compromisos viven en la misma área de Autorización del tenant que los hechos, en su propia pestaña de Compromisos. La antigua ruta `/engagements` sigue funcionando y enlaza directamente a esa pestaña, ya que los compromisos se integraron en el área unificada de Autorización en lugar de mantenerse como una superficie separada.

Sin embargo, un compromiso funciona de manera diferente a un hecho. No está sujeto a revisión: un usuario autorizado por el tenant lo declara, y puede revocarlo, directamente, sin ningún paso de revisión del MSSP. Lo que hace un compromiso es desconflictuar la actividad por fuente, objetivo y ventana de tiempo validados. La actividad de alerta que cae dentro de un compromiso declarado, una fuente dentro del alcance actuando sobre un objetivo dentro del alcance durante la ventana, se atribuye al tester: SocTalk registra la observación, retira la alerta de la cola abierta y omite el triaje por LLM para ella. Nunca se cierra automáticamente ni se marca como falso positivo, la fila de la observación permanece consultable y contabilizada. La actividad del tester que cae fuera del alcance declarado se marca para una revisión más cercana en lugar de dejarse pasar. Cuando la ventana se cierra, la desconflicción deja de aplicarse y la actividad vuelve a triarse normalmente.

## Los guardrails

La autorización es una superficie de supresión, así que sus límites se aplican en el código, no se dejan a la redacción de un prompt:

- **La ausencia nunca cierra automáticamente.** La falta de un registro que la cubra significa que un humano decide, nunca un cierre automático.
- **La autorización nunca anula una señal maliciosa.** Un hecho "autorizado" guardado no puede cerrar una alerta que también lleva un acierto de IOC, un enriquecimiento malicioso o una correlación con un incidente activo. La correlación se ejecuta antes que la supresión, y el piso de seguridad veta esos casos de forma independiente de cualquier hecho. Una autorización reutilizable reduce la sospecha rutinaria; no ciega al sistema ante un ataque real que reutiliza la misma actividad.
- **La memoria es tipada y gobernada.** Los hechos llevan una fuente, un nivel de confianza, un alcance y una expiración. Nunca son memoria de prompt de forma libre, y los hechos amplios o privilegiados están destinados a pasar por revisión.
- **La confianza es escalonada.** Los registros verificados por conectores superan a los afirmados por sistemas, que superan a los afirmados por analistas, que superan a la telemetría rutinaria, que supera a los afirmados por el tenant. Un registro de mayor confianza corrobora o anula uno de menor confianza.

## Dónde aparece

El contexto de autorización se renderiza en el razonamiento de la AI en cada investigación que lo lleva, de modo que el modelo pondera la evidencia que la cubre por sí mismo en lugar de recibir un sí o un no. Los hechos guardados, su estado de revisión y su expiración se listan en el área de **Autorización** de la UI, donde un analista puede revocar cualquier hecho. Consulta [Usuarios y roles](/es-419/users-and-roles) para saber quién puede afirmar, revisar y responder, y [Revisión humana](/es-419/human-review) para la cola de revisión sobre la que viaja la pregunta de autorización.
