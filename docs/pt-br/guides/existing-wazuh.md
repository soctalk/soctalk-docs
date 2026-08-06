---
description: "Conecte a triagem por AI do SocTalk a um Wazuh que você já opera: instale a partir do pacote do sistema operacional, faça o onboarding de um tenant com perfil provided e acompanhe o primeiro alerta virar um caso triado e escalado."
---

# Conectando o SocTalk a um Wazuh existente

A maioria das operações Wazuh não começa do zero. Já existe um manager observando os agentes, um indexer guardando meses de alertas e um dashboard de onde o time já investiga. O perfil de tenant `provided` do SocTalk foi feito exatamente para essa situação: o SocTalk instala apenas os próprios componentes, conecta-se ao seu Wazuh pela rede e passa a triar os alertas que a sua implantação já produz. Nada muda no seu Wazuh, nenhum agente se reinscreve e nenhum dado é migrado.

Este guia percorre o caminho completo em um único host Linux, do pacote do sistema operacional à primeira escalada triada por AI, e foi verificado de ponta a ponta contra o SocTalk v0.2.0 com o Wazuh 4.12.0. Onde esta versão tem arestas, o guia avisa e apresenta a solução de contorno.

Se, em vez disso, você quer que o SocTalk implante e gerencie o Wazuh para você, esse é o perfil `poc` ou `persistent`; veja [Onboarding de um tenant de cliente](/pt-br/guides/wazuh-tenant-onboarding).

## O que você precisa antes de começar

Seu Wazuh existente precisa estar acessível a partir do host do SocTalk em duas portas: a API OpenSearch do indexer (`:9200`) e a REST API do manager (`:55000`). O SocTalk se autentica em cada uma separadamente, então tenha os dois pares de credenciais prontos:

- um usuário do indexer autorizado a buscar em `wazuh-alerts-*` (o `admin` embutido funciona, embora um usuário somente leitura seja a prática melhor),
- um usuário da API do manager como o `wazuh-wui` embutido.

Certificados autoassinados no lado do Wazuh são a norma e são suportados; você passará `verify_ssl: false` no momento do onboarding. Você também precisa de uma chave de API de LLM por tenant. O perfil `provided` a exige no onboarding, porque um tenant que traz o próprio SIEM não tem o fallback compartilhado da instalação: a requisição de onboarding é rejeitada com um 422 se a chave estiver faltando.

O próprio host do SocTalk precisa do footprint usual: um Linux baseado em systemd (Ubuntu 24.04 e Rocky 9 são o par verificado), 4 vCPU e 8 GB de RAM como piso para o control plane mais um tenant provided, e as portas 80/443/6443 livres. Como o tenant não roda nenhum Wazuh próprio, um tenant provided é bem mais leve do que um `persistent`.

## Instale o SocTalk a partir do pacote do sistema operacional

Baixe o pacote da sua distro na [página de releases](https://github.com/soctalk/soctalk/releases) e instale-o; a matriz completa de flavors está em [Instalar a partir de um pacote do sistema operacional](/pt-br/os-packages).

```bash
curl -LO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt-get install -y ./soctalk_0.2.0_amd64.deb
```

O pacote traz um template de ambiente em `/etc/soctalk/soctalk.env.example`. Copie-o, preencha a identidade do seu MSSP, as credenciais de admin, o hostname e a chave de LLM, e mantenha-o acessível apenas ao root:

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudo chmod 600 /etc/soctalk/soctalk.env
sudo vi /etc/soctalk/soctalk.env
```

Depois rode o instalador de forma não interativa:

```bash
sudo bash -c 'set -a; . /etc/soctalk/soctalk.env; soctalk install --skip-consent'
```

Passe `--skip-consent` (ou `-y`) explicitamente. Na v0.2.0 o prompt de consentimento ainda dispara em um terminal não interativo mesmo quando todas as variáveis `SOCTALK_*` estão definidas, e sem um TTY a instalação aborta com `/dev/tty: No such device or address`.

O instalador sobe o k3s e o Helm se o host não os tiver, instala o chart `soctalk-system` fixado na versão do release e imprime a URL e o login ao terminar. Três pods no namespace `soctalk-system` (`api`, `app-ui`, `postgres`) indicam que o control plane está de pé:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

## Um ajuste antes do onboarding: políticas de rede

Aqui está a aresta afiada da v0.2.0, colocada logo de início para você não esbarrar nela no meio do onboarding: um tenant `provided` renderiza uma política de egress FQDN do Cilium para os hosts SIEM externos, mas o k3s que o `soctalk install` configura roda flannel, que não tem os CRDs do Cilium. Provisionar um tenant provided em uma instalação v0.2.0 padrão, portanto, falha na etapa do Helm com

```
no matches for kind "CiliumNetworkPolicy" in version "cilium.io/v2"
```

e o tenant cai em `degraded`. Isso foi corrigido após a v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)): o chart agora condiciona esse objeto à existência real do CRD e adiciona egress de `NetworkPolicy` simples para hosts SIEM com IP literal, de modo que uma instalação flannel padrão provisiona sem problemas. Na v0.2.0 a solução de contorno em uma instalação de host único é desabilitar as políticas de rede de tenant antes do onboarding:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system set env deploy/soctalk-system-api \
  SOCTALK_TENANT_NETWORK_POLICIES_ENABLED=0
sudo /usr/local/bin/k3s kubectl -n soctalk-system rollout status deploy/soctalk-system-api
```

Seja claro sobre o tradeoff: isso desliga as NetworkPolicies de isolamento de namespace para os tenants provisionados depois disso, o que é aceitável em um host de laboratório ou piloto dedicado a uma única classe de tenant, e não o que você quer em um cluster de produção multi-tenant compartilhado. Se você roda o Cilium como CNI, nada disso se aplica e você deve deixar as políticas ligadas.

Se você já fez o onboarding e o tenant fica em `degraded` com o erro acima, defina o ajuste e clique em **Retry Provisioning** na página do tenant; os retries são idempotentes e retomam de forma limpa.

Mais uma coisa específica de um laboratório em uma única máquina, onde o Wazuh "existente" muitas vezes roda em Docker no mesmo host em que você instalou o SocTalk, alcançado pelo próprio IP do host. O k3s impõe NetworkPolicy pelo controller que ele empacota, e um pod alcançando o próprio IP do node para uma porta publicada pelo Docker é um hairpin que a camada de política não roteia de forma limpa mesmo quando uma regra de egress permite. O sintoma é o adaptador logando `ingest_failed: All connection attempts failed` enquanto o mesmo Wazuh responde bem a partir do host. Desabilitar as políticas de rede de tenant como acima resolve. Um Wazuh em um host separado é um caminho de saída comum e não esbarra nisso.

## Faça o onboarding do tenant

Na UI do MSSP, em Tenants, depois **+ New Tenant**, escolha o perfil `provided` e o assistente insere uma etapa de External SIEM que um tenant PoC ou persistent não tem.

![A etapa Profile do assistente New Tenant com Provided selecionado, descrito como traga seu próprio Wazuh; o breadcrumb agora inclui uma etapa External SIEM](/screenshots/existing-wazuh-profile.png)

Essa etapa é onde você aponta o SocTalk para o seu Wazuh. O indexer (OpenSearch, porta 9200) e a API do manager (porta 55000) se autenticam com credenciais separadas, e um tenant provided fornece a própria chave de LLM porque a chave compartilhada da instalação do MSSP não se aplica a este perfil.

![A etapa External SIEM do assistente: URL e credenciais do indexer, URL e credenciais da API do manager, um token de API pré-emitido opcional, uma caixa de seleção Verify TLS certificates a desmarcar para autoassinados e a chave de LLM por tenant exigida](/screenshots/existing-wazuh-siem-form.png)

A mesma operação pela API é um único POST para o endpoint de onboarding. Repare no caminho: `POST /api/mssp/tenants/onboard` é o endpoint do assistente que entende perfis e material de SIEM externo. O `POST /api/mssp/tenants` simples é uma criação apenas de identidade; na v0.2.0 ele ignora silenciosamente esses campos e deixa você com um tenant `poc` que nunca provisiona, então sempre envie um onboarding provided para `/onboard`.

```bash
# autentique uma vez; o cookie jar carrega a sessão do MSSP
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

Um 202 com `"profile": "provided"` no corpo confirma o caminho certo. Escolha o slug com cuidado: slugs continuam reservados por tenants arquivados, então um tenant de teste descomissionado não libera o nome para reuso.

Provisionar um tenant provided é rápido porque não há chart do Wazuh para instalar; o controller pula essa fase e registra em vez disso um evento de ciclo de vida `wazuh_skipped_provided`. Na execução verificada, o tenant foi de `pending` a `active` em menos de vinte segundos.

## Verifique a conexão

O namespace do tenant deve conter exatamente dois workloads, o adaptador e o runs-worker, e nenhum pod do Wazuh:

```bash
sudo /usr/local/bin/k3s kubectl -n tenant-orion-soc get pods
```

Seu material de conexão vai parar em um Secret local ao namespace chamado `tenant-external-siem-creds`, contendo `INDEXER_USERNAME`, `INDEXER_PASSWORD`, `WAZUH_API_USERNAME` e `WAZUH_API_PASSWORD`, além de `WAZUH_API_TOKEN` quando você fornece um. O adaptador lê a URL do indexer do próprio ambiente e as credenciais desse Secret. O log dele diz em segundos se a conexão funciona, porque ele consulta o índice de alertas continuamente:

```
POST https://198.51.100.20:9200/wazuh-alerts-*/_search "HTTP/1.1 200 OK"
heartbeat_ok
```

A página de detalhe do tenant mostra a mesma coisa sem precisar ler logs. O painel External SIEM ecoa as URLs do indexer e da API que você forneceu, e a linha de status Adapter ingest reporta `reachable` com uma contagem de alertas encaminhados assim que os primeiros alertas fluem.

![A página de detalhe do tenant Orion Labs: perfil provided, estado active, um painel External SIEM com as URLs do indexer e da API, e um status Adapter ingest de reachable com três alertas encaminhados](/screenshots/existing-wazuh-tenant-detail.png)

Um 401 no log do adaptador significa que as credenciais do indexer estão erradas; um erro de TLS significa que `verify_ssl` não corresponde à situação do seu certificado; um timeout significa que o host do SocTalk não consegue alcançar a porta do indexer.

Credenciais rotacionam sem novo onboarding. `PATCH /api/mssp/tenants/{id}/external-siem` aceita qualquer subconjunto dos campos de onboarding, reescreve o Secret e recicla o pod do adaptador para que ele pegue o material novo:

```bash
curl -sk -b cookies.txt -H "Origin: https://<your-host>" -H "Content-Type: application/json" \
  -X PATCH "https://<your-host>/api/mssp/tenants/<tenant-id>/external-siem" \
  -d '{"indexer_password": "<new-password>"}'
```

## O primeiro alerta triado

Daqui em diante o fluxo de ingest, promoção, execução de run e revisão se comporta igual ao de um Wazuh gerenciado pelo SocTalk (a profundidade do enriquecimento difere na v0.2.0, veja Limitações atuais): o adaptador encaminha novos alertas iguais ou acima da severidade mínima (rule level 10 por padrão, configurável com `SOCTALK_ADAPTER_MIN_SEVERITY`), o control plane promove o que importa em investigações, e o runs-worker do tenant executa a triagem por AI com a chave de LLM do próprio tenant.

A forma honesta de testar é fazer o seu Wazuh existente produzir um alerta real de alta severidade, por exemplo uma rajada de logins SSH malsucedidos contra um agente monitorado seguida de um sucesso. Se você preferir não tocar em endpoints de produção, indexar um documento de alerta sintético direto em `wazuh-alerts-4.x-<date>` com um `rule.level` de 12 exercita o caminho idêntico, já que o adaptador lê do índice e não do manager.

Na execução verificada, um alerta de força bruta SSH seguida de sucesso foi de documento no indexer a triagem concluída em cerca de um minuto: encaminhado pelo adaptador, promovido, investigado pelo supervisor ao longo de várias chamadas de LLM, e fechado como `escalate` com 0,95 de confiança, indo parar na [fila de revisão do MSSP](/pt-br/mssp-ui#reviews-human-in-the-loop) para um humano. O gasto total da execução foi de cerca de trinta centavos contra a chave Anthropic do tenant, contabilizado dentro do orçamento de tokens por run descrito em [Pipeline de AI](/pt-br/ai-pipeline). Depois de alguns alertas de teste como esse, a fila de revisão os mantém lado a lado.

![A Human Review Queue com três casos Critical, cada um marcado como AI: Escalate e oferecendo uma ação Review](/screenshots/existing-wazuh-review-queue.png)

Cada linha carrega o veredito da AI e abre a investigação completa, de modo que um analista confirma ou revoga sobre a evidência em vez de começar a triagem ele mesmo.

## Limitações atuais

Ambas as ressalvas abaixo foram verificadas na v0.2.0 e estão corrigidas no release seguinte, então em um build mais novo você pode pular as soluções de contorno. Consulte as notas de release da sua versão.

- **Enriquecimento alcançando o Wazuh externo (apenas v0.2.0).** Na v0.2.0 o tooling MCP do Wazuh no runs-worker não estava conectado à API do manager de um tenant provided, então a triagem rodava apenas sobre o payload do alerta, sem pivôs ao vivo no estado do agente ou no histórico de logs. Corrigido após a v0.2.0 ([soctalk#109](https://github.com/soctalk/soctalk/issues/109)): o worker agora conecta o servidor MCP `mcp-server-wazuh` empacotado ao Wazuh do próprio tenant, de modo que o grafo de triagem consulta agentes, processos, portas, vulnerabilidades e logs do manager durante uma investigação da mesma forma que um tenant gerenciado pelo SocTalk faz.
- **Provisionamento em uma instalação flannel padrão (apenas v0.2.0).** O problema da política de egress do Cilium descrito antes, com sua solução de contorno de política de rede. Corrigido após a v0.2.0 ([soctalk#107](https://github.com/soctalk/soctalk/issues/107)).
