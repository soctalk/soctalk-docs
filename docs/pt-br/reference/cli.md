# CLI e scripts

Os operadores fazem a maior parte das tarefas pela [UI do MSSP](/pt-br/mssp-ui) ou pela [REST API](/pt-br/reference/api). A superfície da CLI é pequena e existe para bootstrap, ambientes de desenvolvimento e operações offline.

## Pontos de entrada dentro do pod

Estes rodam dentro do `soctalk-system-api` (ou de um Job de execução única). Eles usam as credenciais do Postgres montadas no pod e a configuração do chart — sem estado externo.

### Bootstrap

Não há uma CLI de bootstrap separada nesta versão — o comando de init do pod da API do chart executa o bootstrap inline (migrations, senhas de role, linha de organização, usuário admin opcional). Veja [Instalação — Migrations e bootstrap](/pt-br/install#migrations-and-bootstrap-run-automatically).

### Teste de fumaça de LLM

Não há uma CLI `soctalk.llm.smoke_test` nesta versão. Para verificar rapidamente se um LLM configurado está acessível, veja [Provedores de LLM — Teste de sanidade](/pt-br/integrate/llm-providers#sanity-test) para a expressão Python de uma linha.

### `soctalk-auth` (helper dentro do pod)

O único helper de CLI de primeira classe nesta versão. Subcomando único: `set-password`.

```bash
kubectl -n soctalk-system exec -it deploy/soctalk-system-api -- \
  soctalk-auth set-password user@example.com
```

Solicita uma nova senha (ou lê de `SOCTALK_PASSWORD`), procura o usuário, define a senha com hash e audita `auth.password.reset.admin`. Útil para redefinições forçadas sem passar pela API. A linha do usuário já deve existir; o `soctalk-auth` não cria linhas.

### `soctalk` (ponto de entrada do orquestrador)

`soctalk` é o ponto de entrada do orquestrador — executa o supervisor LangGraph + workers. Na V1, o pod da API embute o orquestrador (sem um Deployment `soctalk-system-orchestrator` separado). Normalmente não é invocado manualmente fora do ambiente de desenvolvimento.

### Ainda não há um `soctalk-cli` de uso geral

O rascunho anterior desta página listava comandos de gerenciamento de tenant sob um binário `soctalk-cli` que não existe na versão atual. As ações de tenant (suspend, resume, decommission, rotate-admin) hoje passam pela [REST API](/pt-br/reference/api). A superfície de CLI para operações de tenant está prevista para uma versão futura.

## No lado do repositório: receitas do `justfile`

O [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) na raiz do repositório tem receitas usadas durante o desenvolvimento e o release:

| Receita | O que faz |
|---|---|
| `just build-api` | Compila a imagem do contêiner da API |
| `just build-orchestrator` | Compila a imagem do contêiner do orquestrador |
| `just build-frontend` | Compila a imagem do contêiner do frontend SvelteKit |
| `just build-mock-endpoint` | Compila a imagem do simulador de endpoint mock |
| `just run` | Executa a stack de desenvolvimento via docker-compose |
| `just push-all` | Envia todas as imagens para o registry configurado |
| `just release` | Cria a tag + envia imagens + chart + cria um GitHub Release |

## No lado do repositório: `scripts/`

| Script | Propósito |
|---|---|
| `scripts/dev-up.sh` | Sobe um cluster de desenvolvimento k3d de nó único com o SocTalk e um tenant semeado |
| `scripts/local-up.sh` | O mesmo, mas no k3s do host em vez do k3d |
| `scripts/local-down.sh` | Derruba um cluster do `local-up.sh` |
| `scripts/e2e-l1-l2-k3d.sh` | Configuração k3d de dois clusters (MSSP L1 + tenant L2) para validação e2e completa |
| `scripts/seed-mssp-demo-data.py` | Popula o Postgres com tenants de fixture (`acme-corp`, `wayne-industries`, `stark-defense`) e reproduz Alertas do Wazuh via o indexer para preparação de capturas de tela |
| `scripts/inject_test_data.py` | Injeta payloads de teste específicos — útil ao reproduzir um bug reportado por um cliente |
| `scripts/verify-pages-visual.py` | Verificação de regressão visual com Playwright contra a UI de desenvolvimento do SocTalk |

Todos esperam ser executados a partir da raiz do repositório. Leia o cabeçalho do script para os argumentos exatos.

## No lado do repositório: Packer

Para builds de imagem de VM, veja [Downloads → Compile você mesmo](/pt-br/downloads#build-it-yourself).

## Operações em ambiente isolado (air-gapped)

Para instalações sem acesso à internet, a API + `soctalk-auth` são suficientes para executar o SocTalk sem tocar na UI:

```bash
# Bootstrap happens automatically in the API pod's init command — no
# extra step. Just install the chart with install.bootstrapAdmin.* set.

# Or, if those weren't supplied, set the admin password after install:
kubectl -n soctalk-system exec deploy/soctalk-system-api -- \
  soctalk-auth set-password admin@example
# Read the admin credentials.
kubectl -n soctalk-system get secret soctalk-system-bootstrap-admin \
  -o jsonpath='{.data.password}' | base64 -d; echo

# Onboard a tenant via the API.
curl -k -c jar -X POST http://soctalk-system-api:8000/api/auth/login \
  -d '{"email":"admin@example","password":"..."}'
curl -k -b jar -X POST http://soctalk-system-api:8000/api/mssp/tenants/onboard \
  -d '{"slug":"acme","display_name":"Acme","profile":"persistent"}'
```

Para a senha existente do admin de bootstrap que o Job de bootstrap emite, veja [Instalação → Migrations e bootstrap](/pt-br/install#migrations-and-bootstrap-run-automatically).

## Ponteiros de código-fonte

| Conceito | Arquivo |
|---|---|
| Bootstrap (inline) | [`charts/soctalk-system/templates/30-api.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/30-api.yaml) (comando de init) |
| Fábrica de provedores de LLM | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Código-fonte do `soctalk-auth` | [`src/soctalk/core/cli/auth.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/cli/auth.py) |
| Entrada do orquestrador `soctalk` | [`src/soctalk/main.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/main.py) |
| `justfile` | [`justfile`](https://github.com/soctalk/soctalk/blob/main/justfile) |
| `scripts/` | [`scripts/`](https://github.com/soctalk/soctalk/tree/main/scripts) |
