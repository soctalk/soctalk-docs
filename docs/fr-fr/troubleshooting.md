# Dépannage

Symptôme → diagnostic → correction. Runbook pour les modes de défaillance les plus courants.

| Symptôme | Première vérification | Correction |
|---|---|---|
| `helm install soctalk-system` échoue dans le hook de pré-installation | `kubectl logs -n soctalk-system job/<release>-preinstall-check` | Installez le prérequis de cluster manquant (CNI, cert-manager, StorageClass) selon le guide [Installation](/fr-fr/install#cluster-prerequisites) |
| Le pod API en `CrashLoopBackOff` au démarrage | `kubectl logs -n soctalk-system deploy/soctalk-system-api` | Le plus souvent : Secret `DATABASE_URL` incorrect, Postgres pas encore prêt, ou échec de migration Alembic. Vérifiez d'abord le pod Postgres |
| `helm install` réussit mais l'UI MSSP renvoie 502 | Journaux du contrôleur d'ingress ; vérifiez que les `endpoints` du Service d'ingress sont peuplés | Le proxy OIDC n'est pas déployé ou n'injecte pas les en-têtes de confiance. Vérifiez le CIDR trusted-proxy |
| La création de tenant renvoie 500 | Les journaux de l'API affichent `ProvisionError` | Généralement, `helm install tenant-*` a échoué. Vérifiez `helm status tenant-<slug>`. Les problèmes de namespace et de quota de ressources sont les plus fréquents |
| Tenant bloqué en `provisioning` > 15 min | `kubectl -n tenant-<slug> get events --sort-by=.lastTimestamp` | Consultez [Tenant bloqué en provisioning](/fr-fr/operations#tenant-stuck-in-provisioning) dans les opérations |
| Un tenant passe en `degraded` | Journaux de l'adaptateur dans le namespace du tenant | Egress NetworkPolicy, crash du pod de l'adaptateur, ou DNS mal résolu |
| Données visibles d'un tenant à l'autre | Exécutez la suite de tests d'isolation | **Incident P1.** Le RLS est la dernière ligne de défense ; une défaillance indique un bug applicatif ou une mauvaise configuration de rôle Postgres |
| Les appels LLM échouent pour un tenant | Journaux du worker : recherchez des 401/403 du fournisseur LLM | Le runs-worker lit depuis `Secret/tenant-llm-key` dans le namespace `tenant-<slug>`. La source de référence est `IntegrationConfig.llm_api_key_plain` dans Postgres — effectuez la rotation via `PATCH /api/mssp/tenants/{id}/llm` (UI : détail du tenant → Settings → LLM), qui réécrit le Secret et redémarre le runs-worker |
| L'agent Wazuh ne parvient pas à se connecter | L'IP du LB du tenant (ou l'IP+port de l'edge HAProxy) est joignable depuis l'hôte de l'agent ; le DNS pour `<slug>.soc.mssp.*` s'y résout ; les ports 1514/1515 sont ouverts à travers tout pare-feu intermédiaire | Consultez [Wazuh Ingress](/fr-fr/reference/wazuh-ingress). 1514 est le protocole propriétaire de Wazuh — il n'y a pas de SNI à inspecter ; le routage se fait par adresse de destination ou par port. Vérifiez que le `Service` du tenant (`type: LoadBalancer` ou le port HAProxy) est bien l'adresse ciblée par l'agent |
| Le StatefulSet Postgres ne démarre pas (PVC Pending) | `kubectl describe pvc -n soctalk-system` | Aucune StorageClass par défaut, la classe ne prend pas en charge RWO, ou le cluster est à court d'espace disque |
| Messages `PolicyViolation` du contrôleur d'ingress | Règles d'autorisation NetworkPolicy | Assurez-vous que le namespace d'ingress porte le label `kubernetes.io/metadata.name=ingress-system` |
| Cilium Hubble affiche des flux DROPPED entre un tenant et `soctalk-system` | NetworkPolicies + identités Cilium | La politique d'egress de l'adaptateur est absente ou le `namespaceSelector` est incorrect |
| La connexion d'un utilisateur client renvoie 403 sur `/api/tenant/*` | Claims JWT | Assurez-vous que la ligne utilisateur a `tenant_id` défini et `role=customer_viewer` |
| L'usurpation d'identité par un utilisateur MSSP n'apparaît pas dans l'audit client | Requête d'audit | Vérifiez que la colonne `acting_as` est peuplée à l'écriture ; la vue d'audit client jointure sur `tenant_id = own AND acting_as IS NOT NULL` |
| Le test d'isolation échoue en CI (l'admin FORCE RLS peut voir des lignes) | Migration appliquée ? | Réexécutez `alembic upgrade head` ; assurez-vous que `FORCE ROW LEVEL SECURITY` est appliqué à chaque table à portée de tenant |
| ImagePullBackOff sur le `soctalk-adapter` / `soctalk-runs-worker` d'un tenant | `kubectl -n tenant-<slug> describe pod` montre un échec de pull pour `ghcr.io/soctalk/soctalk-adapter:0.1.13-fixes` (ou similaire) | Connu : `render.py` utilise par défaut un tag qui peut ne pas être présent dans le ghcr public. Surchargez au moment de l'installation : définissez `tenantProvisioning.adapterImageTag: latest` et `tenantProvisioning.runsWorkerImageTag: latest` dans les values de `soctalk-system`. Ces valeurs se propagent aux variables d'environnement `SOCTALK_TENANT_ADAPTER_IMAGE_TAG` / `SOCTALK_TENANT_RUNS_WORKER_IMAGE_TAG` du Deployment de l'API, que le rendu de provisioning lit |

## Collecte des bundles de diagnostic

Lors d'une escalade vers le support, collectez :

```bash
# État au niveau système de SocTalk
kubectl get all,events,networkpolicies,resourcequotas \
  -n soctalk-system -o yaml > soctalk-system.yaml
kubectl -n soctalk-system logs deploy/soctalk-system-api --tail=500 > api.log
# (Le chart V1 embarque l'orchestrateur dans le pod API — pas de Deployment séparé)

# Tenant spécifique
kubectl get all,events,networkpolicies,resourcequotas,limitranges \
  -n tenant-<slug> -o yaml > tenant.yaml
kubectl -n tenant-<slug> logs deploy/soctalk-adapter --tail=500 > adapter.log

# État Helm
helm status -n soctalk-system soctalk-system > helm-system.txt
helm status -n tenant-<slug> tenant-<slug> > helm-tenant.txt

# Version de SocTalk + événements de cycle de vie du tenant
# soctalk-cli debug-bundle était documenté dans des brouillons antérieurs ; non implémenté.
# Capturez les données à la main à partir des étapes kubectl/helm ci-dessus.

tar czf soctalk-debug-$(date +%s).tgz *.yaml *.log *.txt
```

**Examinez le tarball à la recherche de données client avant tout partage externe.** Les journaux peuvent contenir des extraits d'alertes.
