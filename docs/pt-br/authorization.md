# Autorização

## Esta atividade foi autorizada?

A maior parte do que um SOC escala não é maliciosa. É uma pessoa ou sistema real fazendo um trabalho real que por acaso se parece com um ataque: um administrador usando uma conta break-glass às 3h da manhã, um pipeline de deploy tocando um arquivo de configuração, um scanner varrendo uma sub-rede durante um pentest sancionado. Se um alerta é benigno frequentemente depende não do alerta em si, mas do estado da organização ao seu redor. Dois alertas idênticos byte a byte podem ter disposições opostas dependendo apenas de haver um ticket de mudança, uma janela de manutenção ou uma baseline aprovada cobrindo a atividade.

Autorização é a camada que dá ao SocTalk esse contexto de estado organizacional. Ela vincula registros tipados (tickets de mudança, baselines permanentes, congelamentos de mudança, proibições e fatos de entidade sobre ativos e contas) à atividade em um alerta, e raciocina sobre se um único registro a cobre totalmente. Ela só reduz a suspeita ao encontrar evidência de cobertura. Nunca a aumenta, e nunca sobrepõe um sinal malicioso.

Não é uma etapa separada aparafusada à triagem. É contexto que o loop agêntico reúne enquanto investiga, e resolve para um de três estados que moldam o veredito. Tudo a jusante ainda passa pelo piso de segurança, que a autorização nunca pode enfraquecer.

![Onde a autorização se encaixa no fluxo de trabalho de triagem](/diagrams/authorization-in-triage.svg)

## Coberto, contradito, ausente

A autorização de cada alerta resolve para um de três estados, e a diferença entre os dois últimos é o cerne de tudo:

- **Coberto.** Um único registro cobre totalmente a atividade: o sujeito, o alvo, a ação, a janela de tempo, a validade de calendário e as aprovações corretas. A suspeita é reduzida.
- **Contradito.** Existem registros arquivados, mas nenhum deles cobre, ou uma proibição de alta prioridade veta a ação. Um ticket de mudança existe, mas expirou, ou é para um host diferente, ou o congelamento de mudança de que ele precisava nunca teve exceção aberta. Isto é um achado, não uma ausência, e escala para um humano.
- **Ausente.** Não há nenhum registro do tipo certo arquivado. A ausência nunca é tratada como autorização. O SocTalk pede mais informação em vez de presumir que a atividade foi aprovada.

Manter ausente e contradito separados importa. Um ticket obsoleto ou errado nunca deve ser lido como "próximo de autorizado". É o oposto: a papelada que deveria ter coberto isto não cobre, e isso merece a atenção de um humano.

## De onde vêm os fatos de autorização

Os fatos chegam ao armazenamento de três formas, em confiança crescente:

- **Tenants afirmam fatos sobre o próprio ambiente.** Um cliente declara uma janela de manutenção ou uma baseline permanente a partir da área de Autorização. Fatos afirmados por tenant ficam pendentes e não influenciam a triagem até que um analista MSSP os aprove.
- **Sistemas enviam fatos pela API de ingestão.** Scripts de provisionamento, hooks de CI e conectores submetem fatos tipados com uma credencial por tenant. A confiança é carimbada a partir da credencial, nunca a partir do payload, porque quem pode enviar um fato pode suprimir uma detecção.
- **Analistas respondem a uma pergunta de autorização.** Quando a triagem trava especificamente porque a autorização está ausente, o analista responde uma vez e a resposta se torna um registro reutilizável. Este é o fluxo abaixo.

## Respondendo a uma pergunta de autorização

Quando uma investigação não pode ser decidida porque a autorização está ausente, e não há sinal malicioso, a revisão carrega uma pergunta de autorização tipada em vez de um pedido genérico de mais informação. Ao analista é feita uma única pergunta: esta atividade foi autorizada?

![A pergunta de autorização tipada em uma revisão, com uma ação de salvar](/screenshots/authz-ask-question.png)

O painel declara a atividade exata em questão e oferece uma única ação, distinta de aprovar ou rejeitar. Se a atividade foi autorizada, o analista define por quanto tempo a autorização deve valer e escolhe **Confirmar autorizado, salvar autorização reutilizável**. Isto grava uma concessão durável afirmada pelo analista, com escopo exatamente para aquela atividade (esta conta, esta ação, este host) com a expiração escolhida.

![A autorização reutilizável salva, e a revisão removida da fila](/screenshots/authz-ask-saved.png)

A concessão salva é o ponto central. Na próxima vez que a mesma atividade produzir um alerta, um registro agora a cobre, então a pergunta não é feita de novo. Pergunte uma vez, lembre. A autorização tem escopo para a atividade exata e carrega uma expiração, de modo que não se amplia silenciosamente nem vive para sempre, e aparece na área de Autorização, onde pode ser revisada ou revogada a qualquer momento.

Uma regra é deliberada: um fato é criado apenas por esta resposta explícita. O SocTalk nunca aprende uma autorização a partir de um simples fechamento ou rejeição. Um analista limpando a fila não é o mesmo que um analista afirmando que uma atividade é sancionada, e tratar assim deixaria a pressão da fila envenenar silenciosamente o armazenamento.

## Os guardrails

Autorização é uma superfície de supressão, então seus limites são impostos em código, não deixados à formulação de prompts:

- **A ausência nunca fecha automaticamente.** Nenhum registro de cobertura significa que um humano decide, nunca um fechamento automático.
- **A autorização nunca sobrepõe um sinal malicioso.** Um fato "autorizado" salvo não pode fechar um alerta que também carrega um acerto de IOC, um enriquecimento malicioso ou uma correlação de incidente ativo. A correlação roda antes da supressão, e o piso de segurança veta esses casos independentemente de qualquer fato. Uma autorização reutilizável reduz a suspeita de rotina; ela não cega o sistema para um ataque real que reutiliza a mesma atividade.
- **A memória é tipada e governada.** Fatos carregam uma origem, um nível de confiança, um escopo e uma expiração. Eles nunca são memória de prompt em formato livre, e fatos amplos ou privilegiados devem passar por revisão.
- **A confiança é escalonada.** Registros verificados por conector superam os afirmados por sistema, que superam os afirmados por analista, que superam a telemetria de rotina, que supera os afirmados por tenant. Um registro de maior confiança corrobora ou sobrepõe um de menor confiança.

## Onde isso aparece

O contexto de autorização é renderizado no raciocínio da AI em toda investigação que o carrega, de modo que o modelo pesa a evidência de cobertura por conta própria em vez de receber um sim ou não pronto. Fatos salvos, seu status de revisão e sua expiração são listados na área de **Autorização** da UI, onde um analista pode revogar qualquer fato. Consulte [Usuários e papéis](/pt-br/users-and-roles) para saber quem pode afirmar, revisar e responder, e [Revisão humana](/pt-br/human-review) para a fila de revisão sobre a qual a pergunta de autorização trafega.
