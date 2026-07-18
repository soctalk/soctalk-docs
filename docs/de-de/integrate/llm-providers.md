# LLM-Provider

Die Runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) unterstützt zwei Provider, ausgewählt über `SOCTALK_LLM_PROVIDER`:

- `anthropic` — über `langchain-anthropic` (Claude-Modelle)
- `openai` — über `langchain-openai` (OpenAI oder jeder OpenAI-kompatible Endpunkt, der `Authorization: Bearer <key>` gegen `POST /v1/chat/completions` beachtet: Azure OpenAI, vLLM, Ollama, LiteLLM usw.)

In V1 wird die Provider-Umgebungsvariable (`SOCTALK_LLM_PROVIDER`) **ausschließlich von den pro-Mandant laufenden runs-worker**-Pods beachtet. Der API-Pod selbst verwendet fest codierte Provider-Standardwerte. Der Provider pro Mandant ist über `PATCH /api/mssp/tenants/{tenant_id}/llm` einstellbar (siehe [Pro-Mandant-Overrides](#per-tenant-overrides)).

## Was das Chart bereitstellt

Heute akzeptiert das `soctalk-system`-Chart drei installationsweite LLM-Wertschlüssel, aber die meisten davon fließen in V1 **nicht** in das Laufzeitverhalten ein:

```yaml
defaults:
  llm:
    provider: openai-compatible   # rendered as SOCTALK_LLM_PROVIDER_DEFAULT on API pod, but V1 API IGNORES this env
    baseUrl: https://api.openai.com/v1   # rendered as SOCTALK_LLM_BASE_URL_DEFAULT, also IGNORED by V1 API
    model: gpt-4o                  # rendered as SOCTALK_LLM_MODEL_DEFAULT, also IGNORED by V1 API

llm:
  provider: openai               # NOT propagated to SOCTALK_LLM_PROVIDER on the API by V1 chart
  existingSecret: ""             # Secret with anthropic-api-key / openai-api-key keys
  apiKey: ""                     # inline alternative; creates ONE provider key only (not both) — dev / lab use only
```

**Zusammenfassung des V1-Verhaltens:** Der API-Pod verwendet seine **eigenen fest codierten Standardwerte** für Provider/Modell/Basis-URL. Die vom Chart gerenderten `*_DEFAULT`-Umgebungsvariablen sind Gerüst für ein zukünftiges Release; heute werden sie nicht gelesen.

**Wo die LLM-Umgebungsverdrahtung tatsächlich wirkt:** das pro-Mandant vorhandene `soctalk-runs-worker`-Deployment. Dessen Umgebungsvariablen `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` und `OPENAI_BASE_URL` werden vom Provisioning-Controller aus der `IntegrationConfig`-Zeile des Mandanten gerendert. Das ist die Oberfläche, die tatsächlich steuert, welcher Provider aufgerufen wird.

## Wechsel zu Anthropic

Um einen Mandanten direkt gegen Anthropic laufen zu lassen (ohne OpenAI-kompatiblen Proxy dazwischen), setze den Provider pro Mandant über `PATCH /api/mssp/tenants/{id}/llm`:

```json
{ "provider": "anthropic" }
```

…und stelle den Anthropic-Key über den BYOK-Flow bereit (`PUT /api/tenant/llm/api-key`). Der Controller rendert `SOCTALK_LLM_PROVIDER=anthropic` auf den runs-worker dieses Mandanten, der `langchain-anthropic` verwendet.

Der Chart-Wert `llm.provider: anthropic` + `llm.existingSecret` (Secret mit einem `anthropic-api-key`-Schlüssel) befüllen das installationsweite Anmeldedaten-Secret, das der Controller in neue Mandanten spiegelt — aber der Chart-Wert selbst setzt in V1 `SOCTALK_LLM_PROVIDER` **nirgends**; die Provider-Auswahl erfolgt pro Mandant.

## API-Keys

Niemals in `values.yaml`. Bereitstellung über `Secret/soctalk-system-llm-api-key`:

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Stelle nach Möglichkeit beide Keys bereit — das Chart bündelt unabhängig vom aktiven Provider beide Keys in das Secret, sodass ein späterer Provider-Wechsel (z. B. dev: openai → prod: anthropic) kein Neuanlegen des Secrets erfordert.

## Einstellungs-UI

[Einstellungen → LLM](/de-de/mssp-ui#settings) in der MSSP-UI zeigt den aktiven Provider, das Modell, die Basis-URL, die Temperatur und die maximalen Tokens an. Die Felder sind **in diesem Release schreibgeschützt** — das `Read-only`-Badge erscheint neben dem Titel. Mutationen sind nicht implementiert; heute sind die Chart-Werte + die umgebungsbasierte Auswahl der Runtime maßgeblich.

API-Keys werden in der Einstellungsantwort niemals angezeigt (nur das `present: bool`-Flag).

## Reine Laufzeit-Stellschrauben (env, nicht Chart)

Mehrere Laufzeit-Stellschrauben existieren als Umgebungsvariablen, sind aber noch nicht als Chart-Werte verfügbar. Setze sie nach der Installation direkt auf dem `soctalk-system-api`-Deployment (das in V1 auch der Orchestrator ist):

| Env var | Effekt |
|---|---|
| `SOCTALK_LLM_PROVIDER` | `anthropic` oder `openai`. Wählt die LangChain-Integration |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` | Provider-Keys (Alternative zum gebündelten Secret) |
| `OPENAI_BASE_URL` | Überschreibt die Basis-URL des OpenAI-Clients (Azure, vLLM, Ollama, …) |
| `OPENAI_API_VERSION`, `OPENAI_API_TYPE` | Azure-spezifisch |
| `SOCTALK_FAST_MODEL` | Überschreibt das schnelle Modell (Standard `claude-sonnet-4-20250514`) |
| `SOCTALK_REASONING_MODEL` | Überschreibt das Reasoning-Modell (Standard `claude-sonnet-4-20250514`) |

Das Chart stellt diese über `defaults.llm.*` für die installationsweiten Standardwerte bereit; Pro-Mandant-Overrides greifen zur Laufzeit über die Umgebung des Mandanten-runs-worker.

## Pro-Mandant-Overrides

LLM-Provider, -Modell und -Basis-URL pro Mandant sind über `PATCH /api/mssp/tenants/{tenant_id}/llm` einstellbar (siehe [`core/api/llm_config.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/core/api/llm_config.py)). Die Änderung wird in der Datenbank persistiert und beim nächsten Deployment in die Umgebung des Mandanten-runs-worker gerendert; in der Praxis übernimmt der runs-worker die Änderung beim nächsten Pod-Neustart (oder beim nächsten `helm upgrade` des Mandanten-Charts).

Das Onboarding-Payload eines Mandanten kann `llm_base_url` und `llm_model` für die initialen Einstellungen enthalten. Die Override-Felder, zur Laufzeit als Umgebung auf dem runs-worker gespiegelt:

| Mandanten-Feld | Env auf runs-worker |
|---|---|
| `llm.provider` | `SOCTALK_LLM_PROVIDER` |
| `llm.base_url` | `OPENAI_BASE_URL` |
| `llm.fast_model` | `SOCTALK_FAST_MODEL` |
| `llm.reasoning_model` | `SOCTALK_REASONING_MODEL` |
| API-Key | `tenant-llm-key`-Secret im Mandanten-Namespace, gemountet per secretKeyRef. `IntegrationConfig.llm_api_key_plain` in Postgres ist der maßgebliche Speicher; der Provisioning-Controller materialisiert das Secret daraus |

Häufige Gründe für ein Override pro Mandant:

- Ein Kunde mit hohem Volumen benötigt einen dedizierten Rate-Limit-Pool / eine dedizierte Preisstufe.
- Die Data-Residency-Regeln eines Kunden erfordern einen regionsspezifischen Endpunkt.
- Ein Evaluations-Mandant verwendet ein günstigeres Modell als die Produktion.

Ablauf der LLM-Key-Rotation pro Mandant: siehe [Täglicher Betrieb → Pro-Mandant-LLM-Key rotieren](/de-de/operations#rotate-per-tenant-llm-key).

## Kostenhinweise

- Die Runtime führt pro Untersuchung viele kleine LLM-Aufrufe aus (Supervisor + Worker + Abschluss) und einen großen Reasoning-Aufruf (Verdikt). Die Wahl eines günstigen Modells für `defaults.llm.model` senkt die Kosten drastisch, verschlechtert derzeit aber auch die Verdikt-Qualität — das Chart trennt schnelles und Reasoning-Modell noch nicht. Eine geplante Änderung trennt beide.
- Der Token-Verbrauch pro Mandant wird über die Prometheus-Metrik `soctalk_tenant_llm_tokens_total{direction="input|output"}` gemessen — siehe [Observability](/de-de/observability#per-tenant-cost).

## Sanity-Test

In diesem Release wird keine dedizierte Smoke-Test-CLI ausgeliefert. Die schnellste Prüfung besteht darin, einen Test-Mandanten zu onboarden und die Orchestrator-Logs anzusehen (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`) — die erste Untersuchung bringt jede Provider-Fehlkonfiguration zum Vorschein. Ein per Skript ausgeführter Smoke-Test-Befehl ist auf der Roadmap.

## Quellverweise

| Konzept | Datei |
|---|---|
| Provider-Factory | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Umgebungsbasierte Einstellungsauflösung | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Chart-LLM-Werte | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Einstellungsantwort | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
