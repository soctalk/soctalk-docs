---
description: "Incorpore un tenant de cliente de punta a punta en SocTalk: elija un perfil, ejecute el asistente Create Customer, observe cómo el aprovisionamiento llega a active, conecte los endpoints del cliente y entregue los accesos."
---

# Onboarding de un tenant

El onboarding convierte a un cliente en un SOC de tenant aislado en su plano de control. Cada tenant recibe su propio namespace de Kubernetes (`tenant-<slug>`) con sus propios secrets, presupuesto de recursos y (para los perfiles `poc` y `persistent`) un manager, un indexer y un dashboard de Wazuh dedicados. Esta página recorre todo el camino que sigue un administrador del MSSP en la UI, desde la primera decisión hasta el momento en que los analistas del cliente pueden abrir su SOC.

Para la visión conceptual (dimensionamiento, los cuatro trabajos, línea base de la primera semana), consulte la [guía de checklist de onboarding](/es-419/guides/wazuh-tenant-onboarding). Para la máquina de estados y los detalles internos de los perfiles, consulte [Ciclo de vida del tenant](/es-419/tenant-lifecycle). Esta página es el recorrido para el operador.

## Antes de empezar

- Su plano de control está instalado y puede iniciar sesión como administrador del MSSP. Si aún no está levantado, primero siga [Instalación de producción](/es-419/install) o el [inicio rápido de la VM de demostración](/es-419/quickstart-vm).
- Ha decidido el perfil del tenant. Queda fijo durante toda la vida del tenant, así que lea la siguiente sección antes de hacer clic en **New tenant**.
- Solo para un tenant `provided`, reúna fuera de banda el material de conexión al Wazuh existente del cliente antes de abrir el asistente: la URL del Indexer con un usuario y contraseña de autenticación Basic, la URL de la Manager API con un usuario y contraseña, y las credenciales de LLM por tenant. El asistente se bloquea en estos datos, así que reunirlos primero evita dejar un formulario a medio llenar. Consulte [Coordinación de credenciales de Wazuh externo](/es-419/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Elegir un perfil

El perfil se elige una vez y queda fijo. Cambiarlo más tarde implica dar de baja y volver a incorporar, así que elija con cuidado.

- **`poc`** es para evaluaciones y pilotos de corta duración. El chart del tenant instala Wazuh más un simulador linux-ep con almacenamiento `local-path` y presupuestos de recursos ajustados. Es también el valor por defecto si no especifica ninguno, y `local-path` no ofrece ninguna garantía de persistencia, así que es la elección equivocada para un cliente real.
- **`persistent`** es para SOCs de clientes en producción. La misma forma con Wazuh incluido que `poc`, pero dimensionada para carga sostenida sobre la StorageClass por defecto del clúster, con los rangos completos de recursos del chart y los hooks de backup respetados donde estén configurados.
- **`provided`** es para un cliente que ya ejecuta Wazuh (traiga su propio SIEM). El chart instala únicamente el adaptador de SocTalk y el runs-worker; SocTalk alcanza por red el indexer y la Manager API del cliente. El material de conexión externa y las credenciales de LLM por tenant son obligatorios en el momento del onboarding.

Planifique aproximadamente de 6 a 8 GB de RAM y alrededor de 1.5 vCPU por tenant `persistent`; el indexer de Wazuh por tenant suele ser el cuello de botella. Los detalles de capacidad están en [Dimensionamiento](/es-419/reference/sizing), y cada perfil se amplía en [Ciclo de vida del tenant](/es-419/tenant-lifecycle#profiles).

## Ejecutar el asistente Create Customer

En el dashboard del MSSP, haga clic en **Tenants** en la barra izquierda, luego en **New tenant** en la parte superior de la lista. Esto abre el asistente **Create Customer**. Son cuatro pasos para `poc` y `persistent` (Identity, Profile, Branding, Review) y cinco para `provided`, donde aparece un paso External SIEM entre Profile y Branding.

### Paso 1: Identity

- **Display name**, por ejemplo `Acme Corp`.
- **Slug**: corto, en minúsculas, separado por guiones, de 3 a 32 caracteres, validado contra `[a-z0-9-]+`. El slug se convierte en el namespace `tenant-<slug>` y se sustituye en identificadores posteriores, así que elíjalo con cuidado. En un piloto de tailnet debe coincidir con la etiqueta de Tailscale del tenant.
- **Contact email**.

### Paso 2: Profile

Elija uno de `poc`, `persistent` o `provided`. El mismo paso incluye una divulgación **LLM (advanced)** para sobrescribir el proveedor de LLM compartido de la instalación, la URL base, la clave y, opcionalmente, los IDs de modelo Fast y Thinking. Déjela colapsada en `poc` y `persistent` para heredar los valores por defecto de la instalación. En `provided` las credenciales de LLM son obligatorias y condicionan el paso, porque no hay fallback compartido de la instalación para ese perfil.

Cambiar el perfil después del aprovisionamiento requiere dar de baja y volver a incorporar, así que confirme la elección antes de continuar.

### Paso 3: External SIEM (solo provided)

Este paso está oculto a menos que haya elegido `provided`. Complete dos pares de endpoint y credencial:

- **Wazuh Indexer URL**, por ejemplo `https://wazuh.acme.example:9200`, con el usuario y contraseña del indexer usados para autenticación Basic.
- **Wazuh Manager API URL**, por ejemplo `https://wazuh.acme.example:55000`, con el usuario y contraseña de API usados para emitir JWTs.

Ambos deben ser alcanzables desde la VM del tenant. El controlador convierte las URLs en una lista de permitidos de salida FQDN de Cilium en el namespace del tenant; el adaptador nunca alcanza Wazuh directamente desde el clúster MSSP. Verifique las credenciales del manager antes de enviar:

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (a long base64 string)
```

Si esto devuelve un token, las herramientas del chat del tenant se resolverán una vez que el plano de datos del tenant esté levantado.

### Paso 4 (o 3 para poc y persistent): Branding

Opcional. Un nombre de visualización y un logo pequeño que aparecen en el encabezado del tenant. Puede saltar este paso por completo.

### Paso final: Review

Confirme todo y haga clic en **Create**. La API responde `202` y lo devuelve a la lista de tenants. El nuevo tenant comienza en `pending` y avanza por `provisioning` hacia `active`.

## Observar cómo el aprovisionamiento llega a active

Abra la página de detalle del tenant y actualícela para seguir la tabla **Lifecycle Events**. El controlador ejecuta nueve fases ordenadas e idempotentes, cada una emitiendo un evento:

1. `preflight_ok`: pasan los prerrequisitos del clúster y los conflictos de nombres.
2. `secrets_minted`: se generan los secrets por tenant (`authd`, firma JWT, Postgres).
3. `namespace_ready`: se crea `tenant-<slug>` con labels, ResourceQuota y LimitRange.
4. `secrets_applied`: los secrets se introducen en el namespace como objetos Secret de Kubernetes.
5. `helm_applied` (chart del tenant): el chart `soctalk-tenant` instala el adaptador, el runs-worker y el ingress. El usuario `tenant_admin` se aprovisiona automáticamente como parte de este paso.
6. `helm_applied` (chart de Wazuh): el chart independiente de Wazuh instala el manager, el indexer y el dashboard. El payload del evento identifica qué chart se aplicó. Esta fase no se ejecuta para los tenants `provided`.
7. `workloads_ready`: todos los pods del plano de datos reportan Ready.
8. `integration_config_written`: se escriben en la base de datos las configuraciones de integración por tenant (LLM, URLs de TheHive).
9. `active`: el tenant transiciona a `active` y está listo para usarse.

Cuando el tenant llega a `active`, use **Open SOC** desde la lista de tenants para entrar en su dashboard.

Si se estanca, la fase que falla se nombra en la tabla de eventos:

- **Atascado en `pending`**: el controlador fue reprogramado antes de la fase 1. El reintento no está permitido directamente desde `pending`; espere a que el intento transicione a `degraded`, luego haga clic en **Retry Provisioning**. El aprovisionamiento se reanuda desde la fase 1.
- **En `provisioning` por más de 15 minutos**: normalmente un pod atascado (ImagePullBackOff, un PVC en `Pending`, o una ResourceQuota demasiado pequeña). Consulte [Operaciones diarias](/es-419/operations#tenant-stuck-in-provisioning).
- **En `degraded`**: falló una fase de aprovisionamiento. Lea la fila del evento para ver cuál, luego **Retry Provisioning**, que es una transición válida desde `degraded`. Más detalle en [Ciclo de vida del tenant](/es-419/tenant-lifecycle#recovery-paths).

## Enrolar los endpoints del cliente

El enrolamiento de endpoints consiste en lograr que las máquinas del cliente reporten al manager de Wazuh del tenant correcto. Aplica a los tenants `poc` y `persistent`, que ejecutan Wazuh dentro de su namespace. Un tenant `provided` ya envía sus endpoints a su propio Wazuh, así que aquí no hay nada que enrolar; salte a la siguiente sección.

El manager de Wazuh de cada tenant escucha en 1514/TCP (eventos) y 1515/TCP (enrolamiento). En esta versión el chart crea ese manager solo como un Service `ClusterIP`: no hay aprovisionamiento automático de LoadBalancer ni de DNS, así que usted cablea el borde por su cuenta (un Service LoadBalancer por tenant, un HAProxy de borde con pares de puertos por tenant en una sola IP, o una ruta de VPN de malla) y administra el registro DNS. La topología completa y los requisitos de firewall están en [Ingreso de agentes Wazuh](/es-419/reference/wazuh-ingress).

El enrolamiento está acotado al tenant por el secreto compartido `authd` del manager. Recupérelo:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Entregue el hostname del manager, los dos puertos y ese secreto al administrador de endpoints del cliente por un canal seguro. Esa persona enrola cada endpoint con:

```bash
agent-auth -m <tenant-manager-hostname> -P "<authd-secret>"
```

Un agente que posee el secreto de un tenant solo puede registrarse en el manager de ese tenant, que es lo que mantiene aislado el enrolamiento. Confirme que los agentes llegaron en el dashboard de Wazuh embebido: Tenants, luego **Open SOC**, luego Agents.

Si en cambio el plano de datos del tenant se ejecuta en infraestructura separada (el modelo de piloto remoto, donde una VM del tenant se une a través de un tailnet), esa VM se registra con el plano de control mediante un flujo de cloud-agent `:issue-agent`, que es algo distinto del enrolamiento de endpoints de arriba. Esa ruta se cubre de punta a punta en el [tutorial del piloto MSSP](/es-419/mssp-pilot#_4-tenant-side-stand-up-the-data-plane).

## Entregar los accesos

El usuario `tenant_admin` se crea automáticamente durante la fase 5, así que el tenant tiene un administrador tan pronto como llega a `active`. Para darle a ese administrador una credencial utilizable, fuerce un reseteo de contraseña desde el lado MSSP (el actor debe ser `mssp_admin` o `platform_admin`):

```bash
curl -X POST 'https://<mssp-host>/api/mssp/users/<user-id>/password/reset' \
  -b jar -H 'Origin: https://<mssp-host>'
```

La respuesta devuelve una `temporary_password` de un solo uso marcada con `must_change=true`, y el reseteo revoca cualquier sesión existente de ese usuario. Comparta esa contraseña junto con la URL del portal del cliente por un canal cifrado de extremo a extremo, como un gestor de contraseñas compartido, nunca por un correo sin cifrar ni un canal de chat público. El administrador del tenant elige una nueva contraseña en el primer inicio de sesión.

A partir de ahí el tenant es de autoservicio: el `tenant_admin` inicia sesión en el portal del cliente, abre **Users** y aprovisiona los propios logins de la organización (por ejemplo `customer_viewer` para interesados de solo lectura). El personal del MSSP y los usuarios del tenant se sitúan en lados opuestos de una frontera de audiencia que aplica el guard de capacidades, de modo que un login de tenant estructuralmente no puede alcanzar superficies cross-tenant. Los roles y esa frontera se describen en [Usuarios y roles](/es-419/users-and-roles).

## Verificar

- El tenant muestra `active` en la lista de tenants, y **Open SOC** carga su dashboard.
- Para `poc` y `persistent`, confirme que los endpoints enrolados aparecen en Open SOC, luego Agents, y que los eventos de ellos llegan al dashboard de Wazuh del tenant.
- Para `provided`, confirme que el pod `soctalk-adapter` está Ready, luego ejecute una consulta respaldada por Wazuh en el chat de SocTalk (por ejemplo, pida las alertas recientes en un host conocido). Se resuelve una vez que el adaptador puede alcanzar los endpoints del SIEM externo del cliente; si no, vuelva a revisar la alcanzabilidad según [Coordinación de credenciales de Wazuh externo](/es-419/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Ver también

- [Checklist de onboarding](/es-419/guides/wazuh-tenant-onboarding) para la visión conceptual y la línea base de la primera semana.
- [Ciclo de vida del tenant](/es-419/tenant-lifecycle) para la máquina de estados, los perfiles, las cuotas y las rutas de recuperación.
- [Recorrido por la UI del MSSP](/es-419/mssp-ui#tenants) para la lista de tenants y las páginas de detalle.
- [Piloto MSSP: hágalo usted mismo](/es-419/mssp-pilot) para el despliegue completo basado en tailnet, incluido el plano de datos del lado del tenant.
