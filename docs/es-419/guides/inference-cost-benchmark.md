---
title: Lo que cuesta de verdad la inferencia de triage, medido
description: "Las ejecuciones medidas detrás de la guía de costes: batching continuo en GPU serverless, silicio RTX de consumo real en un mercado de alquiler, y tiempo de triage realista de alertas golden con un modelo pequeño autoalojable. Rendimiento, dólares por millar y segundos de triage, con el método y los límites declarados."
---

# Lo que cuesta de verdad la inferencia de triage, medido

La [guía de costes](/es-419/guides/inference-cost-optimization) hace afirmaciones sobre lo que cuesta la inferencia de triage. Esta página es la medición que las respalda: nuestras propias ejecuciones de benchmark, las tablas completas, y el método y los límites para que juzgues hasta dónde llegan en tu propia configuración. Cada resultado aquí es una única ejecución medida, no un resultado estadístico ni una cifra de proveedor. Los barridos de rendimiento usan solicitudes sintéticas con forma de triage, los precios son instantáneas leídas en el momento de la ejecución, y las cifras de tiempo de triage y de exactitud usan un conjunto golden fijo de 12 alertas. Tu modelo, hardware y mezcla de alertas lo moverán todo.

Se midieron tres cosas, desde el rendimiento sintético hasta el triage realista: cuánto ahorra un batch continuo lleno en una GPU serverless, cómo se compara el silicio de consumo real con las piezas de datacenter que lo sustituyen, y cuánto tarda de verdad un triage real en un modelo pequeño autoalojable. Cada ejecución desmontó su GPU al terminar, así que nada quedó facturando.

## El batching continuo llena la GPU

Se desplegó un modelo abierto por GPU y se lanzó un número creciente de solicitudes idénticas con forma de triage al endpoint OpenAI-compatible de SGLang. Esto mide el lado del backend de lo que desbloquea la concurrencia de worker: a medida que sube la concurrencia de cliente N, el batch continuo se llena, el rendimiento agregado sube y el coste por solicitud baja.

La plataforma serverless no tiene tarjetas RTX de consumo, así que GPU de datacenter de gama baja hacen de proxies: A10G (Ampere 24GB) por la RTX 3090, L4 (Ada 24GB) por una tarjeta de clase RTX 4090. Qwen3-14B necesita unos 28GB en bf16 y no cabe en una tarjeta de 24GB con margen de batch, así que las tarjetas de 24GB corren DeepSeek-R1-Distill-Qwen-7B, que deja espacio de KV-cache para un batch mayor.

| GPU (proxy) | modelo | N=1 tok/s | N=8 tok/s | N=8 aceleración | $/1k req, N=1 a N=8 |
|---|---|---|---|---|---|
| L40S (media, 48GB) | Qwen3-14B | 24.8 | 146.7 | 5.9x | 4.37 a 0.74 (baja 83%) |
| A10G (aprox. RTX 3090) | DS-R1-7B | 29.2 | 216.7 | 7.4x | 2.09 a 0.28 (baja 87%) |
| L4 (aprox. RTX 4090) | DS-R1-7B | 17.3 | 131.2 | 7.6x | 2.57 a 0.34 (baja 87%) |

El caso serial (N=1) deja la GPU infrautilizada en todas las tarjetas. Llenar el batch en N=8 midió un rendimiento agregado de 5.9x a 7.6x y un coste por solicitud del 13 al 17 por ciento del caso serial. Las tarjetas de 24GB mostraron una aceleración mayor (7.4 a 7.6x) que la tarjeta media corriendo el 14B (5.9x), porque el modelo más pequeño deja más espacio de KV-cache para un batch mayor. Que la L4 tenga menos tok/s absolutos que la A10G es esperable, ya que la L4 es una pieza de inferencia de bajo TDP, así que se lee como un piso conservador para una RTX 4090 real. Los factores de escalado fueron similares entre tarjetas, y ese es el punto: la utilización, no la tarjeta, impulsa el ahorro.

## Silicio de consumo real, en un mercado de alquiler

Un mercado de alquiler de GPU alquila las tarjetas de consumo literales, así que esto comprueba el hardware real que los proxies serverless solo podían sustituir. Mismo modelo de 7B, mismo barrido, una sola GPU, pod terminado después.

Precios de alquiler del momento, community tier, leídos de la API del mercado: RTX 3090 $0.22/hr, RTX 4090 $0.34/hr, RTX 5090 $0.69/hr, frente a la A10G $1.10/hr y la L4 $0.80/hr de la plataforma serverless.

Medido en una RTX 3090 real:

| N | tok/s (agregado) | aceleración | $/1k req |
|---|---|---|---|
| 1 | 45.8 | 1.00x | 0.267 |
| 4 | 179.0 | 3.91x | 0.068 |
| 8 | 352.2 | 7.69x | 0.035 |

La aceleración por batching se mantuvo en silicio real (7.69x en N=8, frente a 7.42x en el proxy A10G y 7.58x en el proxy L4). La RTX 3090 real corrió más rápido que el proxy A10G (45.8 frente a 29.2 tok/s en N=1, 352 frente a 217 en N=8), porque la A10G es una pieza recortada. El coste medido fue menor en la tarjeta alquilada: $0.035 por 1k solicitudes en N=8 frente a los $0.282 de la A10G, unas 8x menos en esta ejecución, por una tarjeta más barata ($0.22 frente a $1.10/hr) y mayor rendimiento, sin compra inicial de GPU. La ruta del pod tiene un arranque en frío lento (descarga de imagen más descarga del modelo), así que corrió desacoplada: crear, sondear hasta que esté lista, barrer, terminar.

## Tiempo de triage realista, y si un modelo pequeño aguanta

Los barridos de arriba midieron el rendimiento sintético de tokens. Esto mide el triage realista: la evaluación de triage de SocTalk ejecutada sobre 12 alertas golden a concurrencia 8, cronometrando los nodos reales de router y de verdict sobre payloads reales.

DeepSeek-R1-Distill-Qwen-7B, 12 alertas golden, N=8:

| Provider / GPU | serving | tiempo total | verdict | routing | schema errors |
|---|---|---|---|---|---|
| Serverless A10G | SGLang | 43.2 s | 5/6 | 2/3 | 0 |
| RTX 4090 alquilada (secure) | vLLM | 11.3 s | 6/6 | 2/3 | 0 |

Stock frente a destilado, ambos en la RTX 4090 alquilada (secure), N=8:

| Modelo | tiempo total | verdict | routing | schema errors |
|---|---|---|---|---|
| DeepSeek-R1-Distill-Qwen-7B | 11.3 s | 6/6 | 2/3 | 0 |
| Qwen2.5-7B-Instruct (stock) | 16.7 s | 6/6 | 1/3 | 0 |

El triage golden realista en N=8 terminó el conjunto de 12 alertas en 11 a 43 segundos en estas ejecuciones, bajo un minuto. El 7B produjo cero schema errors y puntuaciones de verdict de 5/6 a 6/6, así que un modelo pequeño autoalojable produjo aquí salida de triage estructurada válida. Qwen2.5-7B-Instruct stock también funcionó (salida estructurada válida, cero schema errors, la misma puntuación de verdict que el destilado) y quedó por detrás del destilado por un caso en routing, una muestra de routing demasiado pequeña para leerla con fuerza.

Coste por triage realista, medido por nodo (una ejecución agéntica completa son unas pocas llamadas, así que multiplica por 2 a 3 aproximadamente): la A10G serverless a $1.10/hr es cerca de $1.10 por 1,000 alertas; la RTX 4090 secure alquilada a $0.69/hr es cerca de $0.18 por 1,000, y community a $0.34/hr cerca de $0.09 por 1,000.

## Las capacidades detrás de estos números

Los ahorros de arriba no son incidentales. Vienen de una pequeña pila de capacidades de inferencia, cada una rastreada en abierto, que juntas permiten que una ejecución de triage apunte a un backend de frontera o autoalojado y pague la tarifa más baja defendible por él. Algunas ya están en su sitio hoy y otras aún se están construyendo; los enlaces de issue muestran dónde está cada una.

- **Un sustrato de solicitud uniforme** ([#32](https://github.com/soctalk/soctalk/issues/32)). Cada ejecución de triage se expresa como un `InferenceRequest`, resuelto a un tier, con presupuesto por token, tanto si aterriza en una API de frontera como en una GPU autoalojada. Nada aguas abajo tiene que saber en qué backend cayó.
- **Una abstracción de entrega** ([#63](https://github.com/soctalk/soctalk/issues/63)). Cada backend se clasifica por cómo se entrega y se factura, una API de frontera en caliente, una GPU serverless scale-to-zero, una GPU alquilada siempre encendida, o una instancia local, para que el sustrato seleccione el driver correcto y distinga un backend por GPU-segundo de uno por token, en vez de tratar cada backend como una API en caliente medida por token. La preparación serverless y la planificación que esta clasificación habilita son el siguiente tier de trabajo ([#64](https://github.com/soctalk/soctalk/issues/64)).
- **Concurrencia de worker que llena el batch** ([#61](https://github.com/soctalk/soctalk/issues/61)). Varias investigaciones corren a la vez, así que hay varias solicitudes en vuelo contra el backend y el batch continuo se llena. Ese batch lleno es de donde vienen las ganancias de rendimiento y las caídas de coste de esta página.
- **Alineación serverless** ([#64](https://github.com/soctalk/soctalk/issues/64), en curso). La tolerancia a arranques en frío, la planificación de liberación por ráfagas y un driver de trabajos asíncronos están diseñados para que una GPU scale-to-zero pueda consumirse sin perder ejecuciones por un worker en frío, para que la economía scale-to-zero se vuelva usable en producción, no solo en un benchmark. El benchmarking chocó exactamente con esta brecha, workers de RunPod en frío devolviendo un 404 de proxy durante el arranque.
- **Serving autoalojado de primera clase** ([#13](https://github.com/soctalk/soctalk/issues/13), en curso). Correr el modelo dentro de tu propio clúster es el despliegue que mantiene el contenido de las alertas en tu perímetro, y es el destino dentro del clúster previsto para la abstracción de entrega de arriba.
- **Una suite de benchmarking y calificación** ([#33](https://github.com/soctalk/soctalk/issues/33)). La evidencia de esta página la produce una suite de dos ejes que separa la calidad del modelo de la viabilidad del serving, así que un modelo abierto pequeño se comprueba contra el contrato de triage estructurado antes de confiarle cualquier decisión.

Debajo está la columna de contabilidad de costes: la selección de provider por tier ([#4](https://github.com/soctalk/soctalk/issues/4)) corre el router más liviano en un modelo más barato que el verdict; una superposición de precios ([#5](https://github.com/soctalk/soctalk/issues/5)) evita que un modelo autoalojado o desconocido se facture a tarifas de frontera; y la salida estructurada obligatoria ([#3](https://github.com/soctalk/soctalk/issues/3)) es el contrato que un modelo pequeño debe mantener para ser usable siquiera, que es exactamente lo que mide la columna de schema errors de arriba.

## Cómo leer estos números

- **Orientativo, no estadístico.** El conjunto golden son 12 casos (3 de routing, 6 de verdict, 3 de política determinista), así que las cifras de exactitud apuntan una dirección, no califican un modelo. Un benchmark representativo es la verdadera puerta de calidad antes de confiar a un modelo pequeño cualquier decisión ajustada.
- **Por nodo, no por ejecución completa.** La evaluación cronometra cada nodo como una llamada, no una investigación completa multi-turno, así que los segundos de triage son por nodo. Multiplica por 2 a 3 aproximadamente para una ejecución completa.
- **Los precios son una instantánea.** Las tarifas de alquiler de GPU y serverless se mueven, y se leyeron en el momento de la ejecución. Trátalas como una proporción entre opciones, no como una cotización actual.
- **Las operaciones varían según el tier.** Los pods RTX 3090 tanto en community como en secure cloud fallaron repetidamente en servir dentro de una ventana de 22 minutos, mientras que una RTX 4090 en secure cloud arrancó de forma fiable, así que la tarjeta de tier más alto en secure cloud fue la ruta más estable en estas ejecuciones. Los pods alquilados no tienen scale-to-zero, así que el desmontaje es manual, y cada pod se terminó después de cada ejecución.

## En resumen: las mejores configuraciones coste-valor

Si quieres la respuesta corta, esto es lo que apuntan estas ejecuciones, por situación. Cada cifra viene de las mediciones de arriba, así que léela con las mismas salvedades: ejecuciones medidas únicas, precios como instantáneas, exactitud orientativa.

| Situación | La configuración que midió mejor aquí | Coste visto | La compensación que aceptas |
|---|---|---|---|
| Volumen estable, y puedes operar una GPU | Una tarjeta de consumo alquilada (una RTX 4090 en secure cloud arrancó de forma fiable donde las 3090 no), un modelo abierto de 7B en vLLM o SGLang, concurrencia de worker en 8 para llenar el batch | cerca de $0.09 a $0.18 por 1,000 alertas, el conjunto de 12 alertas en cerca de 11 segundos | Tú corres el ciclo de vida: arranques en frío, sin scale-to-zero, desmontaje manual |
| Volumen a ráfagas o de pocas operaciones | Una GPU serverless scale-to-zero gestionada, el mismo 7B en SGLang, concurrencia en 8 | cerca de $1.10 por 1,000 alertas | Una tarifa por hora mayor, pero coste en inactividad cero y nada que operar; mantén un respaldo en caliente para ráfagas urgentes que lleguen durante un arranque en frío |
| Los casos más difíciles, con operaciones mínimas | Un modelo de frontera capaz para el verdict con la Batch API y prompt caching activados, y el tier autoalojado barato para el grueso rutinario | La tarifa de frontera, pero solo en una fracción de las alertas | Lo más caro por llamada, a cambio de ninguna infraestructura y un tier de modelo gestionado más capaz para los casos más difíciles |
| El contenido de las alertas no puede salir de tu perímetro | Autoaloja el 7B dentro del clúster cuando llegue el serving dentro del clúster, con un respaldo capaz y el safety floor en su sitio | No medido aquí; las cifras de autoalojamiento alquilado y serverless de arriba son proxies orientativos hasta que aterrice el serving dentro del clúster | Tú eres dueño del serving; el despliegue dentro del clúster aún se está construyendo ([#13](https://github.com/soctalk/soctalk/issues/13)) |

La única elección de configuración que más trabajo hizo en cada fila de autoalojamiento fue la **concurrencia de worker en 8**, que llena el batch continuo y es de donde vinieron el coste del 13 al 17 por ciento y el rendimiento de seis a ocho veces. Combínala con un modelo pequeño que mantenga el contrato estructurado en cero schema errors, y una tarjeta más barata por hora, y desmonta la GPU después de cada ejecución. Todo lo demás en esta página es una variación de eso.

Para la mayoría de los equipos la secuencia es la que expone la [guía de costes](/es-419/guides/inference-cost-optimization): batching y caché primero, el router en un modelo más barato después, y un tier autoalojado solo cuando el volumen y la necesidad de residencia de datos justifican operarlo.

**Aviso.** SocTalk no está afiliada, respaldada ni patrocinada por ningún proveedor de servicios de LLM o de GPU, y las plataformas detrás de estas ejecuciones se nombran en la [guía de costes](/es-419/guides/inference-cost-optimization) solo como ejemplos de dónde puede correr un modelo. Las cifras aquí son nuestras propias observaciones de benchmark sobre un conjunto golden fijo, no números publicados por los proveedores, y todos los nombres de producto y marcas pertenecen a sus respectivos dueños.
