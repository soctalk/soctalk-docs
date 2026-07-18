# Simulador de ataques e linux-ep

Um par de ferramentas de demonstração que geram Alertas Wazuh realistas para que um operador MSSP possa ver o [pipeline de AI](/pt-br/ai-pipeline) do SocTalk trabalhar de fato. Fortemente recomendado para avaliações e demonstrações ao vivo — sem Alertas, não há nada para o agente triar.

Ambos são distribuídos com a distribuição FOSS. Fonte:

- [`attack-simulator/`](https://github.com/soctalk/soctalk/tree/main/attack-simulator) — scripts e pacote de regras
- [`charts/linux-ep/`](https://github.com/soctalk/soctalk/tree/main/charts/linux-ep) — chart Kubernetes que executa o simulador

## Chart linux-ep

O `linux-ep` sobe N pods de endpoint Linux, cada um:

1. Instala o agente Wazuh e faz o enrollment com o Wazuh manager do tenant.
2. Executa técnicas MITRE ATT&CK roteirizadas contra si mesmo em um intervalo configurável.
3. Limita os Alertas simulados diários por pod (padrão de 30/dia UTC) para controlar o gasto com LLM.

Os pods se registram como `linux-ep-0`, `linux-ep-1`, … para que a UI do SocTalk mostre hostnames realistas no fluxo de Alertas.

### Instalação

```bash
helm install linux-ep oci://ghcr.io/soctalk/charts/linux-ep \
  --version 0.1.1 \
  --namespace tenant-demo \
  --set wazuh.managerHost=wazuh-demo-wazuh-manager \
  --set wazuh.credsSecret.name=wazuh-demo-wazuh-creds \
  --set replicas=2 \
  --set simulator.enabled=true \
  --set simulator.dailyAlertCap=30
```

Para a [imagem de VM de demonstração](/pt-br/quickstart-vm), o simulador vem desligado por padrão para evitar consumir o orçamento de LLM sem supervisão; habilite-o explicitamente via `simulator.enabled=true`.

### Valores do Helm (os principais)

| Chave | Padrão | Efeito |
|---|---|---|
| `replicas` | 1 | Número de pods de endpoint |
| `wazuh.managerHost` | "" (obrigatório) | O hostname do Service do Wazuh manager do tenant (ex.: `wazuh-demo-wazuh-manager`) |
| `wazuh.credsSecret.name` | "" (obrigatório) | Secret existente com a senha de enrollment `authd` (tipicamente `wazuh-<slug>-wazuh-creds`) |
| `wazuh.credsSecret.authdPasswordKey` | `AUTHD_PASS` | Chave dentro do Secret para a senha `authd` |
| `simulator.enabled` | `false` | Chave-mestra. Desligado por padrão — deixá-lo desligado mantém os pods ociosos (sem Alertas sintéticos) |
| `simulator.attackDelay` | 10 | Segundos após o início do pod (agente com enrollment feito) antes do primeiro TTP |
| `simulator.attackInterval` | 120 | Segundos entre TTPs subsequentes |
| `simulator.dailyAlertCap` | 30 | Limite por pod de emissões `SOCTALK_ATTACK` por dia UTC. 0 desabilita o limite |
| `image.repository` | `ghcr.io/soctalk/soctalk-linux-ep` | — |
| `securityContext.privileged` | `true` | Necessário para TTPs que tocam o kernel (namespaces de processo, ajustes de permissão de arquivo) |

### Nota sobre custo

Cada Alerta simulado dispara uma Investigação por AI, que gasta tokens de LLM (típico: ~50k de entrada / ~10k de saída por caso nos modelos padrão). Com 2 pods × 30 Alertas/dia = 60 Investigações/dia. Ajuste `dailyCapPerPod` ao orçamento da sua demonstração.

## Técnicas simuladas

25 TTPs Linux da matriz MITRE ATT&CK Enterprise. A lista completa fica em [`attack-simulator/scripts/linux-techniques.txt`](https://github.com/soctalk/soctalk/blob/main/attack-simulator/scripts/linux-techniques.txt); resumida aqui por tática:

| Tática | IDs de TTP (selecionados) |
|---|---|
| **Initial Access / Persistence** | T1098 (manipulação de conta), T1547.001 (scripts de boot/logon) |
| **Privilege Escalation** | T1548.003 (abuso de sudo) |
| **Defense Evasion** | T1027 (comando ofuscado: decodificação base64 + execução), T1070 (remoção de indicadores) |
| **Credential Access** | T1110 (força bruta), T1003.008 (acesso a `/etc/passwd` + `/etc/shadow`) |
| **Discovery** | T1046 (descoberta de serviços de rede), T1082 (informações do sistema), T1083 (descoberta de arquivos/diretórios), T1057 (descoberta de processos) |
| **Lateral Movement** | T1021.004 (SSH) |
| **Collection** | T1560.001 (arquivamento de dados para preparação de exfiltração) |
| **Command and Control** | T1105 (transferência de ferramenta de ingresso) |
| **Exfiltration** | T1041 (por canal C2) |
| **Impact** | T1485 (destruição de dados), T1486 (criptografia de dados), T1496 (sequestro de recursos) |
| **Execution / Scheduling** | T1053.003 (tarefa agendada / cron) |

Cada script emite uma linha de syslog marcada com `SOCTALK_ATTACK <TTP>: <description>` para que o Wazuh tenha algo com que fazer o match.

## Pacote de regras do Wazuh

[`charts/wazuh/templates/manager-local-rules.yaml`](https://github.com/soctalk/soctalk/blob/main/charts/wazuh/templates/manager-local-rules.yaml) inclui regras personalizadas na faixa 100200-100299:

- **100200** — chain-root: casa com qualquer linha de syslog `SOCTALK_ATTACK`
- **100210 – 100225** — regras por TTP: atribuem severidade (nível 10–14) e tags por técnica MITRE
- **100299** — regra genérica para TTPs não mapeados (severidade 8)

Os Alertas produzidos carregam `attack.tactic`, `attack.technique` do MITRE e uma descrição legível por humanos, de modo que o [`wazuh_worker`](/pt-br/ai-pipeline) do SocTalk tenha contexto estruturado para raciocinar.

## Executando um único ataque

Fora do chart, você pode executar técnicas individuais contra qualquer host com um agente Wazuh:

```bash
ssh ops@<linux-ep-pod>
sudo /opt/scripts/run-attack.sh T1110
sudo /opt/scripts/run-attack.sh T1027.001
```

O `run-attack.sh` é o ponto de entrada — ele despacha para os scripts por TTP. Útil para demonstrações ao vivo em que você quer disparar um Alerta específico sob comando.

## Removendo o simulador

Para uma instalação de cliente ao vivo em que você não quer que Alertas do simulador diluam a telemetria real:

```bash
helm uninstall linux-ep -n tenant-<slug>
```

Remove os pods de endpoint. O pacote de regras personalizadas do Wazuh permanece no lugar, mas é inofensivo sem linhas de syslog `SOCTALK_ATTACK` chegando até ele.

## O que não está aqui

- **Simulação de endpoint Windows** — apenas Linux neste release. No roadmap.
- **Simulação de endpoint macOS** — o mesmo.
- **Campanhas de emulação de adversário** — apenas TTP único; não encadeamos TTPs em cenários multi-estágio.
- **Integração com Atomic Red Team** — o `attack-simulator` é feito à mão; ele não consome o YAML da Atomic diretamente. A compatibilidade está no roadmap.
