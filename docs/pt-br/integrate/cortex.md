# Cortex

O [Cortex](https://thehive-project.org/) fornece análise de observáveis (reputação, detonação em sandbox, whois, etc.) por meio de seus plugins "analyzer". O nó [`cortex_worker`](/pt-br/ai-pipeline) do SocTalk envia observáveis através do Cortex durante o enriquecimento.

## Modelo de hospedagem

O chart `soctalk-tenant` na V1 não tem um subchart do Cortex (`dependencies: []`). As opções são:

- **Cortex gerenciado pelo cliente** — o cliente executa o seu próprio; o MSSP fornece URL + chave de API.
- **Sem Cortex** — o pipeline de AI ainda tenta a rota `ENRICH` (o supervisor não sabe que o Cortex está ausente); cada invocação do `cortex_worker` falha e a falha é registrada em log. Não há campo de status por observável na V1; o worker simplesmente retorna sem enriquecimento e o supervisor segue adiante.

Um "subchart do Cortex incluído" foi descrito em rascunhos anteriores como uma opção planejada, mas **não está implementado nesta versão**.

## Configurar (UI do MSSP)

Detalhe do tenant → Settings → Cortex.

| Campo | Notas |
|---|---|
| Enable | Desligado por padrão |
| URL | `https://cortex.<customer>.example` para gerenciado pelo cliente; `http://cortex.tenant-<slug>.svc:9001` para incluído |
| API key | Chave de API do Cortex do cliente com `analyze:any` |
| Verify TLS | Ligado por padrão |
| Default TLP | Padrão `2` (Amber). Usado quando o SocTalk submete observáveis que não carregam um TLP |

**Não há API para alterar as configurações de integração do Cortex na V1.** As chamadas ao Cortex residem no **runs-worker por tenant**, não no pod da API central, portanto variáveis de ambiente em `soctalk-system-api` não têm efeito. Para configurar o Cortex na V1, defina as variáveis de ambiente no Deployment `soctalk-runs-worker` do tenant, no namespace `tenant-<slug>` (`helm upgrade` do chart do tenant, ou `kubectl set env` + `rollout restart`). Faça a rotação da chave de API aplicando patch no Secret do namespace do tenant e reiniciando o runs-worker. Uma superfície de configuração limpa e orientada por API está no roadmap.

## Seleção de analyzer

Para cada observável, o worker tenta o **primeiro nome de analyzer** em um `ANALYZER_MAP` codificado de forma fixa (em [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) para o tipo do observável — sem verificar se aquele analyzer está de fato instalado na instância do Cortex. Se o analyzer não estiver instalado (ou falhar), a falha é registrada em log e o worker retorna sem o enriquecimento. Não há fallback para um segundo analyzer na V1; instale o analyzer canônico nomeado em `ANALYZER_MAP` para cada tipo de observável que lhe interessa. Expor a ordem de preferência de analyzers como um valor do chart está no roadmap.

## Custo

O Cortex em si é gratuito; os provedores de analyzer cobram por consultas. O SocTalk não mede as chamadas ao Cortex diretamente — meça-as no provedor:

- VirusTotal: cota por chave
- AbuseIPDB: cota por chave
- Hybrid Analysis: cota por chave

A vazão de observáveis por tenant é visível via `soctalk_tenant_events_ingested_total` (cada evento ingerido dispara cerca de 1 a 5 extrações de observáveis) em [Observabilidade](/pt-br/observability#per-tenant-counters-defined-surface).

## Comportamento do worker

O nó `cortex_worker` tem um `ANALYZER_MAP` codificado de forma fixa (em [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) que mapeia cada tipo de observável para uma pequena lista de nomes de analyzer. Para cada observável, o worker submete ao **primeiro** analyzer daquela lista sem verificar a disponibilidade; se aquele analyzer não estiver instalado ou falhar, o enriquecimento do observável é registrado como falho.

Sequência:

1. Lê a lista atual de observáveis do caso a partir do estado.
2. Para cada observável, consulta a lista de analyzers em `ANALYZER_MAP` para o seu tipo.
3. Submete ao primeiro analyzer mapeado via endpoint `/api/observable` do Cortex.
4. Faz polling em `/api/job/{id}/report` até o job terminar ou disparar um timeout por job.
5. Anexa o veredito (`safe`, `info`, `suspicious`, `malicious`) e o corpo do relatório ao estado do caso. Jobs que falham registram o erro em log e continuam.

Chamadas ao Cortex que falham não fazem a execução falhar — o worker registra a falha em log e retorna ao supervisor sem enriquecimento para aquele observável. O nó de veredito raciocina sobre qualquer contexto que esteja disponível.

## Cortex incluído: não nesta versão

O chart `soctalk-tenant` não inclui o Cortex como um subchart. Execute o Cortex você mesmo (gerenciado pelo cliente) se quiser enriquecimento por analyzer. O Cortex gerenciado pelo SocTalk está no roadmap.

## Rotacionar a chave de API

1. Gere uma nova chave no Cortex com `analyze:any`.
2. Aplique patch no Secret do namespace do tenant que contém as credenciais do Cortex e reinicie o runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revogue a chave antiga no Cortex.

## O que não está aqui

- Desenvolvimento de analyzer customizado — fora de escopo; veja [TheHive-Project/Cortex-Analyzers](https://github.com/TheHive-Project/Cortex-Analyzers).
- Overrides de TLP/PAP por observável — planejado; hoje o padrão do tenant se aplica a toda submissão.

## Ponteiros de código-fonte

| Conceito | Arquivo |
|---|---|
| Nó do worker + ANALYZER_MAP | [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py) |
| Schema de configurações | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
