# LLM-Provider

Die Runtime ([`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py)) unterstützt zwei Provider, ausgewählt über `SOCTALK_LLM_PROVIDER`:

- `anthropic`: über `langchain-anthropic` (Claude-Modelle)
- `openai`: über `langchain-openai` (OpenAI oder jeder OpenAI-kompatible Endpoint, der `Authorization: Bearer <key>` gegen `POST /v1/chat/completions` beachtet: Azure OpenAI, vLLM, Ollama, LiteLLM usw.)

In V1 wird die Provider-Umgebungsvariable (`SOCTALK_LLM_PROVIDER`) **ausschließlich von den pro-Mandant laufenden runs-worker**-Pods beachtet. Der API-Pod selbst verwendet fest codierte Provider-Standardwerte. Der Provider pro Mandant ist über `PATCH /api/mssp/tenants/{tenant_id}/llm` einstellbar (siehe [Pro-Mandant-Overrides](#per-tenant-overrides)).

Ein selbst gehostetes, OpenAI-kompatibles Modell ist eine erstklassige Option, kein Fallback: Richte den `openai`-Provider auf einen von dir betriebenen vLLM- oder SGLang-Server, einen verwalteten serverless GPU-Endpoint oder ein lokales Ollama, alles über `OPENAI_BASE_URL`. SocTalk klassifiziert Backends nach Liefermodell, warme verwaltete API, scale-to-zero serverless GPU, dauerhaft betriebene gemietete GPU oder lokal, und jedes hat ein anderes Kosten- und Latenzprofil. Wie du wählst, siehe [Die AI-Triage-Rechnung niedrig halten](/de-de/guides/inference-cost-optimization) und [Was Triage-Inferenz tatsächlich kostet, gemessen](/de-de/guides/inference-cost-benchmark).

## Was das Chart bereitstellt

Das `soctalk-system`-Chart akzeptiert installationsweite LLM-Standardwerte, die die pro-Tier-LLM-Konfiguration jedes neu onboardeten Mandanten seeden:

```yaml
defaults:
  llm:
    provider: openai-compatible          # SOCTALK_LLM_PROVIDER_DEFAULT
    baseUrl: https://api.openai.com/v1   # SOCTALK_LLM_BASE_URL_DEFAULT
    model: gpt-4o                        # SOCTALK_LLM_MODEL_DEFAULT
    fastTier: {}                         # optional cheaper router/supervisor tier; off until provider/baseUrl/model are set

llm:
  provider: openai               # provider whose API key the install ships with
  existingSecret: ""             # Secret with anthropic-api-key / openai-api-key keys
  apiKey: ""                     # inline alternative; creates ONE provider key only (not both), dev / lab use only
```

**Wie die Standardwerte wirken:** Die `defaults.llm.*`-Schlüssel werden beim Onboarding eines Mandanten gelesen und seeden die pro-Tier-Konfiguration des neuen Mandanten, sodass ein nach ihrem Setzen erstellter Mandant sie erbt. Bestehende Mandanten behalten ihre aktuelle Konfiguration, bis sie gepatcht werden.

**Wo die aufgelöste Konfiguration läuft:** das pro-Mandant vorhandene `soctalk-runs-worker`-Deployment. Dessen Umgebungsvariablen `SOCTALK_LLM_PROVIDER`, `SOCTALK_FAST_MODEL`, `SOCTALK_REASONING_MODEL` und `OPENAI_BASE_URL` werden vom Provisioning-Controller aus der Konfigurationszeile des Mandanten gerendert, und das ist die Oberfläche, die steuert, welchen Provider und welches Modell jeder Tier aufruft.

## Wechsel zu Anthropic

Um einen Mandanten direkt gegen Anthropic laufen zu lassen (ohne OpenAI-kompatiblen Proxy dazwischen), setze den Provider pro Mandant über `PATCH /api/mssp/tenants/{id}/llm`:

```json
{ "provider": "anthropic" }
```

…und stelle den Anthropic-Key über den BYOK-Flow bereit (`PUT /api/tenant/llm/api-key`). Der Controller rendert `SOCTALK_LLM_PROVIDER=anthropic` auf den runs-worker dieses Mandanten, der `langchain-anthropic` verwendet.

Der Chart-Wert `llm.provider: anthropic` + `llm.existingSecret` (Secret mit einem `anthropic-api-key`-Schlüssel) befüllen das installationsweite Anmeldedaten-Secret, das der Controller in neue Mandanten spiegelt, aber der Chart-Wert selbst setzt in V1 `SOCTALK_LLM_PROVIDER` **nirgends**; die Provider-Auswahl erfolgt pro Mandant.

## API-Keys

Niemals in `values.yaml`. Bereitstellung über `Secret/soctalk-system-llm-api-key`:

```bash
kubectl -n soctalk-system create secret generic soctalk-system-llm-api-key \
  --from-file=anthropic-api-key=./anthropic.key \
  --from-file=openai-api-key=./openai.key \
  --dry-run=client -o yaml | kubectl apply -f -
```

Stelle nach Möglichkeit beide Keys bereit, das Chart bündelt unabhängig vom aktiven Provider beide Keys in das Secret, sodass ein späterer Provider-Wechsel (z. B. dev: openai → prod: anthropic) kein Neuanlegen des Secrets erfordert.

## Einstellungs-UI

[Einstellungen → LLM](/de-de/mssp-ui#settings) in der MSSP-UI zeigt den aktiven Provider, das Modell, die Basis-URL, die Temperatur und die maximalen Tokens an. Die Felder sind **in diesem Release schreibgeschützt**: das `Read-only`-Badge erscheint neben dem Titel. Mutationen sind nicht implementiert; heute sind die Chart-Werte + die umgebungsbasierte Auswahl der Runtime maßgeblich.

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
- Die Data-Residency-Regeln eines Kunden erfordern einen regionsspezifischen Endpoint.
- Ein Evaluations-Mandant verwendet ein günstigeres Modell als die Produktion.

Ablauf der LLM-Key-Rotation pro Mandant: siehe [Täglicher Betrieb → Pro-Mandant-LLM-Key rotieren](/de-de/operations#rotate-per-tenant-llm-key).

## Kostenhinweise

- Die Runtime führt pro Untersuchung viele kleine LLM-Aufrufe aus (Supervisor + Worker + Abschluss) und einen großen Reasoning-Aufruf (Verdict). Die Trennung von schnell und Reasoning ist nun pro Tier konfigurierbar: SocTalk löst jede Rolle, einen leichteren router/supervisor Tier und einen stärkeren verdict/reasoning Tier, in ihren eigenen Tier auf, der jeweils auf seinen eigenen Provider, sein eigenes Modell und seinen eigenen Endpoint zeigt. Die `defaults.llm.fastTier`-Stellschraube in den Werten des `soctalk-system`-Charts und das pro-Tier-Rendering in der Provisioning-Schicht lassen dich den fast Tier auf ein günstiges Modell zeigen, während du ein stärkeres Modell für das Verdict behältst, sodass du die Verdict-Qualität nicht mehr eintauschst, um die Kosten pro Aufruf zu senken. Der fast Tier ist standardmäßig aus (`fastTier: {}`); setze `provider`, `baseUrl` und `model`, um ihn zu aktivieren. Er seedet die pro-Tier-Konfiguration neu onboardeter Mandanten, sodass bestehende Mandanten ihr aktuelles Setup behalten, bis sie gepatcht werden.
- Der Token-Verbrauch pro Mandant wird über die Prometheus-Metrik `soctalk_tenant_llm_tokens_total{direction="input|output"}` gemessen, siehe [Observability](/de-de/observability#per-tenant-cost).
- Self-Hosting zahlt sich nur aus, wenn du die GPU ausgelastet hältst. Die `runsWorker.concurrency`-Stellschraube (Standard `1`) legt fest, wie viele Untersuchungen ein runs-worker parallel verarbeitet; erhöhe sie, um einen selbst gehosteten continuous batch zu füllen und eine dauerhaft betriebene GPU über mehr Arbeit zu amortisieren. Siehe [Die AI-Triage-Rechnung niedrig halten](/de-de/guides/inference-cost-optimization) dazu, wie du sie gegen ein bestimmtes Backend dimensionierst.

## Sanity-Test

In diesem Release wird keine dedizierte Smoke-Test-CLI ausgeliefert. Die schnellste Prüfung besteht darin, einen Test-Mandanten zu onboarden und die Orchestrator-Logs anzusehen (`kubectl -n soctalk-system logs deploy/soctalk-system-api -f`), die erste Untersuchung bringt jede Provider-Fehlkonfiguration zum Vorschein. Ein per Skript ausgeführter Smoke-Test-Befehl ist auf der Roadmap.

## Quellverweise

| Konzept | Datei |
|---|---|
| Provider-Factory | [`src/soctalk/llm.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/llm.py) |
| Umgebungsbasierte Einstellungsauflösung | [`src/soctalk/settings_provider.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/settings_provider.py) |
| Chart-LLM-Werte | [`charts/soctalk-system/values.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/soctalk-system/values.yaml) |
| Einstellungsantwort | [`src/soctalk/api/routes/settings.py`](https://github.com/soctalk/soctalk/blob/main/src/soctalk/api/routes/settings.py) |
