# Política de Posicionamento de Secrets

> **Nota sobre a implantação V1.** Várias entradas abaixo referenciam "pods do orchestrator" como uma carga de trabalho distinta — no chart V1 o orchestrator fica co-localizado no Deployment `soctalk-system-api`, portanto referências a "pod do orchestrator" significam "pod da API" nesta release. Nomes específicos de Secret do K8s também podem variar ligeiramente em relação aos nomes renderizados pelo chart (consulte [`charts/soctalk-system/templates/60-secrets.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/templates/60-secrets.yaml) como fonte da verdade).

## Invariante (aspiracional)

**Alvo:** nenhum material bruto de secret no banco de dados do SocTalk. As tabelas do Postgres que rastreiam secrets armazenam apenas referências: `(namespace, name, version_label)`. O material em si fica em um objeto `Secret` do Kubernetes, montado no pod que precisa dele.

**Hoje (V1):** há **uma exceção documentada** — `IntegrationConfig.llm_api_key_plain` no banco de dados armazena as chaves de API de LLM por tenant em texto puro. Isso é necessário porque o runs-worker lê a chave a partir do seu contexto de tenant no momento em que assume a investigação, e o chart V1 ainda não conecta os Secrets de LLM por tenant através da spec do pod. Trate as credenciais do Postgres como a proteção dessas chaves e rotacione as chaves do provedor de LLM como se estivessem expostas caso a credencial do banco seja rotacionada.

Outras categorias de secret — assinatura de JWT, roles do Postgres, credenciais de integração, authd do Wazuh — todas residem em Secrets do K8s e são referenciadas por nome a partir do banco, não armazenadas inline. As metas de arquitetura (abaixo) descrevem o estado de destino para todas as classes de secret:

- Limita o raio de impacto de um comprometimento do banco do SocTalk (nenhum material vaza).
- Permite que os mecanismos de rotação nativos do K8s funcionem (atualização de Secret → pod assume o novo valor ao remontar ou na próxima leitura do Secret).
- Alinha-se ao caminho de integração com o External Secrets Operator em uma release futura.

## Inventário de Secrets V1 (o que o chart realmente renderiza hoje)

| Secret | Material | Localização | Acessado por | Rotação |
|---|---|---|---|---|
| `soctalk-system-postgres-admin-creds` | user/pw | ns `soctalk-system` | Apenas o container `db-init` do pod da API (migrações + bootstrap) | Manual |
| `soctalk-system-postgres-app-creds` | user/pw | ns `soctalk-system` | Pod da API (runtime, sujeito a RLS) | Manual |
| `soctalk-system-postgres-mssp-creds` | user/pw | ns `soctalk-system` | Pod da API (consultas cross-tenant via `system_context()`) | Manual |
| `soctalk-system-jwt-signing-key` | secret HMAC | ns `soctalk-system` | Pod da API | Manual |
| `soctalk-system-adapter-signing-key` | chave HMAC | ns `soctalk-system` | Pod da API (emite tokens de adapter por tenant) | Manual |
| `soctalk-system-bootstrap-admin` | email + senha | ns `soctalk-system` | Apenas o container `db-init` do pod da API | Manual |
| `soctalk-system-llm-api-key` | chaves de API do provedor (anthropic-api-key + openai-api-key) | ns `soctalk-system` | Pod da API (padrão para toda a instalação) | Manual |
| `adapter-token` | bearer token | ns `tenant-<slug>` | Pod adapter do tenant | Emitido no provisionamento; rotação via reprovisionamento |
| `runs-worker-token` | bearer token | ns `tenant-<slug>` | Pod runs-worker do tenant (chama `/api/internal/worker/runs/*`) | Igual ao anterior |
| `tenant-llm-key` | chave de API de LLM | ns `tenant-<slug>` | Pod runs-worker do tenant (montada via `secretKeyRef`) | Iniciada pelo MSSP via `PATCH /api/mssp/tenants/{id}/llm`; o controller materializa a partir de `IntegrationConfig.llm_api_key_plain` + reinicia o runs-worker |
| `tenant-<id>-llm` | chave de API de LLM (cópia legada / de auditoria) | ns `soctalk-system` | Não montada por nenhum pod da V1 | Igual ao anterior; esta cópia é escrita para auditoria mas **não é a fonte autoritativa** que o runs-worker lê |
| `wazuh-authd-secret` | secret compartilhado | ns `tenant-<slug>` | Wazuh manager (enrollment) | Regenerar para forçar o reenrollment de todos os agentes |
| `wazuh-<slug>-wazuh-creds` | user/pw | ns `tenant-<slug>` | Pods do Wazuh manager + linux-ep (enrollment de agentes) | Gerado no provisionamento |

**A triagem executa no `soctalk-runs-worker` em cada namespace `tenant-<slug>`** (não no pod central da API). É por isso que os secrets por tenant são montados no namespace do tenant, e não no `soctalk-system`.

A chave de API de LLM é **também armazenada em texto puro em `IntegrationConfig.llm_api_key_plain`** no Postgres — consulte a ressalva sobre a invariante acima. O Secret do K8s é materializado a partir do valor do banco no momento do provisionamento / rotação.

Itens obsoletos de rascunhos anteriores (agora removidos): `tenant-<id>-wazuh`, `tenant-<id>-thehive`, `tenant-<id>-cortex`, `wazuh-bootstrap`, `thehive-bootstrap`, `cortex-bootstrap`, `cassandra-creds`, `soctalk-license`. O `tenant-<id>-llm` em `soctalk-system` ainda existe na V1 como uma cópia legada/de auditoria, mas **não** é o que o runs-worker lê. A seção de arquitetura abaixo descreve a fundamentação de design; apenas o inventário acima é o atual.

## Posicionamento da chave de LLM por tenant

A triagem executa no pod `soctalk-runs-worker` por tenant (no namespace `tenant-<slug>`), **não** no pod central da API. É por isso que as chaves de LLM por tenant residem no namespace do tenant:

- **Store autoritativo:** `IntegrationConfig.llm_api_key_plain` no Postgres.
- **Fonte montada:** `Secret/tenant-llm-key` em `tenant-<slug>`, materializada pelo controller a partir do valor do banco.
- **Na rotação (`PATCH /api/mssp/tenants/{id}/llm`):** o controller reescreve o Secret do namespace do tenant e reinicia o `Deployment/soctalk-runs-worker` para que a nova chave entre em vigor na próxima reivindicação de investigação.

`Secret/tenant-<id>-llm` no namespace `soctalk-system` também existe como uma cópia legada / de auditoria de iterações de design anteriores, mas **não** é montada por nenhum pod da V1. Não há montagem de Secret cross-namespace na V1.

A alternativa (ns por tenant para a chave de LLM de cada tenant) é reavaliada em uma release futura com o External Secrets Operator, onde o ESO pode sincronizar secrets armazenados em vault externo para qualquer namespace que precise deles.

## Secrets de bootstrap do data plane

As credenciais de admin do Wazuh/TheHive/Cortex residem em seus respectivos namespaces de tenant porque:

- Esses pods precisam delas na inicialização (init containers, setup de primeira execução).
- Complicações de montagem cross-ns como acima.
- O raio de impacto do comprometimento do namespace já expõe os próprios pods; colocar o secret de bootstrap no mesmo namespace não adiciona risco.

Os secrets de bootstrap são gerados pelo controller do SocTalk no momento do provisionamento do tenant:
1. O controller gera valores aleatórios (por exemplo, `openssl rand -hex 32`).
2. O controller cria o `Secret` no ns `tenant-<slug>` de destino.
3. O controller registra a referência `(tenant-<slug>, wazuh-bootstrap, v1)` na tabela `TenantSecret`.
4. O controller renderiza os valores do chart do tenant referenciando o Secret por nome.
5. O `helm install` prossegue; os pods do data plane leem as credenciais na inicialização.

Se o material for perdido (por exemplo, Secret excluído), o reprovisionamento regenera novas credenciais. Os pods do data plane reiniciam; quaisquer serviços dependentes são reinicializados. Os agentes de endpoint do cliente (que dependem do secret de enrollment do Wazuh) precisam de reenrollment se esse secret específico for rotacionado: documentado no runbook de operações.

## Convenções de geração de secrets

No momento do provisionamento do tenant, o controller do SocTalk gera:

```python
import secrets

# Administrative passwords: 32-char high-entropy
wazuh_admin_pw = secrets.token_urlsafe(32)
thehive_admin_pw = secrets.token_urlsafe(32)
cortex_admin_pw = secrets.token_urlsafe(32)

# Enrollment shared secret: 48-char
wazuh_authd = secrets.token_urlsafe(48)

# API tokens (for SocTalk → data plane): 48-char
thehive_api_token = secrets.token_urlsafe(48)
cortex_api_key = secrets.token_urlsafe(48)

# Cassandra: 32-char
cassandra_pw = secrets.token_urlsafe(32)
```

O SocTalk armazena referências e rótulos de versão; ele não mantém o material em memória além da chamada de provisionamento.

## Rotação (realidade da V1)

1. **Rotação da chave de LLM por tenant** (o MSSP inicia via `PATCH /api/mssp/tenants/{id}/llm`):
   - Store autoritativo atualizado no Postgres (`IntegrationConfig.llm_api_key_plain`).
   - O controller reescreve o `Secret/tenant-llm-key` em `tenant-<slug>` (não no namespace do sistema).
   - O controller reinicia o `Deployment/soctalk-runs-worker` no namespace do tenant para que a nova chave entre em vigor na próxima reivindicação. **A reinicialização do pod é obrigatória** — a V1 não recarrega secrets em runtime.

2. **Rotação das credenciais de admin do Wazuh / TheHive / Cortex** (manual, runbook):
   - `kubectl patch secret <name> -n tenant-<slug> ...` para reescrever a credencial.
   - `kubectl rollout restart` na carga de trabalho afetada para que ela releia.
   - Um wrapper CLI para isso (`soctalk-cli rotate-admin`) foi documentado em rascunhos anteriores mas **não está implementado** na V1.

3. **Rotação das credenciais do Postgres** (manual, runbook):
   - `ALTER ROLE soctalk_app WITH PASSWORD ...` no Postgres.
   - `kubectl patch secret soctalk-system-postgres-app-creds ...` (atenção ao nome renderizado pelo chart).
   - `kubectl rollout restart deploy soctalk-system-api` — não há pod de orchestrator separado na V1 (o orchestrator fica co-localizado no pod da API).

4. **Rotação da chave de assinatura de JWT** (uma release futura): a rotação com zero downtime requer o suporte a duas chaves válidas durante a transição. Esta release adia isso; a rotação manual força uma janela em que todos os usuários precisam se reautenticar.

## Controle de acesso

O RBAC do Kubernetes restringe quais ServiceAccounts podem ler quais Secrets:

- SA `soctalk-system-api` em `soctalk-system`: pode ler Secrets em `soctalk-system` (credenciais do Postgres, chaves de assinatura de JWT/adapter). Também vinculada para escrever Secrets em namespaces `tenant-*` (necessário para criar/rotacionar os secrets de bootstrap do tenant) — o chart V1 consolida as roles de API + controller nesta SA.
- `ServiceAccount` por tenant em `tenant-<slug>`: pode ler apenas os secrets do seu próprio namespace. Ela pode ler seu próprio `adapter-token` / `runs-worker-token` / `tenant-llm-key`, mas nunca a chave de assinatura do sistema.
- A `soctalk-orchestrator-sa` de rascunhos anteriores não existe na V1 — o orchestrator roda dentro do pod da API sob a SA da API.

Os templates de `Role`/`RoleBinding` fazem parte do chart `soctalk-system` (para as SAs do SocTalk) e do chart `soctalk-tenant` (para as SAs por tenant).

## Antipadrões explicitamente rejeitados

- **Injeção de secret por variável de ambiente a partir de arquivo `.env`** (padrão V0 atual): aceitável para uma única organização, não para multi-tenant. Todos os secrets migram para Secrets do K8s.
- **Secrets no values.yaml do Helm**: nunca: os arquivos de values acabam no Git, em logs de CI, no histórico do Helm. O controller do SocTalk renderiza os objetos Secret separadamente e usa `valueFrom.secretKeyRef` nos templates.
- **Chave de LLM única compartilhada para todos os tenants**: explicitamente fora de escopo para BYO LLM. Sempre chaves por tenant.
- **Secrets em ConfigMaps**: proibido. ConfigMaps são para config não sensível; Secrets para dados sensíveis.

## External Secrets Operator (um caminho para release futura)

uma release futura introduz a integração com o External Secrets Operator:

- O MSSP fornece um backend de secrets (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager).
- Recursos `ExternalSecret` referenciam caminhos do backend; o ESO sincroniza para Secrets do K8s.
- Chaves de LLM por tenant armazenadas no backend com caminhos como `secret/mssp-abc/tenants/acme/llm`.
- A rotação é feita no backend; o ESO propaga dentro do intervalo de refresh.

A estrutura (refs no Postgres → Secret do K8s → montagem) é compatível: apenas a fonte do Secret muda (gerenciada pelo ESO vs. escrita pelo controller do SocTalk).
