# Proveedores de LLM

El runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) admite dos proveedores, seleccionados mediante `SOCTALK_LLM_PROVIDER`:

- `anthropic` — a través de `langchain-anthropic` (modelos Claude)
- `openai` — a través de `langchain-openai` (OpenAI o cualquier endpoint compatible con OpenAI que respete `Authorization: Bearer <key>` contra `POST /v1/chat/completions`: Azure OpenAI, vLLM, Ollama, LiteLLM, etc.)

En V1, la variable de entorno del proveedor (`SOCTALK_LLM_PROVIDER`) **solo es respetada por los pods del runs-worker por tenant**. El propio pod de la API usa valores predeterminados de proveedor codificados de forma fija. El proveedor por tenant se puede establecer mediante `PATCH /api/mssp/tenants/{tenant_id}/llm` (consulta [Anulaciones por tenant](#per-tenant-overrides)).

## Qué expone el chart

Hoy el chart `soctalk-system` acepta tres claves de valor de LLM para toda la instalación, pero la mayoría de ellas **no** se propagan al comportamiento del runtime en V1:

```yaml
defaults:
  llm:
    provider: openai-compatible   # rendered as SOCTALK_LLM_PROVIDER_DEFAULT on API pod, but V1 API IGNORES this env
    baseUrl: https://api.openai.com/v1   # rendered as SOCTALK_LLM_BASE_URL_DEFAULT, also IGNORED by V1 API
    model: gpt-4o                  # rendered as SOCTALK_LLM_MODEL_DEFAULT, also IGNORED by V1 API

llm:
  provider: openai               # NOT propagated to SOCTALK_LLM_PROVIDER on the API by V1 chart
  existingSecret: ""             # Secret with anthropic-api-key / openai-api-key keys
  apiKey: ""                     # inline alternative; creates ONE provider key only (not both) — dev / lab use only
```

**Resumen del comportamiento en V1:** el pod de la API usa sus **propios valores predeterminados codificados de forma fija** para proveedor/modelo/URL base. Las variables de entorno `*_DEFAULT` renderizadas por el chart son andamiaje para una versión futura; hoy no se leen.

**Dónde surte efecto realmente el cableado de las variables de entorno del LLM:** el Deployment `soctalk-runs-worker` por tenant. Sus variables de entorno `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` y `OPENAI_BASE_URL` las renderiza el controlador de aprovisionamiento a partir de la fila `IntegrationConfig` del tenant. Esa es la superficie que realmente controla a qué proveedor se llama.

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

- El runtime hace muchas llamadas pequeñas al LLM por investigación (supervisor + workers + cierre) y una llamada grande de razonamiento (veredicto). Elegir un modelo económico para `defaults.llm.model` reduce el costo drásticamente, pero actualmente también degrada la calidad del veredicto: el chart aún no separa el modelo rápido del de razonamiento. Hay un cambio planificado que separa los dos.
- El uso de tokens por tenant se mide mediante la métrica de Prometheus `soctalk_tenant_llm_tokens_total{direction="input|output"}` — consulta [Observabilidad](/es-419/observability#per-tenant-cost).

## Prueba de sanidad

En esta versión no se incluye una CLI dedicada de smoke-test. La comprobación más rápida es incorporar un tenant de prueba y revisar los registros del orquestador (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`): la primera investigación revelará cualquier configuración incorrecta del proveedor. Un comando de smoke-test con script está en el roadmap.

## Punteros al código fuente

| Concepto | Archivo |
|---|---|
| Fábrica de proveedores | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Resolución de configuración basada en variables de entorno | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Valores de LLM del chart | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Respuesta de configuración | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
