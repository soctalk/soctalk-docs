# Backup und Wiederherstellung

Was ein MSSP sichert, wie oft und wie wiederhergestellt wird. SocTalk hält den Zustand in drei Schichten; jede hat ihren eigenen Backup- und Wiederherstellungspfad.

Diese Seite baut auf [Täglicher Betrieb — Datenbank-Wiederherstellung](/de-de/operations#database-restore-disaster-recovery) auf, wo dieselbe Prozedur auf Runbook-Ebene dokumentiert ist. Nutze diese Seite, um die Strategie zu planen; nutze die Betriebsseite für die konkreten Handgriffe.

## Was zu sichern ist

### 1. Postgres (die Control Plane)

`soctalk-system-postgres-0` enthält:

- Mandanten-Zeilen + Lebenszyklus-Ereignisse
- Benutzer, Sitzungen, Rollen
- Untersuchungen, Fälle, Runs, Proposals
- Einstellungen (LLM, Integrationen, Branding)
- Append-only `audit_log` und event-sourced `case_events`
- Outbox-Zeilen, die auf die Verarbeitung durch den Executor warten

**Verlusttoleranz: null**. Ein verlorenes Postgres = verlorene Audit-Historie, keine wiederherstellbaren Untersuchungen.

### 2. Kubernetes Secrets in `soctalk-system`

| Secret (Chart-gerenderter Name) | Was darin enthalten ist |
|---|---|
| `soctalk-system-llm-api-key` | LLM-Provider-API-Key (installationsweiter Standard) |
| `soctalk-system-bootstrap-admin` | Initiale Admin-E-Mail + Passwort (falls `install.bootstrapAdmin.password` in den Values gesetzt) |
| `soctalk-system-jwt-signing-key` | Signaturschlüssel für Sitzungs-Token |
| `soctalk-system-adapter-signing-key` | Signaturschlüssel für Adapter-Token |
| `soctalk-system-postgres-admin-creds` | Postgres-`soctalk_admin`-Anmeldedaten (Migrationen) |
| `soctalk-system-postgres-app-creds` | Postgres-`soctalk_app`-Anmeldedaten (Laufzeit) |
| `soctalk-system-postgres-mssp-creds` | Postgres-`soctalk_mssp`-Anmeldedaten (mandantenübergreifende Abfragen) |
| `soctalk-slack-creds` | Slack-Token (per Env bereitgestellt; nicht Chart-gerendert) |
| `soctalk-thehive-creds` | TheHive-API-Key (per Env bereitgestellt) |
| `soctalk-cortex-creds` | Cortex-API-Key (per Env bereitgestellt) |

Ein neu generierter Satz von Secrets ist wiederherstellbar, aber laufende Sitzungen brechen ab und Integrations-Anmeldedaten müssen erneut eingefügt werden.

### 3. Mandantenspezifische PVCs

Für jeden `tenant-<slug>`-Namespace:

| PVC | Was darin enthalten ist |
|---|---|
| `wazuh-indexer-data` | Gesamte Wazuh-Warnungs- und Ereignishistorie |
| `wazuh-manager-data` | Wazuh-Agent-Registrierungen + Manager-Zustand |
| `cortex-data` | Cortex Elasticsearch (falls Cortex aktiviert) |
| `thehive-data` | TheHive Cassandra (falls TheHive aktiviert) |

Mandanten mit `poc`-Profil verwenden `local-path`, das **keine echte Persistenzgarantie bietet** — ein Node-Neustart kann Daten verlieren. Mandanten mit `persistent`-Profil verwenden die StorageClass, die die Installation als Standard markiert; sichere sie gemäß der Dokumentation dieses Provisioners.

## Frequenz

| Schicht | Empfohlene Frequenz | Aufbewahrung |
|---|---|---|
| Logisches Postgres-Backup (`pg_dump`) | täglich | 30 Tage |
| Postgres-WAL-Archivierung | kontinuierlich | 7 Tage |
| Snapshot der Kubernetes Secrets | wöchentlich + bei jeder Rotation | 90 Tage |
| Mandantenspezifische PVCs | passend zum SLA deines Kunden (typischerweise täglich bei Compliance-Arbeit) | pro Vertrag |

Compliance-Kunden (PCI, HIPAA, SOC 2) erfordern oft längere Aufbewahrung. Behandle die obigen Werte als Untergrenze.

## Postgres-Backup

### pg_dump (logisch)

Läuft gegen die aktive Datenbank, ohne Ausfallzeit. Langsamere Wiederherstellung als ein physisches Backup, komprimiert aber gut und ist portabel.

```bash
kubectl -n soctalk-system exec soctalk-system-postgres-0 -- \
  pg_dump -U soctalk_app -d soctalk -Fc -Z 9 \
  > soctalk-$(date +%Y%m%d).pgdump
```

Leite die Ausgabe an deinen üblichen Offsite-Speicher weiter (S3, GCS, Azure Blob).

### WAL-Archivierung (Point-in-Time)

**In diesem Release nicht über das Chart verdrahtet.** Das `soctalk-system`-Chart stellt keinen `postgres.archiveCommand`-Value bereit, daher erfordert PITR ein Postgres-Deployment außerhalb des im Chart gebündelten StatefulSets. Zwei Wege:

1. **Postgres extern betreiben** (verwaltetes RDS / Cloud SQL / Azure Database for PostgreSQL). Konfiguriere WAL-Archivierung / PITR gemäß der Dokumentation des Providers. **Das Chart auf ein externes Postgres zeigen zu lassen, ist in V1 nicht über die Values verdrahtet** — das Chart codiert die Verbindungsdetails des gebündelten StatefulSets fest in die Rollen-Anmeldedaten-Secrets. Heute bedeutet das entweder, ein eigenes Helm-Overlay zu betreiben, das die `DATABASE_URL`-Env des API-Deployments patcht, oder `soctalk-system-postgres-app-creds` / `-mssp-creds` / `-admin-creds` nach der Installation zu modifizieren. Ein `postgres.external`-Values-Regler steht auf der Roadmap.
2. **Sidecar-Archiver** in deinem eigenen Helm-Overlay (z. B. [`spilo`](https://github.com/zalando/spilo) oder [`wal-g`](https://github.com/wal-g/wal-g) als Sidecar). Außerhalb des Umfangs des Charts; läuft als separates Deployment, das WAL an Objektspeicher streamt.

In jedem Fall bleibt die SocTalk-Seite unverändert — die Data Plane behandelt Postgres als externe Abhängigkeit. Die Verdrahtung eines Chart-seitigen `archiveCommand` ist für ein zukünftiges Release vorgemerkt.

## Wiederherstellung (Postgres)

Siehe das [Runbook](/de-de/operations#database-restore-disaster-recovery). Zusammenfassung:

1. Skaliere die API auf null, damit nichts schreibt (das V1-Chart bündelt den Orchestrator in den API-Pod — ein Deployment).
2. `pg_restore` den Dump (erst die DB bereinigen).
3. Bei Verwendung von WAL: WAL bis zum gewünschten Point-in-Time wiedereinspielen.
4. Skaliere die API wieder hoch.

Nach der Wiederherstellung kann der API-Pod (der den Orchestrator im V1-Chart einbettet) einen Anstoß benötigen, um ausstehende Runs erneut aufzunehmen:

```bash
kubectl -n soctalk-system rollout restart deploy soctalk-system-api
```

## Secrets-Backup

K8s Secrets sind wegen des Geheimnismaterials mühsam sicher zu sichern. Zwei Muster:

### Sealed Secrets (empfohlen)

Installiere [Bitnami sealed-secrets](https://github.com/bitnami-labs/sealed-secrets) einmal pro Cluster. Wandle deine Secrets in `SealedSecret`-Ressourcen um; committe diese nach git. Der Controller des Clusters entschlüsselt sie zur Installationszeit. Der Verlust eines Secrets ist aus git wiederherstellbar.

### Velero mit restic / kopia

[Velero](https://velero.io) sichert Kubernetes-Ressourcen (einschließlich Secrets) sowie PVCs in Objektspeicher. Verwende den [in-tree CSI-Snapshotter](https://velero.io/docs/main/csi/) für PVCs und Standard-Ressourcen-Backup für Secrets.

```bash
velero backup create soctalk-system-daily \
  --include-namespaces soctalk-system \
  --snapshot-volumes \
  --schedule "0 2 * * *"
```

## Mandantenspezifisches PVC-Backup

Mandanten mit `persistent`-Profil verwenden eine echte StorageClass; nutze die Snapshot-Tools dieses Provisioners:

- **Longhorn**: integrierte geplante Backups nach S3
- **Rook/Ceph**: RBD-Snapshots oder `cephfs-mirror`
- **CSI-Cloud-Volumes (EBS/Persistent Disk/Azure Disk)**: native Snapshot-APIs

Für Velero-Nutzer deckt `velero backup create tenant-<slug>-daily --include-namespaces tenant-<slug> --snapshot-volumes` sowohl die PVCs als auch die K8s-Objekte in einem Durchgang ab.

## Mandantenspezifische Wiederherstellung

1. Stilllege den bestehenden Mandanten (falls vorhanden) — dies löscht den Namespace.
2. Stelle die PVCs in einem frischen Namespace aus dem Snapshot wieder her.
3. Onboarde einen Mandanten mit demselben Slug und Profil über `POST /api/mssp/tenants/onboard` — die Provisionierung ist idempotent auf dem Namespace, sodass die Helm-Installation die wiederhergestellten PVCs übernimmt.
4. Prüfe, ob Wazuh die bestehenden Agents sieht (keine erneute Registrierung nötig, wenn die PVC-Wiederherstellung sauber war).

Wenn nur die Data Plane beschädigt ist (nicht die SocTalk-Control-Plane), ist der einfachere Weg `helm rollback tenant-<slug>`, gefolgt von einer In-Place-Wiederherstellung der PVCs.

## Wiederherstellungsübung

Führe vierteljährlich eine Wiederherstellungsübung durch. Wähle einen Non-Prod-Cluster oder einen vorübergehend stillgelegten Mandanten. Zeitlich auf 4 h begrenzen. Dokumentiere, was fehlgeschlagen ist, und aktualisiere diese Seite.

Häufige Fehler, die die Übung aufdeckt:

- WAL-Lücke (die Archivierung ist während eines Node-Ausfalls zurückgefallen)
- Secrets, die seit dem letzten Backup rotiert wurden
- StorageClass-Fehlanpassung zwischen Cluster und Snapshot
- Netzwerkrichtlinie, die den wiederhergestellten Pod daran hindert, das neue Postgres zu erreichen

## Was hier nicht abgedeckt ist

- Cluster-weite Disaster Recovery (Ausfall von Control-Plane-Nodes usw.) — das ist Kubernetes-Betrieb, nicht SocTalk-spezifisch. Siehe die Dokumentation deiner Distribution.
- Wiederherstellung von LLM-Provider-Anmeldedaten — außerhalb des Umfangs; verwalte sie mit deinem normalen Runbook zur Secret-Rotation.
- Backups von Kunden-Endpunkten — Verantwortung des Kunden, nicht des MSSP.
