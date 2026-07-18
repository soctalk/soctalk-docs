# Auditoría del Helm Chart de Tenant


> **Metodología de auditoría**: este documento captura la clasificación esperada con base en la inspección del chart. Las ejecuciones reales de `helm template` y el diff-vs-clasificación son obligatorios en la validación previa al lanzamiento. Cualquier objeto encontrado en un render real que no esté listado aquí se convierte en una compuerta de revisión.

## Alcance de la auditoría

Charts a auditar:

| Upstream | Fuente upstream | Versión objetivo |
|---|---|---|
| Wazuh | Helm chart `wazuh/wazuh-kubernetes` (comunidad) o chart OCI oficial | Última estable 4.x con soporte de HA de manager único |
| TheHive | Helm chart `StrangeBee/thehive4` o comunidad | 5.x |
| Cortex | Helm chart `TheHive-Project/Cortex` o comunidad | 3.x |
| MISP | **aplazado a un lanzamiento futuro** | |

Para cada chart incorporamos (vendor) las plantillas de manifiestos (con parches si es necesario) como dependencias de subchart de `charts/soctalk-tenant/`: el pinning de versiones es estricto. `Chart.yaml` usa semver exacto con digest (OCI) cuando esté disponible.

## Reglas de clasificación

Para cada objeto renderizado, clasifícalo como:

- **NS-OK**: objeto con alcance de namespace que vive dentro de `tenant-<slug>`. Seguro, esperado.
- **CLUSTER-PREREQ**: objeto con alcance de clúster que debe instalarse una sola vez mediante el chart `soctalk-system` o documentarse como responsabilidad del cluster-admin del MSSP. El chart de tenant no debe reinstalar estos por cada tenant.
- **FORBIDDEN**: tipo de objeto o capacidad que nos negamos a permitir en un chart de tenant incluso cuando upstream lo declara (p. ej., un `ClusterRoleBinding` de alcance de clúster que otorgue acceso privilegiado a Wazuh). Debe eliminarse mediante parche.
- **PATCH**: mantener el objeto pero modificarlo (p. ej., eliminar volúmenes `hostPath`, quitar el `securityContext` privilegiado, reducir los requests de recursos por defecto).

## Clasificación esperada por chart upstream

### Wazuh

Los charts de Wazuh típicamente renderizan:

| Objeto | Clase esperada | Notas |
|---|---|---|
| `Deployment` / `StatefulSet` (manager, indexer, dashboard) | NS-OK | Pods del stack principal |
| `Service` (manager API, indexer, dashboard, ingress de agente 1514/1515) | NS-OK | |
| `ConfigMap` (ossec.conf, indexer.yml, dashboard.yml) | NS-OK | |
| `Secret` (contraseña de admin, certificados TLS mutuos) | NS-OK | Sembrado por tenant durante el aprovisionamiento |
| `PersistentVolumeClaim` (datos del indexer, datos del manager) | NS-OK | Tamaño definido mediante los values del tenant |
| `ServiceAccount` | NS-OK | SA por tenant |
| `Role` + `RoleBinding` (para elección de líder si se usa) | NS-OK | Solo con alcance de namespace |
| `NetworkPolicy` (provista por el chart) | PATCH | Reemplazar con la NP renderizada por SocTalk para una postura consistente; no permitir que los defaults de upstream anulen el default-deny |
| Referencias a `StorageClass` | CLUSTER-PREREQ | El MSSP debe proveer un provisioner dinámico; `storageClassName` es un input de values |
| `Ingress` | PATCH o deshabilitar | El protocolo de agente de Wazuh en 1514 no es TLS estándar, por lo que un `Ingress` HTTP/HTTPS no es apropiado. Elimina cualquier recurso `Ingress`. Para el `Service` de ingress de agente, el chart debe renderizar la variante que coincida con `tenant.wazuhIngress.mode`: un Service `LoadBalancer` para IPs de LB por tenant (por defecto) o un Service `ClusterIP` cuando la instalación usa el fallback de HAProxy dentro del clúster. Consulta [Wazuh Ingress](/es-419/reference/wazuh-ingress). |
| `PodSecurityPolicy` / `SecurityContextConstraints` | CLUSTER-PREREQ si está presente; prohibido en caso contrario | PSP está obsoleto; si está presente, elimínalo. El SCC de OpenShift no está en alcance para este lanzamiento |
| `CustomResourceDefinition` | **FORBIDDEN** en el chart de tenant | Si el chart intenta instalar un CRD, muévelo al chart `soctalk-system` o documéntalo como prerrequisito |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** en el chart de tenant | Nunca instales RBAC de alcance de clúster desde un namespace de tenant |
| Pods privilegiados/host-network/hostPath | **FORBIDDEN**; eliminar mediante parche | El manager de Wazuh no requiere esto para operación estándar; el indexer tampoco. Si un subchart exige `hostPath` para logs, aplícale parche a `emptyDir` + PVC |
| `PodDisruptionBudget` | NS-OK | Opcional; depende del modo HA de Wazuh. La topología de manager único puede omitirlo |

**Parches esperados**:
1. Eliminar cualquier `ClusterRole`/`ClusterRoleBinding` del output renderizado.
2. Eliminar cualquier recurso de alcance de clúster (`ValidatingWebhookConfiguration`, etc.).
3. Renderizar el `Service` de ingress de agente para que coincida con `tenant.wazuhIngress.mode` (`LoadBalancer` para IPs de LB por tenant, `ClusterIP` para el fallback de HAProxy dentro del clúster).
4. Eliminar los recursos `Ingress`. Los dashboards de Wazuh se exponen mediante una ruta separada gestionada por SocTalk; el protocolo de agente en 1514 no es HTTP, por lo que el `Ingress` de K8s no aplica.
5. Asegurar que todos los pods tengan `securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }`; aplicar parche si upstream lo define de otra forma.
6. Fijar imágenes a digests, no a `latest`.

### TheHive

| Objeto | Clase esperada | Notas |
|---|---|---|
| `Deployment` (app de TheHive) | NS-OK | |
| `StatefulSet` (variantes con Cassandra o respaldadas por DB externa) | NS-OK | usa Cassandra embebido; Cassandra externo es una opción de lanzamiento futuro |
| `Service` (web + API de TheHive en 9000) | NS-OK | |
| `ConfigMap` (application.conf) | NS-OK | Config por tenant renderizada por SocTalk |
| `Secret` (credenciales de admin, API key de Cortex para el Cortex de este tenant) | NS-OK | |
| `PersistentVolumeClaim` (datos de Cassandra, datos de índice) | NS-OK | |
| `ServiceAccount` | NS-OK | |
| `Ingress` | PATCH o deshabilitar | Igual que Wazuh: exposición del dashboard mediante proxy del lado del MSSP con enrutamiento por tenant, no un Ingress por namespace |
| `Job` (bootstrap / init) | NS-OK | OK para la generación de certificados en la primera ejecución / init de DB |
| `CustomResourceDefinition` | **FORBIDDEN**: debe estar en el chart `soctalk-system` si está presente |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** en el chart de tenant |

**Parches esperados**:
1. Eliminar Ingress; usar solo Services ClusterIP.
2. Fijar Cassandra a digest; definir límites de recursos que coincidan con el dimensionamiento.
3. Asegurar que el Job de init sea idempotente (re-ejecuciones inofensivas).
4. Sin dependencias de CRD.

### Cortex

| Objeto | Clase esperada | Notas |
|---|---|---|
| `Deployment` (app de Cortex) | NS-OK | |
| `StatefulSet` (Elasticsearch o índice compatible) | NS-OK | ES embebido; ES externo es un lanzamiento futuro |
| `Service` (API de Cortex en 9001) | NS-OK | |
| `ConfigMap` (application.conf, listas de analizadores) | NS-OK | |
| `Secret` (admin, tokens inter-servicio) | NS-OK | |
| `PersistentVolumeClaim` | NS-OK | |
| `ServiceAccount` | NS-OK | |
| `Job` (registro de analizadores) | NS-OK si es idempotente |
| `Ingress` | PATCH o deshabilitar |
| `PrivilegedContainer` (Docker-in-Docker para el sandboxing de analizadores, si upstream usa este patrón) | **FORBIDDEN**: parchear | Los analizadores de Cortex que requieren sandboxing con Docker están fuera de alcance para este lanzamiento. Usa solo analizadores que se ejecuten in-process o que llamen a servicios externos con sandbox |

**Riesgo conocido**: históricamente, Cortex ejecuta algunos analizadores como subprocesos o contenedores Docker. Este lanzamiento se limita a analizadores de "código puro" que no requieren acceso privilegiado al host. La lista de analizadores está fijada en values; los analizadores que requieren Docker-in-Docker se rechazan en el momento del aprovisionamiento.

## Lista de prerrequisitos del clúster (incorporada a la guía de instalación + verificación de prereq del chart `soctalk-system`)

Tras la auditoría, estos están **fuera de alcance para el chart de tenant** y deben existir en el clúster antes de que `soctalk-tenant` se aplique a cualquier namespace:

| Prerrequisito | Por qué | fuente |
|---|---|---|
| K3s 1.30+ (o K8s 1.30+ compatible) | Base más `ValidatingAdmissionPolicy` v1 | Responsabilidad del MSSP |
| CNI que aplique NP (Cilium primario, Calico alternativo) | Aplicación del aislamiento | Responsabilidad del MSSP |
| cert-manager | TLS para Ingress, emisión de certificados de Wazuh por tenant | Responsabilidad del MSSP; la guía de instalación provee la receta de `helm install` |
| Controlador de Ingress (Traefik por defecto en K3s, ingress-nginx común) | Enrutamiento de la UI del MSSP + UI del Cliente + WebUI por tenant | Responsabilidad del MSSP |
| `StorageClass` dinámico (local-path, longhorn, CSI de proveedor cloud, etc.) | Aprovisionamiento de PVC | Responsabilidad del MSSP |
| `VolumeSnapshotClass` si se usan snapshots CSI | Runbook de backup/restore (solo docs) | Opcional |

El chart `soctalk-system` incluye un hook de pre-instalación (`helm.sh/hook: pre-install`) que verifica:
- CNI que aplica NP activo (sondea marcadores de Cilium o Calico)
- CRDs de cert-manager presentes
- `StorageClass` por defecto configurado

El hook falla rápido con un mensaje de error accionable si falta alguno.

## Estrategia de parcheo

Dos caminos:

1. **Overrides basados en values**: preferir los values del chart upstream que deshabilitan el objeto no deseado (p. ej., `ingress.enabled: false`, `networkPolicy.enabled: false` si la de upstream es más laxa que la nuestra, `rbac.create: true` limitado solo al namespace).
2. **Overlay al estilo Kustomize** (la integración `kustomize` de Helm o un hook de post-render) para objetos que no se pueden deshabilitar vía values: eliminar `ClusterRole`s, quitar volúmenes `hostPath`, definir `securityContext`.

Incorporamos (vendor) los charts upstream como dependencias de subchart fijadas en `charts/soctalk-tenant/charts/`, no como referencias de `helm repo`. Esto nos permite:
- Fijar a versiones exactas (sin actualizaciones sorpresa de upstream)
- Aplicar parches según sea necesario sin depender de la aceptación de PRs en upstream
- Firmar nuestro bundle como un único artefacto (un lanzamiento futuro cuando llegue cosign)

Si upstream no cumple nuestras necesidades tras los parches, el fallback es escribir plantillas nativas de SocTalk que llamen a las mismas imágenes de contenedor con nuestros propios manifiestos. La validación previa al lanzamiento decide esto por chart.

## Incógnitas conocidas (la validación previa al lanzamiento las resuelve)

Elementos que requieren ejecuciones reales de `helm template` + inspección para confirmar:

- [ ] **Wazuh**: ¿la versión de chart elegida requiere CRDs para el despliegue orientado a operador? Si es así, mueve los CRDs al chart `soctalk-system`.
- [ ] **TheHive**: ¿Cassandra requiere un `StorageClass` con características específicas (p. ej., solo RWO, IOPS mínimas)? Documéntalo en el dimensionamiento.
- [ ] **Cortex**: ¿qué analizadores están habilitados por defecto y alguno requiere Docker-in-Docker? Produce una allowlist de analizadores seguros.
- [ ] **Todos los charts**: ¿algún `Job` o `CronJob` que se ejecute con un `ServiceAccount` más allá del namespace? Aplica parche a una SA local del namespace.
- [ ] **Todos los charts**: ¿algún `initContainer` con `privileged: true` o montajes `hostPath`? Parchear o reemplazar.
- [ ] **Todos los charts**: `resources.requests` y `limits` por defecto: comparar con el perfil de dimensionamiento; sobreescribir en values donde sea necesario.

Cada elemento abierto se convierte en una entrada de la lista de verificación de validación previa al lanzamiento. El output del spike es una tabla de clasificación completada y el chart parcheado listo para `charts/soctalk-tenant/charts/`.

## Artefacto de salida (producido antes del envío)

El spike produce:

1. **Inventario de objetos clasificado** (completando las tablas de la sección 3 con los objetos realmente renderizados).
2. **Bundles de chart parcheados** incorporados a `charts/soctalk-tenant/charts/wazuh/`, `thehive/`, `cortex/` con versiones fijadas.
3. **Lista de prerrequisitos del clúster** integrada a la guía de instalación.
4. **Allowlist de analizadores** para Cortex (conjunto solo-seguro).
5. **Fragmento de esquema de values** para cada subchart (inputs que SocTalk proveerá por tenant).

La finalización del spike es un prerrequisito para la implementación del Helm chart.
