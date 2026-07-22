# Copia de seguridad y restauración

Qué respalda un MSSP, con qué frecuencia y cómo restaurarlo. SocTalk mantiene tres capas de estado; cada una tiene su propia ruta de copia de seguridad y restauración.

Esta página amplía [Operaciones diarias, Restauración de la base de datos](/es-419/operations#database-restore-disaster-recovery), que es el mismo procedimiento documentado a nivel de runbook. Usa esta página para planificar la estrategia; usa la de operaciones para las pulsaciones de teclas.

## Qué respaldar

### 1. Postgres (el plano de control)

`soctalk-system-postgres-0` contiene:

- Filas de tenants + eventos de ciclo de vida
- Usuarios, sesiones, roles
- Investigaciones, casos, ejecuciones, propuestas
- Configuración (LLM, integraciones, marca)
- `audit_log` de solo anexado y `case_events` con event sourcing
- Filas de outbox pendientes de consumo por el executor

**Tolerancia a pérdida: cero**. Un Postgres perdido = historial de auditoría perdido, sin investigaciones recuperables.

### 2. Secrets de Kubernetes en `soctalk-system`

| Secret (nombre renderizado por el chart) | Qué contiene |
|---|---|
| `soctalk-system-llm-api-key` | Clave de API del proveedor de LLM (predeterminada para toda la instalación) |
| `soctalk-system-bootstrap-admin` | Correo + contraseña del admin inicial (si `install.bootstrapAdmin.password` está definido en values) |
| `soctalk-system-jwt-signing-key` | Clave de firma del token de sesión |
| `soctalk-system-adapter-signing-key` | Clave de firma del token de adaptador |
| `soctalk-system-postgres-admin-creds` | Credenciales de Postgres `soctalk_admin` (migraciones) |
| `soctalk-system-postgres-app-creds` | Credenciales de Postgres `soctalk_app` (runtime) |
| `soctalk-system-postgres-mssp-creds` | Credenciales de Postgres `soctalk_mssp` (consultas cross-tenant) |
| `soctalk-slack-creds` | Tokens de Slack (provistos por entorno; no renderizados por el chart) |
| `soctalk-thehive-creds` | Clave de API de TheHive (provista por entorno) |
| `soctalk-cortex-creds` | Clave de API de Cortex (provista por entorno) |

Un conjunto regenerado de Secrets es recuperable, pero las sesiones en curso se rompen y las credenciales de integración deben volver a pegarse.

### 3. PVCs por tenant

Para cada namespace `tenant-<slug>`:

| PVC | Qué contiene |
|---|---|
| `wazuh-indexer-data` | Todo el historial de alertas y eventos de Wazuh |
| `wazuh-manager-data` | Registros de agentes de Wazuh + estado del manager |
| `cortex-data` | Elasticsearch de Cortex (si Cortex está habilitado) |
| `thehive-data` | Cassandra de TheHive (si TheHive está habilitado) |

Los tenants con perfil `poc` usan `local-path`, que **no ofrece ninguna garantía real de persistencia**: un reinicio de nodo puede perder datos. Los tenants con perfil `persistent` usan la StorageClass que la instalación marque como predeterminada; respalda según la documentación de ese aprovisionador.

## Cadencia

| Capa | Cadencia sugerida | Retención |
|---|---|---|
| Copia lógica de Postgres (`pg_dump`) | diaria | 30 días |
| Archivado de WAL de Postgres | continuo | 7 días |
| Snapshot de Secrets de Kubernetes | semanal + en cada rotación | 90 días |
| PVCs por tenant | según el SLA de tu cliente (típicamente diaria para trabajo de cumplimiento) | por contrato |

Los clientes de cumplimiento (PCI, HIPAA, SOC 2) a menudo requieren retención más larga. Trata lo anterior como el mínimo.

## Copia de seguridad de Postgres

### pg_dump (lógica)

Se ejecuta contra la base de datos en vivo, sin tiempo de inactividad. Restauración más lenta que la copia física pero comprime bien y es portable.

```bash
kubectl -n soctalk-system exec soctalk-system-postgres-0 -- \
  pg_dump -U soctalk_app -d soctalk -Fc -Z 9 \
  > soctalk-$(date +%Y%m%d).pgdump
```

Canalízalo a tu almacenamiento externo habitual (S3, GCS, Azure Blob).

### Archivado de WAL (point-in-time)

**No está conectado a través del chart en esta versión.** El chart `soctalk-system` no expone un value `postgres.archiveCommand`, por lo que PITR requiere un despliegue de Postgres fuera del StatefulSet incluido en el chart. Dos rutas:

1. **Ejecuta Postgres externamente** (RDS gestionado / Cloud SQL / Azure Database for PostgreSQL). Configura el archivado de WAL / PITR según la documentación del proveedor. **Apuntar el chart a un Postgres externo no está conectado a través de values en V1**: el chart codifica de forma fija los detalles de conexión del StatefulSet incluido en los Secrets de credenciales de rol. Hoy esto significa ejecutar tu propio overlay de helm que parchee la variable de entorno `DATABASE_URL` del Deployment de la API, o modificar `soctalk-system-postgres-app-creds` / `-mssp-creds` / `-admin-creds` después de la instalación. Un control de values `postgres.external` está en el roadmap.
2. **Archivador sidecar** en tu propio overlay de helm (p. ej., [`spilo`](https://github.com/zalando/spilo) o [`wal-g`](https://github.com/wal-g/wal-g) como sidecar). Fuera del alcance del chart; se ejecuta como un Deployment separado que transmite WAL al almacenamiento de objetos.

De cualquier forma, el lado de SocTalk no cambia, el plano de datos trata a Postgres como una dependencia externa. Conectar un `archiveCommand` del lado del chart está previsto para una versión futura.

## Restauración (Postgres)

Consulta el [runbook](/es-419/operations#database-restore-disaster-recovery). Resumen:

1. Escala la API a cero para que nada esté escribiendo (el chart de V1 incluye el orquestador dentro del pod de la API, un solo Deployment).
2. Ejecuta `pg_restore` del dump (limpia primero la base de datos).
3. Si usas WAL: reproduce el WAL hasta el point-in-time deseado.
4. Vuelve a escalar la API.

Después de la restauración, el pod de la API (que incrusta el orquestador en el chart de V1) puede necesitar un empujón para volver a tomar las ejecuciones pendientes:

```bash
kubectl -n soctalk-system rollout restart deploy soctalk-system-api
```

## Copia de seguridad de Secrets

Los Secrets de K8s son tediosos de respaldar de forma segura debido al material secreto. Dos patrones:

### Sealed Secrets (recomendado)

Instala [Bitnami sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) una vez por clúster. Convierte tus Secrets en recursos `SealedSecret`; súbelos a git. El controlador del clúster los descifra en el momento de la instalación. La pérdida de un Secret es recuperable desde git.

### Velero con restic / kopia

[Velero](https://velero.io) respalda recursos de Kubernetes (incluidos los Secrets) más los PVCs al almacenamiento de objetos. Usa el [snapshotter CSI in-tree](https://velero.io/docs/main/csi/) para los PVCs y la copia de recursos estándar para los Secrets.

```bash
velero backup create soctalk-system-daily \
  --include-namespaces soctalk-system \
  --snapshot-volumes \
  --schedule "0 2 * * *"
```

## Copia de seguridad de PVCs por tenant

Los tenants con perfil `persistent` usan una StorageClass real; usa las herramientas de snapshot de ese aprovisionador:

- **Longhorn**: copias programadas integradas a S3
- **Rook/Ceph**: snapshots de RBD o `cephfs-mirror`
- **Volúmenes de nube CSI (EBS/Persistent Disk/Azure Disk)**: APIs de snapshot nativas

Para usuarios de Velero, `velero backup create tenant-<slug>-daily --include-namespaces tenant-<slug> --snapshot-volumes` cubre tanto los PVCs como los objetos de K8s de una sola vez.

## Restauración por tenant

1. Da de baja el tenant existente (si lo hay), esto elimina el namespace.
2. Restaura los PVCs a un namespace nuevo desde el snapshot.
3. Incorpora un tenant con el mismo slug y perfil mediante `POST /api/mssp/tenants/onboard`: el aprovisionamiento es idempotente sobre el namespace, por lo que la instalación de Helm adoptará los PVCs restaurados.
4. Verifica que Wazuh vea los agentes existentes (no se necesita re-inscripción si la restauración del PVC fue limpia).

Si solo el plano de datos está corrupto (no el plano de control de SocTalk), la ruta más simple es `helm rollback tenant-<slug>` y luego restaurar los PVCs in situ.

## Simulacro de restauración

Ejecuta un simulacro de restauración trimestralmente. Elige un clúster que no sea de producción o un tenant temporalmente inactivo. Limítalo a 4 h. Documenta lo que falló y actualiza esta página.

Fallos comunes que el simulacro detecta:

- Brecha en el WAL (el archivado se atrasó durante una falla de nodo)
- Secrets que fueron rotados desde la última copia de seguridad
- Discrepancia de StorageClass entre el clúster y el snapshot
- Política de red que bloquea al pod restaurado para alcanzar el nuevo Postgres

## Qué no se cubre aquí

- Recuperación ante desastres de todo el clúster (pérdida de nodos del plano de control, etc.), eso es operaciones de Kubernetes, no específico de SocTalk. Consulta la documentación de tu distribución.
- Recuperación de credenciales del proveedor de LLM, fuera del alcance; gestiónala con tu runbook normal de rotación de secretos.
- Copias de seguridad de endpoints del lado del cliente, responsabilidad del cliente, no del MSSP.
