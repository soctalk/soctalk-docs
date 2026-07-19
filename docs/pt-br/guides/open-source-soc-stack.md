---
description: "Monte um stack SOC open source com Wazuh, TheHive, Cortex e MISP: o que cada ferramenta faz, o custo real de integração e quando empacotar tudo."
---

# Construindo um stack SOC open source: Wazuh, TheHive, Cortex e MISP — montado vs integrado

Existe um stack SOC canônico free e open source, e ele tem sido praticamente os mesmos quatro nomes há anos: Wazuh para detecção, TheHive para gestão de casos, Cortex para análise de observáveis, MISP para inteligência de ameaças. Cada projeto é genuinamente bom no que faz, cada um é testado em batalha, e juntos cobrem a maior parte do que uma suíte SOC comercial vende. O detalhe está na palavra *juntos*. As ferramentas são excelentes; a integração entre elas é um projeto que você constrói e depois passa a manter.

Este guia cobre o que cada peça faz, o que montá-las realmente custa, como os requisitos mudam quando você opera a segurança de mais de uma organização, e onde o SocTalk se encaixa — que é *em cima* desse stack, não no lugar dele.

## O stack SOC FOSS clássico

**[Wazuh](https://wazuh.com/)** é a camada de SIEM/XDR: um agente em cada endpoint, um manager que aplica regras de detecção ao fluxo de eventos e um indexador (baseado em OpenSearch) que armazena e pesquisa os resultados. Ele já traz monitoramento de integridade de arquivos, detecção de vulnerabilidades, análise de logs e um grande conjunto de regras padrão prontos para uso. É onde os alertas nascem.

**[TheHive](https://thehive-project.org/)** é a camada de gestão de casos: uma plataforma de resposta a incidentes de segurança onde alertas viram casos, casos carregam tarefas e observáveis, e equipes de analistas colaboram com trilha de auditoria. Se o Wazuh é onde os alertas nascem, o TheHive é onde as investigações vivem e morrem.

**Cortex** é o companheiro do TheHive para análise de observáveis. Você entrega a ele um IP, hash, domínio ou URL, e seus plugins analisadores consultam em paralelo serviços de reputação e sandbox — VirusTotal, AbuseIPDB, Hybrid Analysis e dezenas de outros — e trazem de volta um veredito. Ele transforma "aqui está um hash" em "aqui está o que o mundo sabe sobre este hash".

**[MISP](https://www.misp-project.org/)** é a plataforma de inteligência de ameaças: agrega, correlaciona e compartilha indicadores de comprometimento entre feeds e comunidades de compartilhamento. Verificar um observável contra o MISP diz se ele pertence a uma campanha ou ator conhecido — contexto que nenhuma das outras três ferramentas carrega por conta própria.

Quatro ferramentas, quatro funções distintas, todas open source. No papel, um SOC completo.

## O imposto de integração que ninguém orça

Cada uma dessas ferramentas se instala em uma tarde. É aí que os tutoriais de home lab terminam, e onde o trabalho de verdade começa, porque nenhuma delas conversa com as outras de fábrica no formato que um SOC de produção precisa.

A cola é por sua conta. Alertas do Wazuh não viram casos no TheHive sem um forwarder que você escreve ou adota e depois mantém a cada mudança de API dos dois lados. Analisadores do Cortex precisam de chaves de API por provedor, tratamento de rate limit e uma decisão sobre qual analisador roda para qual tipo de observável. O MISP precisa de feeds configurados, jobs de sincronização agendados e indicadores propensos a falso positivo curados antes que você ouse automatizar em cima deles.

Depois vem a superfície operacional: quatro produtos significam quatro sistemas de autenticação e cronogramas de rotação de chaves de API, quatro cadências de upgrade que podem quebrar sua cola em qualquer release, quatro histórias de backup e — desde que o TheHive migrou para Cassandra/Elasticsearch por baixo — uma pegada de datastore nada trivial só para a gestão de casos. Some TLS entre cada par, monitoramento para cada serviço e a questão de quem é acionado quando o forwarder do Wazuh para o TheHive silenciosamente para de encaminhar.

Nada disso é uma crítica às ferramentas. É a natureza de compor projetos independentes: a camada de integração é um quinto produto, exceto que ninguém o entrega, documenta ou atualiza para você.

## Organização única vs MSSP: a bifurcação de requisitos

Para uma única organização, o imposto acima é pagável. Você constrói o stack uma vez, a cola serve a um único tenant, e um engenheiro capaz consegue mantê-lo saudável como trabalho de meio período.

Para um MSP ou MSSP, os requisitos bifurcam de forma dura:

- **Isolamento é inegociável.** Os alertas, casos e indicadores do cliente A precisam ser comprovadamente invisíveis para o cliente B — contratualmente, e muitas vezes regulatoriamente. Ferramentas single-tenant compartilhadas transformam isso em um exercício de configuração por ferramenta, com modos de falha por ferramenta.
- **Stacks por cliente multiplicam o imposto.** Dez clientes em stacks dedicados significam dez managers e indexadores Wazuh para implantar, atualizar e fazer backup — e dez cópias da sua cola.
- **O onboarding precisa ser repetível.** O cliente número onze deve ser um comando, não uma semana de arqueologia de wiki. Stacks montados à mão sofrem drift; drift vira incidente.
- **Um único painel.** Analistas cobrindo vinte clientes não podem revezar entre vinte dashboards.

Essa é a distância entre "o stack SOC FOSS funciona" e "o stack SOC FOSS funciona como negócio".

## Onde o SocTalk se encaixa: um control plane sobre o stack, não um substituto

O [SocTalk](https://github.com/soctalk/soctalk) não substitui nenhuma das quatro ferramentas. Ele é um control plane multi-tenant Apache 2.0 e uma camada de triagem com AI construídos *ao redor* desse stack, para MSPs e MSSPs que o executam no próprio Kubernetes:

- **O Wazuh é o data plane.** Cada cliente recebe um manager e um indexador Wazuh dedicados em um namespace isolado, provisionados pelo control plane — ou você traz um Wazuh existente via o perfil `provided`. Os agentes se registram por ingress roteado por hostname, com secrets com escopo de tenant.
- **A camada de triagem com AI fica entre o Wazuh e seus analistas.** Um funil de ingestão determinístico deduplica, coalesce e correlaciona alertas antes de qualquer modelo rodar; um loop agêntico LangGraph investiga o que sobrevive; escalonamentos sempre passam por um portão de revisão humana. Detalhes em [Como funciona](/pt-br/how-it-works).
- **TheHive, Cortex e MISP são integrações**, consultadas durante a execução: Cortex para reputação de observáveis, MISP para contexto de inteligência de ameaças, TheHive como destino de exportação para casos escalonados.
- **A maquinaria multi-tenant é o produto**: isolamento por namespace com Cilium NetworkPolicy, row-level security do Postgres como salvaguarda de dados, uma máquina de estados de ciclo de vida do tenant e configuração de LLM por tenant.

**Seja claro sobre a superfície de integração da V1**, porque é aqui que a honestidade vence o marketing:

- A [exportação para o TheHive](/pt-br/integrate/thehive) é opt-in e **síncrona** — o worker chama a API do TheHive no momento do nó do grafo, criando o caso e os observáveis. Não há outbox, não há loop de retry e não há subchart do TheHive incluído; se o TheHive estiver inacessível, a falha é registrada em log e o caso prossegue somente no SocTalk.
- O [Cortex](/pt-br/integrate/cortex) é **somente gerenciado pelo cliente** na V1 — você executa o Cortex por conta própria e o SocTalk o chama. Sem subchart incluído; a seleção de analisadores usa um mapa fixo no código, e chamadas com falha não são fatais para a execução.
- As consultas ao **MISP** rodam no `misp_worker` do pipeline contra a sua instância MISP; um subchart MISP incluído está adiado para uma release futura.
- O código de notificação e aprovação bidirecional via **Slack** existe no repositório, mas **não está ligado ao runtime do chart da V1** — a fila de revisão do dashboard é a superfície de human-in-the-loop (HIL) funcional hoje.

Em outras palavras: o SocTalk empacota o plano Wazuh multi-tenant e a camada de triagem, e *se conecta às* instâncias de TheHive/Cortex/MISP que você opera. A conveniência de subcharts incluídos é roadmap, não release.

## Montar o stack por conta própria, ou implantar o SocTalk?

Critérios honestos, já que os dois caminhos são open source:

**Monte o stack de quatro ferramentas por conta própria quando** você é uma única organização com tempo de engenharia, quer controle máximo sobre cada componente, seu volume de alertas é administrável para o seu quadro de analistas e multi-tenancy é irrelevante. O stack clássico mais a sua própria cola é um padrão comprovado, e você entenderá cada fio porque foi você quem o soldou.

**Considere o SocTalk quando** você é um MSP/MSSP que precisa de stacks Wazuh por cliente repetíveis atrás de um único control plane, isolamento de tenant comprovável e triagem com AI que comprime o volume de alertas antes que os analistas o vejam — e prefere operar uma plataforma gerenciada por Helm a N stacks montados à mão. Você ainda executa o Kubernetes, e na V1 ainda opera seus próprios TheHive, Cortex e MISP se quiser usá-los.

A forma mais rápida de avaliar é a [VM de demonstração](/pt-br/quickstart-vm): uma imagem, um assistente no navegador, cerca de cinco minutos até uma instalação multi-tenant em execução com um tenant de demonstração integrado. A partir daí, [Como funciona](/pt-br/how-it-works) explica o pipeline, e as páginas do [TheHive](/pt-br/integrate/thehive) e do [Cortex](/pt-br/integrate/cortex) documentam exatamente o que as integrações da V1 fazem — e não fazem — para que você planeje o restante do seu stack em torno delas.
