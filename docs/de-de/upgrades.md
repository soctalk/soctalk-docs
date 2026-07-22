# Upgrades

Beide Chart-Klassen werden über `helm upgrade` aktualisiert. Heute ist dies ein Runbook; eine flottenweite Upgrade-API ist auf der Roadmap.

## Pre-Flight-Checkliste

Vor jedem Upgrade:

1. **Lies die [Release Notes](https://github.com/soctalk/soctalk/releases)** für die Zielversion. Migrationen sind nur vorwärts gerichtet; eine überraschende Schema-Änderung kann nicht mit `helm rollback` rückgängig gemacht werden.
2. **Aktualisiere `soctalk-system` vor den Mandanten.** Eine formale Kompatibilitätsmatrix-Oberfläche (System → Versions-UI, `controller.can_upgrade`-Validierung) wird in [Chart Contract](/de-de/reference/chart-contract) als das architektonische Ziel beschrieben, ist aber **in diesem Release nicht implementiert**. Bis sie ausgeliefert wird, folge der Zeile „getestete Kombinationen" aus den Release Notes, aktualisiere zuerst `soctalk-system` und aktualisiere dann jeden Mandanten, sobald du das systemseitige Upgrade verifiziert hast.
3. **Erstelle ein Backup.** Erstelle Snapshots von Postgres + allen Mandanten-PVCs. Siehe den [Abschnitt zur Datenbankwiederherstellung](/de-de/operations#database-restore-disaster-recovery) im Betriebshandbuch.
4. **Führe einen Probelauf (Dry-Run)** mit `helm diff` durch:
   ```bash
   helm diff upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
     --version <new> -n soctalk-system -f values.yaml
   ```

## `soctalk-system` aktualisieren (Install-Ebene)

`soctalk-system-values.yaml` aus der Installation pinnt `image.tag` auf das ursprüngliche Release. Überschreibe dies bei jedem Upgrade, damit der neue Chart das neue Image rendert. Aktualisiere entweder die Datei in der Versionskontrolle oder übergib `--set image.tag=<new-version>` bei jedem der folgenden Befehle.

Migrationen laufen innerhalb des Init-Befehls des API-Pods (siehe [Install → Migrations and bootstrap](/de-de/install#migrations-and-bootstrap-run-automatically)). Ein `helm upgrade` rollt den API-Pod neu aus; der Init-Befehl führt `alembic upgrade head` aus, bevor die neue App startet. Alembic ist idempotent, ein erneuter Lauf auf einem aktuellen Schema ist ein No-Op.

```bash
helm upgrade soctalk-system oci://ghcr.io/soctalk/charts/soctalk-system \
  --version <new-version> \
  --namespace soctalk-system \
  -f soctalk-system-values.yaml \
  --set image.tag=<new-version> \
  --wait --timeout 15m
```

Beobachte die Migration:

```bash
kubectl -n soctalk-system logs deploy/soctalk-system-api -c db-init --follow
```

Wenn `--wait` hängt, ist die häufigste Ursache ein Migrationsfehler, lies die Init-Logs.

### Rollback

```bash
helm rollback soctalk-system <revision> -n soctalk-system --wait
```

Wenn das Upgrade eine Migration eingeführt hat, die Daten berührt hat, wird `helm rollback` das Schema nicht zurücksetzen. Stelle zusätzlich Postgres aus dem Backup vor dem Upgrade wieder her.

## Data Plane eines einzelnen Mandanten aktualisieren

```bash
helm upgrade tenant-<slug> oci://ghcr.io/soctalk/charts/soctalk-tenant \
  --version <new-tenant-chart-version> \
  --namespace tenant-<slug> \
  -f /tmp/tenant-<slug>-values.yaml \
  --wait --timeout 15m
```

`/tmp/tenant-<slug>-values.yaml` ist die von SocTalk gerenderte Values-Datei. Heute gibt es kein betreiberseitiges CLI, um sie zu exportieren; ziehe die zuletzt gerenderten Values aus dem Helm-Release-Secret des Mandanten:

```bash
helm get values tenant-<slug> -n tenant-<slug> -a > /tmp/tenant-<slug>-values.yaml
```

Ein `soctalk-cli render-values`-Befehl wurde in diesem Leitfaden zuvor erwähnt, existiert aber nicht, das einzige CLI-Tool heute ist `soctalk-auth`.

### Rollback pro Mandant

```bash
helm rollback tenant-<slug> <revision> -n tenant-<slug> --wait
```

Rollbacks der Mandanten-Data-Plane sind sicherer als Rollbacks auf Systemebene: Die OSS-Stacks (Wazuh, TheHive, Cortex) speichern ihre eigenen Daten in PVCs, die `helm rollback` unangetastet lässt.

## Flotten-Upgrade (manuelle Schleife)

```bash
# List tenants.
kubectl get ns -l tenant=true,managed-by=soctalk \
  -o jsonpath='{.items[*].metadata.name}'

# Upgrade each, pausing between.
for ns in tenant-acme tenant-beta tenant-gamma; do
  echo "upgrading $ns..."
  helm upgrade ${ns} oci://ghcr.io/soctalk/charts/soctalk-tenant \
    --version <new> -n $ns -f /tmp/${ns}-values.yaml --wait --timeout 15m
  kubectl -n $ns rollout status deploy/soctalk-adapter
  sleep 60   # let heartbeat settle before next.
done
```

Ein zukünftiges Release ersetzt diese Schleife durch eine Canary-fähige Flotten-Upgrade-API.

## Upgrade-Reihenfolge

1. Cluster-Voraussetzungen (CNI, cert-manager, Ingress). Aktualisiere diese unabhängig.
2. Der `soctalk-system`-Chart. Führt Migrationen als Teil des Upgrades auf Install-Ebene aus.
3. Der `soctalk-tenant`-Chart, ein Mandant nach dem anderen, mit Beobachtung auf Regressionen.

Aktualisiere Mandanten-Charts niemals vor `soctalk-system`. Die Kompatibilitätsmatrix lehnt Kombinationen außerhalb des zulässigen Bereichs ab, und die API verweigert die Bereitstellung neuer Mandanten auf nicht übereinstimmenden Versionen.

## Tenant-Chart-Upgrades mit Breaking Changes

Wenn der Mandanten-Chart eine Major-Version von Wazuh, TheHive oder Cortex mit einer Schema-Änderung anhebt:

1. Erstelle zuerst Snapshots der Mandanten-PVCs.
2. Führe das Upgrade in einem Zeitfenster mit geringem Datenverkehr durch.
3. Verifiziere unmittelbar danach, dass Warnungen durchgängig fließen.
4. Sei bereit für ein `helm rollback` plus Wiederherstellung der PVCs, falls der Schema-Migrationsprozess der Data Plane fehlschlägt.

Upstream-OSS-Projekte liefern gelegentlich Breaking Changes aus. Das [Chart-Audit](/de-de/reference/chart-audit) pinnt exakte Subchart-Versionen; das Anheben dieser Versionen ist explizit und wird vor dem Release getestet.
