# Modelo de seguridad

Catálogo de principales, matriz actor×recurso, matriz de políticas RLS, modelo de roles de Postgres, clasificación de endpoints, esquemas de claims de tokens, requisitos de auditoría, ubicación de secretos.

> **Nota sobre el despliegue V1.** Los ejemplos de endpoints a continuación (p. ej. `/api/mssp/impersonate/:tenant_id`, `/api/mssp/users` POST/list, `/api/mssp/fleet/summary`) y varias entradas de principales (el emisor de licencias Cloud; el actor de suplantación) describen la **superficie de seguridad objetivo**. Los endpoints MSSP montados incluyen: CRUD de tenants, auditoría (`/api/audit`), gestión de usuarios de personal (`/api/mssp/users` create/list/patch/deactivate y `/{id}/password/reset`), y `/api/auth/assume-tenant` para el alcance de tenant por sesión (no suplantación de usuario). La gestión de usuarios de autoservicio del tenant reside bajo `/api/tenant/users`. Usa las matrices siguientes como la intención de diseño; consulta la [REST API](/es-419/reference/api) para saber qué está realmente activo.

## Catálogo de principales

Ocho principales.

| # | Principal | Categoría | Alcance | Se autentica mediante |
|---|---|---|---|---|
| 1 | **User** (role ∈ {platform_admin, mssp_admin, mssp_manager, analyst, tenant_admin, tenant_manager, tenant_analyst, customer_viewer}) | Humano | Derivado del rol | Ingress OIDC → SocTalk JWT |
| 2 | **Worker** | Servicio de SocTalk (en segundo plano) | Un tenant por trabajo | JWT de servicio, de corta duración, emitido por la SocTalk API en el despacho |
| 3 | **System** | Servicio de SocTalk (operaciones entre tenants) | A nivel de instalación, con bypass de RLS | Controlado por ruta de código; sin JWT |
| 4 | **SocTalk K8s ServiceAccount** | Servicio de SocTalk (identidad K8s) | Clúster, con alcance por convención de nombres a `tenant-*` | Token proyectado de K8s |
| 5 | **Tenant adapter** | Sidecar del plano de datos | Un solo tenant, solo llama a la SocTalk API | JWT del adapter, con alcance de tenant, de corta duración |
| 6 | **Wazuh agent** | Agente de endpoint externo | El Wazuh manager de un solo tenant | Inscripción `authd` de Wazuh → mTLS por agente |
| 7 | **MSSP cluster admin** | Humano, fuera de banda | Todo el clúster (sin límite) | Credenciales de `kubectl` |
| 8 | **Cloud license issuer** | Ancla de confianza | Autoridad de firma offline | Clave Ed25519 en HSM/KMS (versión futura) |

### Roles de usuario

Los roles son paquetes de capacidades organizados en tres niveles por audiencia (operate ⊆ authorize-risk ⊆ configure); el lado del tenant agrega un stakeholder de solo lectura por debajo de operate. Consulta [Usuarios y roles](/es-419/users-and-roles) para conocer el modelo de capacidades.

Lado MSSP (`tenant_id` NULL):

| Rol | Nivel | Función típica |
|---|---|---|
| `platform_admin` | configure (super) | Todas las capacidades MSSP, a nivel de instalación. |
| `mssp_admin` | configure | Configurar el sistema, gestionar usuarios de personal, más todo lo de abajo. |
| `mssp_manager` | authorize-risk | Declarar engagements, curar hechos de autorización, aprobar acciones de alto impacto, más operate. |
| `analyst` | operate | Triaje, revisión de veredictos, decisión, chat; trabaja un tenant mediante un pin de Open-SOC. |

Lado del tenant (`tenant_id` establecido):

| Rol | Nivel | Función típica |
|---|---|---|
| `tenant_admin` | configure | Gestionar los usuarios de la propia organización y los ajustes de LLM, más todo lo de abajo. |
| `tenant_manager` | authorize-risk | Declarar los propios engagements, afirmar hechos de autorización (revisados por el MSSP), más operate. |
| `tenant_analyst` | operate | Trabajar el SOC de su propio tenant: triaje, revisión de veredictos, decisión, chat. |
| `customer_viewer` | solo lectura | Paneles e investigaciones de solo lectura; no puede actuar ni abrir la cola de revisión. |

Derivación del alcance: `role ∈ {platform_admin, mssp_admin, mssp_manager, analyst}` ⇒ `tenant_id` NULL en la BD, acceso entre tenants mediante un rol elevado de Postgres o alcance de tenant por sesión (`/api/auth/assume-tenant`). `role ∈ {tenant_admin, tenant_manager, tenant_analyst, customer_viewer}` ⇒ `tenant_id` requerido en la fila del usuario y en el JWT. Las capacidades MSSP y las capacidades de tenant nunca se solapan; el guard de cada ruta comprueba la capacidad y la audiencia en conjunto.

### Disciplina del principal Worker

Cada trabajo en segundo plano debe llevar `tenant_id` en su payload. Los puntos de entrada del Worker están decorados con `@tenant_scoped_worker`, que establece `app.current_tenant_id` antes de cualquier acceso a la BD. Los Workers se conectan como el rol de Postgres `soctalk_app` y están sujetos a RLS: olvidar establecer el contexto produce cero filas, no una fuga entre tenants.

### Disciplina del principal System

Las operaciones entre tenants (rollups del MSSP, migraciones, herramientas de administración) usan el principal `System` mediante un context manager de Python `system_context()`. La entrada emite una fila de auditoría. El context manager es la única compuerta. `import-linter` impide su importación fuera de los módulos de sistema designados. El principal System se conecta como el rol de Postgres `soctalk_mssp`, que tiene `BYPASSRLS`.

## Catálogo de recursos

### Recursos de base de datos (con alcance de tenant)

Todos tienen una FK `tenant_id` y están sujetos a RLS:

- `Event` — almacén de eventos, solo de anexado
- `InvestigationReadModel` — estado proyectado de la investigación
- `MetricsHourly`, `IOCStats`, `RuleStats`, `AnalyzerStats` — proyecciones por tenant
- `PendingReview` — cola HIL
- `IntegrationConfig` — URLs de integración, endpoints y umbrales por tenant
- `BrandingConfig` — nombre de la app, logo y colores por tenant
- `TenantSecret` — referencias (ns + name + version) a Secrets de K8s; sin material en crudo
- `TenantLifecycleEvent` — registro de solo anexado de transiciones de estado del tenant y revisiones de configuración
- `AuditLog` — registro de solo anexado de acciones de mutación, con `mssp_user_id` cuando se realiza mediante suplantación

### Recursos de base de datos (con alcance de instalación)

Sin `tenant_id`; con alcance de Organization o global:

- `Organization` — a nivel de instalación (mssp_id, mssp_name, install_id, install_label, license_jwt reservado)
- `User` — tanto usuarios del lado MSSP (tenant_id anulable) como usuarios de cliente (tenant_id requerido)
- Semántica de usuario MSSP / usuario de tenant derivada del rol + presencia de tenant_id; tabla única
- `Release` — metadatos de versión de SocTalk (a nivel de instalación)
- Ajustes de instalación (feature flags, interruptores a nivel de sistema)

### Recursos de Kubernetes

| Recurso | Alcance | Gestionado por |
|---|---|---|
| Namespace `soctalk-system` | A nivel de instalación | MSSP cluster admin (creado por Helm) |
| Namespace `tenant-<slug>` | Por tenant | SocTalk K8s ServiceAccount (verbos de clúster) |
| `Deployment`, `Service`, `PVC`, `Secret`, `ConfigMap`, `NetworkPolicy`, `ResourceQuota`, `LimitRange`, `ServiceAccount`, `Role`, `RoleBinding` en `tenant-*` | Por tenant | SocTalk K8s ServiceAccount |

## Matriz actor × recurso

`R` = lectura, `W` = escritura, `-` = denegar.

| Grupo de recursos | `platform_admin` | `mssp_admin` | `analyst` | `customer_viewer` | `Worker` | `System` | `SocTalk K8s SA` | `Tenant adapter` |
|---|---|---|---|---|---|---|---|---|
| BD con alcance de tenant (propio tenant) | RW (cualquiera) | RW (cualquiera) | RW (cualquiera) | R (propio) | RW (tenant del trabajo) | RW (cualquiera vía bypass) | - | - |
| BD con alcance de instalación | RW | R (menos licencia) | R | - | R | RW | - | - |
| Gestión de usuarios (lado MSSP) | RW | RW | - | - | - | RW | - | - |
| Gestión de usuarios (lado tenant, propio tenant) | - | - | - | - | - | - | - | - |
| Registro de auditoría (propio tenant) | R todo | R todo | R todo | R propio | W | W | - | W (vía bootstrap) |
| Namespaces de K8s `tenant-*` | (solo vía API) | (solo vía API) | (solo vía API) | - | - | - | CRUD | - |
| Recursos de K8s dentro de `tenant-*` | (solo vía API) | (solo vía API) | (solo vía API) | - | - | - | CRUD | R propio |
| Secret de LLM por tenant | - | - | - | - | R (propio tenant) | - | montar | - |
| Secrets de integración por tenant | - | - | - | - | R (propio tenant) | - | montar | - |

Notas:
- Las columnas muestran un subconjunto representativo de roles. `mssp_manager` se ubica entre `mssp_admin` y `analyst` (nivel authorize-risk); `tenant_manager` y `tenant_analyst` se ubican por encima de `customer_viewer` en el lado del tenant. Cada uno posee todas las capacidades del nivel inferior.
- La gestión de usuarios está separada por muros de capacidad según la audiencia, una **separación de funciones**. Los usuarios de personal MSSP los gestionan únicamente `mssp_admin`/`platform_admin` mediante `/api/mssp/users`; los usuarios de tenant los gestiona únicamente el `tenant_admin` de ese tenant mediante `/api/tenant/users`. Un administrador MSSP no gestiona usuarios de tenant, y viceversa. Asignar `platform_admin`, y modificar un `platform_admin` existente, requieren un `platform_admin`.
- "solo vía API" significa que el principal humano dispara operaciones de K8s llamando a endpoints de la SocTalk API, no directamente. Los manejadores de la API usan el SocTalk K8s ServiceAccount.
- `analyst` actuando sobre un tenant escribe filas de auditoría con `user_id` y el `tenant_id` del tenant; la vista de auditoría del lado del cliente las muestra como entradas de suplantación.

## Matriz de políticas RLS

Consulta [RLS de Postgres](/es-419/reference/postgres-rls) para el SQL. Resumen:

| Tabla | Política | `USING` | `WITH CHECK` |
|---|---|---|---|
| Todas las tablas con alcance de tenant | `tenant_isolation` | `tenant_id = current_setting('app.current_tenant_id')::uuid` | igual |
| `User` (donde `tenant_id IS NOT NULL`) | igual | igual | igual |
| `AuditLog` | `audit_read` | igual para lectura; escrituras permitidas desde Worker + System | igual |
| Tablas con alcance de instalación | sin RLS | — | — |

Todas las tablas con alcance de tenant tienen `FORCE ROW LEVEL SECURITY`, de modo que el propietario de la tabla (`soctalk_admin`) también está sujeto a RLS. El principal System usa el rol `soctalk_mssp` (`BYPASSRLS`) para cruzar tenants de forma intencional.

## Clasificación de endpoints de la API

Tres categorías. Nunca un endpoint que sirva a dos categorías.

### `/api/mssp/*`: lado MSSP (requiere un rol MSSP; la capacidad específica varía según la ruta)

Capaz de operar entre tenants. Cuando un manejador necesita visibilidad entre tenants (rollups, vistas de flota), usa el principal `System` mediante `system_context()`. Cuando un manejador actúa sobre un tenant específico (suplantación), establece `app.current_tenant_id` y permanece sujeto a RLS.

Ejemplos (esta versión): `POST /api/mssp/tenants/onboard`, `GET /api/mssp/tenants`, `POST /api/mssp/tenants/{id}:retry`, `POST /api/mssp/tenants/{id}:suspend|:resume|:decommission`, `GET /api/audit`, gestión de usuarios de personal MSSP bajo `/api/mssp/users`. (La suplantación y los rollups de flota están en el roadmap.)

### `/api/tenant/*`: lado tenant (requiere un rol de tenant; la capacidad específica varía según la ruta)

Con alcance estricto. El contexto de tenant proviene del JWT; sin entrada de suplantación. Todas las consultas se hacen cumplir por RLS mediante `soctalk_app`. Incluye superficies de operate para `tenant_analyst`+ (triaje, revisión, chat) y autoservicio para engagements, hechos de autorización y usuarios.

Ejemplos: `GET /api/tenant/overview`, `GET /api/tenant/incidents`, `GET /api/tenant/reports`, `GET /api/tenant/audit`, `GET /api/tenant/branding`.

### `/api/internal/*` — servicio a servicio (Worker JWT o Adapter JWT)

No orientado al usuario. JWTs de servicio de corta duración con contexto de tenant explícito. Ejemplos: `POST /api/internal/adapter/health`, `POST /api/internal/adapter/bootstrap`, `GET /api/internal/adapter/config`.

Ningún endpoint acepta a la vez la semántica de `/api/mssp/*` y `/api/tenant/*`. Si una capacidad se necesita en ambos lados, se implementa como dos endpoints con distinta autorización y distintos flujos de contexto.

## Esquemas de claims de tokens

### JWT de User del lado MSSP

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "iat": 1713475200,
  "exp": 1713478800,
  "jti": "<uuid>",
  "user_type": "mssp",
  "role": "platform_admin | mssp_admin | mssp_manager | analyst",
  "current_tenant": null
}
```

Cuando un `mssp_admin` o un `analyst` entra en el contexto de un tenant, se acuña un nuevo token de corta duración con `current_tenant: "<tenant_uuid>"`. Los tokens de suplantación tienen un TTL máximo de 30 minutos y se registran en el momento del acuñado.

### JWT de User del lado tenant

```json
{
  "iss": "soctalk",
  "sub": "user_<uuid>",
  "user_type": "tenant",
  "role": "tenant_admin | tenant_manager | tenant_analyst | customer_viewer",
  "tenant_id": "<tenant_uuid>"
}
```

### JWT de servicio del Worker

```json
{
  "iss": "soctalk",
  "sub": "worker",
  "user_type": "worker",
  "tenant_id": "<tenant_uuid>",
  "job_id": "<uuid>",
  "job_type": "triage | enrich | decide | ..."
}
```

### JWT del Adapter

```json
{
  "iss": "soctalk",
  "sub": "adapter",
  "user_type": "adapter",
  "tenant_id": "<tenant_uuid>",
  "scope": "adapter"
}
```

Los JWTs del Adapter se renuevan semanalmente; la rotación es una reescritura de secreto del lado del SocTalk-controller en el namespace del tenant.

## Requisitos de auditoría

Cada mutación escribe una fila de `AuditLog` con:

- `id` (uuid), `timestamp`, `tenant_id` (anulable para eventos con alcance de instalación)
- `actor_principal` (User | Worker | System | Adapter)
- `actor_id` (user_id | `worker:<job_id>` | `system:<reason>` | tenant_id del adapter)
- `action` (enum: `tenant.create`, `tenant.suspend`, `investigation.approve`, `settings.update`, `user.impersonate`, …)
- `resource_type`, `resource_id`
- `before`, `after` (snapshots JSON para acciones que cambian el estado)
- `acting_as` (anulable; establecido cuando un `mssp_admin` o `analyst` está suplantando a un tenant)
- `request_id` (correlaciona con las líneas de log)

La retención es de 90 días; configurable por instalación en una versión futura. Los clientes pueden ver filas de auditoría donde `tenant_id = own`, incluidas las entradas con `acting_as` poblado (transparencia sobre las acciones del MSSP). La vista de auditoría entre tenants del MSSP se ejecuta bajo el principal `System`.

## Límites arquitectónicos conocidos

- **Confianza en el MSSP cluster admin.** El principal #7 tiene acceso a K8s sin límite. El modelo de aislamiento de SocTalk presume que este principal es de confianza. Los clientes que requieran defensa frente a amenazas internas a nivel del MSSP necesitan escalonamiento por nodo dedicado o por VM dedicada (versión futura).
- **Alcance del límite de admisión.** `ValidatingAdmissionPolicy` restringe el ServiceAccount del controlador de SocTalk para los namespaces de tenant y las mutaciones de recursos con namespace, pero los usuarios MSSP cluster-admin siguen siendo operadores de emergencia (break-glass) de confianza. Kyverno es una vía de endurecimiento opcional a futuro.
- **Sin aplicación de licencias actualmente.** El JWT de licencia y las compuertas de funcionalidades se difieren a una versión futura. Los MSSP piloto operan bajo confianza.
- **Caché de respuestas de LLM.** Con clave `(tenant_id, prompt_hash)` desde el día 1. Si alguna vez se relaja, existe riesgo de fuga de contenido entre tenants; la suite de pruebas verifica la composición de la clave.
- **Suscripciones SSE.** Con alcance de tenant en el momento de la suscripción. Los errores de persistencia de conexión podrían entregar eventos entre tenants en una suscripción obsoleta; hay una prueba explícita de aislamiento SSE en la compuerta de implementación.
- **Fuga de contexto del Worker.** Cada punto de entrada de worker debe establecer `app.current_tenant_id`. El valor por defecto defensivo es cero filas bajo RLS, no una fuga entre tenants, pero la suite de pruebas verifica la defensa.

## Requisitos de pruebas

1. **Sondeo de API entre tenants.** Para cada endpoint `/api/tenant/*` y `/api/mssp/*` que accede a datos con alcance de tenant, elabora peticiones como tenant A que intenten lecturas o escrituras de recursos del tenant B. Verifica 0 filas o 403.
2. **Sondeo de RLS con SQL en crudo.** Conéctate como `soctalk_app`, establece `app.current_tenant_id = A`, ejecuta `SELECT * FROM events` (sin filtrar); verifica que solo se devuelven filas del tenant A.
3. **Contexto por defecto del Worker.** Despacha un trabajo de worker sin establecer el contexto de tenant; verifica que las consultas devuelven 0 filas (comportamiento de cero defensivo).
4. **Aislamiento SSE.** Suscríbete como tenant A al SSE de eventos; muta en el tenant B; verifica que no se entrega ningún evento en el stream de A.
5. **Aislamiento de la caché de LLM.** Dispara prompts idénticos desde el tenant A y el tenant B; verifica fallos de caché en la segunda llamada para B (clave distinta) y aciertos en la tercera llamada para A (misma clave).
6. **Auditoría de suplantación.** Como `mssp_admin`, suplanta al tenant A, realiza una mutación; verifica que existe una fila de `AuditLog` con `acting_as=<mssp_admin_id>` y `tenant_id=A`; verifica que el usuario de cliente en A puede leer la fila.
7. **Auditoría de contexto de sistema.** Dispara una llamada a `/api/mssp/fleet/summary`; verifica que hay una fila de auditoría para la entrada en contexto de sistema con motivo.
