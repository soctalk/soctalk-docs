---
title: O que a inferência de triage realmente custa, medido
description: "As execuções medidas por trás do guia de custo: batching contínuo em GPUs serverless, silício RTX de consumo real num marketplace de aluguel, e tempo de triage realista de golden alerts com um modelo pequeno auto-hospedável. Vazão, dólares por mil, e segundos de triage, com o método e os limites declarados."
---

# O que a inferência de triage realmente custa, medido

O [guia de custo](/pt-br/guides/inference-cost-optimization) faz afirmações sobre o que a inferência de triage custa. Esta página é a medição por trás delas: as nossas próprias execuções de benchmark, as tabelas na íntegra, e o método e os limites para que você julgue até onde elas alcançam o seu próprio ambiente. Todo resultado aqui é uma única execução medida, não um resultado estatístico e não um número de fornecedor. As varreduras de vazão usam requisições sintéticas com formato de triage, os preços são snapshots lidos no momento da execução, e os números de tempo de triage e de acurácia usam um golden set fixo de 12 alertas. O seu modelo, hardware e mix de alertas vão mover tudo isso.

Três coisas foram medidas, da vazão sintética até o triage realista: quanto um batch contínuo cheio economiza numa GPU serverless, como o silício de consumo real se compara às peças de datacenter que fazem as suas vezes, e quanto tempo um triage real de fato leva num modelo pequeno auto-hospedável. Cada execução desmontou a sua GPU em seguida, então nada ficou cobrando.

## O batching contínuo enche a GPU

Um modelo aberto foi implantado por GPU e disparou um número crescente de requisições idênticas com formato de triage contra o endpoint compatível com OpenAI do SGLang. Isso mede o lado do backend do que a concorrência de worker destrava: à medida que a concorrência de cliente N sobe, o batch contínuo enche, a vazão agregada cresce, e o custo por requisição cai.

A plataforma serverless não tem placas RTX de consumo, então GPUs de datacenter de baixo custo servem de proxies: A10G (Ampere 24GB) para a RTX 3090, L4 (Ada 24GB) para uma placa da classe RTX 4090. A Qwen3-14B precisa de cerca de 28GB em bf16 e não cabe numa placa de 24GB com folga de batch, então as placas de 24GB rodam a DeepSeek-R1-Distill-Qwen-7B, que deixa espaço de KV-cache para um batch maior.

| GPU (proxy) | modelo | N=1 tok/s | N=8 tok/s | speedup N=8 | $/1k req, N=1 a N=8 |
|---|---|---|---|---|---|
| L40S (médio, 48GB) | Qwen3-14B | 24.8 | 146.7 | 5.9x | 4.37 a 0.74 (queda de 83%) |
| A10G (aprox. RTX 3090) | DS-R1-7B | 29.2 | 216.7 | 7.4x | 2.09 a 0.28 (queda de 87%) |
| L4 (aprox. RTX 4090) | DS-R1-7B | 17.3 | 131.2 | 7.6x | 2.57 a 0.34 (queda de 87%) |

Serial (N=1) deixa a GPU subutilizada em todas as placas. Encher o batch em N=8 mediu 5.9x a 7.6x de vazão agregada e custo por requisição em 13 a 17 por cento do caso serial. As placas de 24GB mostraram um speedup maior (7.4 a 7.6x) que a placa média rodando a 14B (5.9x), porque o modelo menor deixa mais espaço de KV-cache para um batch maior. A menor tok/s absoluta da L4 em relação à A10G é esperada, já que a L4 é uma peça de inferência de baixo TDP, então ela lê como um piso conservador para uma RTX 4090 real. Os fatores de escalonamento foram similares entre as placas, e esse é o ponto: a utilização, não a placa, gera a economia.

## Silício de consumo real, num marketplace de aluguel

Um marketplace de aluguel de GPU aluga as placas de consumo literais, então isso verifica o hardware real que os proxies serverless só podiam substituir. Mesmo modelo de 7B, mesma varredura, GPU única, pod encerrado ao final.

Preço de aluguel na hora, community tier, lido da API do marketplace: RTX 3090 $0.22/hr, RTX 4090 $0.34/hr, RTX 5090 $0.69/hr, contra a A10G $1.10/hr e a L4 $0.80/hr da plataforma serverless.

Medido numa RTX 3090 real:

| N | tok/s (agregada) | speedup | $/1k req |
|---|---|---|---|
| 1 | 45.8 | 1.00x | 0.267 |
| 4 | 179.0 | 3.91x | 0.068 |
| 8 | 352.2 | 7.69x | 0.035 |

O speedup de batching se manteve no silício real (7.69x em N=8, contra 7.42x no proxy A10G e 7.58x no proxy L4). A RTX 3090 real rodou mais rápido que o proxy A10G (45.8 versus 29.2 tok/s em N=1, 352 versus 217 em N=8), porque a A10G é uma peça reduzida. O custo medido foi menor na placa alugada: $0.035 por 1k requisições em N=8 contra os $0.282 da A10G, cerca de 8x menor nesta execução, vindo de uma placa mais barata ($0.22 versus $1.10/hr) e maior vazão, sem compra de GPU adiantada. O caminho do pod tem um arranque a frio lento (pull da imagem mais download do modelo), então rodou desacoplado: criar, sondar até pronto, varrer, encerrar.

## Tempo de triage realista, e se um modelo pequeno aguenta

As varreduras acima mediram a vazão de tokens sintética. Isso mede o triage realista: a eval de triage da SocTalk conduzida sobre 12 golden alerts a concorrência 8, cronometrando os nós reais de router e verdict sobre payloads reais.

DeepSeek-R1-Distill-Qwen-7B, 12 golden alerts, N=8:

| Provider / GPU | serving | wall total | verdict | routing | schema errors |
|---|---|---|---|---|---|
| Serverless A10G | SGLang | 43.2 s | 5/6 | 2/3 | 0 |
| RTX 4090 alugada (secure) | vLLM | 11.3 s | 6/6 | 2/3 | 0 |

Stock versus destilado, ambos na RTX 4090 alugada (secure), N=8:

| Modelo | wall total | verdict | routing | schema errors |
|---|---|---|---|---|
| DeepSeek-R1-Distill-Qwen-7B | 11.3 s | 6/6 | 2/3 | 0 |
| Qwen2.5-7B-Instruct (stock) | 16.7 s | 6/6 | 1/3 | 0 |

O triage golden realista em N=8 terminou o conjunto de 12 alertas em 11 a 43 segundos nessas execuções, abaixo de um minuto. O 7B produziu zero schema errors e scores de verdict de 5/6 a 6/6, então um modelo pequeno auto-hospedável produziu saída de triage estruturada válida aqui. O Qwen2.5-7B-Instruct stock também funcionou (saída estruturada válida, zero schema errors, o mesmo score de verdict do destilado) e ficou um caso atrás do destilado no roteamento, que é uma amostra de roteamento pequena demais para ler com força.

Custo por triage realista, medido por nó (uma execução agêntica completa são algumas chamadas, então multiplique por cerca de 2 a 3): a A10G serverless a $1.10/hr é cerca de $1.10 por 1.000 alertas; a RTX 4090 alugada secure a $0.69/hr é cerca de $0.18 por 1.000, e community a $0.34/hr cerca de $0.09 por 1.000.

## As capacidades por trás desses números

As economias acima não são incidentais. Elas vêm de uma pequena pilha de capacidades de inferência, cada uma acompanhada em aberto, que juntas deixam uma execução de triage mirar um backend de fronteira ou auto-hospedado e pagar a menor tarifa defensável por ele. Algumas já estão em pé e outras ainda estão sendo construídas; os links de issue mostram onde cada uma se encontra.

- **Um substrato uniforme de requisição** ([#32](https://github.com/soctalk/soctalk/issues/32)). Toda execução de triage é expressa como um `InferenceRequest`, resolvido a um tier, com orçamento por token, quer aterrisse numa API de fronteira ou numa GPU auto-hospedada. Nada rio abaixo precisa saber em qual backend ela caiu.
- **Uma abstração de entrega** ([#63](https://github.com/soctalk/soctalk/issues/63)). Cada backend é classificado por como é entregue e cobrado, uma API de fronteira quente, uma GPU serverless que escala a zero, uma GPU alugada sempre ligada, ou uma instância local, de modo que o substrato selecione o driver certo e saiba distinguir um backend por GPU-segundo de um por token, em vez de tratar todo backend como uma API quente medida por token. A prontidão e o escalonamento serverless que essa classificação habilita são o próximo tier de trabalho ([#64](https://github.com/soctalk/soctalk/issues/64)).
- **Concorrência de worker que enche o batch** ([#61](https://github.com/soctalk/soctalk/issues/61)). Várias investigações rodam ao mesmo tempo, então múltiplas requisições estão em voo contra o backend e o batch contínuo enche. Esse batch cheio é de onde vêm as quedas de vazão e de custo desta página.
- **Alinhamento serverless** ([#64](https://github.com/soctalk/soctalk/issues/64), em andamento). Tolerância a arranque a frio, escalonamento por liberação em rajada, e um driver de job assíncrono são projetados para deixar uma GPU que escala a zero ser consumida sem perder execuções para um worker frio, de modo que a economia de escalar a zero se torne utilizável em produção, não só num benchmark. O benchmarking bateu exatamente nessa lacuna, workers frios do RunPod retornando um 404 de proxy durante o spin-up.
- **Serving auto-hospedado de primeira classe** ([#13](https://github.com/soctalk/soctalk/issues/13), em andamento). Rodar o modelo dentro do seu próprio cluster é o deployment que mantém o conteúdo dos alertas no seu perímetro, e é o alvo pretendido dentro do cluster para a abstração de entrega acima.
- **Uma suíte de benchmarking e qualificação** ([#33](https://github.com/soctalk/soctalk/issues/33)). A evidência nesta página é produzida por uma suíte de dois eixos que separa a qualidade do modelo da viabilidade de serving, de modo que um modelo aberto pequeno seja verificado contra o contrato de triage estruturado antes de ser confiado com qualquer decisão.

Por baixo está a espinha da contabilidade de custos: a seleção de provider por tier ([#4](https://github.com/soctalk/soctalk/issues/4)) roda o router mais leve num modelo mais barato que o verdict; uma sobreposição de preço ([#5](https://github.com/soctalk/soctalk/issues/5)) impede que um modelo auto-hospedado ou desconhecido seja cobrado a tarifas de fronteira; e a saída estruturada imposta ([#3](https://github.com/soctalk/soctalk/issues/3)) é o contrato que um modelo pequeno precisa manter para ser utilizável de todo, que é exatamente o que a coluna de schema errors acima mede.

## Como ler esses números

- **Orientativo, não estatístico.** O golden set tem 12 casos (3 routing, 6 verdict, 3 política determinística), então os números de acurácia apontam uma direção, não qualificam um modelo. Um benchmark representativo é o real portão de qualidade antes de confiar a um modelo pequeno qualquer decisão apertada.
- **Por nó, não por execução completa.** A eval cronometra cada nó como uma chamada, não uma investigação completa de múltiplos turnos, então os segundos de triage são por nó. Multiplique por cerca de 2 a 3 para uma execução completa.
- **Preços são um snapshot.** As tarifas de aluguel de GPU e serverless se movem, e foram lidas no momento da execução. Trate-as como uma razão entre opções, não uma cotação atual.
- **As operações variam por tier.** Pods de RTX 3090 tanto no community quanto no secure cloud repetidamente falharam em servir dentro de uma janela de 22 minutos, enquanto uma RTX 4090 no secure cloud subiu de forma confiável, então a placa de tier mais alto no secure cloud foi o caminho mais estável nessas execuções. Pods alugados não têm scale-to-zero, então a desmontagem é manual, e cada pod foi encerrado após cada execução.

## Resumo: os melhores setups custo-benefício

Se você quer a resposta curta, aqui está o que essas execuções apontam, por situação. Todo número vem das medições acima, então leia-o com as mesmas ressalvas: execuções únicas medidas, preços como snapshots, acurácia orientativa.

| Situação | O setup que mediu melhor aqui | Custo observado | O trade-off que você aceita |
|---|---|---|---|
| Volume estável, e você consegue operar uma GPU | Uma placa de consumo alugada (uma RTX 4090 no secure cloud subiu de forma confiável onde as 3090 não subiram), um modelo aberto de 7B em vLLM ou SGLang, concorrência de worker em 8 para encher o batch | cerca de $0.09 a $0.18 por 1.000 alertas, o conjunto de 12 alertas em cerca de 11 segundos | Você roda o ciclo de vida: arranques a frio, sem scale-to-zero, desmontagem manual |
| Volume em rajadas ou de baixa operação | Uma GPU serverless gerenciada que escala a zero, o mesmo 7B em SGLang, concorrência em 8 | cerca de $1.10 por 1.000 alertas | Uma tarifa por hora maior, mas zero custo ocioso e nada a operar; mantenha uma reserva quente para rajadas urgentes que cheguem durante um arranque a frio |
| Os casos mais difíceis, com operação mínima | Um modelo de fronteira capaz para o verdict com a Batch API e o prompt caching ligados, e o tier auto-hospedado barato para o miolo rotineiro | A tarifa de fronteira, mas em apenas uma fração dos alertas | O mais caro por chamada, em troca de nenhuma infraestrutura e um tier de modelo gerenciado mais capaz para os casos mais difíceis |
| O conteúdo dos alertas não pode sair do seu perímetro | Auto-hospedar o 7B dentro do cluster assim que o serving dentro do cluster chegar, com uma reserva capaz e o safety floor em pé | Não medido aqui; os números de auto-hospedagem alugada e serverless acima são proxies orientativos até o serving dentro do cluster aterrissar | Você é dono do serving; o deployment dentro do cluster ainda está sendo construído ([#13](https://github.com/soctalk/soctalk/issues/13)) |

A única escolha de configuração que fez mais trabalho em cada linha auto-hospedada foi a **concorrência de worker em 8**, que enche o batch contínuo e é de onde vieram os 13 a 17 por cento de custo e as seis a oito vezes de vazão. Combine-a com um modelo pequeno que mantém o contrato estruturado a zero schema errors, e uma placa que é mais barata por hora, e desmonte a GPU após cada execução. Todo o resto nesta página é uma variação disso.

Para a maioria dos times a sequência é a que o [guia de custo](/pt-br/guides/inference-cost-optimization) expõe: batching e cache primeiro, o router num modelo mais barato em seguida, e um tier auto-hospedado só quando o volume e a necessidade de residência de dados justificam operá-lo.

**Aviso legal.** A SocTalk não é afiliada, endossada nem patrocinada por nenhum provedor de serviços de LLM ou GPU, e as plataformas por trás dessas execuções são citadas no [guia de custo](/pt-br/guides/inference-cost-optimization) apenas como exemplos de onde um modelo pode rodar. Os números aqui são as nossas próprias observações de benchmark sobre um golden set fixo, não números publicados pelos fornecedores, e todos os nomes de produto e marcas pertencem aos seus respectivos donos.
