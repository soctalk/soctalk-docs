# Profilo di sizing per le installazioni pilota


## Profili di riferimento

Due dimensioni host di riferimento per questa release.

### small-dev

Destinato a: sviluppo, demo, POC single-tenant.

| Risorsa | Valore |
|---|---|
| CPU | 4 vCPU |
| RAM | 16 GB |
| Disco | 100 GB SSD |
| Tenant massimi | **1–2** |
| Control plane SocTalk riservato | ~2 GB RAM, 1 vCPU |
| Budget per tenant | ~6–8 GB RAM, 1–1.5 vCPU |

I tempi di avvio qui sono più lenti; si applica lo SLO `<30 min to OSS stack healthy`.

### pilot-prod

Destinato a: MSSP che gestisce clienti pilota reali, 3–5 tenant.

| Risorsa | Valore |
|---|---|
| CPU | 8 vCPU |
| RAM | 32 GB |
| Disco | 500 GB SSD |
| Tenant massimi | **3–5** |
| Control plane SocTalk riservato | ~3 GB RAM, 1–2 vCPU |
| Budget per tenant | ~5–7 GB RAM, 1–1.5 vCPU |

Tempi di avvio sullo SLO `<15 min to OSS stack healthy`.

## Footprint per tenant (stime)

Questi sono i valori di partenza per `ResourceQuota` e `LimitRange` nel chart del tenant. La validazione pre-release misura i valori reali; i valori reali sostituiscono questi nei values finali.

| Componente | Richiesta RAM | Limite RAM | Richiesta CPU | Limite CPU | Disco (PVC) |
|---|---|---|---|---|---|
| Wazuh manager | 512 MB | 1 GB | 200 m | 500 m | 20 GB |
| Wazuh indexer (fork di OpenSearch) | 2 GB (heap 1 GB) | 4 GB (heap 2 GB) | 500 m | 2000 m | 50 GB |
| Wazuh dashboard | 512 MB | 1 GB | 100 m | 500 m | |
| Filebeat | 128 MB | 256 MB | 50 m | 200 m | |
| TheHive | 1 GB | 2 GB | 300 m | 1000 m | |
| Cassandra (backing di TheHive) | 2 GB | 4 GB | 500 m | 1500 m | 30 GB |
| Cortex | 768 MB | 1.5 GB | 200 m | 800 m | |
| Cortex ElasticSearch | 1 GB | 2 GB | 300 m | 1000 m | 20 GB |
| Adapter SocTalk | 128 MB | 256 MB | 50 m | 200 m | |
| **Totale per tenant (limiti)** | **~8 GB richiesta, ~16 GB limite** | | **~2.2 vCPU richiesta, ~7.7 vCPU limite** | | **~120 GB** |

Nota: i limiti sono soglie massime di burst; l'utilizzo sostenuto è più vicino alle richieste. Eseguire 3 tenant su un host da 8 vCPU / 32 GB / 500 GB significa:
- RAM: ~24 GB di richieste (rientra), ~48 GB di limiti (richiede un'attenta messa a punto dell'overcommit).
- CPU: ~6.6 vCPU di richieste (rientra con il control plane), i burst condividono il totale.
- Disco: ~360 GB di PVC dei tenant (rientra con margine per il control plane + il DB di SocTalk).

Per questo `pilot-prod` si limita a 5 tenant; oltre i 5, i limiti di memoria iniziano a scontrarsi con la capacità del nodo anche tenendo conto dell'overcommit.

## Formula dei tenant massimi per nodo

Approssimazione:

```
max_tenants = floor((node_total_RAM - control_plane_RAM - safety_margin) / per_tenant_RAM_request)
```

- `control_plane_RAM`: 2 GB (small-dev) o 3 GB (pilot-prod) per SocTalk + Postgres + ingress controller + Cilium + cert-manager.
- `safety_margin`: 10% della RAM del nodo per i pod di sistema K8s, CNI, DNS, monitoring.
- `per_tenant_RAM_request`: 8 GB come baseline.

Per pilot-prod da 32 GB: `floor((32 - 3 - 3.2) / 8) = floor(25.8 / 8) = 3` tenant garantiti senza overcommit. Con l'overcommit, 4–5 è sicuro per i volumi di alert tipici.

## Fattori di sizing del disco

Il principale consumatore di disco è il Wazuh indexer (memorizza gli eventi indicizzati). Il tasso di ingest determina la crescita:

| Tasso di alert | Dimensione indice giornaliera (indicativa) | Retention 30 giorni | Retention 90 giorni |
|---|---|---|---|
| 10 alert/sec sostenuti | ~5 GB/giorno | 150 GB | 450 GB |
| 1 alert/sec sostenuto | ~500 MB/giorno | 15 GB | 45 GB |
| 100 alert/giorno | ~10 MB/giorno | 300 MB | 900 MB |

Le dimensioni dei PVC dei tenant nel chart hanno come default **50 GB** per il Wazuh indexer; gli MSSP le sovrascrivono per singolo tenant per i clienti ad alto volume.

La policy di retention ha come default 30 giorni di dati hot nell'indexer; i dati più vecchi vengono eliminati o archiviati (non implementa il tiering hot→cold; una release futura lo aggiungerà).

## Gate di sizing

### Controllo pre-provisioning

Quando l'operatore MSSP crea un nuovo tenant, il controller SocTalk esegue un controllo di sanità:

```
available_RAM = node.allocatable.memory - sum(ns.resourceQuota.requests.memory for ns in existing_tenant_namespaces) - control_plane_reserve
if (new_tenant.resourceQuota.requests.memory > available_RAM):
    refuse with "insufficient cluster capacity for new tenant"
    or
    prompt MSSP: "this will overcommit; proceed? [y/N]"
```

In questa release questo gate è più morbido (avviso anziché blocco netto) poiché gli MSSP possono voler intenzionalmente fare overcommit per clienti a basso utilizzo.

### Applicazione del LimitRange per tenant

Ogni namespace di tenant ha un `LimitRange`:

```yaml
apiVersion: v1
kind: LimitRange
metadata: { name: tenant-limits, namespace: tenant-acme }
spec:
  limits:
    - type: Container
      default:
        memory: "2Gi"
        cpu: "500m"
      defaultRequest:
        memory: "256Mi"
        cpu: "100m"
      max:
        memory: "6Gi"
        cpu: "2"
```

Impedisce che un pod configurato in modo errato per errore richieda 30 GB affamando il nodo.

## Profili oltre

Documentati ma non validati in questa release:

| Profilo | CPU | RAM | Disco | Tenant massimi |
|---|---|---|---|---|
| **mid-host** | 16 vCPU | 64 GB | 1 TB | 10–15 |
| **large-host** | 32 vCPU | 128 GB | 2 TB | 25–30 |
| **cluster multi-nodo** | 3 nodi × large | | - | 50+ (si consiglia invece la multi-installazione di una release futura) |

Raccomandazione per gli MSSP che superano la capacità di `pilot-prod`:
- : aggiungere un secondo host, eseguire una seconda installazione di SocTalk (lo schema lo supporta, il tooling è manuale).
- una release futura: automazione multi-installazione nel livello Cloud.
- una release futura: K3s in cluster con scheduling corretto tra i nodi.

## Piano di misurazione (validazione pre-release)

Lo spike produce numeri reali per sostituire le stime nella §2:

1. Deploy di `soctalk-tenant` con un tenant su `k3d` (dev-harness).
2. Misurazione a riposo: acquisire uno snapshot di `kubectl top pod -n tenant-acme`.
3. Test di carico: iniettare 10 alert/sec per 10 minuti; misurare il picco.
4. Interrompere il carico; misurare ~5 minuti dopo per i numeri "warm-idle".
5. Ripetere con tre tenant in parallelo per osservare l'interferenza.
6. Aggiornare le tabelle di questo documento con i valori misurati.
