---
layout: home

hero:
  name: SocTalk
  text: AI-first SOC-Plattform für MSPs und MSSPs
  tagline: Betreiben Sie einen dedizierten Wazuh-Stack pro Kunde auf Ihrem eigenen Kubernetes, hinter einer Control Plane.
  actions:
    - theme: brand
      text: Demo-VM ausprobieren
      link: /de-de/quickstart-vm
    - theme: brand
      text: MSSP-Pilot-Rollout
      link: /de-de/mssp-pilot
    - theme: alt
      text: Produktivinstallation
      link: /de-de/install
    - theme: alt
      text: GitHub
      link: https://github.com/soctalk/soctalk

features:
  - title: Mandantenfähig
    details: Eine einzige Control Plane betreibt kundenspezifische SOC-Stacks in isolierten Kubernetes-Namespaces, mit Postgres RLS als Absicherung der Datenisolation.
  - title: Wazuh Data Plane
    details: Jeder Kunde erhält seinen eigenen Wazuh-Manager und -Indexer. Agenten registrieren sich über hostnamenbasiertes Ingress-Routing. Vollständig Open Source.
  - title: KI-Triage, menschliches Gate
    details: LangGraph-Worker übernehmen die Triage und schlagen Maßnahmen vor; Analysten genehmigen Eskalationen. BYO LLM pro Mandant.
---

## In drei Schritten

**1. Evaluieren, [Demo-VM](/de-de/quickstart-vm).** Ein einziges Image, ein Browser-Assistent, 5 Minuten bis zu einer laufenden Installation mit einem Demo-Mandanten. Verfügbar als QCOW2, VMDK, VHDX, VHD und raw auf der [Downloads-Seite](/de-de/downloads). Der beste Weg, um zu sehen, wie der KI-SOC-Analyst echte Wazuh-Abfragen durchgängig auf einem Laptop beantwortet.

**2. Pilotieren, [MSSP-Pilot-Rollout](/de-de/mssp-pilot).** Der empfohlene nächste Schritt: zwei On-Premise-Umgebungen (MSSP Control Plane + 1-3 Mandanten), verbunden über ein firewallfreundliches Mesh-VPN, mit dem vollständigen mandantenfähigen Ablauf und echten Kundendaten. Endzustand: ein KI-SOC-Analyst, der Fragen über Ihre ersten Pilotkunden hinweg beantwortet, sowie ein präsentationsreifer Screenshot für Stakeholder.

**3. Produktiv, [Installationsanleitung](/de-de/install).** K3s + Cilium + cert-manager + Helm. Nehmen Sie sich eine Stunde Zeit und schließen Sie mit einer gehärteten, mandantenfähigen Installation ab, die bereit für Ihren Kundenstamm ist.

## Was hier zu finden ist

- [Erste Schritte](/de-de/install), Installationswege (Demo-VM + Produktiv), MSSP-UI-Rundgang.
- [Betreiben](/de-de/operations), täglicher Betrieb, Mandanten-Lebenszyklus, Upgrades, Fehlerbehebung.
- [Integrieren](/de-de/integrate/llm-providers), LLM-Anbieter, TheHive, Cortex, Slack.
- [Referenz](/de-de/reference/architecture), Architektur, Sicherheitsmodell, RLS, Chart-Vertrag, REST API.
- [Mitwirken](/de-de/contribute), Entwicklungsumgebung, PR-Erwartungen, Release-Prozess.

Quelle: [github.com/soctalk/soctalk](https://github.com/soctalk/soctalk). Apache 2.0.
