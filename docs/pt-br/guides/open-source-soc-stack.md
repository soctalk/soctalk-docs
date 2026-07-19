---
description: "Monte um stack SOC open source com Wazuh, TheHive, Cortex e MISP: o que cada ferramenta faz, o custo real de integração e quando empacotar tudo."
---

# Montando um stack SOC open source com Wazuh, TheHive, Cortex e MISP: montado vs integrado

Existe um stack SOC gratuito e de código aberto considerado canônico, e ele gira em torno dos mesmos quatro nomes há anos: Wazuh para detecção, TheHive para gestão de casos, Cortex para análise de observáveis, MISP para inteligência de ameaças. Os quatro são projetos maduros, com anos de uso em produção, e juntos cobrem a maior parte do que uma suíte SOC comercial vende. O problema está na palavra *juntos*. A integração entre as ferramentas é um projeto que você constrói e depois passa a manter.

Este guia cobre o que cada peça faz, quanto custa de fato montá-las, como os requisitos mudam quando você opera a segurança de mais de uma organização e onde o SocTalk se encaixa, que é *em cima* desse stack e não no lugar dele.

## O stack SOC FOSS clássico

O **[Wazuh](https://wazuh.com/)** é a camada de SIEM/XDR: um agente em cada endpoint, um manager que aplica regras de detecção ao fluxo de eventos e um indexador (baseado em OpenSearch) que armazena e pesquisa os resultados. Ele já vem com monitoramento de integridade de arquivos, detecção de vulnerabilidades, análise de logs e um conjunto amplo de regras padrão. É onde os alertas nascem.

O **[TheHive](https://thehive-project.org/)** é a camada de gestão de casos: uma plataforma de resposta a incidentes de segurança onde alertas viram casos, casos carregam tarefas e observáveis, e as equipes de analistas colaboram com trilha de auditoria. Se o Wazuh é onde os alertas nascem, o TheHive é onde as investigações vivem e morrem.

O **Cortex** é o companheiro do TheHive para análise de observáveis. Você entrega um IP, hash, domínio ou URL, e seus plugins analisadores consultam serviços de reputação e sandbox, do VirusTotal e AbuseIPDB ao Hybrid Analysis e dezenas de outros, e trazem de volta um veredito. Ele transforma "aqui está um hash" em "aqui está o que o mundo sabe sobre esse hash".

O **[MISP](https://www.misp-project.org/)** é a plataforma de inteligência de ameaças: agrega, correlaciona e compartilha indicadores de comprometimento entre feeds e comunidades de compartilhamento. Verificar um observável contra o MISP diz se ele pertence a uma campanha ou ator conhecido, um contexto que nenhuma das outras três ferramentas carrega sozinha.

São quatro ferramentas cobrindo quatro funções distintas, todas open source, e no papel um SOC completo.

## O custo real de integração

Cada uma dessas ferramentas se instala em uma tarde. É aí que os tutoriais de home lab terminam e onde o trabalho de verdade começa, porque nenhuma delas conversa com as outras de fábrica no formato que um SOC de produção exige.

A cola fica por sua conta. Alertas do Wazuh não viram casos no TheHive sem um forwarder que você escreve ou adota e depois mantém a cada mudança de API dos dois lados. Os analisadores do Cortex precisam de chaves de API por provedor, tratamento de rate limit e uma decisão sobre qual analisador roda para qual tipo de observável. O MISP precisa de feeds configurados, jobs de sincronização agendados e curadoria dos indicadores propensos a falso positivo antes que você ouse automatizar em cima deles.

Depois vem a superfície operacional: quatro produtos significam quatro sistemas de autenticação e cronogramas de rotação de chaves de API, quatro cadências de upgrade que podem quebrar sua cola em qualquer release, quatro estratégias de backup e, desde que o TheHive passou a usar Cassandra/Elasticsearch por baixo, uma pegada de datastore nada trivial só para gestão de casos. Some TLS entre cada par, monitoramento para cada serviço e a questão de quem é acionado quando o forwarder do Wazuh para o TheHive para de encaminhar em silêncio.

As ferramentas em si não têm culpa; isso é simplesmente o que compor projetos independentes implica. A camada de integração equivale a um quinto produto, só que ninguém o entrega, documenta ou atualiza para você.

## Organização única vs MSSP: a bifurcação de requisitos

Para uma organização única, o custo acima é pagável. Você monta o stack uma vez, a cola serve a um único tenant e um engenheiro capaz consegue mantê-lo saudável em meio período.

Para um MSP ou MSSP, os requisitos bifurcam de forma dura:

- **Isolamento é inegociável.** Os alertas, casos e indicadores do cliente A precisam ser comprovadamente invisíveis para o cliente B, por contrato e muitas vezes por regulação. Ferramentas single-tenant compartilhadas transformam isso em um exercício de configuração por ferramenta, com modos de falha por ferramenta.
- **Stacks por cliente multiplicam o custo.** Dez clientes em stacks dedicados significam dez managers e indexadores Wazuh para implantar, atualizar e fazer backup, mais dez cópias da sua cola.
- **O onboarding precisa ser repetível.** O cliente onze deveria exigir um comando, e não uma semana de arqueologia de wiki. Stacks montados à mão sofrem drift, e o drift cedo ou tarde aparece como incidente.
- **Um único painel.** Analistas cobrindo vinte clientes não conseguem alternar entre vinte dashboards.

Essa é a distância entre "o stack SOC FOSS funciona" e "o stack SOC FOSS funciona como negócio".

## Onde o SocTalk se encaixa: um control plane em cima do stack

O [SocTalk](https://github.com/soctalk/soctalk) mantém as quatro ferramentas no lugar. Ele é um control plane multi-tenant Apache 2.0 com camada de triagem por AI, construído *ao redor* desse stack, para MSPs e MSSPs que o operam no próprio Kubernetes:

- **O Wazuh é o data plane.** Cada cliente recebe um manager e um indexador Wazuh dedicados em um namespace isolado, provisionados pelo control plane, ou você traz um Wazuh existente via perfil `provided`. Os agentes se registram por ingress roteado por hostname, com secrets restritos ao tenant.
- **A camada de triagem por AI fica entre o Wazuh e seus analistas.** Um funil de ingestão determinístico deduplica, agrupa e correlaciona alertas antes de qualquer modelo rodar; um loop agêntico LangGraph investiga o que sobrevive; escalações sempre passam por um portão de revisão humana. Detalhes em [Como funciona](/pt-br/how-it-works).
- **TheHive, Cortex e MISP são integrações**, consultadas durante a execução: Cortex para reputação de observáveis, MISP para contexto de inteligência de ameaças, TheHive como destino de exportação dos casos escalados.
- **A maquinaria multi-tenant é o produto**: isolamento por namespace com NetworkPolicy do Cilium, row-level security no Postgres como salvaguarda dos dados, uma máquina de estados de ciclo de vida do tenant e configuração de LLM por tenant.

**Conheça a superfície de integração da V1 antes de planejar em cima dela:**

- A [exportação para o TheHive](/pt-br/integrate/thehive) é opcional e **síncrona**: o worker chama a API do TheHive no momento do nó do grafo, criando o caso e os observáveis. Não há outbox, não há loop de retry e não há subchart do TheHive empacotado; se o TheHive estiver inacessível, a falha é registrada em log e o caso segue apenas no SocTalk.
- O [Cortex](/pt-br/integrate/cortex) é **exclusivamente gerenciado pelo cliente** na V1. Você opera o Cortex e o SocTalk o chama. Sem subchart empacotado; a seleção de analisadores usa um mapa fixo no código, e chamadas com falha não são fatais para a execução.
- As consultas ao **MISP** rodam no `misp_worker` do pipeline contra a sua instância MISP; um subchart MISP empacotado foi adiado para uma release futura.
- O código de notificação e aprovação bidirecional via **Slack** existe no repositório, mas **não está conectado ao runtime do chart da V1**. A fila de revisão do dashboard é a superfície de human-in-the-loop que funciona hoje.

O SocTalk empacota o plano Wazuh multi-tenant e a camada de triagem, e *se conecta às* instâncias de TheHive/Cortex/MISP que você opera. A conveniência dos subcharts empacotados continua no roadmap; esta release não a inclui.

## Quando montar o stack por conta própria e quando implantar o SocTalk

Os dois caminhos são open source, então a escolha se apoia em critérios operacionais:

**Monte o stack de quatro ferramentas por conta própria quando** você é uma organização única com tempo de engenharia, quer controle máximo sobre cada componente, seu volume de alertas é administrável para o tamanho da sua equipe de analistas e multi-tenancy é irrelevante. O stack clássico mais a sua própria cola é um padrão comprovado, e você entenderá cada fio porque foi você quem soldou.

**Considere o SocTalk quando** você é um MSP/MSSP que precisa de stacks Wazuh repetíveis por cliente atrás de um único control plane, isolamento de tenant comprovável e triagem por AI que comprime o volume de alertas antes de os analistas os verem, e prefere operar uma plataforma gerenciada por Helm a N stacks montados à mão. Você ainda opera Kubernetes, e na V1 ainda opera seu próprio TheHive, Cortex e MISP se quiser usá-los.

O caminho mais rápido para avaliar é a [VM de demonstração](/pt-br/quickstart-vm): uma imagem, um assistente no navegador, cerca de cinco minutos até uma instalação multi-tenant em execução com um tenant de demonstração integrado. A partir daí, [Como funciona](/pt-br/how-it-works) explica o pipeline, e as páginas do [TheHive](/pt-br/integrate/thehive) e do [Cortex](/pt-br/integrate/cortex) documentam exatamente o que as integrações da V1 fazem e não fazem, para que você planeje o resto do seu stack em torno delas.
