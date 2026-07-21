---
title: Mantener la factura del triage de IA lo más baja posible
description: "En cuanto el triage de IA funciona, la siguiente pregunta es la factura. Batching y caché, escalonamiento de modelos, modelos alojados más baratos y autoalojamiento en GPU alquiladas o locales, con coste y latencia medidos para reducir al mínimo la factura del modelo."
---

# Mantener la factura del triage de IA lo más baja posible

En cuanto el triage de IA funciona, la siguiente pregunta es la factura. Cada alerta que llega a un modelo cuesta dinero, y con un volumen de alertas real ese número sube rápido. La mayor parte de esa factura es opcional.

SocTalk mantiene la mayoría de las alertas lejos de un modelo desde el principio, mediante deduplicación, coalescencia, correlación y cierre determinista (ver [Cómo funciona](/es-419/how-it-works)), de modo que el gasto que queda se concentra en las alertas que de verdad necesitan criterio. Esta guía trata de bajar ese gasto restante todo lo posible, sin ceder más calidad de la que hayas medido y sin sacar contenido sensible de las alertas de tu perímetro.

Las opciones de abajo van de más barata y segura a menos. La mayoría de los despliegues nunca llegan a la última.

## Batching y caché antes que nada

Dos funciones gestionadas en las API de frontera reducen el coste sin cambiar la calidad del modelo.

**La Batch API** procesa las solicitudes de forma asíncrona a cambio de un descuento fijo, y la salida es idéntica. SocTalk encaja aquí sin esfuerzo. La ventana de settle ya retiene una ejecución para que las alertas correlacionadas se acumulen, y una ejecución es asíncrona de por sí, así que el triage no es una ruta sensible a la latencia.

**El caché de prompts (prompt caching)** factura la parte repetida de un prompt a una fracción de la tarifa de entrada. Los prompts de supervisor y de verdict de SocTalk llevan un prefijo estable grande, el prompt de sistema y las definiciones de herramientas, con el contenido volátil de cada caso al final, así que la fracción cacheable es real y ya se usa en la ruta de Anthropic.

Activa ambas y mide el nuevo coste por ejecución antes de considerar cualquier cosa de abajo. Ninguna toca la calidad, así que no hay motivo para saltárselas.

## Pon un modelo más barato en el trabajo más barato

Una ejecución de triage usa un modelo en dos roles: un supervisor que enruta la investigación, decidiendo qué enriquecer a continuación y cuándo decidir, y un verdict que sopesa la evidencia. El enrutamiento es la tarea más liviana. SocTalk resuelve cada rol a su propio tier, y cada tier apunta a su propio provider, modelo y endpoint, así que el enrutador puede correr en un modelo más pequeño mientras el verdict conserva el capaz. Esto es configuración, no infraestructura nueva.

## Modelos alojados más baratos, con una salvedad

Varios provider sirven modelos abiertos casi de frontera que pueden abaratar a las API de frontera, según el provider, el modelo y la carga. Encajan en los casos rutinarios y de menor riesgo donde un modelo abierto casi de frontera basta. Para el trabajo de seguridad la restricción es la gobernanza de datos, no el precio: enviar alertas de clientes a una API de terceros, sobre todo en otra jurisdicción, saca esos datos de tu control. Si eso es un no rotundo para tus tenants, la siguiente sección mantiene los datos dentro de tu perímetro.

## Autoalojar el modelo

El autoalojamiento es el mayor ahorro y la única opción que mantiene el contenido de las alertas dentro de tu perímetro. SocTalk consume un modelo autoalojado igual que consume una API de frontera, apuntando un tier a un endpoint compatible con OpenAI. Clasifica el backend por su modelo de entrega, una API gestionada en caliente, una GPU serverless que baja a cero, una GPU alquilada siempre encendida o una instancia local, para que el coste y la planificación se comporten bien en cada caso.

Dónde lo corres es una compensación real.

- **Una plataforma de GPU serverless gestionada** (por ejemplo Modal) despliega el modelo detrás de un endpoint compatible con OpenAI, baja a cero en inactividad y factura por GPU-segundo. Pagas solo mientras corre y no hay servidor que operar, a una tarifa por hora mayor que un alquiler puro.
- **Un mercado de alquiler de GPU** (por ejemplo RunPod) alquila GPU de consumo cercanas a lo que compraría un despliegue autoalojado pequeño, a una tarifa por hora menor. A cambio, tú operas el ciclo de vida. Un pod factura hasta que lo detienes, los arranques en frío tardan minutos y la disponibilidad en los niveles más baratos varía.
- **Una instancia local** (por ejemplo [Ollama](/es-419/integrate/ollama)) corre en hardware que ya tienes, sin cargo medido por solicitud y sin que nada salga de la máquina, acotada por el rendimiento de esa única máquina.

## Lo que ahorra es la utilización, no la tarjeta

Un servidor autoalojado solo es barato cuando su batch continuo está lleno. Una sola solicitud a la vez deja la GPU infrautilizada y hace que el autoalojamiento cueste más de lo que debería. SocTalk corre varias investigaciones de forma concurrente por worker, así que hay varias solicitudes en vuelo contra el backend a la vez y el batch se llena.

En nuestras pruebas, llenar el batch a ocho solicitudes concurrentes elevó el rendimiento agregado unas seis a ocho veces respecto a una a una y recortó el coste por solicitud a cerca del 13 al 17 por ciento del caso serial, en las ejecuciones probadas con L40S, A10G, L4, RTX 3090 y RTX 4090. La utilización hizo la mayor parte del trabajo. La concurrencia, no la tarjeta, llevó al autoalojamiento de ineficiente a más barato que la línea base serial en estas ejecuciones.

## Lo que cuesta, medido

Estos números vienen de nuestras propias pruebas de un modelo abierto de 7B sobre un conjunto fijo de casos de triage con ocho vías de concurrencia. Son orientativos, no una garantía. Tu modelo, hardware y mezcla de alertas los moverán.

Por triage completo, autoalojar en una GPU de consumo alquilada salió entre dos y tres órdenes de magnitud más barato que una llamada a una API de frontera sin optimizar, y varias veces más barato que el mismo modelo en una plataforma serverless gestionada, porque la tarjeta alquilada probada era más barata por hora y, en estas ejecuciones, más rápida. La tarifa mayor de la plataforma gestionada compra el bajar a cero y no operar nada. El precio mayor de la API de frontera compra un tier de modelo gestionado que puede convenir a los casos difíciles, sin infraestructura que operar.

La latencia se mantuvo práctica. El conjunto de 12 casos terminó en cerca de un minuto en una Modal A10G y en 11 a 14 segundos en una RunPod 4090, ambas a ocho vías de concurrencia, en vez de los varios minutos que sugiere una estimación de flujo único, porque la concurrencia solapa las llamadas y los verdicts reales caben en el presupuesto de tokens.

## Si un modelo pequeño es suficiente

El coste solo importa si el modelo barato aguanta. En nuestras ejecuciones, un modelo abierto de 7B mantuvo el contrato de triage estructurado de SocTalk: salida válida de router y de verdict, sin errores de esquema, y verdicts que coincidieron con un modelo de razonamiento mayor en cerca del 58 al 75 por ciento de una muestra pequeña de referencia. Fue más débil en el enrutamiento, y en los casos sensibles a autorización a veces cerró actividad que no tenía autorización registrada y debía escalarse.

Así que un modelo pequeño autoalojado es un tier barato viable para el grueso rutinario, con un modelo capaz detrás para los casos difíciles. Si es lo bastante bueno para tu entorno es una medición, no una suposición, y corresponde hacerla contra un benchmark representativo antes de confiar a un modelo pequeño cualquier decisión de cierre. El safety floor sigue en pie de todos modos. Ningún modelo puede cerrar sobre una señal maliciosa conocida ni sobre un caso relacionado activo, sea cual sea la forma en que se sirvió.

## Limitaciones a tener en cuenta

- **Arranques en frío.** Un backend que baja a cero o recién alquilado no está listo al instante. La descarga y la carga del modelo tardan minutos, así que una ráfaga que llega en frío espera. Bien para triage rutinario, un problema para cualquier cosa urgente, por lo que un tier de respaldo en caliente gana su lugar.
- **Carga operativa en alquileres.** Una GPU alquilada factura hasta que la detienes y no baja a cero, así que el tiempo ocioso es dinero perdido y desmontar te toca recordarlo a ti. La disponibilidad en los niveles más baratos varía.
- **Contabilidad de costes.** Un presupuesto por token es la unidad correcta para una API de frontera y la equivocada para un backend por GPU-segundo. Contabiliza por la unidad de facturación del propio backend cuando autoalojas.
- **La gobernanza de datos es un espectro.** La redacción quita los secretos antes de que algo salga, pero el contexto operativo, hosts, cuentas, contenido de logs, igual viaja a una API externa. Solo el autoalojamiento dentro del perímetro mantiene ese contexto dentro de tu perímetro.

## Elegir dónde correrlo

Tres preguntas lo resuelven. **Utilización.** Una carga estable y de alta utilización favorece una tarjeta alquilada; una carga esporádica y a ráfagas favorece una plataforma que baja a cero o una API gestionada cuyo coste en inactividad es cero. **Apetito operativo.** Un alquiler es lo más barato pero lo operas tú; una plataforma serverless cuesta más y se opera sola; una API cuesta lo máximo sin nada que operar. **Sensibilidad de los datos.** Si el contenido de las alertas no puede salir de tu perímetro, el autoalojamiento es la única respuesta, y el trabajo de arriba es cómo lo haces asequible.

Para la mayoría de los equipos el orden es el mismo de esta guía. Batching y caché primero, el enrutador en un modelo más barato después, y un tier autoalojado solo cuando el volumen y la necesidad de residencia de datos justifican operarlo.

**Aviso.** SocTalk no está afiliada, respaldada ni patrocinada por ningún proveedor de servicios de LLM o de GPU. Modal, RunPod, Anthropic, OpenAI, Ollama y cualquier otro servicio nombrado en esta guía se mencionan solo como ejemplos de dónde puede correr un modelo. Las cifras de coste y rendimiento son nuestras propias observaciones de benchmark, no números publicados por los proveedores, y todos los nombres de producto y marcas pertenecen a sus respectivos dueños.
