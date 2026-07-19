---
description: Onboarding end-to-end di un cliente Wazuh per MSSP — provisioning di un tenant SOC isolato, enrollment degli agent, consegna degli accessi e baseline della prima settimana.
---

# Onboarding di un tenant cliente in un SOC Wazuh multi-tenant: una checklist per MSSP

Fare l'"onboarding" di un cliente su un servizio Wazuh multi-tenant significa quattro attività, non una: fare il provisioning di uno stack isolato per cliente, registrare gli agent del cliente nel *loro* manager e in nessun altro, consegnare accessi che rispettino il confine MSSP/cliente e stabilire la baseline della prima settimana di operazioni. Questa guida percorre l'intero flusso su SocTalk, dove ogni cliente riceve un manager Wazuh, un indexer e una dashboard dedicati nel proprio namespace Kubernetes, dietro un unico control plane MSSP.

## Decisioni da prendere prima di cliccare New Tenant

**Profilo.** Il profilo è fissato al momento dell'onboarding — cambiarlo in seguito significa decommissionare e ricreare — quindi decidi prima:

- `poc` — valutazioni e pilot di breve durata. Storage `local-path` senza reali garanzie di persistenza, richieste di risorse basse, nessun hook di backup. È anche il **default se non ne specifichi uno**, che è il default sbagliato per un cliente pagante.
- `persistent` — SOC dei clienti in produzione. Usa la StorageClass di default della tua installazione, richieste dimensionate per la produzione, hook di backup rispettati se configurati.
- `provided` — il cliente esegue già Wazuh (BYO-SIEM). SocTalk installa solo il proprio adapter e il runs-worker nel namespace del tenant e raggiunge via rete l'indexer del cliente (`:9200`) e la Manager API (`:55000`). Il materiale di connessione esterna *e* le credenziali LLM per tenant sono obbligatori al momento dell'onboarding — l'API restituisce 422 se mancano.

**Dimensionamento.** Pianifica indicativamente 6–8 GB di RAM e ~1,5 vCPU per ogni tenant `persistent`; l'indexer Wazuh per tenant è di solito il collo di bottiglia e determina il disco (PVC da 50 GB di default, retention hot di 30 giorni, ancora nessun tiering hot→cold). SocTalk è testato fino a ~50 tenant su un cluster di 3 nodi da 16 vCPU / 64 GB; considera non validato tutto ciò che supera ~5 tenant su un singolo host. Dettagli in [Dimensionamento](/it-it/reference/sizing).

**LLM per tenant.** Il Triage gira su una configurazione LLM per tenant: Anthropic o qualsiasi endpoint compatibile OpenAI (Azure OpenAI, vLLM, Ollama, LiteLLM). Un cliente può portare la propria API key per isolare la fatturazione — montata come Secret Kubernetes nel suo namespace, con la caveat documentata della V1 per cui la chiave è conservata anche in chiaro nel database SocTalk ([Secret](/it-it/reference/secrets)) — oppure puoi puntare il tenant a un endpoint Ollama completamente locale per una postura senza cloud e senza costi per token (metti in conto un'inferenza lenta su CPU). Vedi [Provider LLM](/it-it/integrate/llm-providers).

## Provisioning: cosa succede davvero

Crea il tenant dalla [UI MSSP](/it-it/mssp-ui) (Tenants → **+ New Tenant**) o dall'API. Il tenant entra in una macchina a stati applicata lato server — `pending → provisioning → active`, con `degraded`, `suspended`, `decommissioning`, `archived` e `purged` oltre a questi; le transizioni non valide vengono rifiutate con un 409.

Il controller esegue nove fasi ordinate e idempotenti, ognuna delle quali emette un evento di lifecycle osservabile nella pagina di dettaglio del tenant: controlli di preflight, generazione dei secret per tenant (`authd`, JWT, Postgres), creazione del namespace (`tenant-<slug>` con label, ResourceQuota e LimitRange dimensionati sul profilo), applicazione dei secret, l'installazione Helm di `soctalk-tenant` (che effettua anche il provisioning automatico dell'utente `tenant_admin`), l'installazione del chart Wazuh, un poll di readiness, la scrittura della integration-config e la transizione ad `active`.

Se una fase fallisce, il tenant finisce in `degraded` con lo step fallito registrato nella riga dell'evento. Correggi la causa (PVC bloccato, quota sottodimensionata, image pull) e premi **Retry Provisioning** — il retry riparte dalla fase 1 e ogni fase è idempotente, quindi le riesecuzioni sono sicure. Il retry è valido solo *a partire da* `degraded`, non da `pending`. I runbook per gli stati bloccati sono in [Operazioni quotidiane](/it-it/operations).

## Enrollment degli agent: portare gli endpoint nel tenant giusto

Ogni tenant riceve un nome DNS dedicato (`acme.soc.mssp.example.com`) che risolve verso un endpoint L4 per tenant per 1514/TCP (eventi) e 1515/TCP (enrollment). Il routing avviene per indirizzo di destinazione, non per SNI — il protocollo agent 1514 di Wazuh non è TLS standard e non presenta mai un ClientHello.

**Onesta caveat della V1:** il chart crea il Service del manager Wazuh solo come `ClusterIP`. **In questa release non c'è alcun provisioning automatico di LoadBalancer o DNS** — l'edge lo colleghi tu: un Service LoadBalancer per tenant applicato manualmente, un HAProxy di edge con coppie di porte per tenant su un singolo IP, oppure un percorso mesh-VPN. Anche i record DNS sono gestiti dall'operatore.

L'enrollment in sé è scoped al tenant by design. Recupera il segreto condiviso `authd` del tenant:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Consegna hostname, porte e segreto all'amministratore degli endpoint del cliente attraverso un canale sicuro; lui esegue `agent-auth -m <hostname> -P "<secret>"`. Un agent in possesso del segreto del tenant A può registrarsi solo presso il manager del tenant A. Una tab Agents dedicata e un pannello di Agent Onboarding sono nella roadmap; oggi, verifica gli agent nella dashboard Wazuh integrata (Tenants → **Open SOC** → Agents). Topologia completa e requisiti firewall: [Ingress degli agent Wazuh](/it-it/reference/wazuh-ingress).

## Persone: chi riceve un login

Il provisioning ha già creato un `tenant_admin`. Quel ruolo è self-service: gestisce gli utenti della propria organizzazione e le proprie impostazioni LLM dal portale cliente. Per gli stakeholder che hanno bisogno di visibilità ma non devono mai agire, assegna `customer_viewer` — dashboard e indagini in sola lettura, nessuna coda di revisione, nessuna chat.

Ogni utente creato riceve una password temporanea monouso, mostrata una sola volta e con cambio forzato al primo accesso. Un audience wall separa i due lati: i ruoli tenant non possono mai detenere capability MSSP e viceversa, con enforcement al capability guard, quindi un login cliente non può strutturalmente raggiungere superfici cross-tenant. Nota che in questa release non esiste un flusso self-service di recupero password — i reset sono forzati da un admin. Catalogo completo: [Utenti e ruoli](/it-it/users-and-roles).

## La prima settimana

- **Heartbeat.** Osserva `soctalk_tenant_adapter_heartbeat_age_seconds` su `/metrics` — nella V1 è l'unica gauge aggiornata attivamente e *non* porta automaticamente il tenant in stato degradato, quindi configura tu stesso l'alerting.
- **Coda di revisione.** I nuovi tenant generano traffico di revisione mentre le baseline si assestano; ogni escalation dell'AI attende un umano nella coda della dashboard — non esiste alcun bypass di auto-approvazione.
- **Finestre di engagement.** Se il cliente ha un pentest in programma, dichiara la finestra di engagement (sorgente, host, tecnica, orario) prima che inizi, così l'attività autorizzata viene contrassegnata e sottoposta ad audit invece di essere escalata — e l'attività dei tester fuori scope impone comunque uno sguardo umano.
- **Basi di suspend/decommission.** La sospensione cambia lo stato nel DB e ferma le nuove indagini ma **non** scala i workload — il cut-off di emergenza è un runbook manuale. Il decommissioning smantella il data plane e conserva la riga del tenant più la cronologia di audit in `archived`; non esiste ancora un endpoint API `:purge`.

## Checklist di onboarding

- [ ] Profilo scelto (`persistent` per la produzione; `provided` richiede URL SIEM + credenziali LLM fin dall'inizio)
- [ ] Margine del cluster verificato (~6–8 GB di RAM, ~1,5 vCPU per tenant `persistent`)
- [ ] LLM per tenant deciso (chiave propria / default dell'installazione / Ollama locale)
- [ ] Tenant creato; gli eventi del ciclo di vita hanno raggiunto `active`
- [ ] Edge cablato manualmente: endpoint LB o edge-proxy + record DNS per `<slug>.soc.<domain>`
- [ ] Secret `authd` recuperato e condiviso su un canale sicuro
- [ ] Primo agent registrato e visibile nella dashboard Wazuh del tenant
- [ ] `tenant_admin` consegnato; account `customer_viewer` creati secondo necessità
- [ ] Alerting di heartbeat su `soctalk_tenant_adapter_heartbeat_age_seconds`
- [ ] Ogni pentest pianificato dichiarato come finestra di engagement

## Per approfondire

- [Lifecycle del tenant](/it-it/tenant-lifecycle) — macchina a stati, fasi, percorsi di recovery
- [Ingress degli agent Wazuh](/it-it/reference/wazuh-ingress) — topologie di edge, certificati, revoca
- [Utenti e ruoli](/it-it/users-and-roles) — il catalogo completo dei ruoli e l'audience wall
- [Operazioni quotidiane](/it-it/operations) — il lato runbook di tutto quanto sopra
- [Launchpad](/it-it/launchpad) — prova l'intero flusso in un pilot multi-VM di ~15–25 minuti
