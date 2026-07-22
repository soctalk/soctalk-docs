# TheHive

[TheHive](https://thehive-project.org/) es opcional (opt-in). Cuando se configura por tenant, SocTalk exporta los cierres con disposición `escalate` como casos de TheHive. El historial de la investigación (observables, justificación de la AI, decisión de revisión humana) se convierte en el primer conjunto de observables y la línea de tiempo del caso.

Para el modelo mental, consulta [Pipeline de AI → Cierre](/es-419/ai-pipeline). Para dar de baja un tenant con TheHive habilitado, consulta [Ciclo de vida del tenant → Baja](/es-419/tenant-lifecycle#decommission-vs-purge).

## Modelo de alojamiento

En V1, el chart `soctalk-tenant` no tiene un subchart de TheHive (`dependencies: []`). Las opciones son:

- **TheHive gestionado por el cliente**: el cliente ejecuta su propio TheHive en otro lugar; el MSSP proporciona la URL y una API key por tenant.
- **Sin TheHive**: las escalaciones permanecen únicamente en la UI de SocTalk. Opción por defecto.

Una ruta de "subchart de TheHive empaquetado" se describió en borradores anteriores de esta página como una opción planificada, pero **no está implementada en esta versión**. No hay un StatefulSet de Cassandra ni un Deployment de TheHive gestionados por SocTalk para el tenant.

## Configurar (UI del MSSP)

Detalle del tenant → Settings → TheHive. Campos:

| Campo | Notas |
|---|---|
| Enable | Desactivado por defecto |
| URL | `https://thehive.<customer>.example` para el gestionado por el cliente; `http://thehive.tenant-<slug>.svc:9000` para el empaquetado |
| Organisation | Slug de la organización de TheHive (instancias de TheHive multi-tenant) |
| API key | API key de TheHive del cliente con `case:create`, `observable:create`, `task:create` |
| Verify TLS | Activado por defecto; desactívalo para un TheHive de desarrollo con certificado autofirmado |

**No existe una API para modificar la configuración de la integración con TheHive en V1.** La llamada a TheHive reside en el **runs-worker por tenant** (que mantiene los bindings de MCP), no en el pod central de la API, por lo que establecer variables de entorno `THEHIVE_*` en `soctalk-system-api` no tiene efecto sobre el worker. Para configurar TheHive en V1, establece las variables de entorno en el Deployment `soctalk-runs-worker` del tenant, en el namespace `tenant-<slug>` (y vuelve a renderizar mediante `helm upgrade` del chart del tenant, o `kubectl set env` seguido de `rollout restart`). Una superficie de configuración limpia impulsada por API está en el roadmap.

## Qué se exporta

En V1, la exportación a TheHive ocurre **de forma síncrona en el momento del nodo del grafo** a través del nodo `thehive_worker`, que llama a la API de TheHive mediante MCP. Hoy esto crea el caso (título + severidad reflejados desde el veredicto de SocTalk) y los observables. La superficie más rica, tareas derivadas de `next_actions`, reflejo en la línea de tiempo de las justificaciones de los workers / decisiones de revisión humana, **outbox asíncrono + reintentos**: se describe en borradores anteriores como el objetivo de diseño, pero **no está implementada en esta versión**. Si TheHive no está accesible, el nodo del worker registra el fallo y el caso continúa en SocTalk sin una contraparte exportada. No hay bucle de reintentos, ni outbox, ni campo persistido de "último error", ni superficie de dashboard para exportaciones fallidas, los fallos solo son visibles en los logs estructurados del orquestador.

Mapeo de tipos de observables (según la implementación de V1):

| Tipo de SocTalk | `dataType` de TheHive |
|---|---|
| `ip` | `ip` |
| `fqdn` | `fqdn` |
| `url` | `url` |
| `hash_md5`, `hash_sha1`, `hash_sha256` | `hash` |
| `email` | `mail` |
| `filename` | `filename` |
| `user` | `other` (con `tags: user`) |
| `process` | `other` (con `tags: process`) |
| `registry_key` | `registry` |

## TheHive empaquetado: no en esta versión

El chart `soctalk-tenant` en V1 no empaqueta TheHive como subchart, `Chart.yaml` indica `dependencies: []`. Los operadores que quieran una instancia de TheHive por tenant deben ejecutarla ellos mismos (con `helm install` manual en el namespace del tenant, o gestionada por el cliente en otro lugar). Un subchart empaquetado con secretos de administración gestionados por el chart se describe en borradores anteriores como el objetivo de diseño, pero está en el roadmap.

## TheHive gestionado por el cliente: notas

- El TheHive del cliente debe ser accesible desde el plano de control de SocTalk (salida hacia la URL de TheHive del cliente).
- El cliente crea la API key con los scopes mínimos listados arriba. SocTalk no necesita scope de administración.
- Si el TheHive del cliente aplica listas de permitidos por IP de origen, agrega a la lista la IP de NAT de salida del plano de control de SocTalk.

## Estado / salud

En esta versión **no hay bucle de health-ping en segundo plano** para TheHive, SocTalk solo contacta a TheHive cuando una investigación tiene algo que exportar. Los fallos durante esa llamada se registran únicamente en la salida estructurada del orquestador; no hay campo de error persistido ni reintentos basados en outbox. La UI del MSSP no muestra un indicador separado de "TheHive accesible".

Para monitorear la salud de TheHive, usa tu sonda externa habitual (Prometheus blackbox exporter contra el endpoint `/api/status` de TheHive, etc.), eso es responsabilidad del lado del MSSP, no forma parte de SocTalk en esta versión.

## Rotar la API key

1. En el TheHive del cliente, genera una nueva API key con los mismos scopes.
2. Aplica un parche al Secret del namespace del tenant que contiene las credenciales de TheHive y reinicia el runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revoca la key antigua en TheHive.

Una ruta de recarga en caliente (observar el archivo del Secret montado) está planificada.

## Punteros al código fuente

| Concepto | Archivo |
|---|---|
| Worker / exportación de TheHive | [`src/soctalk/workers/thehive.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/thehive.py) |
| Esquema de configuración | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
| Puente de herramientas MCP | [`src/soctalk/chat/mcp_tools.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/chat/mcp_tools.py) |
