# Gestión de usuarios: un recorrido

Este recorrido muestra cómo aprovisionar un inicio de sesión y ejecutar todo su ciclo de vida desde la UI, en ambos lados del negocio: el personal del MSSP desde el panel **Staff Users**, y las propias personas de un cliente desde el panel **Users** del tenant. Los dos paneles se reflejan entre sí, así que una vez que hayas hecho uno, el otro te resultará familiar. Para conocer el modelo detrás de todo esto —qué roles existen y qué puede hacer cada uno—, consulta [Usuarios y roles](/es-419/users-and-roles); esta página es el recorrido paso a paso.

Todo lo que se describe aquí lo realiza un administrador. En el lado del MSSP se trata de un `mssp_admin` o un `platform_admin`. En el lado del tenant es el propio `tenant_admin` de ese cliente, que actúa únicamente dentro de su organización. Ninguno puede cruzar el muro de audiencias: un administrador del MSSP nunca asigna un rol de tenant, y un administrador de tenant nunca asigna uno de MSSP.

## Aprovisionamiento del personal del MSSP

Inicia sesión como administrador del MSSP. El panel que buscas es **Staff Users** en la barra lateral, que solo aparece para una cuenta que tenga la gestión de usuarios.

![La página de inicio de sesión de SocTalk](/screenshots/iam-mssp-01-login.png)

Abre **Staff Users** y elige **+ Add user**. Ingresa el correo de la persona, un nombre para mostrar opcional y elige el rol que corresponda al puesto. Un analista trabaja la cola de todos los clientes, un manager autoriza el riesgo y un administrador configura el sistema y gestiona usuarios. La lista de roles aquí contiene solo roles del MSSP; no se ofrece un rol de tenant, porque no podría asignarse desde este lado.

![Alta de un usuario del personal del MSSP con un rol seleccionado](/screenshots/iam-mssp-02-add-user.png)

Al enviar el formulario se crea el inicio de sesión y se devuelve una contraseña temporal de un solo uso. Cópiala en ese momento y entrégala a la persona por un canal aparte, porque se muestra una única vez y después nunca puede recuperarse en texto plano. Se le pedirá que la cambie en su primer inicio de sesión. El nuevo usuario aparece en el listado debajo del formulario, activo y con el rol que le asignaste.

![La contraseña temporal de un solo uso y el nuevo usuario en el listado](/screenshots/iam-mssp-03-created.png)

## Cambio de un rol

Los roles se cambian en el lugar. Elige un nuevo rol en el selector de la fila de la persona y se guarda de inmediato. Aquí se asciende al analista a manager.

Un cambio de rol revoca las sesiones activas de ese usuario, de modo que la nueva autoridad surte efecto al instante en lugar de esperar a que expire la sesión anterior. Si estaba con la sesión iniciada, su siguiente solicitud lo devuelve al inicio de sesión.

![Ascenso del analista a manager desde el selector de la fila](/screenshots/iam-mssp-04-promoted.png)

## Desactivación y reactivación

**Deactivate** en la fila apaga la cuenta. El estado cambia y toda sesión activa se revoca en ese mismo instante, de modo que alguien que ya tiene la sesión iniciada queda cortado en lugar de permanecer hasta que su sesión caduque por antigüedad. La capa de sesiones también rechaza una cuenta inactiva en cada solicitud, lo que cierra la brecha frente a un inicio de sesión que estuviera en curso cuando la desactivaste.

![El usuario desactivado, ahora con la opción Reactivate disponible](/screenshots/iam-mssp-05-deactivated.png)

La desactivación es reversible. **Reactivate** en la misma fila vuelve a poner la cuenta como activa. Regresa con el rol que tenía; no se pierde nada de su historial.

![El usuario reactivado y de nuevo activo](/screenshots/iam-mssp-06-reactivated.png)

## El lado del tenant, de principio a fin

Un `tenant_admin` ejecuta el mismo ciclo de vida para su propia organización, desde el panel **Users**. Esto es lo que hace que los roles de tenant sean utilizables en absoluto; sin ello, un cliente tendría solo el único administrador creado cuando se dio de alta el tenant. En la parte superior derecha se muestra el tenant en el que estás actuando, y cada usuario que crees queda en ese tenant. El tenant se toma de tu sesión, nunca del formulario, y la base de datos lo aplica, de modo que un administrador de tenant solo puede crear usuarios en su propia organización.

Elige **+ Add user**, ingresa un correo y un nombre opcional, y elige un rol. Las opciones son los roles de tenant: un viewer que solo observa, un analista que opera el SOC, un manager que autoriza el riesgo y un administrador. Aquí se aprovisiona un nuevo analista para Acme Corp.

![Alta de un usuario de tenant desde el panel Users del cliente](/screenshots/iam-tenant-01-add-user.png)

Al igual que en el lado del MSSP, crear el usuario devuelve una contraseña temporal de un solo uso para entregarla por un canal aparte, y el nuevo analista se une al listado.

![El usuario de tenant creado, con su contraseña de un solo uso](/screenshots/iam-tenant-02-created.png)

Los cambios de rol funcionan de la misma manera. Asciende al analista a manager desde el selector de la fila, y el cambio se guarda y sus sesiones se revocan de inmediato.

![Ascenso del analista de tenant a manager](/screenshots/iam-tenant-03-promoted.png)

Deactivate apaga la cuenta y revoca sus sesiones,

![El usuario de tenant desactivado](/screenshots/iam-tenant-04-deactivated.png)

y Reactivate la trae de vuelta.

![El usuario de tenant reactivado](/screenshots/iam-tenant-05-reactivated.png)

## Los guardrails que siempre aplican

Algunas reglas se cumplen en cada cambio, en ambos lados, y la UI las aplica en lugar de confiar en que las recuerdes:

- No puedes modificar tu propia cuenta. No hay autodegradación ni autobloqueo.
- No puedes eliminar al último administrador activo. Se rechaza un cambio que dejaría a un tenant sin ningún `tenant_admin` activo, o a la instalación sin ningún `mssp_admin` o `platform_admin` activo. La comprobación bloquea las filas candidatas, de modo que dos administradores que se degraden mutuamente en el mismo momento no puedan colarse ambos.
- Un `platform_admin` existente solo puede ser modificado, desactivado o tener su contraseña restablecida por otro `platform_admin`.

## Restablecimiento de una contraseña

En esta versión no existe un flujo de "olvidé mi contraseña" de autoservicio. Cuando alguien queda bloqueado, un administrador lo restablece. En el lado del MSSP, un `mssp_admin` o un `platform_admin` restablece a cualquier usuario, sea de MSSP o de tenant, y el restablecimiento devuelve una nueva contraseña de un solo uso y revoca las sesiones existentes de ese usuario. El endpoint exacto y la alternativa por CLI para los casos de arranque inicial y sin conexión están en [Usuarios y roles](/es-419/users-and-roles#password-reset).

## Hacerlo desde la API

Cada acción anterior tiene su equivalente en la API bajo `/api/mssp/users` y `/api/tenant/users`, incluidas la creación, el listado, el cambio de rol, la desactivación y la reactivación. Las formas de las solicitudes, la capacidad que cada una requiere y las reglas de audiencia y de alcance por tenant están documentadas en [Usuarios y roles](/es-419/users-and-roles#creating-tenant-users). La UI es una capa fina sobre esos endpoints, así que cualquier cosa que puedas hacer con un clic también puedes automatizarla.
