# Contribuir

O SocTalk é licenciado sob Apache 2.0. PRs são bem-vindos. Esta página cobre o ciclo de desenvolvimento e o que esperar de uma revisão.

## Ambiente de desenvolvimento

Suba um cluster local pronto para o SocTalk:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk
./scripts/dev-up.sh           # cluster dependencies only
```

O `scripts/dev-up.sh` cria um cluster k3d e instala os pré-requisitos de nível de cluster:

- K3s com Flannel + kube-proxy desabilitados
- Cilium como CNI com aplicação de NetworkPolicy
- cert-manager instalado
- k3d local-path como a StorageClass padrão

Ele **não** constrói as imagens do SocTalk, não instala o chart do SocTalk, não faz onboarding de tenants nem popula dados — rascunhos anteriores desta página afirmavam que sim. Execute os próximos passos você mesmo. Sequência típica após o `dev-up.sh`:

```bash
just build-api build-frontend  # api image embeds the orchestrator in V1
helm install soctalk-system charts/soctalk-system \
  -n soctalk-system --create-namespace \
  --set install.bootstrapAdmin.email=dev@example \
  --set install.bootstrapAdmin.password=devpassword12
# migrations + bootstrap admin run in the API pod's init command
# sign in at https://<your-ingress>/ with the credentials you set above
```

Para um ciclo interno mais rápido (sem rebuild de imagem a cada mudança), veja as dicas de iteração abaixo.

## Escolha seu ciclo de iteração

Por convenção do projeto, prefira executar os serviços com `uvicorn` / `pnpm dev` em vez do ciclo de build-push-redeploy do k3d:

```bash
# API (embeds the orchestrator in V1)
cd src && uvicorn soctalk.core.api.app_v1:app --reload --port 8000

# Frontend
cd frontend && pnpm dev
```

Aponte-os para o Postgres / Wazuh / Cortex do cluster k3d via `kubectl port-forward`. A iteração leva segundos, não minutos.

## Layout do repositório

```text
src/                Python (control plane, AI pipeline, adapter, runs-worker)
frontend/           SvelteKit (MSSP + customer UI)
charts/             Helm charts (soctalk-system, soctalk-tenant, wazuh, linux-ep)
infra/packer/       VM image generation (see /downloads)
setup-wizard/       Go (first-boot setup wizard)
attack-simulator/   MITRE ATT&CK demo scripts
scripts/            Dev / e2e / seed scripts
alembic/            DB migrations
docker-compose*.yml Various dev composition files
justfile            Build / release recipes
```

O site de documentação (este site) vive em um repositório separado, [`soctalk/soctalk-docs`](https://github.com/soctalk/soctalk-docs).

## Testes

Não há receitas `just test` / `just test-rls` / `just e2e-l1-l2` nesta release — esse é o formato planejado. Hoje, execute os testes diretamente com o pytest:

```bash
pytest tests/                          # full suite
pytest tests/v1/test_rls_isolation.py  # Postgres Row-Level Security suite
```

Os testes de RLS são inegociáveis — eles verificam o isolamento de dados entre tenants que o [Modelo de Segurança](/pt-br/reference/security-model) promete. O CI executa a suíte completa do pytest em cada PR.

## Estilo

- Python: ruff + black. O CI aplica.
- TypeScript: ESLint + Prettier com a configuração do próprio repositório. O CI aplica.
- Mensagens de commit: assunto em linha única, prefixo de conventional commit (`feat:`, `fix:`, `chore:`, `ci:`, `chart:`, …). Corpo não é obrigatório.
- Sem trailers co-authored-by / signed-off-by.

## Expectativas de PR

- **Testes para a mudança.** Novos endpoints precisam de testes de API; novos nós de grafo precisam de testes de máquina de estados; mudanças de chart precisam de snapshots de template renderizado.
- **Migração se você mexeu em um modelo.** O Alembic gera automaticamente; revise o SQL gerado quanto à exatidão antes de fazer commit.
- **Atualize a documentação** em [`soctalk-docs`](https://github.com/soctalk/soctalk-docs) se a mudança afeta um comportamento documentado. Não somos rígidos quanto a isso para refatorações internas; somos rígidos quanto a qualquer coisa voltada ao usuário.
- **PRs pequenos.** PRs grandes com mudanças misturadas são difíceis de revisar. Separe refatoração de funcionalidade; separe mudança de chart de mudança de runtime.

## Revisando seu próprio trabalho

Antes de solicitar revisão, execute o codex contra suas mudanças:

```bash
codex review --uncommitted
```

Esta é a mesma passagem de revisão que executamos no momento da release. Ela captura os problemas óbvios antes que um revisor humano precise fazê-lo.

## Fazendo release

As releases são marcadas a partir da `main`. Hoje o fluxo tem mais passos manuais do que a receita `just release` planejada sugere:

1. Ajuste manualmente as versões em `Chart.yaml` + `pyproject.toml`, faça commit e push.
2. Marque o commit e faça push da tag (`git tag v0.1.x && git push --tags`).
3. `just release` — executa `just build-all push-all`. Isso **apenas constrói e faz push das imagens de container**; não marca tags, não publica charts nem cria um GitHub Release.
4. O workflow do GH `publish-images.yml` cuida da publicação das imagens no ghcr.io quando acionado.
5. A publicação do chart em `ghcr.io/soctalk/charts/` é feita manualmente com `helm push` hoje.
6. `gh release create` para lançar o GitHub Release.
7. `build-packer-images.yml` (acionamento manual) constrói a [imagem de VM de demonstração](/pt-br/downloads) em todos os cinco formatos e as anexa ao GitHub Release.

Consolidar os passos 1, 2, 5 e 6 na receita `just release` está no roadmap.

## Divulgação de segurança

Se você encontrou uma vulnerabilidade, **não abra uma issue pública.** Envie um e-mail para o endereço listado no SECURITY.md na raiz do repositório. Respondemos em até dois dias úteis.

## Licença

Apache 2.0. Ao enviar um PR você concorda em licenciar sua contribuição sob a mesma licença.

## Reconhecimento

O log do git é o registro canônico de contribuidores hoje; um CONTRIBUTORS.md dedicado / `just update-contributors` está planejado.
