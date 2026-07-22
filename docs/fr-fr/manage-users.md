# Gérer les utilisateurs : un guide pas à pas

Ce guide détaille le provisionnement d'un identifiant de connexion et le déroulement de tout son cycle de vie depuis l'interface, des deux côtés de l'activité : le personnel MSSP depuis le panneau **Staff Users**, et les propres collaborateurs d'un client depuis le panneau **Users** du tenant. Les deux panneaux se reflètent l'un l'autre, si bien qu'une fois l'un maîtrisé, l'autre vous est familier. Pour le modèle qui sous-tend tout cela, quels rôles existent et ce que chacun peut faire, voir [Utilisateurs et rôles](/fr-fr/users-and-roles) ; cette page est le parcours clic par clic.

Tout ce qui figure ici est réalisé par un administrateur. Côté MSSP, il s'agit d'un `mssp_admin` ou d'un `platform_admin`. Côté tenant, il s'agit du `tenant_admin` propre à ce client, agissant uniquement au sein de son organisation. Aucun ne peut franchir le mur d'audience : un administrateur MSSP n'attribue jamais un rôle de tenant, et un administrateur de tenant n'attribue jamais un rôle MSSP.

## Provisionner le personnel MSSP

Connectez-vous en tant qu'administrateur MSSP. Le panneau qu'il vous faut est **Staff Users** dans la barre latérale, qui n'apparaît que pour un compte disposant de la gestion des utilisateurs.

![La page de connexion de SocTalk](/screenshots/iam-mssp-01-login.png)

Ouvrez **Staff Users** et choisissez **+ Add user**. Saisissez l'adresse e-mail de la personne, un nom d'affichage facultatif, et sélectionnez le rôle qui correspond au poste. Un analyste traite la file d'attente pour l'ensemble des clients, un manager autorise le risque, et un administrateur configure le système et gère les utilisateurs. La liste de rôles ici ne comprend que les rôles MSSP ; un rôle de tenant n'est pas proposé, car il ne pourrait pas être attribué depuis ce côté.

![Ajout d'un utilisateur du personnel MSSP avec un rôle sélectionné](/screenshots/iam-mssp-02-add-user.png)

La soumission crée l'identifiant de connexion et renvoie un mot de passe temporaire à usage unique. Copiez-le maintenant et remettez-le à la personne par un canal hors bande, car il n'est affiché qu'une seule fois et n'est jamais récupérable en clair par la suite. Il lui est demandé de le changer à la première connexion. Le nouvel utilisateur apparaît dans la liste sous le formulaire, actif, avec le rôle que vous lui avez donné.

![Le mot de passe temporaire à usage unique et le nouvel utilisateur dans la liste](/screenshots/iam-mssp-03-created.png)

## Changer un rôle

Les rôles se modifient sur place. Choisissez un nouveau rôle dans le sélecteur sur la ligne de la personne et il est enregistré immédiatement. Ici, l'analyste est promu manager.

Un changement de rôle révoque les sessions actives de cet utilisateur, de sorte que la nouvelle autorité prend effet aussitôt plutôt que d'attendre l'expiration de l'ancienne session. S'il était connecté, sa requête suivante le renvoie vers la page de connexion.

![Promotion de l'analyste au rang de manager depuis le sélecteur de ligne](/screenshots/iam-mssp-04-promoted.png)

## Désactiver et réactiver

**Deactivate** sur la ligne désactive le compte. Le statut bascule et chaque session active est révoquée au même instant, de sorte qu'une personne déjà connectée est coupée plutôt que de subsister jusqu'à l'expiration de sa session. La couche de session refuse aussi un compte inactif à chaque requête, ce qui comble la faille face à une connexion en cours au moment où vous avez désactivé le compte.

![L'utilisateur désactivé, avec Reactivate désormais proposé](/screenshots/iam-mssp-05-deactivated.png)

La désactivation est réversible. **Reactivate** sur la même ligne rend le compte à nouveau actif. Il revient avec le rôle qu'il avait ; rien de son historique n'est perdu.

![L'utilisateur réactivé et de retour à l'état actif](/screenshots/iam-mssp-06-reactivated.png)

## Le côté tenant, de bout en bout

Un `tenant_admin` exécute le même cycle de vie pour sa propre organisation, depuis le panneau **Users**. C'est ce qui rend les rôles de tenant réellement utilisables ; sans cela, un client ne disposerait que de l'unique administrateur créé lors de l'intégration du tenant. En haut à droite s'affiche le tenant dans lequel vous agissez, et chaque utilisateur que vous créez atterrit dans ce tenant. Le tenant est déterminé par votre session, jamais par le formulaire, et la base de données l'impose, de sorte qu'un administrateur de tenant ne peut jamais créer d'utilisateurs que dans sa propre organisation.

Choisissez **+ Add user**, saisissez une adresse e-mail et un nom facultatif, puis sélectionnez un rôle. Les choix sont les rôles de tenant : un viewer qui se contente d'observer, un analyste qui fait tourner le SOC, un manager qui autorise le risque, et un administrateur. Ici, un nouvel analyste est provisionné pour Acme Corp.

![Ajout d'un utilisateur de tenant depuis le panneau Users du client](/screenshots/iam-tenant-01-add-user.png)

Comme du côté MSSP, la création de l'utilisateur renvoie un mot de passe temporaire à usage unique à remettre par un canal hors bande, et le nouvel analyste rejoint la liste.

![L'utilisateur de tenant créé, avec son mot de passe à usage unique](/screenshots/iam-tenant-02-created.png)

Les changements de rôle fonctionnent de la même manière. Promouvez l'analyste au rang de manager depuis le sélecteur de ligne, et le changement est enregistré et ses sessions révoquées immédiatement.

![Promotion de l'analyste du tenant au rang de manager](/screenshots/iam-tenant-03-promoted.png)

Deactivate désactive le compte et révoque ses sessions,

![L'utilisateur du tenant désactivé](/screenshots/iam-tenant-04-deactivated.png)

et Reactivate le ramène.

![L'utilisateur du tenant réactivé](/screenshots/iam-tenant-05-reactivated.png)

## Les garde-fous qui s'appliquent toujours

Quelques règles valent pour chaque changement, des deux côtés, et l'interface les impose plutôt que de compter sur votre mémoire :

- Vous ne pouvez pas modifier votre propre compte. Pas d'auto-rétrogradation ni d'auto-verrouillage.
- Vous ne pouvez pas supprimer le dernier administrateur actif. Un changement qui laisserait un tenant sans `tenant_admin` actif, ou l'installation sans `mssp_admin` ou `platform_admin` actif, est refusé. La vérification verrouille les lignes candidates, de sorte que deux administrateurs se rétrogradant mutuellement au même instant ne peuvent pas passer tous les deux entre les mailles.
- Un `platform_admin` existant ne peut être modifié, désactivé ou voir son mot de passe réinitialisé que par un autre `platform_admin`.

## Réinitialiser un mot de passe

Il n'existe pas de flux de mot de passe oublié en libre-service dans cette version. Lorsqu'une personne est verrouillée dehors, un administrateur la réinitialise. Côté MSSP, un `mssp_admin` ou un `platform_admin` réinitialise n'importe quel utilisateur, MSSP ou tenant, et la réinitialisation renvoie un nouveau mot de passe à usage unique et révoque les sessions existantes de cet utilisateur. L'endpoint exact et la solution de repli en CLI pour les cas d'amorçage et hors ligne sont dans [Utilisateurs et rôles](/fr-fr/users-and-roles#password-reset).

## Le faire depuis l'API

Chaque action ci-dessus a un équivalent API sous `/api/mssp/users` et `/api/tenant/users`, y compris la création, la liste, le changement de rôle, la désactivation et la réactivation. Les formes de requête, la capacité que chacune requiert, ainsi que les règles d'audience et de cadrage par tenant sont documentées dans [Utilisateurs et rôles](/fr-fr/users-and-roles#creating-tenant-users). L'interface est une fine couche par-dessus ces endpoints, de sorte que tout ce que vous pouvez cliquer, vous pouvez l'automatiser.
