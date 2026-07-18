# Tour pela UI do MSSP

O que um operador de MSSP vê após o login. Leia isto uma vez antes de [Operações Diárias](/pt-br/operations) para que os runbooks façam sentido.

## Escopo: MSSP inteiro vs. tenant único

Todo usuário do MSSP tem dois escopos de operação:

- **Todos os tenants** — filas cross-tenant e visões agregadas. Este é o padrão para `mssp_admin`. O canto superior direito exibe um chip **Todos os tenants**.
- **Tenant único** — o admin do MSSP abriu o SOC de um cliente (o chip mostra `Tenant: <name>`). Todas as visões ficam restritas a esse tenant; o botão **Clear** ao lado do chip volta para o escopo de MSSP inteiro.

O escopo também comanda a barra de navegação. No escopo de MSSP inteiro você vê Tenants na barra; no escopo de tenant ela fica oculta, porque as telas de detalhe do tenant tomam o seu lugar.

## Barra de navegação

A barra à esquerda é persistente em todas as páginas. De cima para baixo:

| Ícone      | Página            | O que exibe |
|------------|-------------------|---------------|
| SocTalk    | `/`               | Início / dashboard |
| Dashboard  | `/`               | Blocos de KPI do MSSP + gráfico de throughput de investigações |
| Tenants    | `/tenants`        | Todos os SOCs de clientes (somente no escopo de MSSP inteiro) |
| Investigations | `/investigations` | Fila cross-tenant de casos ativos |
| Reviews    | `/review`         | Fila de propostas com human-in-the-loop |
| Chat       | `/chat`           | Chat do operador com o agente SocTalk |
| Analytics  | `/analytics`      | Tendências de nível de serviço entre tenants |
| Audit Log  | `/audit`          | Log de eventos append-only |
| Settings   | `/settings`       | Provedor de LLM, chaves de integração |
| Live / Offline | —              | Indicador de conexão em tempo real (saúde do WebSocket) |

No canto superior direito de cada página há o chip do usuário (`email`, `role`) e um botão **Log out**.

## Dashboard

![Dashboard do MSSP](/screenshots/mssp-dashboard.png)

Blocos de KPI na linha superior (Open Investigations, Pending Reviews, Avg Time to Triage, Avg Time to Verdict) e uma segunda linha de contadores operacionais (Created Today, Closed Today, Escalations, Auto-Closed, Malicious IOCs).

Abaixo dos blocos:

- **Investigation Throughput (24h)** — gráfico de barras+linha de criadas / fechadas manualmente / fechadas automaticamente / escaladas / backlog.
- **Verdicts Today** — contagem corrente dos vereditos de AI do dia.
- **Active Investigations** — lista curta de casos em andamento com link direto para cada um.

O gráfico é o widget mais observado para planejamento de capacidade; se o backlog (linha vermelha) tende a subir enquanto o throughput permanece estável, o MSSP está subprovisionado ou o modelo está deixando casos demais escaparem para a revisão humana.

## Tenants

### Lista de tenants

![Lista de tenants](/screenshots/tenants-list.png)

Uma linha por cliente. Colunas: Display Name, Slug, Profile (`poc` ou `persistent`), State (`pending | provisioning | active | degraded | suspended | decommissioning | archived | purged`), Created, Actions.

O botão **+ New Tenant** abre o formulário de onboarding. O profile é fixado no momento da criação; trocá-lo depois exige decommission + recriação.

### Detalhe do tenant

![Detalhe do tenant](/screenshots/tenant-detail.png)

Três seções:

1. **Identity** — ID do tenant, profile, timestamps de criação / mudança de estado. O slug aparece abaixo do display name no cabeçalho.
2. **Actions** — Suspend / Resume / Retry Provisioning / Decommission. **Suspend, nesta release, muda o estado do tenant para `suspended`** para que o orquestrador pare de agendar novas investigações; ele **não** escala os workloads. Para um corte definitivo, siga [Operações Diárias → Desabilitar em emergência](/pt-br/operations#emergency-disable-a-tenant-immediately). **Retry Provisioning** só funciona em tenants em `degraded` — a API rejeita `:retry` em tenants em `pending` (`pending → provisioning` é automático na primeira tentativa).
3. **Lifecycle Events** — log cronológico da máquina de estados de provisionamento: `preflight_ok → secrets_minted → namespace_ready → secrets_applied → helm_applied (soctalk-tenant chart) → helm_applied (Wazuh chart) → workloads_ready → integration_config_written → active`. As duas linhas `helm_applied` se distinguem pelo payload do evento (identidade do chart). Quando um tenant fica travado, esta tabela mostra qual passo falhou.

Fora isso, a página é somente leitura; o SOC por tenant (Wazuh, Cortex, TheHive) abre em sua própria janela via a ação **Open SOC** na lista de tenants.

## Investigations

### Lista

![Lista de investigações](/screenshots/investigations-list.png)

Fila cross-tenant. Filtros: status (Pending / Active / Awaiting Enrichment / Awaiting Verdict / Awaiting Human / Escalated / Closed) e fase (Triage / Enrichment / Analysis / Verdict / Escalation / Closed). Cada linha exibe Tenant, Title, Status, Phase, Severity (Critical / High / Medium / Low), contagem de Alertas, contagem de Malicious IOC, Verdict, Created, Actions.

Clique em **View** (ou no título) para abrir a página de detalhe.

### Detalhe

![Detalhe da investigação](/screenshots/investigation-detail.png)

Layout:

- **Header** — título, badges de status (Active/Closed, Phase atual, Severity).
- **Blocos de KPI** — Alerts, Observables (total/malicious/suspicious), Time to Triage, Time to Verdict.
- **Details** — ID, Created, Updated.
- **Event Timeline** — inbox cronológico de eventos do caso (imutável, append-only).
- **Agent Run** — gasto de tokens vs. o orçamento configurado por execução (`case_runs.tokens_budget`, padrão do modelo 200.000) e disposição (`pending | active | failed | completed`).
- **Observable Summary** — totais discriminados como Malicious / Suspicious / Clean.

O botão flutuante **Ask AI** abre uma conversa lateral que opera sobre o contexto deste caso.

## Reviews (human-in-the-loop)

![Fila de revisão](/screenshots/review-queue.png)

A fila cross-tenant de propostas de AI aguardando um gate humano. Cada linha exibe o título da proposta, contagem de alertas, prazo, severity, chip de veredito da AI (`AI: Escalate / Close / Needs More Info`) e um botão **Review**.

Revisar registra a decisão (`approve | reject | more_info`), que atualiza a linha de revisão pendente no banco de dados. Na V1 **não há pipeline downstream baseado em outbox**; a decisão para na linha de revisão + no log de auditoria. Qualquer criação de caso no TheHive ou notificação no Slack precisa acontecer inline durante a execução do grafo de AI.

Existe um backend de HIL bidirecional com o Slack no código (`src/soctalk/hil/backends/slack.py`), mas ele **não está conectado ao runtime do chart da V1**. A fila do dashboard é a única superfície de HIL funcional hoje.

## Chat

A página de chat abre uma conversa do operador com o agente SocTalk. Ela é consciente de escopo: no escopo de MSSP inteiro você pode perguntar sobre todos os tenants; no escopo de tenant a conversa fica vinculada aos dados de um cliente. Útil para perguntas ad-hoc ("mostre as tentativas de brute-force desta semana no tenant X") que não justificam uma query salva.

## Analytics

![Analytics](/screenshots/analytics.png)

Visão cross-tenant em formato de tendências, agrupada por tempo (Window padrão: 30 dias). Relatórios:

- **Alert Volume**
- **p95 TTV** (time-to-verdict, AI)
- **p95 TTR** (time-to-review, gate humano)
- **Escalation Rate**
- **Top worsening tenants** — ordenados pelo delta de p95 TTV em relação à janela anterior
- **Activity heatmap** — dia-da-semana × hora-do-dia, alertas (alternável para outras dimensões)

Use isto para planejamento de capacidade, avaliação de versão de modelo e revisão de SLA.

## Log de auditoria

![Log de auditoria](/screenshots/audit-log.png)

Auditoria append-only de MSSP inteiro. Filtre por Event Type (Review Requested / Review Completed / Tenant Onboarded / Decommissioned / Key Rotated / …). Colunas: Timestamp, Event Type, Investigation (link direto), Version (versão da linha por event-sourcing), Data (payload JSON expansível).

Para exports de compliance, chame a API diretamente:

```bash
curl 'https://mssp.your-mssp.example/api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

## Settings

![Settings](/screenshots/settings.png)

Página de configurações de MSSP inteiro. **Na V1 esta página mostra valores stub fixos no código** — `GET /api/settings` retorna um payload estático somente leitura que não reflete a configuração real da instalação. A página é apenas informativa; ela **não** é uma janela para as configurações ativas da instalação, e o botão **Save Changes** é um no-op. Uma superfície de configurações real, que espelhe o estado derivado de env, está no roadmap. A mutação de LLM por tenant é a única superfície de configuração que de fato funciona na V1 — veja [Página de detalhe de LLM](#llm-detail-page).

Seções:

- **LLM** — Provider (`openai-compatible | anthropic`), Fast Model, Reasoning Model, Temperature, Max Tokens, Base URL opcional + Organization. As chaves de API ficam no ambiente / Kubernetes Secrets, nunca neste formulário.
- **Wazuh SIEM** — chave de habilitação, URL, credenciais.
- **Cortex** — chave de habilitação, URL, credenciais.
- **TheHive** — chave de habilitação, URL, organização, credenciais.
- **Slack** — webhook + configuração do backend interativo.

O link **Bring your own LLM key →** leva à rotação de chave de LLM por tenant (chaves de LLM por tenant sobrepõem a chave de instalação inteira).

### Página de detalhe de LLM

![Detalhe das configurações de LLM](/screenshots/settings-llm.png)

Página independente acessível a partir de Settings → **Bring your own LLM key →**. Na V1 isto é **apenas entrada de chave BYOK por tenant** — o formulário recebe a chave de API do **tenant atualmente em escopo** e a envia via `PUT /api/tenant/llm/api-key` (o endpoint do lado do tenant; admins do MSSP também podem usar `PUT /api/mssp/tenants/{tenant_id}/llm/api-key`). Os demais campos de LLM (provider, model, temperature) exibidos na página Settings pai são valores stub; eles também não são editáveis aqui. Veja [Operações Diárias → Rotacionar chave de LLM por tenant](/pt-br/operations#rotate-per-tenant-llm-key) para o procedimento de rotação.

## Veja também

- [Operações Diárias](/pt-br/operations) — o lado de runbook destas páginas (revisão, investigações, decommission, rotação).
- [Wazuh Ingress](/pt-br/reference/wazuh-ingress) — o fluxo de onboarding de agentes a partir do detalhe do tenant.
- [Modelo de Segurança](/pt-br/reference/security-model) — o que cada papel do MSSP (`platform_admin`, `mssp_admin`, `analyst`, `customer_viewer`) tem permissão para fazer.
