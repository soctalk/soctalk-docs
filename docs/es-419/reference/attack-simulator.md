# Simulador de ataques y linux-ep

Un par de herramientas de demostración que generan alertas realistas de Wazuh para que un operador MSSP pueda ver el [pipeline de AI](/es-419/ai-pipeline) de SocTalk trabajando de verdad. Muy recomendadas para evaluaciones y demos en vivo: sin alertas no hay nada que el agente pueda triar.

Ambas se incluyen en la distribución FOSS. Código fuente:

- [`attack-simulator/`](https://github.com/soctalk/soctalk/tree/main/attack-simulator) — scripts y paquete de reglas
- [`charts/linux-ep/`](https://github.com/soctalk/soctalk/tree/main/charts/linux-ep) — chart de Kubernetes que ejecuta el simulador

## Chart linux-ep

`linux-ep` levanta N pods de endpoint Linux, cada uno:

1. Instala el agente de Wazuh y lo inscribe en el Wazuh manager del tenant.
2. Ejecuta técnicas de MITRE ATT&CK con scripts contra sí mismo en un intervalo configurable.
3. Limita las alertas simuladas diarias por pod (por defecto 30/día UTC) para controlar el gasto en LLM.

Los pods se registran como `linux-ep-0`, `linux-ep-1`, … para que la interfaz de SocTalk muestre nombres de host realistas en el flujo de alertas.

### Instalación

```bash
helm install linux-ep oci://ghcr.io/soctalk/charts/linux-ep \
  --version 0.1.1 \
  --namespace tenant-demo \
  --set wazuh.managerHost=wazuh-demo-wazuh-manager \
  --set wazuh.credsSecret.name=wazuh-demo-wazuh-creds \
  --set replicas=2 \
  --set simulator.enabled=true \
  --set simulator.dailyAlertCap=30
```

Para la [imagen de VM de demostración](/es-419/quickstart-vm), el simulador está desactivado por defecto para evitar consumir presupuesto de LLM sin supervisión; actívalo explícitamente mediante `simulator.enabled=true`.

### Valores de Helm (los principales)

| Clave | Valor por defecto | Efecto |
|---|---|---|
| `replicas` | 1 | Número de pods de endpoint |
| `wazuh.managerHost` | "" (obligatorio) | El nombre de host del Service del Wazuh manager del tenant (p. ej. `wazuh-demo-wazuh-manager`) |
| `wazuh.credsSecret.name` | "" (obligatorio) | Secret existente con la contraseña de inscripción `authd` (normalmente `wazuh-<slug>-wazuh-creds`) |
| `wazuh.credsSecret.authdPasswordKey` | `AUTHD_PASS` | Clave dentro del Secret para la contraseña de `authd` |
| `simulator.enabled` | `false` | Interruptor principal. Desactivado por defecto: dejarlo desactivado mantiene los pods inactivos (sin alertas sintéticas) |
| `simulator.attackDelay` | 10 | Segundos tras el arranque del pod (agente inscrito) antes de la primera TTP |
| `simulator.attackInterval` | 120 | Segundos entre TTPs posteriores |
| `simulator.dailyAlertCap` | 30 | Límite por pod de emisiones `SOCTALK_ATTACK` por día UTC. 0 desactiva el límite |
| `image.repository` | `ghcr.io/soctalk/soctalk-linux-ep` | — |
| `securityContext.privileged` | `true` | Requerido para TTPs que tocan el kernel (namespaces de procesos, ajustes de permisos de archivos) |

### Nota sobre costos

Cada alerta simulada inicia una investigación de AI, que consume tokens de LLM (típico: ~50k de entrada / ~10k de salida por caso con los modelos por defecto). Con 2 pods × 30 alertas/día = 60 investigaciones/día. Ajusta `dailyCapPerPod` según tu presupuesto de demostración.

## Técnicas simuladas

25 TTPs de Linux de la matriz MITRE ATT&CK Enterprise. La lista completa está en [`attack-simulator/scripts/linux-techniques.txt`](https://github.com/soctalk/soctalk/blob/main/attack-simulator/scripts/linux-techniques.txt); resumida aquí por táctica:

| Táctica | IDs de TTP (seleccionados) |
|---|---|
| **Initial Access / Persistence** | T1098 (manipulación de cuentas), T1547.001 (scripts de arranque/inicio de sesión) |
| **Privilege Escalation** | T1548.003 (abuso de sudo) |
| **Defense Evasion** | T1027 (cmd ofuscado: decodificar base64 + ejecutar), T1070 (eliminación de indicadores) |
| **Credential Access** | T1110 (fuerza bruta), T1003.008 (acceso a `/etc/passwd` + `/etc/shadow`) |
| **Discovery** | T1046 (descubrimiento de servicios de red), T1082 (información del sistema), T1083 (descubrimiento de archivos/directorios), T1057 (descubrimiento de procesos) |
| **Lateral Movement** | T1021.004 (SSH) |
| **Collection** | T1560.001 (archivado de datos para preparar exfiltración) |
| **Command and Control** | T1105 (transferencia de herramientas de entrada) |
| **Exfiltration** | T1041 (a través de canal C2) |
| **Impact** | T1485 (destrucción de datos), T1486 (cifrado de datos), T1496 (secuestro de recursos) |
| **Execution / Scheduling** | T1053.003 (tarea programada / cron) |

Cada script emite una línea de syslog etiquetada `SOCTALK_ATTACK <TTP>: <description>` para que Wazuh tenga algo con qué hacer coincidir.

## Paquete de reglas de Wazuh

[`charts/wazuh/templates/manager-local-rules.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/wazuh/templates/manager-local-rules.yaml) incluye reglas personalizadas en el rango 100200-100299:

- **100200** — chain-root: coincide con cualquier línea de syslog `SOCTALK_ATTACK`
- **100210 – 100225** — reglas por TTP: asignan severidad (nivel 10–14) y etiquetas según la técnica de MITRE
- **100299** — regla comodín para TTPs no mapeadas (severidad 8)

Las alertas producidas llevan `attack.tactic`, `attack.technique` de MITRE y una descripción legible por humanos, de modo que el [`wazuh_worker`](/es-419/ai-pipeline) de SocTalk tiene contexto estructurado sobre el cual razonar.

## Ejecutar un solo ataque

Fuera del chart, puedes ejecutar técnicas individuales contra cualquier host con un agente de Wazuh:

```bash
ssh ops@<linux-ep-pod>
sudo /opt/scripts/run-attack.sh T1110
sudo /opt/scripts/run-attack.sh T1027.001
```

`run-attack.sh` es el punto de entrada: despacha a los scripts por TTP. Útil para demos en vivo donde quieres disparar una alerta específica bajo demanda.

## Eliminar el simulador

Para una instalación en cliente en vivo donde no quieres que las alertas del simulador diluyan la telemetría real:

```bash
helm uninstall linux-ep -n tenant-<slug>
```

Elimina los pods de endpoint. El paquete de reglas personalizadas de Wazuh permanece en su lugar, pero es inofensivo sin líneas de syslog `SOCTALK_ATTACK` que lo activen.

## Qué no está incluido aquí

- **Simulación de endpoint Windows** — solo Linux en esta versión. En el roadmap.
- **Simulación de endpoint macOS** — igual.
- **Campañas de emulación de adversarios** — solo TTP único; no encadenamos TTPs en escenarios multietapa.
- **Integración con Atomic Red Team** — `attack-simulator` está hecho a mano; no consume el YAML de Atomic directamente. La compatibilidad está en el roadmap.
