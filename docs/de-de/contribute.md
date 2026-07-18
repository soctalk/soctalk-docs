# Mitwirken

SocTalk steht unter Apache 2.0. PRs sind willkommen. Diese Seite behandelt den Entwicklungs-Loop und was du von einer Prüfung erwarten kannst.

## Entwicklungsumgebung

Bring einen lokalen Cluster hoch, der für SocTalk bereit ist:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk
./scripts/dev-up.sh           # cluster dependencies only
```

`scripts/dev-up.sh` erstellt einen k3d-Cluster und installiert die Voraussetzungen auf Cluster-Ebene:

- K3s mit deaktiviertem Flannel + kube-proxy
- Cilium als CNI mit NetworkPolicy-Durchsetzung
- cert-manager installiert
- k3d local-path als Standard-StorageClass

Es **baut keine** SocTalk-Images, installiert nicht das SocTalk-Chart, onboardet keine Mandanten und lädt keine Daten vor — frühere Entwürfe dieser Seite behaupteten dies. Führe die nächsten Schritte selbst aus. Typische Abfolge nach `dev-up.sh`:

```bash
just build-api build-frontend  # api image embeds the orchestrator in V1
helm install soctalk-system charts/soctalk-system \
  -n soctalk-system --create-namespace \
  --set install.bootstrapAdmin.email=dev@example \
  --set install.bootstrapAdmin.password=devpassword12
# migrations + bootstrap admin run in the API pod's init command
# sign in at https://<your-ingress>/ with the credentials you set above
```

Für einen schnelleren inneren Loop (kein Image-Rebuild bei jeder Änderung) siehe die Iterationstipps weiter unten.

## Wähle deinen Iterations-Loop

Gemäß Projektkonvention solltest du Dienste bevorzugt mit `uvicorn` / `pnpm dev` ausführen, statt den k3d-Zyklus aus Build, Push und Redeploy zu durchlaufen:

```bash
# API (embeds the orchestrator in V1)
cd src && uvicorn soctalk.core.api.app_v1:app --reload --port 8000

# Frontend
cd frontend && pnpm dev
```

Richte sie über `kubectl port-forward` auf Postgres / Wazuh / Cortex des k3d-Clusters aus. Die Iteration dauert Sekunden, nicht Minuten.

## Repo-Aufbau

```text
src/                Python (control plane, AI pipeline, adapter, runs-worker)
frontend/           SvelteKit (MSSP + customer UI)
charts/             Helm charts (soctalk-system, soctalk-tenant, wazuh, linux-ep)
infra/packer/       VM image generation (see /downloads)
setup-wizard/       Go (first-boot setup wizard)
attack-simulator/   MITRE ATT&CK demo scripts
scripts/            Dev / e2e / seed scripts
alembic/            DB migrations
docker-compose*.yml Various dev composition files
justfile            Build / release recipes
```

Die Docs-Site (diese Site) liegt in einem separaten Repo, [`soctalk/soctalk-docs`](https://github.com/soctalk/soctalk-docs).

## Tests

In diesem Release gibt es keine `just test` / `just test-rls` / `just e2e-l1-l2`-Rezepte — das ist die geplante Form. Heute führst du Tests direkt mit pytest aus:

```bash
pytest tests/                          # full suite
pytest tests/v1/test_rls_isolation.py  # Postgres Row-Level Security suite
```

Die RLS-Tests sind nicht verhandelbar — sie verifizieren die mandantenübergreifende Datenisolation, die das [Sicherheitsmodell](/de-de/reference/security-model) verspricht. CI führt die vollständige pytest-Suite bei jedem PR aus.

## Stil

- Python: ruff + black. CI erzwingt es.
- TypeScript: ESLint + Prettier mit der repo-internen Konfiguration. CI erzwingt es.
- Commit-Nachrichten: einzeiliger Betreff, Conventional-Commit-Präfix (`feat:`, `fix:`, `chore:`, `ci:`, `chart:`, …). Kein Body erforderlich.
- Keine co-authored-by / signed-off-by Trailer.

## PR-Erwartungen

- **Tests für die Änderung.** Neue Endpunkte brauchen API-Tests; neue Graph-Knoten brauchen State-Machine-Tests; Chart-Änderungen brauchen gerenderte Template-Snapshots.
- **Migration, wenn du ein Modell angefasst hast.** Alembic generiert automatisch; prüfe das generierte SQL vor dem Commit auf Korrektheit.
- **Aktualisiere die Docs** in [`soctalk-docs`](https://github.com/soctalk/soctalk-docs), wenn die Änderung ein dokumentiertes Verhalten betrifft. Bei rein internen Refactorings sind wir hierbei nicht streng; bei allem, was für Benutzer sichtbar ist, sind wir streng.
- **Kleine PRs.** Große PRs mit gemischten Änderungen sind schwer zu prüfen. Trenne Refactoring von Feature; trenne Chart-Änderung von Laufzeitänderung.

## Deine eigene Arbeit prüfen

Bevor du eine Prüfung anforderst, lass codex gegen deine Änderungen laufen:

```bash
codex review --uncommitted
```

Das ist derselbe Prüfdurchlauf, den wir zur Release-Zeit ausführen. Er fängt die offensichtlichen Probleme ab, bevor ein menschlicher Prüfer es tun muss.

## Releasen

Releases werden von `main` getaggt. Heute hat der Ablauf mehr manuelle Schritte, als das geplante `just release`-Rezept vermuten lässt:

1. Versionen in `Chart.yaml` + `pyproject.toml` manuell erhöhen, committen, pushen.
2. Den Commit taggen und den Tag pushen (`git tag v0.1.x && git push --tags`).
3. `just release` — führt `just build-all push-all` aus. Dies **baut und pusht nur Container-Images**; es taggt nicht, veröffentlicht keine Charts und erstellt kein GitHub Release.
4. Der GH-Workflow `publish-images.yml` übernimmt die Image-Veröffentlichung nach ghcr.io, wenn er ausgelöst wird.
5. Die Chart-Veröffentlichung nach `ghcr.io/soctalk/charts/` erfolgt heute manuell mit `helm push`.
6. `gh release create`, um das GitHub Release zu erstellen.
7. `build-packer-images.yml` (manueller Trigger) baut das [Demo-VM-Image](/de-de/downloads) in allen fünf Formaten und hängt sie an das GitHub Release an.

Die Zusammenführung der Schritte 1, 2, 5 und 6 in das `just release`-Rezept steht auf der Roadmap.

## Sicherheitsmeldung (Disclosure)

Wenn du eine Schwachstelle gefunden hast, **erstelle kein öffentliches Issue.** Sende eine E-Mail an die in SECURITY.md im Repo-Root angegebene Adresse. Wir antworten innerhalb von zwei Werktagen.

## Lizenz

Apache 2.0. Mit dem Einreichen eines PR erklärst du dich einverstanden, deinen Beitrag unter derselben Lizenz zu lizenzieren.

## Anerkennung

Das git-Log ist heute die maßgebliche Aufzeichnung der Mitwirkenden; eine dedizierte CONTRIBUTORS.md / `just update-contributors` ist geplant.
