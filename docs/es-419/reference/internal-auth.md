# Autenticación interna

## 1. Alcance

Agrega una ruta de inicio de sesión autónoma para las UIs propias de
SocTalk, de modo que los operadores puedan funcionar sin un proxy OIDC
externo. La autorización existente (roles, `tenant_id`, decoradores en
`src/soctalk/core/tenancy/decorators.py:120`, RLS de Postgres) no cambia.
Esta especificación solo agrega una nueva fuente de identidad que produce
la misma forma de `UserIdentity` que ya se consume en
`src/soctalk/core/tenancy/auth.py:67`.

Dos modos, seleccionados al arranque del proceso y expuestos en `/health/live` y `/health/ready`:

```
SOCTALK_AUTH_MODE = internal | proxy
```

- `internal` (predeterminado para instalaciones nuevas): SocTalk gestiona
  el inicio de sesión, las sesiones y el almacenamiento de contraseñas. El
  middleware de traspaso de ingress queda deshabilitado.
- `proxy`: preserva el comportamiento existente de traspaso de ingress.
  Los endpoints internos responden con 404.

Sin modo híbrido. La federación (aprovisionamiento JIT, OIDC SP, etc.) es
una especificación aparte.

## 2. Modelo de datos

Dos tablas nuevas. Todo lo demás reutiliza los modelos existentes.

### `password_credentials`

| columna              | tipo        | notas                                       |
| ---                  | ---         | ---                                         |
| user_id              | uuid PK, FK | referencia a `users.id`, borrado en cascada |
| password_hash        | text NOT NULL | argon2id, cadena de hash completa con parámetros |
| must_change          | bool        | establecido por reinicio del admin          |
| updated_at           | timestamptz |                                             |
| last_used_at         | timestamptz | último inicio de sesión exitoso             |
| consecutive_failures | int         | se reinicia al tener éxito                   |
| locked_until         | timestamptz | null salvo que el bloqueo esté activo        |

### `sessions`

Sesiones respaldadas en la base de datos. La cookie lleva un session_id
opaco; la fila de la base de datos es la fuente de verdad.

| columna         | tipo        | notas                                |
| ---             | ---         | ---                                  |
| id              | uuid PK     | también el valor de la cookie         |
| user_id         | uuid FK     |                                      |
| tenant_context  | uuid        | `current_tenant` capturado al iniciar sesión |
| created_at      | timestamptz |                                      |
| last_seen_at    | timestamptz | actualizado con limitación (~60s)     |
| absolute_expiry | timestamptz | tope máximo, 12h                      |
| idle_expiry     | timestamptz | se desliza con la actividad, 30m      |
| revoked_at      | timestamptz | un valor no nulo deshabilita la sesión |
| ip_created      | inet        | observabilidad                        |
| user_agent      | text        | observabilidad                        |

Índice: `(user_id, revoked_at)`.

### Reutilización

- `users` (`src/soctalk/core/tenancy/models.py:156`) — sin cambios.
- `audit_log` (`src/soctalk/core/tenancy/models.py:291`) — recibe
  acciones `auth.*` (ver §9).

Sin nueva tabla de auditoría. Sin tabla de claves de firma (las sesiones
son filas opacas en la base de datos, no JWTs; la firma HMAC existente en
`src/soctalk/core/tenancy/auth.py:167` no está relacionada).

## 3. Endpoints

Todos bajo `/api/auth/*`. JSON. Las rutas que cambian el estado están
protegidas según §6.

| método | ruta                                          | propósito                              |
| ---    | ---                                           | ---                                    |
| POST   | `/api/auth/login`                             | email + contraseña, fija la cookie de sesión |
| POST   | `/api/auth/logout`                            | revoca la sesión actual                |
| GET    | `/api/auth/me`                                | devuelve el payload de identidad actual |
| POST   | `/api/auth/password/change`                   | antigua + nueva, autenticado           |
| POST   | `/api/mssp/users/{id}/password/reset`         | reinicio forzado por el admin, fija `must_change` |

El endpoint de reinicio del admin genera una contraseña aleatoria fuerte
del lado del servidor y la devuelve una sola vez en el cuerpo de la
respuesta; el admin la entrega al usuario por un canal alterno. El
reinicio de autoservicio basado en email se difiere (§12).

En `AUTH_MODE=proxy`, todos los endpoints de esta tabla responden con 404.

## 4. Cookie y sesión

### Cookie

Nombre: `soctalk_session`.

Atributos:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- `Domain` omitido (solo host)
- `Max-Age` coincide con el `absolute_expiry` de la sesión

Valor: base64 seguro para URL del UUID de la sesión. Sin claims en la
cookie.

### Ciclo de vida

- `absolute_expiry = created_at + 12h`. Tope máximo.
- `idle_expiry = last_seen_at + 30m`. Se desliza hacia adelante con la
  actividad.
- Al cambiar la contraseña: se revocan todas las demás sesiones del
  usuario; la sesión que realizó el cambio se preserva para que el
  usuario siga con la sesión iniciada en su dispositivo actual.
- `/api/auth/logout` revoca únicamente la sesión actual.
- El reinicio del admin revoca todas las sesiones del usuario objetivo.

## 5. Política de contraseñas

- argon2id mediante `argon2-cffi`.
- Parámetros: `time_cost=3`, `memory_cost=65536` (64 MiB),
  `parallelism=4`, `hash_len=32`, `salt_len=16`.
- La cadena de hash almacenada contiene sus parámetros; verifica y
  vuelve a generar el hash de forma transparente cuando los parámetros
  cambian.
- Longitud mínima: 12. Sin reglas de composición.
- Bloqueo: 10 fallos consecutivos en 15 min fijan `locked_until = now() + 15m`. El contador se reinicia con un inicio de sesión exitoso.
- `must_change`: establecido por el reinicio del admin. Obliga al usuario
  a pasar por el flujo de cambio de contraseña antes de cualquier otro
  endpoint.

## 6. CSRF

`SameSite=Lax` en la cookie de sesión ya bloquea los POST entre sitios.
Para los métodos que cambian el estado (`POST`, `PATCH`, `DELETE`, `PUT`),
el middleware además exige:

- Si `Origin` está presente, debe coincidir con uno de los orígenes
  propios configurados. La configuración es una lista/patrón, no un valor
  único, porque las instalaciones sirven tanto el host MSSP
  (`mssp.example.com`) como un host de cliente por tenant con comodín
  (`*.customers.example.com`). Fijar un solo origen daría 403 a cada POST
  proveniente de la UI que no sea la fijada.
- De lo contrario, si `Referer` está presente, su componente de origen
  debe coincidir con la misma lista de permitidos.
- De lo contrario, rechazar con 403.

La lista de permitidos se deriva de los nombres de host de UI
configurados en los valores del chart (`ingress.hostnames.mssp`,
`ingress.hostnames.customer`), de modo que los operadores no la mantienen
por separado.

## 7. Middleware

Un nuevo middleware `internal_session_middleware` reemplaza a
`ingress_handoff_middleware` cuando `SOCTALK_AUTH_MODE=internal`.

Por solicitud:

1. Leer la cookie `soctalk_session`.
2. Buscar la fila de la sesión. Rechazar si falta, está revocada,
   sobrepasó `absolute_expiry` o sobrepasó `idle_expiry`.
3. Actualizar `last_seen_at` (con limitación: escribir a lo sumo cada 60s).
4. Cargar el usuario y construir la misma forma de `UserIdentity` que
   produce la ruta. Establecer `request.state.user_identity` exactamente
   como hoy, de modo que los decoradores y los helpers de contexto RLS
   queden intactos.

Limitación de tasa: intentos de inicio de sesión por IP y por email cada
15 minutos, aplicada antes de la búsqueda en la base de datos. Contador
en proceso para la beta; se cambia por Redis cuando necesitemos escalar
horizontalmente.

## 8. UI/UX

Dos UIs propias ganan funcionalidades de autenticación: la consola MSSP
(`frontend/mssp`) y el portal de clientes (`frontend/customer`). Ambas
son aplicaciones SvelteKit que hablan con la misma API.

### Página de inicio de sesión

Ambas aplicaciones ganan `/login`:

- Tarjeta centrada. Dos campos (Email, Contraseña). Un solo botón
  primario etiquetado "Iniciar sesión".
- El portal de clientes lee el nombre de la aplicación y el logo desde el
  `BrandingConfig` del tenant, para que la página se sienta nativa a la
  marca del MSSP. La consola MSSP usa la marca predeterminada a nivel de
  instalación.
- Foco inicial en Email. Enter envía. Nombres de campo estándar para que
  los gestores de contraseñas del navegador autocompleten sin problemas.
- Estados de error (sin enumeración de usuarios):
  - Credenciales inválidas → "El email o la contraseña son incorrectos."
  - Cuenta bloqueada → "Esta cuenta está bloqueada temporalmente.
    Vuelve a intentarlo a las {unlock_time}."
  - Error del servidor → "Algo salió mal. Vuelve a intentarlo."
- Pequeña línea de utilidad debajo: "Contacta a tu administrador si
  perdiste el acceso." Sin enlace de reinicio de autoservicio en esta
  especificación.

### Cambio forzado (`must_change`)

Cuando el inicio de sesión tiene éxito contra una credencial con
`must_change=true`, la respuesta del servidor señala el cambio como el
siguiente paso. La UI navega directamente a `/account/password` — sin
destello del dashboard.

Mientras `must_change` esté activo, cualquier ruta excepto
`/account/password` y `POST /api/auth/logout` redirige de vuelta a
`/account/password`. Un pequeño banner ámbar dice "Tu administrador
requiere que establezcas una nueva contraseña antes de continuar."

### Página de cambio de contraseña

`/account/password`:

- Tres campos: Contraseña actual, Nueva contraseña, Confirmar nueva
  contraseña.
- Validador en línea solo para la regla de longitud ≥12. Sin medidor de
  composición.
- Al tener éxito, mostrar una confirmación y la nota "Se ha cerrado la
  sesión en los demás dispositivos. Sigues con la sesión iniciada aquí."
- Accesible desde el menú de la cuenta y obligatoria durante
  `must_change`.

### Menú de la cuenta

En el encabezado de ambas aplicaciones, visible cuando se está
autenticado:

- Email del usuario.
- Etiqueta de rol ("MSSP admin", "Analyst", "Customer viewer", etc.).
- Enlace a "Cambiar contraseña".
- "Cerrar sesión" — `POST /api/auth/logout`, luego navegar a `/login` con
  un mensaje flash "Se ha cerrado tu sesión."

### Reinicio por el admin (consola MSSP)

En la página de detalle del usuario en la consola MSSP:

- Botón "Reiniciar contraseña", restringido por permiso a `platform_admin`
  y `mssp_admin`.
- El modal de confirmación explica: "Genera una contraseña de un solo uso,
  revoca todas las sesiones activas de este usuario y lo obliga a cambiarla
  en el próximo inicio de sesión."
- Al confirmar, el servidor devuelve la contraseña generada una sola vez.
  La UI la muestra en un campo con copiado al portapapeles con "Copiar y
  cerrar". Después de que el modal se cierra, la contraseña ya no se puede
  recuperar — el admin la comparte por un canal alterno.

### Expiración de la sesión

- Ante cualquier 401 devuelto a una sesión autenticada, la SPA navega a
  `/login?expired=1&next=<current-url>`.
- La página de inicio de sesión lee `expired=1` y muestra "Tu sesión
  expiró. Vuelve a iniciar sesión." La UI no distingue entre expiración
  absoluta e inactiva.
- Tras iniciar sesión con éxito, la SPA navega a `next` si está presente
  y es del mismo origen; de lo contrario, a la ruta de aterrizaje
  predeterminada de esa UI.

### Estados vacíos y de error

- Primera carga sin sesión → redirigir a `/login` (sin flash).
- Página de inicio de sesión estando ya autenticado → redirigir a la ruta
  de aterrizaje predeterminada (no dejar al usuario varado en un
  formulario que no necesita).
- Errores de red durante el inicio de sesión → mantener el formulario,
  mostrar en línea "No se pudo contactar al servidor. Revisa tu conexión
  y vuelve a intentarlo."

### Accesibilidad

- Todas las entradas tienen elementos `<label>` asociados. Los errores
  usan `role="alert"` para que los lectores de pantalla los anuncien.
- El orden de foco es natural (email → contraseña → enviar).
- Sin CAPTCHA. El bloqueo más la limitación de tasa por IP/email cubren el
  abuso a escala MSSP; el CAPTCHA rompe el flujo de los lectores de
  pantalla y agrega sobrecarga operativa.
- Objetivo táctil mínimo de 44×44px para la acción primaria en móvil.

## 9. Auditoría

Emitir los siguientes valores de `action` en el `audit_log` existente:

- `auth.login.success`
- `auth.login.failure` (`details.reason` en `{bad_password, unknown_email, locked}`)
- `auth.logout`
- `auth.password.changed`
- `auth.password.reset.admin` (reinicio de otro usuario activado por el admin)
- `auth.lockout.triggered`

`actor_id` es el id del usuario que actúa, o `system:auth` para los
disparadores de bloqueo. `tenant_id` se copia del usuario que actúa.

## 10. Migración de `proxy` a `internal`

1. Aplicar la migración que crea §2.1 y §2.2. Las filas existentes de
   `users` no se ven afectadas.
2. Desplegar la nueva versión de la aplicación. `SOCTALK_AUTH_MODE=proxy`
   preserva el comportamiento existente.
3. Para cada usuario que se espera que use el inicio de sesión interno, el
   operador ejecuta `soctalk auth set-password <email>` (nuevo CLI;
   escribe una fila en `password_credentials` y emite
   `auth.password.reset.admin`).
4. El operador cambia `SOCTALK_AUTH_MODE=internal` y reinicia. El
   middleware de traspaso de ingress se elimina del pipeline.

Reversión: volver a cambiar el flag y reiniciar.

## 11. Pruebas

Suite obligatoria de backend (estilo postgres-rls §9):

1. La ruta feliz de inicio de sesión crea una fila de sesión con el
   `tenant_context` correcto y fija la cookie.
2. Una contraseña incorrecta incrementa `consecutive_failures`; diez
   consecutivas disparan `locked_until`; los intentos posteriores se
   rechazan incluso con la contraseña correcta.
3. `must_change` bloquea todos los endpoints que no sean de contraseña
   hasta un cambio exitoso.
4. El cambio de contraseña revoca todas las demás sesiones del usuario
   pero preserva la actual.
5. El cierre de sesión revoca únicamente la sesión actual.
6. El reinicio del admin revoca todas las sesiones del usuario objetivo y
   fuerza `must_change`.
7. `AUTH_MODE=proxy`: `/api/auth/*` y el endpoint de reinicio del admin
   devuelven 404. La ruta de traspaso de ingress sigue funcionando.
8. CSRF: una solicitud que cambia el estado con un `Origin` ajeno se
   rechaza con 403.
9. Una sesión que sobrepasó `absolute_expiry` o `idle_expiry` se rechaza;
   la fila no se elimina automáticamente (se retiene para auditoría).

Suite de humo de Playwright para cada UI:

1. Iniciar sesión con credenciales válidas aterriza en la ruta
   predeterminada y muestra el menú de la cuenta.
2. Iniciar sesión con credenciales incorrectas muestra el error genérico
   sin enumerar.
3. `must_change` en el inicio de sesión aterriza en la página de cambio y
   no puede navegar a otro lado.
4. El cambio de contraseña tiene éxito y mantiene la sesión iniciada.
5. El modal de reinicio del admin muestra la contraseña generada una sola
   vez; al cerrar el modal se oculta.
6. Una sesión expirada en una ruta protegida enruta a `/login?expired=1`
   con el flash y preserva `next`.

## 12. Diferido

No forma parte de esta especificación. Ordenado por probabilidad de
reincorporación:

1. `password_reset_tokens` — reinicio de contraseña de autoservicio
   basado en email.
2. MFA (TOTP + códigos de recuperación), con los pasos de UI
   correspondientes en los flujos de inicio de sesión y de cuenta.
3. Inventario de sesiones (`GET /api/auth/sessions`, revocación
   específica, cierre de todas), con un panel "Dispositivos" en la página
   de la cuenta.
4. Suplantación (mssp_admin → sesiones de usuario del tenant), con un
   banner claro en la UI mientras se suplanta.
5. OIDC SP / federación (especificación aparte).
6. Emisor OIDC (especificación aparte; solo si aparece un consumidor
   concreto).
7. Rotación de claves de firma + JWKS (solo necesario una vez que
   emitamos tokens sin estado externamente).
