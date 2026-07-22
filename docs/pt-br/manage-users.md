# Gerenciando usuários: um passo a passo

Este guia percorre o provisionamento de um login e a execução de todo o seu ciclo de vida a partir da UI, nos dois lados do negócio: a equipe MSSP a partir do painel **Staff Users**, e o pessoal do próprio cliente a partir do painel **Users** do tenant. Os dois painéis espelham um ao outro, então, depois de fazer um, o outro já parece familiar. Para o modelo por trás de tudo isso, quais funções existem e o que cada uma pode fazer, consulte [Usuários e funções](/pt-br/users-and-roles); esta página é o passo a passo clicável.

Tudo aqui é feito por um administrador. No lado MSSP, isso é um `mssp_admin` ou `platform_admin`. No lado do tenant, é o próprio `tenant_admin` daquele cliente, atuando apenas dentro de sua organização. Nenhum dos dois consegue atravessar a barreira de audiência: um administrador MSSP nunca atribui uma função de tenant, e um administrador de tenant nunca atribui uma de MSSP.

## Provisionando a equipe MSSP

Faça login como administrador MSSP. O painel que você procura é **Staff Users**, na barra lateral, que só aparece para uma conta que detém o gerenciamento de usuários.

![A página de login do SocTalk](/screenshots/iam-mssp-01-login.png)

Abra **Staff Users** e escolha **+ Add user**. Informe o e-mail da pessoa, um nome de exibição opcional e selecione a função que corresponde ao cargo. Um analista trabalha a fila entre os clientes, um gerente autoriza risco e um administrador configura o sistema e gerencia usuários. A lista de funções aqui contém apenas funções MSSP; uma função de tenant não é oferecida, porque não poderia ser atribuída a partir deste lado.

![Adicionando um usuário da equipe MSSP com uma função selecionada](/screenshots/iam-mssp-02-add-user.png)

Ao enviar, cria-se o login e retorna-se uma senha temporária de uso único. Copie-a agora e entregue-a à pessoa por um canal separado, pois ela é exibida uma única vez e nunca mais pode ser recuperada em texto simples. É solicitado que a pessoa a altere no primeiro login. O novo usuário aparece na lista abaixo do formulário, ativo, com a função que você atribuiu.

![A senha temporária de uso único e o novo usuário na lista](/screenshots/iam-mssp-03-created.png)

## Alterando uma função

As funções mudam no local. Selecione uma nova função no seletor da linha da pessoa e ela é salva imediatamente. Aqui o analista é promovido a gerente.

Uma alteração de função revoga as sessões ativas daquele usuário, de modo que a nova autoridade entra em vigor de imediato, em vez de esperar a sessão antiga expirar. Se a pessoa estava logada, sua próxima requisição a envia de volta para o login.

![Promovendo o analista a gerente pelo seletor da linha](/screenshots/iam-mssp-04-promoted.png)

## Desativando e reativando

**Deactivate** na linha desliga a conta. O status é invertido e todas as sessões ativas são revogadas no mesmo instante, de modo que alguém que já esteja logado é desconectado, em vez de permanecer até a sessão expirar por inatividade. A camada de sessão também recusa uma conta inativa em cada requisição, o que fecha a lacuna contra um login que estava em andamento no momento em que você desativou a conta.

![O usuário desativado, com Reactivate agora disponível](/screenshots/iam-mssp-05-deactivated.png)

A desativação é reversível. **Reactivate** na mesma linha coloca a conta como ativa novamente. Ela volta com a função que tinha; nada de seu histórico é perdido.

![O usuário reativado e de volta ao estado ativo](/screenshots/iam-mssp-06-reactivated.png)

## O lado do tenant, de ponta a ponta

Um `tenant_admin` executa o mesmo ciclo de vida para sua própria organização, a partir do painel **Users**. É isso que torna as funções de tenant utilizáveis de fato; sem isso, um cliente teria apenas o único administrador criado quando o tenant foi provisionado (onboarding). O canto superior direito mostra o tenant em que você está atuando, e cada usuário que você cria é criado nesse tenant. O tenant é obtido da sua sessão, nunca do formulário, e o banco de dados o impõe, de modo que um administrador de tenant só pode criar usuários dentro de sua própria organização.

Escolha **+ Add user**, informe um e-mail e um nome opcional e selecione uma função. As opções são as funções de tenant: um visualizador que apenas observa, um analista que opera o SOC, um gerente que autoriza risco e um administrador. Aqui um novo analista é provisionado para a Acme Corp.

![Adicionando um usuário de tenant a partir do painel Users do cliente](/screenshots/iam-tenant-01-add-user.png)

Assim como no lado MSSP, criar o usuário retorna uma senha temporária de uso único a ser entregue por um canal separado, e o novo analista entra na lista.

![O usuário de tenant criado, com sua senha de uso único](/screenshots/iam-tenant-02-created.png)

As alterações de função funcionam da mesma maneira. Promova o analista a gerente pelo seletor da linha, e a alteração é salva e suas sessões são revogadas imediatamente.

![Promovendo o analista de tenant a gerente](/screenshots/iam-tenant-03-promoted.png)

Deactivate desliga a conta e revoga suas sessões,

![O usuário de tenant desativado](/screenshots/iam-tenant-04-deactivated.png)

e Reactivate a traz de volta.

![O usuário de tenant reativado](/screenshots/iam-tenant-05-reactivated.png)

## Os guardrails que sempre se aplicam

Algumas regras valem em toda alteração, nos dois lados, e a UI as impõe em vez de confiar que você se lembre delas:

- Você não pode modificar sua própria conta. Não há autorrebaixamento nem autobloqueio.
- Você não pode remover o último administrador ativo. Uma alteração que deixaria um tenant sem nenhum `tenant_admin` ativo, ou a instalação sem nenhum `mssp_admin` ou `platform_admin` ativo, é recusada. A verificação bloqueia as linhas candidatas, de modo que dois administradores que se rebaixam mutuamente no mesmo instante não conseguem ambos escapar.
- Um `platform_admin` existente só pode ser alterado, desativado ou ter sua senha redefinida por outro `platform_admin`.

## Redefinindo uma senha

Não há um fluxo de "esqueci a senha" de autoatendimento nesta versão. Quando alguém fica bloqueado, um administrador redefine a senha. No lado MSSP, um `mssp_admin` ou `platform_admin` redefine a senha de qualquer usuário, MSSP ou tenant, e a redefinição retorna uma nova senha de uso único e revoga as sessões existentes daquele usuário. O endpoint exato e o fallback via CLI para casos de bootstrap e offline estão em [Usuários e funções](/pt-br/users-and-roles#password-reset).

## Fazendo isso pela API

Toda ação acima tem um equivalente na API sob `/api/mssp/users` e `/api/tenant/users`, incluindo criar, listar, alterar função, desativar e reativar. Os formatos de requisição, a capacidade exigida por cada uma e as regras de audiência e escopo de tenant estão documentados em [Usuários e funções](/pt-br/users-and-roles#creating-tenant-users). A UI é uma camada fina sobre esses endpoints, então qualquer coisa que você possa clicar você pode automatizar.
