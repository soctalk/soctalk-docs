# Attack Simulator und linux-ep

Ein Paar von Demo-Werkzeugen, die realistische Wazuh-Warnungen erzeugen, damit ein MSSP-Operator die [AI-Pipeline](/de-de/ai-pipeline) von SocTalk tatsächlich bei der Arbeit sehen kann. Wird für Evaluierungen und Live-Demos dringend empfohlen; ohne Warnungen gibt es für den Agenten nichts zu triagieren.

Beide sind Teil der FOSS-Distribution. Quellcode:

- [`attack-simulator/`](https://github.com/soctalk/soctalk/tree/main/attack-simulator), Skripte und Regelpaket
- [`charts/linux-ep/`](https://github.com/soctalk/soctalk/tree/main/charts/linux-ep), Kubernetes-Chart, das den Simulator ausführt

## linux-ep-Chart

`linux-ep` startet N Linux-Endpoint-Pods, von denen jeder:

1. Den Wazuh-Agenten installiert und sich beim Wazuh-Manager des Mandanten registriert.
2. In einem konfigurierbaren Intervall skriptgesteuerte MITRE-ATT&CK-Techniken gegen sich selbst ausführt.
3. Die täglich simulierten Warnungen pro Pod begrenzt (Standard 30/UTC-Tag), um die LLM-Ausgaben zu kontrollieren.

Die Pods registrieren sich als `linux-ep-0`, `linux-ep-1`, … sodass die SocTalk-UI realistische Hostnamen im Warnungs-Stream anzeigt.

### Installation

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

Für das [Demo-VM-Image](/de-de/quickstart-vm) ist der Simulator standardmäßig deaktiviert, um zu vermeiden, dass unbeaufsichtigt LLM-Budget verbraucht wird; aktiviere ihn explizit über `simulator.enabled=true`.

### Helm-Werte (die wichtigsten)

| Key | Standard | Wirkung |
|---|---|---|
| `replicas` | 1 | Anzahl der Endpoint-Pods |
| `wazuh.managerHost` | "" (erforderlich) | Der Service-Hostname des Wazuh-Managers des Mandanten (z. B. `wazuh-demo-wazuh-manager`) |
| `wazuh.credsSecret.name` | "" (erforderlich) | Vorhandenes Secret mit dem `authd`-Registrierungspasswort (typischerweise `wazuh-<slug>-wazuh-creds`) |
| `wazuh.credsSecret.authdPasswordKey` | `AUTHD_PASS` | Key innerhalb des Secrets für das `authd`-Passwort |
| `simulator.enabled` | `false` | Haupt-Schalter. Standardmäßig aus; bleibt er aus, bleiben die Pods im Leerlauf (keine synthetischen Warnungen) |
| `simulator.attackDelay` | 10 | Sekunden nach Pod-Start (Agent registriert) vor dem ersten TTP |
| `simulator.attackInterval` | 120 | Sekunden zwischen nachfolgenden TTPs |
| `simulator.dailyAlertCap` | 30 | Obergrenze pro Pod für `SOCTALK_ATTACK`-Emissionen pro UTC-Tag. 0 deaktiviert die Obergrenze |
| `image.repository` | `ghcr.io/soctalk/soctalk-linux-ep` | — |
| `securityContext.privileged` | `true` | Erforderlich für Kernel-nahe TTPs (Prozess-Namespaces, Anpassungen von Dateiberechtigungen) |

### Kostenhinweis

Jede simulierte Warnung stößt eine AI-Untersuchung an, die LLM-Tokens verbraucht (typisch: ~50k Eingabe / ~10k Ausgabe pro Fall bei den Standardmodellen). Mit 2 Pods × 30 Warnungen/Tag = 60 Untersuchungen/Tag. Passe `dailyCapPerPod` an dein Demo-Budget an.

## Simulierte Techniken

25 Linux-TTPs aus der MITRE-ATT&CK-Enterprise-Matrix. Die vollständige Liste befindet sich in [`attack-simulator/scripts/linux-techniques.txt`](https://github.com/soctalk/soctalk/blob/main/attack-simulator/scripts/linux-techniques.txt); hier nach Taktik zusammengefasst:

| Taktik | TTP-IDs (Auswahl) |
|---|---|
| **Initial Access / Persistence** | T1098 (Kontenmanipulation), T1547.001 (Boot-/Logon-Skripte) |
| **Privilege Escalation** | T1548.003 (sudo-Missbrauch) |
| **Defense Evasion** | T1027 (verschleierter Befehl: base64-Dekodierung + Ausführung), T1070 (Entfernung von Indikatoren) |
| **Credential Access** | T1110 (Brute Force), T1003.008 (Zugriff auf `/etc/passwd` + `/etc/shadow`) |
| **Discovery** | T1046 (Erkennung von Netzwerkdiensten), T1082 (Systeminformationen), T1083 (Datei-/Verzeichnis-Erkennung), T1057 (Prozess-Erkennung) |
| **Lateral Movement** | T1021.004 (SSH) |
| **Collection** | T1560.001 (Datenarchiv für Exfiltrations-Staging) |
| **Command and Control** | T1105 (Ingress-Tool-Transfer) |
| **Exfiltration** | T1041 (über C2-Kanal) |
| **Impact** | T1485 (Datenzerstörung), T1486 (Datenverschlüsselung), T1496 (Ressourcen-Hijacking) |
| **Execution / Scheduling** | T1053.003 (geplante Aufgabe / cron) |

Jedes Skript gibt eine Syslog-Zeile mit dem Tag `SOCTALK_ATTACK <TTP>: <description>` aus, damit Wazuh etwas hat, worauf es abgleichen kann.

## Wazuh-Regelpaket

[`charts/wazuh/templates/manager-local-rules.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/wazuh/templates/manager-local-rules.yaml) liefert benutzerdefinierte Regeln im Bereich 100200-100299:

- **100200**: chain-root: matcht jede `SOCTALK_ATTACK`-Syslog-Zeile
- **100210 – 100225**: Regeln pro TTP: weisen Schweregrad (Level 10–14) und Tags nach MITRE-Technik zu
- **100299**: Auffangregel für nicht zugeordnete TTPs (Schweregrad 8)

Die erzeugten Warnungen tragen MITRE-`attack.tactic`, `attack.technique` und eine menschenlesbare Beschreibung, sodass der SocTalk-[`wazuh_worker`](/de-de/ai-pipeline) über strukturierten Kontext verfügt, mit dem er argumentieren kann.

## Einen einzelnen Angriff ausführen

Außerhalb des Charts kannst du einzelne Techniken gegen jeden Host mit einem Wazuh-Agenten ausführen:

```bash
ssh ops@<linux-ep-pod>
sudo /opt/scripts/run-attack.sh T1110
sudo /opt/scripts/run-attack.sh T1027.001
```

`run-attack.sh` ist der Einstiegspunkt; es leitet an die Skripte pro TTP weiter. Nützlich für Live-Demos, bei denen du auf Kommando eine bestimmte Warnung auslösen willst.

## Den Simulator entfernen

Für eine Live-Kundeninstallation, bei der du nicht möchtest, dass Simulator-Warnungen die echte Telemetrie verwässern:

```bash
helm uninstall linux-ep -n tenant-<slug>
```

Entfernt die Endpoint-Pods. Das benutzerdefinierte Wazuh-Regelpaket bleibt bestehen, ist aber harmlos, solange keine `SOCTALK_ATTACK`-Syslog-Zeilen darauf treffen.

## Was hier nicht enthalten ist

- **Windows-Endpoint-Sim**: in diesem Release nur Linux. Roadmap.
- **macOS-Endpoint-Sim**: dasselbe.
- **Adversary-Emulation-Kampagnen**: nur einzelne TTPs; wir verketten TTPs nicht zu mehrstufigen Szenarien.
- **Atomic-Red-Team-Integration**: `attack-simulator` ist handgeschrieben; er konsumiert Atomics YAML nicht direkt. Kompatibilität steht auf der Roadmap.
