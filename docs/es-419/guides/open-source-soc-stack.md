---
description: "Construye un stack SOC de código abierto con Wazuh, TheHive, Cortex y MISP: qué hace cada herramienta, el costo real de integración y cuándo empaquetarlo."
---

# Construir un stack SOC de código abierto: Wazuh, TheHive, Cortex y MISP — ensamblado vs integrado

Existe un stack SOC libre y de código abierto canónico, y ha sido más o menos los mismos cuatro nombres durante años: Wazuh para detección, TheHive para gestión de casos, Cortex para análisis de observables, MISP para inteligencia de amenazas. Cada proyecto es genuinamente bueno en su trabajo, cada uno está probado en batalla, y juntos cubren la mayor parte de lo que vende una suite SOC comercial. El truco está en la palabra *juntos*. Las herramientas son excelentes; la integración entre ellas es un proyecto que tú construyes y luego mantienes.

Esta guía cubre qué hace cada pieza, cuánto cuesta realmente ensamblarlas, cómo cambian los requisitos cuando operas la seguridad de más de una organización, y dónde encaja SocTalk — que es *encima de* este stack, no en su lugar.

## El stack SOC FOSS clásico

**[Wazuh](https://wazuh.com/)** es la capa SIEM/XDR: un agente en cada endpoint, un manager que aplica reglas de detección al flujo de eventos, y un indexador (basado en OpenSearch) que almacena y busca los resultados. Incluye de fábrica monitoreo de integridad de archivos, detección de vulnerabilidades, análisis de logs y un amplio conjunto de reglas por defecto. Es donde nacen las alertas.

**[TheHive](https://thehive-project.org/)** es la capa de gestión de casos: una plataforma de respuesta a incidentes de seguridad donde las alertas se convierten en casos, los casos llevan tareas y observables, y los equipos de analistas colaboran con un rastro de auditoría. Si Wazuh es donde nacen las alertas, TheHive es donde las investigaciones viven y mueren.

**Cortex** es el compañero de TheHive para el análisis de observables. Le entregas una IP, un hash, un dominio o una URL, y sus plugins analizadores consultan en paralelo servicios de reputación y sandbox — VirusTotal, AbuseIPDB, Hybrid Analysis y decenas más — y traen de vuelta un veredicto. Convierte "aquí hay un hash" en "aquí está lo que el mundo sabe sobre este hash".

**[MISP](https://www.misp-project.org/)** es la plataforma de inteligencia de amenazas: agrega, correlaciona y comparte indicadores de compromiso entre feeds y comunidades de intercambio. Verificar un observable contra MISP te dice si pertenece a una campaña o a un actor conocido — contexto que ninguna de las otras tres herramientas aporta por sí sola.

Cuatro herramientas, cuatro trabajos distintos, todas de código abierto. En papel, un SOC completo.

## El impuesto de integración que nadie presupuesta

Cada una de estas herramientas se instala en una tarde. Ahí es donde terminan los tutoriales de laboratorio casero y donde comienza el trabajo real, porque ninguna habla con las demás de fábrica en la forma que un SOC de producción necesita.

El pegamento corre por tu cuenta. Las alertas de Wazuh no se convierten en casos de TheHive sin un forwarder que escribes o adoptas y luego mantienes a través de los cambios de API en ambos lados. Los analizadores de Cortex necesitan claves de API por proveedor, manejo de límites de tasa y una decisión sobre qué analizador se ejecuta para cada tipo de observable. MISP necesita feeds configurados, trabajos de sincronización programados e indicadores propensos a falsos positivos curados antes de que te atrevas a automatizar sobre ellos.

Luego, la superficie operativa: cuatro productos significan cuatro sistemas de autenticación y calendarios de rotación de claves de API, cuatro cadencias de actualización que pueden romper tu pegamento en cualquier release, cuatro historias de respaldo y — desde que TheHive migró a Cassandra/Elasticsearch por debajo — una huella de almacenamiento de datos nada trivial solo para la gestión de casos. Suma TLS entre cada par, monitoreo para cada servicio y la pregunta de a quién se le avisa cuando el forwarder de Wazuh a TheHive deja de reenviar silenciosamente.

Nada de esto es una crítica a las herramientas. Es la naturaleza de componer proyectos independientes: la capa de integración es un quinto producto, excepto que nadie lo entrega, lo documenta ni lo actualiza por ti.

## Organización única vs MSSP: la bifurcación de requisitos

Para una sola organización, el impuesto anterior es pagable. Construyes el stack una vez, el pegamento sirve a un solo tenant, y un ingeniero capaz puede mantenerlo sano como trabajo de medio tiempo.

Para un MSP o MSSP, los requisitos se bifurcan con fuerza:

- **El aislamiento es innegociable.** Las alertas, los casos y los indicadores del cliente A deben ser demostrablemente invisibles para el cliente B — por contrato, y a menudo por regulación. Las herramientas de tenant único compartidas convierten eso en un ejercicio de configuración por herramienta, con modos de falla por herramienta.
- **Los stacks por cliente multiplican el impuesto.** Diez clientes en stacks dedicados significan diez managers e indexadores de Wazuh que desplegar, actualizar y respaldar — y diez copias de tu pegamento.
- **El onboarding debe ser repetible.** El cliente número once debería ser un comando, no una semana de arqueología en la wiki. Los stacks construidos a mano derivan; la deriva se convierte en incidente.
- **Un solo panel de vidrio.** Los analistas que cubren veinte clientes no pueden rotar entre veinte dashboards.

Esta es la brecha entre "el stack SOC FOSS funciona" y "el stack SOC FOSS funciona como negocio".

## Dónde encaja SocTalk: un plano de control sobre el stack, no un reemplazo

[SocTalk](https://github.com/soctalk/soctalk) no reemplaza ninguna de las cuatro herramientas. Es un plano de control multi-tenant con licencia Apache 2.0 y una capa de triaje con AI construida *alrededor de* este stack, para MSPs y MSSPs que lo ejecutan en su propio Kubernetes:

- **Wazuh es el plano de datos.** Cada cliente recibe un manager y un indexador de Wazuh dedicados en un namespace aislado, aprovisionados por el plano de control — o traes un Wazuh existente mediante el perfil `provided`. Los agentes se enrolan a través de un ingress enrutado por hostname con secretos con alcance de tenant.
- **La capa de triaje con AI se sitúa entre Wazuh y tus analistas.** Un embudo de ingesta determinista deduplica, agrupa y correlaciona las alertas antes de que se ejecute cualquier modelo; un bucle agéntico de LangGraph investiga lo que sobrevive; las escalaciones siempre pasan por una compuerta de revisión humana. Detalles en [Cómo funciona](/es-419/how-it-works).
- **TheHive, Cortex y MISP son integraciones**, consultadas durante la ejecución: Cortex para la reputación de observables, MISP para el contexto de inteligencia de amenazas, TheHive como destino de exportación para los casos escalados.
- **La maquinaria multi-tenant es el producto**: aislamiento por namespace con Cilium NetworkPolicy, seguridad a nivel de fila de Postgres como respaldo de datos, una máquina de estados del ciclo de vida del tenant y configuración de LLM por tenant.

**Sé claro sobre la superficie de integración de V1**, porque aquí es donde la honestidad le gana al marketing:

- La [exportación a TheHive](/es-419/integrate/thehive) es opcional y **síncrona** — el worker llama a la API de TheHive en el momento del nodo del grafo, creando el caso y los observables. No hay outbox, no hay bucle de reintentos y no hay subchart de TheHive incluido; si TheHive no está accesible, la falla se registra y el caso continúa solo en SocTalk.
- [Cortex](/es-419/integrate/cortex) es **exclusivamente gestionado por el cliente** en V1 — tú ejecutas Cortex y SocTalk lo llama. No hay subchart incluido; la selección de analizadores usa un mapa codificado de forma fija, y las llamadas fallidas no son fatales para la ejecución.
- Las consultas a **MISP** se ejecutan en el `misp_worker` del pipeline contra tu instancia de MISP; un subchart de MISP incluido queda diferido a una release futura.
- El código de notificación de **Slack** y de aprobación bidireccional existe en el repositorio pero **no está conectado al runtime del chart de V1** — la cola de revisión del dashboard es la superficie de human-in-the-loop operativa hoy.

En otras palabras: SocTalk empaqueta el plano Wazuh multi-tenant y la capa de triaje, y se *conecta a* las instancias de TheHive/Cortex/MISP que tú operas. La conveniencia de los subcharts incluidos es roadmap, no release.

## ¿Armar el stack tú mismo o desplegar SocTalk?

Criterios honestos, ya que ambos caminos son de código abierto:

**Arma el stack de cuatro herramientas por tu cuenta cuando** eres una sola organización con tiempo de ingeniería, quieres el máximo control sobre cada componente, tu volumen de alertas es manejable para tu plantilla de analistas y la multi-tenencia es irrelevante. El stack clásico más tu propio pegamento es un patrón probado, y entenderás cada cable porque tú lo soldaste.

**Considera SocTalk cuando** eres un MSP/MSSP que necesita stacks de Wazuh por cliente repetibles detrás de un solo plano de control, aislamiento de tenants demostrable y triaje con AI que comprima el volumen de alertas antes de que los analistas lo vean — y prefieres operar una plataforma gestionada con Helm en lugar de N stacks construidos a mano. Sigues ejecutando Kubernetes, y en V1 sigues operando tu propio TheHive, Cortex y MISP si los quieres.

La forma más rápida de evaluar es la [VM de demostración](/es-419/quickstart-vm): una imagen, un asistente en el navegador, unos cinco minutos hasta una instalación multi-tenant en funcionamiento con un tenant de demostración incorporado. Desde ahí, [Cómo funciona](/es-419/how-it-works) explica el pipeline, y las páginas de [TheHive](/es-419/integrate/thehive) y [Cortex](/es-419/integrate/cortex) documentan exactamente lo que las integraciones de V1 hacen — y no hacen — para que puedas planificar el resto de tu stack alrededor de ellas.
