# Arquitetura

> **Nota sobre a implantação V1.** A nomenclatura da lista de entidades abaixo usa prefixos legados "case_*" para várias tabelas; os nomes reais do schema da V1 são: `cases`, `investigation_runs`, `investigation_events`, `investigation_iocs`, `investigation_assets`, `investigation_links`, `investigation_outbox`, `proposals`. O nome da tabela `cases` permanece inalterado por compatibilidade retroativa, mas todas as tabelas-filhas por investigação usam o prefixo `investigation_*`. Dentre elas, as tabelas cases / investigation_runs / investigation_events são exercitadas pelo orquestrador atual; `proposals` e `investigation_outbox` estão presentes no schema, mas o lado do executor que as consome está no roadmap. Leia esta página como a intenção arquitetural; consulte [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) para o schema exato.

## 1. Entidades centrais

Forma mínima. As listas completas de colunas ficam na migration; apenas os
campos estruturantes são nomeados aqui.

```
alerts               raw ingest from adapter; AI-triaged
cases                investigation unit; one run at a time
case_runs            a single AI execution span against a case
case_events          ordered event inbox per case (immutable)
proposals            AI-proposed actions awaiting human gate
execution_log        append-only audit of all meaningful actions
notes                markdown / evidence blocks
iocs                 typed artifacts; carry external_context
case_iocs, case_assets   bridge tables
case_links           related-case edges (shared IOC / asset / rule)
case_outbox          outbound work for executors and exports
```

Toda linha portadora de conteúdo carrega `tenant_id`, `visibility` e
`created_at`. O RLS se aplica por tenancy.

## 2. Modelo de visibilidade

Classes (enum):

```
mssp_only         default; internal reasoning, raw tool output, hypotheses
customer_safe     approved for customer view
system            lifecycle and state-change events, always visible
tool_output       classified per-tool at registration time
```

Regras:

1. `visibility` é uma coluna em toda linha visível ao usuário (mensagens, notas,
   proposals, registros tool_output, entradas de timeline, campos do painel de fatos).
2. O padrão na inserção é `mssp_only`. A promoção para `customer_safe` é uma
   operação explícita.
3. As consultas do portal do cliente filtram na camada de política RLS, não na
   renderização. Uma sessão de visualizador-cliente não consegue ler linhas `mssp_only`, nem mesmo
   via SQL bruto.
4. As proposals têm visibilidade em nível de campo: `{action, outcome}` pode ser
   `customer_safe` enquanto `{rationale, blast_radius}` permanece `mssp_only`.
   Renderizadas como duas projeções.
5. Toda promoção de visibilidade emite uma entrada em `execution_log` com o
   ator e a justificativa.

Negação-por-padrão da promoção: as políticas podem rebaixar a visibilidade, mas não podem
elevá-la sem uma ação explícita de um principal autorizado.

## 3. Ciclo de vida da execução (run)

Estados:

```
active           run consuming events and taking steps
waiting_on_gate  a proposal is pending; run does not mutate state
halted_budget    budget exceeded; requires analyst resume
paused           analyst-paused
completed        case closed
failed           unrecoverable error; requires analyst resume or restart
```

Transições:

```
active → waiting_on_gate     on proposal created (status = proposed)
waiting_on_gate → active     on proposal approved/rejected (new event)
active → halted_budget       on budget exceeded
halted_budget → active       on analyst resume (grants new budget)
active → paused              on analyst pause
paused → active              on analyst resume
active → completed           on case close
* → failed                   on uncaught error, preserved for diagnosis
```

Invariantes:

- No máximo uma run por case nos estados `active | waiting_on_gate |
  halted_budget | paused`. Imposto via um índice único parcial em
  `case_runs(case_id) WHERE status IN (...)`.
- Contadores de orçamento na run: `tokens_used`, `dollars_used`,
  `tool_calls_used`, `wall_clock_ms`. Impostos no lado do servidor; aviso leve
  em 75%, parada rígida em 100%.
- Uma run em `waiting_on_gate` não processa eventos do inbox exceto
  eventos de resolução de gate (proposal.approved / .rejected).

## 4. Inbox de eventos, ordenação, coalescência, idempotência

Todo o trabalho de entrada para um case chega em `case_events`:

```
event_id              uuid PK
case_id               FK
run_id                FK nullable
seq                   bigint, case-scoped monotonic (sequence)
kind                  enum (alert_ingested, tool_result,
                            proposal_approved, proposal_rejected,
                            analyst_message, analyst_correction,
                            budget_warning, external_signal, ...)
payload               jsonb
causation_event_id    uuid nullable (which event caused this one)
correlation_id        uuid (spans a causally-related fan-out)
idempotency_key       text unique per case
created_at            timestamptz
```

Regras:

1. `seq` é emitido por uma sequência com escopo de case na inserção. Os consumidores leem
   estritamente na ordem de `seq`.
2. `idempotency_key` é único por `case_id`. Inserção duplicada é
   silenciosamente descartada (retorna a linha existente).
3. Coalescência: antes da inserção, eventos que correspondem a `(case_id, kind,
   payload.signature, window)` fundem-se em uma única linha. A assinatura é
   específica por kind (alert: fingerprint de IOC + rule + asset; tool_result:
   tool_id + hash de params).
4. `causation_event_id` liga causa → efeito para replay.
   `correlation_id` agrupa eventos de um único gatilho externo ou
   ação de analista.
5. Os eventos são imutáveis. Atualizações se expressam como eventos subsequentes.

Exemplo de rajada: 100 alertas de host similares em 5 minutos coalescem em um
evento `alert_ingested` carregando uma lista `asset_ids: [...]`. A run
o processa uma única vez.

## 5. Ciclo de vida da proposal e contrato de execução

Estados:

```
draft        being composed by the AI
proposed     submitted to human gate
approved     human approved (with typed reason if required)
rejected     human rejected (reason required)
executing    outbox picked up; executor running
executed     action complete, result recorded
rolled_back  post-execution reversal (rare, analyst-initiated)
failed       executor error
```

Idempotência:

```
proposal.idempotency_key = sha256(case_id || action_type ||
                                   canonical_json(params))
```

Proposals duplicadas dentro de uma janela ativa (padrão 15 minutos) são
rejeitadas na inserção. Garante que a AI não possa disparar em duplicidade nem mesmo sob
re-execução.

Comportamento do gate:

- Em `proposed`: a run transita para `waiting_on_gate`.
- Em `approved`: insere uma linha em `case_outbox` com
  `kind = 'execute_proposal'`, `idempotency_key = proposal.idempotency_key`.
  Emite `proposal_approved` em `case_events`. A run retoma.
- Em `rejected`: emite `proposal_rejected` com a justificativa em
  `case_events`. A run retoma. Sem linha no outbox.

Execução:

- Um worker executor separado consome `case_outbox` e realiza a
  ação.
- Em caso de sucesso: registra `execute_proposal_result` em `case_events`,
  atualiza a proposal → `executed`, escreve uma entrada em `execution_log`.
- Em caso de falha: registra o erro, atualiza a proposal → `failed`, escreve uma
  entrada em `execution_log`. A run pode propor uma nova tentativa.
- Exatamente-uma-vez via `idempotency_key`: linhas do outbox com chaves duplicadas
  são rejeitadas. Os workers executores reivindicam linhas com um lease (por exemplo,
  `FOR UPDATE SKIP LOCKED`).

A run da AI não executa efeitos colaterais inline. Tudo passa
pelo outbox.

## 6. Schema e invariantes do log de execução

Somente-anexação (append-only), separado da conversa:

```
log_id              uuid PK
case_id             FK
run_id              FK nullable
actor_kind          enum (ai, human, system, executor)
actor_id            text
kind                enum (tool_call, proposal_state_change,
                          approval, override, visibility_promotion,
                          correction_applied, policy_bound,
                          export_emitted, ...)
subject_type        enum (case, proposal, ioc, asset, note, ...)
subject_id          text
before              jsonb nullable
after               jsonb nullable
versions            jsonb (model_id, prompt_version, template_version,
                           policy_version at time of action)
ts                  timestamptz default now()
```

Invariantes:

1. Nenhum UPDATE ou DELETE é permitido a partir dos papéis da aplicação. Apenas INSERT + SELECT.
   Imposto na camada de concessão de papéis (role-grant) do Postgres.
2. Toda mudança de estado de proposal, toda chamada de ferramenta, toda aprovação,
   toda substituição por analista de uma decisão da AI, toda mudança de visibilidade,
   toda correção, todo despacho para o outbox escreve uma linha.
3. `versions` captura a pilha que produziu a ação. Necessário para
   reprodutibilidade e calibração posterior (post-hoc).
4. A conversa é uma visão renderizada de um subconjunto de eventos; ela não é
   auditoria. Destruir ou compactar a conversa não destrói a auditoria.

## 7. Autoridade do painel de fatos e fluxo de correção

O estado estruturado do case (hipóteses, IOCs, assets, resumo da timeline,
confiança, diretivas ativas) é a saída de um reducer sobre `case_events`.
Nunca é mutado diretamente pela conversa.

Regras:

1. Mensagens de conversa não escrevem estado estruturado.
2. Atualizações da AI ao estado estruturado ocorrem via eventos emitidos pela AI
   (`hypothesis_updated`, `ioc_added`, `asset_linked`).
3. Edições do analista no painel de fatos emitem eventos `analyst_correction`.
   O reducer as aplica. A AI consome a correção como o próximo
   evento do inbox e raciocina novamente a partir do estado corrigido.
4. O painel de fatos é eventualmente consistente com `case_events`. Uma
   projeção materializada (tabela ou view) é mantida; as leituras podem
   atingi-la diretamente.
5. Correções diretas ao log de execução são proibidas; as correções
   se expressam como novos eventos mais um ponteiro para o que foi corrigido.

## 8. Taxonomia de capacidades de ferramentas

Toda ferramenta é registrada com uma classe de capacidade, uma política de aprovação
padrão e um modelo de custo.

Classes de capacidade:

```
read_local               inspect SocTalk state only
read_external_silent     no target footprint (feeds, cached intel, vector)
read_external_attributed trace at target (SIEM query, EDR read)
write_sandbox            footprint without target mutation (detonation)
write_external           target state change (block, isolate, notify)
```

Política de aprovação padrão por classe:

```
read_local                → autonomous
read_external_silent      → autonomous
read_external_attributed  → analyst_approve
write_sandbox             → analyst_approve
write_external            → typed_reason
```

Modelo de custo por ferramenta: `{tokens_est, dollars_est, wall_ms_est, footprint}`.
O orçamento da run rastreia a soma.

## 9. Precedência de políticas

As políticas são mescladas nesta ordem, a inferior sobrepõe a superior:

```
1. install default       (shipped in chart, read-only in v1)
2. tenant override       (MSSP sets per customer)
3. case template         (phishing, ransomware, etc.)
4. case-local override   (set for this one case by analyst)
```

Para cada chave de política (aprovação de ferramenta, auto-close, promoção de visibilidade,
templates de resposta, orçamento), o valor efetivo é o escopo mais profundo
que a define.

Invariantes:

1. A promoção de visibilidade nunca é definida como `permissive` por padrão no
   escopo de instalação. O padrão é "promoção explícita obrigatória."
2. Uma política de tenant não pode sobrepor um limite rígido em nível de instalação (por exemplo,
   `max_tokens_per_case`).
3. Substituições em nível de case (case-local) têm escopo no case e não persistem para
   cases futuros.

## 10. Semântica de auto-close / reabertura

Auto-close para FPs de alta confiança:

```
Trigger:
  AI assessment = fp, confidence ≥ policy.auto_close_threshold
  AND policy.auto_close_enabled is true for the tenant
  AND no active directive prevents auto-close

Action:
  case.status = 'auto_closed_fp'
  case.reopen_window_until = now() + policy.reopen_window
  case.reopen_signature = {
    ioc_fingerprints: [...],
    asset_ids: [...],
    time_window: {start, end}
  }
  run transitions to completed
  execution_log row written
```

Reabertura:

```
Trigger:
  new case_events row with kind ∈ {alert_ingested, external_signal}
  whose signature intersects a case's reopen_signature
  where case.status = 'auto_closed_fp'
    AND now() < case.reopen_window_until

Action:
  case.status = 'active'
  emit reopened event into case_events
  new run created
  execution_log row written
  conversation receives a system message noting the reopen
```

Kill switch:
- `IntegrationConfig.auto_close_enabled` por tenant (padrão: ligado).
- `CaseTemplate.auto_close_disabled` por tipo de case.

## 11. Contrato de exportação para o TheHive (baseado em outbox, unidirecional)

Espelha cases, IOCs e notas selecionadas para fora, em direção ao TheHive, quando o
tenant tem `thehive_export_enabled`. Nunca aceita mudanças de entrada.

Linha do outbox (em `case_outbox`):

```
id                  uuid PK
kind                'export.thehive.case' | 'export.thehive.ioc' | ...
external_system     'thehive'
external_ref        TheHive object id (filled on first successful mirror)
object_type         case | ioc | note
object_id           internal subject id
idempotency_key     sha256(object_type || object_id || state_hash)
payload             jsonb
export_status       pending | in_flight | succeeded | failed | skipped
attempts            int
last_error          text nullable
next_attempt_at     timestamptz
created_at, updated_at
```

Regras:

1. A mudança de estado em um objeto espelhado enfileira uma linha de exportação com uma
   `idempotency_key` nova (que incorpora o hash de estado).
2. O worker reivindica com `FOR UPDATE SKIP LOCKED`. Em caso de sucesso, registra
   `external_ref` (criando ou atualizando no lado do TheHive conforme necessário) e
   escreve execution_log.
3. Webhooks de entrada do TheHive são aceitos apenas para cases de dashboard
   somente-leitura (não na v1). Qualquer tentativa de aceitar estado de entrada é
   explicitamente rejeitada e registrada.
4. Sem loop de reconciliação, o TheHive é um espelho a jusante (downstream), a fonte
   da verdade é o SocTalk.
5. Exportações com falha tentam novamente com backoff exponencial até um teto; a falha
   permanente aparece no painel de saúde das integrações.

## 12. Testes e invariantes obrigatórios

A suíte de testes (unitários + integração) deve cobrir:

1. **Imutabilidade do log de execução.** UPDATE e DELETE contra
   `execution_log` a partir do papel da aplicação falham na camada do Postgres.
2. **Uma única run ativa por case.** Tentativas concorrentes de criar uma
   segunda run ativa falham com uma violação de restrição única (unique-constraint).
3. **Idempotência de proposals.** Submeter duas proposals com a mesma
   idempotency key dentro da janela: a segunda é rejeitada.
4. **Comportamento de pausa no gate.** Uma run com uma proposal `proposed` não
   consome eventos que não sejam de gate do seu inbox.
5. **Outbox exatamente-uma-vez.** Dois workers reivindicando a mesma linha do outbox
   resultam em um tendo sucesso e um não fazendo nada (no-op).
6. **Imposição de visibilidade.** Uma sessão de visualizador-cliente não consegue selecionar
   linhas `mssp_only` de nenhuma tabela, nem mesmo com SQL bruto.
7. **Promoção de visibilidade registrada.** Toda promoção de `mssp_only`
   para `customer_safe` produz uma linha em `execution_log`.
8. **Fluxo de correção.** Um evento de correção do analista produz um novo evento
   que o reducer aplica; a projeção do painel de fatos reflete a
   correção.
9. **Reabertura de auto-close.** Um evento que corresponde a uma reopen_signature dentro
   da janela reabre o case e inicia uma nova run.
10. **Idempotência da exportação para o TheHive.** Reexecutar uma exportação para um objeto
    cujo estado não mudou é um no-op (mesma idempotency_key).
11. **Política de aprovação de ferramentas.** Uma chamada de ferramenta `write_external` sem uma
    aprovação typed_reason não consegue alcançar o executor.
12. **Precedência de políticas.** A substituição case-local vence sobre a de tenant, que
    vence sobre a de instalação para a mesma chave de política.

## 13. Fora deste spec

- Modelos de componentes, comportamento visual, parsing da barra de comandos → o workstream da UI de conversa.
- Correlação de campanhas, scoring, mecânica cross-tenant → o workstream de campanhas.
- Biblioteca de prompts, conteúdo do registro de ferramentas do LLM, política de versão de modelo
  → o workstream separado do runtime de LLM (LLM runtime) quando chegarmos lá.
