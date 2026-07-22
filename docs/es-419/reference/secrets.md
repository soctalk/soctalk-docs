# Política de ubicación de secretos

> **Nota de despliegue V1.** Varias entradas a continuación hacen referencia a los "pods del orquestador" como una carga de trabajo distinta; en el chart V1 el orquestador está co-ubicado en el Deployment `soctalk-system-api`, por lo que las referencias a "pod del orquestador" significan "pod de la API" en esta versión. Los nombres específicos de los Secret de K8s también pueden variar ligeramente respecto a los nombres renderizados por el chart (consulta [`charts/soctalk-system/templates/60-secrets.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/60-secrets.yaml) como fuente de verdad).

## Invariante (aspiracional)

**Objetivo:** ningún material de secreto en crudo en la base de datos de SocTalk. Las tablas de Postgres que rastrean secretos almacenan solo referencias: `(namespace, name, version_label)`. El material en sí está en un objeto `Secret` de Kubernetes, montado en el pod que lo necesita.

**Hoy (V1):** hay **una excepción documentada**: `IntegrationConfig.llm_api_key_plain` en la base de datos almacena las claves de API de LLM por tenant en texto plano. Esto es necesario porque el runs-worker lee la clave desde su contexto de tenant en el momento de tomar la investigación y el chart V1 aún no cablea los Secret de LLM por tenant a través del pod spec. Trata las credenciales de Postgres como la protección de estas claves, y rota las claves del proveedor de LLM como si estuvieran expuestas si la credencial de la BD rota.

Otras categorías de secretos, firma de JWT, roles de Postgres, credenciales de integración, authd de Wazuh, residen todas en Secret de K8s y se referencian por nombre desde la BD, no se almacenan en línea. Los objetivos de arquitectura (abajo) describen el estado de destino para todas las clases de secretos:

- Limita el radio de impacto de un compromiso de la BD de SocTalk (no hay fuga de material).
- Permite que funcionen los mecanismos de rotación nativos de K8s (actualización del Secret → el pod recoge el nuevo valor al remontar o en la próxima lectura del Secret).
- Se alinea con la ruta de integración de External Secrets Operator en una versión futura.

## Inventario de secretos V1 (lo que el chart realmente renderiza hoy)

| Secret | Material | Ubicación | Accedido por | Rotación |
|---|---|---|---|---|
| `soctalk-system-postgres-admin-creds` | usuario/contraseña | ns `soctalk-system` | Solo el contenedor `db-init` del pod de la API (migraciones + bootstrap) | Manual |
| `soctalk-system-postgres-app-creds` | usuario/contraseña | ns `soctalk-system` | Pod de la API (runtime, sujeto a RLS) | Manual |
| `soctalk-system-postgres-mssp-creds` | usuario/contraseña | ns `soctalk-system` | Pod de la API (consultas cross-tenant de `system_context()`) | Manual |
| `soctalk-system-jwt-signing-key` | secreto HMAC | ns `soctalk-system` | Pod de la API | Manual |
| `soctalk-system-adapter-signing-key` | clave HMAC | ns `soctalk-system` | Pod de la API (acuña tokens de adaptador por tenant) | Manual |
| `soctalk-system-bootstrap-admin` | correo + contraseña | ns `soctalk-system` | Solo el contenedor `db-init` del pod de la API | Manual |
| `soctalk-system-llm-api-key` | claves de API del proveedor (anthropic-api-key + openai-api-key) | ns `soctalk-system` | Pod de la API (valor por defecto para toda la instalación) | Manual |
| `adapter-token` | token bearer | ns `tenant-<slug>` | Pod adaptador del tenant | Acuñado en el aprovisionamiento; rotación mediante reaprovisionamiento |
| `runs-worker-token` | token bearer | ns `tenant-<slug>` | Pod runs-worker del tenant (llama a `/api/internal/worker/runs/*`) | Igual que arriba |
| `tenant-llm-key` | clave de API de LLM | ns `tenant-<slug>` | Pod runs-worker del tenant (montado vía `secretKeyRef`) | Iniciada por el MSSP vía `PATCH /api/mssp/tenants/{id}/llm`; el controlador la materializa desde `IntegrationConfig.llm_api_key_plain` + reinicia el runs-worker |
| `tenant-<id>-llm` | clave de API de LLM (copia legada / de auditoría) | ns `soctalk-system` | No montado por ningún pod V1 | Igual que arriba; esta copia se escribe para auditoría pero **no es la fuente autoritativa** que lee el runs-worker |
| `wazuh-authd-secret` | secreto compartido | ns `tenant-<slug>` | Wazuh manager (enrolamiento) | Regenerar para forzar el reenrolamiento de todos los agentes |
| `wazuh-<slug>-wazuh-creds` | usuario/contraseña | ns `tenant-<slug>` | Pods de Wazuh manager + linux-ep (enrolamiento de agentes) | Generado en el aprovisionamiento |

**El triaje se ejecuta en `soctalk-runs-worker` en cada namespace `tenant-<slug>`** (no en el pod central de la API). Por eso los secretos por tenant se montan en el namespace del tenant, no en `soctalk-system`.

La clave de API de LLM **también se almacena en texto plano en `IntegrationConfig.llm_api_key_plain`** en Postgres; consulta el descargo del invariante arriba. El Secret de K8s se materializa a partir del valor de la BD en el momento del aprovisionamiento / rotación.

Elementos obsoletos de borradores anteriores (ya eliminados): `tenant-<id>-wazuh`, `tenant-<id>-thehive`, `tenant-<id>-cortex`, `wazuh-bootstrap`, `thehive-bootstrap`, `cortex-bootstrap`, `cassandra-creds`, `soctalk-license`. `tenant-<id>-llm` en `soctalk-system` aún existe en V1 como copia legada / de auditoría, pero **no** es lo que lee el runs-worker. La sección de arquitectura abajo describe la justificación del diseño; solo el inventario de arriba está vigente.

## Ubicación de la clave de LLM por tenant

El triaje se ejecuta en el pod `soctalk-runs-worker` por tenant (en el namespace `tenant-<slug>`), **no** en el pod central de la API. Por eso las claves de LLM por tenant residen en el namespace del tenant:

- **Almacén autoritativo:** `IntegrationConfig.llm_api_key_plain` en Postgres.
- **Fuente montada:** `Secret/tenant-llm-key` en `tenant-<slug>`, materializado por el controlador a partir del valor de la BD.
- **En la rotación (`PATCH /api/mssp/tenants/{id}/llm`):** el controlador reescribe el Secret del namespace del tenant y reinicia `Deployment/soctalk-runs-worker` para que la nueva clave surta efecto en la próxima toma de investigación.

`Secret/tenant-<id>-llm` en el namespace `soctalk-system` también existe como copia legada / de auditoría de iteraciones de diseño anteriores, pero **no** está montado por ningún pod V1. No hay montaje de Secret entre namespaces en V1.

La alternativa (un ns por tenant para la clave de LLM de cada tenant) se reevalúa en una versión futura con External Secrets Operator, donde ESO puede sincronizar secretos almacenados en un vault externo en cualquier namespace que los necesite.

## Secretos de bootstrap del plano de datos

Las credenciales de administrador de Wazuh/TheHive/Cortex residen en sus respectivos namespaces de tenant porque:

- Estos pods las necesitan en el arranque (init containers, configuración de primer arranque).
- Complicaciones de montaje entre namespaces como se indicó arriba.
- El radio de impacto de un compromiso de namespace ya expone los propios pods; colocar el secreto de bootstrap en el mismo namespace no agrega riesgo.

Los secretos de bootstrap los genera el controlador de SocTalk en el momento del aprovisionamiento del tenant:
1. El controlador genera valores aleatorios (p. ej., `openssl rand -hex 32`).
2. El controlador crea el `Secret` en el ns `tenant-<slug>` de destino.
3. El controlador registra la referencia `(tenant-<slug>, wazuh-bootstrap, v1)` en la tabla `TenantSecret`.
4. El controlador renderiza los valores del chart del tenant referenciando el Secret por nombre.
5. `helm install` procede; los pods del plano de datos leen las credenciales en el arranque.

Si el material se pierde (p. ej., se elimina el Secret), el reaprovisionamiento regenera nuevas credenciales. Los pods del plano de datos se reinician; cualquier servicio dependiente se reinicializa. Los agentes de los endpoints del cliente (que dependen del secreto de enrolamiento de Wazuh) necesitan reenrolamiento si ese secreto específico rota: documentado en el runbook de operaciones.

## Convenciones de generación de secretos

En el momento del aprovisionamiento del tenant, el controlador de SocTalk genera:

```python
import secrets

# Contraseñas administrativas: 32 caracteres, alta entropía
wazuh_admin_pw = secrets.token_urlsafe(32)
thehive_admin_pw = secrets.token_urlsafe(32)
cortex_admin_pw = secrets.token_urlsafe(32)

# Secreto compartido de enrolamiento: 48 caracteres
wazuh_authd = secrets.token_urlsafe(48)

# Tokens de API (para SocTalk → plano de datos): 48 caracteres
thehive_api_token = secrets.token_urlsafe(48)
cortex_api_key = secrets.token_urlsafe(48)

# Cassandra: 32 caracteres
cassandra_pw = secrets.token_urlsafe(32)
```

SocTalk almacena referencias y etiquetas de versión; no conserva el material en memoria más allá de la llamada de aprovisionamiento.

## Rotación (realidad de V1)

1. **Rotación de la clave de LLM por tenant** (el MSSP la inicia vía `PATCH /api/mssp/tenants/{id}/llm`):
   - El almacén autoritativo se actualiza en Postgres (`IntegrationConfig.llm_api_key_plain`).
   - El controlador reescribe `Secret/tenant-llm-key` en `tenant-<slug>` (no en el namespace del sistema).
   - El controlador reinicia `Deployment/soctalk-runs-worker` en el namespace del tenant para que la nueva clave surta efecto en la próxima toma. **Se requiere reiniciar el pod**: V1 no recarga secretos en tiempo de ejecución.

2. **Rotación de credenciales de administrador de Wazuh / TheHive / Cortex** (manual, runbook):
   - `kubectl patch secret <name> -n tenant-<slug> ...` para reescribir la credencial.
   - `kubectl rollout restart` la carga de trabajo afectada para que la relea.
   - Un CLI envoltorio para esto (`soctalk-cli rotate-admin`) se documentó en borradores anteriores pero **no está implementado** en V1.

3. **Rotación de credenciales de Postgres** (manual, runbook):
   - `ALTER ROLE soctalk_app WITH PASSWORD ...` en Postgres.
   - `kubectl patch secret soctalk-system-postgres-app-creds ...` (ten en cuenta el nombre renderizado por el chart).
   - `kubectl rollout restart deploy soctalk-system-api`: no hay un pod de orquestador separado en V1 (el orquestador está co-ubicado en el pod de la API).

4. **Rotación de la clave de firma de JWT** (una versión futura): la rotación sin tiempo de inactividad requiere admitir dos claves válidas durante la transición. Esta versión lo pospone; la rotación manual fuerza una ventana en la que todos los usuarios deben reautenticarse.

## Control de acceso

El RBAC de Kubernetes restringe qué ServiceAccounts pueden leer qué Secrets:

- SA `soctalk-system-api` en `soctalk-system`: puede leer Secrets en `soctalk-system` (credenciales de Postgres, claves de firma de JWT/adaptador). También está vinculada para escribir Secrets en namespaces `tenant-*` (necesario para crear/rotar los secretos de bootstrap del tenant); el chart V1 consolida los roles de API + controlador en esta SA.
- `ServiceAccount` por tenant en `tenant-<slug>`: solo puede leer secretos en su propio namespace. Puede leer su propio `adapter-token` / `runs-worker-token` / `tenant-llm-key`, pero nunca la clave de firma del sistema.
- La `soctalk-orchestrator-sa` de borradores anteriores no existe en V1; el orquestador se ejecuta dentro del pod de la API bajo la SA de la API.

Las plantillas de `Role`/`RoleBinding` forman parte del chart `soctalk-system` (para las SA de SocTalk) y del chart `soctalk-tenant` (para las SA por tenant).

## Antipatrones explícitamente rechazados

- **Inyección de secretos por variable de entorno desde un archivo `.env`** (patrón actual de V0): está bien para una sola organización, no para multi-tenant. Todos los secretos se mueven a Secret de K8s.
- **Secretos en el values.yaml de Helm**: nunca: los archivos de valores terminan en Git, logs de CI, historial de Helm. El controlador de SocTalk renderiza los objetos Secret por separado y usa `valueFrom.secretKeyRef` en las plantillas.
- **Una única clave de LLM compartida para todos los tenants**: explícitamente fuera de alcance para BYO LLM. Siempre claves por tenant.
- **Secretos en ConfigMaps**: prohibido. Los ConfigMaps son para configuración no sensible; los Secrets para lo sensible.

## External Secrets Operator (ruta de una versión futura)

Una versión futura introduce la integración con External Secrets Operator:

- El MSSP provee un backend de secretos (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
- Los recursos `ExternalSecret` referencian rutas del backend; ESO sincroniza a Secret de K8s.
- Las claves de LLM por tenant se almacenan en el backend con rutas como `secret/mssp-abc/tenants/acme/llm`.
- La rotación se realiza en el backend; ESO propaga dentro del intervalo de refresco.

La estructura (referencias en Postgres → Secret de K8s → montaje) es compatible: solo cambia la fuente del Secret (gestionado por ESO vs. escrito por el controlador de SocTalk).
