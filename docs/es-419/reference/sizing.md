# Perfil de dimensionamiento para instalaciones piloto


## Perfiles de referencia

Dos tamaños de host de referencia para esta versión.

### small-dev

Destinado a: desarrollo, demos, POC de un solo tenant.

| Recurso | Valor |
|---|---|
| CPU | 4 vCPU |
| RAM | 16 GB |
| Disco | 100 GB SSD |
| Tenants máximos | **1–2** |
| Plano de control de SocTalk reservado | ~2 GB RAM, 1 vCPU |
| Presupuesto por tenant | ~6–8 GB RAM, 1–1.5 vCPU |

Los tiempos de arranque son más lentos aquí; aplica el SLO `<30 min to OSS stack healthy`.

### pilot-prod

Destinado a: MSSP que ejecuta clientes piloto reales, 3–5 tenants.

| Recurso | Valor |
|---|---|
| CPU | 8 vCPU |
| RAM | 32 GB |
| Disco | 500 GB SSD |
| Tenants máximos | **3–5** |
| Plano de control de SocTalk reservado | ~3 GB RAM, 1–2 vCPU |
| Presupuesto por tenant | ~5–7 GB RAM, 1–1.5 vCPU |

Los tiempos de arranque cumplen el SLO `<15 min to OSS stack healthy`.

## Huella por tenant (estimaciones)

Estos son valores de punto de partida para `ResourceQuota` y `LimitRange` en el chart del tenant. La validación previa al lanzamiento mide los valores reales; los valores reales reemplazan a estos en los values finales.

| Componente | Solicitud de RAM | Límite de RAM | Solicitud de CPU | Límite de CPU | Disco (PVC) |
|---|---|---|---|---|---|
| Wazuh manager | 512 MB | 1 GB | 200 m | 500 m | 20 GB |
| Wazuh indexer (fork de OpenSearch) | 2 GB (heap 1 GB) | 4 GB (heap 2 GB) | 500 m | 2000 m | 50 GB |
| Wazuh dashboard | 512 MB | 1 GB | 100 m | 500 m | |
| Filebeat | 128 MB | 256 MB | 50 m | 200 m | |
| linux-ep (agente de endpoint L2) | 256 MB | 512 MB | 100 m | 500 m | |
| Adaptador de SocTalk | 128 MB | 256 MB | 50 m | 200 m | |
| **Presupuesto reservado por tenant** | **~8 GB de solicitud, ~16 GB de límite** | | **~2.2 vCPU de solicitud, ~7.7 vCPU de límite** | | **~120 GB** |

TheHive y Cortex son integraciones externas, no subcharts empaquetados, así que se ejecutan fuera del namespace del tenant y no forman parte de esta huella por tenant; dimensiónalos donde estén alojados. El stack empaquetado en el namespace es Wazuh más el agente linux-ep, de modo que el presupuesto reservado anterior lleva margen sobre los pods actuales en el namespace.

Nota: los límites son techos de ráfaga; el uso sostenido se acerca más a las solicitudes. Ejecutar 3 tenants en un host de 8 vCPU / 32 GB / 500 GB significa:
- RAM: ~24 GB de solicitudes (cabe), ~48 GB de límites (requiere un ajuste cuidadoso del overcommit).
- CPU: ~6.6 vCPU de solicitudes (cabe junto con el plano de control), las ráfagas comparten el total.
- Disco: ~360 GB de PVC de tenants (cabe con margen para el plano de control + la base de datos de SocTalk).

Por eso `pilot-prod` se limita a 5 tenants; más allá de 5, los límites de memoria empiezan a chocar con la capacidad del nodo incluso contando el overcommit.

## Fórmula de tenants máximos por nodo

Aproximación:

```
max_tenants = floor((node_total_RAM - control_plane_RAM - safety_margin) / per_tenant_RAM_request)
```

- `control_plane_RAM`: 2 GB (small-dev) o 3 GB (pilot-prod) para SocTalk + Postgres + controlador de ingress + Cilium + cert-manager.
- `safety_margin`: 10% de la RAM del nodo para los pods de sistema de K8s, CNI, DNS y monitoreo.
- `per_tenant_RAM_request`: 8 GB como línea base.

Para pilot-prod de 32 GB: `floor((32 - 3 - 3.2) / 8) = floor(25.8 / 8) = 3` tenants garantizados sin overcommit. Con overcommit, 4–5 es seguro para volúmenes de alertas típicos.

## Factores del dimensionamiento de disco

El mayor consumidor de disco es el Wazuh indexer (almacena eventos indexados). La tasa de ingesta determina el crecimiento:

| Tasa de alertas | Tamaño diario del índice (aproximado) | Retención 30 días | Retención 90 días |
|---|---|---|---|
| 10 alertas/seg sostenidas | ~5 GB/día | 150 GB | 450 GB |
| 1 alerta/seg sostenida | ~500 MB/día | 15 GB | 45 GB |
| 100 alertas/día | ~10 MB/día | 300 MB | 900 MB |

Los tamaños de PVC de tenant en el chart tienen como valor por defecto **50 GB** para el Wazuh indexer; los MSSP los sobrescriben por tenant para clientes de alto volumen.

La política de retención tiene como valor por defecto 30 días de datos calientes en el indexer; los datos más antiguos se eliminan o se archivan (no implementa la estratificación caliente→fría; una versión futura la agrega).

## Compuertas de dimensionamiento

### Verificación previa al aprovisionamiento

Cuando el operador MSSP crea un nuevo tenant, el controlador de SocTalk ejecuta una comprobación de coherencia:

```
available_RAM = node.allocatable.memory - sum(ns.resourceQuota.requests.memory for ns in existing_tenant_namespaces) - control_plane_reserve
if (new_tenant.resourceQuota.requests.memory > available_RAM):
    refuse with "insufficient cluster capacity for new tenant"
    or
    prompt MSSP: "this will overcommit; proceed? [y/N]"
```

Esta compuerta es más suave en esta versión (advierte en lugar de fallar de forma dura) dado que los MSSP pueden hacer overcommit de forma intencional para clientes de uso ligero.

### Aplicación de LimitRange por tenant

Cada namespace de tenant tiene un `LimitRange`:

```yaml
apiVersion: v1
kind: LimitRange
metadata: { name: tenant-limits, namespace: tenant-acme }
spec:
  limits:
    - type: Container
      default:
        memory: "2Gi"
        cpu: "500m"
      defaultRequest:
        memory: "256Mi"
        cpu: "100m"
      max:
        memory: "6Gi"
        cpu: "2"
```

Evita que un pod mal configurado por accidente solicite 30 GB y deje sin recursos al nodo.

## Perfiles más allá

Documentados pero no validados en esta versión:

| Perfil | CPU | RAM | Disco | Tenants máximos |
|---|---|---|---|---|
| **mid-host** | 16 vCPU | 64 GB | 1 TB | 10–15 |
| **large-host** | 32 vCPU | 128 GB | 2 TB | 25–30 |
| **cluster multi-nodo** | 3 nodos × large | | - | 50+ (en su lugar se recomienda la instalación múltiple de una versión futura) |

Recomendación para MSSP que superan la capacidad de `pilot-prod`:
- : agregar un segundo host, ejecutar una segunda instalación de SocTalk (el esquema lo soporta, la herramienta es manual).
- una versión futura: automatización de instalación múltiple en la capa Cloud.
- una versión futura: K3s en clúster con planificación adecuada entre nodos.

## Plan de medición (validación previa al lanzamiento)

El spike produce números reales para reemplazar las estimaciones de §2:

1. Desplegar `soctalk-tenant` con un tenant en `k3d` (dev-harness).
2. Medición en reposo: tomar una instantánea de `kubectl top pod -n tenant-acme`.
3. Prueba de carga: inyectar 10 alertas/seg durante 10 minutos; medir el pico.
4. Detener la carga; medir ~5 minutos después para obtener los números de "warm-idle".
5. Repetir con tres tenants en paralelo para observar la interferencia.
6. Actualizar las tablas de este documento con los valores medidos.
