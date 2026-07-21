---
title: Manter a conta do triage de IA o mais baixa possível
description: "Assim que o triage de IA funciona, a próxima pergunta é a conta. Batching e cache, escalonamento de modelos, modelos hospedados mais baratos e auto-hospedagem em GPUs alugadas ou locais, com custo e latência medidos para reduzir a conta do modelo ao mínimo."
---

# Manter a conta do triage de IA o mais baixa possível

Assim que o triage de IA funciona, a próxima pergunta é a conta. Cada alerta que chega a um modelo custa dinheiro, e com um volume de alertas real esse número sobe rápido. A maior parte dessa conta é opcional.

A SocTalk mantém a maioria dos alertas longe de um modelo logo de início, por deduplicação, coalescência, correlação e fechamento determinístico (veja [Como funciona](/pt-br/how-it-works)), de modo que o gasto que sobra se concentra nos alertas que de fato precisam de julgamento. Este guia trata de reduzir esse gasto restante o máximo possível, sem abrir mão de mais qualidade do que você mediu e sem tirar conteúdo sensível de alerta do seu perímetro.

As opções abaixo estão ordenadas da mais barata e segura para a menos. A maioria dos deployments nunca chega à última.

## Batching e cache antes de tudo

Dois recursos gerenciados nas APIs de fronteira cortam o custo sem mudar a qualidade do modelo.

**A Batch API** processa as requisições de forma assíncrona em troca de um desconto fixo, e a saída é idêntica. A SocTalk se encaixa nisso sem esforço. A janela de settle já segura uma execução para que os alertas correlacionados se acumulem, e uma execução é assíncrona por natureza, então o triage não é um caminho sensível à latência.

**O cache de prompts (prompt caching)** cobra a parte repetida de um prompt a uma fração da tarifa de entrada. Os prompts de supervisor e de verdict da SocTalk carregam um prefixo estável grande, o prompt de sistema e as definições de ferramentas, com o conteúdo volátil de cada caso ao final, então a fração cacheável é real e já é usada no caminho da Anthropic.

Ligue os dois e meça o novo custo por execução antes de considerar qualquer coisa abaixo. Nenhum dos dois toca na qualidade, então não há razão para pulá-los.

## Coloque um modelo mais barato no trabalho mais barato

Uma execução de triage usa um modelo em dois papéis: um supervisor que roteia a investigação, decidindo o que enriquecer em seguida e quando decidir, e um verdict que pesa as evidências. O roteamento é a tarefa mais leve. A SocTalk resolve cada papel ao seu próprio tier, e cada tier aponta para o seu próprio provider, modelo e endpoint, então o roteador pode rodar em um modelo menor enquanto o verdict mantém o capaz. Isso é configuração, não infraestrutura nova.

## Modelos hospedados mais baratos, com uma ressalva

Vários provider servem modelos abertos quase-fronteira que podem ficar abaixo das APIs de fronteira, dependendo do provider, do modelo e da carga. Servem para os casos rotineiros, de menor risco, onde um modelo aberto quase-fronteira basta. Para o trabalho de segurança a restrição é a governança de dados, não o preço: enviar alertas de clientes a uma API de terceiros, sobretudo em outra jurisdição, tira esses dados do seu controle. Se isso for um não categórico para seus tenants, a próxima seção mantém os dados dentro da sua fronteira.

## Auto-hospedar o modelo

A auto-hospedagem é a maior economia, e a única opção que mantém o conteúdo dos alertas dentro do seu perímetro. A SocTalk consome um modelo auto-hospedado do mesmo jeito que consome uma API de fronteira, apontando um tier para um endpoint compatível com OpenAI. Ela classifica o backend pelo seu modelo de entrega, uma API gerenciada e quente, uma GPU serverless que escala a zero, uma GPU alugada sempre ligada, ou uma instância local, de modo que custo e escalonamento se comportem corretamente para cada um.

Onde você o roda é um trade-off real.

- **Uma plataforma de GPU serverless gerenciada** (por exemplo Modal) faz o deploy do modelo atrás de um endpoint compatível com OpenAI, escala a zero quando ociosa e cobra por GPU-segundo. Você paga só enquanto ela roda e não há servidor para operar, a uma tarifa por hora maior que a de um aluguel puro.
- **Um marketplace de aluguel de GPU** (por exemplo RunPod) aluga GPUs de consumo próximas do que um pequeno deployment auto-hospedado compraria, a uma tarifa por hora menor. Em troca, você opera o ciclo de vida. Um pod cobra até você pará-lo, os arranques a frio levam minutos, e a disponibilidade nas faixas mais baratas varia.
- **Uma instância local** (por exemplo [Ollama](/pt-br/integrate/ollama)) roda em hardware que você já possui, sem cobrança medida por requisição e sem nada saindo da máquina, limitada pela vazão dessa única máquina.

## O que gera a economia é a utilização, não a placa

Um servidor auto-hospedado só é barato quando seu batch contínuo está cheio. Uma requisição por vez deixa a GPU subutilizada e faz a auto-hospedagem custar mais do que deveria. A SocTalk roda várias investigações concorrentemente por worker, então há várias requisições em voo contra o backend ao mesmo tempo e o batch enche.

Nos nossos benchmarks, encher o batch com oito requisições concorrentes elevou a vazão agregada em cerca de seis a oito vezes em relação a uma-de-cada-vez e cortou o custo por requisição para cerca de 13 a 17 por cento do caso serial, nas execuções testadas com L40S, A10G, L4, RTX 3090 e RTX 4090. A utilização fez a maior parte do trabalho. Foi a concorrência, não a placa, que levou a auto-hospedagem de ineficiente a mais barata que a linha de base serial nessas execuções.

## Quanto custa, medido

Estes números vêm dos nossos próprios benchmarks de um modelo aberto de 7B sobre um conjunto fixo de casos de triage a oito vias de concorrência. São orientativos, não uma garantia. Seu modelo, hardware e mix de alertas vão movê-los.

Por triage completo, auto-hospedar numa GPU de consumo alugada saiu cerca de duas a três ordens de grandeza mais barato que uma chamada de API de fronteira não otimizada, e várias vezes mais barato que o mesmo modelo numa plataforma serverless gerenciada, porque a placa alugada testada era tanto mais barata por hora quanto, nessas execuções, mais rápida. A tarifa maior da plataforma gerenciada compra o escalar a zero e nenhuma operação. O preço maior da API de fronteira compra um tier de modelo gerenciado que pode servir aos casos mais difíceis, sem infraestrutura para operar.

A latência se manteve prática. O conjunto de 12 casos terminou em cerca de um minuto numa Modal A10G e em 11 a 14 segundos numa RunPod 4090, ambas a oito vias de concorrência, em vez dos vários minutos que uma estimativa de fluxo único sugere, porque a concorrência sobrepõe as chamadas e os verdicts reais cabem no orçamento de tokens.

## Se um modelo pequeno é bom o bastante

O custo só importa se o modelo barato aguentar. Nas nossas execuções, um modelo aberto de 7B manteve o contrato de triage estruturado da SocTalk: saída válida de router e de verdict, sem erros de schema, e verdicts que coincidiram com um modelo de raciocínio maior em cerca de 58 a 75 por cento de uma pequena amostra de benchmark. Foi mais fraco no roteamento, e nos casos sensíveis a autorização às vezes fechou atividade que não tinha nenhuma autorização registrada e deveria ter sido escalada.

Um modelo pequeno auto-hospedado é, portanto, um tier barato viável para o miolo rotineiro, com um modelo capaz atrás dele para os casos difíceis. Se ele é bom o bastante para o seu ambiente é uma medição, não uma suposição, e cabe fazê-la contra um benchmark representativo antes de confiar a um modelo pequeno qualquer decisão de fechamento. O safety floor vale de qualquer forma. Nenhum modelo pode fechar sobre um sinal malicioso conhecido nem sobre um caso relacionado ativo, seja qual for o modo como foi servido.

## Limitações a planejar

- **Arranques a frio.** Um backend escalado a zero ou recém-alugado não fica pronto na hora. O download e o carregamento do modelo levam minutos, então uma rajada que chega a frio espera. Bom para triage rotineiro, um problema para qualquer coisa urgente, e é por isso que um tier de reserva quente ganha o seu lugar.
- **Carga operacional em aluguéis.** Uma GPU alugada cobra até você pará-la e não tem escalar a zero, então o tempo ocioso é dinheiro desperdiçado e desmontar cabe a você lembrar. A disponibilidade nas faixas mais baratas varia.
- **Contabilidade de custos.** Um orçamento por token é a unidade certa para uma API de fronteira e a errada para um backend por GPU-segundo. Contabilize pela unidade de cobrança do próprio backend quando auto-hospedar.
- **A governança de dados é um espectro.** A redação tira os segredos antes de qualquer coisa sair, mas o contexto operacional, hosts, contas, conteúdo de logs, ainda viaja para uma API externa. Só a auto-hospedagem dentro da fronteira mantém esse contexto no seu perímetro.

## Escolher onde rodar o modelo

Três perguntas resolvem. **Utilização.** Uma carga estável e de alta utilização favorece uma placa alugada; uma carga esporádica e em rajadas favorece uma plataforma que escala a zero ou uma API gerenciada cujo custo ocioso é zero. **Apetite operacional.** Um aluguel é o mais barato, mas você o opera; uma plataforma serverless custa mais e se opera sozinha; uma API custa o máximo sem nada para operar. **Sensibilidade dos dados.** Se o conteúdo dos alertas não pode sair da sua fronteira, a auto-hospedagem é a única resposta, e o trabalho acima é como você a torna viável em custo.

Para a maioria dos times a ordem é a mesma deste guia. Batching e cache primeiro, o roteador num modelo mais barato em seguida, e um tier auto-hospedado só quando o volume e a necessidade de residência de dados justificam operá-lo.

**Aviso legal.** A SocTalk não é afiliada, endossada nem patrocinada por nenhum provedor de serviços de LLM ou GPU. Modal, RunPod, Anthropic, OpenAI, Ollama e quaisquer outros serviços citados neste guia são mencionados apenas como exemplos de onde um modelo pode rodar. Os números de custo e desempenho são as nossas próprias observações de benchmark, não números publicados pelos provedores, e todos os nomes de produto e marcas pertencem aos seus respectivos donos.
