---
description: "Onboarding de clientes Wazuh para MSSP, de punta a punta: aprovisione un SOC de tenant aislado, enrole agentes, entregue accesos y establezca la línea base de la primera semana."
---

# Onboarding de un tenant de cliente en un SOC Wazuh multi-tenant: una checklist para MSSP

El "onboarding" de un cliente a un servicio Wazuh multi-tenant se divide en cuatro trabajos: aprovisionar un stack aislado por cliente, enrolar los agentes del cliente en *su* manager y en ningún otro, entregar accesos que respeten la frontera MSSP/cliente y establecer la línea base de la primera semana de operación. Esta guía recorre todo el camino sobre SocTalk, donde cada cliente recibe un manager, un indexer y un dashboard de Wazuh dedicados en su propio namespace de Kubernetes, detrás de un único plano de control MSSP.

## Decisiones que tomar antes de hacer clic en New Tenant

**Perfil.** El perfil queda fijo en el momento del onboarding; cambiarlo después implica desmantelar y recrear. Decida primero:

- `poc`: evaluaciones y pilotos de corta vida. Almacenamiento `local-path` sin garantía real de persistencia, requests de recursos bajos, sin hooks de backup. También es el **valor por defecto si no especifica ninguno**; el almacenamiento `local-path` no ofrece ninguna garantía de persistencia, así que los clientes de producción necesitan `persistent`.
- `persistent`: SOCs de clientes de producción. Usa la StorageClass por defecto de su instalación, requests dimensionados para producción y hooks de backup respetados si están configurados.
- `provided`: el cliente ya opera Wazuh (BYO-SIEM). SocTalk instala solo su adaptador y el runs-worker en el namespace del tenant y alcanza por red el indexer del cliente (`:9200`) y la Manager API (`:55000`). El material de conexión externa *y* las credenciales de LLM por tenant son obligatorios en el momento del onboarding; la API devuelve 422 si faltan.

**Dimensionamiento.** Planifique aproximadamente 6–8 GB de RAM y ~1.5 vCPU por tenant `persistent`; el indexer de Wazuh por tenant suele ser el cuello de botella y determina el disco (PVC de 50 GB por defecto, retención hot de 30 días, todavía sin tiering hot→cold). SocTalk está probado hasta ~50 tenants en un clúster de 3 nodos de 16 vCPU / 64 GB; trate cualquier cosa por encima de ~5 tenants en un solo host como no validada. Detalles en [Dimensionamiento](/es-419/reference/sizing).

**LLM por tenant.** El triaje corre sobre una configuración de LLM por tenant: Anthropic o cualquier endpoint compatible con OpenAI (Azure OpenAI, vLLM, Ollama, LiteLLM). Un cliente puede traer su propia API key para aislar la facturación. La clave se monta como un Secret de Kubernetes en su namespace, con la salvedad documentada de V1 de que también se guarda en texto plano en la base de datos de SocTalk ([Secretos](/es-419/reference/secrets)). Como alternativa, puede apuntar el tenant a un endpoint Ollama totalmente local para una postura sin nube y sin costo por token (presupueste inferencia lenta en CPU). Vea [Proveedores de LLM](/es-419/integrate/llm-providers).

## Aprovisionamiento: las nueve fases ordenadas

Cree el tenant desde la [MSSP UI](/es-419/mssp-ui) (Tenants → **+ New Tenant**) o desde la API. El tenant entra en una máquina de estados aplicada por el servidor, `pending → provisioning → active`, con `degraded`, `suspended`, `decommissioning`, `archived` y `purged` más allá. Las transiciones inválidas se rechazan con un 409.

El controlador ejecuta nueve fases ordenadas e idempotentes, cada una emitiendo un evento de ciclo de vida que puede observar en la página de detalle del tenant: verificaciones preflight, acuñación de secretos por tenant (`authd`, JWT, Postgres), creación del namespace (`tenant-<slug>` con labels, ResourceQuota y LimitRange acotados al perfil), aplicación de secretos, la instalación Helm de `soctalk-tenant` (que además auto-aprovisiona el usuario `tenant_admin`), la instalación del chart de Wazuh, un sondeo de readiness, la escritura de la configuración de integración y la transición a `active`.

Si una fase falla, el tenant queda en `degraded` con el paso fallido capturado en la fila del evento. Corrija la causa (PVC atascado, cuota subdimensionada, image pull) y presione **Retry Provisioning**. El reintento retoma desde la fase 1, y cada fase es idempotente, así que volver a ejecutar es seguro. El reintento solo es válido *desde* `degraded`, no desde `pending`. Los runbooks para estados atascados están en [Operación diaria](/es-419/operations).

## Enrolamiento de agentes: llevar los endpoints al tenant correcto

Cada tenant recibe un nombre DNS dedicado (`acme.soc.mssp.example.com`) que resuelve a un endpoint L4 por tenant para 1514/TCP (eventos) y 1515/TCP (enrolamiento). El enrutamiento es por dirección de destino y no por SNI, ya que el protocolo de agentes 1514 de Wazuh no es TLS estándar y nunca presenta un ClientHello.

**Salvedad de V1:** el chart crea el Service del manager de Wazuh solo como `ClusterIP`. **No hay aprovisionamiento automático de LoadBalancer ni de DNS en esta versión.** Usted cablea el borde por su cuenta: un Service LoadBalancer por tenant que aplica manualmente, un HAProxy de borde con pares de puertos por tenant en una sola IP, o una ruta de VPN de malla. Los registros DNS también los administra el operador.

El enrolamiento en sí está acotado al tenant por diseño. Recupere el secreto compartido `authd` del tenant:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Entregue el hostname, los puertos y el secreto al administrador de endpoints del cliente por un canal seguro; esa persona ejecuta `agent-auth -m <hostname> -P "<secret>"`. Un agente que posee el secreto del tenant A solo puede registrarse en el manager del tenant A. Una pestaña dedicada de Agentes y un panel de Agent Onboarding están en la hoja de ruta; hoy, verifique los agentes en el dashboard de Wazuh embebido (Tenants → **Open SOC** → Agents). Topología completa y requisitos de firewall: [Ingreso de agentes Wazuh](/es-419/reference/wazuh-ingress).

## Personas: quién recibe un login

El aprovisionamiento ya acuñó un `tenant_admin`. Ese rol es de autoservicio: administra los usuarios de su propia organización y su propia configuración de LLM desde el portal del cliente. Para los interesados que necesitan visibilidad pero nunca deben actuar, asigne `customer_viewer`: dashboards e investigaciones de solo lectura, sin cola de revisión, sin chat.

Cada usuario creado recibe una contraseña temporal de un solo uso, mostrada una vez y con cambio forzado en el primer inicio de sesión. Un muro de audiencias separa los dos lados: los roles de tenant nunca pueden poseer capacidades de MSSP y viceversa, aplicado en el guard de capacidades, de modo que un login de cliente estructuralmente no puede alcanzar superficies cross-tenant. No hay flujo de autoservicio de contraseña olvidada en esta versión; los reseteos los fuerza un administrador. Catálogo completo: [Usuarios y roles](/es-419/users-and-roles).

## La primera semana

- **Heartbeat.** Vigile `soctalk_tenant_adapter_heartbeat_age_seconds` en `/metrics`. En V1 es el único gauge actualizado activamente y *no* degrada automáticamente el estado del tenant, así que configure la alerta usted mismo.
- **Cola de revisión.** Los tenants nuevos generan tráfico de revisión mientras las líneas base se asientan; cada escalamiento de la AI espera a un humano en la cola del dashboard; no existe un bypass de auto-aprobación.
- **Ventanas de engagement.** Si el cliente tiene un pentest agendado, declare la ventana de engagement (origen, host, técnica, horario) antes de que comience, para que la actividad sancionada se marque y audite en lugar de escalarse. La actividad del tester fuera de alcance sigue forzando una mirada humana.
- **Fundamentos de suspensión/desmantelamiento.** Suspender cambia el estado en la DB y detiene nuevas investigaciones, pero **no** escala las cargas de trabajo; el corte de emergencia es un runbook manual. El desmantelamiento derriba el plano de datos y conserva la fila del tenant más el historial de auditoría en `archived`; todavía no existe un endpoint de API `:purge`.

## Checklist de onboarding

- [ ] Perfil elegido (`persistent` para producción; `provided` requiere URLs del SIEM + credenciales de LLM por adelantado)
- [ ] Holgura del clúster verificada (~6–8 GB de RAM, ~1.5 vCPU por tenant `persistent`)
- [ ] LLM por tenant decidido (clave BYO / valor por defecto de la instalación / Ollama local)
- [ ] Tenant creado; los eventos de ciclo de vida llegaron a `active`
- [ ] Borde cableado manualmente: endpoint de LB o proxy de borde + registro DNS para `<slug>.soc.<domain>`
- [ ] Secreto `authd` recuperado y compartido por un canal seguro
- [ ] Primer agente enrolado y visible en el dashboard de Wazuh del tenant
- [ ] `tenant_admin` entregado; cuentas `customer_viewer` creadas según se necesite
- [ ] Alerta de heartbeat sobre `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Cualquier pentest agendado declarado como ventana de engagement

## Para profundizar

- [Ciclo de vida del tenant](/es-419/tenant-lifecycle): máquina de estados, fases, rutas de recuperación
- [Ingreso de agentes Wazuh](/es-419/reference/wazuh-ingress): topologías de borde, certificados, revocación
- [Usuarios y roles](/es-419/users-and-roles): el catálogo completo de roles y el muro de audiencias
- [Operación diaria](/es-419/operations): el lado runbook de todo lo anterior
- [Launchpad](/es-419/launchpad): ensaye todo este flujo en un piloto multi-VM de ~15–25 minutos
