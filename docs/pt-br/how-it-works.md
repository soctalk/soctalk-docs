# Como funciona

## O problema

Um SOC se afoga em alertas. Uma única varredura pode produzir milhares deles, a maior parte do que é escalado acaba se revelando benigna, e os analistas se esgotam ao limpar uma fila que é, em sua maior parte, ruído. A parte difícil não é detectar coisas. É decidir, de forma rápida e segura, quais das coisas que dispararam realmente importam.

## Três gerações de triagem de SOC

O ferramental de triagem passou por três gerações, e cada uma corrigiu o problema da anterior enquanto deixava um ponto cego próprio.

A primeira geração são as **regras**: regras de assinatura e de correlação em um SIEM, e automação determinística em um SOAR. É rápida, auditável e previsível, razão pela qual ainda roda por baixo de tudo. Também é grosseira. Uma regra dispara em qualquer coisa que a corresponda, então é barulhenta, e um humano ainda precisa ler quase tudo. É um alarme de fumaça: confiável, mas incapaz de distinguir um incêndio de verdade de uma torrada queimada.

A segunda geração acrescentou **machine learning**: classificadores supervisionados, detecção de anomalias e análise de comportamento de usuário que aprendem qual é a aparência do normal e pontuam o que foge disso. Isso organiza a fila e traz à tona os casos estranhos, mas exige dados rotulados, sofre desvio (drift) à medida que o ambiente muda, e entrega uma pontuação em vez de uma razão. É um filtro de spam: organiza a pilha, mas dá um número, não uma explicação.

A terceira geração são os **modelos de linguagem**, que conseguem raciocinar sobre um alerta em contexto e se explicar em linguagem simples. A primeira onda de ferramentas de SOC com AI os usou da maneira óbvia, apontando um modelo para cada alerta, prompt na entrada e veredito na saída. O problema é que um modelo lendo um alerta isoladamente não tem memória do que um analista já decidiu, nenhuma visão do próprio estado da organização (então não consegue distinguir uma mudança autorizada de um ataque que parece idêntico), nenhuma garantia de que não encerrará com confiança sobre um indicador real, e nenhuma noção dos outros alertas ao seu redor. Rodar um modelo de fronteira em cada alerta bruto também é caro, e o custo empurra as equipes na direção de modelos mais fracos exatamente nos casos em que o julgamento importa mais. É um analista perspicaz em seu primeiro dia: raciocina bem sobre qualquer alerta isolado, mas não se lembra de nada de ontem e não recebeu o calendário de mudanças nem a lista de ativos.

![A evolução da triagem de SOC: regras, machine learning, modelos de linguagem e a geração agêntica que a SocTalk representa](/diagrams/soc-evolution.svg)

Cada geração é genuinamente boa em algo, e nenhuma delas está errada. O problema é que a maioria dos produtos escolhe uma e se apoia nela.

## O que a SocTalk faz de diferente

A SocTalk é a geração agêntica. Onde a primeira onda apontava um modelo para um alerta, a SocTalk roda um laço agêntico em torno do modelo: o modelo dirige uma investigação determinística, raciocina sobre o caso correlacionado inteiro e retorna um veredito que impulsiona ação governada, com um humano barrando qualquer coisa perigosa. Tudo isso roda dentro de guardrails determinísticos. Ela mantém as garantias da era das regras em código, e deliberadamente pula o meio opaco. O colapso de ruído que o machine learning se propôs a fazer é feito de forma determinística, por coalescência, correlação e encerramento baseado em regras, de modo que nada no caminho da decisão é uma caixa-preta treinada. O modelo é gasto apenas nos casos ambíguos. Então duas coisas que nenhuma das gerações anteriores tinha são acrescentadas por cima: o pipeline se lembra do que os analistas decidem, e um humano barra qualquer coisa que alcance um sistema ativo.

Dito de outra forma, o modelo é um componente, não o sistema inteiro. O ruído é colapsado antes que qualquer modelo rode. O modelo recebe contexto organizacional real. As decisões críticas para a segurança ficam atrás de um **piso de segurança**, um pequeno conjunto de vetos rígidos escritos em código que nem uma regra nem o modelo podem desligar, da mesma forma que um disjuntor corta a energia não importa o que a fiação esteja pedindo. As decisões dos analistas são lembradas. E o veredito impulsiona ação governada, a camada SOAR do sistema, com um humano aprovando qualquer coisa perigosa. O resultado é que o modelo raciocina sobre o meio ambíguo, e as partes que precisam ser garantidas permanecem garantidas.

![O pipeline de triagem da SocTalk: um funil de ingestão determinístico, uma execução agêntica em que o modelo é consultado em apenas dois papéis, e ação governada](/diagrams/triage-pipeline.svg)

## Dois planos e uma janela de acomodação

O pipeline roda ao longo de dois planos, ou estágios, e saber qual é qual explica a maior parte do design.

O **plano de ingestão** é do lado do servidor e totalmente determinístico. Quando um adaptador (o coletor do lado do tenant que encaminha alertas do Wazuh e semelhantes) posta um lote de eventos, eles são deduplicados, coalescidos, correlacionados, deconflitados e, em muitos casos, resolvidos sem que um modelo jamais rode. Nenhum modelo toca este plano.

O **plano de grafo** é o laço agêntico, um por tenant, rodando como seu próprio processo. É onde o modelo raciocina, e ele consulta o modelo em apenas dois papéis: roteamento e o veredito final. Muitos casos precisam de ainda menos, encerrando com uma política determinística sem nenhuma chamada de modelo. O laço não mantém banco de dados próprio: o caso lhe é entregue quando a execução começa e seu resultado é devolvido quando a execução termina, e seu enriquecimento acontece por meio de chamadas de ferramenta para o SIEM e serviços de threat-intel.

Entre os dois fica uma **janela de acomodação** opcional. Quando um tenant configura uma, uma execução promovida é retida por um curto atraso para que uma rajada de alertas correlacionados possa se acumular primeiro, e o modelo olha o incidente inteiro de uma vez em vez de olhar cada fragmento conforme ele chega. Um alerta de alta severidade contorna a espera.

Agir sobre o veredito acontece de volta no servidor, de forma determinística, depois que a execução se completa. Isso mantém o modelo fora do laço que alcança sistemas externos.

## Na entrada: o funil determinístico

Muitos alertas são resolvidos antes que um modelo seja sequer consultado, o que ajuda a manter o pipeline acessível e rápido, e é tudo código determinístico.

**Coalescência e deduplicação colapsam a tempestade.** A deduplicação descarta um evento reprocessado que carrega um ID já visto. A coalescência então agrupa alertas repetidos da mesma regra no mesmo ativo dentro de uma janela de cinco minutos em um único caso, de modo que uma rajada da mesma detecção vira um caso em vez de milhares. O modelo, e o analista, veem um caso por incidente em vez da mangueira de incêndio bruta. ([correlação e coalescência no núcleo de IR](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/triage.py))

**A correlação mantém um incidente em um caso.** Com a correlação de entidades habilitada, um novo alerta que compartilha uma entidade forte (um identificador confiável como um host ou hash de arquivo) com uma investigação ativa se anexa a ela como evidência em vez de iniciar uma execução nova e sem contexto. Uma fonte que começa a dominar a correlação, como um IP de scanner que toca tudo, é rebaixada para que não possa puxar alertas não relacionados para um único caso. A correlação roda antes dos caminhos de encerramento, de modo que um alerta de aparência benigna que pertence a um incidente ativo não é silenciosamente suprimido.

**A deconflitação de engajamento mantém testes autorizados fora da fila.** Quando está habilitada, uma janela declarada de pentest ou red-team é correspondida por fonte, host, técnica e tempo. A atividade dentro dela é sinalizada e auditada, mas nunca encerrada automaticamente, e a atividade de testadores que sai do escopo é forçada a uma análise humana em vez de encerrada. Veja [Usuários e papéis](/pt-br/users-and-roles) sobre como os engajamentos são declarados e revisados.

**O encerramento determinístico lida com os casos óbvios.** Falsos positivos de baixa severidade e alta confiança encerram por regra, e uma forma benigna recorrente pode encerrar por referência a uma decisão anterior, ambos sem um modelo. As faixas de encerramento de falso positivo e o caminho de encerramento operacional deliberadamente excluem qualquer coisa mapeada a uma técnica ATT&CK (um ID padrão de técnica de ataque), de modo que um alerta mapeado a técnica não seja encerrado como ruído de rotina.

**O piso de segurança de ingestão protege tudo isso.** Nenhum encerramento determinístico tem permissão de disparar sobre um indicador conhecido (um observável suspeito como um IP ou hash de arquivo malicioso), um incidente ativo ou um kill switch (uma configuração do operador que interrompe a ação automática), e um limite de volume atua como um disjuntor de modo que uma regra descontrolada degrada para "humanos olham" em vez de supressão em massa.

O que quer que sobreviva ao funil é promovido: torna-se uma investigação, agendada para uma execução de triagem.

## A execução de triagem: dois papéis de modelo, e muito determinismo

A execução é um laço agêntico, mas a pegada do modelo dentro dela é pequena e deliberada.

O laço abre com um portão determinístico. Se o alerta corresponde a uma [política de triagem](/pt-br/triage-policies) cuja disposição (o resultado a aplicar: encerrar, escalar ou pedir mais informações) é garantida e não contestada, ele é resolvido ali mesmo, e o modelo nunca é consultado.

Para todo o resto, um **supervisor** decide o que fazer em seguida. Este é o primeiro dos dois papéis de modelo, e seu trabalho inteiro é roteamento: investigar, enriquecer, contextualizar, decidir ou encerrar. Ele não faz trabalho de domínio próprio, e pode levar vários turnos de roteamento antes de decidir.

O trabalho para o qual ele roteia é determinístico. As **etapas de enriquecimento** puxam contexto de host e processo do SIEM, verificam a reputação de observáveis por meio de analisadores do Cortex e buscam contexto de threat-intel no MISP. Essas são chamadas de ferramenta e heurísticas, não chamadas de modelo. Um equívoco comum sobre triagem com AI é que o modelo faz o enriquecimento. Aqui ele não faz: o enriquecimento é orquestração determinística de ferramentas, e o modelo apenas lê os resultados.

Ao longo do caminho, a execução reúne seu [contexto de autorização](/pt-br/authorization): os fatos de estado da organização (tíquetes de mudança, manutenção aprovada, contexto de conta e ativo) que dizem se esta atividade foi autorizada. A autorização é o que permite ao pipeline separar uma mudança autorizada de um ataque que produz um alerta byte-a-byte idêntico, uma distinção que nenhuma quantidade de busca de reputação consegue fazer.

Quando o supervisor tem o suficiente, ele passa a bola para o **veredito**, o segundo papel de modelo. Este é o único lugar em que um modelo de raciocínio pesa tudo o que a execução reuniu e propõe uma disposição: encerrar, escalar ou pedir mais informações.

Então o determinismo assume novamente. O veredito é uma proposta, não um commit. Um guard de [política de triagem](/pt-br/triage-policies) só pode elevar a decisão do modelo, nunca rebaixá-la: um encerramento proposto sobre um sinal malicioso ou um registro de autorização contradito é transformado em uma escalação, e o vocabulário do guard torna a supressão impossível de expressar. Se um encerramento proposto toca um ativo sensível, ele é retido para aprovação humana. O modelo propõe; o código determinístico dispõe.

## As garantias: um piso de segurança em três lugares

A regra de que a autorização, e o modelo, nunca podem encerrar sobre um sinal malicioso conhecido, um indicador não verificado ou um caso relacionado ativo não é deixada à redação do prompt. Ela é aplicada em código, em três pontos independentes no caminho de encerramento:

- **Na ingestão**, antes de qualquer encerramento determinístico, indexado por um indicador conhecido, um incidente ativo, um kill switch e o limite de volume.
- **Durante a execução**, quando o modelo propõe um encerramento, indexado por um indicador conhecido, um indicador não verificado e um registro de autorização contradito. Este é o único piso que consulta a autorização de fato.
- **No servidor**, quando o encerramento é comitado, indexado pelo kill switch, outro caso ativo que compartilha as mesmas entidades e o limite de volume.

Cada caminho de encerramento tem seu piso em seu próprio ponto: um encerramento determinístico de ingestão passa pelo primeiro, e um encerramento proposto pelo modelo passa pelo segundo e então pelo terceiro. A autorização pode reduzir a suspeita naquele piso intermediário, mas nunca pode convencer nenhum deles a abrir mão de um indicador conhecido ou de um caso relacionado ativo. Veja [Autorização](/pt-br/authorization) sobre como evidências que dão cobertura reduzem a suspeita sem jamais sobrepor um sinal malicioso.

## Agir sobre o veredito

Assim que a execução se completa, o servidor comita a disposição e age sobre ela, de forma determinística e em uma única transação.

Uma escalação cai na fila de [revisão humana](/pt-br/human-review) com a evidência real anexada. Quando a execução travou especificamente porque a autorização estava ausente, a revisão carrega uma pergunta de autorização tipada, e a resposta do analista é salva como um fato reutilizável, de modo que a mesma atividade não seja perguntada novamente enquanto aquela autorização se mantiver. Essa memória de perguntar-uma-vez é descrita na página [Autorização](/pt-br/authorization).

Um veredito também impulsiona [playbooks de resposta](/pt-br/response-playbooks). Esta é a camada SOAR do sistema, o mesmo tipo de automação determinística e governada que um analista de SOAR reconheceria, exceto que é impulsionada por um veredito fundamentado em vez de uma regra frágil, e é onde a postura de "ação governada" aparece. Ações seguras, escrever uma nota ou notificar um webhook, rodam por conta própria. Ações que alcançam um sistema ativo, isolar um endpoint ou desabilitar uma conta, nunca rodam por conta própria: são levantadas como uma proposta e um analista as aprova primeiro. Um encerramento só pode anotar, um kill switch de dispatch para as ações de resposta ativas de imediato (auditorias em modo sombra ainda podem registrar o que teria disparado), e todo o dispatch acontece do lado do servidor, nunca a partir do laço do modelo.

Um último toque determinístico lida com o tempo. Se novas evidências correlacionadas chegaram enquanto a execução estava em andamento e o caso ainda está aberto, uma execução de acompanhamento é iniciada sobre o quadro agora completo, de modo que um alerta de chegada tardia não fique isolado fora do caso ao qual pertence.

## O que torna isso diferente

Reunidas, algumas propriedades diferenciam isso de apontar um modelo para cada alerta:

- **Muitos alertas nunca chegam a um modelo.** Dedup, coalescência, deconflitação e encerramento determinístico resolvem muitos deles na ingestão, de modo que o modelo é gasto nos casos ambíguos.
- **Uma execução consulta o modelo em apenas dois papéis**, roteamento e o veredito final, e muitos casos encerram deterministicamente sem nenhuma chamada de modelo. O enriquecimento é orquestração determinística de ferramentas, não classificação de modelo por alerta.
- **Um incidente é um caso.** Coalescência e correlação dão ao modelo o quadro correlacionado inteiro, não um alerta solitário despido de seu contexto.
- **O modelo propõe, o código dispõe.** Um guard e um piso de segurança em três lugares tornam estruturalmente impossível para o modelo encerrar sobre um indicador conhecido, um registro de autorização contradito ou um caso relacionado ativo.
- **O pipeline raciocina sobre autorização.** Ele consegue distinguir uma mudança autorizada de um ataque de aparência idêntica, um julgamento que reputação e assinaturas não conseguem fazer por conta própria.
- **Ele se lembra.** A decisão de autorização de um analista se torna memória reutilizável, de modo que a fila para de perguntar uma questão já respondida enquanto aquela autorização se mantiver.

## Para onde ir em seguida

Cada estágio tem sua própria página e seu código:

- [Autorização](/pt-br/authorization), raciocínio de estado da organização e a memória de perguntar-uma-vez.
- [Políticas de Triagem](/pt-br/triage-policies), os guardrails determinísticos sobre a execução.
- [Playbooks de Resposta](/pt-br/response-playbooks), transformar um veredito em ação governada.
- [Revisão humana](/pt-br/human-review), a fila de revisão e o caminho de decisão do analista.
- [Pipeline de AI](/pt-br/ai-pipeline), o grafo agêntico em mais detalhe.
- [Arquitetura](/pt-br/reference/architecture), o modelo de implantação e de dados.

O código do pipeline vive em [`src/soctalk/core/ir/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/core/ir) (plano de ingestão), [`src/soctalk/graph/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/graph) e [`src/soctalk/supervisor/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/supervisor) (plano de grafo), e [`src/soctalk/response/`](https://github.com/soctalk/soctalk/tree/main/src/soctalk/response) (resposta).
