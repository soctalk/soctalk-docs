# Autorisation

## Cette activité était-elle autorisée ?

La plupart de ce qu'un SOC fait remonter n'est pas malveillant. Il s'agit d'une personne ou d'un système réel effectuant un travail réel qui, par hasard, ressemble à une attaque : un administrateur utilisant un compte break-glass à 3 h du matin, un pipeline de déploiement touchant un fichier de configuration, un scanner balayant un sous-réseau pendant un pentest autorisé. Le caractère bénin d'une alerte dépend souvent non pas de l'alerte elle-même, mais de l'état de l'organisation qui l'entoure. Deux alertes identiques au bit près peuvent avoir des dispositions opposées selon le seul fait qu'un ticket de changement, une fenêtre de maintenance ou une baseline approuvée couvre ou non l'activité.

L'autorisation est la couche qui donne à SocTalk ce contexte d'état organisationnel. Elle lie des enregistrements typés (tickets de changement, baselines permanentes, gels de changement, interdictions et faits d'entité concernant les actifs et les comptes) à l'activité d'une alerte, et raisonne pour déterminer si un enregistrement unique la couvre entièrement. Elle ne fait jamais qu'abaisser la suspicion en trouvant des preuves de couverture. Elle ne l'augmente jamais, et elle ne prime jamais sur un signal malveillant.

Ce n'est pas une étape distincte greffée sur le triage. C'est un contexte que la boucle agentique rassemble pendant qu'elle enquête, et qui se résout en l'un des trois états qui façonnent le verdict. Tout ce qui se trouve en aval passe toujours par le plancher de sécurité, que l'autorisation ne peut jamais affaiblir.

![Où l'autorisation s'inscrit dans le flux de triage](/diagrams/authorization-in-triage.svg)

## Couvert, contredit, absent

L'autorisation de chaque alerte se résout en l'un des trois états, et la différence entre les deux derniers, c'est tout l'enjeu :

- **Couvert.** Un enregistrement unique couvre entièrement l'activité : le bon sujet, la bonne cible, la bonne action, la bonne fenêtre temporelle, la validité calendaire et les approbations. La suspicion est abaissée.
- **Contredit.** Des enregistrements sont au dossier mais aucun ne couvre, ou une interdiction de haute priorité proscrit l'action. Un ticket de changement existe mais il a expiré, ou il concerne un autre hôte, ou le gel de changement dont il avait besoin n'a jamais fait l'objet d'une exception. C'est une constatation, pas une absence, et cela remonte à un humain.
- **Absent.** Il n'existe au dossier aucun enregistrement du bon type. L'absence n'est jamais traitée comme une autorisation. SocTalk demande davantage d'informations plutôt que de supposer que l'activité a été approuvée.

Distinguer l'absent du contredit est important. Un ticket périmé ou erroné ne doit jamais être lu comme « proche de l'autorisé ». C'est l'inverse : les documents qui auraient dû couvrir ceci ne le font pas, et cela mérite l'attention d'un humain.

## D'où proviennent les faits d'autorisation

Les faits atteignent le magasin de trois manières, par ordre de confiance croissant :

- **Les tenants affirment des faits sur leur propre environnement.** Un client déclare une fenêtre de maintenance ou une baseline permanente depuis la zone Autorisation. Les faits affirmés par le tenant arrivent en attente et n'influencent pas le triage tant qu'un analyste MSSP ne les a pas approuvés.
- **Les systèmes transmettent des faits via l'API d'ingestion.** Les scripts de provisionnement, les hooks CI et les connecteurs soumettent des faits typés avec un identifiant par tenant. La confiance est estampillée à partir de l'identifiant, jamais du payload, car quiconque peut transmettre un fait peut supprimer une détection.
- **Les analystes répondent à une question d'autorisation.** Lorsque le triage se bloque spécifiquement parce que l'autorisation est absente, l'analyste répond une fois et la réponse devient un enregistrement réutilisable. C'est le flux ci-dessous.

## Répondre à une question d'autorisation

Lorsqu'une enquête ne peut être tranchée parce que l'autorisation est absente, et qu'il n'y a aucun signal malveillant, l'examen porte une question d'autorisation typée plutôt qu'une demande générique d'informations complémentaires. On demande une seule chose à l'analyste : cette activité était-elle autorisée ?

![La question d'autorisation typée sur un examen, avec une action d'enregistrement](/screenshots/authz-ask-question.png)

Le panneau énonce l'activité exacte en question et propose une seule action, distincte de l'approbation ou du rejet. Si l'activité était autorisée, l'analyste définit la durée pendant laquelle l'autorisation doit tenir et choisit **Confirmer autorisé, enregistrer une autorisation réutilisable**. Cela écrit un octroi durable affirmé par l'analyste, cadré exactement sur cette activité (ce compte, cette action, cet hôte) avec l'expiration choisie.

![L'autorisation réutilisable enregistrée, et l'examen retiré de la file](/screenshots/authz-ask-saved.png)

L'octroi enregistré est l'essentiel. La prochaine fois que la même activité produira une alerte, un enregistrement la couvre désormais, de sorte que la question n'est pas reposée. Demander une fois, se souvenir. L'autorisation est cadrée sur l'activité exacte et porte une expiration, de sorte qu'elle ne s'élargit pas silencieusement ni ne perdure éternellement, et elle apparaît dans la zone Autorisation où elle peut être examinée ou révoquée à tout moment.

Une règle est délibérée : un fait n'est créé que par cette réponse explicite. SocTalk n'apprend jamais une autorisation à partir d'une simple clôture ou d'un rejet. Un analyste qui vide la file n'est pas la même chose qu'un analyste qui déclare qu'une activité est sanctionnée, et traiter cela ainsi laisserait la pression de la file empoisonner discrètement le magasin.

## Les garde-fous

L'autorisation est une surface de suppression, ses limites sont donc appliquées dans le code, et non laissées à la formulation d'un prompt :

- **L'absence ne clôt jamais automatiquement.** L'absence d'enregistrement de couverture signifie qu'un humain décide, jamais une clôture automatique.
- **L'autorisation ne prime jamais sur un signal malveillant.** Un fait « autorisé » enregistré ne peut pas clore une alerte qui porte également une correspondance IOC, un enrichissement malveillant ou une corrélation avec un incident actif. La corrélation s'exécute avant la suppression, et le plancher de sécurité oppose son veto à ces cas indépendamment de tout fait. Une autorisation réutilisable abaisse la suspicion de routine ; elle n'aveugle pas le système face à une attaque réelle qui réutilise la même activité.
- **La mémoire est typée et gouvernée.** Les faits portent une source, un palier de confiance, une portée et une expiration. Ce ne sont jamais des souvenirs de prompt en forme libre, et les faits larges ou privilégiés sont censés passer par un examen.
- **La confiance est hiérarchisée.** Les enregistrements vérifiés par connecteur l'emportent sur ceux affirmés par le système, qui l'emportent sur ceux affirmés par l'analyste, qui l'emportent sur la télémétrie de routine, qui l'emporte sur ceux affirmés par le tenant. Un enregistrement de confiance supérieure corrobore ou prime sur un enregistrement de confiance inférieure.

## Où cela apparaît

Le contexte d'autorisation est restitué dans le raisonnement de l'AI pour chaque enquête qui le porte, de sorte que le modèle pèse lui-même les preuves de couverture au lieu de recevoir un oui ou un non tout fait. Les faits enregistrés, leur statut d'examen et leur expiration sont listés dans la zone **Autorisation** de l'interface, où un analyste peut révoquer n'importe quel fait. Voir [Utilisateurs et rôles](/fr-fr/users-and-roles) pour savoir qui peut affirmer, examiner et répondre, et [Revue humaine](/fr-fr/human-review) pour la file d'examen sur laquelle circule la question d'autorisation.
