# Preguntas frecuentes

Preguntas previas a la instalación o compra que no encajan claramente en la instalación ni en la referencia.

## ¿Qué es SocTalk?

Una plataforma SOC multi-tenant creada para MSP y MSSP. Un único plano de control orquesta stacks de Wazuh por cliente; un pipeline de AI hace triaje de alertas y propone acciones; analistas humanos aprueban las escalaciones. Totalmente de código abierto.

## ¿Qué es de código abierto y qué es comercial?

**Todo lo que está en el repositorio [`soctalk/soctalk`](https://github.com/soctalk/soctalk) es Apache 2.0**: el plano de control, el pipeline de AI, la integración con Wazuh, los charts y la VM de demostración. No existe una división de funcionalidades "community vs enterprise".

Existe un servicio de hosting gestionado (SocTalk Cloud) para los MSP que no quieren operar la plataforma por su cuenta. El servicio alojado usa el mismo código que la distribución abierta.

## ¿Puedo evaluarlo sin un clúster de Kubernetes?

Sí, la [imagen de VM de demostración](/es-419/quickstart-vm) es una instalación de un solo nodo. Arráncala en KVM, VMware, Hyper-V, Azure, o conviértela desde raw. Cinco minutos hasta tener una instalación multi-tenant en funcionamiento con un tenant `demo` incorporado.

## ¿Puedo ejecutarlo en un solo nodo de forma permanente?

Sí, para despliegues muy pequeños (1–2 clientes, bajo volumen de alertas). La VM de demostración usa el perfil `poc`, que asume almacenamiento efímero y no dimensiona para carga sostenida. Para uso real con clientes:

- Aumenta los recursos de la VM (16 GB de RAM + 200 GB de SSD para ~3 tenants pequeños).
- Usa el perfil `persistent` al incorporar tenants.
- Agrega copias de seguridad (consulta [Copia de seguridad y restauración](/es-419/backup-restore)).

Para más de ~3 tenants, planifica un clúster multi-nodo.

## ¿Funciona en entornos air-gapped?

Sí, con algunos pasos adicionales:

- **Imágenes de contenedor**: replica `ghcr.io/soctalk/*` en tu registro interno. El chart acepta `image.registry: your.registry.example/soctalk`.
- **Chart de Helm**: ejecuta `helm pull oci://ghcr.io/soctalk/charts/soctalk-system` una vez, alójalo en un registro OCI interno y apunta las instalaciones a él.
- **LLM**: usa un endpoint local compatible con OpenAI (vLLM, proxy de Ollama, proxy de Bedrock on-prem). Consulta [Proveedores de LLM](/es-419/integrate/llm-providers).
- **Analizadores de Cortex**: cualquier analizador que necesite internet no funcionará. Usa solo analizadores on-prem (MaxMind GeoIP, MISP interno) o deshabilita Cortex.
- **GitHub Releases**: descarga la [imagen de VM](/es-419/downloads) en un host conectado y transfiérela por sneakernet.

El flujo de [`scripts/dev-up.sh`](https://github.com/soctalk/soctalk/blob/main/scripts/dev-up.sh) se ejecuta sin internet una vez que las imágenes están replicadas.

## ¿Cuánto cuesta el LLM por tenant?

Muy variable, depende de:

- El volumen de alertas (una investigación por cada alerta que sobrevive a la correlación)
- El presupuesto de tokens por ejecución (`case_runs.tokens_budget`, valor por defecto del modelo 200,000)
- La selección de modelo (`fast_model` + `reasoning_model`)
- Con qué frecuencia el veredicto indica `needs_more_info` (provoca una nueva ejecución)

Orden de magnitud con el presupuesto por defecto de 200,000 tokens por ejecución y uso típico: 30 alertas/día × ~60k tokens/investigación × $5/Mtok de entrada ≈ $9/día por tenant en una configuración económica compatible con OpenAI. Baja 5–10× con un fast model más barato. Consulta [Observabilidad, Costo por tenant](/es-419/observability#per-tenant-cost) para medirlo.

## ¿Pueden diferentes clientes usar diferentes modelos de LLM?

Sí, override por tenant en el momento de la incorporación. El modelo de toda la instalación es el valor por defecto; los tenants pueden optar por no usarlo especificando el suyo propio. Consulta [Proveedores de LLM, Overrides por tenant](/es-419/integrate/llm-providers#per-tenant-overrides).

## ¿Puede un cliente traer su propia clave de LLM?

Sí, el override por tenant también aplica a la clave de API. El almacén autoritativo es `IntegrationConfig.llm_api_key_plain` en Postgres; el controlador la materializa en `Secret/tenant-llm-key` en el namespace **del tenant** (no en `soctalk-system`), que el runs-worker monta. Útil para el aislamiento de facturación.

## ¿SocTalk envía datos de clientes a Anthropic / OpenAI?

Solo aquello sobre lo que razona el pipeline de AI: el cuerpo de la alerta, los observables extraídos y las salidas de los workers. El runtime no exfiltra datos en reposo, solo lo que está en el estado actual de la investigación. Si necesitas una postura más estricta, usa un endpoint de LLM on-prem (vLLM, Ollama). Consulta [Proveedores de LLM, Cambiar a Anthropic / parámetros de runtime](/es-419/integrate/llm-providers#runtime-only-knobs-env-not-chart).

## ¿Reemplaza a mis analistas?

No. SocTalk se posiciona como un **copiloto**, no como un reemplazo. El nodo de veredicto decide `escalate | close | needs_more_info`; la escalación siempre pasa por una compuerta de [revisión humana](/es-419/human-review). Sin el humano, un MSSP de alto volumen aún necesitaría analistas para manejar las decisiones que SocTalk les enruta.

El valor está en la compresión, el mismo equipo de analistas puede manejar 5–10× el volumen de alertas porque los casos rutinarios se cierran automáticamente y solo los poco claros llegan a la revisión humana.

## ¿Funciona sin Wazuh?

El plano de datos actual es exclusivamente Wazuh. La superficie de herramientas MCP (`wazuh.*`, `cortex.*`, `thehive.*`, `misp.*`) es conectable, por lo que otros SIEM son adiciones factibles. Ninguno se incluye hoy.

## ¿Cuál es la postura de hardening para producción?

- Row-Level Security de Postgres con `FORCE ROW LEVEL SECURITY` como respaldo del aislamiento de datos entre tenants.
- NetworkPolicy de Cilium que aísla cada namespace `tenant-<slug>`.
- TLS en todas partes (gestionado por cert-manager para producción; autofirmado para el asistente).
- Todo el estado del plano de control en Postgres con semántica de audit-log de solo anexado (append-only).
- El admin de bootstrap se crea únicamente cuando se configura explícitamente en los values (o mediante un Secret preaprovisionado); rótalo tras el primer inicio de sesión con `soctalk-auth set-password`.

Consulta [Modelo de seguridad](/es-419/reference/security-model) para la postura completa.

## ¿Puedo ejecutarlo en EKS / AKS / GKE?

Sí, el chart apunta a Kubernetes 1.30+ estándar. Conecta la StorageClass, el controlador de ingress y el solucionador DNS-01 de cert-manager de tu nube. La [guía de instalación](/es-419/install) se enfoca en K3s porque esa es la distribución por defecto; al chart en sí le da igual.

## ¿Escala a N clientes?

Probado hasta ~50 tenants en un clúster de 3 nodos (16 vCPU / 64 GB / nodo). El cuello de botella suele ser el indexer de Wazuh por tenant (cada indexer es un proceso Java con su propio heap) más que el plano de control de SocTalk. Planifica ~6–8 GB de RAM y ~1.5 vCPU por tenant con perfil `persistent`: consulta [Dimensionamiento](/es-419/reference/sizing).

## ¿Y el cumplimiento (SOC 2, HIPAA, PCI)?

La postura de la plataforma soporta auditorías al estilo SOC 2, audit-log de solo anexado, RBAC, cifrado en reposo (Postgres + indexer de Wazuh), cifrado en tránsito. **No** se entrega con una atestación de SOC 2; esa es responsabilidad del MSSP para su hosting.

Para HIPAA / PCI, el plano de datos (Wazuh) suele contener datos dentro del alcance. Trata ese PVC como dentro del alcance y respáldalo en consecuencia (consulta [Copia de seguridad y restauración](/es-419/backup-restore)).

## ¿Qué hay en el roadmap?

Los GitHub Issues y el tablero de Projects de [`soctalk/soctalk`](https://github.com/soctalk/soctalk) son la fuente de verdad. Elementos de alto impacto mencionados en la documentación como de versiones futuras:

- Modo de autenticación por proxy expuesto como un parámetro de values del chart (hoy: override por variable de entorno).
- API de actualización de flota (hoy: bucle manual de `helm upgrade`).
- Emisor de licencias (credenciales de instalación firmadas offline).
- Asistente de incorporación de VPN gestionada por el cliente (hoy: solo patrón documentado).
- Pestaña de Agents por tenant en el detalle del tenant.

## ¿Cómo contribuyo?

Consulta la página de [Contribuir](/es-419/contribute).

## ¿Dónde obtengo ayuda?

- Issues: https://github.com/soctalk/soctalk/issues
- Discussions: https://github.com/soctalk/soctalk/discussions
- Seguridad: consulta SECURITY.md en el repositorio
