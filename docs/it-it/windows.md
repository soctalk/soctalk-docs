# Esecuzione su Windows (WSL2)

SocTalk è Kubernetes-native. Su Windows viene eseguito come **k3s (Kubernetes leggero) all'interno di WSL2** — installato e configurato per te da un unico comando PowerShell. Non è richiesto Docker Desktop.

::: tip Stai solo valutando il prodotto?
La **[VM appliance](/it-it/downloads)** (Hyper-V `vhdx` o [VirtualBox](/it-it/virtualbox)) è il modo più semplice e robusto per provare SocTalk su Windows — è una VM Linux autonoma, senza nulla da configurare. Il percorso WSL2 di questa pagina è l'opzione comoda a cluster locale per gli sviluppatori che preferiscono non eseguire una VM completa.
:::

::: warning Architettura
Le immagini di SocTalk sono **solo amd64**, quindi questo funziona su **Windows x64**. Su Windows on ARM il set di immagini richiederebbe l'emulazione.
:::

## Prerequisiti

- **Windows 10 2004 (build 19041) o più recente, oppure Windows 11** — x64
- PowerShell con privilegi di **Amministratore** (l'installer abilita le funzionalità di Windows e configura WSL2)
- **Virtualizzazione della CPU abilitata** nel firmware (WSL2 la richiede; in una VM, abilita la virtualizzazione annidata)

**Non** è necessario pre-installare WSL2, Ubuntu o Docker — l'installer gestisce tutto.

## Installazione con un clic

Apri **PowerShell come Amministratore** ed esegui:

```powershell
irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1 | iex
```

Cosa succede:

1. **Abilita WSL2** (un riavvio — effettua di nuovo l'accesso e l'installazione **riprende automaticamente** al successivo logon; WSL2 non può essere eseguito con l'account SYSTEM, quindi la ripresa avviene nella tua sessione).
2. **Importa una distro Ubuntu** e abilita systemd al suo interno.
3. **Installa k3s** come servizio systemd all'interno di WSL2, quindi distribuisce SocTalk e effettua l'onboarding di un **tenant `demo`**.
4. **Espone la UI a Windows** su **`https://localhost/`** (un `netsh portproxy` inoltra al cluster all'interno di WSL2; un'attività di logon lo aggiorna dopo i riavvii).

Al termine stampa l'URL e le credenziali demo. Apri **`https://localhost/`** nel browser, accetta il certificato self-signed ed effettua l'accesso.

Per un'installazione **reale (non demo)**, passa `-Real` per essere invitato a inserire il nome MSSP, l'email/password dell'amministratore e la chiave LLM (oppure imposta le variabili d'ambiente `SOCTALK_*`):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1))) -Real
```

## Cosa fa (sotto il cofano)

L'installer PowerShell effettua il bootstrap di WSL2, quindi esegue lo **stesso `install.sh`** utilizzato dall'appliance Linux, con k3s come runtime:

```bash
# inside the WSL2 Ubuntu distro, as root:
curl -sfL https://get.k3s.io | sh -          # k3s as a systemd service
helm upgrade --install soctalk-system \
  oci://ghcr.io/soctalk/charts/soctalk-system --version 0.2.0 \
  --namespace soctalk-system --create-namespace -f values.yaml
```

L'host di ingress è `localhost`, e un `netsh portproxy` di Windows (`localhost:443` → l'IP di WSL2) lo rende raggiungibile dal tuo browser.

## Avvertenze

- È richiesto **un riavvio** per completare l'abilitazione di WSL2; effettua di nuovo l'accesso in seguito e l'installazione prosegue da sola.
- **Mantieni in esecuzione la distro WSL del cluster** — k3s vive al suo interno. L'installer imposta `vmIdleTimeout=-1` in modo che WSL2 non vada in idle, e un'attività di logon riavvia WSL + aggiorna l'inoltro su `localhost` dopo un riavvio di Windows.
- Il percorso WSL2 è l'opzione **comoda a cluster locale**. Per un'installazione sempre attiva / in stile produzione su Windows, preferisci la **[VM appliance](/it-it/downloads)** (Hyper-V/VirtualBox) — un'unica VM Linux senza le parti mobili del networking di WSL2.
- Immagini amd64 → solo Windows **x64**.

## Smantellamento

```powershell
# remove the host forward + logon tasks
netsh interface portproxy reset
Get-ScheduledTask SocTalk* | Unregister-ScheduledTask -Confirm:$false

# remove the cluster (inside WSL) and/or the whole distro
wsl -d Ubuntu -u root -- /usr/local/bin/k3s-uninstall.sh
wsl --unregister Ubuntu      # optional: remove the distro entirely
```

## Risoluzione dei problemi

| Sintomo | Verifica |
|---|---|
| L'installazione non è ripresa dopo il riavvio | effettua di nuovo l'accesso come **stesso utente** — la ripresa avviene al tuo logon. Rieseguire `install.ps1` è sicuro (i passaggi completati vengono saltati). |
| `https://localhost/` non si carica | l'IP di WSL2 potrebbe essere cambiato; l'attività pianificata `SocTalkExpose` aggiorna l'inoltro — eseguila (`Start-ScheduledTask SocTalkExpose`) o riesegui l'installer, poi riprova. |
| `503` da `https://localhost/` | l'inoltro funziona ma i pod non sono ancora pronti — `wsl -d Ubuntu -u root -- k3s kubectl -n soctalk-system get pods` e attendi lo stato `Running`. |
| WSL2 non si avvia | abilita la virtualizzazione della CPU (VT-x/AMD-V) nel firmware; in una VM, abilita la virtualizzazione annidata. |
| Qualsiasi problema dopo il wizard | come per ogni piattaforma — vedi la [tabella di risoluzione dei problemi del Quickstart](/it-it/quickstart-vm#troubleshooting). |
