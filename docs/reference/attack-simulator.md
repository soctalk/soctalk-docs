# Attack simulator and linux-ep

A pair of demo tools that generate realistic Wazuh alerts so an MSSP operator can see SocTalk's [AI pipeline](/ai-pipeline) actually do work. Strongly recommended for evaluations and live demos — without alerts there's nothing for the agent to triage.

Both ship with the FOSS distribution. Source:

- [`attack-simulator/`](https://github.com/soctalk/soctalk/tree/main/attack-simulator) — scripts and rule pack
- [`charts/linux-ep/`](https://github.com/soctalk/soctalk/tree/main/charts/linux-ep) — Kubernetes chart that runs the simulator

## linux-ep chart

`linux-ep` spins up N Linux-endpoint pods, each:

1. Installs the Wazuh agent and enrolls with the tenant's Wazuh manager.
2. Runs scripted MITRE ATT&CK techniques against itself on a configurable interval.
3. Caps daily simulated alerts per pod (default 30/UTC day) to control LLM spend.

The pods register as `linux-ep-0`, `linux-ep-1`, … so the SocTalk UI shows realistic hostnames in the alert stream.

### Install

```bash
helm install linux-ep oci://ghcr.io/soctalk/charts/linux-ep \
  --version 0.2.0 \
  --namespace tenant-demo \
  --set wazuh.managerHost=wazuh-demo-wazuh-manager \
  --set wazuh.credsSecret.name=wazuh-demo-wazuh-creds \
  --set replicas=2 \
  --set simulator.enabled=true \
  --set simulator.dailyAlertCap=30
```

For the [demo VM image](/quickstart-vm), the simulator is off by default to avoid burning LLM budget unattended; enable it explicitly via `simulator.enabled=true`.

### Helm values (key ones)

| Key | Default | Effect |
|---|---|---|
| `replicas` | 1 | Number of endpoint pods |
| `wazuh.managerHost` | "" (required) | The tenant's Wazuh manager Service hostname (e.g. `wazuh-demo-wazuh-manager`) |
| `wazuh.credsSecret.name` | "" (required) | Existing Secret with the `authd` enrollment password (typically `wazuh-<slug>-wazuh-creds`) |
| `wazuh.credsSecret.authdPasswordKey` | `AUTHD_PASS` | Key inside the Secret for the `authd` password |
| `simulator.enabled` | `false` | Master toggle. Off by default — leaving it off keeps the pods idle (no synthetic alerts) |
| `simulator.attackDelay` | 10 | Seconds after pod start (agent enrolled) before the first TTP |
| `simulator.attackInterval` | 120 | Seconds between subsequent TTPs |
| `simulator.dailyAlertCap` | 30 | Per-pod cap on `SOCTALK_ATTACK` emissions per UTC day. 0 disables the cap |
| `image.repository` | `ghcr.io/soctalk/soctalk-linux-ep` | — |
| `securityContext.privileged` | `true` | Required for kernel-touching TTPs (process namespaces, file-perm tweaks) |

### Cost note

Each simulated alert kicks off an AI investigation, which spends LLM tokens (typical: ~50k input / ~10k output per case at default models). With 2 pods × 30 alerts/day = 60 investigations/day. Adjust `dailyCapPerPod` to your demo budget.

## Simulated techniques

25 Linux TTPs from the MITRE ATT&CK Enterprise matrix. The full list lives in [`attack-simulator/scripts/linux-techniques.txt`](https://github.com/soctalk/soctalk/blob/main/attack-simulator/scripts/linux-techniques.txt); summarized here by tactic:

| Tactic | TTP IDs (selected) |
|---|---|
| **Initial Access / Persistence** | T1098 (account manipulation), T1547.001 (boot/logon scripts) |
| **Privilege Escalation** | T1548.003 (sudo abuse) |
| **Defense Evasion** | T1027 (obfuscated cmd: base64 decode + run), T1070 (indicator removal) |
| **Credential Access** | T1110 (brute force), T1003.008 (`/etc/passwd` + `/etc/shadow` access) |
| **Discovery** | T1046 (network service discovery), T1082 (system info), T1083 (file/dir discovery), T1057 (process discovery) |
| **Lateral Movement** | T1021.004 (SSH) |
| **Collection** | T1560.001 (data archive for exfil staging) |
| **Command and Control** | T1105 (ingress tool transfer) |
| **Exfiltration** | T1041 (over C2 channel) |
| **Impact** | T1485 (data destruction), T1486 (data encryption), T1496 (resource hijacking) |
| **Execution / Scheduling** | T1053.003 (scheduled task / cron) |

Each script emits a syslog line tagged `SOCTALK_ATTACK <TTP>: <description>` so Wazuh has something to match.

## Wazuh rule pack

[`charts/wazuh/templates/manager-local-rules.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/wazuh/templates/manager-local-rules.yaml) ships custom rules in the 100200-100299 range:

- **100200** — chain-root: matches any `SOCTALK_ATTACK` syslog line
- **100210 – 100225** — per-TTP rules: assign severity (level 10–14) and tags by MITRE technique
- **100299** — catch-all for unmapped TTPs (severity 8)

Alerts produced carry MITRE `attack.tactic`, `attack.technique`, and a human-readable description, so the SocTalk [`wazuh_worker`](/ai-pipeline) has structured context to reason about.

## Running a single attack

Outside the chart, you can run individual techniques against any host with a Wazuh agent:

```bash
ssh ops@<linux-ep-pod>
sudo /opt/scripts/run-attack.sh T1110
sudo /opt/scripts/run-attack.sh T1027.001
```

`run-attack.sh` is the entry point — it dispatches to the per-TTP scripts. Useful for live demos where you want to trigger a specific alert on command.

## Removing the simulator

For a live customer install where you don't want simulator alerts diluting real telemetry:

```bash
helm uninstall linux-ep -n tenant-<slug>
```

Removes the endpoint pods. The custom Wazuh rule pack stays in place but is harmless without `SOCTALK_ATTACK` syslog lines hitting it.

## What's not in here

- **Windows endpoint sim** — Linux only in this release. Roadmap.
- **macOS endpoint sim** — same.
- **Adversary emulation campaigns** — single-TTP only; we don't chain TTPs into multi-stage scenarios.
- **Atomic Red Team integration** — `attack-simulator` is hand-rolled; it does not consume Atomic's YAML directly. Compatibility is on the roadmap.
