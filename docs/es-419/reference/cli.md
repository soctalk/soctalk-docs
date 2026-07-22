# CLI y scripts

Los operadores hacen la mayoría de las cosas a través de la [interfaz MSSP](/es-419/mssp-ui) o la [REST API](/es-419/reference/api). La superficie de la CLI es pequeña y existe para el arranque inicial, los entornos de desarrollo y las operaciones sin conexión.

## Puntos de entrada dentro del pod

Estos se ejecutan dentro de `soctalk-system-api` (o un Job de una sola ejecución). Usan las credenciales de Postgres montadas en el pod y la configuración del chart: sin estado externo.

### Arranque inicial (bootstrap)

En esta versión no hay una CLI de bootstrap separada: el comando de init del pod de API del chart ejecuta el bootstrap en línea (migraciones, contraseñas de roles, fila de organización, usuario administrador opcional). Consulta [Instalación, Migraciones y bootstrap](/es-419/install#migrations-and-bootstrap-run-automatically).

### Prueba de humo del LLM

En esta versión no hay una CLI `soctalk.llm.smoke_test`. Para verificar rápidamente que un LLM configurado es alcanzable, consulta [Proveedores de LLM, Prueba de comprobación](/es-419/integrate/llm-providers#sanity-test) para conocer la expresión de Python de una sola línea.

### `soctalk-auth` (helper dentro del pod)

El único helper de CLI de primera clase en esta versión. Un solo subcomando: `set-password`.

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password user@example.com
```

Solicita una nueva contraseña (o la lee de `SOCTALK_PASSWORD`), busca al usuario, establece la contraseña con hash y audita `auth.password.reset.admin`. Útil para restablecimientos forzados sin pasar por la API. La fila del usuario ya debe existir; `soctalk-auth` no crea filas.

### `soctalk` (punto de entrada del orquestador)

`soctalk` es el punto de entrada del orquestador: ejecuta el supervisor de LangGraph + los workers. En V1, el pod de API incrusta el orquestador (no hay un Deployment `soctalk-system-orchestrator` separado). Normalmente no se invoca a mano fuera de desarrollo.

### Todavía no hay una `soctalk-cli` de propósito general

El borrador anterior de esta página listaba comandos de gestión de tenants bajo un binario `soctalk-cli` que no existe en la versión actual. Las acciones de tenant (suspender, reanudar, dar de baja, rotar-admin) hoy pasan por la [REST API](/es-419/reference/api). La superficie de la CLI para operaciones de tenant está prevista para una versión futura.

## En el repo: recetas del `justfile`

El [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) en la raíz del repo tiene recetas usadas durante el desarrollo y la publicación:

| Receta | Qué hace |
|---|---|
| `just build-api` | Construye la imagen de contenedor de la API |
| `just build-orchestrator` | Construye la imagen de contenedor del orquestador |
| `just build-frontend` | Construye la imagen de contenedor del frontend de SvelteKit |
| `just build-mock-endpoint` | Construye la imagen del simulador de endpoint mock |
| `just run` | Ejecuta el stack de desarrollo vía docker-compose |
| `just push-all` | Empuja todas las imágenes al registro configurado |
| `just release` | Construye y empuja todas las imágenes (`build-all` + `push-all`). La publicación versionada del chart, el tag de git y el Release de GitHub los emite por separado la GitHub Action **Cut k8s Release**, no esta receta. |

## En el repo: `scripts/`

| Script | Propósito |
|---|---|
| `scripts/dev-up.sh` | Levanta un clúster de desarrollo k3d de un solo nodo con SocTalk y un tenant sembrado |
| `scripts/local-up.sh` | Lo mismo, pero sobre el k3s del host en lugar de k3d |
| `scripts/local-down.sh` | Desmonta un clúster de `local-up.sh` |
| `scripts/e2e-l1-l2-k3d.sh` | Configuración de dos clústeres k3d (MSSP L1 + tenant L2) para validación e2e completa |
| `scripts/seed-mssp-demo-data.py` | Puebla Postgres con tenants de fixture (`acme-corp`, `wayne-industries`, `stark-defense`) y reproduce alertas de Wazuh a través del indexador para preparar capturas de pantalla |
| `scripts/dump_openapi.py` | Vuelca el esquema OpenAPI de FastAPI a JSON; la fuente de verdad a partir de la cual se genera la referencia de la REST API en los docs |
| `scripts/verify-pages-visual.py` | Verificación de regresión visual con Playwright contra la interfaz de SocTalk de desarrollo |

Todos estos esperan ejecutarse desde la raíz del repo. Lee el encabezado del script para conocer los argumentos exactos.

## En el repo: Packer

Para builds de imágenes de VM, consulta [Descargas → Constrúyelo tú mismo](/es-419/downloads#build-it-yourself).

## Operaciones en entornos aislados (air-gapped)

Para instalaciones sin acceso a internet, la API + `soctalk-auth` son suficientes para ejecutar SocTalk sin tocar la interfaz:

```bash
# El bootstrap ocurre automáticamente en el comando de init del pod de API — sin
# paso adicional. Solo instala el chart con install.bootstrapAdmin.* definido.

# O bien, si esos valores no se proporcionaron, establece la contraseña de administrador después de instalar:
kubectl -n soctalk-system exec deploy/soctalk-system-api -- \
  soctalk-auth set-password admin@example
# Lee las credenciales de administrador.
kubectl -n soctalk-system get secret soctalk-system-bootstrap-admin \
  -o jsonpath='{.data.password}' | base64 -d; echo

# Incorpora un tenant a través de la API.
curl -k -c jar -X POST http://soctalk-system-api:8000/api/auth/login \
  -d '{"email":"admin@example","password":"..."}'
curl -k -b jar -X POST http://soctalk-system-api:8000/api/mssp/tenants/onboard \
  -d '{"slug":"acme","display_name":"Acme","profile":"persistent"}'
```

Para la contraseña existente del administrador de bootstrap que emite el Job de bootstrap, consulta [Instalación → Migraciones y bootstrap](/es-419/install#migrations-and-bootstrap-run-automatically).

## Punteros al código fuente

| Concepto | Archivo |
|---|---|
| Bootstrap (en línea) | [`charts/soctalk-system/templates/30-api.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/30-api.yaml) (comando de init) |
| Factory de proveedores de LLM | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Código fuente de `soctalk-auth` | [`src/soctalk/core/cli/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/cli/auth.py) |
| Punto de entrada del orquestador `soctalk` | [`src/soctalk/main.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/main.py) |
| `justfile` | [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) |
| `scripts/` | [`scripts/`](https://github.com/soctalk/soctalk/tree/main/scripts) |
