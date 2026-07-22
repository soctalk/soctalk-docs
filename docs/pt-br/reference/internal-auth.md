# Autenticação interna

## 1. Escopo

Adiciona um caminho de login autossuficiente para as UIs primárias do
SocTalk, de modo que os operadores possam operar sem um proxy OIDC
upstream. A autorização existente (papéis, `tenant_id`, decorators em
`src/soctalk/core/tenancy/decorators.py:120`, RLS do Postgres) permanece
inalterada. Esta especificação apenas adiciona uma nova fonte de
identidade que produz o mesmo formato de `UserIdentity` já consumido em
`src/soctalk/core/tenancy/auth.py:67`.

Dois modos, selecionados na inicialização do processo e expostos em `/health/live` e `/health/ready`:

```
SOCTALK_AUTH_MODE = internal | proxy
```

- `internal` (padrão para novas instalações): o SocTalk é dono do login,
  das sessões e do armazenamento de senhas. O middleware de handoff de
  ingress fica desativado.
- `proxy`: preserva o comportamento existente de handoff de ingress. Os
  endpoints internos respondem com 404.

Não há modo híbrido. A federação (provisionamento JIT, OIDC SP, etc.) é
uma especificação separada.

## 2. Modelo de dados

Duas novas tabelas. Todo o resto reutiliza modelos existentes.

### `password_credentials`

| column               | type        | notes                                       |
| ---                  | ---         | ---                                         |
| user_id              | uuid PK, FK | referencia `users.id`, cascade ao excluir   |
| password_hash        | text NOT NULL | argon2id, string de hash completa com parâmetros |
| must_change          | bool        | definido pela redefinição do admin          |
| updated_at           | timestamptz |                                             |
| last_used_at         | timestamptz | último login bem-sucedido                   |
| consecutive_failures | int         | zerado no sucesso                           |
| locked_until         | timestamptz | nulo, exceto quando o bloqueio está ativo   |

### `sessions`

Sessões armazenadas no banco. O cookie carrega um session_id opaco; a
linha no banco é a fonte da verdade.

| column          | type        | notes                                |
| ---             | ---         | ---                                  |
| id              | uuid PK     | também o valor do cookie             |
| user_id         | uuid FK     |                                      |
| tenant_context  | uuid        | `current_tenant` capturado no login  |
| created_at      | timestamptz |                                      |
| last_seen_at    | timestamptz | atualizado com throttle (~60s)       |
| absolute_expiry | timestamptz | limite máximo, 12h                   |
| idle_expiry     | timestamptz | desliza com a atividade, 30m         |
| revoked_at      | timestamptz | não nulo desativa a sessão           |
| ip_created      | inet        | observabilidade                      |
| user_agent      | text        | observabilidade                      |

Índice: `(user_id, revoked_at)`.

### Reutilização

- `users` (`src/soctalk/core/tenancy/models.py:156`) — inalterado.
- `audit_log` (`src/soctalk/core/tenancy/models.py:291`) — recebe as
  ações `auth.*` (ver §9).

Nenhuma nova tabela de auditoria. Nenhuma tabela de chave de assinatura
(as sessões são linhas opacas no banco, não JWTs; a assinatura HMAC
existente em `src/soctalk/core/tenancy/auth.py:167` não tem relação com
isso).

## 3. Endpoints

Todos sob `/api/auth/*`. JSON. Rotas que alteram estado protegidas
conforme §6.

| method | path                                          | purpose                                |
| ---    | ---                                           | ---                                    |
| POST   | `/api/auth/login`                             | e-mail + senha, define o cookie de sessão |
| POST   | `/api/auth/logout`                            | revoga a sessão atual                  |
| GET    | `/api/auth/me`                                | payload de identidade atual + `permissions[]` do papel |
| POST   | `/api/auth/password/change`                   | antiga + nova, autenticado             |
| POST   | `/api/mssp/users/{id}/password/reset`         | redefinição forçada pelo admin, define `must_change` |

`/api/auth/me` retorna a identidade mais uma lista `permissions[]` computada, as capacidades que o papel autenticado detém, derivadas do mapa de papel-para-permissão de fonte única da verdade. O frontend controla a navegação e as ações com base nessas permissões em vez de inferi-las a partir da string do papel.

O endpoint de redefinição pelo admin gera uma senha aleatória forte no
lado do servidor e a retorna uma única vez no corpo da resposta; o admin
a entrega ao usuário por um canal externo. A redefinição por e-mail em
autoatendimento fica adiada (§12).

Em `AUTH_MODE=proxy`, todos os endpoints desta tabela respondem com 404.

## 4. Cookie e sessão

### Cookie

Nome: `soctalk_session`.

Atributos:

- `HttpOnly`
- `Secure`
- `SameSite=Lax`
- `Path=/`
- `Domain` omitido (host-only)
- `Max-Age` corresponde ao `absolute_expiry` da sessão

Valor: base64 url-safe do UUID da sessão. Nenhuma claim no cookie.

### Ciclo de vida

- `absolute_expiry = created_at + 12h`. Limite máximo.
- `idle_expiry = last_seen_at + 30m`. Desliza para frente com a atividade.
- Na troca de senha: todas as outras sessões do usuário são revogadas; a
  sessão que fez a troca é preservada para que o usuário permaneça logado
  no dispositivo atual.
- `/api/auth/logout` revoga apenas a sessão atual.
- A redefinição pelo admin revoga todas as sessões do usuário-alvo.

## 5. Política de senhas

- argon2id via `argon2-cffi`.
- Parâmetros: `time_cost=3`, `memory_cost=65536` (64 MiB),
  `parallelism=4`, `hash_len=32`, `salt_len=16`.
- A string de hash armazenada contém seus parâmetros; verifique-e-refaça
  o hash de forma transparente quando os parâmetros divergirem.
- Comprimento mínimo: 12. Sem regras de composição.
- Bloqueio: 10 falhas consecutivas em 15 min definem `locked_until = now() + 15m`. O contador zera em um login bem-sucedido.
- `must_change`: definido pela redefinição do admin. Força o usuário pelo
  fluxo de troca de senha antes de qualquer outro endpoint.

## 6. CSRF

O `SameSite=Lax` no cookie de sessão já bloqueia POST cross-site. Para os
métodos que alteram estado (`POST`, `PATCH`, `DELETE`, `PUT`), o
middleware adicionalmente impõe:

- Se `Origin` estiver presente, ele precisa corresponder a uma das
  origens primárias configuradas. A configuração é uma lista/padrão, não
  um valor único, porque as instalações servem tanto o host do MSSP
  (`mssp.example.com`) quanto um host de cliente por tenant em curinga
  (`*.customers.example.com`). A fixação de origem única daria 403 em
  todo POST vindo da UI que não fosse a fixada.
- Caso contrário, se `Referer` estiver presente, seu componente de origem
  precisa corresponder à mesma allow-list.
- Caso contrário, rejeite com 403.

A allow-list deriva dos hostnames de UI configurados nos valores do chart
(`ingress.hostnames.mssp`, `ingress.hostnames.customer`), de modo que os
operadores não a mantenham separadamente.

## 7. Middleware

O novo middleware `internal_session_middleware` substitui
`ingress_handoff_middleware` quando `SOCTALK_AUTH_MODE=internal`.

Por requisição:

1. Ler o cookie `soctalk_session`.
2. Buscar a linha da sessão. Rejeitar se estiver ausente, revogada, além
   do `absolute_expiry` ou além do `idle_expiry`.
3. Atualizar `last_seen_at` (com throttle — escrever no máximo a cada 60s).
4. Carregar o usuário e construir o mesmo formato de `UserIdentity`
   produzido pelo caminho. Definir `request.state.user_identity`
   exatamente como hoje, de modo que os decorators e os helpers de
   contexto de RLS fiquem intocados.

Rate limiting: tentativas de login por IP e por e-mail a cada 15 minutos,
aplicadas antes da consulta ao banco. Contador em processo para o beta;
troque por Redis quando precisarmos de escala horizontal.

## 8. UI/UX

Duas UIs primárias ganham recursos de autenticação: o console do MSSP
(`frontend/mssp`) e o portal do cliente (`frontend/customer`). Ambos são
apps SvelteKit conversando com a mesma API.

### Página de login

Ambos os apps ganham `/login`:

- Card centralizado. Dois campos (E-mail, Senha). Um único botão primário
  rotulado "Entrar".
- O portal do cliente lê o nome do app e o logo a partir do
  `BrandingConfig` do tenant, para que a página pareça nativa da marca do
  MSSP. O console do MSSP usa a marca padrão do nível da instalação.
- Foco inicial no E-mail. Enter envia. Nomes de campo padrão para que os
  gerenciadores de senhas do navegador façam o autofill de forma limpa.
- Estados de erro (sem enumeração de usuários):
  - Credenciais inválidas → "E-mail ou senha incorretos."
  - Conta bloqueada → "Esta conta está temporariamente bloqueada. Tente
    novamente às {unlock_time}."
  - Erro do servidor → "Algo deu errado. Tente novamente."
- Pequena linha utilitária embaixo: "Entre em contato com seu
  administrador se você perdeu o acesso." Sem link de redefinição em
  autoatendimento nesta especificação.

### Troca forçada (`must_change`)

Quando o login é bem-sucedido contra uma credencial com
`must_change=true`, a resposta do servidor sinaliza a troca como o próximo
passo. A UI navega direto para `/account/password` — sem flash do
dashboard.

Enquanto `must_change` estiver definido, qualquer rota exceto
`/account/password` e `POST /api/auth/logout` redireciona de volta para
`/account/password`. Um pequeno banner âmbar exibe "Seu administrador
exige que você defina uma nova senha antes de continuar."

### Página de troca de senha

`/account/password`:

- Três campos: Senha atual, Nova senha, Confirmar nova senha.
- Validador inline apenas para a regra de comprimento ≥12. Sem medidor de
  composição.
- No sucesso, exiba uma confirmação e a nota "Outros dispositivos foram
  desconectados. Você continua conectado aqui."
- Acessível pelo menu de conta e obrigatória durante o `must_change`.

### Menu de conta

No cabeçalho de ambos os apps, visível quando autenticado:

- E-mail do usuário.
- Rótulo do papel ("MSSP admin", "Analyst", "Customer viewer", etc.).
- Link para "Trocar senha".
- "Sair" — `POST /api/auth/logout`, depois navega para `/login` com uma
  mensagem de flash "Você foi desconectado."

### Redefinição pelo admin (console do MSSP)

Na página de detalhes do usuário no console do MSSP:

- Botão "Redefinir senha", restrito por permissão a `platform_admin` e
  `mssp_admin`.
- O modal de confirmação explica: "Gera uma senha de uso único, revoga
  todas as sessões ativas deste usuário e o força a trocá-la no próximo
  login."
- Ao confirmar, o servidor retorna a senha gerada uma única vez. A UI a
  renderiza em um campo de copiar-para-a-área-de-transferência com "Copiar
  e fechar". Depois que o modal fecha, a senha não é mais recuperável — o
  admin a compartilha por um canal externo.

### Expiração de sessão

- Em qualquer 401 retornado a uma sessão autenticada, a SPA navega para
  `/login?expired=1&next=<current-url>`.
- A página de login lê `expired=1` e exibe "Sua sessão expirou. Faça login
  novamente." A UI não distingue entre expiração absoluta e por
  inatividade.
- Após um login bem-sucedido, a SPA navega para `next`, se presente e de
  mesma origem; caso contrário, para a rota de destino padrão daquela UI.

### Estados vazios e de erro

- Primeiro carregamento sem sessão → redireciona para `/login` (sem flash).
- Página de login já autenticado → redireciona para a rota de destino
  padrão (não deixe o usuário preso em um formulário de que não precisa).
- Erros de rede durante o login → mantenha o formulário, renderize inline
  "Não foi possível alcançar o servidor. Verifique sua conexão e tente
  novamente."

### Acessibilidade

- Todos os inputs têm elementos `<label>` associados. Os erros usam
  `role="alert"` para que leitores de tela os anunciem.
- A ordem de foco é natural (e-mail → senha → enviar).
- Sem CAPTCHA. O bloqueio somado ao rate limiting por IP/e-mail cobre
  abusos na escala de um MSSP; o CAPTCHA quebra o fluxo de leitores de
  tela e adiciona sobrecarga operacional.
- Alvo de toque mínimo de 44×44px para a ação primária no mobile.

## 9. Auditoria

Emita os seguintes valores de `action` no `audit_log` existente:

- `auth.login.success`
- `auth.login.failure` (`details.reason` em `{bad_password, unknown_email, locked}`)
- `auth.logout`
- `auth.password.changed`
- `auth.password.reset.admin` (redefinição de outro usuário disparada pelo admin)
- `auth.lockout.triggered`

`actor_id` é o id do usuário que agiu, ou `system:auth` para disparos de
bloqueio. `tenant_id` é copiado do usuário que agiu.

## 10. Migração de `proxy` para `internal`

1. Aplique a migração que cria §2.1 e §2.2. As linhas de `users`
   existentes não são afetadas.
2. Faça o deploy da nova versão do app. `SOCTALK_AUTH_MODE=proxy` preserva
   o comportamento existente.
3. Para cada usuário que se espera usar o login interno, o operador executa
   `soctalk auth set-password <email>` (nova CLI; grava uma linha em
   `password_credentials` e emite `auth.password.reset.admin`).
4. O operador vira `SOCTALK_AUTH_MODE=internal` e reinicia. O middleware
   de handoff de ingress é removido do pipeline.

Rollback: vire a flag de volta e reinicie.

## 11. Testes

Suíte de backend obrigatória (estilo postgres-rls §9):

1. O caminho feliz de login cria uma linha de sessão com o
   `tenant_context` correto e define o cookie.
2. Senha errada incrementa `consecutive_failures`; dez consecutivas
   disparam `locked_until`; tentativas seguintes são rejeitadas mesmo com
   a senha correta.
3. `must_change` bloqueia todo endpoint que não seja de senha até uma
   troca bem-sucedida.
4. A troca de senha revoga todas as outras sessões do usuário, mas preserva
   a atual.
5. O logout revoga apenas a sessão atual.
6. A redefinição pelo admin revoga todas as sessões do usuário-alvo e força
   `must_change`.
7. `AUTH_MODE=proxy`: `/api/auth/*` e o endpoint de redefinição do admin
   retornam 404. O caminho de handoff de ingress continua funcionando.
8. CSRF: requisição que altera estado com um `Origin` estranho é rejeitada
   com 403.
9. Sessão além do `absolute_expiry` ou do `idle_expiry` é rejeitada; a
   linha não é excluída automaticamente (retida para auditoria).

Suíte de smoke com Playwright para cada UI:

1. Login com credenciais válidas cai na rota padrão e mostra o menu de
   conta.
2. Login com credenciais ruins mostra o erro genérico sem enumerar.
3. `must_change` no login cai na página de troca e não consegue navegar
   para outro lugar.
4. A troca de senha é bem-sucedida e mantém o login.
5. O modal de redefinição do admin expõe a senha gerada uma única vez;
   fechar o modal a oculta.
6. Sessão expirada em uma rota protegida encaminha para `/login?expired=1`
   com o flash e preserva `next`.

## 12. Adiado

Fora do escopo desta especificação. Ordenado pela probabilidade de
reincorporação:

1. `password_reset_tokens` — redefinição de senha por e-mail em
   autoatendimento.
2. MFA (TOTP + códigos de recuperação), com os passos de UI
   correspondentes nos fluxos de login e de conta.
3. Inventário de sessões (`GET /api/auth/sessions`, revogação específica,
   logout-all) com um painel "Dispositivos" na página de conta.
4. Personificação (mssp_admin → sessões de usuário do tenant), com um
   banner claro na UI durante a personificação.
5. OIDC SP / federação (especificação separada).
6. OIDC issuer (especificação separada; apenas se surgir um consumidor
   concreto).
7. Rotação de chave de assinatura + JWKS (necessário apenas quando
   emitirmos tokens sem estado externamente).
