# TheHive

O [TheHive](https://thehive-project.org/) é opcional (opt-in). Quando configurado por tenant, o SocTalk exporta encerramentos com disposição `escalate` como casos do TheHive. O histórico da investigação (observáveis, justificativa de AI, decisão de revisão humana) torna-se o primeiro conjunto de observáveis e a linha do tempo do caso.

Para o modelo mental, consulte [Pipeline de AI → Encerramento](/pt-br/ai-pipeline). Para desativar um tenant com o TheHive habilitado, consulte [Ciclo de vida do tenant → Desativação](/pt-br/tenant-lifecycle#decommission-vs-purge).

## Modelo de hospedagem

No V1, o chart `soctalk-tenant` não possui um subchart do TheHive (`dependencies: []`). As opções são:

- **TheHive gerenciado pelo cliente**: o cliente executa seu próprio TheHive em outro lugar; o MSSP fornece a URL e uma chave de API por tenant.
- **Sem TheHive**: as escalações permanecem apenas na UI do SocTalk. Padrão.

Um caminho de "subchart do TheHive incorporado" foi descrito em rascunhos anteriores desta página como uma opção planejada, mas **não está implementado nesta versão**. Não há StatefulSet do Cassandra nem Deployment do TheHive gerenciados pelo SocTalk para o tenant.

## Configurar (UI do MSSP)

Detalhe do tenant → Settings → TheHive. Campos:

| Campo | Notas |
|---|---|
| Enable | Desativado por padrão |
| URL | `https://thehive.<customer>.example` para gerenciado pelo cliente; `http://thehive.tenant-<slug>.svc:9000` para incorporado |
| Organisation | Slug da organização no TheHive (instâncias multi-tenant do TheHive) |
| API key | Chave de API do TheHive do cliente com `case:create`, `observable:create`, `task:create` |
| Verify TLS | Ativado por padrão; desative para um TheHive de desenvolvimento com certificado autoassinado |

**Não há API para alterar as configurações de integração do TheHive no V1.** A chamada ao TheHive reside no **runs-worker por tenant** (que mantém os bindings de MCP), não no pod da API central, portanto definir as variáveis de ambiente `THEHIVE_*` no `soctalk-system-api` não tem efeito sobre o worker. Para configurar o TheHive no V1, defina as variáveis de ambiente no Deployment `soctalk-runs-worker` do tenant, no namespace `tenant-<slug>` (e re-renderize via `helm upgrade` do chart do tenant, ou `kubectl set env` seguido de `rollout restart`). Uma superfície de configuração limpa via API está no roadmap.

## O que é exportado

No V1, a exportação para o TheHive acontece **de forma síncrona no momento do nó do grafo**, por meio do nó `thehive_worker` que chama a API do TheHive através de MCP. Hoje isso cria o caso (título + severidade espelhados a partir do verdict do SocTalk) e os observáveis. A superfície mais rica, tarefas derivadas de `next_actions`, espelhamento na linha do tempo das justificativas dos workers / decisões de revisão humana, **outbox assíncrono + retry**: é descrita em rascunhos anteriores como o alvo de design, mas **não está implementada nesta versão**. Se o TheHive estiver inacessível, o nó do worker registra a falha e o caso prossegue no SocTalk sem uma contraparte exportada. Não há loop de retry, não há outbox, não há campo persistido de "último erro" e não há superfície de dashboard para exportações que falharam, as falhas são visíveis apenas nos logs estruturados do orquestrador.

Mapeamento de tipos de observável (conforme a implementação do V1):

| Tipo no SocTalk | `dataType` no TheHive |
|---|---|
| `ip` | `ip` |
| `fqdn` | `fqdn` |
| `url` | `url` |
| `hash_md5`, `hash_sha1`, `hash_sha256` | `hash` |
| `email` | `mail` |
| `filename` | `filename` |
| `user` | `other` (com `tags: user`) |
| `process` | `other` (com `tags: process`) |
| `registry_key` | `registry` |

## TheHive incorporado: não nesta versão

O chart `soctalk-tenant` no V1 não incorpora o TheHive como subchart, o `Chart.yaml` lista `dependencies: []`. Operadores que desejam uma instância do TheHive por tenant a executam por conta própria (`helm install` manual no namespace do tenant, ou gerenciada pelo cliente em outro lugar). Um subchart incorporado com segredos de admin gerenciados pelo chart é descrito em rascunhos anteriores como o alvo de design, mas está no roadmap.

## TheHive gerenciado pelo cliente: notas

- O TheHive do cliente deve estar acessível a partir do control plane do SocTalk (egress para a URL do TheHive do cliente).
- O cliente cria a chave de API com os escopos mínimos listados acima. O SocTalk não precisa de escopo de admin.
- Se o TheHive do cliente impõe allowlists de IP de origem, adicione o IP de NAT de egress do control plane do SocTalk à allowlist.

## Status / integridade

Nesta versão **não há loop de health-ping em segundo plano** para o TheHive, o SocTalk só toca o TheHive quando uma investigação tem algo a exportar. Falhas durante essa chamada são registradas apenas na saída estruturada do orquestrador; não há campo de erro persistido e não há retry baseado em outbox. A UI do MSSP não exibe um indicador separado de "TheHive acessível".

Para monitorar a integridade do TheHive, use sua sonda externa habitual (Prometheus blackbox exporter contra o `/api/status` do TheHive, etc.), isso é responsabilidade do lado do MSSP, não faz parte do SocTalk nesta versão.

## Rotacionar a chave de API

1. No TheHive do cliente, gere uma nova chave de API com os mesmos escopos.
2. Aplique um patch no Secret do namespace do tenant que mantém as credenciais do TheHive e reinicie o runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revogue a chave antiga no TheHive.

Um caminho de recarga em tempo real (observar o arquivo do Secret montado) está planejado.

## Ponteiros de código-fonte

| Conceito | Arquivo |
|---|---|
| Worker / exportação do TheHive | [`src/soctalk/workers/thehive.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/thehive.py) |
| Schema de configurações | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
| Bridge de ferramentas MCP | [`src/soctalk/chat/mcp_tools.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/chat/mcp_tools.py) |
