---
description: "Conecte a triagem com AI do SocTalk a um Wazuh que você já opera: instale a partir do pacote de SO, faça o onboarding de um tenant com perfil provided e veja o primeiro alerta virar um caso triado e escalado."
---

# Conectando o SocTalk a um Wazuh existente

A maioria das operações Wazuh não começa do zero. Já existe um manager acompanhando agentes, um indexer guardando meses de alertas e um dashboard a partir do qual o time já investiga. O perfil de tenant `provided` do SocTalk foi feito exatamente para essa situação: o SocTalk instala apenas os próprios componentes, conecta-se ao seu Wazuh pela rede e começa a triar os alertas que o seu deployment já produz. Nada muda no seu Wazuh, nenhum agente se registra de novo e nenhum dado é migrado.

Este guia percorre o caminho completo em um único host Linux, do pacote de SO até a primeira escalada triada por AI, e foi verificado de ponta a ponta com o SocTalk v0.2.0 e o Wazuh 4.12.0. Onde esta versão tem arestas, o guia avisa e apresenta o workaround.

Se você prefere que o SocTalk implante e gerencie o Wazuh por você, esse é o perfil `poc` ou `persistent`; veja [Onboarding de um tenant de cliente](/pt-br/guides/wazuh-tenant-onboarding).

## O que você precisa antes de começar

Seu Wazuh existente precisa estar acessível a partir do host do SocTalk em duas portas: a API OpenSearch do indexer (`:9200`) e a REST API do manager (`:55000`). O SocTalk se autentica em cada uma separadamente, então tenha os dois pares de credenciais em mãos:

- um usuário do indexer com permissão de busca em `wazuh-alerts-*` (o `admin` embutido funciona, embora um usuário somente leitura seja a prática recomendada),
- um usuário da API do manager, como o `wazuh-wui` embutido.

Certificados autoassinados do lado do Wazuh são a norma e são suportados; você passará `verify_ssl: false` no momento do onboarding. Você também precisa de uma chave de API de LLM por tenant. O perfil `provided` a exige no onboarding, porque um tenant que traz o próprio SIEM não tem fallback compartilhado da instalação: a requisição de onboarding é rejeitada com um 422 se a chave estiver faltando.

O host do SocTalk em si precisa do footprint usual: um Linux com systemd (Ubuntu 24.04 e Rocky 9 são o par verificado), 4 vCPU e 8 GB de RAM como piso para o control plane mais um tenant provided, e as portas 80/443/6443 livres. Como o tenant não roda um Wazuh próprio, um tenant provided é bem mais leve que um `persistent`.

## Instale o SocTalk a partir do pacote de SO

Baixe o pacote da sua distro na [página de releases](https://github.com/soctalk/soctalk/releases) e instale; a matriz completa de variantes está em [Instalação a partir de um pacote de SO](/pt-br/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

O pacote traz um template de ambiente em `/etc/soctalk/soctalk.env.example`. Copie-o, preencha sua identidade de MSSP, as credenciais de admin, o hostname e a chave de LLM, e mantenha o arquivo acessível apenas pelo root:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Depois execute o instalador de forma não assistida:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Passe `--skip-consent` (ou `-y`) explicitamente. Na v0.2.0 o prompt de consentimento ainda dispara em um terminal não interativo mesmo com todas as variáveis `SOCTALK_*` definidas, e sem um TTY a instalação aborta com `/dev/tty: No such device or address`.

O instalador sobe o k3s e o Helm se o host não os tiver, instala o chart `soctalk-system` fixado na versão do release e imprime a URL e o login ao terminar. Três pods no namespace `soctalk-system` (`api`, `app-ui`, `postgres`) significam que o control plane está no ar:

```bash
sudo k3s kubectl -n soctalk-system get pods
```

## Um ajuste antes do onboarding: políticas de rede

Aqui está a aresta afiada da v0.2.0, adiantada para você não esbarrar nela no meio do onboarding: um tenant `provided` renderiza uma política de egress FQDN do Cilium para os hosts do SIEM externo, mas o k3s que o `soctalk install` configura roda flannel, que não tem os CRDs do Cilium. Provisionar um tenant provided em uma instalação padrão da v0.2.0 falha, portanto, na etapa do Helm com

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

e o tenant cai em `degraded`. Isso foi corrigido depois da v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): o chart agora condiciona esse objeto à existência real do CRD e adiciona egress via `NetworkPolicy` comum para hosts de SIEM identificados por IP literal, de modo que uma instalação padrão com flannel provisiona sem problemas. Na v0.2.0, o workaround em uma instalação de host único é desabilitar as políticas de rede de tenant antes do onboarding:

```bash
sudo k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Seja claro sobre o tradeoff: isso desliga as NetworkPolicies de isolamento de namespace para os tenants provisionados dali em diante, o que é aceitável em um host dedicado de lab ou piloto de classe de tenant único e não é o que você quer em um cluster de produção multi-tenant compartilhado. Se você roda Cilium como CNI, nada disso se aplica e as políticas devem permanecer ligadas.

Se você já fez o onboarding e o tenant está em `degraded` com o erro acima, aplique o ajuste e clique em **Retry Provisioning** na página do tenant; retries são idempotentes e retomam sem problemas.

Mais uma coisa específica de um lab em uma única caixa, onde o Wazuh "existente" muitas vezes roda em Docker no mesmíssimo host em que você instalou o SocTalk, alcançado pelo IP do próprio host. O k3s impõe as NetworkPolicy pelo controller embutido, e um pod alcançando o próprio IP do node para uma porta publicada pelo Docker é um hairpin que a camada de política não roteia de forma limpa, mesmo quando uma regra de egress permite. O sintoma é o adaptador registrando `ingest_failed: All connection attempts failed` enquanto o mesmo Wazuh responde normalmente a partir do host. Desabilitar as políticas de rede de tenant como acima resolve. Um Wazuh em um host separado é um caminho de saída comum e não esbarra nisso.

## Faça o onboarding do tenant

Na UI do MSSP, Tenants, depois **+ New Tenant**, escolha o perfil `provided` e o assistente pede o material de conexão externa. A mesma operação pela API é um único POST no endpoint de onboarding. Atenção ao path: `POST /api/mssp/tenants/onboard` é o endpoint do assistente, que entende perfis e material de SIEM externo. O simples `POST /api/mssp/tenants` é um create apenas de identidade que ignora silenciosamente esses campos, deixando você com um tenant `poc` que nunca provisiona.

```bash
# authenticate once; the cookie jar carries the MSSP session
curl -sk -c cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/auth/login" \
  -d '{"email": "<admin-email>", "password": "<admin-password>"}'

curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X POST "https://<your-host>/api/mssp/tenants/onboard" -d '{
  "slug": "orion-soc",
  "display_name": "Orion Labs",
  "profile": "provided",
  "llm_provider": "anthropic",
  "llm_base_url": "https://api.anthropic.com",
  "llm_model": "claude-sonnet-4-6",
  "llm_api_key": "sk-ant-...",
  "external_siem": {
    "indexer_url": "https://198.51.100.20:9200",
    "indexer_username": "admin",
    "indexer_password": "...",
    "api_url": "https://198.51.100.20:55000",
    "api_username": "wazuh-wui",
    "api_password": "...",
    "verify_ssl": false
  }
}'
```

Um 202 com `"profile": "provided"` no corpo confirma o caminho certo. Escolha o slug com cuidado: slugs permanecem reservados por tenants arquivados, então um tenant de teste descomissionado não libera o nome para reuso.

O provisionamento de um tenant provided é rápido porque não há chart do Wazuh a instalar; o controller pula essa fase e registra um evento de ciclo de vida `wazuh_skipped_provided` no lugar. Na execução verificada, o tenant foi de `pending` a `active` em menos de vinte segundos.

## Verifique a conexão

O namespace do tenant deve conter exatamente dois workloads, o adaptador e o runs-worker, e nenhum pod do Wazuh:

```bash
sudo k3s kubectl -n tenant-orion-soc get pods
```

Seu material de conexão vai parar em um Secret local ao namespace chamado `tenant-external-siem-creds`, contendo `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` e `WAZUH_API_PASSWORD`, além de `WAZUH_API_TOKEN` quando você fornece um. O adaptador lê a URL do indexer do próprio ambiente e as credenciais desse Secret. O log dele mostra em segundos se a conexão funciona, porque ele consulta o índice de alertas continuamente:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

Um 401 aqui significa credenciais de indexer erradas; um erro de TLS significa que `verify_ssl` não bate com a sua situação de certificados; um timeout significa que o host do SocTalk não alcança a porta do indexer.

Credenciais rotacionam sem novo onboarding. `PATCH /api/mssp/tenants/{id}/external-siem` aceita qualquer subconjunto dos campos de onboarding, reescreve o Secret e reinicia o pod do adaptador para que ele capture o material novo:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## O primeiro alerta triado

Daqui em diante o pipeline se comporta exatamente como em um Wazuh gerenciado pelo SocTalk: o adaptador encaminha os alertas novos na severidade mínima ou acima (rule level 10 por padrão, configurável com `SOCTALK_ADAPTER_MIN_SEVERITY`), o control plane promove o que importa a investigações, e o runs-worker do tenant executa a triagem com AI usando a chave de LLM do próprio tenant.

A forma honesta de testar é fazer o seu Wazuh existente produzir um alerta real de alta severidade, por exemplo uma rajada de logins SSH falhos contra um agente monitorado seguida de um sucesso. Se você prefere não tocar em endpoints de produção, indexar um documento de alerta sintético diretamente em `wazuh-alerts-4.x-<date>` com `rule.level` 12 exercita o caminho idêntico, já que o adaptador lê do índice e não do manager.

Na execução verificada, um alerta de brute force de SSH seguido de sucesso foi do documento no indexer à triagem concluída em cerca de um minuto: encaminhado pelo adaptador, promovido, investigado pelo supervisor ao longo de várias chamadas de LLM e fechado como `escalate` com confiança de 0,95, caindo na [fila de revisão do MSSP](/pt-br/mssp-ui#reviews-human-in-the-loop) para um humano. O gasto total da execução foi de cerca de trinta centavos de dólar contra a chave Anthropic do tenant, contabilizado no orçamento de tokens por execução descrito em [Pipeline de AI](/pt-br/ai-pipeline).

## Limitações atuais

Ambas as ressalvas abaixo foram verificadas na v0.2.0 e estão corrigidas no release seguinte, então em um build mais novo você pode pular os workarounds. Consulte as notas de release da sua versão.

- **Enriquecimento alcançando o Wazuh externo (apenas v0.2.0).** Na v0.2.0 o ferramental Wazuh MCP do runs-worker não estava conectado à API do manager de um tenant provided, então a triagem rodava só com o payload do alerta, sem pivôs ao vivo para o estado do agente ou o histórico de logs. Corrigido depois da v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): o worker agora conecta o servidor MCP `mcp-server-wazuh` embutido ao Wazuh do próprio tenant, de modo que o grafo de triagem consulta agentes, processos, portas, vulnerabilidades e logs do manager durante uma investigação, do mesmo jeito que um tenant gerenciado pelo SocTalk faz.
- **Provisionamento em uma instalação padrão com flannel (apenas v0.2.0).** O problema da política de egress do Cilium descrito antes, com seu workaround de política de rede. Corrigido depois da v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
