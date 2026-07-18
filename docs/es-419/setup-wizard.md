# Asistente de configuración

Configurador de primer arranque basado en navegador que se incluye con la [imagen de VM de demostración](/es-419/quickstart-vm). **No** forma parte de una instalación de producción: los usuarios de producción escriben a mano `values.yaml` y ejecutan `helm install` por su cuenta.

La función del asistente es:

1. Autenticar al operador con un token de configuración por arranque.
2. Recopilar la configuración mínima necesaria para instalar `soctalk-system`.
3. Escribir `/etc/soctalk/values.yaml`, `/etc/soctalk/llm.key` y un archivo env de incorporación de tenant.
4. Salir y ceder el control a `soctalk-firstboot.service`, que ejecuta `helm install` e incorpora un tenant de demostración.

El código fuente está en [`setup-wizard/`](https://github.com/soctalk/soctalk/tree/main/setup-wizard) (Go, ~600 líneas).

## Cómo llegar a él

Puerto `:8443` en la VM. Solo TLS; el asistente genera un certificado ECDSA P-256 autofirmado en el primer arranque que cubre las IP locales de la VM, `localhost` y `soctalk.local`. El puerto de enlace es `:8443` (no `:443`) para que no colisione con el Traefik incluido en k3s.

```text
https://<vm-ip>:8443/
```

## Token de configuración

El asistente genera un token de configuración de 256 bits al iniciarse por primera vez y lo escribe en `/var/log/soctalk-setup-token` (modo `0600`, propiedad de root). Recupéralo con:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

El token se rota en cada reinicio del asistente. No hay una API para recuperar un token perdido sin reiniciar la unidad; reiniciarla lo rota y lo vuelve a imprimir.

## Formulario de dos etapas

1. **Autenticar**: pega el token de configuración.
2. **Configurar**: completa los campos que se indican a continuación.

La página de ingreso del token envía a `POST /auth`; la página de configuración envía a `POST /submit`. Ambas usan cookies CSRF vinculadas con HMAC (`SameSite=Strict`, `HttpOnly`, `Secure`).

### Etapa 1 — Autenticar

![Asistente de configuración — ingreso del token](/screenshots/setup-wizard-token.png)

### Etapa 2 — Configurar

![Asistente de configuración — formulario de configuración, completado](/screenshots/setup-wizard-config-filled.png)

### Identidad

| Campo | Tipo | Notas |
|---|---|---|
| Nombre de MSSP / organización | texto, ≤120 caracteres | se convierte en `install.msspName` en los valores del chart |
| Nombre de host | FQDN opcional, ≤253 caracteres | en blanco → toma por defecto `soctalk.local`; el chart rechaza direcciones IP en `spec.rules[0].host` |
| Correo del administrador | correo | se convierte en el `mssp_admin` de arranque (la inicialización del chart V1 crea este rol, no `platform_admin`) |
| Contraseña del administrador | contraseña, ≥12 caracteres | se escribe en el archivo de valores como `install.bootstrapAdmin.password`. La inicialización del chart crea el usuario con `must_change=false`, por lo que el primer inicio de sesión es inmediato |

### LLM

| Campo | Tipo | Notas |
|---|---|---|
| Proveedor | select (`anthropic`, `openai`) | **Solo de visualización en esta versión.** El asistente recopila el valor pero no lo escribe en los valores del chart; se aplica el valor por defecto del chart (`openai-compatible`). Para fijar un proveedor específico, edita `/etc/soctalk/values.yaml` para establecer `defaults.llm.provider` antes de que se ejecute `soctalk-firstboot.service`, o usa `helm upgrade` después de la instalación. Su integración a través del asistente está prevista para una versión futura |
| Clave de API | contraseña | se escribe en `/etc/soctalk/llm.key` (modo `0600`), NO en el archivo de valores. El instalador crea un Secret de Kubernetes a partir de ella (`soctalk-system-llm-api-key`) con los campos de datos `anthropic-api-key` y `openai-api-key`, de modo que el entorno de ejecución del chart puede usar el proveedor que indiquen los valores |

### Incorporación del tenant de demostración

El asistente también escribe `/etc/soctalk/onboard.env`:

```text
ADMIN_EMAIL='<email>'
ADMIN_PW='<password>'
INGRESS_HOST='<hostname or soctalk.local>'
TENANT_SLUG=demo
TENANT_NAME='<org name> — Demo'
```

`soctalk-firstboot.sh` lee esto después de que `helm install` tenga éxito, inicia sesión mediante `POST /api/auth/login` y llama a `POST /api/mssp/tenants/onboard` con `{slug: demo, profile: poc, display_name: <name>}`. La incorporación del tenant es **asíncrona**: la API devuelve 202 de inmediato; el controlador de aprovisionamiento levanta el stack de Wazuh en segundo plano. El instalador de primer arranque no espera a que el tenant llegue a `active` antes de salir.

## Qué escribe el asistente

| Ruta | Modo | Contenido |
|---|---|---|
| `/etc/soctalk/values.yaml` | 0640 | Valores del chart renderizados (`install.*`, `ingress.*`, `postgres.*`) |
| `/etc/soctalk/llm.key` | 0600 | Clave de API del LLM, una sola línea |
| `/etc/soctalk/onboard.env` | 0600 | Archivo env de incorporación del tenant de demostración |
| `/var/lib/soctalk-wizard.done` | 0644 | Centinela: impide que el asistente se vuelva a activar en arranques posteriores |

## Unidad systemd

```text
[Unit]
After=cloud-init.target network-online.target
ConditionPathExists=!/var/lib/soctalk-firstboot.done
ConditionPathExists=!/var/lib/soctalk-wizard.done
ConditionPathExists=!/etc/soctalk/values.yaml

[Install]
WantedBy=cloud-init.target
```

Se engancha a `cloud-init.target` (no a `multi-user.target`) para evitar un ciclo de ordenamiento a través de `After=cloud-final.service`. Se permite que el user-data de cloud-init deje `/etc/soctalk/values.yaml` directamente: si lo hace, el asistente nunca arranca y `soctalk-firstboot.service` pasa directamente a `helm install`.

## Endurecimiento

La unidad usa el endurecimiento estándar de systemd: `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `RestrictNamespaces=true`, `MemoryDenyWriteExecute=true`. Las escrituras se limitan a `/etc/soctalk`, `/var/lib` y `/var/log`. El asistente enlaza el puerto privilegiado `:8443` mediante `AmbientCapabilities=CAP_NET_BIND_SERVICE`.

Tras un envío exitoso, el asistente escribe el centinela y sale. La condición `ConditionPathExists=!sentinel` de systemd impide que se reinicie en el arranque.

## Anti-abuso

- **Control de token** en cada endpoint autenticado. Comparación en tiempo constante.
- **CSRF** mediante cookies de doble envío vinculadas con HMAC en cada POST que cambia estado.
- **Límite de tasa**: mínimo de 30 s entre intentos de autenticación por IP de origen; 10 fallos en una hora bloquean la IP durante una hora. (Codex marcó esto como un vector trivial de DoS detrás de NAT: los operadores tras un NAT compartido pueden ver bloqueada una configuración legítima. Reinicia la unidad para limpiarlo).
- **Solo TLS autofirmado**. El asistente nunca sirve HTTP en texto plano. Los clientes aceptan el certificado autofirmado una vez; los usuarios de producción no deberían llegar nunca al asistente.

## Qué pasa después del envío

El asistente devuelve `{poll: "/status", status: "accepted"}` y sale tras una ventana de gracia de 3 segundos (para que el poller del cliente pueda obtener la respuesta de éxito). Luego:

1. `soctalk-firstboot.service` detecta que existe `values.yaml` y arranca.
2. `systemctl start k3s` (Packer instaló k3s pero no lo inició, de modo que el asistente tenía `:8443` libre).
3. Crea el namespace `soctalk-system` + el Secret del LLM.
4. `helm upgrade --install soctalk-system /opt/soctalk/charts/soctalk-system --values /etc/soctalk/values.yaml --wait --timeout 15m`.
5. Aplica un parche a la NetworkPolicy `kube-system → soctalk-system` para que Traefik pueda alcanzar los Services de soctalk-system.
6. Sondea `/api/auth/me` a través de Traefik (truco de la cabecera Host) durante hasta 10 minutos. Tanto 200 como 401 significan "Traefik está enrutando"; el bucle acepta cualquiera de los dos.
7. Inicia sesión como el administrador de arranque y llama a `POST /api/mssp/tenants/onboard`.
8. Escribe `/var/lib/soctalk-firstboot.done`.

Sigue `/var/log/soctalk-firstboot.log` (o `journalctl -u soctalk-firstboot -f`) para observarlo.

## Restablecer / volver a ejecutar

Para volver a ejecutar el asistente después de una instalación exitosa:

```bash
sudo rm /var/lib/soctalk-firstboot.done /var/lib/soctalk-wizard.done /etc/soctalk/values.yaml
sudo systemctl restart soctalk-setup-wizard
```

Esto es destructivo: el release de helm existente sigue siendo dueño del namespace `soctalk-system`. Para un restablecimiento limpio, ejecuta primero `helm uninstall soctalk-system -n soctalk-system`.
