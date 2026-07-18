# Usuarios y roles

Cómo funcionan los roles, quién puede hacer qué, y cómo los administradores crean usuarios, entregan el portal de cliente y rotan contraseñas. Para un recorrido paso a paso del aprovisionamiento y el ciclo de vida del usuario con capturas de pantalla, consulta [Gestión de usuarios: un recorrido](/es-419/manage-users). Consulta [Autenticación interna](/es-419/reference/internal-auth) para la referencia a nivel de protocolo y [Modelo de seguridad](/es-419/reference/security-model) para la matriz de rol por recurso.

## Cómo se decide el acceso

El acceso está migrando a un modelo de capacidades. Cada rol es un paquete con nombre de capacidades, y las superficies construidas o rediseñadas para él (el flujo de operación y revisión, el chat, el autoservicio de tenant para engagements, los hechos de autorización y los usuarios) piden la capacidad que necesitan en lugar de un rol específico. En esas rutas, agregar un rol es cuestión de definir su paquete; los puntos de invocación no cambian. Otras rutas todavía se controlan directamente por rol o audiencia, incluyendo la gestión de tenants del MSSP, la configuración de LLM y branding, el restablecimiento de contraseña por administrador, y varias rutas de dashboard, analítica e investigación. Esas se actualizan a mano cuando los roles cambian. Trata el acceso basado en capacidades como la dirección, no como algo universal hoy.

Los roles se organizan en niveles, y los mismos niveles operativos existen en ambos lados del negocio:

- **operate**: trabajar la cola. Ver y triar investigaciones, revisar los veredictos de la AI, decidir, aprobar propuestas de alcance estándar (standard-blast), usar el chat.
- **authorize risk**: todo lo que operate puede hacer, más declarar engagements de pentest, curar hechos de autorización y aprobar acciones de alto alcance (high-blast) que escriben en un sistema externo.
- **configure**: todo lo que el manager puede hacer, más los ajustes que ese rol controla, y la gestión de usuarios.

Un nivel superior posee todas las capacidades del nivel inferior. El lado del tenant agrega un nivel más por debajo de operate, un stakeholder de solo lectura (`customer_viewer`) que puede ver pero no actuar; el lado del MSSP no tiene equivalente, ya que su rol más bajo (`analyst`) ya opera.

La audiencia es un muro aparte por encima de los niveles. Los roles del MSSP poseen solo capacidades del MSSP y los roles de tenant poseen solo capacidades de tenant; los dos conjuntos nunca se solapan. Un guard de capacidad verifica la capacidad y la audiencia en conjunto, de modo que una capacidad del MSSP nunca puede satisfacer una ruta de tenant ni viceversa. Por eso `platform_admin`, por ejemplo, posee todas las capacidades del MSSP pero ninguna de las de tenant.

## Catálogo de roles

**Lado MSSP** (personal del proveedor; `tenant_id` es null):

| Rol | Nivel | Puede hacer |
|---|---|---|
| `platform_admin` | configure (super) | Toda capacidad del MSSP, a nivel de toda la instalación. |
| `mssp_admin` | configure | Configurar el sistema, gestionar usuarios, más todo lo inferior. |
| `mssp_manager` | authorize risk | Declarar engagements, curar hechos de autorización, aprobar acciones de alto alcance (high-blast), más operate. |
| `analyst` | operate | Triar investigaciones, revisar veredictos, decidir, chatear. Trabaja con un cliente a la vez fijando un tenant (ver Suplantación más abajo); solo lectura en los ajustes. |

**Lado tenant** (personal de un cliente; `tenant_id` establecido; acotado a ese único tenant):

| Rol | Nivel | Puede hacer |
|---|---|---|
| `tenant_admin` | configure | Gestionar los usuarios de su propia organización y sus propios ajustes de LLM, más todo lo inferior. Aprovisionado automáticamente durante el onboarding del tenant por el flujo `_mint_tenant_admin_user` del runtime. |
| `tenant_manager` | authorize risk | Declarar sus propios engagements de pentest, afirmar hechos de autorización (que quedan pendientes de revisión del MSSP antes de surtir efecto), aprobar acciones de alto alcance (high-blast), más operate. |
| `tenant_analyst` | operate | Trabajar el SOC de su propio tenant: triar, revisar veredictos, decidir, aprobar propuestas de alcance estándar (standard-blast), chatear. Este es el rol de SOC cogestionado, el reflejo del lado tenant de `analyst`. |
| `customer_viewer` | view only | Stakeholder de solo lectura. Ve el dashboard del SOC y las investigaciones propias del cliente, pero no puede actuar sobre ellas ni abrir la cola de revisión. |

El nivel "configure" de `tenant_admin` es acotado: por encima del manager agrega la configuración de LLM de su propia organización y la gestión de usuarios, y nada más. El branding y las integraciones permanecen en el lado del MSSP.

El administrador inicial se crea de forma inline por el comando de init del pod de la API (impulsado por `install.bootstrapAdmin.email` e `install.bootstrapAdmin.password` en los valores del chart) como un `mssp_admin` con `must_change=false`. El [asistente de configuración](/es-419/setup-wizard) rellena esos valores durante el primer arranque.

## La distinción entre customer-viewer y tenant-analyst

`customer_viewer` y `tenant_analyst` son ambos del lado tenant, pero son trabajos diferentes. `customer_viewer` observa: dashboards y estado de investigaciones, nada más. No puede decidir revisiones, usar el chat ni listar la cola de revisiones pendientes. `tenant_analyst` opera: ejecuta el propio SOC del cliente sobre las alertas de su propio tenant. Asigna viewers a las personas que necesitan visibilidad y analysts a las personas que hacen el trabajo.

La cola de revisiones pendientes se controla en consecuencia. Listar o abrir una revisión requiere autoridad de revisión, que poseen el `analyst` del MSSP y superiores, y el `tenant_analyst` y superiores. Un operador de tenant ve solo la cola de su propio tenant. Las lecturas de revisión entre tenants están limitadas a `platform_admin`, `mssp_admin` y `mssp_manager`; un `analyst` del MSSP lee la cola de un tenant una vez que está fijado a él.

## Crear usuarios de tenant

Un `tenant_admin` aprovisiona los inicios de sesión de su propia organización. Esto es lo que hace utilizables los roles de tenant; sin ello, un tenant solo tendría el único administrador creado en el onboarding.

En la UI del cliente, abre **Users** en la barra lateral (visible solo para `tenant_admin`), luego **Add user**: ingresa un correo, elige un rol y envía. El panel devuelve una contraseña temporal de un solo uso. Cópiala y entrégala al usuario por un canal aparte; se muestra una sola vez y nunca es recuperable en texto plano. Se le pide al usuario que la cambie en el primer inicio de sesión.

Lo mismo está disponible en la API:

```bash
curl -X POST 'https://<customer-host>/api/tenant/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@customer.example","role":"tenant_analyst"}'
```

Notas:

- Los roles asignables son `customer_viewer`, `tenant_analyst`, `tenant_manager` y `tenant_admin`. Un rol del MSSP no puede asignarse aquí; la solicitud se rechaza. Este es el muro de audiencia.
- El nuevo usuario siempre se coloca en el propio tenant del que hace la llamada. El tenant se toma de la sesión de quien llama, nunca del cuerpo de la solicitud, y la base de datos lo impone, de modo que un administrador de tenant solo puede crear usuarios en su propio tenant.
- Un correo duplicado se rechaza. Los correos son únicos en toda la instalación.
- `GET /api/tenant/users` lista los usuarios propios del tenant. Ambos endpoints requieren la capacidad `tenant_manage_users`, que solo posee `tenant_admin`.

El portal del cliente se accede en un host por tenant. El nombre de host fijo proviene de `ingress.hostnames.customer` en los valores del chart, y los hosts por tenant basados en slug provienen de `ingress.tenantWildcard`. Consulta la [documentación de instalación](/es-419/install) para el esquema de nombres de host.

## Crear usuarios del personal del MSSP

Un `mssp_admin` o `platform_admin` aprovisiona los inicios de sesión del personal del MSSP desde el panel **Staff Users** en la [UI del MSSP](/es-419/mssp-ui), o en la API. La forma refleja la del lado tenant.

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@your-mssp.example","role":"analyst"}'
```

Notas:

- Los roles asignables son `analyst`, `mssp_manager`, `mssp_admin` y `platform_admin`. Un rol de tenant no puede asignarse aquí (el muro de audiencia). Asignar `platform_admin` solo se permite si quien hace la llamada ya es un `platform_admin`.
- El nuevo usuario es del lado MSSP (`tenant_id` es null). Estos endpoints solo operan sobre filas de personal del MSSP, de modo que un usuario de tenant nunca puede alcanzarse a través de ellos.
- La respuesta lleva una contraseña temporal de un solo uso; el usuario la cambia en el primer inicio de sesión. Un correo duplicado se rechaza.
- `GET /api/mssp/users` lista al personal. Todos estos requieren la capacidad `manage_users`, que poseen solo `mssp_admin` y `platform_admin`.

`soctalk-auth set-password` (la CLI) todavía existe para los casos de bootstrap y offline: establece una contraseña para un usuario existente, limpia `must_change` y audita el cambio, pero no crea la fila del usuario ni revoca sesiones.

## Cambiar un rol, desactivar, reactivar

Ambos lados exponen el mismo ciclo de vida. En el lado tenant un `tenant_admin` gestiona su propia organización; en el lado MSSP un `mssp_admin`/`platform_admin` gestiona al personal.

- **Cambiar un rol**: elige un nuevo rol desde el selector de la fila, o `PATCH /api/tenant/users/{id}` (o `/api/mssp/users/{id}`) con `{"role": "..."}`. Un cambio de rol revoca las sesiones activas del usuario para que el nuevo rol surta efecto de inmediato.
- **Desactivar**: el botón Deactivate de la fila, o `POST .../{id}/deactivate`. El usuario se establece como inactivo y todas las sesiones activas se revocan a la vez, de modo que un usuario ya conectado queda cortado en lugar de persistir hasta la expiración. El middleware de sesión también rechaza a un usuario inactivo, lo que cierra la carrera con un inicio de sesión concurrente.
- **Reactivar**: el botón Reactivate de la fila, o `PATCH .../{id}` con `{"active": true}`.

Dos guards aplican a cada cambio:

- No puedes modificar tu propia cuenta (sin autodegradación ni autobloqueo).
- No puedes eliminar al último administrador activo: el cambio que dejaría a un tenant sin ningún `tenant_admin` activo, o a la instalación sin ningún `mssp_admin`/`platform_admin` activo (o sin ningún `platform_admin` activo cuando existe uno), se rechaza. La verificación bloquea las filas candidatas, de modo que degradaciones concurrentes no puedan colarse ambas.

Una cuenta `platform_admin` existente solo puede ser cambiada, desactivada o tener su contraseña restablecida por otro `platform_admin`.

## Restablecimiento de contraseña

**Autoservicio**: no implementado en esta versión. No hay flujo de olvido de contraseña ni entrega de correo en la página de inicio de sesión. Los usuarios piden a un administrador que la restablezca.

**Forzado por administrador**: un `mssp_admin` o `platform_admin` restablece la contraseña de cualquier usuario por id:

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

El destino puede ser un usuario del MSSP o un usuario de tenant; el actor debe ser `mssp_admin` o `platform_admin`. La respuesta contiene una nueva `temporary_password` marcada con `must_change=true`, y el restablecimiento revoca todas las sesiones existentes de ese usuario. Comparte la contraseña; el usuario elige una nueva en el primer inicio de sesión.

No hay una acción de restablecimiento del lado tenant, de modo que un `tenant_admin` no puede restablecer la contraseña de uno de sus propios usuarios desde la UI. Hasta que eso llegue, un administrador del MSSP la restablece con el endpoint anterior, o un operador la restablece en la fila de la base de datos.

## Suplantación y cambio de contexto de tenant

Los usuarios del lado MSSP (`platform_admin`, `mssp_admin`, `mssp_manager`, `analyst`) pueden acotar su sesión a un tenant específico mediante `POST /api/auth/assume-tenant`. Los usuarios del lado tenant no pueden; ya están fijados a su propio tenant. La UI expone esto como el chip **Tenant: \<name\>** en la esquina superior derecha de la [UI del MSSP](/es-419/mssp-ui): al hacer clic en un tenant se fija la sesión a la vista de ese cliente, y **Clear** vuelve al alcance entre tenants. Las acciones que cambian el estado tomadas durante ese alcance se ejecutan como el usuario original con la sesión vinculada a ese tenant.

Esto no es suplantación de un usuario diferente; la identidad de la sesión permanece igual. Está planificada una superficie de "tomar el control de la sesión de un usuario específico".

## Sesiones

| Almacenamiento de sesión | Nombre de cookie | Duración |
|---|---|---|
| Sesión de la UI del MSSP | `soctalk_session` | 12 h absolutas + 30 min de inactividad |
| Sesión del portal de cliente | `soctalk_session` | 12 h absolutas + 30 min de inactividad |
| Sesión del asistente | `soctalk_session` | hasta que el asistente sale |

`POST /api/auth/logout` revoca solo la sesión actual. Desactivar un usuario de tenant, y restablecer la contraseña de cualquier usuario, revocan todas las sesiones de ese usuario. Para revocar todas las sesiones de un usuario del MSSP sin un restablecimiento de contraseña, establece `revoked_at` directamente en sus filas `sessions` en Postgres; todavía no hay una API de administrador para eso. Rotar la clave de firma JWT no revoca las sesiones de cookie respaldadas por la base de datos; la búsqueda se hace sobre la fila de la base de datos, no sobre la firma del JWT.

Está planificado un inventario de sesiones de solo lectura (`GET /api/auth/sessions`).

## SSO / autenticación por proxy

El runtime admite `SOCTALK_AUTH_MODE=proxy`, donde SocTalk confía en un proxy OIDC upstream (OAuth2-Proxy, Keycloak, Dex) para autenticar la solicitud. La identidad se resuelve a partir del encabezado `X-Forwarded-Email`, emparejado por correo con una fila de usuario existente. El modo de autenticación en sí no se expone hoy como una perilla de valores del chart; establece la variable de entorno directamente en el Deployment `soctalk-system-api` después de la instalación. Los CIDR de proxy de confianza están respaldados por el chart mediante `oidc.trustedProxyCIDRs`.

En modo proxy el router de autenticación basada en contraseña no se monta en absoluto, de modo que `/api/auth/login`, `/api/auth/password/change`, el restablecimiento de contraseña por administrador, y también `/api/auth/me`, `/api/auth/logout` y `/api/auth/assume-tenant` están ausentes. El init de bootstrap del chart todavía siembra la fila Organization y, si `install.bootstrapAdmin.password` está establecido, el usuario `mssp_admin`. Sigue estableciendo `bootstrapAdmin` incluso en modo proxy: el aprovisionamiento de usuarios justo a tiempo en la primera solicitud autenticada no está implementado, de modo que sin un usuario sembrado emparejado por correo con tu identidad de IdP, ninguna solicitud autenticada por proxy puede resolverse a una fila de usuario.

La asignación de roles en modo proxy ocurre en la creación del usuario en la base de datos. El runtime confía en el correo reenviado para la identidad pero no lee encabezados de grupo ni auto-promueve según la pertenencia a grupos. Está planificado un mapeo configurable de grupo de IdP a rol de SocTalk.

Detalles completos: [Autenticación interna](/es-419/reference/internal-auth).

## Auditoría

La creación de usuarios, los cambios de rol/estado y la desactivación escriben filas `user.create`, `user.update` y `user.delete` en el registro de auditoría (con el rol y el estado activo antes/después en las actualizaciones), y los restablecimientos de contraseña también se auditan. Ten en cuenta que la vista actual de `/api/audit` en la UI lee el flujo de eventos de investigación, no la tabla `audit_log`, de modo que estas filas de gestión de usuarios se pueden consultar directamente en `audit_log` pero todavía no aparecen en esa pantalla.
