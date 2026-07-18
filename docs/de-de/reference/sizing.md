# Sizing-Profil für Pilot-Installationen


## Referenzprofile

Zwei Referenz-Hostgrößen für dieses Release.

### small-dev

Vorgesehen für: Entwicklung, Demos, Single-Tenant-POC.

| Ressource | Wert |
|---|---|
| CPU | 4 vCPU |
| RAM | 16 GB |
| Disk | 100 GB SSD |
| Max. Mandanten | **1–2** |
| Reserviert für SocTalk Control Plane | ~2 GB RAM, 1 vCPU |
| Budget pro Mandant | ~6–8 GB RAM, 1–1,5 vCPU |

Bootzeiten sind hier langsamer; es gilt das SLO `<30 min to OSS stack healthy`.

### pilot-prod

Vorgesehen für: MSSP mit echten Pilotkunden, 3–5 Mandanten.

| Ressource | Wert |
|---|---|
| CPU | 8 vCPU |
| RAM | 32 GB |
| Disk | 500 GB SSD |
| Max. Mandanten | **3–5** |
| Reserviert für SocTalk Control Plane | ~3 GB RAM, 1–2 vCPU |
| Budget pro Mandant | ~5–7 GB RAM, 1–1,5 vCPU |

Bootzeiten gemäß dem SLO `<15 min to OSS stack healthy`.

## Footprint pro Mandant (Schätzungen)

Dies sind Ausgangswerte für `ResourceQuota` und `LimitRange` im Tenant-Chart. Die Vorabvalidierung misst die tatsächlichen Werte; diese ersetzen die Schätzwerte in den finalen Values.

| Komponente | RAM request | RAM limit | CPU request | CPU limit | Disk (PVC) |
|---|---|---|---|---|---|
| Wazuh manager | 512 MB | 1 GB | 200 m | 500 m | 20 GB |
| Wazuh indexer (OpenSearch fork) | 2 GB (heap 1 GB) | 4 GB (heap 2 GB) | 500 m | 2000 m | 50 GB |
| Wazuh dashboard | 512 MB | 1 GB | 100 m | 500 m | |
| Filebeat | 128 MB | 256 MB | 50 m | 200 m | |
| TheHive | 1 GB | 2 GB | 300 m | 1000 m | |
| Cassandra (TheHive backing) | 2 GB | 4 GB | 500 m | 1500 m | 30 GB |
| Cortex | 768 MB | 1.5 GB | 200 m | 800 m | |
| Cortex ElasticSearch | 1 GB | 2 GB | 300 m | 1000 m | 20 GB |
| SocTalk adapter | 128 MB | 256 MB | 50 m | 200 m | |
| **Gesamt pro Mandant (Limits)** | **~8 GB request, ~16 GB limit** | | **~2,2 vCPU request, ~7,7 vCPU limit** | | **~120 GB** |

Hinweis: Limits sind Burst-Obergrenzen; die dauerhafte Nutzung liegt näher an den Requests. Der Betrieb von 3 Mandanten auf einem Host mit 8 vCPU / 32 GB / 500 GB bedeutet:
- RAM: ~24 GB an Requests (passt), ~48 GB an Limits (erfordert sorgfältiges Overcommit-Tuning).
- CPU: ~6,6 vCPU an Requests (passt zusammen mit der Control Plane), Bursts teilen sich die Gesamtkapazität.
- Disk: ~360 GB an Mandanten-PVCs (passt mit Reserve für Control Plane + SocTalk-DB).

Deshalb ist `pilot-prod` auf 5 Mandanten begrenzt; jenseits von 5 stoßen die Speicherlimits selbst unter Berücksichtigung von Overcommit an die Node-Kapazität.

## Formel für maximale Mandanten pro Node

Näherung:

```
max_tenants = floor((node_total_RAM - control_plane_RAM - safety_margin) / per_tenant_RAM_request)
```

- `control_plane_RAM`: 2 GB (small-dev) oder 3 GB (pilot-prod) für SocTalk + Postgres + Ingress-Controller + Cilium + cert-manager.
- `safety_margin`: 10 % des Node-RAM für K8s-System-Pods, CNI, DNS, Monitoring.
- `per_tenant_RAM_request`: 8 GB als Baseline.

Für 32 GB pilot-prod: `floor((32 - 3 - 3.2) / 8) = floor(25.8 / 8) = 3` garantierte Mandanten ohne Overcommit. Mit Overcommit sind 4–5 bei typischen Warnungsvolumina sicher.

## Faktoren für die Disk-Dimensionierung

Der dominierende Disk-Verbraucher ist der Wazuh indexer (speichert indizierte Events). Die Ingest-Rate bestimmt das Wachstum:

| Warnungsrate | Tägliche Indexgröße (grob) | Aufbewahrung 30 Tage | Aufbewahrung 90 Tage |
|---|---|---|---|
| 10 Warnungen/Sek. dauerhaft | ~5 GB/Tag | 150 GB | 450 GB |
| 1 Warnung/Sek. dauerhaft | ~500 MB/Tag | 15 GB | 45 GB |
| 100 Warnungen/Tag | ~10 MB/Tag | 300 MB | 900 MB |

Die Mandanten-PVC-Größen im Chart sind standardmäßig auf **50 GB** für den Wazuh indexer gesetzt; MSSPs überschreiben dies pro Mandant für Kunden mit hohem Volumen.

Die Aufbewahrungsrichtlinie hält standardmäßig 30 Tage Hot-Data im Indexer vor; ältere Daten werden gelöscht oder archiviert (ein Hot→Cold-Tiering ist nicht implementiert; ein künftiges Release fügt es hinzu).

## Sizing-Gates

### Prüfung vor der Provisionierung

Wenn ein MSSP-Operator einen neuen Mandanten anlegt, führt der SocTalk-Controller eine Plausibilitätsprüfung durch:

```
available_RAM = node.allocatable.memory - sum(ns.resourceQuota.requests.memory for ns in existing_tenant_namespaces) - control_plane_reserve
if (new_tenant.resourceQuota.requests.memory > available_RAM):
    refuse with "insufficient cluster capacity for new tenant"
    or
    prompt MSSP: "this will overcommit; proceed? [y/N]"
```

Dieses Gate ist in diesem Release weicher gehalten (Warnung statt hartem Abbruch), da MSSPs für Kunden mit geringer Nutzung absichtlich überbuchen können.

### LimitRange-Durchsetzung pro Mandant

Jeder Mandanten-Namespace hat eine `LimitRange`:

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

Verhindert, dass ein versehentlich falsch konfigurierter Pod 30 GB anfordert und den Node aushungert.

## Profile darüber hinaus

Dokumentiert, aber in diesem Release nicht validiert:

| Profil | CPU | RAM | Disk | Max. Mandanten |
|---|---|---|---|---|
| **mid-host** | 16 vCPU | 64 GB | 1 TB | 10–15 |
| **large-host** | 32 vCPU | 128 GB | 2 TB | 25–30 |
| **multi-node cluster** | 3 nodes × large | | - | 50+ (stattdessen wird eine künftige Multi-Install empfohlen) |

Empfehlung für MSSPs, die über die Kapazität von `pilot-prod` hinauswachsen:
- : einen zweiten Host hinzufügen, eine zweite SocTalk-Installation betreiben (das Schema unterstützt dies, das Tooling ist manuell).
- ein künftiges Release: Multi-Install-Automatisierung in der Cloud-Schicht.
- ein künftiges Release: geclustertes K3s mit ordentlichem Scheduling über Nodes hinweg.

## Messplan (Vorabvalidierung)

Der Spike liefert echte Zahlen, um die Schätzungen in §2 zu ersetzen:

1. `soctalk-tenant` mit einem Mandanten auf `k3d` (Dev-Harness) deployen.
2. Idle-Messung: einen Snapshot mit `kubectl top pod -n tenant-acme` erstellen.
3. Lasttest: 10 Minuten lang 10 Warnungen/Sek. injizieren; Peak messen.
4. Last stoppen; ~5 Minuten später für "Warm-Idle"-Zahlen messen.
5. Mit drei parallelen Mandanten wiederholen, um Interferenzen zu beobachten.
6. Die Tabellen dieses Dokuments mit den gemessenen Werten aktualisieren.
