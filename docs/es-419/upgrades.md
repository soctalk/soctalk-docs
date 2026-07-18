# Actualizaciones

Ambas clases de chart se actualizan mediante `helm upgrade`. Hoy esto es un runbook; una API de actualización para toda la flota está en el roadmap.

## Lista de verificación previa

Antes de cualquier actualización:

1. **Lee las [notas de la versión](https://github.com/soctalk/soctalk/releases)** de la versión de destino. Las migraciones son solo hacia adelante; un cambio de esquema inesperado no puede revertirse con `helm rollback`.
2. **Actualiza `soctalk-system` antes que los tenants.** Una superficie formal de matriz de compatibilidad (interfaz System → Versions, validación `controller.can_upgrade`) se describe en [Chart Contract](/es-419/reference/chart-contract) como el objetivo arquitectónico, pero **no está implementada en esta versión**. Hasta que se publique, sigue la línea de "combinaciones probadas" de las notas de la versión, actualiza `soctalk-system` primero y luego actualiza cada tenant una vez que hayas verificado la actualización del lado del sistema.
3. **Haz una copia de seguridad.** Toma una instantánea de Postgres + todos los PVC de los tenants. Consulta la [sección de restauración de la base de datos](/es-419/operations#database-restore-disaster-recovery) en operaciones.
4. **Ejecuta un simulacro (dry-run)** con `helm diff`:
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## Actualizar `soctalk-system` (nivel de instalación)

`soctalk-system-values.yaml` de la instalación fija `image.tag` a la versión original. Sobrescríbelo en cada actualización para que el nuevo chart renderice la nueva imagen. Ya sea que actualices el archivo en el control de versiones o pases `--set image.tag=<new-version>` en cada comando de abajo.

Las migraciones se ejecutan dentro del comando de init del pod de la API (consulta [Instalación → Migraciones y arranque](/es-419/install#migrations-and-bootstrap-run-automatically)). Un `helm upgrade` reinicia el pod de la API; el comando de init ejecuta `alembic upgrade head` antes de que arranque la nueva app. Alembic es idempotente: volver a ejecutarlo sobre un esquema actualizado no tiene efecto.

```bash
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 15m
```

Observa la migración:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Si `--wait` se queda colgado, la causa más común es un fallo de migración: revisa los logs de init.

### Rollback

```bash
helm rollback soctalk-system <revision> -n soctalk-system --wait
```

Si la actualización introdujo una migración que tocó datos, `helm rollback` no revertirá el esquema. Restaura además Postgres desde la copia de seguridad previa a la actualización.

## Actualizar el plano de datos de un solo tenant

```bash
helm upgrade tenant-<slug> oci://ghcr.io/soctalk/charts/soctalk-tenant \
  --version <new-tenant-chart-version> \
  --namespace tenant-<slug> \
  -f /tmp/tenant-<slug>-values.yaml \
  --wait --timeout 15m
```

`/tmp/tenant-<slug>-values.yaml` es el archivo de values renderizado por SocTalk. Hoy no existe una CLI orientada al operador para volcarlo; extrae los últimos values renderizados desde el secret del release de Helm del tenant:

```bash
helm get values tenant-<slug> -n tenant-<slug> -a > /tmp/tenant-<slug>-values.yaml
```

Un comando `soctalk-cli render-values` se mencionó anteriormente en esta guía, pero no existe: la única herramienta de CLI hoy es `soctalk-auth`.

### Rollback por tenant

```bash
helm rollback tenant-<slug> <revision> -n tenant-<slug> --wait
```

Los rollbacks del plano de datos del tenant son más seguros que los de nivel de sistema: los stacks OSS (Wazuh, TheHive, Cortex) almacenan sus propios datos en PVC que `helm rollback` deja intactos.

## Actualización de la flota (bucle manual)

```bash
# Listar tenants.
kubectl get ns -l tenant=true,managed-by=soctalk \
  -o jsonpath='{.items[*].metadata.name}'

# Actualizar cada uno, pausando entre ellos.
for ns in tenant-acme tenant-beta tenant-gamma; do
  echo "upgrading $ns..."
  helm upgrade ${ns} oci://ghcr.io/soctalk/charts/soctalk-tenant \
    --version <new> -n $ns -f /tmp/${ns}-values.yaml --wait --timeout 15m
  kubectl -n $ns rollout status deploy/soctalk-adapter
  sleep 60   # dejar que el heartbeat se estabilice antes del siguiente.
done
```

Una versión futura reemplaza este bucle con una API de actualización de flota con reconocimiento de canary.

## Orden de actualización

1. Prerrequisitos del clúster (CNI, cert-manager, ingress). Actualízalos de forma independiente.
2. El chart `soctalk-system`. Ejecuta las migraciones como parte de la actualización de nivel de instalación.
3. El chart `soctalk-tenant`, un tenant a la vez, vigilando regresiones.

Nunca actualices los charts de tenant antes que `soctalk-system`. La matriz de compatibilidad rechaza las combinaciones fuera de rango y la API se niega a aprovisionar nuevos tenants en versiones que no coinciden.

## Actualizaciones del chart de tenant con cambios incompatibles

Si el chart de tenant sube una versión mayor de Wazuh, TheHive o Cortex con un cambio de esquema:

1. Toma primero una instantánea de los PVC del tenant.
2. Actualiza en una ventana de bajo tráfico.
3. Verifica que las alertas fluyan de extremo a extremo inmediatamente después.
4. Prepárate para ejecutar `helm rollback` más restaurar los PVC si el proceso de migración de esquema del plano de datos falla.

Los proyectos OSS upstream ocasionalmente publican cambios incompatibles. La [auditoría del chart](/es-419/reference/chart-audit) fija versiones exactas de los subcharts; subir esas versiones es explícito y se prueba antes de la publicación.
