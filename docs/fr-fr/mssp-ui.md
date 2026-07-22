# Visite de l'interface MSSP

Ce qu'un opérateur MSSP voit après la connexion. Lisez cette page une fois avant [Opérations quotidiennes](/fr-fr/operations) afin que les runbooks aient du sens.

## Périmètre : à l'échelle du MSSP vs tenant unique

Chaque utilisateur MSSP dispose de deux périmètres d'exploitation :

- **Tous les tenants** — files d'attente inter-tenants et vues agrégées. C'est le périmètre par défaut pour `mssp_admin`. Le coin supérieur droit affiche une puce **Tous les tenants**.
- **Tenant unique** — l'administrateur MSSP a ouvert le SOC d'un client (la puce indique `Tenant: <name>`). Toutes les vues sont limitées à ce tenant ; le bouton **Effacer** situé à côté de la puce permet de revenir à l'échelle du MSSP.

Le périmètre pilote aussi la barre de navigation. Dans le périmètre à l'échelle du MSSP, vous voyez Tenants dans la barre ; dans le périmètre tenant, elle est masquée car les écrans de détail du tenant prennent sa place.

## Barre de navigation

La barre de gauche est persistante sur chaque page. De haut en bas :

| Icône      | Page              | Ce qu'elle affiche |
|------------|-------------------|---------------|
| SocTalk    | `/`               | Accueil / tableau de bord |
| Tableau de bord | `/`          | Tuiles KPI du MSSP + graphique de débit des enquêtes |
| Tenants    | `/tenants`        | Tous les SOC clients (périmètre à l'échelle du MSSP uniquement) |
| Enquêtes   | `/investigations` | File d'attente inter-tenants des dossiers actifs |
| Examens    | `/review`         | File d'attente des propositions avec revue humaine (human-in-the-loop) |
| Chat       | `/chat`           | Chat opérateur avec l'agent SocTalk |
| Analytique | `/analytics`      | Tendances au niveau du service à travers les tenants |
| Journal d'audit | `/audit`     | Journal d'événements en ajout seul |
| Paramètres | `/settings`       | Fournisseur LLM, bascules d'intégration |
| En ligne / Hors ligne | —      | Indicateur de connexion en temps réel (santé WebSocket) |

En haut à droite de chaque page se trouvent la puce utilisateur (`email`, `role`) et un bouton **Se déconnecter**.

L'interface de l'application est livrée localisée en sept langues, permutables dans l'application depuis le sélecteur de langue, qui liste chaque option sous son propre nom natif : English, Português (Brasil), Español (Latinoamérica), 中文（简体）, Français, Deutsch, Italiano.

## Tableau de bord

![Tableau de bord MSSP](/screenshots/mssp-dashboard.png)

Des tuiles KPI sur la rangée supérieure (Enquêtes ouvertes, Examens en attente, Temps moyen de triage, Temps moyen de verdict) et une seconde rangée de compteurs opérationnels (Créées aujourd'hui, Clôturées aujourd'hui, Escalades, Clôturées automatiquement, IOC malveillants).

Sous les tuiles :

- **Débit des enquêtes (24 h)** — graphique à barres + lignes des dossiers créés / clôturés manuellement / clôturés automatiquement / escaladés / en attente.
- **Verdicts du jour** — décompte courant des verdicts AI de la journée.
- **Enquêtes actives** — courte liste des dossiers en cours avec un lien direct vers chacun.

Le graphique est le widget le plus surveillé pour la planification des capacités ; si l'arriéré (ligne rouge) tend à augmenter alors que le débit reste plat, le MSSP est sous-provisionné ou le modèle laisse passer trop de dossiers vers la revue humaine.

## Tenants

### Liste des tenants

![Liste des tenants](/screenshots/tenants-list.png)

Une ligne par client. Colonnes : Nom affiché, Slug, Profil (`poc` ou `persistent`), État (`pending | provisioning | active | degraded | suspended | decommissioning | archived | purged`), Créé, Actions.

Le bouton **+ Nouveau tenant** ouvre le formulaire d'intégration. Le profil est fixé au moment de la création ; en changer ultérieurement nécessite une désaffectation + recréation.

### Détail du tenant

![Détail du tenant](/screenshots/tenant-detail.png)

Trois sections :

1. **Identité** — ID du tenant, profil, horodatages de création / changement d'état. Le slug apparaît sous le nom affiché dans l'en-tête.
2. **Actions** — Suspendre / Reprendre / Réessayer le provisionnement / Désaffecter. **Dans cette version, Suspendre bascule l'état du tenant à `suspended`** afin que l'orchestrateur cesse de planifier de nouvelles enquêtes ; cela ne met **pas** à l'échelle les charges de travail. Pour une coupure définitive, suivez [Opérations quotidiennes → Désactivation d'urgence](/fr-fr/operations#emergency-disable-a-tenant-immediately). **Réessayer le provisionnement** ne fonctionne que sur les tenants en `degraded` — l'API rejette `:retry` sur les tenants en `pending` (`pending → provisioning` est automatique à la première tentative).
3. **Événements de cycle de vie** — journal chronologique de la machine à états de provisionnement : `preflight_ok → secrets_minted → namespace_ready → secrets_applied → helm_applied (soctalk-tenant chart) → helm_applied (Wazuh chart) → workloads_ready → integration_config_written → active`. Les deux lignes `helm_applied` se distinguent par la charge utile de l'événement (identité du chart). Lorsqu'un tenant se bloque, ce tableau vous indique quelle étape a échoué.

La page est en lecture seule par ailleurs ; le SOC par tenant s'ouvre dans sa propre fenêtre via l'action **Ouvrir le SOC** de la liste des tenants. Wazuh est le plan de données in-namespace ; TheHive et Cortex sont des intégrations externes, pas des composants par tenant fournis d'office.

## Enquêtes

### Liste

![Liste des enquêtes](/screenshots/investigations-list.png)

File d'attente inter-tenants. Filtres : statut (En attente / Actif / En attente d'enrichissement / En attente de verdict / En attente humaine / Escaladé / Clôturé) et phase (Triage / Enrichissement / Analyse / Verdict / Escalade / Clôturé). Chaque ligne affiche Tenant, Titre, Statut, Phase, Gravité (Critique / Élevée / Moyenne / Faible), Nombre d'alertes, Nombre d'IOC malveillants, Verdict, Créé, Actions.

Cliquez sur **Voir** (ou sur le titre) pour ouvrir la page de détail.

### Détail

![Détail d'une enquête](/screenshots/investigation-detail.png)

Disposition :

- **En-tête** — titre, badges de statut (Actif/Clôturé, Phase en cours, Gravité).
- **Tuiles KPI** — Alertes, Observables (total/malveillants/suspects), Temps de triage, Temps de verdict.
- **Détails** — ID, Créé, Mis à jour.
- **Chronologie des événements** — boîte de réception chronologique des événements du dossier (immuable, en ajout seul).
- **Exécution de l'agent** — dépense de tokens vs le budget par exécution configuré (`case_runs.tokens_budget`, valeur par défaut du modèle 200 000) et disposition (`pending | active | failed | completed`).
- **Résumé des observables** — totaux ventilés en Malveillants / Suspects / Sains.

Le bouton flottant **Demander à l'AI** ouvre une conversation latérale qui opère sur le contexte de ce dossier.

## Examens (human-in-the-loop)

![File d'attente des examens](/screenshots/review-queue.png)

La file d'attente inter-tenants des propositions AI en attente d'un contrôle humain. Chaque ligne affiche le titre de la proposition, le nombre d'alertes, l'échéance, la gravité, la puce de verdict AI (`AI: Escalate / Close / Needs More Info`) et un bouton **Examiner**.

L'examen enregistre la décision (`approve | reject | more_info`) qui met à jour la ligne d'examen en attente dans la base de données. En V1, il n'y a **aucun pipeline aval basé sur une outbox** ; la décision s'arrête à la ligne d'examen + le journal d'audit. Toute création de dossier TheHive ou notification Slack doit se produire en ligne pendant l'exécution du graphe AI.

Un backend HIL bidirectionnel Slack existe dans le code (`src/soctalk/hil/backends/slack.py`) mais n'est **pas raccordé au runtime du chart V1**. La file d'attente du tableau de bord est aujourd'hui la seule surface HIL opérationnelle.

## Chat

La page de chat ouvre une conversation opérateur avec l'agent SocTalk. Sensible au périmètre : dans le périmètre à l'échelle du MSSP, vous pouvez interroger à travers les tenants ; dans le périmètre tenant, la conversation est liée aux données d'un seul client. Utile pour les questions ponctuelles (« montre-moi les tentatives de force brute de cette semaine sur le tenant X ») qui ne méritent pas une requête enregistrée.

## Analytique

![Analytique](/screenshots/analytics.png)

Vue inter-tenants axée sur les tendances, découpée par intervalles de temps (Fenêtre par défaut : 30 jours). Rapports :

- **Volume d'alertes**
- **p95 TTV** (time-to-verdict, AI)
- **p95 TTR** (time-to-review, contrôle humain)
- **Taux d'escalade**
- **Tenants qui se dégradent le plus** — triés par écart de p95 TTV vs la fenêtre précédente
- **Carte thermique d'activité** — jour de la semaine × heure de la journée, alertes (basculable vers d'autres dimensions)

Utilisez ceci pour la planification des capacités, l'évaluation de version de modèle et l'examen des SLA.

### Analytique des décisions

Épingler la page Analytique à un tenant unique remplace les tendances inter-tenants ci-dessus par un ensemble de surfaces axées sur les décisions pour ce client :

- **Distribution de confiance** — comment la confiance des décisions AI se répartit sur les alertes triées, regroupée par confiance.
- **Tendances des décisions** — comment le mix de décisions (clôturer, escalader, etc.) évolue dans le temps.
- **Confiance moyenne par décision** — confiance moyenne ventilée par type de décision.

## Journal d'audit

![Journal d'audit](/screenshots/audit-log.png)

Audit en ajout seul à l'échelle du MSSP. Filtrez par Type d'événement (Examen demandé / Examen terminé / Tenant intégré / Désaffecté / Clé pivotée / …). Colonnes : Horodatage, Type d'événement, Enquête (lien direct), Version (version de ligne issue de l'event-sourcing), Données (charge utile JSON extensible).

Pour les exports de conformité, appelez directement l'API :

```bash
curl 'https://mssp.your-mssp.example/api/audit?since=2026-01-01&tenant=<id>' > audit.json
```

## Paramètres

![Paramètres](/screenshots/settings.png)

Page de paramètres à l'échelle du MSSP. **En V1, cette page affiche des valeurs factices codées en dur** — `GET /api/settings` renvoie une charge utile statique en lecture seule qui ne reflète pas la configuration réelle de l'installation. La page est purement informative ; ce n'est **pas** une fenêtre sur les paramètres réels de l'installation, et le bouton **Enregistrer les modifications** est sans effet. Une véritable surface de paramètres reflétant l'état dérivé de l'environnement est prévue dans la feuille de route. La mutation du LLM par tenant est la seule surface de paramètres qui fonctionne réellement en V1 — voir [Page de détail LLM](#llm-detail-page).

Sections :

- **LLM** — Fournisseur (`openai-compatible | anthropic`), Modèle rapide, Modèle de raisonnement, Température, Max Tokens, Base URL + Organisation en option. Les clés API vivent dans l'environnement / les Secrets Kubernetes, jamais dans ce formulaire.
- **Wazuh SIEM** — bascule d'activation, URL, identifiants.
- **Cortex** — bascule d'activation, URL, identifiants. Intégration externe, pas un sous-chart fourni d'office ; l'URL pointe vers l'instance Cortex du tenant (voir /fr-fr/integrate/cortex).
- **TheHive** — bascule d'activation, URL, organisation, identifiants. Intégration externe, pas un sous-chart fourni d'office ; l'URL pointe vers l'instance TheHive du tenant (voir /fr-fr/integrate/thehive).
- **Slack** — configuration du webhook + backend interactif.

Le lien **Apportez votre propre clé LLM →** mène à la rotation de clé LLM par tenant (les clés LLM par tenant remplacent celle de l'installation).

### Page de détail LLM

![Détail des paramètres LLM](/screenshots/settings-llm.png)

Page autonome accessible depuis Paramètres → **Apportez votre propre clé LLM →**. En V1, il s'agit **uniquement de la saisie de clé BYOK par tenant** — le formulaire prend la clé API du **tenant actuellement dans le périmètre** et la soumet via `PUT /api/tenant/llm/api-key` (l'endpoint côté tenant ; les administrateurs MSSP peuvent aussi utiliser `PUT /api/mssp/tenants/{tenant_id}/llm/api-key`). Les autres champs LLM (fournisseur, modèle, température) affichés sur la page Paramètres parente sont des valeurs factices ; ils ne sont pas non plus modifiables ici. Voir [Opérations quotidiennes → Faire pivoter la clé LLM par tenant](/fr-fr/operations#rotate-per-tenant-llm-key) pour la procédure de rotation.

## Voir aussi

- [Opérations quotidiennes](/fr-fr/operations) — le versant runbook de ces pages (examen, enquêtes, désaffectation, rotation).
- [Ingress Wazuh](/fr-fr/reference/wazuh-ingress) — le flux d'intégration des agents depuis le détail du tenant.
- [Modèle de sécurité](/fr-fr/reference/security-model) — ce que chaque rôle MSSP (`platform_admin`, `mssp_admin`, `analyst`, `customer_viewer`) est autorisé à faire.
