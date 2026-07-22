---
layout: home

hero:
  name: SocTalk
  text: Piattaforma SOC AI-first per MSP e MSSP
  tagline: Esegui uno stack Wazuh dedicato per ogni cliente sul tuo Kubernetes, dietro un unico control plane.
  actions:
    - theme: brand
      text: Prova la VM demo
      link: /it-it/quickstart-vm
    - theme: brand
      text: Rollout del pilot MSSP
      link: /it-it/mssp-pilot
    - theme: alt
      text: Installazione in produzione
      link: /it-it/install
    - theme: alt
      text: GitHub
      link: https://github.com/soctalk/soctalk

features:
  - title: Multi-tenant
    details: Un unico control plane esegue stack SOC per cliente in namespace Kubernetes isolati, con Postgres RLS come rete di sicurezza per l'isolamento dei dati.
  - title: Data plane Wazuh
    details: Ogni cliente dispone del proprio Wazuh manager e indexer. Gli agenti si registrano tramite ingress instradato per hostname. Completamente open source.
  - title: Triage AI, controllo umano
    details: I worker LangGraph eseguono il triage e propongono le azioni; gli analisti approvano le escalation. BYO LLM per ogni tenant.
---

## In tre passi

**1. Valuta, [VM demo](/it-it/quickstart-vm).** Immagine singola, wizard nel browser, 5 minuti per un'installazione funzionante con un tenant demo. Disponibile in formato QCOW2, VMDK, VHDX, VHD e raw sulla [pagina dei download](/it-it/downloads). Il modo migliore per vedere l'analista SOC AI rispondere a query Wazuh reali end-to-end su un laptop.

**2. Pilot, [rollout del pilot MSSP](/it-it/mssp-pilot).** Il passo successivo consigliato: due ambienti on-premise (control plane MSSP + 1-3 tenant), collegati da una mesh VPN firewall-friendly, che eseguono il flusso multi-tenant completo con dati reali dei clienti. Stato finale: un analista SOC AI che risponde a domande sui tuoi primi clienti pilota, e uno screenshot pronto per gli stakeholder.

**3. Produzione, [guida all'installazione](/it-it/install).** K3s + Cilium + cert-manager + Helm. Dedica un'ora e concludi con un'installazione multi-tenant rafforzata, pronta per la tua base clienti.

## Cosa trovi qui

- [Per iniziare](/it-it/install), percorsi di installazione (VM demo + produzione), tour dell'interfaccia MSSP.
- [Operare](/it-it/operations), operazioni quotidiane, ciclo di vita dei tenant, aggiornamenti, troubleshooting.
- [Integrare](/it-it/integrate/llm-providers), provider LLM, TheHive, Cortex, Slack.
- [Riferimento](/it-it/reference/architecture), architettura, modello di sicurezza, RLS, contratto della chart, REST API.
- [Contribuire](/it-it/contribute), ambiente di sviluppo, aspettative sulle PR, processo di rilascio.

Sorgente: [github.com/soctalk/soctalk](https://github.com/soctalk/soctalk). Apache 2.0.
