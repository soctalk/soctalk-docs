# Políticas de Triagem

Um LLM fazendo a triagem de um alerta `sudo` é um analista brilhante e uma garantia fraca. Faça a mesma pergunta duas vezes e você pode obter duas respostas. Diga a ele para sempre puxar o registro de mudança antes de decidir e ele o fará, geralmente, na maioria das vezes. Mas parte da triagem não é uma questão de julgamento. Uma etapa de evidência *tem* que rodar antes que um veredito conte. Um fechamento em um ativo PCI *deve* pausar para um humano. Uma enxurrada de ruído de saúde de agente *não deveria* custar uma chamada de modelo sequer. Para esses casos, você não quer raciocínio. Você quer uma regra.

Uma **política de triagem** é essa regra, escrita como dados. Ela não substitui o agente, ela envolve alguns gates determinísticos em torno do **loop agêntico** (o ciclo de supervisor-e-ferramentas que enriquece, investiga e raciocina até chegar a um veredito). Cada um deles obedece à mesma lei:

> **O LLM propõe. Um gate determinístico dispõe.**

O modelo permanece livre para raciocinar. Uma função pura decide se sua saída entra em vigor, e ela só intervém em casos extremos que você pode *provar*: um registro de autorização que contradiz a atividade, um IOC no alerta, um incidente ativo que compartilha uma entidade com este. O meio ambíguo passa direto para o modelo, onde é seu lugar.

![Como uma política de triagem é avaliada dentro do loop agêntico](/diagrams/triage-policy-loop.svg)

Leia de cima para baixo: um alerta é resolvido contra o registro, roda o loop agêntico sob os gates da política, e chega a uma **disposição**: a decisão final sobre o caso (fechamento automático, escalar para um humano, ou pedir mais evidências). Sob cada fechamento automático existe um **piso de segurança**: um conjunto de vetos não sobrescrevíveis, em nível de código, que nenhuma política pode enfraquecer, definido por completo [abaixo](#the-safety-floor). Os gates numerados são toda a superfície, e a próxima seção percorre cada um deles.

A única propriedade que torna tudo isso seguro: uma política de triagem **de autoria do tenant** pode tornar a triagem **mais rigorosa**, nunca mais frouxa, seus guardrails só elevam, e o piso rígido sob cada fechamento não pode ser enfraquecido. (Políticas *de arquivo* embutidas e vetadas e gerenciadas por operadores são código confiável e não estão sujeitas a essa restrição.) O código fica em [`src/soctalk/triage_policy/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/triage_policy).


## Onde uma política de triagem atua

Uma política de triagem governa uma execução em quatro pontos, os gates numerados no diagrama acima.

1. **Resolver.** Um nó de entrada compara o alerta contra o registro e escreve a política de triagem ativa no estado da execução. Se o alerta pertence a uma classe operacional conhecida sem indicadores de segurança, a execução pode fechar deterministicamente aqui sem nunca chamar o modelo.
2. **Gate de pré-decisão.** Uma política pode exigir etapas determinísticas (por exemplo, reunir contexto de autorização) antes que um veredito seja legal. Se o supervisor propõe um veredito cedo demais, o gate o redireciona primeiro para a etapa exigida. Uma política também pode restringir quais ações do supervisor são legais em cada fase, e essa restrição é aplicada à saída estruturada do modelo antes da chamada, de modo que uma ação ilegal não pode sequer ser amostrada.
3. **Guard de pós-veredito.** Depois que o modelo rascunha um veredito, uma função pura decide se ele é efetivado. Ela pode sobrescrever o rascunho (elevar um fechamento a um escalonamento), interrompê-lo (manter o rascunho mas roteá-lo para aprovação humana), ou deixá-lo prevalecer. Toda sobrescrita é registrada.
4. **Piso de segurança.** Um conjunto não sobrescrevível de verificações protege todo caminho de fechamento automático. Ele *não* é uma única etapa, os vetos de IOC/autorização rodam dentro do guard de pós-veredito, e os vetos de kill switch, teto de volume e incidente ativo rodam novamente quando um fechamento é efetivado nos planos de worker, servidor e ingestão. O diagrama o desenha como um único nó por clareza; nada em uma política de triagem pode enfraquecê-lo onde quer que ele rode.

## O piso de segurança

O piso é imposto em código, não em dados de política, e se aplica em todo plano onde um caso pode fechar automaticamente: a disposição do worker, o servidor que a efetiva, e os caminhos rápidos de ingestão (fechamento memoizado e fechamento automático baseado em regras). Um fechamento é vetado e o caso é promovido ou escalado em vez disso quando qualquer uma destas condições se sustenta:

| Veto | Quando dispara |
|---|---|
| IOC presente | No caminho de veredito, um veredito de enriquecimento malicioso ou uma correspondência MISP; nos caminhos rápidos de ingestão, qualquer IOC bruto no alerta. |
| Autorização contraditada | Registros existem mas não cobrem a atividade (expirados, fora da janela, escopo errado, proibidos por política). |
| IOC não verificado | Um fechamento de camada de roteador com observáveis que nenhum enriquecimento jamais verificou. |
| Incidente ativo | Outra investigação ativa compartilha uma entidade elegível para anexação com esta. |
| Kill switch | O fechamento automático está desligado, por tenant ou para toda a instalação. |
| Teto de volume | A contagem contínua de fechamentos automáticos do tenant está esgotada. |

O conjunto efetivo de gates em qualquer execução é o piso mais o que quer que a política ativa adicione. Uma política de triagem só pode tornar as coisas mais rigorosas. É isso que torna seguro permitir políticas de autoria do tenant: uma política mal configurada ou hostil não pode se tornar um canal para suprimir detecções.

O kill switch e o teto de volume valem a pena conhecer pelo nome. `SOCTALK_AUTO_CLOSE_KILL` no processo da API, ou a flag de política `auto_close_kill` em um tenant, converte todo fechamento automático em uma promoção sem necessidade de rollout, o que é o controle ao qual você recorre no meio de um incidente. `auto_close_volume_cap` (padrão 500 por 24 horas) significa que um loop de fechamento descontrolado degrada para "humanos olham para estes" em vez de supressão em massa.

## Políticas de triagem embutidas

Duas vêm com o produto. Ambas são código vetado e somente leitura.

**`dual-use-privileged-exec`** trata de atividade de autenticação em host como `sudo` e `su`, onde o mesmo evento é administração rotineira sob um registro de mudança cobrindo-a e um incidente sem tal registro. Ela exige a etapa `gather_authorization_context` antes de qualquer veredito, remove `CLOSE` das ações legais do supervisor (para que a camada barata do roteador não possa dar curto-circuito em um caso cujo ponto principal é que benigno e hostil parecem idênticos), e exige aprovação humana em qualquer fechamento que toque um ativo classificado como PCI.

**`agent-health-operational`** trata do ruído de automonitoramento de agentes Wazuh, como a regra 202 "Agent event queue is flooded." Isso é uma condição de infraestrutura, não um evento de segurança, então a política a fecha deterministicamente sem nenhuma chamada de modelo, o que também torna o resultado consistente em vez de variar de execução para execução. Qualquer indicador de segurança no alerta (uma técnica MITRE, um IOC, um sinal malicioso, uma classe não atestada, ou um nível crítico do Wazuh, 12+) veta o fechamento determinístico e envia o alerta para triagem completa.

Você pode ver ambas, com cada gate e guardrail expandido, na página **Triage Policies** no dashboard MSSP.

## O schema

Uma política de triagem é dados. Um interpretador genérico roda qualquer número delas.

```yaml
id: regulated-privileged-exec
version: 2
tenant: acme                       # a tenant slug or id; authored policies are always scoped
status: shadow                     # active | shadow
priority: 70                       # lower wins on a multi-match; authored/file >= 60
applies_to:
  rule_groups: [sudo]
  rule_ids: []
  authorization_tracks: [account]
required_steps: [gather_authorization_context]
decision_modules: [authorization_engine]
legal_actions:
  decide:  [VERDICT]               # an unlisted phase is unconstrained
close_signoff_data_classes: [pci]
guardrails:
  - when:
      "and":
        - "==": [{ "var": "authz.class" }, "contradicted"]
        - "==": [{ "var": "verdict" }, "close"]
    effect: override
    to: escalate
    reason: acted outside the terms of an authorization
```

Leia essa condição como: se a classe de autorização resultou em `contradicted` e o modelo rascunhou um `close`, eleve-o para `escalate`. Cada nó é um único operador sobre seus argumentos, e `var` lê um campo do contrato de estado.

| Campo | Significado |
|---|---|
| `applies_to` | Quais alertas a política governa. Correspondido por grupos de regras, ids de regras, ou o track de autorização da atividade do alerta, os três são combinados por OR. |
| `required_steps` | Nós determinísticos que devem rodar antes que um veredito seja legal. |
| `decision_modules` | Declara os engines vetados dos quais a política depende (hoje: `authorization_engine`), validados contra módulos conhecidos. A consulta em runtime é atualmente conduzida por `required_steps` (por exemplo, `gather_authorization_context`), não por este campo. |
| `legal_actions` | As ações do supervisor permitidas por fase (`triage` até que as etapas exigidas tenham rodado, depois `decide`). Uma fase não listada é irrestrita. |
| `close_signoff_data_classes` | Um fechamento efetivado em um ativo em uma dessas classes é interrompido para aprovação humana. |
| `guardrails` | Regras declarativas de sobrescrita ou interrupção. Veja abaixo. |
| `priority` | Ordem no registro. Embutidas ocupam 10 e 50; qualquer coisa de autoria ou carregada de arquivo deve ser 60 ou superior, de modo que nunca possa superar as proteções de uma embutida. |

Algumas capacidades são restringidas por onde uma política se origina:

- **Disposições determinísticas** (aquilo que `agent-health-operational` usa para fechar sem um modelo) são **exclusivas de embutidas**: cunhar uma nova classe de fechamento automático é uma decisão de revisão de código, não de configuração.
- **Políticas de autoria não podem conceder `CLOSE`** em `legal_actions`. Concedê-lo não adiciona nada além de uma fase irrestrita (a linha de base já permite o fechamento do roteador), mas permitiria que o remapeamento de ação ilegal forçasse toda proposta a um fechamento automático sem veredito, sustentado apenas pelo piso grosseiro. Decisões terminais são roteadas através de `VERDICT` em vez disso; a validação rejeita `CLOSE` em qualquer fase. Políticas embutidas e de arquivo ainda podem listar o conjunto completo de ações.

## Condições de guardrail

Condições são a única lógica que um autor escreve, e rodam em uma pequena linguagem em sandbox sobre um contrato de estado documentado. Não há acesso a atributos, nem chamadas de função, nem forma de nomear qualquer coisa fora do contrato. Uma condição é uma árvore de nós de operador único.

Operadores: `var`, as comparações (`==`, `!=`, `<`, `<=`, `>`, `>=`), os lógicos `and` / `or` / `!` / `!!`, e `in`.

Os campos que uma condição pode ler:

| Campo | O que é |
|---|---|
| `authz.class` | `covered`, `contradicted`, ou `absent`, derivado do engine. |
| `authz.in_scope`, `authz.sanctioned_or_routine`, `authz.actor_genuine`, `authz.policy_allowed` | Os quatro *componentes de expectabilidade*: os booleanos do engine de autorização para se a atividade caiu em um escopo aprovado, foi sancionada ou rotineira, foi realizada por um ator genuíno, e foi permitida por política. |
| `verdict` | A decisão rascunho do modelo. |
| `verdict_confidence` | Sua confiança, `0.0` a `1.0`. |
| `asset.data_classification`, `asset.environment`, `asset.criticality` | Atributos com confiança resolvida do ativo da atividade. |
| `enrichment.ioc` | Se um sinal malicioso está presente. |
| `correlation.active_incident` | Se um incidente ativo se sobrepõe. |

Um `effect` é ou `override` ou `interrupt`. Supressão não é expressável: `close` não é um alvo válido, e uma sobrescrita só pode elevar uma decisão pela escada `close < needs_more_info < escalate`, nunca descê-la. Uma condição que referencia um campo não declarado ou um operador desconhecido é rejeitada quando a política é validada, antes que possa sequer rodar. Note que `enrichment.ioc` e `correlation.active_incident` também são impostos pelo piso rígido independentemente de qualquer guardrail, em uma execução de worker em produção `correlation.active_incident` geralmente só é populado no piso em tempo de efetivação, então apoie-se no piso para esses em vez de re-derivá-los em um guardrail.

## Crie uma no editor no-code

Administradores criam políticas de triagem a partir da página **Triage Policies** enquanto um tenant está fixado, nenhum YAML necessário. Isto percorre a construção de uma política real, não trivial, de ponta a ponta. O exemplo, `prod-privileged-exec-strict`, governa alertas de execução privilegiada em um track de autorização de conta: ele demanda evidência de autorização, restringe o que o agente pode fazer, e adiciona guardrails que só elevam além de um gate de fechamento PCI.

Abra **“+ New triage policy”** (ou `/triage-policies/editor`). O editor tem duas colunas, o **formulário** do documento à esquerda, e uma **projeção de fluxo de decisão** ao vivo mais um **simulador “Try it”** à direita, que são re-renderizados a cada edição.

![O editor no-code em branco](/screenshots/triage-policy-editor-01-blank.png)

**1. Identidade.** Dê à política um id de slug e uma **prioridade**: um inteiro limitado pelo piso (`≥ 60`) onde o menor vence em uma dupla correspondência, de modo que uma política de autoria nunca possa superar as proteções embutidas.

![Identidade: slug e prioridade](/screenshots/triage-policy-editor-02-identity.png)

**2. Quais alertas ela detém?** Os três matchers são combinados por OR. Aqui a política detém os grupos de regras `sudo, su, sudoers`, os ids de regras `5402, 5501`, no track `account`.

![Matchers](/screenshots/triage-policy-editor-03-matchers.png)

**3. Requisitos de investigação.** Exija a etapa `gather_authorization_context`, declare dependência do módulo `authorization_engine`, e restrinja a fase `decide` a somente `VERDICT`. Note que `CLOSE` não é oferecido, políticas de autoria não podem concedê-lo.

![Requisitos de investigação](/screenshots/triage-policy-editor-04-requirements.png)

**4. Aprovação de fechamento.** Um fechamento efetivado em um ativo classificado como `pci` ou `phi` é retido para um humano.

![Aprovação de fechamento](/screenshots/triage-policy-editor-05-signoff.png)

**5. Guardrails.** Guardrails rodam após o piso de segurança, em ordem, a primeira correspondência vence. Cada condição pode ser escrita como JSON, o dialeto em sandbox `{"op": [{"var": "field"}, value]}` com grupos `and`/`or`…

![Escrevendo uma condição como JSON](/screenshots/triage-policy-editor-06-guardrail-json.png)

…ou no construtor visual, que faz ida e volta com o JSON. Este guardrail dispara quando a autorização é **contraditada** *e* o ativo é **crítico**, e eleva a decisão para `escalate`.

![A mesma condição no construtor visual](/screenshots/triage-policy-editor-07-guardrail-visual.png)

Mais dois completam a política: uma sobrescrita de baixa confiança para `needs_more_info`, e um `interrupt` que retém um fechamento PCI para revisão humana. A ordem importa, o primeiro guardrail correspondente dispõe.

![Todos os três guardrails](/screenshots/triage-policy-editor-08-guardrails-all.png)

**6. Leia o fluxo, depois simule.** A coluna direita projeta o documento inteiro no pipeline: matchers → fases → rascunho do LLM → **piso de segurança (sempre ativo)** → guardrails → aprovação → efetivação.

![Projeção de fluxo de decisão](/screenshots/triage-policy-editor-09-decision-flow.png)

O painel **“Try it”** pré-visualiza a lógica de guardrail + piso que o editor pode modelar, um subconjunto do caminho completo de imposição de worker/servidor/ingestão, para feedback de autoria. Alimente-o com um caso de autorização contraditada e ativo crítico e o resultado é `escalate`: mas ele vem do **piso de segurança**, não desta política. Essa é a invariante central tornada visível: autorização contraditada é um veto de piso não sobrescrevível, e os guardrails da política só *elevam* por cima dele.

![O simulador Try-it mostrando o escalonamento do piso](/screenshots/triage-policy-editor-10-try-it.png)

`Create (shadow)` a salva. O formulário e o documento armazenado são o mesmo artefato, “View as JSON” mostra exatamente o que é persistido.

![A política concluída](/screenshots/triage-policy-editor-11-complete.png)

A validação ao salvar é fail-closed e aplica as mesmas regras que as políticas de arquivo mais algumas mais rigorosas: o id deve ser um slug, as etapas referenciadas e os módulos de decisão e as fases de ação legal devem ser aqueles que o runtime realmente conhece, `CLOSE` não pode ser concedido, e a definição tem tamanho limitado. Uma referência desconhecida é rejeitada no momento da autoria em vez de silenciosamente ignorada em runtime. Cada revisão salva é mantida como histórico somente-adição.

## Shadow, depois ative

Uma política de autoria tem quatro status, **draft**, **shadow**, **active**, **retired**. A avaliação em shadow é fortemente recomendada mas não obrigatória: uma política pode ser ativada diretamente a partir de draft.

Em **shadow**, a política é correspondida e seus guardrails avaliados exatamente como uma ativa seria, e suas decisões que teriam disparado são escritas na trilha de auditoria, mas ela não muda nenhuma disposição. Isso lhe dá evidência real do que ela faria contra o tráfego ao vivo antes que decida qualquer coisa.

**Ativá-la** (a ação **Activate** na página Triage Policies) a faz governar. Como o worker é um processo separado cujo registro carrega uma vez na inicialização, a ativação não pode simplesmente virar uma flag no banco de dados, ela materializa a definição no ConfigMap do worker do tenant no próximo `tenant.reconcile`, e o **rollout do worker é o gate de ativação**: a política começa a governar somente quando um worker novo a lê. Editar uma política ativa a mantém ativa e re-executa o rollout com a nova definição; desativá-la a retorna para shadow.

![O ciclo de vida da política de autoria: shadow, depois ative para governar](/diagrams/triage-policy-lifecycle.svg)

Operadores que preferem gerenciar políticas como código ainda podem seguir o caminho do git: escreva um arquivo YAML no diretório montado e execute o rollout dos workers. O mesmo registro carrega tanto políticas de autoria e ativadas quanto políticas de arquivo escritas à mão.

## A conexão

Duas variáveis de ambiente a carregam:

- `SOCTALK_TRIAGE_POLICY_DIR` no runs-worker é o diretório do qual o registro carrega na inicialização.
- `SOCTALK_TENANT_TRIAGE_POLICIES_DIR` no controller é o diretório montado pelo operador que o caminho de provisionamento lê, valida e renderiza nos valores de chart de cada tenant como um ConfigMap montado.

No caminho provisionado por chart, as políticas são valores de chart do tenant (`runsWorker.triagePolicies`, renderizado como o ConfigMap `soctalk-triage-policies`), e uma mudança de conteúdo carimba um checksum no template do pod para que uma edição execute o rollout do worker automaticamente. O rollout é o gate de ativação: como o registro carrega uma vez por processo, uma política só começa a governar quando um worker novo a lê.

Cada carregamento, pulo e rejeição é registrado. Um arquivo que falha na validação por qualquer motivo (schema ruim, um campo desconhecido, uma condição malformada, uma prioridade que superaria uma embutida) é rejeitado por completo e nunca governa nada, de modo que um rollout ruim degrada para "aquela política não está ativa", nunca para imposição errada.
