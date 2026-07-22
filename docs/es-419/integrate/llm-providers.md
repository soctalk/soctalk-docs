# Proveedores de LLM

El runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) admite dos proveedores, seleccionados mediante `SOCTALK_LLM_PROVIDER`:

- `anthropic` — a través de `langchain-anthropic` (modelos Claude)
- `openai` — a través de `langchain-openai` (OpenAI o cualquier endpoint compatible con OpenAI que respete `Authorization: Bearer <key>` contra `POST /v1/chat/completions`: Azure OpenAI, vLLM, Ollama, LiteLLM, etc.)

En V1, la variable de entorno del proveedor (`SOCTALK_LLM_PROVIDER`) **solo es respetada por los pods del runs-worker por tenant**. El propio pod de la API usa valores predeterminados de proveedor codificados de forma fija. El proveedor por tenant se puede establecer mediante `PATCH /api/mssp/tenants/{tenant_id}/llm` (consulta [Anulaciones por tenant](#per-tenant-overrides)).

Un modelo autoalojado y compatible con OpenAI es una opción de primera clase, no un recurso de respaldo: apunta el proveedor `openai` a un servidor vLLM o SGLang que ejecutes, a un endpoint serverless de GPU gestionado o a un Ollama local, todo mediante `OPENAI_BASE_URL`. SocTalk clasifica los backends por modelo de entrega, API gestionada en caliente, GPU serverless con scale-to-zero, GPU alquilada siempre activa, o local, y cada uno tiene un perfil de costo y latencia diferente. Para saber cómo elegir, consulta [Mantener baja la factura de inferencia del triaje con AI](/es-419/guides/inference-cost-optimization) y [Cuánto cuesta realmente la inferencia de triaje, medido](/es-419/guides/inference-cost-benchmark).

## Qué expone el chart

El chart `soctalk-system` acepta valores predeterminados de LLM para toda la instalación que inicializan la configuración de LLM por nivel de cada tenant recién incorporado:

```yaml
defaults:
  llm:
    provider: openai-compatible          # SOCTALK_LLM_PROVIDER_DEFAULT
    baseUrl: https://api.openai.com/v1   # SOCTALK_LLM_BASE_URL_DEFAULT
    model: gpt-4o                        # SOCTALK_LLM_MODEL_DEFAULT
    fastTier: {}                         # optional cheaper router/supervisor tier; off until provider/baseUrl/model are set

llm:
  provider: openai               # provider whose API key the install ships with
  existingSecret: ""             # Secret with anthropic-api-key / openai-api-key keys
  apiKey: ""                     # inline alternative; creates ONE provider key only (not both), dev / lab use only
```

**Cómo surten efecto los valores predeterminados:** las claves `defaults.llm.*` se leen en la incorporación del tenant e inicializan la configuración por nivel del nuevo tenant, de modo que un tenant creado después de que las establezcas las hereda. Los tenants existentes conservan su configuración actual hasta que se les aplique un patch.

**Dónde se ejecuta la configuración resuelta:** el Deployment `soctalk-runs-worker` por tenant. Sus variables de entorno `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` y `OPENAI_BASE_URL` las renderiza el controlador de aprovisionamiento a partir de la fila de configuración del tenant, y esa es la superficie que controla a qué proveedor y modelo llama cada nivel.

## Cambiar a Anthropic

Para ejecutar un tenant contra Anthropic directamente (sin un proxy compatible con OpenAI de por medio), establece el proveedor por tenant mediante `PATCH /api/mssp/tenants/{id}/llm`:

```json
{ "provider": "anthropic" }
```

…y proporciona la clave de Anthropic a través del flujo BYOK (`PUT /api/tenant/llm/api-key`). El controlador renderiza `SOCTALK_LLM_PROVIDER=anthropic` en el runs-worker de ese tenant, que usa `langchain-anthropic`.

El valor del chart `llm.provider: anthropic` + `llm.existingSecret` (un Secret con una clave `anthropic-api-key`) inicializan el Secret de credenciales para toda la instalación que el controlador replica en los nuevos tenants; pero el valor del chart **no** establece por sí mismo `SOCTALK_LLM_PROVIDER` en ninguna parte en V1; la selección del proveedor es por tenant.

## Claves de API

Nunca en `values.yaml`. Proporciónalas mediante `Secret/soctalk-system-llm-api-key`:

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Proporciona ambas claves cuando sea posible: el chart empaqueta ambas claves en el Secret independientemente del proveedor activo, de modo que cambiar de proveedor más adelante (por ejemplo, dev: openai → prod: anthropic) no requiere volver a crear el Secret.

## Interfaz de configuración

[Configuración → LLM](/es-419/mssp-ui#settings) en la interfaz de MSSP muestra el proveedor activo, el modelo, la URL base, la temperatura y el máximo de tokens. Los campos son **de solo lectura en esta versión**: junto al título aparece la insignia `Read-only`. Las mutaciones no están implementadas; hoy los valores del chart + la selección basada en variables de entorno del runtime son la autoridad.

Las claves de API nunca se muestran en la respuesta de configuración (solo el indicador `present: bool`).

## Ajustes solo de runtime (variables de entorno, no del chart)

Existen varios ajustes de runtime como variables de entorno, pero aún no se exponen como valores del chart. Establécelos directamente en el Deployment `soctalk-system-api` (que también es el orquestador en V1) después de la instalación:

| Variable de entorno | Efecto |
|---|---|
| `SOCTALK_LLM_PROVIDER` | `anthropic` u `openai`. Selecciona la integración de LangChain |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Claves del proveedor (alternativa al Secret empaquetado) |
| `OPENAI_BASE_URL` | Anula la URL base del cliente de OpenAI (Azure, vLLM, Ollama, …) |
| `OPENAI_API_VERSION`, `OPENAI_API_TYPE` | Específicas de Azure |
| `SOCTALK_FAST_MODEL` | Anula el modelo rápido (predeterminado `claude-sonnet-4-20250514`) |
| `SOCTALK_REASONING_MODEL` | Anula el modelo de razonamiento (predeterminado `claude-sonnet-4-20250514`) |

El chart antepone a estas los valores `defaults.llm.*` para los valores predeterminados de toda la instalación; las anulaciones por tenant se aplican en runtime mediante las variables de entorno del runs-worker del tenant.

## Anulaciones por tenant

El proveedor, el modelo y la URL base del LLM por tenant se pueden establecer mediante `PATCH /api/mssp/tenants/{tenant_id}/llm` (consulta [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py)). El cambio se persiste en la base de datos y se renderiza en las variables de entorno del runs-worker del tenant en el siguiente despliegue; en la práctica, el runs-worker recoge el cambio en el siguiente reinicio del pod (o el siguiente `helm upgrade` del chart del tenant).

El payload de incorporación del tenant puede incluir `llm_base_url` y `llm_model` para la configuración inicial. Los campos de anulación, reflejados en runtime como variables de entorno en el runs-worker:

| Campo del tenant | Variable de entorno en el runs-worker |
|---|---|
| `llm.provider` | `SOCTALK_LLM_PROVIDER` |
| `llm.base_url` | `OPENAI_BASE_URL` |
| `llm.fast_model` | `SOCTALK_FAST_MODEL` |
| `llm.reasoning_model` | `SOCTALK_REASONING_MODEL` |
| Clave de API | Secret `tenant-llm-key` en el namespace del tenant, montado por secretKeyRef. `IntegrationConfig.llm_api_key_plain` en Postgres es el almacén autoritativo; el controlador de aprovisionamiento materializa el Secret a partir de él |

Razones comunes para anular por tenant:

- Un cliente de alto volumen necesita un grupo dedicado de límite de tasa / un nivel de precios dedicado.
- Las reglas de residencia de datos de un cliente requieren un endpoint específico de una región.
- Un tenant de evaluación usa un modelo más económico que producción.

Flujo de rotación del LLM por tenant: consulta [Operaciones diarias → Rotar la clave del LLM por tenant](/es-419/operations#rotate-per-tenant-llm-key).

## Notas sobre costos

- El runtime hace muchas llamadas pequeñas al LLM por investigación (supervisor + workers + cierre) y una llamada grande de razonamiento (veredicto). La separación entre rápido y razonamiento ahora es configurable por nivel (tier): SocTalk resuelve cada rol, un nivel más ligero de router/supervisor y un nivel más fuerte de veredicto/razonamiento, a su propio tier, cada uno apuntando a su propio proveedor, modelo y endpoint. El ajuste `defaults.llm.fastTier` en los valores del chart `soctalk-system` y el renderizado por nivel en la capa de aprovisionamiento te permiten apuntar el nivel rápido a un modelo económico mientras conservas un modelo más fuerte para el veredicto, de modo que ya no sacrificas la calidad del veredicto para reducir el costo por llamada. El nivel rápido está desactivado de forma predeterminada (`fastTier: {}`); establece su `provider`, `baseUrl` y `model` para habilitarlo. Inicializa la configuración por nivel de los tenants recién incorporados, de modo que los tenants existentes conservan su configuración actual hasta que se les aplique un patch.
- El uso de tokens por tenant se mide mediante la métrica de Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}` — consulta [Observabilidad](/es-419/observability#per-tenant-cost).
- El autoalojamiento solo compensa si mantienes la GPU ocupada. El ajuste `runsWorker.concurrency` (predeterminado `1`) establece cuántas investigaciones procesa en paralelo un runs-worker; súbelo para llenar un batch continuo autoalojado y amortizar una GPU siempre activa entre más trabajo. Consulta [Mantener baja la factura de inferencia del triaje con AI](/es-419/guides/inference-cost-optimization) para saber cómo dimensionarlo frente a un backend dado.

## Prueba de sanidad

En esta versión no se incluye una CLI dedicada de smoke-test. La comprobación más rápida es incorporar un tenant de prueba y revisar los registros del orquestador (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`): la primera investigación revelará cualquier configuración incorrecta del proveedor. Un comando de smoke-test con script está en el roadmap.

## Punteros al código fuente

| Concepto | Archivo |
|---|---|
| Fábrica de proveedores | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Resolución de configuración basada en variables de entorno | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valores de LLM del chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Respuesta de configuración | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
