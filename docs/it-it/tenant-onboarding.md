---
description: "Effettua l'onboarding di un tenant cliente end to end in SocTalk: scegli un profilo, esegui il wizard Create Customer, osserva il provisioning raggiungere lo stato active, connetti gli endpoint del cliente e consegna gli accessi."
---

# Onboarding di un tenant

L'onboarding trasforma un cliente in un SOC tenant isolato sul tuo control plane. Ogni tenant riceve il proprio namespace Kubernetes (`tenant-<slug>`) con i propri secret, il proprio budget di risorse e (per i profili `poc` e `persistent`) un Wazuh manager, indexer e dashboard dedicati. Questa pagina descrive l'intero percorso che un amministratore MSSP segue nella UI, dalla prima decisione al momento in cui gli analisti del cliente possono aprire il loro SOC.

Per la panoramica concettuale (dimensionamento, i quattro compiti, il baseline della prima settimana) vedi la [guida alla checklist di onboarding](/it-it/guides/wazuh-tenant-onboarding). Per la macchina a stati e i dettagli interni dei profili vedi [Ciclo di vita del tenant](/it-it/tenant-lifecycle). Questa pagina è il percorso operativo.

## Prima di iniziare

- Il tuo control plane è installato e puoi accedere come amministratore MSSP. Se non è ancora attivo, segui prima [Installazione in produzione](/it-it/install) o il [quickstart della VM demo](/it-it/quickstart-vm).
- Hai deciso il profilo del tenant. È fisso per l'intera vita del tenant, quindi leggi la prossima sezione prima di fare clic su **New tenant**.
- Solo per un tenant `provided`, raccogli fuori banda il materiale di connessione al Wazuh esistente del cliente prima di aprire il wizard: l'URL dell'Indexer con un utente e una password per l'autenticazione Basic, l'URL della Manager API con un utente e una password, e le credenziali LLM per-tenant. Il wizard si blocca su questi dati, quindi raccoglierli prima evita di parcheggiare un form compilato a metà. Vedi [Coordinare le credenziali Wazuh esterne](/it-it/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Scegli un profilo

Il profilo viene scelto una sola volta ed è fisso. Cambiarlo in seguito significa dismettere e rifare l'onboarding, quindi scegli con attenzione.

- **`poc`** è per valutazioni e pilot di breve durata. Il chart del tenant installa Wazuh più un simulatore linux-ep con storage `local-path` e budget di risorse ristretti. È anche il default se non ne specifichi uno, e `local-path` non offre alcuna garanzia di persistenza, quindi è la scelta sbagliata per un cliente reale.
- **`persistent`** è per i SOC di clienti in produzione. Stessa forma con Wazuh incluso di `poc`, ma dimensionato per carico sostenuto sulla StorageClass predefinita del cluster, con gli intervalli di risorse completi del chart e gli hook di backup rispettati dove configurati.
- **`provided`** è per un cliente che esegue già Wazuh (porta il tuo SIEM). Il chart installa solo l'adapter SocTalk e il runs-worker; SocTalk raggiunge l'indexer e la Manager API del cliente sulla rete. Il materiale di connessione esterno e le credenziali LLM per-tenant sono obbligatori al momento dell'onboarding.

Prevedi all'incirca 6-8 GB di RAM e circa 1,5 vCPU per ogni tenant `persistent`; l'indexer Wazuh per-tenant è di solito il collo di bottiglia. I dettagli sulla capacità sono in [Dimensionamento](/it-it/reference/sizing), e ogni profilo è approfondito in [Ciclo di vita del tenant](/it-it/tenant-lifecycle#profiles).

## Esegui il wizard Create Customer

Nella dashboard MSSP, fai clic su **Tenants** nella barra laterale sinistra, poi su **New tenant** in cima all'elenco. Questo apre il wizard **Create Customer**. Sono quattro passaggi per `poc` e `persistent` (Identity, Profile, Branding, Review) e cinque per `provided`, dove un passaggio External SIEM compare tra Profile e Branding.

### Passaggio 1: Identity

- **Display name**, per esempio `Acme Corp`.
- **Slug**: breve, minuscolo, separato da trattini, da 3 a 32 caratteri, validato rispetto a `[a-z0-9-]+`. Lo slug diventa il namespace `tenant-<slug>` e viene sostituito negli identificatori a valle, quindi sceglilo con cura. In un pilot su tailnet deve corrispondere al tag Tailscale del tenant.
- **Contact email**.

### Passaggio 2: Profile

Scegli tra `poc`, `persistent` o `provided`. Lo stesso passaggio include una sezione a scomparsa **LLM (advanced)** per sovrascrivere il provider LLM condiviso dell'installazione, la base URL, la chiave e (opzionalmente) gli ID dei modelli Fast e Thinking. Lasciala collassata su `poc` e `persistent` per ereditare i default dell'installazione. Su `provided` le credenziali LLM sono obbligatorie e bloccano il passaggio, perché per quel profilo non esiste un fallback condiviso dell'installazione.

Cambiare il profilo dopo il provisioning richiede di dismettere e rifare l'onboarding, quindi conferma la scelta prima di continuare.

### Passaggio 3: External SIEM (solo provided)

Questo passaggio è nascosto a meno che tu non abbia scelto `provided`. Compila due coppie di endpoint e credenziali:

- **Wazuh Indexer URL**, per esempio `https://wazuh.acme.example:9200`, con l'utente e la password dell'indexer usati per l'autenticazione Basic.
- **Wazuh Manager API URL**, per esempio `https://wazuh.acme.example:55000`, con l'utente e la password dell'API usati per coniare i JWT.

Entrambi devono essere raggiungibili dalla VM del tenant. Il controller trasforma le URL in una allow-list di egress FQDN Cilium sul namespace del tenant; l'adapter non raggiunge mai Wazuh direttamente dal cluster MSSP. Fai un controllo di sanità delle credenziali del manager prima di inviare:

```bash
curl -k -u <user>:<pw> "https://<wazuh-mgr>:55000/security/user/authenticate?raw=true"
# expected: a JWT (a long base64 string)
```

Se questo restituisce un token, gli strumenti di chat del tenant si risolveranno una volta che il data plane del tenant sarà attivo.

### Passaggio 4 (o 3 per poc e persistent): Branding

Opzionale. Un display name e un piccolo logo che compaiono nell'header del tenant. Puoi saltare completamente questo passaggio.

### Passaggio finale: Review

Conferma tutto e fai clic su **Create**. L'API risponde `202` e ti riporta all'elenco dei tenant. Il nuovo tenant parte in `pending` e attraversa `provisioning` verso `active`.

## Osserva il provisioning raggiungere active

Apri la pagina di dettaglio del tenant e aggiornala per seguire la tabella **Lifecycle Events**. Il controller esegue nove fasi ordinate e idempotenti, ognuna delle quali emette un evento:

1. `preflight_ok`: i prerequisiti del cluster e i conflitti di naming sono superati.
2. `secrets_minted`: secret per-tenant generati (`authd`, firma JWT, Postgres).
3. `namespace_ready`: `tenant-<slug>` creato con label, ResourceQuota e LimitRange.
4. `secrets_applied`: secret inseriti nel namespace come oggetti Kubernetes Secret.
5. `helm_applied` (chart del tenant): il chart `soctalk-tenant` installa l'adapter, il runs-worker e l'ingress. L'utente `tenant_admin` viene auto-provisionato come parte di questa fase.
6. `helm_applied` (chart Wazuh): il chart standalone di Wazuh installa il manager, l'indexer e la dashboard. Il payload dell'evento identifica quale chart è stato applicato. Questa fase non viene eseguita per i tenant `provided`.
7. `workloads_ready`: tutti i pod del data plane riportano lo stato Ready.
8. `integration_config_written`: configurazioni di integrazione per-tenant (LLM, URL di TheHive) scritte nel database.
9. `active`: il tenant transita ad `active` ed è pronto all'uso.

Quando il tenant raggiunge `active`, usa **Open SOC** dall'elenco dei tenant per entrare nella sua dashboard.

Se si blocca, la fase in errore è indicata nella tabella degli eventi:

- **Bloccato in `pending`**: il controller è stato riprogrammato prima della fase 1. Il retry non è consentito direttamente da `pending`; attendi che il tentativo transiti a `degraded`, poi fai clic su **Retry Provisioning**. Il provisioning riprende dalla fase 1.
- **In `provisioning` per oltre 15 minuti**: di solito un pod bloccato (ImagePullBackOff, un PVC in `Pending` o una ResourceQuota troppo piccola). Vedi [Operazioni quotidiane](/it-it/operations#tenant-stuck-in-provisioning).
- **In `degraded`**: una fase di provisioning è fallita. Leggi la riga dell'evento per vedere quale, poi **Retry Provisioning**, che è una transizione valida da `degraded`. Maggiori dettagli in [Ciclo di vita del tenant](/it-it/tenant-lifecycle#recovery-paths).

## Registra gli endpoint del cliente

La registrazione degli endpoint significa fare in modo che le macchine del cliente riportino nel Wazuh manager del tenant corretto. Si applica ai tenant `poc` e `persistent`, che eseguono Wazuh all'interno del proprio namespace. Un tenant `provided` invia già i suoi endpoint al Wazuh del cliente, quindi qui non c'è nulla da registrare; passa alla sezione successiva.

Il Wazuh manager di ogni tenant è in ascolto su 1514/TCP (eventi) e 1515/TCP (registrazione). In questa release il chart crea quel manager solo come Service `ClusterIP`: non c'è alcun provisioning automatico di LoadBalancer o DNS, quindi collegherai tu stesso il bordo (un Service LoadBalancer per-tenant, un HAProxy di edge con coppie di porte per-tenant su un unico IP, o un percorso mesh-VPN) e gestirai il record DNS. La topologia completa e i requisiti di firewall sono in [Ingress degli agent Wazuh](/it-it/reference/wazuh-ingress).

La registrazione è vincolata al tenant dal secret condiviso `authd` del manager. Recuperalo:

```bash
kubectl -n tenant-<slug> get secret wazuh-<slug>-wazuh-creds \
  -o jsonpath='{.data.AUTHD_PASS}' | base64 -d
```

Consegna l'hostname del manager, le due porte e quel secret all'amministratore degli endpoint del cliente su un canale sicuro. Registrano ogni endpoint con:

```bash
agent-auth -m <tenant-manager-hostname> -P "<authd-secret>"
```

Un agent che detiene il secret di un tenant può registrarsi solo con il manager di quel tenant, ed è questo che mantiene isolata la registrazione. Verifica che gli agent siano arrivati nella dashboard Wazuh integrata: Tenants, poi **Open SOC**, poi Agents.

Se invece il data plane del tenant è in esecuzione su infrastruttura separata (il modello di pilot remoto, in cui una VM del tenant si unisce tramite tailnet), quella VM viene registrata con il control plane attraverso un flusso cloud-agent `:issue-agent`, che è cosa diversa dalla registrazione degli endpoint descritta sopra. Quel percorso è trattato end to end nel [tutorial del pilot MSSP](/it-it/mssp-pilot#_4-tenant-side-stand-up-the-data-plane).

## Consegna gli accessi

L'utente `tenant_admin` viene creato automaticamente durante la fase 5, quindi il tenant ha un amministratore non appena raggiunge `active`. Per fornire a quell'amministratore una credenziale utilizzabile, forza un reset della password dal lato MSSP (l'attore deve essere `mssp_admin` o `platform_admin`):

```bash
curl -X POST 'https://<mssp-host>/api/mssp/users/<user-id>/password/reset' \
  -b jar -H 'Origin: https://<mssp-host>'
```

La risposta restituisce una `temporary_password` monouso contrassegnata come `must_change=true`, e il reset revoca ogni sessione esistente di quell'utente. Condividi quella password insieme all'URL del portale del cliente su un canale cifrato end to end come un password manager condiviso, mai un'email non cifrata o un canale di chat pubblico. Il tenant admin sceglie una nuova password al primo accesso.

Da lì il tenant è self-service: il `tenant_admin` accede al portale del cliente, apre **Users** e provisiona i login della propria organizzazione (per esempio `customer_viewer` per gli stakeholder in sola lettura). Il personale MSSP e gli utenti tenant si trovano sui lati opposti di un confine di audience applicato dal capability guard, quindi un login tenant non può strutturalmente raggiungere superfici cross-tenant. I ruoli e quel confine sono descritti in [Utenti e ruoli](/it-it/users-and-roles).

## Verifica

- Il tenant mostra `active` nell'elenco dei tenant e **Open SOC** carica la sua dashboard.
- Per `poc` e `persistent`, verifica che gli endpoint registrati compaiano sotto Open SOC, poi Agents, e che gli eventi provenienti da essi arrivino nella dashboard Wazuh del tenant.
- Per `provided`, verifica che il pod `soctalk-adapter` sia Ready, poi esegui una query basata su Wazuh nella chat di SocTalk (per esempio, chiedi gli alert recenti su un host noto). Si risolve una volta che l'adapter riesce a raggiungere gli endpoint External SIEM del cliente; se non lo fa, ricontrolla la raggiungibilità secondo [Coordinare le credenziali Wazuh esterne](/it-it/mssp-pilot#_3-4-coordinating-external-wazuh-creds-for-provided-tenants).

## Vedi anche

- [Checklist di onboarding](/it-it/guides/wazuh-tenant-onboarding) per la panoramica concettuale e il baseline della prima settimana.
- [Ciclo di vita del tenant](/it-it/tenant-lifecycle) per la macchina a stati, i profili, le quote e i percorsi di ripristino.
- [Tour della UI MSSP](/it-it/mssp-ui#tenants) per l'elenco dei tenant e le pagine di dettaglio.
- [Pilot MSSP: fallo da te](/it-it/mssp-pilot) per il rollout completo basato su tailnet, incluso il data plane lato tenant.
