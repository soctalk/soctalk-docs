---
title: Ce que coûte réellement l'inférence de triage, mesuré
description: "Les exécutions mesurées derrière le guide de coût : continuous batching sur GPU serverless, vrai silicium RTX grand public sur une place de marché de location, et temps de triage réaliste sur golden alerts avec un petit modèle auto-hébergeable. Débit, dollars par millier, et secondes de triage, avec la méthode et les limites énoncées."
---

# Ce que coûte réellement l'inférence de triage, mesuré

Le [guide de coût](/fr-fr/guides/inference-cost-optimization) avance des affirmations sur ce que coûte l'inférence de triage. Cette page est la mesure derrière elles : nos propres exécutions de benchmark, les tableaux au complet, et la méthode et les limites pour que vous puissiez juger jusqu'où elles portent vers votre propre configuration. Chaque résultat ici est une seule exécution mesurée, pas un résultat statistique et pas un chiffre de fournisseur. Les balayages de débit utilisent des requêtes synthétiques en forme de triage, les prix sont des instantanés lus au moment de l'exécution, et les chiffres de temps de triage et d'exactitude utilisent un golden set fixe de 12 alertes. Votre modèle, votre matériel et votre mix d'alertes feront tout bouger.

Trois choses ont été mesurées, du débit synthétique jusqu'au triage réaliste : combien un full continuous batch économise sur une GPU serverless, comment le vrai silicium grand public se compare aux pièces datacenter qui en tiennent lieu, et combien de temps un vrai triage prend réellement sur un petit modèle auto-hébergeable. Chaque exécution a démoli sa GPU ensuite, donc rien n'est resté à facturer.

## Le continuous batching remplit la GPU

Un modèle ouvert a été déployé par GPU et un nombre croissant de requêtes identiques en forme de triage a été tiré sur l'endpoint OpenAI-compatible de SGLang. Cela mesure le côté backend de ce que débloque la concurrence worker : à mesure que la concurrence client N monte, le continuous batch se remplit, le débit agrégé grimpe, et le coût par requête baisse.

La plateforme serverless n'a pas de cartes RTX grand public, donc des GPU datacenter bas de gamme en tiennent lieu comme proxies : A10G (Ampere 24GB) pour la RTX 3090, L4 (Ada 24GB) pour une carte de classe RTX 4090. Qwen3-14B a besoin d'environ 28GB en bf16 et ne tient pas sur une carte de 24GB avec de la marge de batch, donc les cartes de 24GB font tourner DeepSeek-R1-Distill-Qwen-7B, qui laisse de la place de KV-cache pour un plus grand batch.

| GPU (proxy) | modèle | N=1 tok/s | N=8 tok/s | N=8 speedup | $/1k req, N=1 à N=8 |
|---|---|---|---|---|---|
| L40S (milieu, 48GB) | Qwen3-14B | 24.8 | 146.7 | 5.9x | 4.37 à 0.74 (baisse de 83%) |
| A10G (approx RTX 3090) | DS-R1-7B | 29.2 | 216.7 | 7.4x | 2.09 à 0.28 (baisse de 87%) |
| L4 (approx RTX 4090) | DS-R1-7B | 17.3 | 131.2 | 7.6x | 2.57 à 0.34 (baisse de 87%) |

En série (N=1), la GPU reste sous-utilisée sur chaque carte. Remplir le batch à N=8 a mesuré un débit agrégé de 5.9x à 7.6x et un coût par requête à 13 à 17 pour cent du cas série. Les cartes de 24GB ont montré un speedup plus élevé (7.4 à 7.6x) que la carte de milieu de gamme faisant tourner le 14B (5.9x), parce que le plus petit modèle laisse plus de place de KV-cache pour un plus grand batch. Le tok/s absolu plus faible de la L4 par rapport à l'A10G est attendu, puisque la L4 est une pièce d'inférence à faible TDP, donc il se lit comme un plancher conservateur pour une vraie RTX 4090. Les facteurs d'échelle étaient similaires d'une carte à l'autre, ce qui est le point : c'est l'utilisation, pas la carte, qui pilote l'économie.

## Vrai silicium grand public, sur une place de marché de location

Une place de marché de location de GPU loue les cartes grand public littérales, donc ceci vérifie le vrai matériel que les proxies serverless ne pouvaient que remplacer. Même modèle 7B, même balayage, GPU unique, pod terminé ensuite.

Tarification de location à l'époque, community tier, lue depuis l'API de la place de marché : RTX 3090 $0.22/hr, RTX 4090 $0.34/hr, RTX 5090 $0.69/hr, contre l'A10G $1.10/hr et la L4 $0.80/hr de la plateforme serverless.

Mesuré sur une vraie RTX 3090 :

| N | tok/s (agrégé) | speedup | $/1k req |
|---|---|---|---|
| 1 | 45.8 | 1.00x | 0.267 |
| 4 | 179.0 | 3.91x | 0.068 |
| 8 | 352.2 | 7.69x | 0.035 |

Le speedup de batching a tenu sur du vrai silicium (7.69x à N=8, contre 7.42x sur le proxy A10G et 7.58x sur le proxy L4). La vraie RTX 3090 a tourné plus vite que le proxy A10G (45.8 contre 29.2 tok/s à N=1, 352 contre 217 à N=8), parce que l'A10G est une pièce bridée. Le coût mesuré était plus bas sur la carte louée : $0.035 par 1k requêtes à N=8 contre les $0.282 de l'A10G, environ 8x plus bas dans cette exécution, grâce à une carte moins chère ($0.22 contre $1.10/hr) et un débit plus élevé, sans achat de GPU initial. Le chemin par pod a un démarrage à froid lent (pull d'image plus téléchargement du modèle), donc il a tourné découplé : créer, sonder jusqu'à prêt, balayer, terminer.

## Temps de triage réaliste, et si un petit modèle tient

Les balayages ci-dessus mesuraient un débit de tokens synthétique. Ceci mesure un triage réaliste : l'eval de triage de SocTalk pilotée sur 12 golden alerts à concurrence 8, chronométrant les vrais nodes router et verdict sur de vraies payloads.

DeepSeek-R1-Distill-Qwen-7B, 12 golden alerts, N=8 :

| Provider / GPU | serving | total wall | verdict | routing | schema errors |
|---|---|---|---|---|---|
| Serverless A10G | SGLang | 43.2 s | 5/6 | 2/3 | 0 |
| RTX 4090 louée (secure) | vLLM | 11.3 s | 6/6 | 2/3 | 0 |

Stock contre distillé, tous deux sur la RTX 4090 louée (secure), N=8 :

| Modèle | total wall | verdict | routing | schema errors |
|---|---|---|---|---|
| DeepSeek-R1-Distill-Qwen-7B | 11.3 s | 6/6 | 2/3 | 0 |
| Qwen2.5-7B-Instruct (stock) | 16.7 s | 6/6 | 1/3 | 0 |

Le triage golden réaliste à N=8 a terminé l'ensemble de 12 alertes en 11 à 43 secondes sur ces exécutions, sous la minute. Le 7B a produit zéro schema errors et des scores de verdict de 5/6 à 6/6, donc un petit modèle auto-hébergeable a produit ici une sortie de triage structurée valide. Le Qwen2.5-7B-Instruct stock a lui aussi fonctionné (sortie structurée valide, zéro schema errors, le même score de verdict que le distill) et a traîné derrière le distill d'un cas sur le routing, ce qui est un échantillon de routing trop petit pour se lire fortement.

Coût par triage réaliste, mesuré par node (une exécution agentique complète fait quelques appels, donc multipliez par environ 2 à 3) : l'A10G serverless à $1.10/hr est à environ $1.10 par 1 000 alertes ; la RTX 4090 louée secure à $0.69/hr est à environ $0.18 par 1 000, et community à $0.34/hr environ $0.09 par 1 000.

## Les capacités derrière ces chiffres

Les économies ci-dessus ne sont pas fortuites. Elles viennent d'une petite pile de capacités d'inférence, chacune suivie au grand jour, qui ensemble permettent à une exécution de triage de cibler un backend de frontière ou auto-hébergé et de payer le tarif le plus défendable pour lui. Certaines sont en place aujourd'hui et certaines sont encore en construction ; les liens d'issue montrent où en est chacune.

- **Un substrat de requête uniforme** ([#32](https://github.com/soctalk/soctalk/issues/32)). Chaque exécution de triage est exprimée comme un seul `InferenceRequest`, résolu vers un tier, avec un budget par token, qu'elle atterrisse sur une API de frontière ou une GPU auto-hébergée. Rien en aval n'a besoin de savoir quel backend elle a touché.
- **Une abstraction de livraison** ([#63](https://github.com/soctalk/soctalk/issues/63)). Chaque backend est classé par la façon dont il est livré et facturé, une API de frontière à chaud, une GPU serverless scale-to-zero, une GPU louée toujours allumée, ou une instance locale, pour que le substrat sélectionne le bon driver et distingue un backend à la GPU-seconde d'un backend au token, plutôt que de traiter chaque backend comme une API à chaud facturée au token. La préparation serverless et l'ordonnancement que cette classification permet sont le prochain palier de travail ([#64](https://github.com/soctalk/soctalk/issues/64)).
- **Une concurrence worker qui remplit le batch** ([#61](https://github.com/soctalk/soctalk/issues/61)). Plusieurs investigations tournent à la fois, donc plusieurs requêtes sont en vol contre le backend et le continuous batch se remplit. Ce batch rempli est d'où viennent les baisses de débit et de coût de cette page.
- **Alignement serverless** ([#64](https://github.com/soctalk/soctalk/issues/64), en cours). Tolérance au démarrage à froid, ordonnancement à libération par rafales, et un driver de job asynchrone sont conçus pour permettre à une GPU scale-to-zero d'être consommée sans perdre d'exécutions au profit d'un worker froid, pour que l'économie du scale-to-zero devienne utilisable en production, pas seulement dans un benchmark. Le benchmarking a heurté exactement ce trou, des workers RunPod froids renvoyant un 404 de proxy pendant le spin-up.
- **Un serving auto-hébergé de première classe** ([#13](https://github.com/soctalk/soctalk/issues/13), en cours). Faire tourner le modèle dans votre propre cluster est le déploiement qui garde le contenu des alertes dans votre périmètre, et c'est la cible in-cluster prévue pour l'abstraction de livraison ci-dessus.
- **Une suite de benchmarking et de qualification** ([#33](https://github.com/soctalk/soctalk/issues/33)). Les preuves de cette page sont produites par une suite à deux axes qui sépare la qualité du modèle de la viabilité du serving, pour qu'un petit modèle ouvert soit vérifié contre le contrat de triage structuré avant qu'on lui confie la moindre décision.

En dessous se trouve la colonne vertébrale de comptabilité des coûts : la sélection de provider par tier ([#4](https://github.com/soctalk/soctalk/issues/4)) fait tourner le router plus léger sur un modèle moins cher que le verdict ; une couche de prix ([#5](https://github.com/soctalk/soctalk/issues/5)) empêche qu'un modèle auto-hébergé ou inconnu soit facturé aux tarifs de frontière ; et la sortie structurée imposée ([#3](https://github.com/soctalk/soctalk/issues/3)) est le contrat qu'un petit modèle doit tenir pour être utilisable tout court, ce qui est exactement ce que mesure la colonne schema errors ci-dessus.

## Comment lire ces chiffres

- **Directionnel, pas statistique.** Le golden set fait 12 cas (3 routing, 6 verdict, 3 politique déterministe), donc les chiffres d'exactitude pointent une direction, ils ne qualifient pas un modèle. Un benchmark représentatif est la vraie porte de qualité avant de confier à un petit modèle la moindre décision serrée.
- **Par node, pas par exécution complète.** L'eval chronomètre chaque node comme un seul appel, pas une investigation multi-tour complète, donc les secondes de triage sont par node. Multipliez par environ 2 à 3 pour une exécution complète.
- **Les prix sont un instantané.** Les tarifs de location de GPU et serverless bougent, et ont été lus au moment de l'exécution. Traitez-les comme un ratio entre options, pas comme un devis actuel.
- **Les opérations varient par tier.** Les pods RTX 3090 sur le cloud community comme secure ont échoué à répétition à servir dans une fenêtre de 22 minutes, tandis qu'une RTX 4090 sur cloud secure est montée de façon fiable, donc la carte de tier supérieur sur cloud secure a été le chemin le plus régulier dans ces exécutions. Les pods loués n'ont pas de scale-to-zero, donc le démontage est manuel, et chaque pod a été terminé après chaque exécution.

## Bilan : les meilleures configurations coût-valeur

Si vous voulez la réponse courte, voici ce vers quoi ces exécutions pointent, par situation. Chaque chiffre vient des mesures ci-dessus, donc lisez-le avec les mêmes réserves : exécutions mesurées uniques, prix en instantanés, exactitude directionnelle.

| Situation | La configuration qui a le mieux mesuré ici | Coût observé | Le compromis que vous acceptez |
|---|---|---|---|
| Volume stable, et vous pouvez exploiter une GPU | Une carte grand public louée (une RTX 4090 sur cloud secure est montée de façon fiable là où les 3090 n'y sont pas parvenues), un modèle ouvert 7B sur vLLM ou SGLang, concurrence worker à 8 pour remplir le batch | environ $0.09 à $0.18 par 1 000 alertes, l'ensemble de 12 alertes en environ 11 secondes | Vous gérez le cycle de vie : démarrages à froid, pas de scale-to-zero, démontage manuel |
| Volume en rafales ou à faible charge opérationnelle | Une GPU serverless scale-to-zero gérée, le même 7B sur SGLang, concurrence à 8 | environ $1.10 par 1 000 alertes | Un tarif horaire plus élevé, mais un coût à l'inactivité nul et rien à exploiter ; gardez un repli à chaud pour les rafales urgentes qui arrivent pendant un démarrage à froid |
| Les cas les plus durs, avec un minimum d'opérations | Un modèle de frontière capable pour le verdict avec la Batch API et le prompt caching activés, et le tier auto-hébergé bon marché pour le milieu courant | Le tarif de frontière, mais sur seulement une fraction des alertes | Le plus cher par appel, en échange d'aucune infrastructure et d'un tier de modèle géré plus capable pour les cas les plus durs |
| Le contenu des alertes ne peut pas quitter votre périmètre | Auto-héberger le 7B in-cluster une fois que le serving in-cluster est livré, avec un repli capable et le safety floor en place | Non mesuré ici ; les chiffres d'auto-hébergement loué et serverless ci-dessus sont des proxies directionnels jusqu'à ce que le serving in-cluster arrive | Vous possédez le serving ; le déploiement in-cluster est encore en construction ([#13](https://github.com/soctalk/soctalk/issues/13)) |

Le choix de configuration unique qui a fait le plus de travail dans chaque ligne auto-hébergée était la **concurrence worker à 8**, qui remplit le continuous batch et est d'où viennent le coût à 13 à 17 pour cent et le débit six à huit fois supérieur. Associez-la à un petit modèle qui tient le contrat structuré à zéro schema errors, et à une carte moins chère à l'heure, et démolissez la GPU après chaque exécution. Tout le reste sur cette page est une variation là-dessus.

Pour la plupart des équipes la séquence est celle que le [guide de coût](/fr-fr/guides/inference-cost-optimization) expose : batching et caching d'abord, le router sur un modèle moins cher ensuite, et un tier auto-hébergé seulement une fois que le volume et le besoin de résidence des données justifient de l'exploiter.

**Avertissement.** SocTalk n'est ni affiliée, ni approuvée, ni sponsorisée par aucun fournisseur de service LLM ou GPU, et les plateformes derrière ces exécutions ne sont nommées dans le [guide de coût](/fr-fr/guides/inference-cost-optimization) qu'à titre d'exemples d'endroits où un modèle peut tourner. Les chiffres ici sont nos propres observations de benchmark sur un golden set fixe, pas des chiffres publiés par les fournisseurs, et tous les noms de produits et marques appartiennent à leurs détenteurs respectifs.
