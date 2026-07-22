# FAQ

Domande pre-installazione / pre-acquisto che non rientrano in modo netto nella sezione installazione o riferimento.

## Cos'è SocTalk?

Una piattaforma SOC multi-tenant progettata per MSP e MSSP. Un unico control plane orchestra gli stack Wazuh per singolo cliente; una pipeline AI esegue il triage degli alert e propone azioni; analisti umani approvano le escalation. Completamente open source.

## Cosa è open source e cosa è commerciale?

**Tutto ciò che si trova nel repository [`soctalk/soctalk`](https://github.com/soctalk/soctalk) è Apache 2.0**: il control plane, la pipeline AI, l'integrazione Wazuh, i chart, la VM demo. Non esiste alcuna suddivisione di funzionalità tra "community ed enterprise".

Esiste un servizio di hosting gestito (SocTalk Cloud) per gli MSP che non vogliono gestire la piattaforma in autonomia. Il servizio gestito usa lo stesso codice della distribuzione open.

## Posso valutarlo senza un cluster Kubernetes?

Sì, l'[immagine VM demo](/it-it/quickstart-vm) è un'installazione single-box. Avviala su KVM, VMware, Hyper-V, Azure oppure convertila da raw. Cinque minuti per un'installazione multi-tenant funzionante con un tenant `demo` già onboardato.

## Posso eseguirlo su un singolo nodo in modo permanente?

Sì, per deployment molto piccoli (1–2 clienti, basso volume di alert). La VM demo usa il profilo `poc`, che presuppone storage effimero e non è dimensionato per un carico sostenuto. Per l'uso reale con clienti:

- Aumenta le risorse della VM (16 GB di RAM + 200 GB di SSD per circa 3 piccoli tenant).
- Usa il profilo `persistent` quando esegui l'onboarding dei tenant.
- Aggiungi i backup (vedi [Backup e ripristino](/it-it/backup-restore)).

Per più di circa 3 tenant, pianifica un cluster multi-nodo.

## Funziona in modalità air-gapped?

Sì, con alcuni passaggi aggiuntivi:

- **Immagini dei container**: replica `ghcr.io/soctalk/*` sul tuo registry interno. Il chart accetta `image.registry: your.registry.example/soctalk`.
- **Chart Helm**: esegui `helm pull oci://ghcr.io/soctalk/charts/soctalk-system` una volta, ospitalo in un registry OCI interno e fai puntare le installazioni ad esso.
- **LLM**: usa un endpoint locale compatibile con OpenAI (vLLM, proxy Ollama, proxy Bedrock on-prem). Vedi [Provider LLM](/it-it/integrate/llm-providers).
- **Analyzer Cortex**: qualsiasi analyzer che necessita di internet non funzionerà. Usa solo analyzer on-prem (MaxMind GeoIP, MISP interno) oppure disabilita Cortex.
- **GitHub Releases**: scarica l'[immagine VM](/it-it/downloads) su un host connesso e trasferiscila via sneakernet.

Il flusso [`scripts/dev-up.sh`](https://github.com/soctalk/soctalk/blob/main/scripts/dev-up.sh) viene eseguito senza internet una volta che le immagini sono state replicate.

## Quanto costa l'LLM per tenant?

Molto variabile, dipende da:

- Volume di alert (una indagine per ogni alert che sopravvive alla correlazione)
- Budget di token per esecuzione (`case_runs.tokens_budget`, default del modello 200.000)
- Selezione del modello (`fast_model` + `reasoning_model`)
- Con quale frequenza il verdict indica `needs_more_info` (che causa una nuova esecuzione)

Ordine di grandezza con il budget predefinito di 200.000 token per esecuzione e un uso tipico: 30 alert/giorno × circa 60k token/indagine × 5 $/Mtok in input ≈ 9 $/giorno per tenant su una configurazione economica compatibile con OpenAI. Scende di 5–10× con un fast model più economico. Vedi [Osservabilità, Costo per tenant](/it-it/observability#per-tenant-cost) per misurarlo.

## Clienti diversi possono usare modelli LLM diversi?

Sì, override per tenant al momento dell'onboarding. Il modello a livello di installazione è il default; i tenant possono derogarvi specificando il proprio. Vedi [Provider LLM, Override per tenant](/it-it/integrate/llm-providers#per-tenant-overrides).

## Un cliente può usare la propria chiave LLM?

Sì, l'override per tenant si applica anche alla chiave API. Lo store autorevole è `IntegrationConfig.llm_api_key_plain` in Postgres; il controller lo materializza in `Secret/tenant-llm-key` nel namespace **del tenant** (non `soctalk-system`), che il runs-worker monta. Utile per l'isolamento della fatturazione.

## SocTalk invia dati dei clienti ad Anthropic / OpenAI?

Solo ciò su cui ragiona la pipeline AI: il corpo dell'alert, gli observable estratti e gli output dei worker. Il runtime non esfiltra dati a riposo, solo ciò che è presente nello stato corrente dell'indagine. Se hai bisogno di una postura più restrittiva, usa un endpoint LLM on-prem (vLLM, Ollama). Vedi [Provider LLM, Passaggio ad Anthropic / parametri di runtime](/it-it/integrate/llm-providers#runtime-only-knobs-env-not-chart).

## Sostituisce i miei analisti?

No. SocTalk è posizionato come **copilot**, non come sostituto. Il nodo di verdict decide `escalate | close | needs_more_info`; l'escalation passa sempre attraverso un gate di [revisione umana](/it-it/human-review). Senza l'intervento umano, un MSSP ad alto volume avrebbe comunque bisogno di analisti per gestire le decisioni che SocTalk instrada verso di loro.

Il valore sta nella compressione: lo stesso team di analisti può gestire 5–10× il volume di alert perché i casi di routine si chiudono automaticamente e solo quelli poco chiari arrivano alla revisione umana.

## Funziona senza Wazuh?

L'attuale data plane è solo Wazuh. La superficie di tool MCP (`wazuh.*`, `cortex.*`, `thehive.*`, `misp.*`) è pluggable, quindi altri SIEM sono aggiunte fattibili. Al momento nessuno è disponibile.

## Qual è la postura di hardening per la produzione?

- Postgres Row-Level Security con `FORCE ROW LEVEL SECURITY` come rete di sicurezza per l'isolamento dei dati cross-tenant.
- Cilium NetworkPolicy che isola ciascun namespace `tenant-<slug>`.
- TLS ovunque (gestito da cert-manager in produzione; self-signed per il wizard).
- Tutto lo stato del control plane in Postgres con semantica append-only per l'audit log.
- Admin di bootstrap creato solo quando esplicitamente configurato nei values (o tramite un Secret pre-provisioned); ruotalo dopo il primo accesso con `soctalk-auth set-password`.

Vedi [Modello di sicurezza](/it-it/reference/security-model) per la postura completa.

## Posso eseguirlo su EKS / AKS / GKE?

Sì, il chart è pensato per Kubernetes 1.30+ standard. Collega la StorageClass del tuo cloud, l'ingress controller e il solver DNS-01 di cert-manager. La [guida all'installazione](/it-it/install) è incentrata su K3s perché è la distribuzione predefinita; al chart in sé non importa.

## Scala fino a N clienti?

Testato fino a circa 50 tenant su un cluster a 3 nodi (16 vCPU / 64 GB / nodo). Il collo di bottiglia è di solito l'indexer Wazuh per tenant (ogni indexer è un processo Java con il proprio heap) piuttosto che il control plane di SocTalk. Pianifica circa 6–8 GB di RAM e circa 1,5 vCPU per ciascun tenant con profilo `persistent`: vedi [Dimensionamento](/it-it/reference/sizing).

## E la compliance (SOC 2, HIPAA, PCI)?

La postura della piattaforma supporta audit di tipo SOC 2, audit log append-only, RBAC, cifratura a riposo (Postgres + indexer Wazuh), cifratura in transito. **Non** viene fornita con un'attestazione SOC 2; questa è responsabilità dell'MSSP per il proprio hosting.

Per HIPAA / PCI, il data plane (Wazuh) contiene spesso dati in-scope. Tratta quel PVC come in-scope ed eseguine il backup di conseguenza (vedi [Backup e ripristino](/it-it/backup-restore)).

## Cosa c'è nella roadmap?

Le GitHub Issues e la board Projects di [`soctalk/soctalk`](https://github.com/soctalk/soctalk) sono la fonte di verità. Elementi ad alto impatto menzionati nella documentazione come rilasci futuri:

- Modalità di autenticazione proxy esposta come parametro nei values del chart (oggi: override tramite variabile d'ambiente).
- API di aggiornamento della fleet (oggi: loop manuale `helm upgrade`).
- Emittente di licenze (credenziali di installazione firmate offline).
- Helper di onboarding VPN gestita dal cliente (oggi: solo pattern documentato).
- Tab Agenti per tenant nel dettaglio del tenant.

## Come posso contribuire?

Vedi la pagina [Contribuire](/it-it/contribute).

## Dove posso ottenere aiuto?

- Issues: https://github.com/soctalk/soctalk/issues
- Discussions: https://github.com/soctalk/soctalk/discussions
- Security: vedi SECURITY.md nel repository
