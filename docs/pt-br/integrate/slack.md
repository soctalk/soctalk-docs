# Slack

O SocTalk se comunica com o Slack de duas formas. Ambas usam as mesmas credenciais do app Slack, mas atendem a necessidades operacionais diferentes:

| Backend | Direção | Conexão no chart V1 |
|---|---|---|
| **Notificações via webhook** | unidirecional (saída) | Código conectado apenas no ponto de entrada legado (`src/soctalk/main.py`). O `app_v1` do chart V1 **não** o monta. Trate as notificações abaixo como a conexão planejada; hoje, publicar exige rodar o orquestrador legado junto ao V1 |
| **HIL em Socket Mode** | bidirecional | Código presente (`src/soctalk/hil/backends/slack.py`); também não conectado ao V1 |

A única superfície HIL funcional no caminho de instalação do V1 é a fila de revisão do dashboard. As páginas do Slack abaixo descrevem a conexão planejada para quando ambos os backends forem entregues no V1. Para o fluxo de revisão do lado do analista, consulte [Revisão humana (HIL)](/pt-br/human-review).

## Crie o app Slack

1. https://api.slack.com/apps → **Create New App** → From scratch.
2. Nome: `SocTalk` (ou o nome da sua instalação). Workspace: aquele que sua equipe de SOC usa.
3. **OAuth & Permissions** → adicione Bot Token Scopes:
   - `chat:write`
   - `chat:write.public` (permite que o bot publique em canais dos quais não é membro)
   - `channels:read`
   - Para revisão interativa: `commands` (apenas se você também quiser slash commands) e `app_mentions:read`.
4. **Install App** → Install to Workspace. Copie o **Bot User OAuth Token** (`xoxb-…`).
5. (Somente HIL) **Socket Mode** → habilite. Gere um **App-Level Token** com o escopo `connections:write` (`xapp-…`).
6. (Somente HIL) **Interactivity & Shortcuts** → habilite. Com o Socket Mode habilitado, você não precisa informar uma Request URL.
7. (Somente HIL) **Event Subscriptions** → habilite; inscreva-se em `interactive_message_actions` e `block_actions`.
8. Convide o bot para o seu canal de revisão: `/invite @SocTalk`.

## Notificações via webhook

Para notificações unidirecionais, você só precisa de uma Incoming Webhook URL, não do processo completo do app acima. Você pode:

- Instalar um app **Incoming Webhooks** separado no workspace e obter a URL.
- Ou usar o recurso Incoming Webhooks do app que você criou acima.

### Configurar

MSSP UI → Settings → Slack:

| Campo | Notas |
|---|---|
| Webhook URL | `https://hooks.slack.com/services/T…/B…/…` |
| Channel | Substituição opcional de canal; caso contrário, o webhook publica no canal padrão dele |
| Notify on escalation | Ligado por padrão. Publica quando um veredito é encerrado como `escalate` |
| Notify on verdict | Desligado por padrão. Publica também cada disposição de `close` — volume alto |

**Não há API para alterar as configurações da integração com o Slack no V1** — o chart V1 não monta a rota legada `PUT /api/settings`. A configuração do Slack é somente por ambiente: forneça `SLACK_WEBHOOK_URL`, `SLACK_CHANNEL`, `SLACK_NOTIFY_ON_ESCALATION` e `SLACK_NOTIFY_ON_VERDICT` como variáveis de ambiente no Deployment `soctalk-system-api`.

As notificações do Slack cobrem apenas eventos de escalonamento e veredito (não existe um toggle `notify_on_capacity`).

Os tokens (webhook URL, bot token, app token) **não** podem ser gravados por esse endpoint — forneça-os como variáveis de ambiente no Deployment do orquestrador (`SLACK_WEBHOOK_URL`, `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`) ou via env montado por Secret. Faça a rotação aplicando patch no Secret e reiniciando o orquestrador.

### Formato da mensagem

Exemplo de escalonamento:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1
AI verdict: Escalate · confidence: medium · 1 malicious observable
View → https://mssp.your-mssp.example/investigations/abc123
```

Block Kit mínimo; sem botões (esses são função do backend HIL).

## HIL em Socket Mode

> **Status:** o backend HIL bidirecional do Slack existe no código (`src/soctalk/hil/backends/slack.py`), mas **não está conectado ao runtime do chart V1 nesta versão**. A fila de revisão do dashboard em `/review` é a única superfície HIL funcional. Trate a configuração do HIL do Slack abaixo como o design planejado.

Para o fluxo de revisão do analista. O mesmo app Slack, mais o App-Level Token. O backend HIL do SocTalk abre um WebSocket de saída para o Slack — nenhum endpoint público é necessário; funciona atrás de NAT.

### Configurar

O toggle de UI (Channel, Enable HIL, notify_on_*) fica em MSSP UI → Settings → Slack. Os próprios tokens são somente por ambiente nesta versão:

```yaml
env:
  - name: SLACK_BOT_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: bot_token } }
  - name: SLACK_APP_TOKEN
    valueFrom: { secretKeyRef: { name: soctalk-slack-creds, key: app_token } }
```

O roteamento de canal do Slack por tenant **não está implementado nesta versão** — o `slack_channel` configurado para toda a instalação recebe todas as revisões e notificações, independentemente de qual tenant o caso pertence. O roteamento por tenant está no roadmap.

### O que é publicado

Quando a IA solicita revisão humana, o SocTalk publica um card no canal configurado:

```text
SocTalk · Demo Tenant · [Critical]
T1110 brute-force technique simulated on linux-ep-1

AI verdict: Escalate (confidence: medium)
Observables:
  · 198.51.100.7 (Cortex: malicious, 8/12 analyzers)
  · sshd (process)
  · alice@linux-ep-1 (user)

[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Os botões disparam eventos `block_actions`; o backend HIL do SocTalk os processa e grava a decisão de volta no estado do caso. Reject e Needs-more-info abrem um modal para a justificativa (obrigatória).

Uma versão futura conectará o dashboard e o Slack para compartilharem o estado de revisão. No V1, os dois backends ainda não compartilham estado — se o HIL do Slack estivesse habilitado, a ação no Slack não descartaria o card do dashboard, e vice-versa.

## Rotacionar tokens

1. Em OAuth & Permissions do app Slack, faça **Reinstall app** para rotacionar o bot token. Copie o novo `xoxb-…`.
2. (HIL) **Basic Information → App-Level Tokens** → revogue + regenere. Copie o novo `xapp-…`.
3. Aplique patch no Secret:
   ```bash
   kubectl -n soctalk-system patch secret soctalk-slack-creds \
     -p '{"data":{"bot_token":"'$(echo -n xoxb-NEW | base64)'","app_token":"'$(echo -n xapp-NEW | base64)'"}}'
   ```
4. Reinicie o orquestrador: `kubectl -n soctalk-system rollout restart deploy/soctalk-system-api`.
5. O backend HIL se reconecta com os novos tokens em cerca de 10 s após o pod ficar pronto.

## Solução de problemas

| Sintoma | Verifique |
|---|---|
| O bot não publica | `kubectl -n soctalk-system logs deploy/soctalk-system-api | grep slack`. Causa comum: bot não convidado para o canal de destino |
| Os botões do HIL retornam "this action is no longer valid" | A proposta foi decidida por outro caminho (dashboard ou expirada). Atualize o card |
| O bot publica, mas nunca reage aos cliques nos botões | Socket Mode não habilitado, ou o App-Level Token sem `connections:write`. Recrie o app token |
| Os cards chegam truncados | O Block Kit limita uma única mensagem a 50 blocos. O SocTalk agrupa listas longas de observáveis em vários cards; você deve ver um rodapé "X observables shown of Y" |

## Privacidade

A mensagem do Slack inclui observáveis (IPs, nomes de usuário, hashes de arquivo). Se o seu workspace tiver restrições de conformidade, restrinja a integração via configurações por tenant ou use apenas notificações via webhook (que não contêm corpos de observáveis).

## Ponteiros de código

| Conceito | Arquivo |
|---|---|
| Notificador de webhook do Slack | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Backend HIL do Slack | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Templates de Block Kit | [`src/soctalk/notifications/slack_templates/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/notifications) |
