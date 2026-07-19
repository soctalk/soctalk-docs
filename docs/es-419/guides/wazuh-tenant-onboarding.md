---
description: Onboarding de clientes de un MSSP con Wazuh, de principio a fin — aprovisiona un SOC de tenant aislado, enrola agentes, entrega accesos y establece la línea base de la primera semana.
---

# Onboarding de un tenant de cliente a un SOC Wazuh multi-tenant: checklist para MSSP

Hacer el "onboarding" de un cliente a un servicio Wazuh multi-tenant son cuatro trabajos, no uno: aprovisionar un stack aislado por cliente, enrolar los agentes del cliente en *su* manager y en ninguno más, entregar accesos que respeten la frontera MSSP/cliente y establecer la línea base de la primera semana de operaciones. Esta guía recorre el camino completo en SocTalk, donde cada cliente recibe un manager, un indexer y un dashboard de Wazuh dedicados en su propio namespace de Kubernetes, detrás de un único plano de control del MSSP.

## Decisiones a tomar antes de hacer clic en New Tenant

**Perfil.** El perfil queda fijo en el momento del onboarding — cambiarlo después implica decomisionar y recrear — así que decide primero:

- `poc` — evaluaciones y pilotos de corta duración. Almacenamiento `local-path` sin garantía real de persistencia, solicitudes de recursos bajas, sin hooks de respaldo. También es el **valor por defecto si no especificas uno**, lo cual es el valor por defecto equivocado para un cliente que paga.
- `persistent` — SOCs de clientes en producción. Usa la StorageClass por defecto de tu instalación, solicitudes de recursos dimensionadas para producción y hooks de respaldo respetados si están configurados.
- `provided` — el cliente ya opera Wazuh (BYO-SIEM). SocTalk instala solo su adaptador y el runs-worker en el namespace del tenant y alcanza el indexer del cliente (`:9200`) y la Manager API (`:55000`) a través de la red. El material de conexión externo *y* las credenciales de LLM por tenant son obligatorios en el momento del onboarding — la API devuelve 422 si faltan.

**Dimensionamiento.** Planifica aproximadamente 6–8 GB de RAM y ~1.5 vCPU por tenant `persistent`; el indexer de Wazuh por tenant suele ser el cuello de botella y determina el disco (PVC de 50 GB por defecto, retención hot de 30 días, sin tiering hot→cold todavía). SocTalk está probado hasta ~50 tenants en un clúster de 3 nodos de 16 vCPU / 64 GB por nodo; trata cualquier cosa más allá de ~5 tenants en un solo host como no validada. Detalles en [Dimensionamiento](/es-419/reference/sizing).

**LLM por tenant.** El triaje se ejecuta sobre una configuración de LLM por tenant: Anthropic o cualquier endpoint compatible con OpenAI (Azure OpenAI, vLLM, Ollama, LiteLLM). Un cliente puede traer su propia API key para aislar la facturación — montada como un Secret de Kubernetes en su namespace, con la salvedad documentada de V1 de que la clave también se guarda en texto plano en la base de datos de SocTalk ([Secretos](/es-419/reference/secrets)) — o puedes apuntar el tenant a un endpoint de Ollama totalmente local para una postura sin nube y sin costo por token (presupuesta inferencia lenta en CPU). Consulta [Proveedores de LLM](/es-419/integrate/llm-providers).

## Aprovisionamiento: qué sucede realmente

Crea el tenant desde la [UI del MSSP](/es-419/mssp-ui) (Tenants → **+ New Tenant**) o desde la API. El tenant entra en una máquina de estados aplicada por el servidor — `pending → provisioning → active`, con `degraded`, `suspended`, `decommissioning`, `archived` y `purged` más allá; las transiciones inválidas se rechazan con un 409.

El controlador ejecuta nueve fases ordenadas e idempotentes, cada una emitiendo un evento de ciclo de vida que puedes observar en la página de detalle del tenant: verificaciones preliminares, generación de secretos por tenant (`authd`, JWT, Postgres), creación del namespace (`tenant-<slug>` con etiquetas, ResourceQuota y LimitRange ajustados al perfil), aplicación de secretos, la instalación Helm de `soctalk-tenant` (que también auto-aprovisiona el usuario `tenant_admin`), la instalación del chart de Wazuh, un sondeo de disponibilidad, la escritura de la configuración de integración y la transición a `active`.

Si una fase falla, el tenant queda en `degraded` con el paso fallido registrado en la fila del evento. Corrige la causa (PVC atascado, cuota insuficiente, fallo de descarga de imagen) y presiona **Retry Provisioning** — el reintento se reanuda desde la fase 1 y todas las fases son idempotentes, así que re-ejecutarlas es seguro. El reintento solo es válido *desde* `degraded`, no desde `pending`. Los runbooks para estados atascados están en [Operaciones diarias](/es-419/operations).

## Enrolamiento de agentes: llevar los endpoints al tenant correcto

Cada tenant recibe un nombre DNS dedicado (`acme.soc.mssp.example.com`) que resuelve a un endpoint L4 por tenant para 1514/TCP (eventos) y 1515/TCP (enrolamiento). El enrutamiento es por dirección de destino, no por SNI — el protocolo de agente 1514 de Wazuh no es TLS estándar y nunca presenta un ClientHello.

**Salvedad honesta de V1:** el chart crea el Service del manager de Wazuh solo como `ClusterIP`. **No hay aprovisionamiento automático de LoadBalancer ni de DNS en esta versión** — el edge lo cableas tú mismo: un Service LoadBalancer por tenant que aplicas manualmente, un HAProxy de borde con pares de puertos por tenant en una única IP, o una ruta de VPN de malla. Los registros DNS los gestiona igualmente el operador.

El enrolamiento en sí está acotado al tenant por diseño. Recupera el secreto compartido `authd` del tenant:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Entrega el hostname, los puertos y el secreto al administrador de endpoints del cliente por un canal seguro; el administrador ejecuta `agent-auth -m <hostname> -P "<secret>"`. Un agente que posee el secreto del tenant A solo puede registrarse con el manager del tenant A. Una pestaña Agents dedicada y un panel de Agent Onboarding están en el roadmap; hoy, verifica los agentes en el dashboard de Wazuh embebido (Tenants → **Open SOC** → Agents). Topología completa y requisitos de firewall: [Ingreso de agentes Wazuh](/es-419/reference/wazuh-ingress).

## Personas: quién recibe un login

El aprovisionamiento ya generó un `tenant_admin`. Ese rol es de autoservicio: gestiona los usuarios de su propia organización y su propia configuración de LLM desde el portal del cliente. Para los interesados que necesitan visibilidad pero nunca deberían actuar, asigna `customer_viewer` — dashboards e investigaciones de solo lectura, sin cola de revisión, sin chat.

Cada usuario creado recibe una contraseña temporal de un solo uso, mostrada una única vez y con cambio forzado en el primer inicio de sesión. Un muro de audiencias separa los dos lados: los roles de tenant nunca pueden poseer capacidades de MSSP y viceversa, aplicado en el guard de capacidades, de modo que un login de cliente estructuralmente no puede alcanzar superficies cross-tenant. Ten en cuenta que no hay un flujo de autoservicio de recuperación de contraseña en esta versión — los restablecimientos los fuerza un administrador. Catálogo completo: [Usuarios y roles](/es-419/users-and-roles).

## La primera semana

- **Heartbeat.** Observa `soctalk_tenant_adapter_heartbeat_age_seconds` en `/metrics` — en V1 es el único gauge que se actualiza activamente, y *no* degrada automáticamente el estado del tenant, así que configura tú mismo la alerta.
- **Cola de revisión.** Los tenants nuevos generan tráfico de revisión mientras las líneas base se asientan; cada escalamiento de la AI espera a un humano en la cola del dashboard — no existe un bypass de auto-aprobación.
- **Ventanas de engagement.** Si el cliente tiene un pentest programado, declara la ventana de engagement (origen, host, técnica, horario) antes de que comience, para que la actividad sancionada se marque y audite en lugar de escalarse — y la actividad del tester fuera de alcance igualmente fuerza una mirada humana.
- **Fundamentos de suspensión/decomisionado.** Suspender cambia el estado en la BD y detiene las investigaciones nuevas pero **no** reduce las cargas de trabajo — el corte de emergencia es un runbook manual. Decomisionar desmantela el plano de datos y conserva la fila del tenant más el historial de auditoría en `archived`; todavía no hay un endpoint de API `:purge`.

## Checklist de onboarding

- [ ] Perfil elegido (`persistent` para producción; `provided` requiere URLs del SIEM + credenciales de LLM desde el inicio)
- [ ] Holgura del clúster verificada (~6–8 GB de RAM, ~1.5 vCPU por tenant `persistent`)
- [ ] LLM por tenant decidido (clave propia / valor por defecto de la instalación / Ollama local)
- [ ] Tenant creado; los eventos de ciclo de vida llegaron a `active`
- [ ] Edge cableado manualmente: endpoint de LB o edge-proxy + registro DNS para `<slug>.soc.<domain>`
- [ ] Secret de `authd` obtenido y compartido por un canal seguro
- [ ] Primer agente enrolado y visible en el dashboard de Wazuh del tenant
- [ ] `tenant_admin` entregado; cuentas `customer_viewer` creadas según sea necesario
- [ ] Alerta de heartbeat sobre `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Todo pentest programado declarado como ventana de engagement

## Para profundizar

- [Ciclo de vida del tenant](/es-419/tenant-lifecycle) — máquina de estados, fases, rutas de recuperación
- [Ingreso de agentes Wazuh](/es-419/reference/wazuh-ingress) — topologías de edge, certificados, revocación
- [Usuarios y roles](/es-419/users-and-roles) — el catálogo completo de roles y el muro de audiencias
- [Operaciones diarias](/es-419/operations) — el lado de runbook de todo lo anterior
- [Launchpad](/es-419/launchpad) — ensaya este flujo completo en un piloto multi-VM de ~15–25 minutos
