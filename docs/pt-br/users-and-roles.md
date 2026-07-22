# Usuários e funções

Como as funções funcionam, quem pode fazer o quê e como os administradores criam usuários, concedem acesso ao portal do cliente e rotacionam senhas. Para um passo a passo do provisionamento e do ciclo de vida do usuário com capturas de tela, consulte [Gerenciando usuários: um passo a passo](/pt-br/manage-users). Consulte [Autenticação interna](/pt-br/reference/internal-auth) para a referência em nível de protocolo e [Modelo de segurança](/pt-br/reference/security-model) para a matriz de função por recurso.

## Como o acesso é decidido

O acesso está migrando para um modelo de capacidades. Cada função é um pacote nomeado de capacidades, e as superfícies criadas ou reformuladas para ele (o fluxo de operação e revisão, o chat, o autosserviço do tenant para engajamentos, os fatos de autorização e os usuários) solicitam a capacidade de que precisam em vez de uma função específica. Nessas rotas, adicionar uma função é uma questão de definir seu pacote; os pontos de chamada não mudam. Outras rotas ainda restringem o acesso por função ou público diretamente, incluindo o gerenciamento de tenants do MSSP, a configuração de LLM e branding, a redefinição de senha pelo administrador e várias rotas de dashboard, analytics e investigação. Essas são atualizadas manualmente quando as funções mudam. Trate o acesso baseado em capacidades como a direção, não como algo universal hoje.

As funções são organizadas em camadas, e as mesmas camadas de operação existem em ambos os lados do negócio:

- **operate**: trabalhar a fila. Visualizar e triar investigações, revisar os verdicts da AI, decidir, aprovar propostas de standard-blast, usar o chat.
- **authorize risk**: tudo o que operate pode fazer, mais declarar engajamentos de pentest, curar fatos de autorização e aprovar ações de high-blast que gravam em um sistema externo.
- **configure**: tudo o que o manager pode fazer, mais as configurações que essa função controla e o gerenciamento de usuários.

Uma camada superior detém todas as capacidades da camada abaixo dela. O lado do tenant adiciona mais uma camada abaixo de operate, um stakeholder somente leitura (`customer_viewer`) que pode ver mas não agir; o lado do MSSP não tem equivalente, já que sua função mais baixa (`analyst`) já opera.

O público é uma barreira separada sobre as camadas. As funções do MSSP detêm apenas capacidades do MSSP e as funções do tenant detêm apenas capacidades do tenant; os dois conjuntos nunca se sobrepõem. Um guard de capacidade verifica a capacidade e o público em conjunto, de modo que uma capacidade do MSSP nunca pode satisfazer uma rota do tenant e vice-versa. É por isso que `platform_admin`, por exemplo, detém todas as capacidades do MSSP mas nenhuma das do tenant.

## Catálogo de funções

**Lado do MSSP** (equipe do provedor; `tenant_id` é null):

| Função | Camada | Pode fazer |
|---|---|---|
| `platform_admin` | configure (super) | Todas as capacidades do MSSP, em toda a instalação. |
| `mssp_admin` | configure | Configurar o sistema, gerenciar usuários, mais tudo abaixo. |
| `mssp_manager` | authorize risk | Declarar engajamentos, curar fatos de autorização, aprovar ações de high-blast, mais operate. |
| `analyst` | operate | Triar investigações, revisar verdicts, decidir, usar o chat. Trabalha um cliente por vez fixando um tenant (veja Impersonação abaixo); somente leitura nas configurações. |

**Lado do tenant** (equipe de um cliente; `tenant_id` definido; restrito àquele único tenant):

| Função | Camada | Pode fazer |
|---|---|---|
| `tenant_admin` | configure | Gerenciar os usuários da própria organização e as próprias configurações de LLM, mais tudo abaixo. Provisionado automaticamente durante o onboarding do tenant pelo fluxo `_mint_tenant_admin_user` do runtime. |
| `tenant_manager` | authorize risk | Declarar os próprios engajamentos de pentest, afirmar fatos de autorização (que ficam pendentes de revisão do MSSP antes de entrar em vigor), aprovar ações de high-blast, mais operate. |
| `tenant_analyst` | operate | Trabalhar o SOC do próprio tenant: triar, revisar verdicts, decidir, aprovar propostas de standard-blast, usar o chat. Esta é a função de SOC cogerenciado, o espelho do lado do tenant de `analyst`. |
| `customer_viewer` | view only | Stakeholder somente leitura. Vê o dashboard e as investigações do próprio SOC do cliente, mas não pode agir sobre eles nem abrir a fila de revisão. |

A camada "configure" do `tenant_admin` é estreita: sobre o manager, ela acrescenta a configuração de LLM da própria organização e o gerenciamento de usuários, e nada mais. Branding e integrações permanecem no lado do MSSP.

O administrador inicial é criado inline pelo comando de init do pod da API (dirigido por `install.bootstrapAdmin.email` e `install.bootstrapAdmin.password` nos values do chart) como um `mssp_admin` com `must_change=false`. O [assistente de configuração](/pt-br/setup-wizard) popula esses valores durante a primeira inicialização.

## A divisão entre customer-viewer e tenant-analyst

`customer_viewer` e `tenant_analyst` são ambos do lado do tenant, mas são trabalhos diferentes. `customer_viewer` observa: dashboards e status de investigação, nada mais. Não pode decidir revisões, usar o chat nem listar a fila de revisão pendente. `tenant_analyst` opera: executa o próprio SOC do cliente sobre os alertas do próprio tenant. Dê viewers a quem precisa de visibilidade e analysts a quem faz o trabalho.

A fila de revisão pendente é restringida de acordo. Listar ou abrir uma revisão exige autoridade de revisão, detida pelo `analyst` do MSSP e acima e pelo `tenant_analyst` e acima. Um operador de tenant vê apenas a fila do próprio tenant. Leituras de revisão entre tenants são limitadas a `platform_admin`, `mssp_admin` e `mssp_manager`; um `analyst` do MSSP lê a fila de um tenant depois de fixado nele.

## Criando usuários de tenant

Um `tenant_admin` provisiona os logins da própria organização. É isso que torna as funções do tenant utilizáveis; sem isso, um tenant teria apenas o único administrador criado no onboarding.

Na UI do cliente, abra **Users** na barra lateral (visível apenas para o `tenant_admin`), depois **Add user**: informe um e-mail, escolha uma função e envie. O painel retorna uma senha temporária de uso único. Copie-a e entregue-a ao usuário por um canal separado; ela é exibida uma vez e nunca pode ser recuperada em texto puro. É solicitado ao usuário que a altere no primeiro login.

O mesmo está disponível na API:

```bash
curl -X POST 'https://<customer-host>/api/tenant/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@customer.example","role":"tenant_analyst"}'
```

Observações:

- As funções atribuíveis são `customer_viewer`, `tenant_analyst`, `tenant_manager` e `tenant_admin`. Uma função do MSSP não pode ser atribuída aqui; a requisição é rejeitada. Esta é a barreira de público.
- O novo usuário é sempre colocado no próprio tenant de quem faz a chamada. O tenant é obtido da sessão de quem chama, nunca do corpo da requisição, e o banco de dados o impõe, de modo que um administrador de tenant só pode criar usuários no próprio tenant.
- Um e-mail duplicado é rejeitado. Os e-mails são únicos em toda a instalação.
- `GET /api/tenant/users` lista os próprios usuários do tenant. Ambos os endpoints exigem a capacidade `tenant_manage_users`, que apenas o `tenant_admin` detém.

O portal do cliente é acessado em um host por tenant. O hostname fixo vem de `ingress.hostnames.customer` nos values do chart, e os hosts por tenant dirigidos por slug vêm de `ingress.tenantWildcard`. Consulte a [documentação de instalação](/pt-br/install) para o layout de hostnames.

## Criando usuários da equipe do MSSP

Um `mssp_admin` ou `platform_admin` provisiona os logins da equipe do MSSP a partir do painel **Staff Users** na [UI do MSSP](/pt-br/mssp-ui) ou na API. O formato espelha o lado do tenant.

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users' \
  -b cookies.jar -H 'Content-Type: application/json' \
  -d '{"email":"analyst@your-mssp.example","role":"analyst"}'
```

Observações:

- As funções atribuíveis são `analyst`, `mssp_manager`, `mssp_admin` e `platform_admin`. Uma função do tenant não pode ser atribuída aqui (a barreira de público). Atribuir `platform_admin` só é permitido se quem chama já for um `platform_admin`.
- O novo usuário é do lado do MSSP (`tenant_id` é null). Esses endpoints só operam sobre linhas de equipe do MSSP, de modo que um usuário de tenant nunca pode ser alcançado por meio deles.
- A resposta traz uma senha temporária de uso único; o usuário a altera no primeiro login. Um e-mail duplicado é rejeitado.
- `GET /api/mssp/users` lista a equipe. Todos esses exigem a capacidade `manage_users`, detida apenas por `mssp_admin` e `platform_admin`.

`soctalk-auth set-password` (o CLI) ainda existe para os casos de bootstrap e offline: ele define uma senha para um usuário existente, limpa `must_change` e audita a mudança, mas não cria a linha do usuário e não revoga sessões.

## Alterando uma função, desativando, reativando

Ambos os lados expõem o mesmo ciclo de vida. No lado do tenant, um `tenant_admin` gerencia a própria organização; no lado do MSSP, um `mssp_admin`/`platform_admin` gerencia a equipe.

- **Alterar uma função**: escolha uma nova função no seletor da linha, ou `PATCH /api/tenant/users/{id}` (ou `/api/mssp/users/{id}`) com `{"role": "..."}`. Uma mudança de função revoga as sessões ativas do usuário para que a nova função entre em vigor imediatamente.
- **Desativar**: o botão Deactivate da linha, ou `POST .../{id}/deactivate`. O usuário é marcado como inativo e todas as sessões ativas são revogadas de uma vez, de modo que um usuário já conectado é cortado em vez de permanecer até a expiração. O middleware de sessão também recusa um usuário inativo, o que fecha a corrida com um login concorrente.
- **Reativar**: o botão Reactivate da linha, ou `PATCH .../{id}` com `{"active": true}`.

Dois guards se aplicam a toda mudança:

- Você não pode modificar a própria conta (sem autorrebaixamento ou autobloqueio).
- Você não pode remover o último administrador ativo: a mudança que deixaria um tenant sem nenhum `tenant_admin` ativo, ou a instalação sem nenhum `mssp_admin`/`platform_admin` ativo (ou sem nenhum `platform_admin` ativo quando existe um), é recusada. A verificação bloqueia as linhas candidatas, de modo que rebaixamentos concorrentes não podem ambos passar.

Uma conta `platform_admin` existente só pode ser alterada, desativada ou ter a senha redefinida por outro `platform_admin`.

## Redefinição de senha

**Autosserviço**: não implementado nesta versão. Não há fluxo de esqueci-a-senha nem entrega de e-mail na página de login. Os usuários pedem a um administrador para redefinir.

**Forçada pelo administrador**: um `mssp_admin` ou `platform_admin` redefine a senha de qualquer usuário por id:

```bash
curl -X POST 'https://mssp.your-mssp.example/api/mssp/users/<user-id>/password/reset' \
  -b cookies.jar
```

O alvo pode ser um usuário do MSSP ou um usuário de tenant; o ator deve ser `mssp_admin` ou `platform_admin`. A resposta contém uma nova `temporary_password` marcada com `must_change=true`, e a redefinição revoga todas as sessões existentes daquele usuário. Compartilhe a senha; o usuário escolhe uma nova no primeiro login.

Não há ação de redefinição do lado do tenant, então um `tenant_admin` não pode redefinir a senha de um dos próprios usuários pela UI. Até que isso seja lançado, um administrador do MSSP a redefine com o endpoint acima, ou um operador a redefine diretamente na linha do banco de dados.

## Impersonação e troca de contexto de tenant

Usuários do lado do MSSP (`platform_admin`, `mssp_admin`, `mssp_manager`, `analyst`) podem restringir sua sessão a um tenant específico via `POST /api/auth/assume-tenant`. Usuários do lado do tenant não podem; eles já estão fixados no próprio tenant. A UI expõe isso como o chip **Tenant: \<name\>** no canto superior direito da [UI do MSSP](/pt-br/mssp-ui): clicar em um tenant fixa a sessão na visão daquele cliente, e **Clear** volta ao escopo entre tenants. Ações que alteram estado tomadas durante esse escopo são executadas como o usuário original, com a sessão vinculada àquele tenant.

Isto não é impersonação de um usuário diferente; a identidade da sessão permanece a mesma. Uma superfície de "assumir a sessão de um usuário específico" está planejada.

## Sessões

| Armazenamento de sessão | Nome do cookie | Duração |
|---|---|---|
| Sessão da UI do MSSP | `soctalk_session` | 12 h absoluto + 30 min de inatividade |
| Sessão do portal do cliente | `soctalk_session` | 12 h absoluto + 30 min de inatividade |
| Sessão do assistente | `soctalk_session` | até o assistente ser encerrado |

`POST /api/auth/logout` revoga apenas a sessão atual. Desativar um usuário de tenant e redefinir a senha de qualquer usuário revogam todas as sessões daquele usuário. Para revogar todas as sessões de um usuário do MSSP sem redefinir a senha, defina `revoked_at` diretamente nas linhas de `sessions` dele no Postgres; ainda não há uma API de administração para isso. Rotacionar a chave de assinatura do JWT não revoga sessões de cookie apoiadas no banco; a busca é feita na linha do banco, não na assinatura do JWT.

Um inventário de sessões somente leitura (`GET /api/auth/sessions`) está planejado.

## SSO / autenticação por proxy

O runtime suporta `SOCTALK_AUTH_MODE=proxy`, no qual o SocTalk confia em um proxy OIDC upstream (OAuth2-Proxy, Keycloak, Dex) para autenticar a requisição. A identidade é resolvida a partir do cabeçalho `X-Forwarded-Email`, correspondida por e-mail a uma linha de usuário existente. O próprio modo de autenticação não é exposto como um knob nos values do chart hoje; defina a variável de ambiente diretamente no Deployment `soctalk-system-api` após a instalação. Os CIDRs de proxy confiável são apoiados no chart via `oidc.trustedProxyCIDRs`.

No modo proxy, o roteador de autenticação baseado em senha não é montado de forma alguma, então `/api/auth/login`, `/api/auth/password/change`, a redefinição de senha pelo administrador e também `/api/auth/me`, `/api/auth/logout` e `/api/auth/assume-tenant` estão ausentes. O init de bootstrap do chart ainda semeia a linha da Organização e, se `install.bootstrapAdmin.password` estiver definido, o usuário `mssp_admin`. Continue definindo `bootstrapAdmin` mesmo no modo proxy: o provisionamento just-in-time de usuário na primeira requisição autenticada não está implementado, então, sem um usuário semeado correspondido por e-mail à identidade do seu IdP, nenhuma requisição autenticada por proxy pode resolver para uma linha de usuário.

A atribuição de função no modo proxy acontece na criação do usuário no banco de dados. O runtime confia no e-mail encaminhado para a identidade, mas não lê cabeçalhos de grupo nem promove automaticamente com base em pertencimento a grupo. Um mapeamento configurável de grupo do IdP para função do SocTalk está planejado.

Detalhes completos: [Autenticação interna](/pt-br/reference/internal-auth).

## Auditoria

A criação de usuários, as mudanças de função/status e a desativação gravam linhas `user.create`, `user.update` e `user.delete` no log de auditoria (com o estado de função e ativo antes/depois nas atualizações), e as redefinições de senha também são auditadas. Observe que a visão atual `/api/audit` na UI lê o stream de eventos de investigação, não a tabela `audit_log`, então essas linhas de gerenciamento de usuários são consultáveis diretamente em `audit_log`, mas ainda não aparecem naquela tela.
