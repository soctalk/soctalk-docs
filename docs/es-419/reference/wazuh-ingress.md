# Ingreso de agentes Wazuh e inscripción de certificados


## Problema

Cada tenant tiene un Wazuh manager dedicado que se ejecuta en el namespace `tenant-<slug>`. Los agentes Wazuh se instalan en los endpoints del cliente (fuera del clúster del MSSP) y deben conectarse al Wazuh manager de **su tenant** en:

- **1514/TCP**: flujo de eventos del agente (cifrado con el protocolo nativo de Wazuh sobre TLS)
- **1515/TCP**: inscripción del agente / `authd` (registro mediante secreto compartido)

Restricciones:

- Muchos tenants en un mismo clúster → no se pueden exponer 1514/1515 en un único NodePort (colisión de puertos).
- Los agentes deben alcanzar únicamente el manager de *su* tenant (no el de otro tenant).
- Los endpoints del cliente están en redes desconocidas (LAN corporativa, VMs en la nube, laptops): conectividad a través de internet público en la mayoría de los casos.
- Los certificados TLS deben ser específicos por tenant (cadena de confianza acotada por cliente).

## Patrón elegido: dirección por tenant en el borde del MSSP

Cada tenant obtiene un nombre DNS dedicado (`acme.soc.mssp.example.com`) que resuelve a un endpoint L4 por tenant en el borde del MSSP. El enrutamiento hacia el Wazuh manager correcto se hace por dirección de destino, no por inspección del hostname.

**Por qué no enrutamiento L4 basado en SNI.** El protocolo de agente de Wazuh en 1514/TCP es un flujo propietario cifrado con AES, no TLS estándar, por lo que las conexiones no transportan un ClientHello con SNI. Un proxy L4 que ramifica según `req.ssl_sni` no verá ninguno y el tráfico del agente cae al backend por defecto. El canal de inscripción 1515/TCP sí negocia TLS, pero el enrutamiento debe usar el mismo discriminador que 1514 o los dos puertos divergen.

Se admiten dos implementaciones de direccionamiento por tenant:

1. **Service LoadBalancer por tenant (patrón recomendado; aún no cableado en el chart).** El subchart `wazuh` actual crea el `Service` del Wazuh manager solo como `ClusterIP`; en esta versión **no hay aprovisionamiento automático de LoadBalancer ni de DNS**. Para hacer un tenant enrutable desde internet público hoy, debes: agregar tú mismo un Service LoadBalancer externo (`kubectl apply` manual), colocar cada tenant detrás de un HAProxy / NGINX de borde con SNI o mapeo de puertos por tenant, o usar la topología de puerto por tenant descrita más abajo. LB en la nube + DNS por tenant es el destino documentado; llegar ahí requiere cableado manual del lado del MSSP.
2. **Puerto por tenant en una única IP de borde (alternativa).** Cuando las IPs únicas escasean, asigna un rango de puertos en una IP de borde y asigna desplazamientos `(1514, 1515)` por tenant (p. ej., acme → 15140/15141, beta → 15142/15143). El DNS usa registros `SRV` o la configuración `manager_address:port` del agente para despachar. Operativamente incómodo, pero funciona.

### Topología

```
Customer endpoint (Wazuh agent)
        │
        │ TCP 1514 to acme.soc.mssp.example.com
        │ (Wazuh agent protocol; not standard TLS)
        ▼
DNS resolves to the LoadBalancer IP for tenant-acme
        │
        ▼
┌───────────────────────────────────┐
│ MSSP cluster ingress for          │
│ tenant-acme/wazuh-manager         │
│ (cloud LB IP or MetalLB-assigned) │
└─────────────┬──────────────────────┘
              │ cluster-internal forward
              ▼
  tenant-acme namespace
  ┌─────────────────┐
  │ wazuh-manager   │
  │ Service: 1514   │
  │ Pod with        │
  │ tenant-specific │
  │ TLS cert (1515) │
  └─────────────────┘
```

### DNS

El registro `A`/`AAAA` por tenant: `<slug>.soc.mssp.example.com → <tenant LB IP>` es el diseño objetivo. **En la V1, SocTalk NO emite registros DNS**: el operador gestiona el DNS manualmente (external-dns / consola del proveedor) una vez que el LB por tenant se ha aprovisionado fuera de banda. Una ruta de emisión de DNS impulsada por SocTalk (anotaciones external-dns o integración directa con el proveedor) está en el roadmap.

El DNS con comodín no funciona para el patrón LoadBalancer porque cada tenant tiene su propia IP. Solo funciona bajo la topología alternativa (puerto por tenant), donde cada nombre resuelve a la misma IP de borde.

### Certificados TLS

Cada tenant obtiene un certificado cuyo SAN cubre `<slug>.soc.mssp.example.com`. Opciones:

- **Certificado por tenant vía cert-manager + Let's Encrypt** (recomendado para el MVP): un CR `Certificate` de cert-manager por tenant, emitido por un `ClusterIssuer` DNS-01 o HTTP-01: certificado almacenado en el ns `tenant-<slug>` como `Secret/wazuh-tls`: renovado automáticamente.
- **Certificado comodín para `*.soc.mssp.example.com`**: un solo certificado cubre todos los tenants. Más simple, pero implica que el Wazuh manager de cualquier tenant puede presentar el certificado para el agente de cualquier tenant durante fallos del proxy del lado del MSSP: riesgo aceptable para esta versión, ya que el enrutamiento es la verdadera aplicación de la política.
- **CA interna provista por el MSSP**: para MSSPs que operan su propia PKI, cert-manager puede emitir desde un `Issuer` en el clúster respaldado por la CA del MSSP.

La guía de instalación documenta las tres; el piloto usa por defecto Let's Encrypt por tenant.

### Aprovisionamiento de LoadBalancer

El MSSP ejecuta uno de los siguientes:

| Entorno | Fuente de LoadBalancer |
|---|---|
| Nube gestionada (EKS, GKE, AKS, …) | El controlador de balanceo de carga de la nube asigna una IP pública por cada `Service` de tipo `LoadBalancer`. |
| Bare-metal u on-prem | MetalLB (modo L2 o BGP) con un pool de direcciones, o kube-vip. |
| Borde de IP única con mapeo de puertos | Ejecuta un proxy L4 externo (HAProxy, Envoy, nginx-stream) que reenvía pares `(IP, port)` al `Service` del tenant. Usa esto solo bajo la topología alternativa de puerto por tenant. |

El diseño objetivo es que el `Service` del chart `soctalk-tenant` esté anotado para que los controladores de la nube y MetalLB puedan aplicar selección de pool/clase de IP (p. ej., `metallb.universe.tf/address-pool: wazuh-agents`), y el controlador de SocTalk registre la IP de LB resultante y escriba el registro DNS por tenant. **En la V1 ninguna de estas cosas está cableada**: el Service del Wazuh manager es solo `ClusterIP` y el controlador no consulta la asignación de IP de LB.

Si debes usar una única IP de borde (alternativa), un mapeo de referencia de HAProxy se ve así:

```
# Per-port routing — each tenant has its own 1514/1515 pair at the edge.
frontend wazuh-15140
    mode tcp
    bind *:15140
    default_backend tenant-acme-events
frontend wazuh-15141
    mode tcp
    bind *:15141
    default_backend tenant-acme-enroll
frontend wazuh-15142
    mode tcp
    bind *:15142
    default_backend tenant-beta-events

backend tenant-acme-events
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1514
backend tenant-acme-enroll
    mode tcp
    server wazuh wazuh-manager.tenant-acme.svc.cluster.local:1515
backend tenant-beta-events
    mode tcp
    server wazuh wazuh-manager.tenant-beta.svc.cluster.local:1514
```

No ramifiques según `req.ssl_sni` para Wazuh 1514. El protocolo de agente de Wazuh no es TLS estándar y nunca produce un ClientHello ahí. El SNI solo está disponible en 1515 (inscripción), lo cual es insuficiente: los eventos aún necesitarían un discriminador funcional.

## Flujo de inscripción del agente

El registro de `authd` de Wazuh en 1515/TCP requiere un secreto compartido. Cada tenant tiene su propio secreto de `authd`, almacenado en `Secret/wazuh-<slug>-wazuh-creds` (clave: `AUTHD_PASS`) en el namespace del tenant. Inscripción:

1. El **operador del MSSP** incorpora un nuevo cliente. SocTalk genera el secreto compartido de `authd` en el momento del aprovisionamiento del tenant.
2. El **operador del MSSP** proporciona al administrador del endpoint del cliente:
   - Hostname del Wazuh manager del tenant (`acme.soc.mssp.example.com`)
   - Puertos (1514 eventos, 1515 inscripción)
   - Secreto compartido de `authd` (por un canal seguro: plataforma de gestión de secretos, correo cifrado, lo que use el MSSP)
   - Instalador del agente Wazuh (paquete estándar upstream)
3. El **administrador del endpoint del cliente** instala el agente Wazuh con el hostname y lo inscribe:
   ```bash
   /var/ossec/bin/agent-auth \
       -m acme.soc.mssp.example.com \
       -P "<authd-shared-secret>"
   ```
4. El agente se registra con el manager del tenant y recibe su propio certificado por agente.
5. Las conexiones posteriores en 1514 son mTLS por agente.

El enrutamiento en 1515 usa la misma dirección por tenant que 1514 (IP de LB o puerto de borde). El secreto compartido de `authd` está acotado por tenant: un agente que usa el secreto de `acme` solo puede registrarse con el manager de `acme`: el direccionamiento lo impone y el manager verifica el secreto.

## Requisitos de firewall / red

Del lado del MSSP:
- IPs públicas para el proxy de borde (una IP, o IPs por región para MSSPs con regiones geodistribuidas).
- El proxy de borde permite entrada 1514/TCP, 1515/TCP desde 0.0.0.0/0 (o CIDRs específicos del cliente si el MSSP lo prefiere).
- El firewall interno del clúster (rango de NodePort o CIDR interno) permite proxy de borde → Wazuh manager del namespace del tenant.

Del lado del cliente:
- Los agentes permiten salida 1514/1515/TCP hacia el hostname de borde del MSSP.
- Sin entrada desde el MSSP hacia los endpoints del cliente (Wazuh no usa pull: los eventos se originan en el agente).

## Revocación de certificados / eliminación de agentes

> **Estado de la UI:** la pestaña de Agentes por tenant descrita a continuación está planificada. Hasta que se lance, usa la solución alternativa al final de esta sección.

Para revocar un agente específico (UX planificada):
1. El operador del MSSP abre el tenant en la UI del MSSP → pestaña Agentes → revoca.
2. SocTalk llama a la API del Wazuh manager para eliminar el registro del agente.
3. El administrador del endpoint del cliente desinstala el agente (opcional, tareas de mantenimiento).

**Hoy**, revoca directamente desde el dashboard de Wazuh embebido (lista de Tenants → **Open SOC** → Agentes) o vía la API del Wazuh manager:

```bash
kubectl -n tenant-<slug> exec deploy/wazuh-manager -- \
  /var/ossec/bin/manage_agents -r <agent-id>
```

Para revocar todos los agentes de un tenant (p. ej., baja del cliente):
1. Rota el secreto compartido de `authd` del tenant (se requiere reinscripción para los agentes nuevos).
2. Elimina todos los registros de agentes existentes vía la API de Wazuh.
3. La baja del tenant eventualmente desmantela el manager.

## Patrones de conectividad alternativos (documentados, no construidos)

### VPN / túnel gestionado por el cliente

Si la política de red de un cliente prohíbe que los agentes envíen telemetría por internet público:
- El cliente aprovisiona un túnel WireGuard/IPsec hacia la red privada del MSSP.
- El MSSP enruta el tráfico del túnel hacia el mismo proxy de borde (o directamente al clúster en direcciones internas).
- La configuración del agente apunta a un hostname interno.

No implementado en el tooling de esta versión; documentado como patrón de configuración para MSSPs que lo necesiten.

### Tailscale / red overlay

Similar al 6.1; el MSSP y el cliente se unen a una red Tailscale, y el agente alcanza `acme.soc.mssp.ts.net` directamente. Bueno para clientes pequeños; documentado.

### Borde del MSSP por región

Para MSSPs con separación geográfica (EU, US, APAC), ejecuta varios proxies de borde en distintas regiones. Cada tenant se asigna a su región más cercana y el DNS lo refleja (`acme.soc.eu.mssp.example.com`, `acme.soc.us.mssp.example.com`). El diseño lo admite porque el enrutamiento de proxy de borde a namespace de tenant es simplemente una búsqueda DNS interna del clúster. El despacho multirregión automatizado está en el roadmap.

## Runbook: incorporación del primer agente de un cliente

> **Estado de la UI:** el panel dedicado de "Incorporación de agentes" en el detalle del tenant está planificado pero aún no está en el build actual. El runbook a continuación describe la UX objetivo; la solución alternativa que le sigue es la ruta actual.

**UX planificada:**

1. El operador del MSSP crea el tenant en la [UI del MSSP](/es-419/mssp-ui) → SocTalk aprovisiona el stack, genera el secreto de `authd`.
2. El operador del MSSP navega al detalle del tenant → sección "Incorporación de agentes".
3. La sección muestra:
   - Hostname del tenant: `acme.soc.mssp.example.com`
   - Puertos: 1514/TCP (eventos), 1515/TCP (inscripción)
   - Secreto compartido de `authd` (enmascarado; copiar al portapapeles + revelación de una sola vez)
   - Comando `agent-auth` de ejemplo
   - Requisitos de firewall
4. El operador del MSSP copia al canal seguro y comparte con el administrador del endpoint del cliente.
5. El administrador del endpoint del cliente instala + inscribe.
6. El operador del MSSP observa el detalle del tenant → pestaña Agentes, ve aparecer el agente en ~30 segundos.

**Solución alternativa actual:**

1. Crea el tenant desde la [UI del MSSP](/es-419/mssp-ui) → Tenants → **+ New Tenant**.
2. Una vez que los eventos del ciclo de vida muestran `workloads_ready`, recupera el secreto compartido de `authd` desde Kubernetes:
   ```bash
   kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
     -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
   ```
3. Calcula el hostname del Wazuh manager del tenant a partir del patrón comodín de la instalación (`<slug>.soc.<mssp-domain>`).
4. Comparte ambos con el administrador del endpoint del cliente por un canal seguro; ejecuta `agent-auth` como se mostró arriba.
5. Confirma que el agente aparece en el dashboard de Wazuh embebido (Tenants → **Open SOC** → Agentes).

## Pruebas (validación previa al lanzamiento + validación del piloto)

Validación previa al lanzamiento:
- La plantilla del `Service` por tenant se renderiza correctamente para ambos valores de `tenant.wazuhIngress.mode` (`loadbalancer` y `edge-haproxy`).
- Emisión de certificados por tenant con cert-manager para el canal de inscripción del agente (1515).
- De extremo a extremo en `k3d` con dos tenants, MetalLB proporcionando dos IPs de LB (modo `loadbalancer`): para cada tenant, ejecuta `agent-auth -m <lb-ip> -P <secret>` desde un pod host y confirma que el agente aparece en el indexer de Wazuh de ese tenant y no en el del otro.
- El mismo extremo a extremo en modo `edge-haproxy`: HAProxy renderiza un `(IP, port-pair)` por tenant, los agentes se inscriben usando `-m <edge-ip> -p <tenant-port>`, y el flujo de eventos aterriza en el indexer correcto.
- Negativo: un agente apuntado a la dirección del tenant A con el secreto de `authd` del tenant B es rechazado por el manager.

Validación del piloto (lanzamiento posterior):
- Un endpoint de cliente real sobre internet público se inscribe sin problemas.
- Sonda entre tenants: inscribe un agente de `acme` con el secreto de `authd` de `beta` contra la dirección de `beta`: se espera rechazo. Y viceversa. Ambos fallan.

No hay ningún paso de SNI en ninguna de estas comprobaciones: el protocolo de agente de Wazuh en 1514 no produce un ClientHello, así que cualquier prueba que "sobrescriba el SNI" está ejercitando una ruta de enrutamiento que el ingreso de producción no tomará. Valida en su lugar el discriminador de dirección/puerto.
