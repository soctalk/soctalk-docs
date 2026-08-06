---
description: "Conecte el triaje con AI de SocTalk a un Wazuh que ya opera: instale desde el paquete del sistema operativo, haga onboarding de un tenant con perfil provided y vea cómo la primera alerta se convierte en un caso triado y escalado."
---

# Conectar SocTalk a un Wazuh existente

La mayoría de las instalaciones de Wazuh no parten de cero. Ya hay un manager vigilando agentes, un indexer que conserva meses de alertas y un dashboard desde el cual el equipo ya investiga. El perfil de tenant `provided` de SocTalk está pensado exactamente para esta situación: SocTalk instala únicamente sus propios componentes, se conecta a su Wazuh por la red y comienza a triar las alertas que su despliegue ya produce. Nada de su Wazuh cambia, ningún agente se vuelve a enrolar y ningún dato migra.

Esta guía recorre todo el camino sobre un único host Linux, desde el paquete del sistema operativo hasta el primer escalamiento triado por AI, y fue verificada de punta a punta contra SocTalk v0.2.0 con Wazuh 4.12.0. Donde esta versión tiene aristas ásperas, la guía lo advierte y ofrece la solución alternativa.

Si en cambio quiere que SocTalk despliegue y administre Wazuh por usted, eso corresponde al perfil `poc` o `persistent`; vea [Onboarding de un tenant de cliente](/es-419/guides/wazuh-tenant-onboarding).

## Lo que necesita antes de empezar

Su Wazuh existente debe ser alcanzable desde el host de SocTalk en dos puertos: la API de OpenSearch del indexer (`:9200`) y la REST API del manager (`:55000`). SocTalk se autentica a cada uno por separado, así que tenga listos ambos pares de credenciales:

- un usuario del indexer con permiso para buscar en `wazuh-alerts-*` (el `admin` incorporado sirve, aunque un usuario de solo lectura es mejor práctica),
- un usuario de la API del manager, como el incorporado `wazuh-wui`.

Los certificados autofirmados del lado de Wazuh son lo habitual y están soportados; pasará `verify_ssl: false` en el momento del onboarding. También necesita una API key de LLM por tenant. El perfil `provided` la exige en el onboarding, porque un tenant que trae su propio SIEM no tiene un fallback compartido por la instalación: la solicitud de onboarding se rechaza con un 422 si falta la clave.

El host de SocTalk en sí necesita el footprint habitual: un Linux basado en systemd (Ubuntu 24.04 y Rocky 9 son el par verificado), 4 vCPU y 8 GB de RAM como piso para el plano de control más un tenant provided, y los puertos 80/443/6443 libres. Como el tenant no corre ningún Wazuh propio, un tenant provided es mucho más liviano que uno `persistent`.

## Instalar SocTalk desde el paquete del sistema operativo

Descargue el paquete para su distribución desde la [página de releases](https://github.com/soctalk/soctalk/releases) e instálelo; la matriz completa de sabores está en [Instalar desde un paquete del sistema operativo](/es-419/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

El paquete incluye una plantilla de entorno en `/etc/soctalk/soctalk.env.example`. Cópiela, complete su identidad de MSSP, credenciales de administrador, hostname y clave de LLM, y manténgala accesible solo para root:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Luego ejecute el instalador de forma desatendida:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Pase `--skip-consent` (o `-y`) de forma explícita. En v0.2.0 el prompt de consentimiento todavía se dispara en una terminal no interactiva aun cuando todas las variables `SOCTALK_*` estén definidas, y sin un TTY la instalación aborta con `/dev/tty: No such device or address`.

El instalador levanta k3s y Helm si el host no los tiene, instala el chart `soctalk-system` fijado a la versión del release e imprime la URL y el login al terminar. Tres pods en el namespace `soctalk-system` (`api`, `app-ui`, `postgres`) indican que el plano de control está activo:

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## Un interruptor antes del onboarding: políticas de red

Aquí está la arista afilada de v0.2.0, por adelantado para que no la choque a mitad del onboarding: un tenant `provided` renderiza una política de egreso FQDN de Cilium para los hosts externos del SIEM, pero el k3s que `soctalk install` configura corre flannel, que no tiene CRDs de Cilium. Aprovisionar un tenant provided sobre una instalación estándar de v0.2.0 por lo tanto falla en el paso de Helm con

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

y el tenant queda en `degraded`. Esto se corrige después de v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): el chart ahora condiciona ese objeto a que el CRD realmente exista y agrega egreso `NetworkPolicy` plano para hosts SIEM con IP literal, de modo que una instalación estándar con flannel aprovisiona limpiamente. En v0.2.0 la solución alternativa en una instalación de un solo host es deshabilitar las políticas de red del tenant antes del onboarding:

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Sea claro respecto al compromiso: esto desactiva las NetworkPolicies de aislamiento de namespace para los tenants aprovisionados después, lo cual es aceptable en un host de laboratorio o piloto dedicado de una sola clase de tenant y no es lo que quiere en un clúster de producción multi-tenant compartido. Si corre Cilium como su CNI, nada de esto aplica y debería dejar las políticas activadas.

Si ya hizo el onboarding y el tenant queda en `degraded` con el error anterior, active el interruptor y presione **Retry Provisioning** en la página del tenant; los reintentos son idempotentes y retoman limpiamente.

Una cosa más específica de un laboratorio de una sola caja, donde el Wazuh "existente" a menudo corre en Docker en el mismísimo host donde instaló SocTalk, alcanzado por la IP propia del host. k3s aplica NetworkPolicy a través de su controlador incorporado, y un pod que alcanza la IP propia del nodo hacia un puerto publicado por Docker es un hairpin que la capa de políticas no enruta limpiamente aun cuando una regla de egreso lo permita. El síntoma es el adaptador registrando `ingest_failed: All connection attempts failed` mientras el mismo Wazuh responde bien desde el host. Deshabilitar las políticas de red del tenant como se muestra arriba lo resuelve. Un Wazuh en un host separado es una ruta de salida ordinaria y no cae en este problema.

## Hacer el onboarding del tenant

En la MSSP UI, Tenants, luego **+ New Tenant**, elija el perfil `provided` y el asistente inserta un paso de SIEM Externo que un tenant PoC o persistent no tiene.

![El paso de Perfil del asistente New Tenant con Provided seleccionado, descrito como trae tu propio Wazuh; la barra de navegación ahora incluye un paso de SIEM Externo](/screenshots/existing-wazuh-profile.png)

Ese paso es donde apunta SocTalk a su Wazuh. El indexer (OpenSearch, puerto 9200) y la API del manager (puerto 55000) se autentican con credenciales separadas, y un tenant provided aporta su propia clave de LLM porque la clave compartida de la instalación MSSP no aplica a este perfil.

![El paso de SIEM Externo del asistente: URL y credenciales del indexer, URL y credenciales de la API del manager, un token de API preacuñado opcional, una casilla Verify TLS certificates para desmarcar en el caso de certificados autofirmados, y la clave de LLM por tenant requerida](/screenshots/existing-wazuh-siem-form.png)

La misma operación por la API es un único POST al endpoint de onboarding. Note la ruta: `POST /api/mssp/tenants/onboard` es el endpoint del asistente que entiende de perfiles y material de SIEM externo. El `POST /api/mssp/tenants` plano es una creación solo de identidad; en v0.2.0 ignora silenciosamente esos campos y lo deja con un tenant `poc` que nunca aprovisiona, así que siempre envíe un onboarding provided a `/onboard`.

```bash
# autentíquese una vez; el cookie jar lleva la sesión MSSP
curl -sk -c cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/auth/login" \
  -d '{"email": "<admin-email>", "password": "<admin-password>"}'

curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/mssp/tenants/onboard" -d '{
  "slug": "orion-soc",
  "display_name": "Orion Labs",
  "profile": "provided",
  "llm_provider": "anthropic",
  "llm_base_url": "https://api.anthropic.com",
  "llm_model": "claude-sonnet-4-6",
  "llm_api_key": "sk-ant-...",
  "external_siem": {
    "indexer_url": "https://198.51.100.20:9200",
    "indexer_username": "admin",
    "indexer_password": "...",
    "api_url": "https://198.51.100.20:55000",
    "api_username": "wazuh-wui",
    "api_password": "...",
    "verify_ssl": false
  }
}'
```

Un 202 con `"profile": "provided"` en el cuerpo confirma la ruta correcta. Elija el slug con cuidado: los slugs quedan reservados por los tenants archivados, así que un tenant de prueba dado de baja no libera su nombre para reutilizarlo.

Aprovisionar un tenant provided es rápido porque no hay chart de Wazuh que instalar; el controlador salta esa fase y registra en su lugar un evento de ciclo de vida `wazuh_skipped_provided`. En la corrida verificada el tenant pasó de `pending` a `active` en menos de veinte segundos.

## Verificar la conexión

El namespace del tenant debería contener exactamente dos cargas de trabajo, el adaptador y el runs-worker, y ningún pod de Wazuh:

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

Su material de conexión aterriza en un Secret local del namespace llamado `tenant-external-siem-creds` que contiene `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` y `WAZUH_API_PASSWORD`, más `WAZUH_API_TOKEN` cuando usted aportó uno. El adaptador lee la URL del indexer de su entorno y las credenciales de ese Secret. Su log le dice en segundos si la conexión funciona, porque sondea continuamente el índice de alertas:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

La página de detalle del tenant muestra lo mismo sin leer logs. El panel de SIEM Externo refleja las URLs del indexer y de la API que usted aportó, y la línea de estado de ingesta del adaptador reporta `reachable` con un conteo de alertas reenviadas una vez que fluyen las primeras alertas.

![La página de detalle del tenant Orion Labs: perfil provided, estado active, un panel de SIEM Externo con las URLs del indexer y de la API, y un estado de ingesta del adaptador reachable con tres alertas reenviadas](/screenshots/existing-wazuh-tenant-detail.png)

Un 401 en el log del adaptador significa que las credenciales del indexer son incorrectas; un error de TLS significa que `verify_ssl` no coincide con su situación de certificados; un timeout significa que el host de SocTalk no puede alcanzar el puerto del indexer.

Las credenciales rotan sin volver a hacer onboarding. `PATCH /api/mssp/tenants/{id}/external-siem` toma cualquier subconjunto de los campos del onboarding, reescribe el Secret y recicla el pod del adaptador para que tome el material fresco:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## La primera alerta triada

De aquí en adelante, el flujo de ingesta, promoción, ejecución de runs y revisión se comporta igual que para un Wazuh administrado por SocTalk (la profundidad del enriquecimiento difiere en v0.2.0, vea Limitaciones actuales): el adaptador reenvía las nuevas alertas iguales o por encima de la severidad mínima (nivel de regla 10 por defecto, configurable con `SOCTALK_ADAPTER_MIN_SEVERITY`), el plano de control promueve lo que importa a investigaciones, y el runs-worker del tenant ejecuta el triaje con AI usando la clave de LLM propia del tenant.

La forma honesta de probar es hacer que su Wazuh existente produzca una alerta real de alta severidad, por ejemplo una ráfaga de inicios de sesión SSH fallidos contra un agente monitoreado seguida de uno exitoso. Si prefiere no tocar endpoints de producción, indexar un documento de alerta sintético directamente en `wazuh-alerts-4.x-<date>` con un `rule.level` de 12 ejercita la ruta idéntica, ya que el adaptador lee del índice y no del manager.

En la corrida verificada, una alerta de fuerza bruta SSH seguida de éxito fue de documento del indexer a triaje terminado en cerca de un minuto: reenviada por el adaptador, promovida, investigada por el supervisor a lo largo de varias llamadas al LLM, y cerrada como `escalate` con 0.95 de confianza, aterrizando en la [cola de revisión MSSP](/es-419/mssp-ui#reviews-human-in-the-loop) para un humano. El gasto total de la corrida fue de cerca de treinta centavos contra la clave de Anthropic del tenant, contabilizado contra el presupuesto de tokens por corrida descrito en [Pipeline de AI](/es-419/ai-pipeline). Después de unas cuantas alertas de prueba de ese tipo, la cola de revisión las mantiene una junto a otra.

![La cola de revisión humana con tres casos Critical, cada uno marcado AI: Escalate y ofreciendo una acción Review](/screenshots/existing-wazuh-review-queue.png)

Cada fila lleva el veredicto de la AI y abre la investigación completa, de modo que un analista confirma o anula sobre la evidencia en lugar de iniciar el triaje por su cuenta.

## Limitaciones actuales

Ambas salvedades a continuación fueron verificadas en v0.2.0 y están corregidas en el release posterior, así que en un build más nuevo puede saltarse las soluciones alternativas. Consulte las notas del release para su versión.

- **Enriquecimiento que alcanza el Wazuh externo (solo v0.2.0).** En v0.2.0 el tooling MCP de Wazuh del runs-worker no estaba cableado a la API del manager de un tenant provided, así que el triaje corría solo sobre el payload de la alerta, sin pivotes en vivo hacia el estado del agente o el historial de logs. Corregido después de v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): el worker ahora conecta el servidor MCP incorporado `mcp-server-wazuh` al Wazuh propio del tenant, de modo que el grafo de triaje consulta agentes, procesos, puertos, vulnerabilidades y logs del manager durante una investigación de la misma forma que lo hace un tenant administrado por SocTalk.
- **Aprovisionamiento sobre una instalación estándar con flannel (solo v0.2.0).** El problema de la política de egreso de Cilium descrito antes, con su solución alternativa de política de red. Corregido después de v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
