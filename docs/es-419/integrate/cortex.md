# Cortex

[Cortex](https://thehive-project.org/) proporciona análisis de observables (reputación, detonación en sandbox, whois, etc.) mediante sus complementos "analyzer". El nodo [`cortex_worker`](/es-419/ai-pipeline) de SocTalk envía observables a través de Cortex durante el enriquecimiento.

## Modelo de hosting

El chart `soctalk-tenant` en V1 no tiene un subchart de Cortex (`dependencies: []`). Las opciones son:

- **Cortex gestionado por el cliente** — el cliente ejecuta el suyo propio; el MSSP proporciona la URL + la clave de API.
- **Sin Cortex** — la canalización de AI aún intenta la ruta `ENRICH` (el supervisor no sabe que Cortex falta); cada invocación de `cortex_worker` falla y el fallo queda registrado. No hay un campo de estado por observable en V1; el worker simplemente retorna sin enriquecimiento y el supervisor continúa.

Un "subchart de Cortex incluido" se describió en borradores anteriores como una opción planificada, pero **no está implementado en esta versión**.

## Configurar (interfaz del MSSP)

Detalle del tenant → Settings → Cortex.

| Campo | Notas |
|---|---|
| Enable | Desactivado por defecto |
| URL | `https://cortex.<customer>.example` para el gestionado por el cliente; `http://cortex.tenant-<slug>.svc:9001` para el incluido |
| API key | La clave de API de Cortex del cliente con `analyze:any` |
| Verify TLS | Activado por defecto |
| Default TLP | Por defecto `2` (Amber). Se usa cuando SocTalk envía observables que no llevan un TLP |

**No hay una API para modificar la configuración de integración de Cortex en V1.** Las llamadas a Cortex viven en el **runs-worker por tenant**, no en el pod central de la API, por lo que las variables de entorno en `soctalk-system-api` no tienen efecto. Para configurar Cortex en V1, establece las variables de entorno en el Deployment `soctalk-runs-worker` del tenant en el namespace `tenant-<slug>` (`helm upgrade` del chart del tenant, o `kubectl set env` + `rollout restart`). Rota la clave de API parcheando el Secret del namespace del tenant y reiniciando el runs-worker. Una superficie de configuración limpia impulsada por API está en la hoja de ruta.

## Selección de analyzer

Para cada observable, el worker prueba el **primer nombre de analyzer** en un `ANALYZER_MAP` codificado de forma fija (en [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) según el tipo del observable — sin comprobar si ese analyzer está realmente instalado en la instancia de Cortex. Si el analyzer no está instalado (o falla), el fallo queda registrado y el worker retorna sin el enriquecimiento. No hay respaldo a un segundo analyzer en V1; instala el analyzer canónico nombrado en `ANALYZER_MAP` para cada tipo de observable que te interese. Exponer el orden de preferencia de analyzers como un valor del chart está en la hoja de ruta.

## Costo

Cortex en sí es gratuito; los proveedores de analyzers cobran por las consultas. SocTalk no mide las llamadas a Cortex directamente — mídelas en el proveedor:

- VirusTotal: cuota por clave
- AbuseIPDB: cuota por clave
- Hybrid Analysis: cuota por clave

El rendimiento de observables por tenant es visible mediante `soctalk_tenant_events_ingested_total` (cada evento ingerido dispara ~1–5 extracciones de observables) en [Observabilidad](/es-419/observability#per-tenant-counters-defined-surface).

## Comportamiento del worker

El nodo `cortex_worker` tiene un `ANALYZER_MAP` codificado de forma fija (en [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) que asigna a cada tipo de observable una pequeña lista de nombres de analyzers. Para cada observable, el worker envía al **primer** analyzer de esa lista sin comprobar su disponibilidad; si ese analyzer no está instalado o falla, el enriquecimiento del observable se registra como fallido.

Secuencia:

1. Lee la lista actual de observables del caso desde el estado.
2. Para cada observable, busca la lista de analyzers en `ANALYZER_MAP` según su tipo.
3. Envía al primer analyzer asignado mediante el endpoint `/api/observable` de Cortex.
4. Sondea `/api/job/{id}/report` hasta que el job termina o se dispara un timeout por job.
5. Añade el veredicto (`safe`, `info`, `suspicious`, `malicious`) y el cuerpo del reporte al estado del caso. Los jobs fallidos registran el error y continúan.

Las llamadas a Cortex que fallan no hacen fallar la ejecución — el worker registra el fallo y retorna al supervisor sin enriquecimiento para ese observable. El nodo de veredicto razona sobre cualquier contexto que esté disponible.

## Cortex incluido: no en esta versión

El chart `soctalk-tenant` no incluye Cortex como subchart. Ejecuta Cortex tú mismo (gestionado por el cliente) si quieres enriquecimiento con analyzers. Cortex gestionado por SocTalk está en la hoja de ruta.

## Rotar la clave de API

1. Genera una nueva clave en Cortex con `analyze:any`.
2. Parchea el Secret del namespace del tenant que contiene las credenciales de Cortex y reinicia el runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revoca la clave antigua en Cortex.

## Lo que no está aquí

- Desarrollo de analyzers personalizados — fuera de alcance; consulta [TheHive-Project/Cortex-Analyzers](https://github.com/TheHive-Project/Cortex-Analyzers).
- Overrides de TLP/PAP por observable — planificado; hoy el valor por defecto del tenant se aplica a cada envío.

## Punteros al código fuente

| Concepto | Archivo |
|---|---|
| Nodo del worker + ANALYZER_MAP | [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py) |
| Esquema de configuración | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
