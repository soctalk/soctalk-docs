# Contribuir

SocTalk usa la licencia Apache 2.0. Los PR son bienvenidos. Esta página cubre el ciclo de desarrollo y qué esperar de una revisión.

## Entorno de desarrollo

Levanta un clúster local listo para SocTalk:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk
./scripts/dev-up.sh           # cluster dependencies only
```

`scripts/dev-up.sh` crea un clúster k3d e instala los prerrequisitos a nivel de clúster:

- K3s con Flannel + kube-proxy deshabilitados
- Cilium como el CNI con aplicación de NetworkPolicy
- cert-manager instalado
- k3d local-path como el StorageClass predeterminado

**No** compila las imágenes de SocTalk, ni instala el chart de SocTalk, ni incorpora tenants, ni carga datos iniciales — versiones anteriores de esta página afirmaban que sí lo hacía. Ejecuta los siguientes pasos tú mismo. Secuencia típica después de `dev-up.sh`:

```bash
just build-api build-frontend  # api image embeds the orchestrator in V1
helm install soctalk-system charts/soctalk-system \
  -n soctalk-system --create-namespace \
  --set install.bootstrapAdmin.email=dev@example \
  --set install.bootstrapAdmin.password=devpassword12
# migrations + bootstrap admin run in the API pod's init command
# sign in at https://<your-ingress>/ with the credentials you set above
```

Para un ciclo interno más rápido (sin recompilar la imagen en cada cambio), consulta los consejos de iteración a continuación.

## Elige tu ciclo de iteración

Según la convención del proyecto, prefiere ejecutar los servicios con `uvicorn` / `pnpm dev` en lugar del ciclo de build-push-redeploy de k3d:

```bash
# API (embeds the orchestrator in V1)
cd src && uvicorn soctalk.core.api.app_v1:app --reload --port 8000

# Frontend
cd frontend && pnpm dev
```

Apúntalos al Postgres / Wazuh / Cortex del clúster k3d mediante `kubectl port-forward`. La iteración toma segundos, no minutos.

## Estructura del repositorio

```text
src/                Python (control plane, AI pipeline, adapter, runs-worker)
frontend/           SvelteKit (MSSP + customer UI)
charts/             Helm charts (soctalk-system, soctalk-tenant, wazuh, linux-ep)
infra/packer/       VM image generation (see /downloads)
setup-wizard/       Go (first-boot setup wizard)
attack-simulator/   MITRE ATT&CK demo scripts
scripts/            Dev / e2e / seed scripts
alembic/            DB migrations
docker-compose*.yml Various dev composition files
justfile            Build / release recipes
```

El sitio de documentación (este sitio) vive en un repositorio aparte, [`soctalk/soctalk-docs`](https://github.com/soctalk/soctalk-docs).

## Pruebas

En esta versión no existen las recetas `just test` / `just test-rls` / `just e2e-l1-l2` — esa es la forma planificada. Hoy, ejecuta las pruebas directamente con pytest:

```bash
pytest tests/                          # full suite
pytest tests/v1/test_rls_isolation.py  # Postgres Row-Level Security suite
```

Las pruebas de RLS son innegociables — verifican el aislamiento de datos entre tenants que promete el [Modelo de seguridad](/es-419/reference/security-model). CI ejecuta la suite completa de pytest en cada PR.

## Estilo

- Python: ruff + black. CI lo aplica.
- TypeScript: ESLint + Prettier con la configuración del repositorio. CI lo aplica.
- Mensajes de commit: asunto de una sola línea, prefijo de commit convencional (`feat:`, `fix:`, `chore:`, `ci:`, `chart:`, …). No se requiere cuerpo.
- Sin trailers co-authored-by / signed-off-by.

## Expectativas de los PR

- **Pruebas para el cambio.** Los nuevos endpoints necesitan pruebas de API; los nuevos nodos del grafo necesitan pruebas de máquina de estados; los cambios en charts necesitan snapshots de plantillas renderizadas.
- **Migración si tocaste un modelo.** Alembic las genera automáticamente; revisa el SQL generado para verificar su exactitud antes de hacer commit.
- **Actualiza la documentación** en [`soctalk-docs`](https://github.com/soctalk/soctalk-docs) si el cambio afecta un comportamiento documentado. No somos estrictos con esto para refactorizaciones internas; sí lo somos para cualquier cosa de cara al usuario.
- **PR pequeños.** Los PR grandes con cambios mezclados son difíciles de revisar. Separa la refactorización de la funcionalidad; separa el cambio de chart del cambio en tiempo de ejecución.

## Revisar tu propio trabajo

Antes de solicitar una revisión, ejecuta codex contra tus cambios:

```bash
codex review --uncommitted
```

Este es el mismo pase de revisión que ejecutamos al momento del release. Detecta los problemas obvios antes de que un revisor humano tenga que hacerlo.

## Publicar releases

Los releases se etiquetan desde `main`. Hoy el flujo tiene más pasos manuales de los que implica la receta planificada `just release`:

1. Incrementa manualmente las versiones en `Chart.yaml` + `pyproject.toml`, haz commit y push.
2. Etiqueta el commit y haz push del tag (`git tag v0.1.x && git push --tags`).
3. `just release` — ejecuta `just build-all push-all`. Esto **solo compila y publica imágenes de contenedor**; no etiqueta, ni publica charts, ni crea un Release en GitHub.
4. El workflow de GH `publish-images.yml` gestiona la publicación de la imagen en ghcr.io cuando se dispara.
5. La publicación del chart en `ghcr.io/soctalk/charts/` se hace manualmente hoy con `helm push`.
6. `gh release create` para lanzar el Release en GitHub.
7. `build-packer-images.yml` (disparo manual) compila la [imagen de VM de demostración](/es-419/downloads) en los cinco formatos y las adjunta al Release de GitHub.

Consolidar los pasos 1, 2, 5 y 6 en la receta `just release` está en el roadmap.

## Divulgación de seguridad

Si encontraste una vulnerabilidad, **no abras un issue público.** Envía un correo a la dirección indicada en SECURITY.md en la raíz del repositorio. Respondemos dentro de dos días hábiles.

## Licencia

Apache 2.0. Al enviar un PR aceptas licenciar tu contribución bajo la misma.

## Reconocimiento

El log de git es el registro canónico de contribuyentes hoy; se planea un CONTRIBUTORS.md dedicado / `just update-contributors`.
