---
title: Quanto costa davvero l'inferenza di triage, misurato
description: "I run misurati dietro la guida ai costi: batching continuo su GPU serverless, vero silicio consumer RTX su un marketplace di noleggio, e tempo di triage realistico su golden alert con un piccolo modello self-hostabile. Throughput, dollari per mille, e secondi di triage, con il metodo e i limiti dichiarati."
---

# Quanto costa davvero l'inferenza di triage, misurato

La [guida ai costi](/it-it/guides/inference-cost-optimization) fa affermazioni su quanto costa l'inferenza di triage. Questa pagina è la misurazione dietro di esse: i nostri run di benchmark, le tabelle per intero, e il metodo e i limiti così potete giudicare fin dove arrivano al vostro setup. Ogni risultato qui è un singolo run misurato, non un risultato statistico e non una cifra di un vendor. Gli sweep di throughput usano richieste sintetiche a forma di triage, i prezzi sono snapshot letti al momento del run, e le cifre di tempo di triage e accuratezza usano un golden set fisso di 12 allerte. Il vostro modello, hardware e mix di allerte sposteranno tutto.

Sono state misurate tre cose, dal throughput sintetico fino al triage realistico: quanto un batch continuo pieno fa risparmiare su una GPU serverless, come il vero silicio consumer si confronta con le schede da datacenter che lo sostituiscono, e quanto tempo impiega davvero un triage reale su un piccolo modello self-hostabile. Ogni run ha smontato la sua GPU dopo, così nulla è rimasto a fatturare.

## Il batching continuo riempie la GPU

Un modello aperto è stato deployato per GPU e ha inviato un numero crescente di richieste identiche a forma di triage all'endpoint compatibile OpenAI di SGLang. Questo misura il lato backend di ciò che la concorrenza dei worker sblocca: man mano che la concorrenza client N sale, il batch continuo si riempie, il throughput aggregato cresce, e il costo per richiesta cala.

La piattaforma serverless non ha schede RTX consumer, quindi GPU da datacenter di fascia bassa fanno da proxy: A10G (Ampere 24GB) per RTX 3090, L4 (Ada 24GB) per una scheda di classe RTX 4090. Qwen3-14B richiede circa 28GB a bf16 e non entra in una scheda da 24GB con margine per il batch, quindi le schede da 24GB fanno girare DeepSeek-R1-Distill-Qwen-7B, che lascia spazio KV-cache per un batch più grande.

| GPU (proxy) | modello | N=1 tok/s | N=8 tok/s | accelerazione N=8 | $/1k req, da N=1 a N=8 |
|---|---|---|---|---|---|
| L40S (media, 48GB) | Qwen3-14B | 24.8 | 146.7 | 5.9x | 4.37 a 0.74 (giù 83%) |
| A10G (circa RTX 3090) | DS-R1-7B | 29.2 | 216.7 | 7.4x | 2.09 a 0.28 (giù 87%) |
| L4 (circa RTX 4090) | DS-R1-7B | 17.3 | 131.2 | 7.6x | 2.57 a 0.34 (giù 87%) |

Il seriale (N=1) lascia la GPU sottoutilizzata su ogni scheda. Riempire il batch a N=8 ha misurato un throughput aggregato di 5.9x-7.6x e un costo per richiesta al 13-17 per cento del caso seriale. Le schede da 24GB hanno mostrato un'accelerazione maggiore (7.4-7.6x) rispetto alla scheda media che fa girare il 14B (5.9x), perché il modello più piccolo lascia più spazio KV-cache per un batch più grande. Il tok/s assoluto più basso di L4 rispetto ad A10G è atteso, poiché L4 è una scheda di inferenza a basso TDP, quindi si legge come un floor conservativo per una vera RTX 4090. I fattori di scaling erano simili tra le schede, ed è questo il punto: è l'utilizzo, non la scheda, a guidare il risparmio.

## Vero silicio consumer, su un marketplace di noleggio

Un marketplace di noleggio GPU noleggia le schede consumer vere e proprie, quindi questo verifica l'hardware reale che i proxy serverless potevano solo sostituire. Stesso modello 7B, stesso sweep, GPU singola, pod terminato dopo.

Prezzi di noleggio dell'epoca, community tier, letti dall'API del marketplace: RTX 3090 $0.22/hr, RTX 4090 $0.34/hr, RTX 5090 $0.69/hr, contro l'A10G a $1.10/hr e la L4 a $0.80/hr della piattaforma serverless.

Misurato su una vera RTX 3090:

| N | tok/s (aggregato) | accelerazione | $/1k req |
|---|---|---|---|
| 1 | 45.8 | 1.00x | 0.267 |
| 4 | 179.0 | 3.91x | 0.068 |
| 8 | 352.2 | 7.69x | 0.035 |

L'accelerazione da batching ha tenuto sul silicio reale (7.69x a N=8, contro 7.42x sul proxy A10G e 7.58x sul proxy L4). La vera RTX 3090 è andata più veloce del proxy A10G (45.8 contro 29.2 tok/s a N=1, 352 contro 217 a N=8), perché l'A10G è una scheda ridotta. Il costo misurato è stato più basso sulla scheda noleggiata: $0.035 per 1k richieste a N=8 contro i $0.282 dell'A10G, circa 8x più basso in questo run, grazie a una scheda più economica ($0.22 contro $1.10/hr) e a un throughput più alto, senza acquisto anticipato di GPU. Il percorso a pod ha un avvio a freddo lento (pull dell'immagine più download del modello), quindi è girato disaccoppiato: creare, fare polling finché pronto, sweep, terminare.

## Tempo di triage realistico, e se un modello piccolo regge

Gli sweep qui sopra hanno misurato il throughput sintetico di token. Questo misura il triage realistico: l'eval di triage di SocTalk eseguito su 12 golden alert a concorrenza 8, cronometrando i nodi router e verdict reali su payload reali.

DeepSeek-R1-Distill-Qwen-7B, 12 golden alert, N=8:

| Provider / GPU | serving | tempo totale | verdict | routing | schema errors |
|---|---|---|---|---|---|
| A10G serverless | SGLang | 43.2 s | 5/6 | 2/3 | 0 |
| RTX 4090 noleggiata (secure) | vLLM | 11.3 s | 6/6 | 2/3 | 0 |

Stock contro distillato, entrambi sulla RTX 4090 noleggiata (secure), N=8:

| Modello | tempo totale | verdict | routing | schema errors |
|---|---|---|---|---|
| DeepSeek-R1-Distill-Qwen-7B | 11.3 s | 6/6 | 2/3 | 0 |
| Qwen2.5-7B-Instruct (stock) | 16.7 s | 6/6 | 1/3 | 0 |

Il golden triage realistico a N=8 ha completato l'insieme di 12 allerte in 11-43 secondi in questi run, sotto il minuto. Il 7B ha prodotto zero errori di schema e punteggi verdict da 5/6 a 6/6, quindi un piccolo modello self-hostabile ha prodotto qui output di triage strutturato valido. Anche Qwen2.5-7B-Instruct stock ha funzionato (output strutturato valido, zero errori di schema, lo stesso punteggio verdict del distill) ed è rimasto indietro di un caso sul routing rispetto al distill, un campione di routing troppo piccolo per leggerlo con forza.

Costo per triage realistico, misurato per nodo (un run agentico completo è qualche chiamata, quindi moltiplicate per circa 2-3): l'A10G serverless a $1.10/hr è circa $1.10 per 1,000 allerte; la RTX 4090 secure noleggiata a $0.69/hr è circa $0.18 per 1,000, e community a $0.34/hr circa $0.09 per 1,000.

## Le capacità dietro questi numeri

I risparmi qui sopra non sono incidentali. Vengono da un piccolo stack di capacità di inferenza, ognuna tracciata in modo aperto, che insieme permettono a un run di triage di puntare a un backend di frontiera o self-hosted e di pagarlo alla tariffa più bassa difendibile. Alcune sono già in piedi oggi e alcune sono ancora in costruzione; i link alle issue mostrano a che punto è ciascuna.

- **Un substrato di richiesta uniforme** ([#32](https://github.com/soctalk/soctalk/issues/32)). Ogni run di triage è espresso come un `InferenceRequest`, risolto a un tier, con budgeting per token, sia che finisca su un'API di frontiera sia su una GPU self-hosted. Nulla a valle deve sapere quale backend ha colpito.
- **Un'astrazione di consegna** ([#63](https://github.com/soctalk/soctalk/issues/63)). Ogni backend è classificato per come viene consegnato e fatturato, un'API di frontiera a caldo, una GPU serverless che scala a zero, una GPU noleggiata sempre accesa, o un'istanza locale, così il substrato seleziona il driver giusto e distingue un backend a GPU-secondo da uno a token, invece di trattare ogni backend come un'API a caldo misurata a token. La prontezza serverless e lo scheduling che questa classificazione abilita sono il prossimo tier di lavoro ([#64](https://github.com/soctalk/soctalk/issues/64)).
- **Concorrenza dei worker che riempie il batch** ([#61](https://github.com/soctalk/soctalk/issues/61)). Diverse investigazioni girano in una volta, così più richieste sono in volo verso il backend e il batch continuo si riempie. È da quel batch pieno che vengono gli aumenti di throughput e i cali di costo di questa pagina.
- **Allineamento serverless** ([#64](https://github.com/soctalk/soctalk/issues/64), in corso). La tolleranza agli avvii a freddo, lo scheduling a rilascio a raffica, e un driver di job asincroni sono progettati per permettere di consumare una GPU che scala a zero senza perdere run a causa di un worker a freddo, così l'economia dello scale-to-zero diventa utilizzabile in produzione, non solo in un benchmark. Il benchmarking ha colpito esattamente questa lacuna, worker RunPod a freddo che restituivano un proxy 404 durante lo spin-up.
- **Serving self-hosted di prima classe** ([#13](https://github.com/soctalk/soctalk/issues/13), in corso). Far girare il modello dentro il vostro cluster è il deployment che tiene il contenuto delle allerte nel vostro perimetro, ed è il target in-cluster previsto per l'astrazione di consegna qui sopra.
- **Una suite di benchmarking e qualificazione** ([#33](https://github.com/soctalk/soctalk/issues/33)). Le prove su questa pagina sono prodotte da una suite a due assi che separa la qualità del modello dalla viabilità di serving, così un piccolo modello aperto è verificato contro il contratto di triage strutturato prima di affidargli qualsiasi decisione.

Sotto sta la spina dorsale della contabilità dei costi: la selezione del provider per tier ([#4](https://github.com/soctalk/soctalk/issues/4)) fa girare il router più leggero su un modello più economico del verdict; un overlay di prezzo ([#5](https://github.com/soctalk/soctalk/issues/5)) impedisce che un modello self-hosted o sconosciuto venga fatturato a tariffe di frontiera; e l'output strutturato imposto ([#3](https://github.com/soctalk/soctalk/issues/3)) è il contratto che un modello piccolo deve mantenere per essere utilizzabile del tutto, che è esattamente ciò che la colonna schema errors qui sopra misura.

## Come leggere questi numeri

- **Indicativo, non statistico.** Il golden set è di 12 casi (3 routing, 6 verdict, 3 di policy deterministica), quindi le cifre di accuratezza indicano una direzione, non qualificano un modello. Un benchmark rappresentativo è il vero gate di qualità prima di affidare a un modello piccolo qualsiasi decisione al limite.
- **Per nodo, non per run completo.** L'eval cronometra ogni nodo come una chiamata, non un'investigazione multi-turno completa, quindi i secondi di triage sono per nodo. Moltiplicate per circa 2-3 per un run completo.
- **I prezzi sono uno snapshot.** Le tariffe di noleggio GPU e serverless si muovono, ed erano lette al momento del run. Trattatele come un rapporto tra opzioni, non come una quotazione attuale.
- **Le operazioni variano per tier.** I pod RTX 3090 sia su community sia su secure cloud hanno ripetutamente fallito nel servire entro una finestra di 22 minuti, mentre una RTX 4090 su secure cloud si è avviata in modo affidabile, quindi la scheda di tier superiore su secure cloud è stata il percorso più stabile in questi run. I pod noleggiati non hanno scale-to-zero, quindi lo smontaggio è manuale, e ogni pod è stato terminato dopo ogni run.

## In conclusione: i migliori setup costo-valore

Se volete la risposta breve, ecco a cosa puntano questi run, per situazione. Ogni cifra viene dalle misurazioni qui sopra, quindi leggetela con le stesse avvertenze: singoli run misurati, prezzi come snapshot, accuratezza indicativa.

| Situazione | Il setup che ha misurato meglio qui | Costo osservato | Il compromesso che accettate |
|---|---|---|---|
| Volume stabile, e potete gestire una GPU | Una scheda consumer noleggiata (una RTX 4090 su secure cloud si è avviata in modo affidabile dove le 3090 no), un modello aperto 7B su vLLM o SGLang, concorrenza dei worker a 8 per riempire il batch | circa $0.09-$0.18 per 1,000 allerte, l'insieme di 12 allerte in circa 11 secondi | Gestite voi il ciclo di vita: avvii a freddo, niente scale-to-zero, smontaggio manuale |
| Volume a raffiche o a bassa operatività | Una GPU serverless gestita che scala a zero, lo stesso 7B su SGLang, concorrenza a 8 | circa $1.10 per 1,000 allerte | Una tariffa oraria più alta, ma costo a riposo zero e nulla da gestire; tenete un fallback a caldo per le raffiche urgenti che arrivano durante un avvio a freddo |
| I casi più difficili, con operatività minima | Un modello di frontiera capace per il verdict con la Batch API e il prompt caching attivi, e il tier self-hosted economico per la fascia ordinaria di mezzo | La tariffa di frontiera, ma solo su una frazione delle allerte | Il più costoso per chiamata, in cambio di nessuna infrastruttura e di un tier di modello gestito più capace per i casi più difficili |
| Il contenuto delle allerte non può lasciare il vostro perimetro | Fate self-hosting del 7B in-cluster una volta che il serving in-cluster arriverà, con un fallback capace e il safety floor in posizione | Non misurato qui; le cifre self-host noleggiate e serverless qui sopra sono proxy indicativi finché il serving in-cluster non atterra | Possedete voi il serving; il deployment in-cluster è ancora in costruzione ([#13](https://github.com/soctalk/soctalk/issues/13)) |

La singola scelta di configurazione che ha fatto più lavoro in ogni riga self-hosted è stata la **concorrenza dei worker a 8**, che riempie il batch continuo ed è da dove vengono il costo al 13-17 per cento e il throughput da sei a otto volte. Abbinatela a un modello piccolo che mantiene il contratto strutturato a zero errori di schema, e a una scheda più economica all'ora, e smontate la GPU dopo ogni run. Tutto il resto su questa pagina è una variazione di questo.

Per la maggior parte dei team la sequenza è quella che la [guida ai costi](/it-it/guides/inference-cost-optimization) espone: batching e cache prima, il router su un modello più economico poi, e un tier self-hosted solo quando il volume e la necessità di residenza dei dati giustificano il gestirlo.

**Disclaimer.** SocTalk non è affiliata, approvata né sponsorizzata da alcun fornitore di servizi LLM o GPU, e le piattaforme dietro questi run sono nominate nella [guida ai costi](/it-it/guides/inference-cost-optimization) solo come esempi di dove un modello può girare. Le cifre qui sono nostre osservazioni di benchmark su un golden set fisso, non numeri pubblicati dai fornitori, e tutti i nomi di prodotto e i marchi appartengono ai rispettivi proprietari.
