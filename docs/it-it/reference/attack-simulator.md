# Attack simulator e linux-ep

Una coppia di strumenti dimostrativi che generano Alert Wazuh realistici, così un operatore MSSP può vedere la [pipeline AI](/it-it/ai-pipeline) di SocTalk realmente all'opera. Fortemente consigliati per valutazioni e demo dal vivo: senza Alert non c'è nulla su cui l'agente possa fare Triage.

Entrambi vengono forniti con la distribuzione FOSS. Sorgenti:

- [`attack-simulator/`](https://github.com/soctalk/soctalk/tree/main/attack-simulator) — script e pacchetto di regole
- [`charts/linux-ep/`](https://github.com/soctalk/soctalk/tree/main/charts/linux-ep) — chart Kubernetes che esegue il simulatore

## Chart linux-ep

`linux-ep` avvia N pod endpoint Linux, ciascuno dei quali:

1. Installa l'agente Wazuh e si iscrive al Wazuh manager del Tenant.
2. Esegue tecniche MITRE ATT&CK scriptate contro sé stesso a un intervallo configurabile.
3. Limita gli Alert simulati giornalieri per pod (default 30/giorno UTC) per controllare la spesa in LLM.

I pod si registrano come `linux-ep-0`, `linux-ep-1`, … così la UI di SocTalk mostra hostname realistici nello stream degli Alert.

### Installazione

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

Per l'[immagine della VM demo](/it-it/quickstart-vm), il simulatore è disattivato per default per evitare di consumare budget LLM in modo incustodito; abilitalo esplicitamente tramite `simulator.enabled=true`.

### Valori Helm (quelli principali)

| Chiave | Default | Effetto |
|---|---|---|
| `replicas` | 1 | Numero di pod endpoint |
| `wazuh.managerHost` | "" (obbligatorio) | Hostname del Service del Wazuh manager del Tenant (es. `wazuh-demo-wazuh-manager`) |
| `wazuh.credsSecret.name` | "" (obbligatorio) | Secret esistente con la password di iscrizione `authd` (tipicamente `wazuh-<slug>-wazuh-creds`) |
| `wazuh.credsSecret.authdPasswordKey` | `AUTHD_PASS` | Chiave all'interno del Secret per la password `authd` |
| `simulator.enabled` | `false` | Interruttore principale. Disattivato per default: lasciarlo disattivato mantiene i pod inattivi (nessun Alert sintetico) |
| `simulator.attackDelay` | 10 | Secondi dopo l'avvio del pod (agente iscritto) prima della prima TTP |
| `simulator.attackInterval` | 120 | Secondi tra le TTP successive |
| `simulator.dailyAlertCap` | 30 | Limite per pod sulle emissioni `SOCTALK_ATTACK` per giorno UTC. 0 disabilita il limite |
| `image.repository` | `ghcr.io/soctalk/soctalk-linux-ep` | — |
| `securityContext.privileged` | `true` | Necessario per TTP che toccano il kernel (namespace di processo, modifiche ai permessi dei file) |

### Nota sui costi

Ogni Alert simulato avvia un'Indagine AI, che consuma token LLM (tipico: ~50k di input / ~10k di output per caso con i modelli di default). Con 2 pod × 30 Alert/giorno = 60 Indagini/giorno. Regola `dailyCapPerPod` in base al budget della tua demo.

## Tecniche simulate

25 TTP Linux dalla matrice MITRE ATT&CK Enterprise. L'elenco completo si trova in [`attack-simulator/scripts/linux-techniques.txt`](https://github.com/soctalk/soctalk/blob/main/attack-simulator/scripts/linux-techniques.txt); qui è riassunto per tattica:

| Tattica | ID TTP (selezionati) |
|---|---|
| **Initial Access / Persistence** | T1098 (manipolazione di account), T1547.001 (script di boot/logon) |
| **Privilege Escalation** | T1548.003 (abuso di sudo) |
| **Defense Evasion** | T1027 (comando offuscato: decodifica base64 + esecuzione), T1070 (rimozione di indicatori) |
| **Credential Access** | T1110 (brute force), T1003.008 (accesso a `/etc/passwd` + `/etc/shadow`) |
| **Discovery** | T1046 (discovery di servizi di rete), T1082 (info di sistema), T1083 (discovery di file/directory), T1057 (discovery di processi) |
| **Lateral Movement** | T1021.004 (SSH) |
| **Collection** | T1560.001 (archivio dati per staging di esfiltrazione) |
| **Command and Control** | T1105 (ingress tool transfer) |
| **Exfiltration** | T1041 (tramite canale C2) |
| **Impact** | T1485 (distruzione di dati), T1486 (cifratura di dati), T1496 (dirottamento di risorse) |
| **Execution / Scheduling** | T1053.003 (task pianificato / cron) |

Ogni script emette una riga syslog contrassegnata `SOCTALK_ATTACK <TTP>: <description>` così Wazuh ha qualcosa da abbinare.

## Pacchetto di regole Wazuh

[`charts/wazuh/templates/manager-local-rules.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/wazuh/templates/manager-local-rules.yaml) fornisce regole personalizzate nell'intervallo 100200-100299:

- **100200** — chain-root: abbina qualsiasi riga syslog `SOCTALK_ATTACK`
- **100210 – 100225** — regole per TTP: assegnano severità (livello 10–14) e tag per tecnica MITRE
- **100299** — catch-all per TTP non mappate (severità 8)

Gli Alert prodotti trasportano `attack.tactic`, `attack.technique` MITRE e una descrizione leggibile, così il [`wazuh_worker`](/it-it/ai-pipeline) di SocTalk dispone di contesto strutturato su cui ragionare.

## Esecuzione di un singolo attacco

Al di fuori del chart, puoi eseguire singole tecniche contro qualsiasi host con un agente Wazuh:

```bash
ssh ops@<linux-ep-pod>
sudo /opt/scripts/run-attack.sh T1110
sudo /opt/scripts/run-attack.sh T1027.001
```

`run-attack.sh` è il punto di ingresso: smista verso gli script per TTP. Utile per demo dal vivo in cui vuoi attivare un Alert specifico a comando.

## Rimozione del simulatore

Per un'installazione presso un cliente reale in cui non vuoi che gli Alert del simulatore diluiscano la telemetria reale:

```bash
helm uninstall linux-ep -n tenant-<slug>
```

Rimuove i pod endpoint. Il pacchetto di regole Wazuh personalizzate resta al suo posto ma è innocuo senza righe syslog `SOCTALK_ATTACK` che lo attivano.

## Cosa non è incluso

- **Simulazione di endpoint Windows** — solo Linux in questa release. In roadmap.
- **Simulazione di endpoint macOS** — idem.
- **Campagne di emulazione dell'avversario** — solo TTP singole; non concateniamo le TTP in scenari multi-stadio.
- **Integrazione con Atomic Red Team** — `attack-simulator` è realizzato a mano; non consuma direttamente lo YAML di Atomic. La compatibilità è in roadmap.
