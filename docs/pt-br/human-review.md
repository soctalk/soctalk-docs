# Revisão humana (HIL)

Como um analista de MSSP processa ações propostas por AI que aguardam um portão humano.

Existem dois backends no código: a **fila do dashboard** (sempre ativa) e o **Slack bidirecional** (opt-in). O backend do dashboard é o único integrado ao runtime do chart V1 nesta versão; o backend Slack bidirecional existe no código, mas ainda não é ativado pelo caminho de instalação V1.

Para o lado do modelo — quando a AI transfere para a revisão humana — consulte [Pipeline de AI → Portão de revisão humana](/pt-br/ai-pipeline#human-review-gate).

## Estados de decisão

Toda revisão tem o mesmo contrato de três decisões, independentemente do backend:

| Decisão | Efeito nesta versão |
|---|---|
| `approve` | A linha pendente da revisão é marcada como concluída e o texto de `feedback` é anexado à trilha de auditoria. O caso **não** é automaticamente retomado ou fechado pelo approve — hoje esse acompanhamento fica a cargo do analista. |
| `reject` | O caso é fechado como falso positivo (`auto_closed_fp`). Terminal — o grafo não é reinvocado com o `feedback` humano. |
| `more_info` | A linha da revisão é atualizada para `info_requested` com a lista de perguntas. O grafo **não** é automaticamente reinvocado; o analista retoma o caso manualmente. |

As decisões gravam linhas de auditoria somente-adição marcadas com a identidade do humano, o timestamp e a justificativa em texto livre. Elas nunca são editáveis após o envio.

## Backend do dashboard

A [Fila de revisão](/pt-br/mssp-ui#reviews-human-in-the-loop) em `/review` mostra todas as revisões pendentes de todos os tenants. Os cards exibem:

- Título da investigação + tenant
- Chip de veredito da AI (`AI: Escalate / Close / Needs More Info`)
- Severidade
- Contagem de alertas + prazo (se um SLA estiver configurado)

Clicar em **Review** abre o detalhe da investigação, rolado até o painel de proposta. O painel mostra:

- A justificativa da AI (markdown completo)
- As evidências observáveis (IPs, hashes, usuários) com reputação/enriquecimento do Cortex / MISP
- Três botões: **Approve**, **Reject**, **Needs more info**
- Uma área de texto para a justificativa (obrigatória para Reject / Needs more info)

O envio atualiza a linha da revisão pendente no banco de dados (`approve` / `reject` / `more_info` mais o `feedback` ou `questions` do operador). **Não há outbox de propostas no V1** — rascunhos anteriores descreviam um outbox indexado por idempotency key consumido por executores downstream (criação de caso no TheHive, notificação no Slack), mas esse pipeline não está implementado nesta versão. As decisões do revisor param na linha da revisão + log de auditoria; qualquer efeito downstream (por exemplo, criação de caso no TheHive) só ocorre se o worker de AI o criou inline durante a execução do grafo.

## Backend Slack bidirecional

O Socket Mode do Slack é usado para que o SocTalk não precise de um endpoint de webhook público — a instalação do SocTalk inicia um WebSocket de saída para o Slack.

### Pré-requisitos

- Um app Slack no seu workspace com o Socket Mode habilitado
- Um token de nível de app com `connections:write`
- Um token de bot com `chat:write`, `chat:write.public`, `channels:read`
- Um canal onde o bot foi convidado

### Configurar o SocTalk

Na UI do MSSP → Settings → Slack:

- **Enable Slack** → ativado
- **Bot token** → `xoxb-…`
- **App token** → `xapp-…`
- **Channel** → `#soc-reviews` (ou o que preferir)
- **Notify on escalation** → ativado (envia todo veredito de escalonamento)
- **Notify on verdict** → opcional (também envia vereditos de fechamento; alto volume)

Toda a configuração do Slack (tokens, canal, toggles de notificação) é apenas por ambiente no V1 — a rota legada `PUT /api/settings` não é montada pelo chart V1. Consulte [Slack — Configurar](/pt-br/integrate/slack#configure) para o padrão de injeção de variáveis de ambiente.

### Experiência do operador

Quando a AI solicita uma revisão humana, o SocTalk publica um card no canal configurado:

```text
[Critical] T1110 brute-force technique simulated on linux-ep-1 (Demo Tenant)
AI verdict: Escalate (confidence: medium)
Observables: 198.51.100.7 (Cortex: malicious, 8/12), sshd, alice@linux-ep-1
[Approve]  [Reject]  [Needs more info]  [View in UI →]
```

Os botões respondem através do Socket Mode; a instalação do SocTalk registra a decisão indexada pela idempotency key da proposta. A mesma proposta na fila do dashboard é atualizada em tempo real — aprovar no Slack fecha o card do dashboard.

Se o analista clicar em **Reject** ou **Needs more info**, um diálogo do Slack abre para a justificativa (obrigatória).

O link **View in UI →** faz deep-link para o detalhe da investigação com o painel de proposta já rolado à vista.

### Roteamento multi-tenant

Nesta versão, todas as revisões vão para o único canal de toda a instalação configurado em Settings → Slack. O roteamento por tenant para canais do Slack **não** está implementado; um campo `slack_channel_override` no payload de onboarding foi mencionado em documentação anterior, mas o runtime o ignora. O roteamento por tenant está no roadmap.

### Notificações de saída (unidirecionais)

As mesmas credenciais do Slack acionariam notificações de webhook unidirecionais (fechamentos de caso, decisões de veredito) em uma versão futura. O código do notificador de webhook existe em `src/soctalk/notifications/slack_webhook.py`, mas só está integrado no entry point legado; o `app_v1` do chart V1 não o invoca. Não existe toggle `notify_on_capacity` em nenhuma versão.

## Contabilização de resultados

As decisões de revisão gravam uma linha de auditoria. O gauge `soctalk_tenant_pending_reviews` está **definido** no código de observabilidade, mas **não é ativamente atualizado** no V1 — permanece em 0. O rastreamento da profundidade real da fila de revisão está no roadmap. Um contador planejado `human_review_decisions_total` (por analista) também ainda não está instrumentado.

## Bypass: modo somente-AI

Um modo "auto-aprovar todo escalonamento" sem portão humano **não** está implementado nesta versão. O nó de veredito sempre roteia `escalate` através de `human_review`. Remover o portão humano está no roadmap como um toggle explícito restrito apenas a `platform_admin`, com a justificativa sendo auditada — não como um padrão silencioso.

## Ponteiros de código

| Conceito | Arquivo |
|---|---|
| Interface do backend HIL | [`src/soctalk/hil/backends/__init__.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Backend Slack bidirecional | [`src/soctalk/hil/backends/slack.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/hil/backends/slack.py) |
| Backend do dashboard | [`src/soctalk/hil/backends/dashboard.py`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/hil/backends) |
| Webhook unidirecional do Slack | [`src/soctalk/notifications/slack_webhook.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/notifications/slack_webhook.py) |
| Enum de status da proposta | [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) |
