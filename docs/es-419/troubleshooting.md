# Resolución de problemas

Síntoma → diagnóstico → solución. Runbook para los modos de falla más comunes.

| Síntoma | Primera verificación | Solución |
|---|---|---|
| `helm install soctalk-system` falla en el hook de pre-instalación | `kubectl logs -n soctalk-system job/<release>-preinstall-check` | Instala el prerrequisito de clúster faltante (CNI, cert-manager, StorageClass) según la guía de [Instalación](/es-419/install#cluster-prerequisites) |
| El pod de la API entra en `CrashLoopBackOff` al arrancar | `kubectl logs -n soctalk-system deploy/soctalk-system-api` | Lo más frecuente: un Secret `DATABASE_URL` incorrecto, Postgres aún no está listo, o una falla en la migración de Alembic. Revisa primero el pod de Postgres |
| `helm install` tiene éxito pero la UI de MSSP devuelve 502 | Logs del controlador de ingress; verifica que los `endpoints` del Service de ingress estén poblados | El proxy OIDC no está desplegado o no está inyectando encabezados de confianza. Revisa el CIDR del proxy de confianza |
| La creación de un Tenant devuelve 500 | Los logs de la API muestran `ProvisionError` | Normalmente `helm install tenant-*` falló. Revisa `helm status tenant-<slug>`. Los problemas de namespace y de cuota de recursos son los más comunes |
| Un Tenant queda atascado en `provisioning` > 15 min | `kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp` | Consulta [Tenant atascado en provisioning](/es-419/operations#tenant-stuck-in-provisioning) en operaciones |
| Un Tenant pasa a `degraded` | Logs del adaptador en el namespace del Tenant | Egress de NetworkPolicy, caída del pod del adaptador, o DNS mal resuelto |
| Se ven datos entre Tenants | Ejecuta la suite de pruebas de aislamiento | **Incidente P1.** RLS es la última línea de defensa; una falla indica un bug de la aplicación o una mala configuración de roles de Postgres |
| Las llamadas al LLM fallan para un Tenant | Logs del worker: busca 401/403 del proveedor del LLM | El runs-worker lee desde `Secret/tenant-llm-key` en el namespace `tenant-<slug>`. La fuente autoritativa es `IntegrationConfig.llm_api_key_plain` en Postgres; rótala mediante `PATCH /api/mssp/tenants/{id}/llm` (UI: detalle del tenant → Settings → LLM), que reescribe el Secret y reinicia el runs-worker |
| El agente de Wazuh no puede conectarse | La IP del LB del Tenant (o la IP+puerto del HAProxy de borde) es alcanzable desde el host del agente; el DNS de `<slug>.soc.mssp.*` resuelve a ella; los puertos 1514/1515 están abiertos a través de cualquier firewall intermedio | Consulta [Wazuh Ingress](/es-419/reference/wazuh-ingress). 1514 es el protocolo propietario de Wazuh; no hay SNI que inspeccionar; el enrutamiento es por dirección de destino o puerto. Verifica que el `Service` del Tenant (`type: LoadBalancer` o el puerto de HAProxy) sea la dirección a la que apunta el agente |
| El StatefulSet de Postgres no arranca (PVC en Pending) | `kubectl describe pvc -n soctalk-system` | No hay un StorageClass por defecto, la clase no soporta RWO, o el clúster se quedó sin disco |
| Mensajes de `PolicyViolation` del controlador de ingress | Reglas allow de NetworkPolicy | Asegúrate de que el namespace de ingress esté etiquetado con `kubernetes.io/metadata.name=ingress-system` |
| Cilium Hubble muestra flujos DROPPED entre el Tenant y `soctalk-system` | NetworkPolicies + identidades de Cilium | La política de egress del adaptador falta o tiene un `namespaceSelector` incorrecto |
| El login de un usuario cliente devuelve 403 en `/api/tenant/*` | Claims del JWT | Asegúrate de que la fila del usuario tenga `tenant_id` definido y `role=customer_viewer` |
| La suplantación (impersonation) de un usuario MSSP no aparece en la auditoría del cliente | Consulta de auditoría | Verifica que la columna `acting_as` se pueble al escribir; la vista de auditoría del cliente hace join con `tenant_id = own AND acting_as IS NOT NULL` |
| La prueba de aislamiento falla en CI (el admin con FORCE RLS puede ver filas) | ¿Se aplicó la migración? | Vuelve a ejecutar `alembic upgrade head`; asegúrate de que `FORCE ROW LEVEL SECURITY` esté aplicado a cada tabla con alcance de Tenant |
| ImagePullBackOff en el `soctalk-adapter` / `soctalk-runs-worker` del Tenant | `kubectl -n tenant-<slug> describe pod` muestra una falla de pull para `ghcr.io/soctalk/soctalk-adapter:0.1.13-fixes` (o similar) | Conocido: `render.py` usa por defecto un tag que puede no estar en el ghcr público. Anúlalo al momento de instalar: define `tenantProvisioning.adapterImageTag: latest` y `tenantProvisioning.runsWorkerImageTag: latest` en los values de `soctalk-system`. Estos se propagan a las variables de entorno `SOCTALK_TENANT_ADAPTER_IMAGE_TAG` / `SOCTALK_TENANT_RUNS_WORKER_IMAGE_TAG` en el Deployment de la API, que el render de provisioning lee |

## Recolección de paquetes de diagnóstico

Al escalar al soporte, recolecta:

```bash
# Estado a nivel de sistema de SocTalk
kubectl get all,events,networkpolicies,resourcequotas \
  -n soctalk-system -o yaml > soctalk-system.yaml
kubectl -n soctalk-system logs deploy/soctalk-system-api --tail=500 > api.log
# (El chart V1 empaqueta el orquestador dentro del pod de la API — sin Deployment aparte)

# Tenant específico
kubectl get all,events,networkpolicies,resourcequotas,limitranges \
  -n tenant-<slug> -o yaml > tenant.yaml
kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=500 > adapter.log

# Estado de Helm
helm status -n soctalk-system soctalk-system > helm-system.txt
helm status -n tenant-<slug> tenant-<slug> > helm-tenant.txt

# Versión de SocTalk + eventos de ciclo de vida del tenant
# soctalk-cli debug-bundle se documentó en borradores anteriores; no está implementado.
# Captura los datos a mano con los pasos de kubectl/helm anteriores.

tar czf soctalk-debug-$(date +%s).tgz *.yaml *.log *.txt
```

**Revisa el tarball en busca de datos de clientes antes de compartirlo externamente.** Los logs pueden contener fragmentos de alertas.
