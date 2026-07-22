---
title: Maintenir la facture du triage par IA aussi basse que possible
description: "Dès que le triage par IA fonctionne, la question suivante est la facture. Batching et cache, étagement des modèles, modèles hébergés moins chers et auto-hébergement sur GPU louées ou locales, avec coût et latence mesurés pour réduire la facture du modèle au minimum."
---

# Maintenir la facture du triage par IA aussi basse que possible

Dès que le triage par IA fonctionne, la question suivante est la facture. Chaque alerte qui atteint un modèle coûte de l'argent, et à un volume d'alertes réel ce chiffre grimpe vite. La plus grande partie de cette facture est facultative.

SocTalk garde d'abord la plupart des alertes loin d'un modèle, par déduplication, coalescence, corrélation et clôture déterministe (voir [Comment ça marche](/fr-fr/how-it-works)), de sorte que la dépense restante se concentre sur les alertes qui exigent réellement un jugement. Ce guide traite de la réduction de cette dépense résiduelle au minimum, sans céder plus de qualité que ce que vous avez mesuré, et sans faire sortir de contenu d'alerte sensible de votre périmètre.

Les options ci-dessous sont ordonnées de la moins chère et la plus sûre à la moins. La plupart des déploiements n'atteignent jamais la dernière.

## Batching et cache avant tout

Deux fonctions gérées sur les API de frontière réduisent le coût sans changer la qualité du modèle.

**La Batch API** traite les requêtes de façon asynchrone contre une remise fixe, et la sortie est identique. SocTalk s'y prête sans effort. La fenêtre de settle retient déjà une exécution pour que les alertes corrélées s'accumulent, et une exécution est asynchrone par nature, donc le triage n'est pas un chemin sensible à la latence.

**Le cache de prompts (prompt caching)** facture la partie répétée d'un prompt à une fraction du tarif d'entrée. Les prompts de supervisor et de verdict de SocTalk portent un grand préfixe stable, le prompt système et les définitions d'outils, avec le contenu volatile propre à chaque cas à la fin, donc la fraction cacheable est réelle et déjà utilisée sur le chemin Anthropic.

Activez les deux et mesurez le nouveau coût par exécution avant d'envisager quoi que ce soit ci-dessous. Ni l'un ni l'autre ne touche à la qualité, il n'y a donc aucune raison de les sauter.

## Mettez un modèle moins cher sur le travail moins cher

Une exécution de triage utilise un modèle dans deux rôles : un supervisor qui route l'investigation, décidant quoi enrichir ensuite et quand décider, et un verdict qui pèse les preuves. Le routage est la tâche la plus légère. SocTalk résout chaque rôle vers son propre tier, et chaque tier pointe vers son propre provider, modèle et endpoint, donc le router peut tourner sur un modèle plus petit pendant que le verdict garde le modèle capable. C'est de la configuration, pas de l'infrastructure nouvelle.

## Modèles hébergés moins chers, avec une réserve

Plusieurs provider servent des modèles ouverts quasi-frontière qui peuvent passer sous les API de frontière, selon le provider, le modèle et la charge. Ils conviennent aux cas courants, à moindre risque, où un modèle ouvert quasi-frontière suffit. Pour le travail de sécurité la contrainte est la gouvernance des données plutôt que le prix : envoyer des alertes clients à une API tierce, surtout dans une autre juridiction, fait sortir ces données de votre contrôle. Si c'est un non catégorique pour vos tenants, la section suivante garde les données à l'intérieur de votre frontière.

## Auto-héberger le modèle

L'auto-hébergement est la plus grande économie, et la seule option qui garde le contenu des alertes dans votre périmètre. SocTalk consomme un modèle auto-hébergé de la même façon qu'une API de frontière, en pointant un tier vers un endpoint compatible OpenAI. Il classe le backend par son modèle de livraison, une API gérée à chaud, une GPU serverless qui descend à zéro, une GPU louée toujours allumée, ou une instance locale, pour que le coût et l'ordonnancement se comportent correctement pour chacun.

Où le faire tourner est un vrai compromis.

- **Une plateforme de GPU serverless gérée** (par exemple Modal) déploie le modèle derrière un endpoint compatible OpenAI, descend à zéro à l'inactivité et facture à la GPU-seconde. Vous ne payez que pendant qu'il tourne et il n'y a pas de serveur à exploiter, à un tarif horaire plus élevé qu'une location brute.
- **Une place de marché de location de GPU** (par exemple RunPod) loue des GPU grand public proches de ce qu'un petit déploiement auto-hébergé achèterait, à un tarif horaire plus bas. En échange, vous gérez le cycle de vie. Un pod facture jusqu'à ce que vous l'arrêtiez, les démarrages à froid prennent des minutes, et la disponibilité sur les paliers les moins chers varie.
- **Une instance locale** (par exemple [Ollama](/fr-fr/integrate/ollama)) tourne sur du matériel que vous possédez déjà, sans frais mesuré par requête et sans que rien ne quitte la machine, bornée par le débit de cette seule machine.

## Ce qui fait l'économie, c'est l'utilisation, pas la carte

Un serveur auto-hébergé n'est bon marché que lorsque son batch continu est plein. Une seule requête à la fois laisse la GPU sous-utilisée et rend l'auto-hébergement plus cher qu'il ne devrait. SocTalk fait tourner plusieurs investigations en concurrence par worker, donc plusieurs requêtes sont en vol contre le backend à la fois et le batch se remplit.

Dans nos benchmarks, remplir le batch à huit requêtes concurrentes a élevé le débit agrégé d'environ six à huit fois par rapport à une-à-la-fois et a ramené le coût par requête à environ 13 à 17 pour cent du cas série, sur les exécutions testées avec L40S, A10G, L4, RTX 3090 et RTX 4090. L'utilisation a fait le plus gros du travail. C'est la concurrence, pas la carte, qui a fait passer l'auto-hébergement d'inefficace à moins cher que la ligne de base série dans ces exécutions.

## Ce que ça coûte, mesuré

Ces chiffres viennent de nos propres benchmarks d'un modèle ouvert 7B sur un ensemble fixe de cas de triage à huit voies de concurrence. Ce sont des repères, pas une garantie. Votre modèle, votre matériel et votre mix d'alertes les feront bouger.

Par triage complet, l'auto-hébergement sur une GPU grand public louée est ressorti environ deux à trois ordres de grandeur moins cher qu'un appel d'API de frontière non optimisé, et plusieurs fois moins cher que le même modèle sur une plateforme serverless gérée, parce que la carte louée testée était à la fois moins chère à l'heure et, dans ces exécutions, plus rapide. Le tarif plus élevé de la plateforme gérée achète la descente à zéro et l'absence d'exploitation. Le prix plus élevé de l'API de frontière achète un tier de modèle géré qui peut convenir aux cas plus durs, sans infrastructure à exploiter.

La latence est restée pratique. L'ensemble de 12 cas s'est terminé en environ une minute sur une Modal A10G et en environ 11 secondes sur une RunPod 4090, toutes deux à huit voies de concurrence, au lieu des plusieurs minutes qu'une estimation en flux unique laisse supposer, parce que la concurrence chevauche les appels et que les verdicts réels tiennent dans le budget de tokens.

Pour les tableaux complets derrière ces chiffres, les balayages de débit, les prix des RTX réelles et les temps de triage par exécution, voir [ce que coûte réellement l'inférence de triage, mesuré](/fr-fr/guides/inference-cost-benchmark).

## Si un petit modèle suffit

Le coût ne compte que si le modèle bon marché tient. Dans nos exécutions, un modèle ouvert 7B a tenu le contrat de triage structuré de SocTalk : sortie router et verdict valide, aucune erreur de schéma, et des verdicts qui ont concordé avec un modèle de raisonnement plus grand sur environ 58 à 75 pour cent d'un petit échantillon de benchmark. Il était plus faible sur le routage, et sur les cas sensibles à l'autorisation il a parfois clôturé une activité qui n'avait aucune autorisation au dossier et aurait dû être escaladée.

Un petit modèle auto-hébergé est donc un tier bon marché viable pour le gros du courant, avec un modèle capable derrière lui pour les cas difficiles. Savoir s'il suffit pour votre environnement est une mesure, pas une supposition, et cela se fait contre un benchmark représentatif avant de confier à un petit modèle la moindre décision de clôture. Le safety floor tient de toute façon. Aucun modèle ne peut clôturer sur un signal malveillant connu ni sur un cas connexe actif, quelle que soit la manière dont il a été servi.

## Limites à anticiper

- **Démarrages à froid.** Un backend descendu à zéro ou fraîchement loué n'est pas prêt instantanément. Le téléchargement et le chargement du modèle prennent des minutes, donc une rafale qui arrive à froid attend. Bien pour le triage courant, un problème pour tout ce qui est urgent, d'où l'intérêt d'un tier de repli à chaud.
- **Charge opérationnelle sur les locations.** Une GPU louée facture jusqu'à ce que vous l'arrêtiez et n'a pas de descente à zéro, donc le temps mort est de l'argent perdu et le démontage est à vous d'y penser. La disponibilité sur les paliers les moins chers varie.
- **Comptabilité des coûts.** Un budget par token est la bonne unité pour une API de frontière et la mauvaise pour un backend à la GPU-seconde. Comptez selon l'unité de facturation propre au backend quand vous auto-hébergez.
- **La gouvernance des données est un spectre.** Le masquage retire les secrets avant que quoi que ce soit ne parte, mais le contexte opérationnel, hôtes, comptes, contenu des logs, voyage quand même vers une API externe. Seul l'auto-hébergement dans la frontière garde ce contexte dans votre périmètre.

## Choisir où faire tourner le modèle

Trois questions tranchent. **Utilisation.** Une charge stable et à forte utilisation favorise une carte louée ; une charge sporadique et en rafales favorise une plateforme qui descend à zéro ou une API gérée dont le coût à l'inactivité est nul. **Appétit opérationnel.** Une location est la moins chère mais vous l'exploitez ; une plateforme serverless coûte plus mais s'exploite seule ; une API coûte le plus sans rien à exploiter. **Sensibilité des données.** Si le contenu des alertes ne peut pas quitter votre frontière, l'auto-hébergement est la seule réponse, et le travail ci-dessus est comment vous le rendez abordable.

Pour la plupart des équipes l'ordre est le même que ce guide. Batching et cache d'abord, le routeur sur un modèle moins cher ensuite, et un tier auto-hébergé seulement une fois que le volume et le besoin de résidence des données justifient de l'exploiter.

**Avertissement.** SocTalk n'est ni affiliée, ni approuvée, ni sponsorisée par aucun fournisseur de service LLM ou GPU. Modal, RunPod, Anthropic, OpenAI, Ollama et tout autre service nommé dans ce guide ne sont mentionnés qu'à titre d'exemples d'endroits où un modèle peut tourner. Les chiffres de coût et de performance sont nos propres observations de benchmark, pas des chiffres publiés par les fournisseurs, et tous les noms de produits et marques appartiennent à leurs détenteurs respectifs.
