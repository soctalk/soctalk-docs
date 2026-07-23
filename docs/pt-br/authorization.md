# Autorização

## Esta atividade foi autorizada?

A maior parte do que um SOC escala não é maliciosa. É uma pessoa ou sistema real fazendo um trabalho real que por acaso se parece com um ataque: um administrador usando uma conta break-glass às 3h da manhã, um pipeline de deploy tocando um arquivo de configuração, um scanner varrendo uma sub-rede durante um pentest sancionado. Se um alerta é benigno frequentemente depende não do alerta em si, mas do estado da organização ao seu redor. Dois alertas idênticos byte a byte podem ter disposições opostas dependendo apenas de haver um ticket de mudança, uma janela de manutenção ou uma baseline aprovada cobrindo a atividade.

Autorização é a camada que dá ao SocTalk esse contexto de estado organizacional. Ela vincula registros tipados (tickets de mudança, baselines permanentes, congelamentos de mudança, proibições e fatos de entidade sobre ativos e contas) à atividade em um alerta, e raciocina sobre se um único registro a cobre totalmente. Ela só reduz a suspeita ao encontrar evidência de cobertura. Nunca a aumenta, e nunca sobrepõe um sinal malicioso.

Não é uma etapa separada aparafusada à triagem. É contexto que o loop agêntico reúne enquanto investiga, e resolve para um de três estados que moldam o verdict. Tudo a jusante ainda passa pelo piso de segurança, que a autorização nunca pode enfraquecer.

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

## Registrando um fato pelo console: um exemplo prático

Os fatos não precisam vir de um conector ou de uma investigação. Um analista MSSP ou um administrador de tenant pode registrar um diretamente, e o formulário do console é construído em torno do modelo de fato, de modo que um fato válido é a única coisa que você pode submeter.

Tome um caso comum. A conta de serviço `svc-deploy` da Acme vai executar comandos privilegiados em `db-01` durante a manutenção de sexta-feira, aprovada sob o ticket de mudança CHG-1001. Se deixado sem declarar, o `sudo` que esses comandos disparam se parece exatamente com o tipo de uso de privilégio que um SOC escala. Registrar o ticket de mudança como uma concessão é o que diz ao SocTalk que a atividade está coberta.

Abra a área de **Autorização**. No lado MSSP, escolha primeiro o cliente pelo seletor de tenant; um administrador de tenant vê a própria organização diretamente. A lista mostra cada fato arquivado com um resumo em linguagem simples, sua origem e nível de confiança, sua validade e seu status de revisão.

![A lista de fatos de Autorização: um ticket de mudança coberto, uma afirmação de tenant pendente aguardando revisão e um congelamento de mudança](/screenshots/authz-facts-list.png)

Escolha **Novo fato** para abrir o editor guiado. Você escolhe primeiro o **tipo** (concessão, proibição, congelamento de mudança ou contexto de entidade) e a **trilha** (conta, para atividade de host descrita como sujeito, alvo e ação; ou FIM, para mudanças de arquivo descritas como um caminho e um tipo de mudança). O formulário então mostra apenas os campos que são válidos para aquela combinação, de modo que você não consegue construir um fato que o motor rejeitaria: uma concessão por ticket de mudança exige uma data de término, uma proibição FIM não pode carregar uma ação de conta, um congelamento de conta define escopo por ambiente em vez de por classe de configuração. Uma linha **Lê-se como** reafirma o fato em linguagem simples à medida que você digita, e a origem e o nível de confiança são carimbados automaticamente em vez de digitados à mão.

![O editor guiado de novo fato, preenchido para a concessão por ticket de mudança, com a prévia ao vivo em linguagem simples](/screenshots/authz-new-fact.png)

Para o caso de manutenção: tipo **Concessão**, trilha **Conta**, sujeito `svc-deploy`, alvo `db-01`, ação `sudo-exec`, classe de concessão **Ticket de mudança**, referência `CHG-1001`, válida até o fim da janela. **Criar fato** o grava, e ele aparece na lista com confiança afirmada por analista. A partir daí e até a expiração, um alerta para aquela conta, ação e host resolve para coberto e sua suspeita cai; após a expiração o mesmo alerta fica ausente de novo, e o SocTalk volta a perguntar em vez de presumir.

Um administrador de tenant registra fatos da mesma forma, com uma diferença: uma afirmação de tenant chega **aguardando revisão** no nível de confiança mais baixo e não influencia a triagem até que um analista MSSP a aprove a partir desta mesma lista (a linha pendente acima). Analistas que preferem trabalhar em lote, ou dirigir o armazenamento a partir de automação, podem alternar o editor para **Avançado: editar JSON** e submeter o fato bruto; a mesma validação se aplica de qualquer forma.

## Respondendo a uma pergunta de autorização

Quando uma investigação não pode ser decidida porque a autorização está ausente, e não há sinal malicioso, a revisão carrega uma pergunta de autorização tipada em vez de um pedido genérico de mais informação. Ao analista é feita uma única pergunta: esta atividade foi autorizada?

![A pergunta de autorização tipada em uma revisão, com uma ação de salvar](/screenshots/authz-ask-question.png)

O painel declara a atividade exata em questão e oferece uma única ação, distinta de aprovar ou rejeitar. Se a atividade foi autorizada, o analista define por quanto tempo a autorização deve valer e escolhe **Confirmar autorizado, salvar autorização reutilizável**. Isto grava uma concessão durável afirmada pelo analista, com escopo exatamente para aquela atividade (esta conta, esta ação, este host) com a expiração escolhida.

![A autorização reutilizável salva, e a revisão removida da fila](/screenshots/authz-ask-saved.png)

A concessão salva é o ponto central. Na próxima vez que a mesma atividade produzir um alerta, um registro agora a cobre, então a pergunta não é feita de novo. Pergunte uma vez, lembre. A autorização tem escopo para a atividade exata e carrega uma expiração, de modo que não se amplia silenciosamente nem vive para sempre, e aparece na área de Autorização, onde pode ser revisada ou revogada a qualquer momento.

Uma regra é deliberada: um fato é criado apenas por esta resposta explícita. O SocTalk nunca aprende uma autorização a partir de um simples fechamento ou rejeição. Um analista limpando a fila não é o mesmo que um analista afirmando que uma atividade é sancionada, e tratar assim deixaria a pressão da fila envenenar silenciosamente o armazenamento.

## Engajamentos

Um fato responde a uma pergunta permanente, esta conta tem permissão para fazer isto neste host. Algumas autorizações não são permanentes de forma alguma, elas são delimitadas a uma janela de tempo durante a qual uma atividade que de outra forma seria suspeita é esperada. Um pentest sancionado, um exercício de red-team ou uma janela de manutenção é uma autorização que abre e depois fecha. O SocTalk modela isto como um engajamento, e um engajamento é simplesmente um tipo de autorização: uma janela de autorização com escopo e delimitada no tempo durante a qual a atividade que ela descreve é esperada em vez de alarmante.

Engajamentos vivem na mesma área de Autorização do tenant que os fatos, em sua própria aba Engajamentos. O caminho antigo `/engagements` ainda funciona e leva por deep-link diretamente para essa aba, já que os engajamentos foram incorporados à área unificada de Autorização em vez de mantidos como uma superfície separada. Declarar um é um formulário estruturado: um nome e tipo, o início e o fim da janela, e o escopo que ele cobre como IPs de origem validados, hosts em escopo e IDs de técnica ATT&CK.

![Declarando um engajamento: uma janela de pentest delimitada com escopo por origem, host e técnica ATT&CK](/screenshots/authz-engagement.png)

Um engajamento funciona de forma diferente de um fato, porém. Ele não é controlado por gate: um usuário autorizado pelo tenant o declara, e pode revogá-lo, diretamente, sem etapa de revisão do MSSP. O que um engajamento faz é desconflitar a atividade por origem, alvo e janela de tempo validados. A atividade de alerta que cai dentro de um engajamento declarado, uma origem em escopo agindo sobre um alvo em escopo durante a janela, é atribuída ao testador: o SocTalk registra a observação, retira o alerta da fila aberta e pula a triagem por LLM dele. Ele nunca é fechado automaticamente nem marcado como falso positivo, a linha de observação permanece consultável e contabilizada. A atividade do testador que aterrissa fora do escopo declarado é sinalizada para um olhar mais atento em vez de liberada. Quando a janela fecha, a desconflitação não se aplica mais e a atividade é triada normalmente de novo.

## Os guardrails

Autorização é uma superfície de supressão, então seus limites são impostos em código, não deixados à formulação de prompts:

- **A ausência nunca fecha automaticamente.** Nenhum registro de cobertura significa que um humano decide, nunca um fechamento automático.
- **A autorização nunca sobrepõe um sinal malicioso.** Um fato "autorizado" salvo não pode fechar um alerta que também carrega um acerto de IOC, um enriquecimento malicioso ou uma correlação de incidente ativo. A correlação roda antes da supressão, e o piso de segurança veta esses casos independentemente de qualquer fato. Uma autorização reutilizável reduz a suspeita de rotina; ela não cega o sistema para um ataque real que reutiliza a mesma atividade.
- **A memória é tipada e governada.** Fatos carregam uma origem, um nível de confiança, um escopo e uma expiração. Eles nunca são memória de prompt em formato livre, e fatos amplos ou privilegiados devem passar por revisão.
- **A confiança é escalonada.** Registros verificados por conector superam os afirmados por sistema, que superam os afirmados por analista, que superam a telemetria de rotina, que supera os afirmados por tenant. Um registro de maior confiança corrobora ou sobrepõe um de menor confiança.

## Onde isso aparece

O contexto de autorização é renderizado no raciocínio da AI em toda investigação que o carrega, de modo que o modelo pesa a evidência de cobertura por conta própria em vez de receber um sim ou não pronto. Fatos salvos, seu status de revisão e sua expiração são listados na área de **Autorização** da UI, onde um analista pode revogar qualquer fato. Consulte [Usuários e papéis](/pt-br/users-and-roles) para saber quem pode afirmar, revisar e responder, e [Revisão humana](/pt-br/human-review) para a fila de revisão sobre a qual a pergunta de autorização trafega.
