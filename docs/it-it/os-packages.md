# Installazione da un pacchetto OS (rpm / deb)

Ogni release di SocTalk distribuisce pacchetti OS nativi insieme alle immagini
VM, allegati alla stessa GitHub Release del tag di versione, per le due famiglie
Linux basate su systemd:

| File | Gestore di pacchetti | Verificato su | Previsto funzionare anche su |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9.8 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Entrambi sono verificati end to end: installa il pacchetto, esegui
`soctalk install`, raggiungi la web app e accedi. La colonna "previsto
funzionare anche su" indica la stessa famiglia di pacchetti, ma non è stata
testata specificamente su quelle distribuzioni.

Su Rocky Linux 9.8 la verifica ha coperto entrambe le forme in cui il prodotto
viene distribuito, su VM appena create con SELinux in modalità Enforcing.
L'installazione del solo control plane ha avviato `api`, `app-ui` e `postgres`,
e l'admin di bootstrap è riuscito ad accedere. L'installazione completa ha
inoltre effettuato l'onboarding di un tenant `poc` che ha avviato un proprio
Wazuh manager, indexer e dashboard fino a raggiungere lo stato `active`. Quella
seconda esecuzione è avvenuta con firewalld abilitato, condizione che richiede
le regole descritte nelle [note su RHEL](#rhel-fedora-almalinux-rocky) più
sotto prima che il cluster possa funzionare. Quelle note spiegano che cosa
SELinux e firewalld richiedono, e che cosa non richiedono, da parte tua.

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

Alcune immagini RHEL 9 includono `curl-minimal` al posto del `curl` completo, il
che può entrare in conflitto con pacchetti che richiedono `curl` per nome. Qui
non genera conflitti. Sull'host Rocky Linux 9.8 usato per la verifica, con
`curl` rimosso e solo `curl-minimal` installato, l'rpm si è installato senza
alcuna modifica: `curl-minimal` dichiara `Provides: curl`, quindi la dipendenza
si risolve senza sostituzioni e senza `--allowerasing`.

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
soctalk status              # pods and their readiness in soctalk-system
soctalk logs api            # tail a component's logs (api, app-ui, postgres)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk logs` copre il control plane in `soctalk-system`. I workload per
tenant, come l'adapter e il runs-worker, vivono nei namespace `tenant-<slug>`,
quindi raggiungili con `kubectl` puntando a quel namespace.

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

#### SELinux

Verificato su Rocky Linux 9.8 con SELinux in modalità **Enforcing**, sia per
l'installazione del solo control plane sia per l'installazione completa con un
tenant basato su Wazuh. Non serve alcun lavoro manuale su SELinux. Durante
`soctalk install` l'installer di K3s ha incluso da sé `k3s-selinux` 1.6 e
`container-selinux`, e il cluster è partito senza che nessuno toccasse un
booleano, un'etichetta o un modulo personalizzato. Nessuna delle due esecuzioni
ha registrato una negazione AVC.

Nota bene che cosa afferma questa dichiarazione. Significa che SocTalk gira
correttamente sotto la policy targeted, non che SELinux stia confinando il
workload come livello di hardening. Abilitare l'enforcement SELinux di K3s
stesso (`--selinux` / `K3S_SELINUX=true`) non è stato testato. Anche RHEL 10
richiede il pacchetto `kernel-modules-extra` per K3s, che non è stato testato.

#### firewalld

L'immagine GenericCloud di Rocky Linux 9.8 usata per la verifica non include
affatto firewalld, quindi su una VM cloud spesso non c'è nulla da fare qui.
Un'installazione server completa invece lo include, abilitato. Con firewalld in
esecuzione sotto la sua policy predefinita, l'installazione si è bloccata finché
le reti pod e service di K3s non sono state rese attendibili, quindi su un host
di questo tipo questo passaggio è un prerequisito, non un consiglio di
hardening.

Vale la pena imparare a riconoscere questo guasto, perché non ha l'aspetto di un
problema di firewall. K3s si installa senza errori, il nodo passa a `Ready`, le
immagini vengono scaricate e ogni pod viene schedulato. Ciò che si rompe è il
traffico da pod a pod e da pod a Service sul bridge flannel, per cui l'init
container `db-init` dell'API non riesce a raggiungere Postgres e cicla su
`No route to host` mentre Postgres se ne resta lì `1/1 Running`.
L'installazione consuma poi l'intera finestra di `--wait` di Helm prima di
fallire per timeout, con la causa reale sepolta nel log di un init container.

Rendi attendibili le reti pod e service di K3s e apri le porte di ingress su cui
raggiungi la UI:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

Questi sono i default di K3s; se imposti un CIDR di cluster o di service
personalizzato, usa quelli. Un cluster multi-nodo richiede più porte aperte tra i
nodi (vedi i requisiti di rete di K3s).

Se l'installazione è ancora in attesa quando applichi le regole, si riprende al
tentativo successivo e arriva a termine; non devi ricominciare da capo. Se Helm è
già andato in timeout, applica le regole e riesegui `sudo soctalk install`. Dopo
la v0.2.0 il preflight dell'installer verifica questa condizione e stampa questi
comandi prima di toccare l'host
([soctalk#118](https://github.com/soctalk/soctalk/issues/118)).

SocTalk non modifica le regole di firewalld al posto tuo. Quello è il tuo confine
di sicurezza, e sta a te aprirlo.

#### sudo e /usr/local/bin

K3s e Helm installano i propri binari, e il symlink `kubectl`, in
`/usr/local/bin`. Le distribuzioni della famiglia RHEL lasciano quella directory
fuori dal `secure_path` di sudo (`Defaults secure_path = /sbin:/bin:/usr/sbin:/usr/bin`),
quindi un semplice `sudo k3s ...`, `sudo kubectl ...` o `sudo helm ...` risponde
`command not found` anche se il binario è proprio lì e l'installazione è andata a
buon fine.

La CLI `soctalk` risolve da sé questi percorsi, quindi `sudo soctalk install`,
`soctalk status` e `soctalk logs` funzionano esattamente come sono scritti.
Quando ti serve `kubectl` direttamente, indica il percorso completo oppure
aggiungi la directory al tuo `PATH`:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

Altrove in questo sito la documentazione a volte lo scrive come
`sudo k3s kubectl ...`, forma corretta su Debian e Ubuntu ma che richiede il
percorso completo sugli host della famiglia RHEL.

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
