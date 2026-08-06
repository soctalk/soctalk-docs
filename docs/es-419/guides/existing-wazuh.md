---
description: "Conecte el triaje con AI de SocTalk a un Wazuh que ya opera: instale desde el paquete del SO, haga onboarding de un tenant con perfil provided y observe cómo la primera alerta se convierte en un caso triado y escalado."
---

# Conectar SocTalk a un Wazuh existente

La mayoría de los equipos que usan Wazuh no parten de cero. Ya hay un manager vigilando agentes, un indexer con meses de alertas y un dashboard desde el que el equipo ya investiga. El perfil de tenant `provided` de SocTalk está construido exactamente para esta situación: SocTalk instala solo sus propios componentes, se conecta a su Wazuh por la red y comienza a triar las alertas que su despliegue ya produce. Nada cambia en su Wazuh, ningún agente se vuelve a enrolar y ningún dato migra.

Esta guía recorre el camino completo en un solo host Linux, desde el paquete del SO hasta el primer escalamiento triado por la AI, y fue verificada de punta a punta contra SocTalk v0.2.0 con Wazuh 4.12.0. Donde esta versión tiene asperezas, la guía lo dice y entrega el workaround.

Si en cambio quiere que SocTalk despliegue y administre Wazuh por usted, eso corresponde a los perfiles `poc` o `persistent`; vea [Onboarding de un tenant de cliente](/es-419/guides/wazuh-tenant-onboarding).

## Lo que necesita antes de empezar

Su Wazuh existente debe ser alcanzable desde el host de SocTalk en dos puertos: la API OpenSearch del indexer (`:9200`) y la REST API del manager (`:55000`). SocTalk se autentica contra cada uno por separado, así que tenga listos ambos pares de credenciales:

- un usuario del indexer con permiso para buscar en `wazuh-alerts-*` (el `admin` integrado funciona, aunque un usuario de solo lectura es mejor práctica),
- un usuario de la API del manager como el `wazuh-wui` integrado.

Los certificados autofirmados del lado de Wazuh son la norma y están soportados; pasará `verify_ssl: false` al momento del onboarding. También necesita una API key de LLM por tenant. El perfil `provided` la exige en el onboarding, porque un tenant que trae su propio SIEM no tiene un fallback compartido de la instalación: la solicitud de onboarding se rechaza con un 422 si falta la clave.

El propio host de SocTalk necesita la huella habitual: un Linux basado en systemd (Ubuntu 24.04 y Rocky 9 son el par verificado), 4 vCPU y 8 GB de RAM como piso para el plano de control más un tenant provided, y los puertos 80/443/6443 libres. Como el tenant no ejecuta ningún Wazuh propio, un tenant provided es mucho más liviano que uno `persistent`.

## Instalar SocTalk desde el paquete del SO

Descargue el paquete para su distro desde la [página de releases](https://github.com/soctalk/soctalk/releases) e instálelo; la matriz completa de variantes está en [Instalación desde un paquete del SO](/es-419/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

El paquete incluye una plantilla de entorno en `/etc/soctalk/soctalk.env.example`. Cópiela, complete su identidad de MSSP, las credenciales de administrador, el hostname y la clave de LLM, y manténgala accesible solo para root:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Luego ejecute el instalador de forma desatendida:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Pase `--skip-consent` (o `-y`) de forma explícita. En v0.2.0 el prompt de consentimiento sigue disparándose en una terminal no interactiva incluso con todas las variables `SOCTALK_*` definidas, y sin un TTY la instalación aborta con `/dev/tty: No such device or address`.

El instalador levanta k3s y Helm si el host no los tiene, instala el chart `soctalk-system` fijado a la versión del release e imprime la URL y el login al terminar. Tres pods en el namespace `soctalk-system` (`api`, `app-ui`, `postgres`) indican que el plano de control está arriba:

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## Un interruptor antes del onboarding: políticas de red

Aquí está el borde filoso de v0.2.0, de entrada para que no lo golpee a mitad del onboarding: un tenant `provided` renderiza una política de egreso FQDN de Cilium para los hosts del SIEM externo, pero el k3s que `soctalk install` configura corre flannel, que no tiene los CRDs de Cilium. Aprovisionar un tenant provided en una instalación de fábrica de v0.2.0 falla por lo tanto en el paso de Helm con

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

y el tenant queda en `degraded`. Esto está corregido después de v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): el chart ahora condiciona ese objeto a que el CRD realmente exista y agrega egreso con `NetworkPolicy` plano para hosts de SIEM con IP literal, de modo que una instalación de fábrica con flannel se aprovisiona sin problemas. En v0.2.0 el workaround en una instalación de un solo host es deshabilitar las políticas de red de tenant antes del onboarding:

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Sea claro con el tradeoff: esto desactiva las NetworkPolicies de aislamiento de namespace para los tenants aprovisionados después, lo cual es aceptable en un host dedicado de laboratorio o piloto con una sola clase de tenant y no es lo que quiere en un clúster de producción multi-tenant compartido. Si usa Cilium como su CNI, nada de esto aplica y debe dejar las políticas activadas.

Si ya hizo el onboarding y el tenant está en `degraded` con el error de arriba, aplique el interruptor y presione **Retry Provisioning** en la página del tenant; los reintentos son idempotentes y retoman limpiamente.

Una cosa más, específica de un laboratorio en una sola caja, donde el Wazuh "existente" suele correr en Docker en el mismísimo host donde instaló SocTalk, alcanzado por la propia IP del host. k3s aplica la NetworkPolicy a través de su controlador integrado, y un pod que alcanza la propia IP del nodo para un puerto publicado por Docker es un hairpin que la capa de políticas no enruta limpiamente aun cuando una regla de egreso lo permita. El síntoma es el adaptador registrando `ingest_failed: All connection attempts failed` mientras ese mismo Wazuh responde bien desde el host. Deshabilitar las políticas de red de tenant como se indicó arriba lo resuelve. Un Wazuh en un host separado es un camino saliente ordinario y no golpea con esto.

## Onboarding del tenant

En la MSSP UI, Tenants, luego **+ New Tenant**, elija el perfil `provided` y el asistente le pedirá el material de conexión externa. La misma operación por la API es un solo POST al endpoint de onboarding. Fíjese en la ruta: `POST /api/mssp/tenants/onboard` es el endpoint del asistente que entiende perfiles y material de SIEM externo. El `POST /api/mssp/tenants` a secas es un create solo de identidad que ignora esos campos en silencio, lo que le deja un tenant `poc` que nunca se aprovisiona.

```bash
# authenticate once; the cookie jar carries the MSSP session
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

Un 202 con `"profile": "provided"` en el cuerpo confirma la ruta correcta. Elija el slug con cuidado: los slugs quedan reservados por los tenants archivados, así que un tenant de prueba desmantelado no libera su nombre para reutilizarlo.

El aprovisionamiento de un tenant provided es rápido porque no hay chart de Wazuh que instalar; el controlador omite esa fase y registra en su lugar un evento de ciclo de vida `wazuh_skipped_provided`. En la corrida verificada el tenant pasó de `pending` a `active` en menos de veinte segundos.

## Verificar la conexión

El namespace del tenant debe contener exactamente dos cargas de trabajo, el adaptador y el runs-worker, y ningún pod de Wazuh:

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

Su material de conexión termina en un Secret local al namespace llamado `tenant-external-siem-creds` que contiene `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` y `WAZUH_API_PASSWORD`, más `WAZUH_API_TOKEN` cuando usted proporcionó uno. El adaptador lee la URL del indexer desde su entorno y las credenciales desde ese Secret. Su log le dice en segundos si la conexión funciona, porque sondea el índice de alertas de forma continua:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

Un 401 aquí significa que las credenciales del indexer están mal; un error de TLS significa que `verify_ssl` no coincide con su situación de certificados; un timeout significa que el host de SocTalk no alcanza el puerto del indexer.

Las credenciales rotan sin repetir el onboarding. `PATCH /api/mssp/tenants/{id}/external-siem` acepta cualquier subconjunto de los campos del onboarding, reescribe el Secret y reinicia el pod del adaptador para que tome el material fresco:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## La primera alerta triada

Desde aquí el pipeline se comporta exactamente igual que con un Wazuh administrado por SocTalk: el adaptador reenvía las alertas nuevas iguales o superiores a la severidad mínima (rule level 10 por defecto, configurable con `SOCTALK_ADAPTER_MIN_SEVERITY`), el plano de control promueve lo que importa a investigaciones y el runs-worker del tenant ejecuta el triaje con AI usando la propia clave de LLM del tenant.

La forma honesta de probar es hacer que su Wazuh existente produzca una alerta real de alta severidad, por ejemplo una ráfaga de inicios de sesión SSH fallidos contra un agente monitoreado seguida de uno exitoso. Si prefiere no tocar endpoints de producción, indexar un documento de alerta sintético directamente en `wazuh-alerts-4.x-<date>` con un `rule.level` de 12 ejercita el camino idéntico, ya que el adaptador lee desde el índice y no desde el manager.

En la corrida verificada, una alerta de fuerza bruta SSH seguida de un acceso exitoso fue desde documento en el indexer hasta triaje terminado en alrededor de un minuto: reenviada por el adaptador, promovida, investigada por el supervisor a lo largo de varias llamadas al LLM y cerrada como `escalate` con confianza de 0.95, aterrizando en la [cola de revisión del MSSP](/es-419/mssp-ui#reviews-human-in-the-loop) para un humano. El gasto total de la corrida fue de unos treinta centavos contra la clave de Anthropic del tenant, rastreado contra el presupuesto de tokens por corrida descrito en [Pipeline de AI](/es-419/ai-pipeline).

## Limitaciones actuales

Ambas salvedades de abajo se verificaron en v0.2.0 y están corregidas en el release posterior, así que en una build más nueva puede omitir los workarounds. Revise las notas de release de su versión.

- **El enriquecimiento que alcanza el Wazuh externo (solo v0.2.0).** En v0.2.0 el tooling MCP de Wazuh del runs-worker no estaba cableado a la API del manager de un tenant provided, así que el triaje corría solo con el payload de la alerta, sin pivotes en vivo al estado del agente ni al historial de logs. Corregido después de v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): el worker ahora conecta el servidor MCP `mcp-server-wazuh` integrado al propio Wazuh del tenant, de modo que el grafo de triaje consulta agentes, procesos, puertos, vulnerabilidades y logs del manager durante una investigación de la misma forma que lo hace un tenant administrado por SocTalk.
- **El aprovisionamiento en una instalación de fábrica con flannel (solo v0.2.0).** El problema de la política de egreso de Cilium descrito antes, con su workaround de políticas de red. Corregido después de v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
