# Assistente de configuração

Configurador de primeira inicialização baseado em navegador que acompanha a [imagem de VM de demonstração](/pt-br/quickstart-vm). Ele **não** faz parte de uma instalação de produção — usuários de produção escrevem manualmente o `values.yaml` e executam o `helm install` por conta própria.

O trabalho do assistente é:

1. Autenticar o operador com um token de configuração por inicialização.
2. Coletar a configuração mínima necessária para instalar o `soctalk-system`.
3. Escrever `/etc/soctalk/values.yaml`, `/etc/soctalk/llm.key` e um env-file de onboarding de tenant.
4. Encerrar e transferir o controle para o `soctalk-firstboot.service`, que executa o `helm install` e faz o onboarding de um tenant de demonstração.

O código-fonte está em [`setup-wizard/`](https://github.com/soctalk/soctalk/tree/main/setup-wizard) (Go, ~600 linhas).

## Como acessá-lo

Porta `:8443` na VM. Somente TLS; o assistente gera um certificado ECDSA P-256 autoassinado na primeira inicialização, cobrindo os IPs locais da VM, `localhost` e `soctalk.local`. A porta de bind é `:8443` (não `:443`) para não colidir com o Traefik embutido no k3s.

```text
https://<vm-ip>:8443/
```

## Token de configuração

O assistente gera um token de configuração de 256 bits na primeira inicialização e o escreve em `/var/log/soctalk-setup-token` (modo `0600`, pertencente ao root). Recupere-o com:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

O token é rotacionado a cada reinício do assistente. Não há API para recuperar um token perdido sem reiniciar a unidade; reiniciá-la rotaciona e reimprime o token.

## Formulário de duas etapas

1. **Autenticar** — cole o token de configuração.
2. **Configurar** — preencha os campos abaixo.

A página de entrada do token submete para `POST /auth`; a página de configuração submete para `POST /submit`. Ambas usam cookies CSRF vinculados por HMAC (`SameSite=Strict`, `HttpOnly`, `Secure`).

### Etapa 1 — Autenticar

![Assistente de configuração — entrada do token](/screenshots/setup-wizard-token.png)

### Etapa 2 — Configurar

![Assistente de configuração — formulário de configuração, preenchido](/screenshots/setup-wizard-config-filled.png)

### Identidade

| Campo | Tipo | Observações |
|---|---|---|
| Nome da MSSP / organização | texto, ≤120 caracteres | torna-se `install.msspName` nos valores do chart |
| Hostname | FQDN opcional, ≤253 caracteres | em branco → assume o padrão `soctalk.local`; o chart rejeita endereços IP em `spec.rules[0].host` |
| E-mail do administrador | e-mail | torna-se o `mssp_admin` de bootstrap (a inicialização do chart V1 cria essa função, não `platform_admin`) |
| Senha do administrador | senha, ≥12 caracteres | escrita no arquivo de valores como `install.bootstrapAdmin.password`. A inicialização do chart cria o usuário com `must_change=false`, então o primeiro login é imediato |

### LLM

| Campo | Tipo | Observações |
|---|---|---|
| Provedor | select (`anthropic`, `openai`) | **Apenas exibição nesta versão.** O assistente coleta o valor, mas não o escreve nos valores do chart; o padrão do chart (`openai-compatible`) se aplica. Para fixar um provedor específico, edite `/etc/soctalk/values.yaml` para definir `defaults.llm.provider` antes que o `soctalk-firstboot.service` seja executado, ou faça `helm upgrade` após a instalação. Rastreado para integração através do assistente em uma versão futura |
| Chave de API | senha | escrita em `/etc/soctalk/llm.key` (modo `0600`) — NÃO no arquivo de valores. O instalador cria um Kubernetes Secret a partir dela (`soctalk-system-llm-api-key`) com os campos de dados `anthropic-api-key` e `openai-api-key`, para que o runtime do chart possa usar o provedor indicado pelos valores |

### Onboarding do tenant de demonstração

O assistente também escreve `/etc/soctalk/onboard.env`:

```text
ADMIN_EMAIL='<email>'
ADMIN_PW='<password>'
INGRESS_HOST='<hostname or soctalk.local>'
TENANT_SLUG=demo
TENANT_NAME='<org name> — Demo'
```

O `soctalk-firstboot.sh` lê esse arquivo após o `helm install` ser bem-sucedido, faz login via `POST /api/auth/login` e chama `POST /api/mssp/tenants/onboard` com `{slug: demo, profile: poc, display_name: <name>}`. O onboarding do tenant é **assíncrono**: a API retorna 202 imediatamente; o controlador de provisionamento sobe a stack do Wazuh em segundo plano. O instalador de primeira inicialização não espera o tenant atingir o estado `active` antes de encerrar.

## O que o assistente escreve

| Caminho | Modo | Conteúdo |
|---|---|---|
| `/etc/soctalk/values.yaml` | 0640 | Valores renderizados do chart (`install.*`, `ingress.*`, `postgres.*`) |
| `/etc/soctalk/llm.key` | 0600 | Chave de API do LLM, uma única linha |
| `/etc/soctalk/onboard.env` | 0600 | Env-file de onboarding do tenant de demonstração |
| `/var/lib/soctalk-wizard.done` | 0644 | Sentinela — impede o assistente de disparar novamente em inicializações subsequentes |

## Unidade systemd

```text
[Unit]
After=cloud-init.target network-online.target
ConditionPathExists=!/var/lib/soctalk-firstboot.done
ConditionPathExists=!/var/lib/soctalk-wizard.done
ConditionPathExists=!/etc/soctalk/values.yaml

[Install]
WantedBy=cloud-init.target
```

Ela se conecta ao `cloud-init.target` (não ao `multi-user.target`) para evitar um ciclo de ordenação através de `After=cloud-final.service`. O user-data do cloud-init pode gravar `/etc/soctalk/values.yaml` diretamente — se o fizer, o assistente nunca inicia e o `soctalk-firstboot.service` segue direto para o `helm install`.

## Hardening

A unidade usa o hardening padrão do systemd: `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `RestrictNamespaces=true`, `MemoryDenyWriteExecute=true`. As gravações ficam confinadas a `/etc/soctalk`, `/var/lib` e `/var/log`. O assistente faz o bind da porta privilegiada `:8443` via `AmbientCapabilities=CAP_NET_BIND_SERVICE`.

Após um submit bem-sucedido, o assistente grava a sentinela e encerra. O `ConditionPathExists=!sentinel` do systemd impede que ele reinicie na próxima inicialização.

## Antiabuso

- **Bloqueio por token** em cada endpoint autenticado. Comparação em tempo constante.
- **CSRF** via cookies de double-submit vinculados por HMAC em cada POST que altera estado.
- **Rate limit**: mínimo de 30 s entre tentativas de autenticação por IP de origem; 10 falhas dentro de uma hora bloqueiam o IP por uma hora. (O Codex apontou isso como um vetor trivial de DoS atrás de NAT — operadores atrás de um NAT compartilhado podem ver a configuração legítima bloqueada. Reinicie a unidade para limpar.)
- **Somente TLS autoassinado**. O assistente nunca serve HTTP em texto simples. Os clientes aceitam o certificado autoassinado uma vez; usuários de produção nunca deveriam acessar o assistente.

## O que acontece após o submit

O assistente retorna `{poll: "/status", status: "accepted"}` e encerra após uma janela de tolerância de 3 segundos (para que o poller do cliente possa capturar a resposta de sucesso). Em seguida:

1. O `soctalk-firstboot.service` percebe que o `values.yaml` existe e inicia.
2. `systemctl start k3s` (o k3s foi instalado, mas não iniciado pelo Packer, então o assistente tinha a porta `:8443` livre).
3. Cria o namespace `soctalk-system` + o LLM Secret.
4. `helm upgrade --install soctalk-system /opt/soctalk/charts/soctalk-system --values /etc/soctalk/values.yaml --wait --timeout 15m`.
5. Aplica um patch na NetworkPolicy `kube-system → soctalk-system` para que o Traefik possa alcançar os Services do soctalk-system.
6. Faz polling de `/api/auth/me` através do Traefik (truque de cabeçalho Host) por até 10 minutos. Tanto 200 quanto 401 significam "o Traefik está roteando"; o loop aceita qualquer um dos dois.
7. Faz login como o administrador de bootstrap e chama `POST /api/mssp/tenants/onboard`.
8. Grava `/var/lib/soctalk-firstboot.done`.

Acompanhe `/var/log/soctalk-firstboot.log` (ou `journalctl -u soctalk-firstboot -f`) para observar.

## Reset / reexecução

Para reexecutar o assistente após uma instalação bem-sucedida:

```bash
sudo rm /var/lib/soctalk-firstboot.done /var/lib/soctalk-wizard.done /etc/soctalk/values.yaml
sudo systemctl restart soctalk-setup-wizard
```

Isso é destrutivo — o release existente do helm ainda é dono do namespace `soctalk-system`. Para um reset limpo, execute `helm uninstall soctalk-system -n soctalk-system` primeiro.
