# Diseño de CNI + NetworkPolicy

> **Nota sobre el despliegue V1.** Las plantillas de CiliumNetworkPolicy a continuación describen la **arquitectura objetivo** para el aislamiento este-oeste y la salida (egress) fijada por FQDN hacia los LLM por tenant. El chart V1 hoy renderiza políticas más simples: una salida permisiva para el Deployment `soctalk-system-api` (el orquestador está colocado en ese pod) y una política `runs-worker-egress` en cada namespace `tenant-<slug>` que permite una salida TCP/443 amplia hacia el proveedor de LLM (sin lista de FQDN permitidos por tenant). La entrada (ingress) de Wazuh en 1514/1515 **sí** se permite desde el namespace `ingress-system` en las políticas renderizadas. Lee el resto de esta página como el destino de diseño; consulta [`charts/soctalk-system/templates/50-networkpolicy.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/50-networkpolicy.yaml) para ver lo que se entrega actualmente.

## Decisión: Cilium como CNI primario

Cilium es el CNI soportado para SocTalk. Justificación:

1. **Aplicación de NetworkPolicy**. El Flannel predeterminado de K3s no aplica `NetworkPolicy`: sin aplicación, el aislamiento de tenants en la capa de red es una afirmación sin respaldo. Cilium aplica `NetworkPolicy` estándar de fábrica.
2. **Políticas de salida por FQDN**: la `NetworkPolicy` estándar solo permite salida basada en IP/CIDR. Los endpoints de BYO LLM son nombres de host (`api.openai.com`, endpoints autoalojados por el cliente detrás de CDNs con IPs dinámicas). La `CiliumNetworkPolicy` de Cilium con `toFQDNs` hace coincidir nombres de host. Esta es la única manera de aplicar la salida de LLM por tenant en la capa de red sin introducir un proxy directo (forward proxy).
3. **Aplicación basada en eBPF**: mayor rendimiento, menor latencia, sin sobrecarga de iptables.
4. **Observabilidad (Hubble)**: visibilidad a nivel de flujo; operativamente útil para depurar el aislamiento de tenants.
5. **Madurez**. Graduado por la CNCF, ampliamente desplegado en producción.

### Modo de instalación alternativo: Calico + proxy de salida

Los MSSP con un mandato operativo de ejecutar Calico pueden usarlo con el siguiente ajuste:
- `NetworkPolicy` estándar de K8s (aplicada por Calico) para todo el tráfico este-oeste y la salida de grano grueso.
- Un **proxy de salida** (Envoy, HAProxy o Squid) en el namespace `soctalk-system` que realiza la inclusión en lista de permitidos basada en FQDN.
- La `NetworkPolicy` restringe los pods de tenant y el orquestador de SocTalk a que salgan **solo a través del proxy** hacia destinos externos (fuera del clúster).

Esta alternativa está documentada pero no es la ruta recomendada. Agrega un componente, un punto de fallo y un recurso compartido entre tenants (el proxy). Si un MSSP la selecciona, SocTalk la validará de extremo a extremo en su clúster antes del onboarding.

## Requisitos de instalación

Cilium es un **prerrequisito del clúster** (ver `/reference/chart-audit` §4). El chart `soctalk-system` no instala Cilium. La sección de prerrequisitos de la guía de instalación especifica:

```bash
# K3s sin flannel, sin NP predeterminada y sin kube-proxy
# (Cilium lo reemplaza; ejecutar ambos reescribe la traducción de Service dos veces
# y rompe el enrutamiento).
curl -sfL https://get.k3s.io | sh -s - server \
    --flannel-backend=none \
    --disable-network-policy \
    --disable-kube-proxy \
    --disable=traefik  # si usas un controlador de ingress diferente

# Instalar Cilium:
helm repo add cilium https://helm.cilium.io/
helm install cilium cilium/cilium --version 1.15.x \
    --namespace kube-system \
    --set operator.replicas=1 \
    --set ipam.mode=kubernetes \
    --set kubeProxyReplacement=true \
    --set k8sServiceHost=<node-ip> \
    --set k8sServicePort=6443 \
    --set hubble.relay.enabled=true \
    --set hubble.ui.enabled=true
```

El hook de pre-instalación del chart `soctalk-system` verifica que Cilium esté activo y falla rápido si no lo está.

## Arquitectura de NetworkPolicy

Base de denegación por defecto (default-deny) en cada namespace que SocTalk administra. Las reglas de permiso se agregan explícitamente para cada flujo legítimo.

### Flujos que deben funcionar

| Origen | Destino | Por qué |
|---|---|---|
| `soctalk-system` → `tenant-<slug>` (Wazuh :55000, indexador :9200) | Este-oeste | Los subprocesos MCP del orquestador de SocTalk llaman al plano de datos Wazuh del tenant |
| `soctalk-system` → endpoints externos de TheHive / Cortex | Salida | TheHive y Cortex son integraciones externas alcanzadas por red, no pods de tenant en el namespace |
| `tenant-<slug>` (adaptador) → `soctalk-system` (SocTalk API :8000) | Este-oeste | El adaptador reporta su salud y extrae configuración |
| `soctalk-system` → FQDN externo del LLM por tenant | Salida | Llamadas al LLM durante el triaje (usando la clave de LLM del tenant bajo el contexto del worker) |
| Agentes Wazuh externos → gestor Wazuh de `tenant-<slug>` (:1514, :1515) | Entrada | Telemetría del endpoint del cliente |
| Usuarios MSSP → `soctalk-system` (vía Ingress :443) | Entrada | Acceso a la UI de MSSP + UI de Cliente |
| Postgres de `soctalk-system` ↔ `soctalk-system` (a sí mismo) | Intra-ns | Componentes de SocTalk hablando con la BD |
| `soctalk-system` → proveedor OIDC externo | Salida | OIDC a nivel de ingress; fluye vía el ns ingress-system |
| Pods de tenant intra-namespace (Wazuh manager↔indexer, agente↔manager, etc.) | Intra-ns | Operación normal del stack |

### Flujos que deben bloquearse (default-deny los captura)

- `tenant-acme` → `tenant-beta` (cualquier puerto, cualquier protocolo)
- `tenant-<slug>` → internet (salvo su FQDN de LLM configurado)
- `tenant-<slug>` → Postgres de `soctalk-system` directamente (el adaptador usa la SocTalk API, no la BD)
- Cualquier namespace → `kube-system` más allá de las consultas estándar al resolver
- Movimiento lateral entre clústeres desde cualquier pod comprometido

## Plantillas de NetworkPolicy

### Políticas del namespace `soctalk-system`

Administradas por el chart `soctalk-system`. Cuatro políticas:

**4.1.1 Denegar por defecto toda entrada/salida**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: soctalk-system }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.1.2 Permitir a la SocTalk API recibir del controlador de Ingress + adaptadores; salida a Postgres + DNS**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-ingress-allow, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: ingress-system }
      ports: [{ port: 8000, protocol: TCP }]
    - from:
        - namespaceSelector:
            matchLabels: { managed-by: soctalk, tenant: "true" }
      ports: [{ port: 8000, protocol: TCP }]
---
# Salida: la API necesita Postgres + DNS del clúster. Sin esta regla, la
# política default-deny anterior bloquea API → BD y la API entra en CrashLoop.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: api-egress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
  policyTypes: [Egress]
  egress:
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      ports: [{ port: 5432, protocol: TCP }]
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
---
# Salida: el pod controlador crea namespaces de tenant, Secrets y releases de Helm
# vía la API de Kubernetes. Sin esta regla, default-deny bloquea
# el controlador → kube-apiserver y el aprovisionamiento de tenants se cuelga.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: controller-egress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-controller } }
  policyTypes: [Egress]
  egress:
    # DNS del clúster
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
    # kube-apiserver. La ClusterIP de `kubernetes.default.svc` es la
    # VIP del apiserver; usa salida por CIDR hacia esa VIP más las IPs de
    # los nodos del apiserver (la IP del Service es reescrita a una IP de nodo
    # por kube-proxy o su reemplazo de Cilium).
    - to:
        - ipBlock: { cidr: <apiserver-cidr-or-service-ip>/32 }
      ports:
        - { port: 443, protocol: TCP }
        - { port: 6443, protocol: TCP }
    # Postgres para escrituras de estado.
    - to:
        - podSelector:
            matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      ports: [{ port: 5432, protocol: TCP }]
```

> Si la lógica del controlador se ejecuta dentro del pod de la API en lugar de como un Deployment separado, integra la regla de kube-apiserver en la política `api-egress` anterior en vez de usar una segunda política.

> La dirección del apiserver difiere por clúster. En clústeres administrados, usa la IP del Service visible para el kubelet (`kubectl get svc kubernetes -n default`) y los endpoints subyacentes del plano de control. Con Cilium, una alternativa es `toEntities: [kube-apiserver]` en una `CiliumNetworkPolicy`, que resuelve la identidad del apiserver dinámicamente.

**4.1.3 Permitir al orquestador alcanzar namespaces de tenant + DNS + FQDN de LLM**

Esta es una `CiliumNetworkPolicy` porque la NP estándar no puede expresar salida por FQDN:

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata: { name: orchestrator-egress, namespace: soctalk-system }
spec:
  endpointSelector:
    matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
  egress:
    # DNS
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace": kube-system
            "k8s:k8s-app": kube-dns
      toPorts:
        - ports: [{ port: "53", protocol: UDP }]
          rules:
            dns:
              - matchPattern: "*"
    # API del plano de datos del tenant (cualquier namespace tenant-*, puertos específicos)
    - toEndpoints:
        - matchLabels:
            "k8s:io.kubernetes.pod.namespace-label:managed-by": soctalk
            "k8s:io.kubernetes.pod.namespace-label:tenant": "true"
      toPorts:
        - ports:
            - { port: "55000", protocol: TCP }  # API del gestor Wazuh
            - { port: "9200",  protocol: TCP }  # indexador Wazuh
    # TheHive and Cortex are external integrations, not in-namespace tenant
    # pods, so orchestrator reaches them via network egress (per-tenant
    # FQDN/endpoint), not through this tenant-namespace selector.
    # Postgres (intra-ns)
    - toEndpoints:
        - matchLabels: { app.kubernetes.io/name: soctalk-postgres }
      toPorts: [{ ports: [{ port: "5432", protocol: TCP }] }]
    # Endpoints de LLM. La lista de FQDN permitidos se compone dinámicamente
    # (ver §4.2: una CiliumNetworkPolicy por tenant mantenida por el controlador de SocTalk)
```

**4.1.4 Permitir Postgres solo intra-ns**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: postgres-ingress, namespace: soctalk-system }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-postgres } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - podSelector: {}  # cualquier pod en soctalk-system
      ports: [{ port: 5432, protocol: TCP }]
```

### Salida por FQDN de LLM por tenant (dinámica)

El controlador de SocTalk renderiza una `CiliumNetworkPolicy` por tenant que permite orquestador → el FQDN de LLM de ese tenant. Cuando cambia la configuración de LLM de un tenant, la política se actualiza; cuando un tenant se da de baja, la política se elimina.

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: orchestrator-llm-egress-tenant-acme
  namespace: soctalk-system
  labels:
    managed-by: soctalk
    tenant-id: "<acme-uuid>"
spec:
  endpointSelector:
    matchLabels: { app.kubernetes.io/name: soctalk-orchestrator }
  egress:
    - toFQDNs:
        - matchName: "api.openai.com"  # o el endpoint configurado del tenant
      toPorts: [{ ports: [{ port: "443", protocol: TCP }] }]
```

Cilium combina todas las políticas que seleccionan los pods del orquestador, de modo que la unión de los FQDN permitidos de cada tenant es alcanzable desde esos pods en la capa de red. **No hay aislamiento de FQDN por tenant a nivel de solicitud** — eso es responsabilidad de la aplicación (configuración de LLM por tenant, claves de caché con alcance por tenant). La política de red reduce el radio de impacto (la lista de nombres de host de LLM permitidos como un todo, no salida arbitraria), pero por sí sola no restringe con qué tenant puede hablar el orquestador.

### Políticas del namespace del tenant

Renderizadas por el chart `soctalk-tenant` por tenant. Cuatro políticas por namespace:

**4.3.1 Denegar por defecto**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
```

**4.3.2 Permitir intra-namespace + DNS del clúster**

Los pods del plano de datos de Wazuh se resuelven entre sí vía los nombres DNS de Service de Kubernetes, por lo que cada pod del plano de datos necesita salida hacia `kube-dns`. El permiso intra-ns por sí solo no es suficiente; sin la regla de kube-dns, el stack no logra arrancar.

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: intra-ns-allow, namespace: tenant-acme }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
  ingress:
    - from: [{ podSelector: {} }]
  egress:
    - to: [{ podSelector: {} }]
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector:
            matchLabels: { k8s-app: kube-dns }
      ports: [{ port: 53, protocol: UDP }]
```

**4.3.3 Permitir entrada desde soctalk-system (llamadas MCP del orquestador)**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: allow-from-soctalk-system, namespace: tenant-acme }
spec:
  podSelector:
    matchExpressions:
      # `wazuh` covers the wazuh subchart's manager/indexer/dashboard.
      # `thehive`/`cortex` are inert forward-compat placeholders: TheHive
      # and Cortex are external integrations today, so these selectors and
      # the 9000/9001 ports below match no in-namespace pods. They stay in
      # the rendered policy so a future in-namespace dep needs no NP change.
      - { key: app.kubernetes.io/name, operator: In,
          values: [wazuh, thehive, cortex] }
      - { key: app.kubernetes.io/component, operator: In,
          values: [manager, indexer, dashboard, thehive, cortex] }
  policyTypes: [Ingress]
  ingress:
    # Ingress from BOTH the orchestrator (verdict / runs-worker path) and
    # the API pod (the chat agent's per-tenant Wazuh routing lands on the
    # API process, not the orchestrator).
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector:
            matchExpressions:
              - { key: app.kubernetes.io/component, operator: In,
                  values: [orchestrator, api] }
      ports:
        - { port: 55000, protocol: TCP }  # Wazuh manager API
        - { port: 9200,  protocol: TCP }  # Wazuh indexer
        - { port: 9000,  protocol: TCP }  # TheHive (inert placeholder)
        - { port: 9001,  protocol: TCP }  # Cortex (inert placeholder)
```

**4.3.4 Permitir al adaptador salir hacia la API de soctalk-system**

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: adapter-egress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-adapter } }
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector: { matchLabels: { app.kubernetes.io/name: soctalk-api } }
      ports: [{ port: 8000, protocol: TCP }]
    # DNS
    - to:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: kube-system }
          podSelector: { matchLabels: { k8s-app: kube-dns } }
      ports: [{ port: 53, protocol: UDP }]
```

**4.3.5 Permitir entrada del agente Wazuh hacia el gestor del tenant**

La telemetría del agente en 1514/1515 llega vía la ruta documentada en [Wazuh Ingress](/es-419/reference/wazuh-ingress). El despliegue de referencia es un Service LoadBalancer por tenant (LB de nube o MetalLB), con un Deployment de HAProxy en clúster en `soctalk-system` como respaldo de IP única. La NetworkPolicy debe permitir cualquiera de esas rutas que la instalación realmente ejecute — `ingress-system` **no** es el origen correcto para ninguna de ellas, así que no uses la plantilla estándar del chart sin editarla.

Elige un bloque según la instalación:

```yaml
# Ruta con LB de nube o MetalLB. La NetworkPolicy evalúa el origen del paquete
# como la IP original del endpoint del cliente o (cuando la ruta del service
# hace SNAT) la IP del nodo — NO el CIDR del pool del LoadBalancer. Así que permitir
# el pool del LB aquí no hace nada útil.
#
# Usa uno de:
#   * el conjunto de CIDRs de la red del cliente desde los que el MSSP sirve agentes
#     (recomendado; ajusta el radio de impacto y es la única aplicación
#     significativa de la política en esta capa);
#   * el CIDR de los nodos del clúster más 0.0.0.0/0 si la ruta del service hace SNAT
#     a IPs de nodo y aceptas entrada abierta en 1514/1515 (el LB
#     mismo / los grupos de seguridad de nube son entonces el control real).
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: wazuh-agent-ingress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: wazuh-manager } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - ipBlock: { cidr: <customer-network-cidr> }
        # repite por cada cliente al que el tenant sirve; o 0.0.0.0/0 si
        # el LB / SG de nube maneja el filtrado por origen.
      ports:
        - { port: 1514, protocol: TCP }
        - { port: 1515, protocol: TCP }
```

Cuando el service usa `externalTrafficPolicy: Local`, kube-proxy y Cilium preservan la IP de origen del cliente, por lo que los CIDRs de cliente anteriores se ven textualmente y la política es significativa. Bajo la política predeterminada (`Cluster`), la visibilidad de la IP de origen depende de la combinación de LB y CNI; en ese modo, trata esta NetworkPolicy como defensa en profundidad y apóyate en el grupo de seguridad del LB/nube como la puerta principal.

```yaml
# Respaldo de HAProxy en clúster en soctalk-system. El origen es el
# pod de HAProxy en el plano de control de SocTalk, no el namespace
# del controlador de ingress.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: wazuh-agent-ingress, namespace: tenant-acme }
spec:
  podSelector: { matchLabels: { app.kubernetes.io/name: wazuh-manager } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector:
            matchLabels: { kubernetes.io/metadata.name: soctalk-system }
          podSelector:
            matchLabels: { app.kubernetes.io/name: wazuh-edge-haproxy }
      ports:
        - { port: 1514, protocol: TCP }
        - { port: 1515, protocol: TCP }
```

El chart `soctalk-tenant` renderiza la variante que coincida con `tenant.wazuhIngress.mode` (`loadbalancer` o `edge-haproxy`).

## Consideraciones de DNS

- Cilium debe configurarse con `hubble` habilitado para observar consultas DNS (útil para depurar coincidencias de la política de FQDN).
- Las políticas `toFQDNs` funcionan interceptando respuestas DNS y agregando las IPs resueltas a reglas efímeras. El TTL de la respuesta DNS gobierna la frescura de la caché de la política; si un proveedor de LLM tiene TTLs extremadamente cortos (~60s), espera fallos de conexión breves ocasionales durante la rotación de IPs. Mitigación: el `dnsProxy` de Cilium puede ajustarse para un `minTTL` más largo: fíjalo en 300s.
- DNS corporativo (LLM del cliente alojado internamente): si el endpoint de LLM del tenant se resuelve solo vía un servidor DNS interno, Cilium debe configurarse para usar ese servidor, o el tenant usa salida basada en IP (pierde la semántica de FQDN-de-intención).

## Observabilidad

Hubble (incluido con Cilium) está habilitado en la instalación de referencia. Los equipos de operaciones del MSSP pueden ejecutar `hubble observe --namespace tenant-acme` para ver flujos, veredictos de aplicación (permitir/denegar) y descartes. Esta es la herramienta principal de depuración para cuestiones de aislamiento de tenants.

## Pruebas

Una compuerta de lanzamiento posterior incluye una prueba de aislamiento de red entre tenants:
1. Desplegar dos tenants (`tenant-a`, `tenant-b`).
2. Desde un pod en `tenant-a`, intentar conectarse al service Wazuh de `tenant-b` por IP y por nombre DNS. Esperar conexión rechazada / timeout.
3. Desde el orquestador en `soctalk-system`, intentar llamar al FQDN de LLM de `tenant-a` mientras se opera en el contexto de `tenant-b`. Esperar rechazo a nivel de aplicación (sin clave); la capa de política aún podría permitirlo ya que ambos FQDN están en la lista de permitidos.
4. Desde un pod en `soctalk-system` que no sea el orquestador, intentar alcanzar el Wazuh de `tenant-a`. Esperar conexión rechazada (solo el orquestador tiene salida hacia los puertos del plano de datos del tenant).

## Diferido (futuros lanzamientos)

- **Políticas HTTP L7**: Cilium soporta `CiliumNetworkPolicy` HTTP L7 (restringir a rutas/métodos específicos). Este lanzamiento es solo L4. L7 es útil para restricciones más finas de llamadas MCP en un futuro lanzamiento.
- **Políticas basadas en identidad**: solo por etiquetas en este lanzamiento; la identidad de Cilium con mTLS estilo SPIFFE es un futuro lanzamiento.
- **Egress gateway para IP de origen estática**: si los clientes finales del MSSP necesitan una IP de origen estática en lista de permitidos para las llamadas de LLM de SocTalk, el Egress Gateway de Cilium lo maneja. Un futuro lanzamiento.
- **Cifrado transparente (WireGuard/IPsec)**: cifrado a nivel de clúster del tráfico pod-a-pod. Un endurecimiento de un futuro lanzamiento.
