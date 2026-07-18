# Architecture

> **Note de déploiement V1.** Le nommage de la liste d'entités ci-dessous utilise les anciens préfixes « case_* » pour plusieurs tables ; les noms réels du schéma V1 sont : `cases`, `investigation_runs`, `investigation_events`, `investigation_iocs`, `investigation_assets`, `investigation_links`, `investigation_outbox`, `proposals`. Le nom de table `cases` reste inchangé pour la rétrocompatibilité, mais toutes les tables enfant par enquête utilisent le préfixe `investigation_*`. Parmi celles-ci, les tables cases / investigation_runs / investigation_events sont sollicitées par l'orchestrateur actuel ; `proposals` et `investigation_outbox` sont présentes dans le schéma, mais la partie exécuteur qui les consomme figure sur la feuille de route. Lisez cette page comme l'intention architecturale ; consultez [`src/soctalk/core/ir/models.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/ir/models.py) pour le schéma exact.

## 1. Entités principales

Forme minimale. Les listes complètes de colonnes vivent dans la migration ;
seuls les champs porteurs sont nommés ici.

```
alerts               raw ingest from adapter; AI-triaged
cases                investigation unit; one run at a time
case_runs            a single AI execution span against a case
case_events          ordered event inbox per case (immutable)
proposals            AI-proposed actions awaiting human gate
execution_log        append-only audit of all meaningful actions
notes                markdown / evidence blocks
iocs                 typed artifacts; carry external_context
case_iocs, case_assets   bridge tables
case_links           related-case edges (shared IOC / asset / rule)
case_outbox          outbound work for executors and exports
```

Chaque ligne porteuse de contenu porte `tenant_id`, `visibility` et
`created_at`. La RLS s'applique par tenancy.

## 2. Modèle de visibilité

Classes (enum) :

```
mssp_only         default; internal reasoning, raw tool output, hypotheses
customer_safe     approved for customer view
system            lifecycle and state-change events, always visible
tool_output       classified per-tool at registration time
```

Règles :

1. `visibility` est une colonne présente sur chaque ligne visible par
   l'utilisateur (messages, notes, proposals, enregistrements tool_output,
   entrées de la chronologie, champs du panneau de faits).
2. Par défaut à l'insertion, la valeur est `mssp_only`. La promotion vers
   `customer_safe` est une opération explicite.
3. Les requêtes du portail client filtrent au niveau de la politique RLS, et
   non au rendu. Une session client-viewer ne peut pas lire les lignes
   `mssp_only`, même via du SQL brut.
4. Les proposals ont une visibilité au niveau du champ : `{action, outcome}`
   peut être `customer_safe` tandis que `{rationale, blast_radius}` reste
   `mssp_only`. Rendu sous forme de deux projections.
5. Chaque promotion de visibilité émet une entrée `execution_log` avec
   l'acteur et la justification.

Refus-par-défaut de la promotion : les politiques peuvent rétrograder la
visibilité mais ne peuvent pas la relever sans une action explicite d'un
principal autorisé.

## 3. Cycle de vie d'un run

États :

```
active           run consuming events and taking steps
waiting_on_gate  a proposal is pending; run does not mutate state
halted_budget    budget exceeded; requires analyst resume
paused           analyst-paused
completed        case closed
failed           unrecoverable error; requires analyst resume or restart
```

Transitions :

```
active → waiting_on_gate     on proposal created (status = proposed)
waiting_on_gate → active     on proposal approved/rejected (new event)
active → halted_budget       on budget exceeded
halted_budget → active       on analyst resume (grants new budget)
active → paused              on analyst pause
paused → active              on analyst resume
active → completed           on case close
* → failed                   on uncaught error, preserved for diagnosis
```

Invariants :

- Au plus un run par case dans l'état `active | waiting_on_gate |
  halted_budget | paused`. Imposé via un index unique partiel sur
  `case_runs(case_id) WHERE status IN (...)`.
- Compteurs de budget sur le run : `tokens_used`, `dollars_used`,
  `tool_calls_used`, `wall_clock_ms`. Imposés côté serveur ; avertissement
  souple à 75 %, arrêt strict à 100 %.
- Un run `waiting_on_gate` ne traite pas les événements de l'inbox, hormis
  les événements de résolution de gate (proposal.approved / .rejected).

## 4. Inbox d'événements, ordonnancement, coalescence, idempotence

Tout le travail entrant pour un case atterrit dans `case_events` :

```
event_id              uuid PK
case_id               FK
run_id                FK nullable
seq                   bigint, case-scoped monotonic (sequence)
kind                  enum (alert_ingested, tool_result,
                            proposal_approved, proposal_rejected,
                            analyst_message, analyst_correction,
                            budget_warning, external_signal, ...)
payload               jsonb
causation_event_id    uuid nullable (which event caused this one)
correlation_id        uuid (spans a causally-related fan-out)
idempotency_key       text unique per case
created_at            timestamptz
```

Règles :

1. `seq` est émis par une séquence à portée case lors de l'insertion. Les
   consommateurs lisent strictement dans l'ordre de `seq`.
2. `idempotency_key` est unique par `case_id`. Une insertion en double est
   silencieusement ignorée (renvoie la ligne existante).
3. Coalescence : avant l'insertion, les événements correspondant à
   `(case_id, kind, payload.signature, window)` fusionnent en une seule
   ligne. La signature est spécifique au kind (alert : empreinte de IOC +
   règle + asset ; tool_result : tool_id + hash des params).
4. `causation_event_id` relie cause → effet pour le rejeu.
   `correlation_id` regroupe les événements issus d'un même déclencheur
   externe ou d'une action d'analyste.
5. Les événements sont immuables. Les mises à jour s'expriment comme des
   événements ultérieurs.

Exemple de rafale : 100 alertes hôte similaires en 5 minutes se coalescent en
un seul événement `alert_ingested` portant une liste `asset_ids: [...]`. Le
run le traite une seule fois.

## 5. Cycle de vie d'une proposal et contrat d'exécution

États :

```
draft        being composed by the AI
proposed     submitted to human gate
approved     human approved (with typed reason if required)
rejected     human rejected (reason required)
executing    outbox picked up; executor running
executed     action complete, result recorded
rolled_back  post-execution reversal (rare, analyst-initiated)
failed       executor error
```

Idempotence :

```
proposal.idempotency_key = sha256(case_id || action_type ||
                                   canonical_json(params))
```

Les proposals en double dans une fenêtre active (par défaut 15 minutes) sont
rejetées à l'insertion. Garantit que l'AI ne peut pas déclencher deux fois,
même en cas de re-run.

Comportement du gate :

- Sur `proposed` : le run transitionne vers `waiting_on_gate`.
- Sur `approved` : insère une ligne dans `case_outbox` avec
  `kind = 'execute_proposal'`, `idempotency_key = proposal.idempotency_key`.
  Émet `proposal_approved` dans `case_events`. Le run reprend.
- Sur `rejected` : émet `proposal_rejected` avec motif dans
  `case_events`. Le run reprend. Aucune ligne d'outbox.

Exécution :

- Un worker exécuteur distinct consomme `case_outbox` et effectue l'action.
- En cas de succès : enregistre `execute_proposal_result` dans `case_events`,
  met à jour la proposal → `executed`, écrit une entrée `execution_log`.
- En cas d'échec : enregistre l'erreur, met à jour la proposal → `failed`,
  écrit une entrée `execution_log`. Le run peut proposer une nouvelle
  tentative.
- Exactement-une-fois via `idempotency_key` : les lignes d'outbox aux clés
  dupliquées sont rejetées. Les workers exécuteurs réclament les lignes avec
  un bail (p. ex. `FOR UPDATE SKIP LOCKED`).

Le run AI n'exécute pas d'effets de bord en ligne. Tout passe par l'outbox.

## 6. Schéma et invariants du journal d'exécution

En ajout seul (append-only), distinct de la conversation :

```
log_id              uuid PK
case_id             FK
run_id              FK nullable
actor_kind          enum (ai, human, system, executor)
actor_id            text
kind                enum (tool_call, proposal_state_change,
                          approval, override, visibility_promotion,
                          correction_applied, policy_bound,
                          export_emitted, ...)
subject_type        enum (case, proposal, ioc, asset, note, ...)
subject_id          text
before              jsonb nullable
after               jsonb nullable
versions            jsonb (model_id, prompt_version, template_version,
                           policy_version at time of action)
ts                  timestamptz default now()
```

Invariants :

1. Aucune UPDATE ni DELETE autorisée depuis les rôles applicatifs. Seuls
   INSERT + SELECT. Imposé au niveau des octrois de rôles Postgres.
2. Chaque changement d'état de proposal, chaque appel d'outil, chaque
   approbation, chaque override analyste d'une décision AI, chaque changement
   de visibilité, chaque correction, chaque dispatch d'outbox écrit une
   ligne.
3. `versions` capture la pile qui a produit l'action. Requis pour la
   reproductibilité et la calibration a posteriori.
4. La conversation est une vue rendue d'un sous-ensemble d'événements ; ce
   n'est pas l'audit. Détruire ou compacter la conversation ne détruit pas
   l'audit.

## 7. Autorité du panneau de faits et flux de correction

L'état structuré du case (hypothèses, IOC, assets, résumé de chronologie,
confiance, directives actives) est une sortie de reducer sur `case_events`.
Il n'est jamais muté directement par la conversation.

Règles :

1. Les messages de conversation n'écrivent pas d'état structuré.
2. Les mises à jour AI de l'état structuré se font via des événements émis par
   l'AI (`hypothesis_updated`, `ioc_added`, `asset_linked`).
3. Les modifications de l'analyste dans le panneau de faits émettent des
   événements `analyst_correction`. Le reducer les applique. L'AI consomme la
   correction comme prochain événement d'inbox et re-raisonne à partir de
   l'état corrigé.
4. Le panneau de faits est cohérent à terme (eventually consistent) avec
   `case_events`. Une projection matérialisée (table ou vue) est maintenue ;
   les lectures peuvent l'atteindre directement.
5. Les corrections directes du journal d'exécution sont interdites ; les
   corrections s'expriment comme de nouveaux événements assortis d'un pointeur
   vers celui qui est corrigé.

## 8. Taxonomie des capacités d'outils

Chaque outil est enregistré avec une classe de capacité, une politique
d'approbation par défaut et un modèle de coût.

Classes de capacité :

```
read_local               inspect SocTalk state only
read_external_silent     no target footprint (feeds, cached intel, vector)
read_external_attributed trace at target (SIEM query, EDR read)
write_sandbox            footprint without target mutation (detonation)
write_external           target state change (block, isolate, notify)
```

Politique d'approbation par défaut par classe :

```
read_local                → autonomous
read_external_silent      → autonomous
read_external_attributed  → analyst_approve
write_sandbox             → analyst_approve
write_external            → typed_reason
```

Modèle de coût par outil : `{tokens_est, dollars_est, wall_ms_est, footprint}`.
Le budget du run en suit la somme.

## 9. Préséance des politiques

Les politiques sont fusionnées dans cet ordre, le plus bas l'emportant sur le
plus haut :

```
1. install default       (shipped in chart, read-only in v1)
2. tenant override       (MSSP sets per customer)
3. case template         (phishing, ransomware, etc.)
4. case-local override   (set for this one case by analyst)
```

Pour chaque clé de politique (approbation d'outil, auto-close, promotion de
visibilité, modèles de réponse, budget), la valeur effective est celle de la
portée la plus profonde qui la définit.

Invariants :

1. La promotion de visibilité n'est jamais réglée sur `permissive` par défaut
   à la portée install. Par défaut, « promotion explicite requise ».
2. Une politique de tenant ne peut pas outrepasser un plafond strict de niveau
   install (p. ex. `max_tokens_per_case`).
3. Les overrides case-local sont limités au case et ne persistent pas vers les
   cases futurs.

## 10. Sémantique d'auto-close / réouverture

Auto-close pour les faux positifs à haute confiance :

```
Trigger:
  AI assessment = fp, confidence ≥ policy.auto_close_threshold
  AND policy.auto_close_enabled is true for the tenant
  AND no active directive prevents auto-close

Action:
  case.status = 'auto_closed_fp'
  case.reopen_window_until = now() + policy.reopen_window
  case.reopen_signature = {
    ioc_fingerprints: [...],
    asset_ids: [...],
    time_window: {start, end}
  }
  run transitions to completed
  execution_log row written
```

Réouverture :

```
Trigger:
  new case_events row with kind ∈ {alert_ingested, external_signal}
  whose signature intersects a case's reopen_signature
  where case.status = 'auto_closed_fp'
    AND now() < case.reopen_window_until

Action:
  case.status = 'active'
  emit reopened event into case_events
  new run created
  execution_log row written
  conversation receives a system message noting the reopen
```

Coupe-circuit :
- `IntegrationConfig.auto_close_enabled` par tenant (par défaut : activé).
- `CaseTemplate.auto_close_disabled` par type de case.

## 11. Contrat d'export TheHive (basé sur outbox, unidirectionnel)

Réplique les cases, IOC et notes sélectionnées vers TheHive lorsque le tenant
a `thehive_export_enabled`. N'accepte jamais de changements entrants.

Ligne d'outbox (dans `case_outbox`) :

```
id                  uuid PK
kind                'export.thehive.case' | 'export.thehive.ioc' | ...
external_system     'thehive'
external_ref        TheHive object id (filled on first successful mirror)
object_type         case | ioc | note
object_id           internal subject id
idempotency_key     sha256(object_type || object_id || state_hash)
payload             jsonb
export_status       pending | in_flight | succeeded | failed | skipped
attempts            int
last_error          text nullable
next_attempt_at     timestamptz
created_at, updated_at
```

Règles :

1. Un changement d'état sur un objet répliqué met en file une ligne d'export
   avec une `idempotency_key` fraîche (qui intègre le hash d'état).
2. Le worker réclame avec `FOR UPDATE SKIP LOCKED`. En cas de succès,
   enregistre `external_ref` (en créant ou mettant à jour côté TheHive selon
   le besoin) et écrit dans execution_log.
3. Les webhooks entrants de TheHive ne sont acceptés que pour les cases de
   tableau de bord en lecture seule (pas en v1). Toute tentative d'accepter un
   état entrant est explicitement rejetée et journalisée.
4. Aucune boucle de réconciliation — TheHive est un miroir en aval, la source
   de vérité est SocTalk.
5. Les exports en échec réessaient avec un backoff exponentiel jusqu'à un
   plafond ; l'échec permanent remonte sur le panneau de santé des
   intégrations.

## 12. Tests obligatoires et invariants

La suite de tests (unitaire + intégration) doit couvrir :

1. **Immuabilité du journal d'exécution.** Les UPDATE et DELETE sur
   `execution_log` depuis le rôle applicatif échouent au niveau Postgres.
2. **Un seul run actif par case.** Les tentatives concurrentes de créer un
   second run actif échouent avec une violation de contrainte d'unicité.
3. **Idempotence des proposals.** Soumettre deux proposals avec la même clé
   d'idempotence dans la fenêtre : la seconde est rejetée.
4. **Comportement de pause-gate.** Un run avec une proposal `proposed` ne
   consomme pas les événements non-gate de son inbox.
5. **Outbox exactement-une-fois.** Deux workers réclamant la même ligne
   d'outbox aboutissent à un succès et un no-op.
6. **Application de la visibilité.** Une session client-viewer ne peut pas
   sélectionner de lignes `mssp_only` dans aucune table, même en SQL brut.
7. **Promotion de visibilité journalisée.** Chaque promotion de `mssp_only`
   vers `customer_safe` produit une ligne `execution_log`.
8. **Flux de correction.** Un événement de correction analyste produit un
   nouvel événement que le reducer applique ; la projection du panneau de
   faits reflète la correction.
9. **Réouverture après auto-close.** Un événement correspondant à une
   reopen_signature dans la fenêtre rouvre le case et démarre un nouveau run.
10. **Idempotence de l'export TheHive.** Re-lancer un export pour un objet dont
    l'état n'a pas changé est un no-op (même idempotency_key).
11. **Politique d'approbation d'outil.** Un appel d'outil `write_external` sans
    approbation typed_reason ne peut pas atteindre l'exécuteur.
12. **Préséance des politiques.** L'override case-local l'emporte sur le tenant
    qui l'emporte sur l'install pour la même clé de politique.

## 13. Hors de cette spécification

- Modèles de composants, comportement visuel, analyse de la barre de commandes
  → le chantier de l'UI de conversation.
- Corrélation de campagnes, scoring, mécanique cross-tenant → le chantier des
  campagnes.
- Bibliothèque de prompts, contenu du registre d'outils LLM, politique de
  version de modèle → le chantier du runtime LLM (LLM runtime), séparé, quand
  nous y arriverons.
