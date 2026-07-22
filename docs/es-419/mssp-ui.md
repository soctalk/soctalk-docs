# Recorrido por la interfaz de MSSP

Lo que ve un operador de MSSP tras iniciar sesión. Lee esto una vez antes de [Operaciones diarias](/es-419/operations) para que los runbooks tengan sentido.

## Alcance: todo el MSSP vs. un solo tenant

Cada usuario de MSSP tiene dos alcances de operación:

- **Todos los tenants**: colas entre tenants y vistas agregadas. Este es el valor predeterminado para `mssp_admin`. La esquina superior derecha muestra un chip de **Todos los tenants**.
- **Un solo tenant**: el administrador de MSSP abrió el SOC de un cliente (el chip indica `Tenant: <name>`). Todas las vistas quedan acotadas a ese tenant; el botón **Clear** junto al chip vuelve al alcance de todo el MSSP.

El alcance también gobierna el riel de navegación. En el alcance de todo el MSSP ves Tenants en el riel; en el alcance de un tenant queda oculto porque las pantallas de detalle del tenant ocupan su lugar.

## Riel de navegación

El riel izquierdo es persistente en todas las páginas. De arriba abajo:

| Icono      | Página            | Qué muestra |
|------------|-------------------|---------------|
| SocTalk    | `/`               | Inicio / panel |
| Dashboard  | `/`               | Mosaicos de KPI del MSSP + gráfico de rendimiento de investigaciones |
| Tenants    | `/tenants`        | Todos los SOC de clientes (solo en alcance de todo el MSSP) |
| Investigations | `/investigations` | Cola entre tenants de casos activos |
| Reviews    | `/review`         | Cola de propuestas con humano en el bucle |
| Chat       | `/chat`           | Chat del operador con el agente de SocTalk |
| Analytics  | `/analytics`      | Tendencias de nivel de servicio entre tenants |
| Audit Log  | `/audit`          | Registro de eventos de solo anexado |
| Settings   | `/settings`       | Proveedor de LLM, interruptores de integración |
| Live / Offline | —              | Indicador de conexión en tiempo real (estado del WebSocket) |

En la parte superior derecha de cada página está el chip de usuario (`email`, `role`) y un botón de **Log out**.

La interfaz de la aplicación se distribuye localizada en siete idiomas, conmutables dentro de la app desde el selector de idioma, que lista cada opción bajo su propio nombre nativo: English, Português (Brasil), Español (Latinoamérica), 中文（简体）, Français, Deutsch, Italiano.

## Dashboard

![Panel del MSSP](/screenshots/mssp-dashboard.png)

Mosaicos de KPI en la fila superior (Investigaciones abiertas, Revisiones pendientes, Tiempo medio de triaje, Tiempo medio hasta el veredicto) y una segunda fila de contadores operativos (Creadas hoy, Cerradas hoy, Escalaciones, Cerradas automáticamente, IOC maliciosos).

Debajo de los mosaicos:

- **Rendimiento de investigaciones (24h)**: gráfico de barras+línea de creadas / cerradas manualmente / cerradas automáticamente / escaladas / acumuladas.
- **Veredictos de hoy**: recuento en curso de los veredictos de la IA del día.
- **Investigaciones activas**: lista breve de casos en curso con un enlace directo a cada uno.

El gráfico es el widget más observado para la planificación de capacidad; si el backlog (línea roja) tiende al alza mientras el rendimiento se mantiene plano, el MSSP está subaprovisionado o el modelo está derivando demasiados casos a la revisión humana.

## Tenants

### Lista de tenants

![Lista de tenants](/screenshots/tenants-list.png)

Una fila por cliente. Columnas: Nombre para mostrar, Slug, Perfil (`poc` o `persistent`), Estado (`pending | provisioning | active | degraded | suspended | decommissioning | archived | purged`), Creado, Acciones.

El botón **+ New Tenant** abre el formulario de incorporación. El perfil queda fijado en el momento de la creación; cambiarlo después requiere dar de baja y volver a crear.

### Detalle del tenant

![Detalle del tenant](/screenshots/tenant-detail.png)

Tres secciones:

1. **Identidad**: ID del tenant, perfil, marcas de tiempo de creación / cambio de estado. El slug aparece bajo el nombre para mostrar en el encabezado.
2. **Acciones**: Suspend / Resume / Retry Provisioning / Decommission. **Suspend en esta versión cambia el estado del tenant a `suspended`** para que el orquestador deje de programar nuevas investigaciones; **no** escala las cargas de trabajo. Para un corte definitivo, sigue [Operaciones diarias → Desactivación de emergencia](/es-419/operations#emergency-disable-a-tenant-immediately). **Retry Provisioning** solo funciona en tenants en estado `degraded`: la API rechaza `:retry` en tenants en `pending` (`pending → provisioning` es automático en el primer intento).
3. **Eventos del ciclo de vida**: registro cronológico de la máquina de estados de aprovisionamiento: `preflight_ok → secrets_minted → namespace_ready → secrets_applied → helm_applied (soctalk-tenant chart) → helm_applied (Wazuh chart) → workloads_ready → integration_config_written → active`. Las dos filas de `helm_applied` se distinguen mediante el payload del evento (identidad del chart). Cuando un tenant se atasca, esta tabla te dice qué paso falló.

Por lo demás, la página es de solo lectura; el SOC de cada tenant se abre en su propia ventana mediante la acción **Open SOC** en la lista de tenants. Wazuh es el plano de datos en el namespace; TheHive y Cortex son integraciones externas, no componentes empaquetados por tenant.

## Investigations

### Lista

![Lista de investigaciones](/screenshots/investigations-list.png)

Cola entre tenants. Filtros: estado (Pending / Active / Awaiting Enrichment / Awaiting Verdict / Awaiting Human / Escalated / Closed) y fase (Triage / Enrichment / Analysis / Verdict / Escalation / Closed). Cada fila muestra Tenant, Título, Estado, Fase, Severidad (Critical / High / Medium / Low), recuento de Alertas, recuento de IOC maliciosos, Veredicto, Creado, Acciones.

Haz clic en **View** (o en el título) para abrir la página de detalle.

### Detalle

![Detalle de la investigación](/screenshots/investigation-detail.png)

Diseño:

- **Encabezado**: título, insignias de estado (Active/Closed, Fase actual, Severidad).
- **Mosaicos de KPI**: Alertas, Observables (total/maliciosos/sospechosos), Tiempo hasta el triaje, Tiempo hasta el veredicto.
- **Detalles**: ID, Creado, Actualizado.
- **Línea de tiempo de eventos**: bandeja de eventos cronológica del caso (inmutable, de solo anexado).
- **Ejecución del agente**: gasto de tokens frente al presupuesto configurado por ejecución (`case_runs.tokens_budget`, valor predeterminado del modelo 200,000) y disposición (`pending | active | failed | completed`).
- **Resumen de observables**: totales desglosados como Malicious / Suspicious / Clean.

El botón flotante **Ask AI** abre una conversación lateral que opera contra el contexto de este caso.

## Reviews (humano en el bucle)

![Cola de revisión](/screenshots/review-queue.png)

La cola entre tenants de propuestas de la IA que esperan una compuerta humana. Cada fila muestra el título de la propuesta, el recuento de alertas, el plazo, la severidad, el chip de veredicto de la IA (`AI: Escalate / Close / Needs More Info`) y un botón **Review**.

Al revisar se registra la decisión (`approve | reject | more_info`), que actualiza la fila de revisión pendiente en la base de datos. En V1 **no hay una canalización descendente basada en outbox**; la decisión se detiene en la fila de revisión + el registro de auditoría. Cualquier creación de caso en TheHive o notificación de Slack tiene que ocurrir en línea durante la ejecución del grafo de la IA.

Existe un backend de HIL bidireccional para Slack en el código (`src/soctalk/hil/backends/slack.py`), pero **no está conectado al runtime del chart de V1**. La cola del panel es la única superficie de HIL funcional hoy.

## Chat

La página de chat abre una conversación del operador con el agente de SocTalk. Consciente del alcance: en el alcance de todo el MSSP puedes preguntar entre tenants; en el alcance de un tenant la conversación queda ligada a los datos de un solo cliente. Útil para preguntas ad-hoc ("muéstrame los intentos de fuerza bruta de esta semana en el tenant X") que no ameritan una consulta guardada.

## Analytics

![Analytics](/screenshots/analytics.png)

Vista entre tenants con forma de tendencia, agrupada por tiempo (Ventana predeterminada: 30 días). Reportes:

- **Volumen de alertas**
- **p95 TTV** (tiempo hasta el veredicto, IA)
- **p95 TTR** (tiempo hasta la revisión, compuerta humana)
- **Tasa de escalación**
- **Tenants con mayor deterioro**: ordenados por el delta de p95 TTV frente a la ventana anterior
- **Mapa de calor de actividad**: día de la semana × hora del día, alertas (conmutable a otras dimensiones)

Usa esto para la planificación de capacidad, la evaluación de versiones del modelo y la revisión de SLA.

### Analítica de decisiones

Fijar la página de Analytics a un solo tenant reemplaza las tendencias entre tenants anteriores por un conjunto de superficies enfocadas en las decisiones para ese cliente:

- **Distribución de confianza**: cómo se reparte la confianza de las decisiones de la IA entre las alertas triadas, agrupada por confianza.
- **Tendencias de decisiones**: cómo se mueve con el tiempo la mezcla de decisiones (cerrar, escalar, etc.).
- **Confianza media por decisión**: confianza media desglosada por tipo de decisión.

## Registro de auditoría

![Registro de auditoría](/screenshots/audit-log.png)

Auditoría de solo anexado a nivel de todo el MSSP. Filtra por tipo de evento (Review Requested / Review Completed / Tenant Onboarded / Decommissioned / Key Rotated / …). Columnas: Marca de tiempo, Tipo de evento, Investigación (enlace directo), Versión (versión de fila con event-sourcing), Datos (payload JSON expandible).

Para exportaciones de cumplimiento, consulta la API directamente:

```bash
curl 'https://mssp.your-mssp.example/api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

## Settings

![Settings](/screenshots/settings.png)

Página de configuración a nivel de todo el MSSP. **En V1 esta página muestra valores de stub codificados de forma fija**: `GET /api/settings` devuelve un payload estático de solo lectura que no refleja la configuración real de la instalación. La página es solo informativa; **no** es una ventana a la configuración de la instalación en vivo, y el botón **Save Changes** no hace nada. Una superficie de configuración real que refleje el estado derivado del entorno está en el roadmap. La mutación de LLM por tenant es la única superficie de configuración que realmente funciona en V1, consulta la [página de detalle de LLM](#llm-detail-page).

Secciones:

- **LLM**: Proveedor (`openai-compatible | anthropic`), Fast Model, Reasoning Model, Temperature, Max Tokens, Base URL opcional + Organization. Las claves de API viven en el entorno / Kubernetes Secrets, nunca en este formulario.
- **Wazuh SIEM**: interruptor de habilitación, URL, credenciales.
- **Cortex**: interruptor de habilitación, URL, credenciales. Integración externa, no un subchart empaquetado; la URL apunta a la instancia de Cortex del tenant (consulta /es-419/integrate/cortex).
- **TheHive**: interruptor de habilitación, URL, organización, credenciales. Integración externa, no un subchart empaquetado; la URL apunta a la instancia de TheHive del tenant (consulta /es-419/integrate/thehive).
- **Slack**: configuración del webhook + backend interactivo.

El enlace **Bring your own LLM key →** lleva a la rotación de claves de LLM por tenant (las claves de LLM por tenant anulan la clave de toda la instalación).

### Página de detalle de LLM

![Detalle de configuración de LLM](/screenshots/settings-llm.png)

Página independiente accesible desde Settings → **Bring your own LLM key →**. En V1 esto es **solo la entrada de la clave BYOK por tenant**: el formulario toma la clave de API del **tenant actualmente en alcance** y la envía mediante `PUT /api/tenant/llm/api-key` (el endpoint del lado del tenant; los administradores de MSSP también pueden usar `PUT /api/mssp/tenants/{tenant_id}/llm/api-key`). Los demás campos de LLM (proveedor, modelo, temperatura) que se muestran en la página principal de Settings son valores de stub; tampoco son editables aquí. Consulta [Operaciones diarias → Rotar la clave de LLM por tenant](/es-419/operations#rotate-per-tenant-llm-key) para el procedimiento de rotación.

## Ver también

- [Operaciones diarias](/es-419/operations), el lado de runbook de estas páginas (revisión, investigaciones, baja, rotación).
- [Ingress de Wazuh](/es-419/reference/wazuh-ingress), el flujo de incorporación de agentes desde el detalle del tenant.
- [Modelo de seguridad](/es-419/reference/security-model), qué puede hacer cada rol de MSSP (`platform_admin`, `mssp_admin`, `analyst`, `customer_viewer`).
