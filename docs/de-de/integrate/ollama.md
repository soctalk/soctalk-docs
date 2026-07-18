# Ollama (lokales LLM)

Betreibe die KI-Triage von SocTalk gegen ein **lokales** Modell mit [Ollama](https://ollama.com/) — kein Cloud-LLM, keine Kosten pro Token, deine Daten bleiben auf deiner Infrastruktur. Ollama stellt eine **OpenAI-kompatible** API bereit, und der mandantenspezifische `runs-worker` von SocTalk (die Komponente, die das LLM tatsächlich aufruft) spricht direkt mit ihr.

Diese Seite beschreibt das komplette Setup. Zum allgemeinen Provider-Modell siehe [LLM-Provider](/de-de/integrate/llm-providers).

## Wie es zusammenpasst

Der mandantenspezifische **`runs-worker`** ist der LLM-Client. Sein Provider/Modell/Base-URL stammen aus der Konfiguration des Mandanten und werden in seine Umgebung gerendert:

```
SOCTALK_LLM_PROVIDER=openai            # openai-compatible maps to "openai"
OPENAI_BASE_URL=http://<host>:11434/v1 # your Ollama endpoint
SOCTALK_FAST_MODEL=qwen2.5:7b
SOCTALK_REASONING_MODEL=qwen2.5:7b
```

Die Konfiguration von Ollama besteht also aus vier Werten: **Provider** `openai-compatible`, **Base-URL**, die auf Ollama zeigt, ein gepulltes **Modell** und ein **Dummy-API-Key** (Ollama ignoriert ihn, aber das Secret darf nicht leer sein).

## 1. Ollama installieren

Auf einem Host, den der Cluster erreichen kann (ein Node oder eine beliebige Maschine im selben Netzwerk):

```bash
curl -fsSL https://ollama.com/install.sh | sh

# An alle Interfaces binden, damit die Mandanten-Pods es erreichen (Standard ist nur 127.0.0.1)
sudo mkdir -p /etc/systemd/system/ollama.service.d
printf '[Service]\nEnvironment="OLLAMA_HOST=0.0.0.0:11434"\n' \
  | sudo tee /etc/systemd/system/ollama.service.d/override.conf
sudo systemctl daemon-reload && sudo systemctl restart ollama

# Ein tool-fähiges Modell pullen (siehe "Ein Modell auswählen" unten)
ollama pull qwen2.5:7b
```

Prüfe, dass es antwortet: `curl http://<host>:11434/api/version`.

## 2. Einen Mandanten auf Ollama ausrichten

Pro Mandant, über die API (oder das Äquivalent in deiner Automatisierung):

```bash
curl -X PATCH https://<your-mssp-host>/api/mssp/tenants/<tenant-id>/llm \
  -H 'Content-Type: application/json' -b <admin-session-cookie> \
  -d '{
        "provider": "openai-compatible",
        "base_url": "http://<host>:11434/v1",
        "model":    "qwen2.5:7b",
        "api_key":  "ollama"
      }'
```

Dies persistiert die `IntegrationConfig` des Mandanten und stellt eine erneute Bereitstellung in die Warteschlange — der Controller führt `helm upgrade` für das Mandanten-Chart aus, der `runs-worker` wird mit der Ollama-Umgebung neu ausgerollt, **und die Egress-NetworkPolicy öffnet automatisch den Port von Ollama** (siehe die Hinweise zur Erreichbarkeit). Neue Triage-Läufe gehen an Ollama.

Um Ollama zum Standard für **jeden** neuen Mandanten zu machen, setze `defaults.llm` in den `soctalk-system`-Values bei der Installation:

```yaml
defaults:
  llm:
    provider: openai-compatible
    baseUrl: http://<host>:11434/v1
    model: qwen2.5:7b
llm:
  provider: openai
  apiKey: "ollama"
```

::: warning V1: die Settings-UI zeigt den falschen Provider an
In diesem Release spiegelt das MSSP-UI-Panel **Settings → LLM** die fest kodierten Defaults des *API-Pods* wider (z. B. `gpt-4o`), **nicht** die tatsächliche Konfiguration des Mandanten. Die maßgebliche Quelle ist die mandantenspezifische `IntegrationConfig` (`GET /api/mssp/tenants/{id}/llm`) und die Umgebung des `runs-worker`. Vertraue der Settings-Seite nicht, um Ollama zu bestätigen.
:::

## 3. Checkliste zur Erreichbarkeit (die Dinge, die dich beißen)

- **An `0.0.0.0` binden.** Ollama lauscht standardmäßig auf `127.0.0.1` — Pods können das nicht erreichen. Setze `OLLAMA_HOST=0.0.0.0:11434` (Schritt 1).
- **Verwende in der Base-URL nicht `localhost`/`127.0.0.1`.** Das ist der *Pod*, nicht der Ollama-Host. Verwende die routbare IP des Hosts (oder betreibe Ollama in-cluster als Service). Pods erreichen IPs aus privaten Bereichen (`10.0.0.0/8`, `172.16.0.0/12`) über die Standard-Egress-Freigaben.
- **Egress-Port.** Die Egress-NetworkPolicy des `runs-worker` des Mandanten öffnet den LLM-Port, **abgeleitet aus der Base-URL** (also `:11434` für Ollama, `:8000` für vLLM usw.). Das ist ab `soctalk-tenant`-Chart **≥ 0.1.2** automatisch. Bei älteren Charts erlaubte die Policy nur `:443` — entweder upgraden, den Port manuell freigeben oder Ollama mit einem TLS-Reverse-Proxy auf `:443` vorschalten.
- **Dummy-API-Key.** Lässt du ihn leer, überspringt das Chart das Secret → der Worker startet ohne `OPENAI_API_KEY` und läuft auf einen Fehler. Verwende einen beliebigen nicht-leeren String.

## 4. Verifizieren

Prüfe, dass der Worker mit Ollama verdrahtet ist und eine echte Triage durch ihn läuft:

```bash
# 1. tenant config (authoritative)
curl -s https://<host>/api/mssp/tenants/<id>/llm   # provider/base_url/model = Ollama

# 2. worker env
kubectl -n tenant-<slug> get deploy soctalk-runs-worker \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' \
  | grep -E 'LLM_PROVIDER|MODEL|OPENAI_BASE'

# 3. Ollama actually serving SocTalk
ollama ps                                   # model loaded while triaging
journalctl -u ollama | grep /v1/chat/completions   # 200s during a triage
```

Wenn eine Warnung eintrifft, wird die Untersuchung vom lokalen Modell triagiert — der Wert **Agent Run / Token Spend** in der Untersuchung spiegelt die von Ollama generierten Tokens wider:

![Untersuchung durch Ollama triagiert](/screenshots/ollama-investigation.png)

## Ein Modell auswählen

Die Pipeline von SocTalk führt **Tool-Calling + strukturierte JSON-Verdikte** aus, wähle also ein Instruct-Modell mit solider Tool-Unterstützung — `qwen2.5`, `llama3.1`, `mistral-nemo`. Kleine/ältere Modelle scheitern oft an der strukturierten Ausgabe. Die Reasoning-Ebene profitiert am meisten von einem stärkeren Modell; du kannst sie mit `fast_model` / `reasoning_model` aufteilen (ein kleiner, schneller Router + ein größeres Verdikt-Modell).

::: tip CPU ist langsam
Auf einer CPU läuft ein 7B-Modell mit ~zig Tokens/Sek., und eine einzige Triage macht mehrere LLM-Aufrufe — rechne mit **Minuten** pro Untersuchung. Verwende einen GPU-Host für nutzbare Latenz oder ein kleineres schnelles Modell.
:::
