# Cortex

[Cortex](https://thehive-project.org/) fornisce l'analisi degli observable (reputazione, detonazione in sandbox, whois, ecc.) tramite i suoi plugin "analyzer". Il nodo [`cortex_worker`](/it-it/ai-pipeline) di SocTalk invia gli observable a Cortex durante l'arricchimento.

## Modello di hosting

Il chart `soctalk-tenant` in V1 non ha un subchart Cortex (`dependencies: []`). Le opzioni sono:

- **Cortex gestito dal cliente**: il cliente esegue il proprio; l'MSSP fornisce URL + chiave API.
- **Nessun Cortex**: la pipeline AI tenta comunque il percorso `ENRICH` (il supervisor non sa che Cortex è assente); ogni invocazione di `cortex_worker` fallisce e il fallimento viene registrato nel log. In V1 non esiste un campo di stato per singolo observable; il worker semplicemente ritorna senza arricchimento e il supervisor prosegue.

Un "subchart Cortex integrato" è stato descritto in bozze precedenti come opzione pianificata, ma **non è implementato in questa release**.

## Configurazione (UI MSSP)

Dettaglio del Tenant → Impostazioni → Cortex.

| Campo | Note |
|---|---|
| Enable | Disattivato per impostazione predefinita |
| URL | `https://cortex.<customer>.example` per il Cortex gestito dal cliente; `http://cortex.tenant-<slug>.svc:9001` per quello integrato |
| API key | La chiave API Cortex del cliente con `analyze:any` |
| Verify TLS | Attivo per impostazione predefinita |
| Default TLP | Predefinito `2` (Amber). Usato quando SocTalk invia observable privi di TLP |

**In V1 non esiste un'API per modificare le impostazioni di integrazione di Cortex.** Le chiamate a Cortex risiedono nel **runs-worker per singolo Tenant**, non nel pod API centrale, quindi le variabili d'ambiente su `soctalk-system-api` non hanno effetto. Per configurare Cortex in V1, imposta le variabili d'ambiente sul Deployment `soctalk-runs-worker` del Tenant nel namespace `tenant-<slug>` (`helm upgrade` del chart del Tenant, oppure `kubectl set env` + `rollout restart`). Ruota la chiave API applicando una patch al Secret del namespace del Tenant e riavviando il runs-worker. Una superficie di configurazione pulita e guidata da API è nella roadmap.

## Selezione dell'analyzer

Per ciascun observable, il worker prova il **primo nome di analyzer** in una `ANALYZER_MAP` hard-coded (in [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) corrispondente al tipo dell'observable, senza verificare se quell'analyzer sia effettivamente installato sull'istanza Cortex. Se l'analyzer non è installato (o fallisce), il fallimento viene registrato nel log e il worker ritorna senza l'arricchimento. In V1 non c'è un fallback verso un secondo analyzer; installa l'analyzer canonico indicato in `ANALYZER_MAP` per ciascun tipo di observable che ti interessa. L'esposizione dell'ordine di preferenza degli analyzer come valore del chart è nella roadmap.

## Costi

Cortex in sé è gratuito; i provider degli analyzer applicano tariffe per le query. SocTalk non contabilizza direttamente le chiamate a Cortex, contabilizzale presso il provider:

- VirusTotal: quota per chiave
- AbuseIPDB: quota per chiave
- Hybrid Analysis: quota per chiave

Il throughput di observable per singolo Tenant è visibile tramite `soctalk_tenant_events_ingested_total` (ogni evento ingerito attiva ~1–5 estrazioni di observable) in [Observability](/it-it/observability#per-tenant-counters-defined-surface).

## Comportamento del worker

Il nodo `cortex_worker` ha una `ANALYZER_MAP` hard-coded (in [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py)) che mappa ciascun tipo di observable a un piccolo elenco di nomi di analyzer. Per ciascun observable, il worker invia al **primo** analyzer di quell'elenco senza verificarne la disponibilità; se quell'analyzer non è installato o fallisce, l'arricchimento dell'observable viene registrato come fallito.

Sequenza:

1. Legge dallo stato l'elenco corrente degli observable del case.
2. Per ciascun observable, cerca l'elenco di analyzer in `ANALYZER_MAP` per il suo tipo.
3. Invia al primo analyzer mappato tramite l'endpoint `/api/observable` di Cortex.
4. Interroga `/api/job/{id}/report` finché il job non termina o non scatta un timeout per singolo job.
5. Aggiunge allo stato del case il verdetto (`safe`, `info`, `suspicious`, `malicious`) e il corpo del report. I job falliti registrano l'errore nel log e proseguono.

Le chiamate a Cortex fallite non fanno fallire il run, il worker registra il fallimento nel log e ritorna al supervisor senza arricchimento per quell'observable. Il nodo del verdict ragiona su qualunque contesto sia disponibile.

## Cortex integrato: non in questa release

Il chart `soctalk-tenant` non integra Cortex come subchart. Esegui Cortex autonomamente (gestito dal cliente) se desideri l'arricchimento tramite analyzer. Un Cortex gestito da SocTalk è nella roadmap.

## Rotazione della chiave API

1. Genera una nuova chiave in Cortex con `analyze:any`.
2. Applica una patch al Secret del namespace del Tenant che contiene le credenziali Cortex e riavvia il runs-worker: `kubectl -n tenant-<slug> rollout restart deploy/soctalk-runs-worker`.
3. Revoca la vecchia chiave in Cortex.

## Cosa non è trattato qui

- Sviluppo di analyzer personalizzati, fuori ambito; vedi [TheHive-Project/Cortex-Analyzers](https://github.com/TheHive-Project/Cortex-Analyzers).
- Override di TLP/PAP per singolo observable, pianificati; oggi il valore predefinito del Tenant si applica a ogni invio.

## Riferimenti nel codice sorgente

| Concetto | File |
|---|---|
| Nodo worker + ANALYZER_MAP | [`src/soctalk/workers/cortex.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/workers/cortex.py) |
| Schema delle impostazioni | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
