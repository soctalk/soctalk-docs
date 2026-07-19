---
title: "Wazuh multi-tenant para MSSP: patrones de arquitectura que aíslan tenants de verdad"
description: "Cómo operar Wazuh multi-tenant como MSSP: manager por tenant en Kubernetes, RLS en Postgres, aislamiento de red, enrolamiento de agentes y dimensionamiento por tenant."
---

# Wazuh multi-tenant para MSSP: patrones de arquitectura que aíslan tenants de verdad

Wazuh no tiene multi-tenancy de primera clase. No existe un objeto "tenant" en el manager, no hay frontera por cliente en el ruleset y el enrolamiento de `authd` no tiene alcance por cliente. Todo MSSP que estandariza sobre Wazuh termina construyendo la tenencia alrededor, y el patrón que elija determina sus garantías de aislamiento, su velocidad de onboarding y su piso de costo por cliente.

Esta guía cubre lo que un MSSP necesita de un despliegue Wazuh multi-tenant, los tres patrones que los equipos prueban en la práctica y lo que exige un aislamiento de grado productivo más allá del propio SIEM. Es la arquitectura que SocTalk implementa como código abierto (Apache 2.0); las páginas de referencia enlazadas a lo largo del texto profundizan en cada capa.

## Lo que un MSSP necesita y Wazuh no provee

Tres requisitos aparecen en toda conversación de despliegue con un MSSP:

1. **Aislamiento defendible en una revisión de seguridad del cliente.** Un filtro en el dashboard no le alcanza a nadie; "el cliente A no puede leer las alertas del cliente B" tiene que cumplirse en la capa de datos, en la capa de red y en la capa de enrolamiento de agentes.
2. **Velocidad de onboarding.** Si aprovisionar el SOC de un cliente nuevo lleva una semana de trabajo manual, el patrón no escala más allá de un puñado de clientes.
3. **Control de costos por tenant.** Necesita saber cuánto cuesta un cliente en RAM, CPU y disco, ponerle un tope y evitar que un tenant ruidoso deje sin recursos al resto.

## Los tres patrones que prueban los MSSP

### Patrón 1: manager compartido, separación a nivel de índices

Un solo manager de Wazuh, los agentes de todos los clientes enrolados contra él, y la separación resuelta aguas abajo: multi-tenancy de OpenSearch Dashboards para los objetos de dashboard, patrones de índices y roles de seguridad para acotar la lectura. Es el patrón que describe la mayoría de los hilos sobre multi-tenancy en Wazuh, porque es el único que se puede armar sin salir de las herramientas propias de Wazuh.

El problema es que la separación ocurre en el momento de la lectura y no traza ninguna frontera alrededor de los datos. El manager en sí es compartido: un ruleset, un secreto de `authd`, una API, una ventana de actualización para todos. Un rol mal configurado expone a todos los clientes a la vez, y los paquetes de reglas o las políticas de retención por cliente son imposibles sin afectar al resto.

### Patrón 2: manager por tenant en VMs

Una VM (o un conjunto de VMs) por cliente, con un manager y un indexer dedicados. El aislamiento es real: procesos, discos y credenciales separados. Aquí es donde aterrizan los MSSP después de que el patrón de manager compartido les pasa factura. El costo es operativo: el onboarding implica aprovisionar máquinas, las actualizaciones implican tocar cada VM, y el piso de recursos por tenant es una VM completa sin scheduling compartido que recupere la capacidad ociosa. Funciona con 5 clientes y duele con 30.

### Patrón 3: manager por tenant en Kubernetes, detrás de un plano de control

Cada cliente recibe un manager, un indexer y un dashboard de Wazuh dedicados en su propio namespace de Kubernetes, con una ResourceQuota y un LimitRange que acotan su huella. Un plano de control es dueño del ciclo de vida: el onboarding renderiza un release de Helm por tenant, el desmontaje lo elimina, y el estado del tenant vive en una base de datos y no en una planilla. El aislamiento viene de la frontera del namespace más NetworkPolicy; la densidad, del scheduler que empaqueta tenants en nodos compartidos.

### Cómo se comparan los patrones

| | Manager compartido + separación por índices | Manager por tenant en VMs | Manager por tenant en Kubernetes |
|---|---|---|---|
| Frontera de aislamiento | Filtros de lectura sobre datos compartidos | Frontera de máquina | Namespace + NetworkPolicy + cuota |
| Radio de impacto de un compromiso | Todos los clientes | Un cliente | Un cliente |
| Reglas / retención / actualizaciones por tenant | No | Sí | Sí |
| Onboarding de un cliente | Rápido (cambio de configuración) | Lento (aprovisionar máquinas) | Rápido, si está automatizado (release de Helm) |
| Densidad / costo por tenant | La mejor | La peor | Buena (empaquetado por el scheduler, acotado por cuota) |
| Habilidad operativa requerida | Wazuh + seguridad de OpenSearch | Automatización de flota/VMs | Kubernetes |
| Operación de flota con 30+ tenants | N/A (un solo stack) | Dolorosa | Manejable con un plano de control |

De los tres, el patrón 3 es el que está construido para entregar aislamiento real y velocidad de onboarding a la vez, pero solo si el plano de control existe. Los namespaces por sí solos equivalen a una convención de nombres; la frontera de seguridad hay que construirla encima. El resto de esta guía trata de lo que hace que esa frontera sea real.

## El aislamiento de producción es más que el SIEM

Un stack Wazuh por tenant aísla los datos del SIEM. Una plataforma de MSSP también tiene estado que cruza tenants, desde casos y colas de revisión hasta logs de auditoría y configuraciones de integraciones, y esa capa necesita su propia aplicación de controles.

### Capa de datos: seguridad a nivel de fila en Postgres, forzada y probada

Con filtrado `WHERE tenant_id = ?` a nivel de aplicación, una sola cláusula olvidada filtra datos entre tenants. La base de datos debe hacer cumplir la tenencia por sí misma. El patrón:

- Cada tabla con alcance de tenant lleva políticas RLS ancladas a un ajuste `app.current_tenant_id` por transacción. Un contexto sin definir devuelve **cero filas**; el modo de falla es un resultado vacío, nunca los datos de otro tenant.
- `FORCE ROW LEVEL SECURITY` en cada tabla con alcance de tenant, de modo que hasta el dueño de la tabla (el rol de migraciones) queda sujeto a la política. Postgres por defecto exime a los dueños; una migración que lee datos de tenants podría, si no, cruzar tenants en silencio.
- Una división en tres roles: un dueño de migraciones, un rol de runtime sujeto a RLS y un rol `BYPASSRLS` segregado, reservado para rutas cross-tenant auditadas. Ninguna aplicación se conecta como superusuario.
- Pruebas de aislamiento en CI: sondas de endpoints, SQL crudo bajo el rol de la aplicación, workers sin contexto, sondas con el rol dueño, flujos de eventos cross-tenant. SocTalk corre siete pruebas de este tipo, todas obligatorias; ninguna opcional.
- Claves de idempotencia con alcance `UNIQUE (tenant_id, idempotency_key)`, de modo que los pipelines de alertas de dos clientes pueden emitir el mismo ID de alerta externo sin colisionar.

Plantillas de políticas completas, DDL de roles y la suite de pruebas: [RLS en Postgres](/es-419/reference/postgres-rls).

### Capa de red: NetworkPolicy por namespace

La frontera del namespace no significa nada sin un CNI que la haga cumplir; el Flannel por defecto de K3s no aplica NetworkPolicy en absoluto. La postura objetivo es una línea base de denegación por defecto en cada namespace de tenant con permisos explícitos: tráfico intra-namespace, DNS, acceso del plano de control a los puertos del plano de datos del tenant e ingreso de agentes por 1514/1515. El tráfico entre tenants y el egreso general de los tenants quedan bloqueados.

SocTalk usa Cilium como CNI soportado (aplicación de NetworkPolicy, egreso basado en FQDN para endpoints de LLM direccionados por hostname, observabilidad de flujos con Hubble para depurar dudas de aislamiento). Tenga presente la salvedad de la V1: la allowlist de egreso por tenant totalmente anclada a FQDN es el destino del diseño, y el chart actual renderiza políticas más simples, con egreso permisivo del plano de control y egreso amplio por TCP/443 para el worker por tenant. Las plantillas renderizadas están en el repo; lea [Diseño de NetworkPolicy](/es-419/reference/network-policy) para ver tanto las políticas que se entregan hoy como la arquitectura objetivo.

### Enrolamiento de agentes: endpoints y secretos por tenant

El modo de falla más sutil: un agente del cliente A registrándose contra el manager del cliente B. El protocolo de agentes de Wazuh en 1514/TCP es un stream cifrado propietario y no TLS estándar. No hay SNI sobre el cual enrutar, así que los proxies L4 que inspeccionan hostnames se rompen en silencio. El enrutamiento tiene que ser por dirección de destino: cada tenant obtiene su propio nombre DNS (`acme.soc.mssp.example.com`) que resuelve a un endpoint L4 por tenant, con un fallback de puerto por tenant cuando las IPs escasean.

Los secretos de enrolamiento tienen alcance de tenant: el secreto compartido de `authd` de cada tenant vive en el namespace de ese tenant, así que un agente que posee el secreto del tenant A solo puede registrarse con el manager de A: el direccionamiento lo enruta ahí y el manager verifica el secreto. En la V1, el aprovisionamiento de LoadBalancer y DNS es cableado manual del MSSP, no automatizado. Detalles y el runbook de enrolamiento: [Ingreso de agentes Wazuh](/es-419/reference/wazuh-ingress).

## Capacidad: cuánto cuesta un tenant

Los números que los MSSP piden primero, del trabajo de dimensionamiento de SocTalk:

- **Huella por tenant (stack completo):** ~8 GB de RAM solicitados (~16 GB de límite), ~2.2 vCPU solicitados, ~120 GB de disco. El uso sostenido sigue a los requests; los límites son techos de ráfaga.
- **El cuello de botella suele ser el indexer de Wazuh por tenant.** Cada uno es un proceso Java con su propio heap. Planifique ~6–8 GB de RAM y ~1.5 vCPU por tenant en producción.
- **El disco lo determina la tasa de ingesta:** aproximadamente 5 GB/día de índice a 10 alertas/seg sostenidas; el PVC por defecto del indexer es de 50 GB con retención caliente de 30 días.
- **Escala probada:** hasta ~50 tenants en un clúster de 3 nodos (16 vCPU / 64 GB por nodo). Los perfiles de instalación única más grandes están documentados pero no validados en esta versión; no planifique más allá de ese número en una sola instalación sin probarlo.

Perfiles de host de referencia y la fórmula de tenants máximos por nodo: [Dimensionamiento](/es-419/reference/sizing) y la [FAQ de escalamiento](/es-419/faq#does-it-scale-to-n-customers).

## Cómo empaqueta SocTalk este patrón

SocTalk es una implementación de código abierto (Apache 2.0, sin división community/enterprise) del patrón 3: un plano de control, un release de Helm `soctalk-tenant` por cliente, sobre su propio Kubernetes 1.30+, ya sea K3s, EKS, AKS o GKE.

```mermaid
flowchart TB
    subgraph cp["soctalk-system namespace (control plane)"]
        api["API + orchestrator"]
        ctrl["Provisioning controller"]
        pg[("Postgres: RLS, FORCE, 3 roles")]
        api --> pg
        ctrl --> pg
    end
    subgraph ta["tenant-acme namespace"]
        ma["Wazuh manager"]
        ia["Wazuh indexer"]
        wa["runs-worker + adapter"]
    end
    subgraph tb["tenant-beta namespace"]
        mb["Wazuh manager"]
        ib["Wazuh indexer"]
        wb["runs-worker + adapter"]
    end
    ctrl -- "Helm: soctalk-tenant" --> ta
    ctrl -- "Helm: soctalk-tenant" --> tb
    agA["Customer A agents"] -- "acme.soc.mssp.example.com : 1514/1515" --> ma
    agB["Customer B agents"] -- "beta.soc.mssp.example.com : 1514/1515" --> mb
```

El onboarding ejecuta una secuencia de aprovisionamiento de nueve fases (preflight, emisión de secretos, namespace con cuotas, instalaciones de Helm, sondeo de readiness), cada fase emitiendo un evento de ciclo de vida y reintentable de forma idempotente desde `degraded`. El estado del tenant es una máquina aplicada por el servidor (`pending → provisioning → active`, con los estados suspended, decommissioning, archived y purged; las transiciones inválidas devuelven 409). Tres perfiles de onboarding cubren demos (`poc`), producción (`persistent`) y BYO-Wazuh (`provided`, donde SocTalk se conecta al stack existente de un cliente en lugar de desplegar uno). El decomiso desmonta el plano de datos pero conserva la fila del tenant y el historial de auditoría.

El ciclo de vida completo, desde estados y fases hasta cuotas y rutas de recuperación, está en [Ciclo de vida del tenant](/es-419/tenant-lifecycle). Para ponerlo en marcha: la [guía de instalación](/es-419/install) cubre un clúster de producción en cerca de una hora, y la [VM de demo](/es-419/quickstart-vm) arranca una instalación multi-tenant funcional con un tenant de demo en unos cinco minutos.
