# Playbooks de Resposta

## De um verdict a uma ação

O [pipeline de triagem por AI](/pt-br/ai-pipeline) do SocTalk existe para responder a uma pergunta sobre um alerta: isto é real, e o que deve acontecer com o caso. O loop agêntico enriquece o alerta, reúne contexto, investiga e raciocina até chegar a um verdict, e a execução termina em uma disposição. A disposição é a decisão final, uma entre escalar para um humano, fechar automaticamente como falso positivo ou pedir mais evidências. Essa decisão é o produto de todo o pipeline a montante, e é onde as [políticas de triagem](/pt-br/triage-policies) fazem seu trabalho, mantendo determinísticas as partes da triagem que precisam ser garantidas e deixando o modelo raciocinar sobre o restante ambíguo.

Uma disposição por si só não muda nada no mundo externo. Ela não abre um chamado, não aciona o plantão, não entrega o caso a um SOAR, nem tira um laptop comprometido da rede. Um playbook de resposta é a camada que age sobre a disposição. Ele executa estritamente depois que a triagem é confirmada, lê o que a triagem produziu e transforma isso em passos concretos.

O que ele lê é um único objeto tipado chamado envelope de disposição. O SocTalk monta o envelope no momento em que a disposição se torna final, dentro da mesma transação de banco de dados, e ele carrega tudo em que uma resposta poderia se basear. Isso inclui a disposição efetiva, ou seja, a decisão final depois que o piso de segurança teve sua palavra; o verdict do modelo e sua confiança; a severidade do alerta; seus grupos de regras e ids de regras; as técnicas e táticas ATT&CK às quais ele foi mapeado; as entidades e IOCs envolvidos; e quais vetos do piso de segurança foram disparados ao longo do caminho. O envelope é o contrato entre triagem e resposta, e é também o payload exato que um playbook entrega a qualquer sistema a jusante dele.

![Como um playbook de resposta consome a disposição da triagem e age sobre ela](/diagrams/response-playbook-loop.svg)

Tudo abaixo é o lado direito daquela imagem: como um playbook faz a correspondência com o envelope, quais ações ele pode tomar e como as perigosas permanecem atrás de um humano. O código fica em [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response).

## O que executa por conta própria, e o que precisa de aprovação

As ações se dividem em dois grupos conforme o quanto podem afetar seu ambiente. Escrever uma nota no caso ou enviar uma notificação para um webhook é seguro fazer por conta própria, porque o pior que pode acontecer é adicionar ruído, então essas executam imediatamente sem que ninguém as aprove. Isolar um endpoint ou desabilitar uma conta é outra questão, então essas nunca disparam por conta própria. Quando um playbook exige uma delas, ele não a executa. Ele levanta uma proposta no caso, e um analista a revisa e aprova antes que algo aconteça. O modelo nunca toma uma ação de contenção por conta própria durante a triagem, e um playbook não pode tomar uma por conta própria durante a resposta. Em ambos os casos uma pessoa autoriza qualquer coisa que alcance um sistema em produção.

Três regras vivem no código, e não nos dados do playbook, e nenhum playbook pode enfraquecê-las. Um fechamento é a direção que um atacante mais gostaria de acionar, então no caminho de fechamento um playbook só pode anotar ou auditar, nunca tomar uma ação externa. O interruptor de emergência de dispatch, definido com `SOCTALK_RESPONSE_DISPATCH_KILL` no processo da API ou com a flag `response_dispatch_kill` em um tenant, interrompe toda resposta sem rollout, que é o controle a acionar quando um conector começa a se comportar mal no meio de um incidente. E uma resposta só dispara se a disposição de fato teve efeito no caso. Se um analista fechou ou mesclou a investigação enquanto a execução ainda estava em andamento, nada é despachado contra um estado que nunca aconteceu.

## As três capacidades

Um playbook se refere a uma capacidade pelo nome e não pode nomear nada além disso. Um nome desconhecido é rejeitado quando o playbook é validado. Três capacidades estão disponíveis hoje.

`annotate_investigation` escreve uma nota de sistema no caso. Ela só toca no SocTalk, executa por conta própria e é a única ação permitida em um fechamento.

`notify_webhook` posta o envelope assinado no webhook configurado do tenant. Este é o repasse para um SOAR externo. O SocTalk assina o envelope e o envia, e o receptor é dono de tudo o que acontece depois. Ela também executa por conta própria.

`external_action` é a que precisa de aprovação. Ela envia uma ação nomeada junto com o envelope assinado para um endpoint que o operador configurou, e é aqui que o trabalho real, isolar um endpoint ou desabilitar uma conta, vive fora do SocTalk atrás de um contrato estável. Ela nunca executa sem que um analista a aprove antes.

Um detalhe mantém `external_action` seguro. Um autor de playbook nomeia um endpoint e uma ação, nunca uma URL. O operador mapeia esse nome de endpoint para uma URL real e um segredo de assinatura na política de tenant `response_action_endpoints`, de modo que um autor pode pedir para isolar no endpoint `edr`, mas não pode escolher para onde a requisição de fato vai. Toda requisição é assinada com HMAC, e ela se recusa a alcançar um endereço privado ou link-local.

## O schema

Um playbook de resposta é dado, e um único interpretador executa qualquer número deles. O playbook que o tutorial abaixo constrói se parece com isto:

```yaml
id: isolate-lateral-movement-endpoint
version: 1
tenant: acme                       # a tenant slug or id; authored playbooks are always scoped
status: shadow                     # active or shadow
priority: 100                      # lower wins on a multi-match
applies_to:
  rule_groups: [sudo, su]
  mitre_techniques: [T1021]        # ATT&CK technique ids (Txxxx), not names
  mitre_tactics: ["Lateral Movement"]   # tactic strings as your source emits them
response:
  on_escalate:
    - capability: external_action
      when: { ">=": [{ "var": "severity" }, 10] }
      params: { endpoint: edr, action: isolate_endpoint }
    - capability: notify_webhook
    - capability: annotate_investigation
      params: { body: "endpoint isolation proposed for lateral-movement alert" }
  on_close:
    - capability: annotate_investigation
      params: { body: "auto-closed as false positive" }
```

O bloco `applies_to` decide quais alertas o playbook detém. Ele faz a correspondência por grupos de regras, ids de regras, ids de técnicas ATT&CK ou táticas ATT&CK, e os quatro são combinados por OR, de modo que qualquer um deles acertando já é uma correspondência. Um `applies_to` vazio corresponde a todo alerta, o que é aceitável, porque as listas de disposição já decidem quando um playbook de fato dispara. A correspondência ATT&CK segue uma regra. As técnicas são correspondidas por seu id canônico, como `T1021`, nunca pelo nome, porque os nomes legíveis por humanos são instáveis. As táticas são correspondidas por qualquer string que a fonte do alerta emitir, e o Wazuh envia nomes como `Lateral Movement` em vez de referências `TA`.

Sob `response`, `on_escalate` contém até oito ações a serem tomadas quando o caso escala, e `on_close` contém até quatro ações de nível de anotação para um fechamento automático. Cada ação é um nome de capacidade, uma condição `when` opcional e um conjunto de `params` que a capacidade lê. Os params são de passagem. `external_action` extrai deles `endpoint` e `action` e encaminha o restante, e não precisa do host de destino nomeado nos params, porque o envelope assinado completo viaja com cada requisição e as entidades vão dentro dele.

## Condições

Uma condição `when` é a única lógica que um autor escreve, e ela roda na mesma pequena linguagem em sandbox que os guardrails de triagem. É uma árvore de nós de operador único sobre um conjunto fixo de campos, sem acesso a atributos, sem chamadas de função e sem forma de nomear qualquer coisa fora do contrato. Os operadores são `var`, as comparações `==`, `!=`, `<`, `<=`, `>` e `>=`, os lógicos `and`, `or`, `!` e `!!`, e `in`. Uma ação só dispara quando sua condição se verifica, e uma condição sobre dados ausentes é simplesmente falsa em vez de um erro.

Os campos que uma condição pode ler vêm todos do envelope. Há a `disposition` efetiva e a `worker_disposition` que o modelo propôs antes de o piso alterá-la; `floor_vetoed`, que indica se um veto do piso alterou o resultado; `verdict_confidence` e `severity`; os `rule.groups` e `rule.ids` do alerta; e os campos ATT&CK, `mitre.techniques` contendo os ids canônicos `Txxxx` e `mitre.tactics` contendo as strings de tática da fonte. Os últimos quatro são listas, então você os testa com `in`. Escrever `{"in": ["T1021", {"var": "mitre.techniques"}]}` dispara a ação quando o alerta carrega a técnica T1021. Referenciar um campo ou operador que o contrato não declara rejeita o playbook quando ele é salvo, bem antes de ele poder ser executado.

## Construa um no editor no-code

Administradores criam playbooks de resposta na página **Response Playbooks** enquanto um tenant está fixado, sem exigir YAML. Este guia percorre a construção do playbook `isolate-lateral-movement-endpoint` a partir do schema acima, de ponta a ponta. Ele propõe isolar um endpoint em uma escalada de movimento lateral de alta severidade, notifica o SOC e anota o caso.

Abra **"+ New response playbook"** (ou navegue até `/response-playbooks/editor`). O editor tem duas colunas. O formulário do documento fica à esquerda, e um diagrama de fluxo ao vivo fica à direita, que se renderiza novamente a cada edição, mostrando a disposição se ramificando para as ações, com as que precisam de aprovação sendo roteadas primeiro por um passo de aprovação.

![O editor no-code em branco](/screenshots/response-playbook-editor-01-blank.png)

Comece pela identidade. Dê ao playbook um id em formato de slug e uma prioridade, onde um número menor vence em uma correspondência múltipla.

![Identidade](/screenshots/response-playbook-editor-02-identity.png)

Em seguida, decida quais alertas ele detém. Os quatro matchers são combinados por OR. Este playbook detém os grupos de regras `sudo` e `su` e, mais utilmente, a técnica ATT&CK `T1021` (Remote Services) e a tática `Lateral Movement`, de modo que ele dispara em qualquer alerta mapeado para movimento lateral, qualquer que seja a regra que o levantou. O campo de técnica aceita ids, não nomes, e o campo de tática aceita a string que sua fonte emite.

![Matchers, incluindo ATT&CK](/screenshots/response-playbook-editor-03-matchers.png)

Agora a ação de isolamento. Em on escalate, adicione `external_action`, a marcada como "needs approval." Nomeie o endpoint que o operador configurou e a ação, que é `isolate_endpoint`, em seus params, e você nunca insere uma URL. Adicione uma condição para que ela só dispare em uma escalada de alta severidade.

![A ação de isolamento com uma condição](/screenshots/response-playbook-editor-04-isolate.png)

Adicione as duas ações que completam a resposta e executam por conta própria. Um `notify_webhook` entrega o caso ao SOAR do SOC, e um `annotate_investigation` deixa uma trilha de auditoria.

![As ações de notificação e anotação, que executam por conta própria](/screenshots/response-playbook-editor-05-tier0.png)

Leia o fluxo enquanto constrói. A coluna da direita projeta o documento inteiro. O envelope de disposição se ramifica para cada ação, a ação de isolamento é roteada por um passo de aprovação antes de poder executar, e as outras duas são mostradas executando por conta própria.

![O diagrama de fluxo, com a ação de isolamento roteada por aprovação](/screenshots/response-playbook-editor-06-flow.png)

Salvar com **Create (shadow)** o persiste. O formulário e o documento armazenado são o mesmo artefato, e "Preview JSON" mostra exatamente o que é salvo. A validação no salvamento é fail-closed. O id deve ser um slug, cada capacidade deve ser um dos nomes homologados, `on_close` só pode anotar, e as condições devem referenciar o contrato declarado. Uma referência desconhecida é rejeitada enquanto você está criando, nunca descartada silenciosamente em tempo de execução.

![O playbook concluído na lista, pronto para ativar](/screenshots/response-playbook-editor-07-list.png)

## Shadow, depois ative

Um playbook criado passa por quatro status: draft, shadow, active e retired.

Em shadow, o playbook é correspondido e suas ações são selecionadas exatamente como um ativo seria, e suas ações que disparariam são escritas na trilha de auditoria, mas nada é enfileirado. Isso lhe dá evidência real do que ele faria contra tráfego real antes de fazer qualquer coisa.

Ativá-lo, com a ação **Activate** na página Response Playbooks, o liga, e, diferentemente de uma política de triagem, ele tem efeito ao vivo. O SocTalk avalia playbooks de resposta à medida que cada caso é decidido, então um playbook ativo se aplica à próxima disposição sem rollout a esperar. Desativá-lo o retorna a shadow imediatamente.

Quando uma ação que precisa de aprovação surge em uma escalada real, ela chega como uma proposta no caso. O analista vê exatamente o que executaria e contra qual host, e aprová-la é o que dispara o isolamento. A ação executa uma vez, a resposta que ela obteve de volta é registrada, e uma entrega repetida nunca a executa duas vezes.

## A fiação

Algumas peças sustentam tudo isso. `SOCTALK_RESPONSE_PLAYBOOK_DIR` no processo da API é um diretório de playbooks YAML carregados na inicialização, que é o caminho gerenciado por git para operadores que preferem playbooks como código. Playbooks criados na UI vivem no banco de dados, mantidos como um histórico append-only e escopados de modo que um tenant só veja os seus próprios, e o SocTalk os mescla com os playbooks de arquivo de forma que o próprio playbook de um tenant sobrepõe um de arquivo com o mesmo id. `response_webhook_url`, com um `response_webhook_secret` opcional, define o destino de `notify_webhook` em um tenant. E `response_action_endpoints` em um tenant mapeia nomes de endpoint para sua url e segredo para `external_action`, que é como o operador mantém o controle dos destinos enquanto um playbook só nomeia um.

Toda correspondência, aprovação, ação e rejeição é registrada, e toda ação que executa registra o id e a versão do playbook junto com a resposta que obteve de volta. Um playbook que falha na validação é rejeitado por inteiro e nunca tem efeito, de modo que uma edição ruim acaba como "aquele playbook não está ativo" em vez de uma ação errada.
