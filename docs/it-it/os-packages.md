# Installazione da un pacchetto OS (rpm / deb)

Ogni release di SocTalk distribuisce pacchetti OS nativi insieme alle immagini
VM, allegati alla stessa GitHub Release del tag di versione, per le due famiglie
Linux basate su systemd:

| File | Gestore di pacchetti | Verificato su | Previsto funzionare anche su |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Entrambi sono verificati end to end: installa il pacchetto, esegui
`soctalk install`, raggiungi la web app e accedi. La colonna "previsto
funzionare anche su" indica la stessa famiglia di pacchetti, ma non è stata
testata specificamente su quelle distribuzioni.

**Alpine non è supportato** e non viene pubblicato alcun `.apk`: `soctalk install`
richiede systemd, e Alpine usa OpenRC. Vedi [Alpine e altri host senza
systemd](#alpine-and-other-non-systemd-hosts) più sotto. **openSUSE / zypper** e
**RHEL 10** non sono testati; le note su RHEL/Fedora potrebbero non applicarsi
del tutto. **Solo amd64**: non esiste un pacchetto arm64.

Sono pubblicati sulla pagina delle release di [`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases).
La release corrente è la **v0.2.0**:
[pagina della release](https://github.com/soctalk/soctalk/releases/tag/v0.2.0). Il
repository è pubblico, quindi non serve alcuna autenticazione per scaricarli.

## Cosa installa il pacchetto

Il pacchetto è volutamente ridotto. SocTalk gira su Kubernetes (K3s), quindi il
pacchetto non contiene lo stack SOC vero e proprio. Installa una CLI di gestione
leggera e l'installer, poi esegui un solo comando per avviare lo stack:

- `/usr/bin/soctalk`, la CLI di gestione (`install`, `upgrade`, `status`,
  `logs`, `uninstall`, `version`).
- `/usr/libexec/soctalk/install.sh`, lo stesso installer usato dalla [VM demo](/it-it/quickstart-vm)
  e dall'[installazione con un comando](/it-it/install). Effettua il bootstrap di K3s e Helm se
  mancano, poi installa via Helm il chart `soctalk-system` da GHCR.
- `/etc/soctalk/soctalk.env.example`, un template per installazioni non presidiate.

Le uniche dipendenze sono `curl` e `tar`; l'installer scarica K3s e Helm da sé.
Questo è il percorso giusto quando stai installando su un host Linux che gestisci
direttamente e vuoi che SocTalk sia registrato nel database dei pacchetti di
sistema (così che `dnf`/`apt` lo tengano tracciato e aggiornato). Se vuoi solo
provare SocTalk, l'[immagine VM demo](/it-it/quickstart-vm) è più rapida.

## Installare il pacchetto

Scegli il blocco per la tua distribuzione. Sostituisci `0.2.0` con la versione
corrente se sei su una release più recente.

### RHEL, Fedora, AlmaLinux, Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

`dnf` include `curl` e `tar` se mancano. Su host più datati usa
`sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`.

### Debian, Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` risolve le dipendenze `curl` e `tar` dai repository che
hai configurato. Su un'immagine minimale senza `apt` puoi usare
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install`.

## Verificare il download

Ogni release include `SHA256SUMS.txt`, che copre tutti gli artefatti, compresi i
pacchetti.

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` controlla solo i file che hai effettivamente scaricato. Ogni
riga dovrebbe riportare `OK`.

## Avviare lo stack SOC

Installare il pacchetto non avvia SocTalk. Dopo che il pacchetto è installato,
esegui l'installer tramite la CLI. Questo installa K3s e Helm se necessario, poi
installa via Helm `soctalk-system` su questo host.

Interattivo (chiede nome MSSP, admin e provider LLM):

```bash
sudo soctalk install
```

Demo usa e getta (password admin casuale, onboarding automatico di un tenant
demo):

```bash
sudo soctalk install --demo
```

`--demo` si ferma comunque una volta per un prompt di consenso. Per
un'esecuzione completamente non presidiata (nessun terminale collegato, ad
esempio da uno script di provisioning) aggiungi `--yes`:
`sudo soctalk install --demo --yes`.

Non presidiato, guidato da variabili d'ambiente (copia il template distribuito):

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

Quando `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL` e `SOCTALK_ADMIN_PASSWORD` sono
tutte impostate, l'installer salta il suo prompt di consenso, così l'esecuzione
avviene senza alcuna interazione. Qualsiasi argomento dopo `install` viene
passato all'installer, ad esempio `soctalk install --chart-version 0.2.0` per
fissare un chart oppure `soctalk install --values-file /etc/soctalk/values.yaml`
per un'installazione air-gapped. Vedi [Installazione di produzione](/it-it/install)
per il riferimento completo dei flag e il percorso di cluster basato su Cilium.

## Gestire l'installazione

La CLI incapsula le operazioni comuni sul cluster così non devi ricordare il
percorso `KUBECONFIG` o il nome della release Helm.

```bash
soctalk status              # pods and their readiness in the soctalk namespace
soctalk logs api            # tail a component's logs (api, orchestrator, adapter, app-ui)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk upgrade` è un `helm upgrade --install`, quindi è sicuro rieseguirlo ed è
il modo in cui passi a un chart più recente dopo aver installato un pacchetto più
recente.

## Disinstallazione

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

Rimuovere il pacchetto OS (`dnf remove soctalk` o `apt remove soctalk`) elimina
la CLI e l'installer ma non tocca un cluster in esecuzione. Esegui prima
`soctalk uninstall` se vuoi eliminare lo stack SOC.

## Note specifiche per OS

### RHEL, Fedora, AlmaLinux, Rocky

Verificato su Rocky Linux 9 con SELinux in modalità **Enforcing**. Non serve
alcun lavoro manuale su SELinux per l'avvio: l'installer di K3s include
automaticamente i pacchetti di policy `k3s-selinux` e `container-selinux` durante
`soctalk install`, così il cluster parte sotto Enforcing. Nota che questo
significa "gira correttamente sotto la policy targeted", non che SELinux stia
confinando il workload come livello di hardening; abilitare l'enforcement
SELinux di K3s stesso (`--selinux` / `K3S_SELINUX=true`) non è stato testato qui.
Anche RHEL 10 richiede il pacchetto `kernel-modules-extra` per K3s, che non è
stato testato.

Se **firewalld** è attivo (comune su un'installazione server RHEL completa, anche
se non sulle immagini cloud minimali), può bloccare il traffico del cluster, il
che si manifesta con pod bloccati su `ContainerCreating` o con la web app
irraggiungibile. Rendi attendibili le reti pod e service di K3s e apri le porte
di ingress su cui raggiungi effettivamente la UI:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

I valori `10.42.0.0/16` e `10.43.0.0/16` sono i default di K3s; se imposti un
CIDR di cluster o di service personalizzato, usa quelli. Un cluster multi-nodo
richiede più porte aperte tra i nodi (vedi i requisiti di rete di K3s).

### Alpine e altri host senza systemd {#alpine-and-other-non-systemd-hosts}

**L'installer di SocTalk richiede systemd.** Avvia K3s come servizio systemd e
attende il kubeconfig scritto da systemd, quindi non funziona su Alpine (OpenRC)
o su qualsiasi altro init senza systemd. Su un host di questo tipo `soctalk install`
si ferma subito con un messaggio chiaro che te lo comunica. Per questo motivo non
viene pubblicato alcun `.apk`.

Per eseguire SocTalk dove stavi considerando Alpine, usa una distribuzione con
systemd (il percorso `.deb` o `.rpm` sopra) oppure l'[immagine VM demo](/it-it/quickstart-vm)
precompilata.

## Quale percorso dovrei usare?

- **Pacchetto OS (questa pagina)**: un host Linux che gestisci tu, tracciato dal
  gestore di pacchetti di sistema. Ottimo per installazioni ripetibili e gestite
  come configurazione.
- **[Installazione con un comando](/it-it/install)**: `curl … | install.sh | bash` su una
  VM Ubuntu vuota, lo stesso installer senza il wrapper del pacchetto.
- **[Immagine VM demo](/it-it/quickstart-vm)**: appliance precompilata con una procedura
  guidata di setup nel browser, il modo più rapido per arrivare a un sistema in
  esecuzione per la valutazione.

Tutti e tre approdano allo stesso chart `soctalk-system` e allo stesso SOC in
esecuzione.
