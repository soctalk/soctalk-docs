# Ollama (LLM local)

Ejecuta el triaje con AI de SocTalk contra un modelo **local** con [Ollama](https://ollama.com/): sin LLM en la nube, sin costo por token, los datos permanecen en tu infraestructura. Ollama expone una API **compatible con OpenAI**, y el `runs-worker` por tenant de SocTalk (el componente que realmente llama al LLM) se comunica con ella directamente.

Esta página es la configuración de extremo a extremo. Para el modelo general de proveedores consulta [Proveedores de LLM](/es-419/integrate/llm-providers).

## Cómo encaja

El **`runs-worker`** por tenant es el cliente del LLM. Su proveedor/modelo/URL base provienen de la configuración del tenant y se renderizan en su entorno:

```
SOCTALK_LLM_PROVIDER=openai            # openai-compatible maps to "openai"
OPENAI_BASE_URL=http://<host>:11434/v1 # your Ollama endpoint
SOCTALK_FAST_MODEL=qwen2.5:7b
SOCTALK_REASONING_MODEL=qwen2.5:7b
```

Así que configurar Ollama son cuatro valores: **proveedor** `openai-compatible`, **URL base** apuntando a Ollama, un **modelo** descargado y una **clave de API ficticia** (Ollama la ignora, pero el secreto debe ser no vacío).

## 1. Instalar Ollama

En un host que el clúster pueda alcanzar (un nodo, o cualquier equipo en la misma red):

```bash
curl -fsSL https://ollama.com/install.sh | sh

# Enlaza a todas las interfaces para que los pods del tenant puedan alcanzarlo (el valor por defecto es solo 127.0.0.1)
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\n' \
  | sudo tee /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# Descarga un modelo con capacidad de herramientas (consulta "Elegir un modelo" más abajo)
ollama pull qwen2.5:7b
```

Confirma que responde: `curl http://<host>:11434/api/version`.

## 2. Apuntar un tenant a Ollama

Por tenant, mediante la API (o el equivalente en tu automatización):

```bash
curl -X PATCH https://<your-mssp-host>/api/mssp/tenants/<tenant-id>/llm \
  -H 'Content-Type: application/json' -b <admin-session-cookie> \
  -d '{
        "provider": "openai-compatible",
        "base_url": "http://<host>:11434/v1",
        "model":    "qwen2.5:7b",
        "api_key":  "ollama"
      }'
```

Esto persiste el `IntegrationConfig` del tenant y encola un reaprovisionamiento: el controlador hace `helm upgrade` del chart del tenant, el `runs-worker` se recicla con el entorno de Ollama, **y la NetworkPolicy de egreso abre automáticamente el puerto de Ollama** (consulta las notas de accesibilidad). Los nuevos triajes van a Ollama.

Para hacer de Ollama el valor por defecto para **cada** nuevo tenant, define `defaults.llm` en los values de `soctalk-system` durante la instalación:

```yaml
defaults:
  llm:
    provider: openai-compatible
    baseUrl: http://<host>:11434/v1
    model: qwen2.5:7b
llm:
  provider: openai
  apiKey: "ollama"
```

::: warning V1: la UI de Configuración muestra el proveedor incorrecto
En esta versión, el panel **Settings → LLM** de la UI del MSSP refleja los valores por defecto codificados del *pod de la API* (p. ej. `gpt-4o`), **no** la configuración real del tenant. La fuente autoritativa es el `IntegrationConfig` por tenant (`GET /api/mssp/tenants/{id}/llm`) y el entorno del `runs-worker`. No confíes en la página de Configuración para confirmar Ollama.
:::

## 3. Lista de verificación de accesibilidad (las cosas que muerden)

- **Enlaza a `0.0.0.0`.** Ollama escucha en `127.0.0.1` por defecto: los pods no pueden alcanzar eso. Define `OLLAMA_HOST=0.0.0.0:11434` (paso 1).
- **No uses `localhost`/`127.0.0.1` en la URL base.** Ese es el *pod*, no el host de Ollama. Usa la IP enrutable del host (o ejecuta Ollama dentro del clúster como un Service). Los pods alcanzan las IP de rango privado (`10.0.0.0/8`, `172.16.0.0/12`) a través de las autorizaciones de egreso por defecto.
- **Puerto de egreso.** La NetworkPolicy de egreso del `runs-worker` del tenant abre el puerto del LLM, **derivado de la URL base** (así `:11434` para Ollama, `:8000` para vLLM, etc.). Esto es automático en el chart `soctalk-tenant` **≥ 0.1.2**. En charts más antiguos la política solo permitía `:443`: actualiza, permite el puerto manualmente, o pon Ollama detrás de un proxy inverso TLS en `:443`.
- **Clave de API ficticia.** Déjala vacía y el chart omite el Secret → el worker arranca sin `OPENAI_API_KEY` y falla. Usa cualquier cadena no vacía.

## 4. Verificar

Confirma que el worker está conectado a Ollama y que un triaje real fluye a través de él:

```bash
# 1. tenant config (authoritative)
curl -s https://<host>/api/mssp/tenants/<id>/llm   # provider/base_url/model = Ollama

# 2. worker env
kubectl -n tenant-<slug> get deploy soctalk-runs-worker \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -E 'LLM_PROVIDER|MODEL|OPENAI_BASE'

# 3. Ollama actually serving SocTalk
ollama ps                                   # model loaded while triaging
journalctl -u ollama | grep /v1/chat/completions   # 200s during a triage
```

Cuando llega una alerta, la investigación es triada por el modelo local: el **Agent Run / Token Spend** en la investigación refleja los tokens generados por Ollama:

![Investigación triada por Ollama](/screenshots/ollama-investigation.png)

## Elegir un modelo

El pipeline de SocTalk hace **tool-calling + veredictos JSON estructurados**, así que elige un modelo de instrucciones con soporte sólido de herramientas: `qwen2.5`, `llama3.1`, `mistral-nemo`. Los modelos pequeños/antiguos a menudo fallan en la salida estructurada. El nivel de razonamiento se beneficia más de un modelo más potente; puedes separarlos con `fast_model` / `reasoning_model` (un enrutador rápido pequeño + un modelo de veredicto más grande).

::: tip La CPU es lenta
En CPU, un modelo de 7B corre a ~decenas de tokens/seg, y un solo triaje hace varias llamadas al LLM: espera **minutos** por investigación. Usa un host con GPU para una latencia utilizable, o un modelo rápido más pequeño.
:::
