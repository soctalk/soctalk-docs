---
title: "Wazuh multi-tenant per MSSP: pattern architetturali che isolano davvero i tenant"
description: "Come gestire Wazuh multi-tenant come MSSP: manager per tenant su Kubernetes, RLS di Postgres, isolamento di rete, enrollment degli agent e dimensionamento per tenant."
---

# Wazuh multi-tenant per MSSP: pattern architetturali che isolano davvero i tenant

Wazuh non ha una multi-tenancy di prima classe. Non esiste un oggetto "tenant" nel manager, nessun confine per cliente nel ruleset e nessuno scoping per cliente dell'enrollment `authd`. Ogni MSSP che si standardizza su Wazuh finisce per costruire la tenancy attorno ad esso — e il pattern che scegli determina le tue garanzie di isolamento, la velocità di onboarding e il costo minimo per cliente.

Questa guida copre ciò di cui un MSSP ha realmente bisogno da un deployment Wazuh multi-tenant, i tre pattern che i team provano nella pratica e cosa richiede un isolamento di livello produttivo oltre il SIEM stesso. È l'architettura che SocTalk implementa come open source (Apache 2.0); le pagine di riferimento collegate lungo il testo approfondiscono ciascun livello.

## Cosa serve a un MSSP che Wazuh non fornisce

Tre requisiti emergono in ogni conversazione sul deployment per MSSP:

1. **Un isolamento difendibile in una security review del cliente.** "Il cliente A non può leggere gli alert del cliente B" deve valere a livello dati, a livello rete e a livello di enrollment degli agent — non solo nella dashboard.
2. **Velocità di onboarding.** Se il provisioning del SOC di un nuovo cliente richiede una settimana di lavoro manuale, il pattern non scala oltre una manciata di clienti.
3. **Controllo dei costi per tenant.** Devi sapere quanto costa un cliente in RAM, CPU e disco, porre un tetto e impedire che un tenant rumoroso affami gli altri.

## I tre pattern che gli MSSP provano

### Pattern 1: manager condiviso, separazione a livello di indice

Un solo manager Wazuh, gli agent di tutti i clienti registrati contro di esso, separazione fatta a valle — multi-tenancy di OpenSearch Dashboards per gli oggetti della dashboard, index pattern e ruoli di sicurezza per lo scoping in lettura. È il pattern descritto dalla maggior parte delle discussioni sulla multi-tenancy di Wazuh, perché è l'unico realizzabile senza uscire dagli strumenti nativi di Wazuh.

Il problema è che la separazione è un filtro lato lettura, non un confine. Il manager stesso è condiviso: un solo ruleset, un solo segreto `authd`, una sola API, una sola finestra di upgrade per tutti. Un ruolo mal configurato espone tutti i clienti in una volta, e rule pack o policy di retention per cliente sono impossibili senza impattare gli altri.

### Pattern 2: manager per tenant su VM

Una VM (o un set di VM) per cliente, con un manager e un indexer dedicati. L'isolamento è reale — processi, dischi e credenziali separati. È dove gli MSSP approdano dopo che il pattern a manager condiviso li ha scottati. Il costo è operativo: l'onboarding significa fare il provisioning di macchine, gli upgrade significano toccare ogni VM, e la soglia minima di risorse per tenant è una VM intera senza uno scheduling condiviso che recuperi la capacità inutilizzata. Funziona con 5 clienti e fa male con 30.

### Pattern 3: manager per tenant su Kubernetes, dietro un control plane

Ogni cliente riceve un manager, un indexer e una dashboard Wazuh dedicati nel proprio namespace Kubernetes, con una ResourceQuota e un LimitRange che ne limitano il footprint. Un control plane governa il ciclo di vita: l'onboarding esegue il rendering di una release Helm per tenant, il teardown la rimuove, e lo stato dei tenant vive in un database anziché in un foglio di calcolo. L'isolamento viene dal confine del namespace più le NetworkPolicy; la densità dallo scheduler che impacchetta i tenant su nodi condivisi.

### I compromessi, onestamente

| | Manager condiviso + separazione per indice | Manager per tenant su VM | Manager per tenant su Kubernetes |
|---|---|---|---|
| Confine di isolamento | Filtri lato lettura su dati condivisi | Confine di macchina | Namespace + NetworkPolicy + quota |
| Raggio d'impatto di una compromissione | Tutti i clienti | Un cliente | Un cliente |
| Regole / retention / upgrade per tenant | No | Sì | Sì |
| Onboarding di un cliente | Veloce (modifica di configurazione) | Lento (provisioning di macchine) | Veloce, se automatizzato (release Helm) |
| Densità / costo per tenant | Migliore | Peggiore | Buono (impacchettato dallo scheduler, limitato da quota) |
| Competenze operative richieste | Wazuh + sicurezza OpenSearch | Automazione fleet/VM | Kubernetes |
| Operazioni di flotta con 30+ tenant | N/A (uno stack unico) | Dolorose | Gestibili con un control plane |

Dei tre, il pattern 3 è quello costruito per offrire sia un isolamento reale sia velocità di onboarding — ma solo se il control plane esiste. I namespace da soli sono una convenzione di naming, non un confine di sicurezza. Il resto di questa guida riguarda ciò che rende reale quel confine.

## L'isolamento in produzione è più del solo SIEM

Uno stack Wazuh per tenant isola i dati del SIEM. Una piattaforma MSSP ha anche stato cross-tenant — casi, code di revisione, log di audit, configurazioni di integrazione — e quel livello richiede un'applicazione delle regole propria.

### Livello dati: row-level security di Postgres, forzata e testata

Il filtraggio a livello applicativo con `WHERE tenant_id = ?` dista una sola clausola dimenticata da un leak cross-tenant. Deve essere il database stesso a far rispettare la tenancy. Il pattern:

- Ogni tabella con scope di tenant porta policy RLS basate su un'impostazione per transazione `app.current_tenant_id`. Un contesto non impostato restituisce **zero righe** — zero difensivo, non leakage.
- `FORCE ROW LEVEL SECURITY` su ogni tabella con scope di tenant, così anche il proprietario della tabella (il ruolo di migrazione) è soggetto alla policy. Di default Postgres esenta i proprietari; una migrazione che legge dati di tenant potrebbe altrimenti attraversare i tenant in silenzio.
- Una separazione in tre ruoli: un proprietario delle migrazioni, un ruolo runtime soggetto a RLS e un ruolo `BYPASSRLS` segregato, riservato ai percorsi cross-tenant sottoposti ad audit. Nessuna applicazione si connette come superuser.
- Test di isolamento in CI — probe sugli endpoint, SQL grezzo con il ruolo dell'app, worker senza contesto, probe con il ruolo proprietario, stream di eventi cross-tenant. SocTalk esegue sette test di questo tipo, tutti obbligatori; nessuno opzionale.
- Chiavi di idempotenza con scope `UNIQUE (tenant_id, idempotency_key)`, così le pipeline di alert di due clienti possono emettere lo stesso ID di alert esterno senza collidere.

Template completi delle policy, DDL dei ruoli e la suite di test: [RLS di Postgres](/it-it/reference/postgres-rls).

### Livello rete: NetworkPolicy per namespace

Il confine del namespace non significa nulla senza una CNI che lo faccia rispettare — il Flannel di default di K3s non applica affatto le NetworkPolicy. La postura obiettivo è una baseline default-deny per namespace tenant con permessi espliciti: traffico intra-namespace, DNS, accesso del control plane alle porte del data plane del tenant e ingress degli agent su 1514/1515. Il traffico tenant-verso-tenant e l'egress generico dei tenant sono bloccati.

SocTalk usa Cilium come CNI supportata (enforcement delle NetworkPolicy, egress basato su FQDN per gli endpoint LLM indirizzati per hostname, osservabilità dei flussi con Hubble per il debugging delle questioni di isolamento). Tieni presente la riserva della V1: l'allowlist di egress per tenant completamente vincolata agli FQDN è la destinazione del design, e il chart attuale rende policy più semplici — egress permissivo del control plane ed egress TCP/443 ampio per il worker per tenant. I template renderizzati sono nel repo; leggi [Design delle NetworkPolicy](/it-it/reference/network-policy) sia per le policy fornite sia per l'architettura obiettivo.

### Enrollment degli agent: endpoint e segreti per tenant

La modalità di guasto più subdola: l'agent del cliente A che si registra con il manager del cliente B. Il protocollo agent di Wazuh su 1514/TCP è uno stream cifrato proprietario, non TLS standard — non c'è SNI su cui instradare, quindi i proxy L4 che ispezionano l'hostname si rompono in silenzio. Il routing deve avvenire per indirizzo di destinazione: ogni tenant riceve il proprio nome DNS (`acme.soc.mssp.example.com`) che risolve a un endpoint L4 per tenant, con un fallback a porta-per-tenant quando gli IP scarseggiano.

I segreti di enrollment hanno scope di tenant: il segreto condiviso `authd` di ciascun tenant vive nel namespace di quel tenant, quindi un agent in possesso del segreto del tenant A può registrarsi solo con il manager di A — l'indirizzamento lo instrada lì e il manager verifica il segreto. In V1, il provisioning di LoadBalancer e DNS è cablaggio manuale a carico dell'MSSP, non automatizzato. Dettagli e runbook di enrollment: [Ingress degli agent Wazuh](/it-it/reference/wazuh-ingress).

## Capacità: quanto costa un tenant

I numeri che gli MSSP chiedono per primi, dal lavoro di dimensionamento di SocTalk:

- **Footprint per tenant (stack completo):** ~8 GB di RAM richiesta (~16 GB di limite), ~2,2 vCPU richieste, ~120 GB di disco. L'utilizzo sostenuto segue le request; i limit sono tetti di burst.
- **Il collo di bottiglia è di solito l'indexer Wazuh per tenant** — ognuno è un processo Java con il proprio heap. Pianifica ~6–8 GB di RAM e ~1,5 vCPU per tenant di produzione.
- **Il disco è guidato dal tasso di ingest:** all'incirca 5 GB/giorno di indice a 10 alert/sec sostenuti; la PVC di default dell'indexer è di 50 GB con 30 giorni di retention hot.
- **Scala testata:** fino a ~50 tenant su un cluster a 3 nodi (16 vCPU / 64 GB per nodo). Profili di installazione singola più grandi sono documentati ma non validati in questa release — non pianificare oltre quel numero su una singola installazione senza testare.

Profili host di riferimento e la formula del massimo di tenant per nodo: [Dimensionamento](/it-it/reference/sizing) e la [FAQ sullo scaling](/it-it/faq#does-it-scale-to-n-customers).

## Come SocTalk confeziona questo pattern

SocTalk è un'implementazione open source (Apache 2.0, nessuna divisione community/enterprise) del pattern 3: un control plane, una release Helm `soctalk-tenant` per cliente, sul tuo Kubernetes 1.30+ — K3s, EKS, AKS o GKE.

```mermaid
flowchart TB
    subgraph cp["soctalk-system namespace (control plane)"]
        api["API + orchestrator"]
        ctrl["Provisioning controller"]
        pg[("Postgres — RLS, FORCE, 3 roles")]
        api --> pg
        ctrl --> pg
    end
    subgraph ta["tenant-acme namespace"]
        ma["Wazuh manager"]
        ia["Wazuh indexer"]
        wa["runs-worker + adapter"]
    end
    subgraph tb["tenant-beta namespace"]
        mb["Wazuh manager"]
        ib["Wazuh indexer"]
        wb["runs-worker + adapter"]
    end
    ctrl -- "Helm: soctalk-tenant" --> ta
    ctrl -- "Helm: soctalk-tenant" --> tb
    agA["Customer A agents"] -- "acme.soc.mssp.example.com — 1514/1515" --> ma
    agB["Customer B agents"] -- "beta.soc.mssp.example.com — 1514/1515" --> mb
```

L'onboarding esegue una sequenza di provisioning in nove fasi — preflight, generazione dei segreti, namespace con quote, installazioni Helm, polling di readiness — ognuna delle quali emette un evento di ciclo di vita ed è ritentabile in modo idempotente da `degraded`. Lo stato del tenant è una macchina a stati applicata lato server (`pending → provisioning → active`, con gli stati suspended, decommissioning, archived e purged; le transizioni non valide restituiscono 409). Tre profili di onboarding coprono le demo (`poc`), la produzione (`persistent`) e il BYO-Wazuh (`provided`, in cui SocTalk si connette allo stack esistente di un cliente invece di deployarne uno). Il decommissioning smantella il data plane ma conserva la riga del tenant e la cronologia di audit.

Il ciclo di vita completo — stati, fasi, quote, percorsi di recovery — è in [Ciclo di vita del tenant](/it-it/tenant-lifecycle). Per metterlo in pratica: la [guida di installazione](/it-it/install) copre un cluster di produzione in circa un'ora, e la [VM demo](/it-it/quickstart-vm) avvia un'installazione multi-tenant funzionante con un tenant demo in circa cinque minuti.
