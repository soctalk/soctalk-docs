# Audit dei Helm Chart per Tenant


> **Metodologia di audit**: questo documento cattura la classificazione attesa sulla base dell'ispezione dei chart. Esecuzioni reali di `helm template` e diff-rispetto-alla-classificazione sono richieste nella validazione pre-release. Qualunque oggetto trovato in un render reale che non sia elencato qui diventa un gate di revisione.

## Ambito dell'audit

Chart da sottoporre ad audit:

| Upstream | Sorgente upstream | Versione target |
|---|---|---|
| Wazuh | Helm chart `wazuh/wazuh-kubernetes` (community) o chart OCI ufficiale | Ultima stabile 4.x con supporto HA single-manager |
| linux-ep | Subchart SocTalk dell'endpoint-agent L2 (chiave del componente `components.linuxep`) | `0.2.0` |
| MISP | **rimandato a un rilascio futuro** | |

Il chart `soctalk-tenant` fa il vendoring di esattamente due subchart, `wazuh` e `linux-ep`. Per ognuno facciamo il vendoring dei template dei manifest (con eventuali patch) come dipendenze subchart di `charts/soctalk-tenant/`: il pinning delle versioni è rigoroso. `Chart.yaml` usa semver esatto con digest (OCI) dove disponibile.

TheHive e Cortex sono **integrazioni esterne**, raggiunte via rete e configurate per tenant (vedi /it-it/integrate/thehive e /it-it/integrate/cortex). Non sono subchart vendored, quindi sono fuori ambito per questo audit dei chart.

## Regole di classificazione

Per ogni oggetto renderizzato, classificare come:

- **NS-OK**: oggetto namespace-scoped che vive all'interno di `tenant-<slug>`. Sicuro, atteso.
- **CLUSTER-PREREQ**: oggetto cluster-scoped che deve essere installato una sola volta dal chart `soctalk-system` o documentato come responsabilità cluster-admin dell'MSSP. Il chart del tenant non deve reinstallarli per ogni tenant.
- **FORBIDDEN**: tipo di oggetto o capability che rifiutiamo di consentire in un chart di tenant anche quando l'upstream lo dichiara (ad es. un `ClusterRoleBinding` cluster-wide che concede a Wazuh accesso privilegiato). Deve essere rimosso tramite patch.
- **PATCH**: mantenere l'oggetto ma modificarlo (ad es. eliminare i volumi `hostPath`, rimuovere il `securityContext` privilegiato, ridurre le richieste di risorse predefinite).

## Classificazione attesa per chart upstream

### Wazuh

I chart di Wazuh tipicamente renderizzano:

| Oggetto | Classe attesa | Note |
|---|---|---|
| `Deployment` / `StatefulSet` (manager, indexer, dashboard) | NS-OK | Pod core dello stack |
| `Service` (API manager, indexer, dashboard, agent ingress 1514/1515) | NS-OK | |
| `ConfigMap` (ossec.conf, indexer.yml, dashboard.yml) | NS-OK | |
| `Secret` (password admin, certificati TLS mutui) | NS-OK | Seed per-tenant durante il provisioning |
| `PersistentVolumeClaim` (dati indexer, dati manager) | NS-OK | Dimensione impostata tramite i values del tenant |
| `ServiceAccount` | NS-OK | SA per-tenant |
| `Role` + `RoleBinding` (per leader election se usata) | NS-OK | Solo namespace-scoped |
| `NetworkPolicy` (fornita dal chart) | PATCH | Sostituire con la NP renderizzata da SocTalk per una postura coerente; non consentire ai default upstream di sovrascrivere il default-deny |
| Riferimenti a `StorageClass` | CLUSTER-PREREQ | L'MSSP deve fornire un provisioner dinamico; `storageClassName` è un input dei values |
| `Ingress` | PATCH o disabilita | Il protocollo agent di Wazuh sulla porta 1514 non è TLS standard, quindi un `Ingress` HTTP/HTTPS non è appropriato. Rimuovere qualunque risorsa `Ingress`. Per il `Service` di agent-ingress, il chart dovrebbe renderizzare la variante corrispondente a `tenant.wazuhIngress.mode`: un Service `LoadBalancer` per IP LB per-tenant (predefinito) o un Service `ClusterIP` quando l'installazione usa il fallback HAProxy in-cluster. Vedi [Wazuh Ingress](/it-it/reference/wazuh-ingress). |
| `PodSecurityPolicy` / `SecurityContextConstraints` | CLUSTER-PREREQ se presente; altrimenti forbidden | La PSP è deprecata; se presente, rimuoverla. Le SCC di OpenShift non rientrano nell'ambito di questo rilascio |
| `CustomResourceDefinition` | **FORBIDDEN** nel chart del tenant | Se il chart tenta di installare una CRD, spostarla nel chart `soctalk-system` o documentarla come prerequisito |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** nel chart del tenant | Non installare mai RBAC cluster-wide da un namespace di tenant |
| Pod privileged/host-network/hostPath | **FORBIDDEN**; rimuovere tramite patch | Il manager di Wazuh non li richiede per l'operatività standard; nemmeno l'indexer. Se un subchart richiede `hostPath` per i log, applicare una patch a `emptyDir` + PVC |
| `PodDisruptionBudget` | NS-OK | Opzionale; dipende dalla modalità HA di Wazuh. La topologia single-manager può ometterlo |

**Patch attese**:
1. Rimuovere qualunque `ClusterRole`/`ClusterRoleBinding` dall'output renderizzato.
2. Rimuovere qualunque risorsa cluster-scoped (`ValidatingWebhookConfiguration`, ecc.).
3. Renderizzare il `Service` di agent-ingress in modo che corrisponda a `tenant.wazuhIngress.mode` (`LoadBalancer` per IP LB per-tenant, `ClusterIP` per il fallback HAProxy in-cluster).
4. Rimuovere le risorse `Ingress`. Le dashboard di Wazuh sono esposte tramite un percorso separato gestito da SocTalk; il protocollo agent sulla porta 1514 non è HTTP, quindi l'`Ingress` di K8s non si applica.
5. Assicurarsi che tutti i pod abbiano `securityContext: { runAsNonRoot: true, allowPrivilegeEscalation: false }`; applicare patch se l'upstream imposta diversamente.
6. Fissare le immagini ai digest, non a `latest`.

### linux-ep

Il subchart dell'endpoint-agent L2 (`components.linuxep`). Il suo inventario renderizzato è ristretto: il chart emette un singolo `StatefulSet` e consuma un Secret esistente tramite `secretKeyRef` anziché renderizzare i propri oggetti credenziale.

| Oggetto | Classe attesa | Note |
|---|---|---|
| `StatefulSet` (endpoint agent) | NS-OK | L'unico workload che il subchart renderizza; namespace-scoped |
| `Secret` (credenziali di enrollment / agent) | Consumato, non renderizzato | Riferito tramite `secretKeyRef`; seed per-tenant durante il provisioning, al di fuori di questo subchart |
| `ClusterRole` / `ClusterRoleBinding` | **FORBIDDEN** nel chart del tenant | Non installare mai RBAC cluster-wide da un namespace di tenant |

**Stato attuale e patch attese**:
1. Il default del subchart imposta `securityContext.privileged: true` sul pod dell'agent. Questo è comportamento solo-PoC e un rischio reale, deve essere ristretto (rimuovere privileged, `allowPrivilegeEscalation: false`) prima di qualunque uso in produzione.
2. Confermare che nessun `ClusterRole`/`ClusterRoleBinding` compaia nell'output renderizzato.
3. Fissare le immagini ai digest, non a `latest`.

### Integrazioni esterne (fuori ambito dell'audit)

TheHive e Cortex sono **integrazioni esterne**, non subchart vendored, quindi sono fuori ambito per questo audit dei chart. SocTalk le raggiunge via rete per tenant; non ci sono oggetti TheHive/Cortex in-namespace da classificare. Configurale tramite /it-it/integrate/thehive e /it-it/integrate/cortex.

## Elenco dei prerequisiti del cluster (integrato nella guida di installazione + verifica prereq del chart `soctalk-system`)

A seguito dell'audit, questi sono **fuori ambito per il chart del tenant** e devono esistere nel cluster prima che `soctalk-tenant` venga applicato a qualunque namespace:

| Prerequisito | Perché | sorgente |
|---|---|---|
| K3s 1.30+ (o K8s 1.30+ compatibile) | Baseline più `ValidatingAdmissionPolicy` v1 | responsabilità MSSP |
| CNI con enforcement delle NP (Cilium primario, Calico alternativo) | Enforcement dell'isolamento | responsabilità MSSP |
| cert-manager | TLS per l'Ingress, emissione certificati Wazuh per-tenant | responsabilità MSSP; la guida di installazione fornisce la ricetta `helm install` |
| Ingress controller (Traefik predefinito in K3s, ingress-nginx comune) | Routing UI MSSP + UI Customer + WebUI per-tenant | responsabilità MSSP |
| `StorageClass` dinamica (local-path, longhorn, CSI del cloud provider, ecc.) | Provisioning dei PVC | responsabilità MSSP |
| `VolumeSnapshotClass` se si usano snapshot CSI | Runbook di backup/restore (solo docs) | Opzionale |

Il chart `soctalk-system` include un hook pre-install (`helm.sh/hook: pre-install`) che verifica:
- CNI con enforcement delle NP attivo (sonda i marker di Cilium o Calico)
- CRD di cert-manager presenti
- `StorageClass` predefinita impostata

L'hook fallisce rapidamente con un messaggio d'errore azionabile se manca qualcosa.

## Strategia di patching

Due percorsi:

1. **Override guidati dai values**: preferire i values del chart upstream che disabilitano l'oggetto indesiderato (ad es. `ingress.enabled: false`, `networkPolicy.enabled: false` se quella upstream è più permissiva della nostra, `rbac.create: true` limitato al solo namespace).
2. **Overlay in stile Kustomize** (integrazione `kustomize` di Helm o hook post-render) per gli oggetti che non possono essere disabilitati tramite values: rimuovere i `ClusterRole`, rimuovere i volumi `hostPath`, impostare il `securityContext`.

Facciamo il vendoring dei chart upstream come chart sibling sotto `charts/` (`charts/wazuh`, `charts/linux-ep`) riferiti per percorso relativo, non come riferimenti `helm repo` (helm li copia nel package in fase di build). Questo ci consente di:
- Fissare a versioni esatte (nessun aggiornamento a sorpresa dall'upstream)
- Applicare patch secondo necessità senza dipendere dall'accettazione di PR upstream
- Firmare il nostro bundle come singolo artefatto (un rilascio futuro quando arriverà cosign)

Se dopo le patch l'upstream non soddisfa le nostre esigenze, il fallback è scrivere template SocTalk-native che invochino le stesse immagini dei container con i nostri manifest. La validazione pre-release decide questo per ogni chart.

## Incognite note (risolte dalla validazione pre-release)

Elementi che richiedono esecuzioni reali di `helm template` + ispezione per essere confermati:

- [ ] **Wazuh**: la versione del chart scelta richiede CRD per il deployment operator-driven? In caso affermativo, spostare le CRD nel chart `soctalk-system`.
- [ ] **linux-ep**: l'endpoint agent richiede accesso a livello host (hostPath, host network) che deve essere rimosso tramite patch o ristretto?
- [ ] **Tutti i chart**: qualunque `Job` o `CronJob` che gira con un `ServiceAccount` oltre il namespace? Applicare patch a una SA locale al namespace.
- [ ] **Tutti i chart**: qualunque `initContainer` con `privileged: true` o mount `hostPath`? Applicare patch o sostituire.
- [ ] **Tutti i chart**: `resources.requests` e `limits` predefiniti: confrontare con il profilo di sizing; sovrascrivere nei values dove necessario.

Ogni elemento aperto diventa una voce della checklist di validazione pre-release. L'output dello spike è una tabella di classificazione compilata e il chart patchato mantenuto sotto `charts/wazuh` / `charts/linux-ep`.

## Artefatto di output (prodotto prima del rilascio)

Lo spike produce:

1. **Inventario oggetti classificato** (compilando le tabelle della sezione 3 con gli oggetti effettivamente renderizzati).
2. **Bundle dei chart patchati** mantenuti sotto `charts/wazuh/` e `charts/linux-ep/` con versioni fissate.
3. **Elenco dei prerequisiti del cluster** integrato nella guida di installazione.
4. **Frammento di schema dei values** per ogni subchart (input che SocTalk fornirà per-tenant).

Il completamento dello spike è un prerequisito per l'implementazione del Helm chart.
