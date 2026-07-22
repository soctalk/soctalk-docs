---
layout: home

hero:
  name: SocTalk
  text: Plataforma SOC AI-first para MSP y MSSP
  tagline: Ejecuta un stack Wazuh dedicado por cliente en tu propio Kubernetes, detrás de un solo plano de control.
  actions:
    - theme: brand
      text: Prueba la VM de demostración
      link: /es-419/quickstart-vm
    - theme: brand
      text: Despliegue piloto MSSP
      link: /es-419/mssp-pilot
    - theme: alt
      text: Instalación en producción
      link: /es-419/install
    - theme: alt
      text: GitHub
      link: https://github.com/soctalk/soctalk

features:
  - title: Multi-tenant
    details: Un único plano de control ejecuta stacks SOC por cliente en namespaces aislados de Kubernetes, con Postgres RLS como respaldo de aislamiento de datos.
  - title: Plano de datos Wazuh
    details: Cada cliente obtiene su propio Wazuh manager e indexer. Los agentes se enrolan a través de un ingress enrutado por hostname. Totalmente open source.
  - title: Triaje con AI, control humano
    details: Los workers de LangGraph realizan el triaje y proponen acciones; los analistas aprueban las escalaciones. BYO LLM por tenant.
---

## Tres pasos para empezar

**1. Evalúa, [VM de demostración](/es-419/quickstart-vm).** Una sola imagen, asistente en el navegador, 5 minutos hasta una instalación en funcionamiento con un tenant de demostración. Disponible como QCOW2, VMDK, VHDX, VHD y raw en la [página de descargas](/es-419/downloads). La mejor forma de ver al analista SOC con AI respondiendo consultas reales de Wazuh de extremo a extremo en una laptop.

**2. Piloto, [despliegue piloto MSSP](/es-419/mssp-pilot).** El siguiente paso recomendado: dos entornos on-premise (plano de control MSSP + 1-3 tenants), conectados por una malla VPN compatible con firewalls, ejecutando el flujo multi-tenant completo con datos reales de clientes. Estado final: un analista SOC con AI respondiendo preguntas a través de tus primeros clientes piloto, y una captura de pantalla lista para presentar a stakeholders.

**3. Producción, [guía de instalación](/es-419/install).** K3s + Cilium + cert-manager + Helm. Tómate una hora y termina con una instalación multi-tenant endurecida lista para tu base de clientes.

## Qué encontrarás aquí

- [Comenzar](/es-419/install), rutas de instalación (VM de demostración + producción), recorrido por la UI de MSSP.
- [Operar](/es-419/operations), operaciones diarias, ciclo de vida del tenant, actualizaciones, resolución de problemas.
- [Integrar](/es-419/integrate/llm-providers), proveedores de LLM, TheHive, Cortex, Slack.
- [Referencia](/es-419/reference/architecture), arquitectura, modelo de seguridad, RLS, contrato de chart, REST API.
- [Contribuir](/es-419/contribute), entorno de desarrollo, expectativas de los PR, proceso de release.

Fuente: [github.com/soctalk/soctalk](https://github.com/soctalk/soctalk). Apache 2.0.
