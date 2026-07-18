# Assistant de configuration

Configurateur de premier démarrage basé sur le navigateur, livré avec l'[image de VM de démonstration](/fr-fr/quickstart-vm). Il ne fait **pas** partie d'une installation de production — les utilisateurs en production rédigent eux-mêmes `values.yaml` à la main et exécutent `helm install`.

Le rôle de l'assistant est de :

1. Authentifier l'opérateur au moyen d'un jeton de configuration propre à chaque démarrage.
2. Collecter la configuration minimale nécessaire pour installer `soctalk-system`.
3. Écrire `/etc/soctalk/values.yaml`, `/etc/soctalk/llm.key` et un fichier d'environnement d'intégration de tenant.
4. Se terminer et passer la main à `soctalk-firstboot.service`, qui exécute `helm install` et intègre un tenant de démonstration.

Le code source se trouve dans [`setup-wizard/`](https://github.com/soctalk/soctalk/tree/main/setup-wizard) (Go, ~600 lignes).

## Comment y accéder

Port `:8443` sur la VM. TLS uniquement ; l'assistant génère au premier démarrage un certificat ECDSA P-256 auto-signé couvrant les adresses IP locales de la VM, `localhost` et `soctalk.local`. Le port d'écoute est `:8443` (et non `:443`) afin de ne pas entrer en conflit avec le Traefik intégré à k3s.

```text
https://<vm-ip>:8443/
```

## Jeton de configuration

L'assistant génère un jeton de configuration de 256 bits au premier démarrage et l'écrit dans `/var/log/soctalk-setup-token` (mode `0600`, propriété de root). Récupérez-le avec :

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

Le jeton est renouvelé à chaque redémarrage de l'assistant. Il n'existe aucune API pour récupérer un jeton perdu sans redémarrer l'unité ; la redémarrer le renouvelle et le réaffiche.

## Formulaire en deux étapes

1. **Authentifier** — collez le jeton de configuration.
2. **Configurer** — remplissez les champs ci-dessous.

La page de saisie du jeton soumet à `POST /auth` ; la page de configuration soumet à `POST /submit`. Les deux utilisent des cookies CSRF liés par HMAC (`SameSite=Strict`, `HttpOnly`, `Secure`).

### Étape 1 — Authentifier

![Assistant de configuration — saisie du jeton](/screenshots/setup-wizard-token.png)

### Étape 2 — Configurer

![Assistant de configuration — formulaire de configuration, rempli](/screenshots/setup-wizard-config-filled.png)

### Identité

| Champ | Type | Notes |
|---|---|---|
| Nom du MSSP / de l'organisation | texte, ≤120 caractères | devient `install.msspName` dans les valeurs du chart |
| Nom d'hôte | FQDN facultatif, ≤253 caractères | vide → prend par défaut `soctalk.local` ; le chart rejette les adresses IP sur `spec.rules[0].host` |
| E-mail de l'administrateur | e-mail | devient le `mssp_admin` d'amorçage (l'init du chart V1 crée ce rôle, et non `platform_admin`) |
| Mot de passe de l'administrateur | mot de passe, ≥12 caractères | écrit dans le fichier de valeurs sous `install.bootstrapAdmin.password`. L'init du chart crée l'utilisateur avec `must_change=false`, la première connexion est donc immédiate |

### LLM

| Champ | Type | Notes |
|---|---|---|
| Fournisseur | liste déroulante (`anthropic`, `openai`) | **Affiché uniquement dans cette version.** L'assistant collecte la valeur mais ne l'écrit pas dans les valeurs du chart ; la valeur par défaut du chart (`openai-compatible`) s'applique. Pour fixer un fournisseur spécifique, modifiez `/etc/soctalk/values.yaml` afin de définir `defaults.llm.provider` avant l'exécution de `soctalk-firstboot.service`, ou faites un `helm upgrade` après l'installation. Le câblage à travers l'assistant est prévu pour une version future |
| Clé API | mot de passe | écrite dans `/etc/soctalk/llm.key` (mode `0600`) — PAS dans le fichier de valeurs. L'installateur en crée un Secret Kubernetes (`soctalk-system-llm-api-key`) avec les champs de données `anthropic-api-key` et `openai-api-key`, afin que le runtime du chart puisse utiliser le fournisseur indiqué par les valeurs |

### Intégration du tenant de démonstration

L'assistant écrit également `/etc/soctalk/onboard.env` :

```text
ADMIN_EMAIL='<email>'
ADMIN_PW='<password>'
INGRESS_HOST='<hostname or soctalk.local>'
TENANT_SLUG=demo
TENANT_NAME='<org name> — Demo'
```

`soctalk-firstboot.sh` lit ce fichier une fois que `helm install` a réussi, se connecte via `POST /api/auth/login` et appelle `POST /api/mssp/tenants/onboard` avec `{slug: demo, profile: poc, display_name: <name>}`. L'intégration du tenant est **asynchrone** : l'API renvoie immédiatement 202 ; le contrôleur de provisionnement démarre la pile Wazuh en arrière-plan. L'installateur de premier démarrage n'attend pas que le tenant atteigne l'état `active` avant de se terminer.

## Ce que l'assistant écrit

| Chemin | Mode | Contenu |
|---|---|---|
| `/etc/soctalk/values.yaml` | 0640 | Valeurs de chart rendues (`install.*`, `ingress.*`, `postgres.*`) |
| `/etc/soctalk/llm.key` | 0600 | Clé API LLM, ligne unique |
| `/etc/soctalk/onboard.env` | 0600 | Fichier d'environnement d'intégration du tenant de démonstration |
| `/var/lib/soctalk-wizard.done` | 0644 | Sentinelle — empêche l'assistant de se redéclencher aux démarrages suivants |

## Unité systemd

```text
[Unit]
After=cloud-init.target network-online.target
ConditionPathExists=!/var/lib/soctalk-firstboot.done
ConditionPathExists=!/var/lib/soctalk-wizard.done
ConditionPathExists=!/etc/soctalk/values.yaml

[Install]
WantedBy=cloud-init.target
```

Elle s'accroche à `cloud-init.target` (et non `multi-user.target`) pour éviter un cycle d'ordonnancement via `After=cloud-final.service`. Les données utilisateur de cloud-init sont autorisées à déposer directement `/etc/soctalk/values.yaml` — si c'est le cas, l'assistant ne démarre jamais et `soctalk-firstboot.service` passe directement à `helm install`.

## Durcissement

L'unité utilise le durcissement standard de systemd : `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, `NoNewPrivileges=true`, `RestrictNamespaces=true`, `MemoryDenyWriteExecute=true`. Les écritures sont confinées à `/etc/soctalk`, `/var/lib` et `/var/log`. L'assistant se lie au port privilégié `:8443` via `AmbientCapabilities=CAP_NET_BIND_SERVICE`.

Après une soumission réussie, l'assistant écrit la sentinelle et se termine. Le `ConditionPathExists=!sentinel` de systemd l'empêche de redémarrer au boot.

## Anti-abus

- **Contrôle du jeton** sur chaque endpoint authentifié. Comparaison à temps constant.
- **CSRF** via des cookies double-submit liés par HMAC sur chaque POST modifiant l'état.
- **Limitation de débit** : 30 s minimum entre les tentatives d'authentification par IP source ; 10 échecs en une heure bloquent l'IP pendant une heure. (Codex a signalé qu'il s'agit d'un vecteur DoS trivial derrière un NAT — les opérateurs derrière un NAT partagé peuvent voir une configuration légitime bloquée. Redémarrez l'unité pour réinitialiser.)
- **TLS auto-signé uniquement**. L'assistant ne sert jamais de HTTP en clair. Les clients acceptent le certificat auto-signé une seule fois ; les utilisateurs en production ne devraient jamais atteindre l'assistant.

## Ce qui se passe après la soumission

L'assistant renvoie `{poll: "/status", status: "accepted"}` et se termine après un délai de grâce de 3 secondes (afin que le poller du client puisse récupérer la réponse de succès). Ensuite :

1. `soctalk-firstboot.service` remarque que `values.yaml` existe et démarre.
2. `systemctl start k3s` (k3s a été installé mais non démarré par Packer, si bien que l'assistant disposait du port `:8443` libre).
3. Crée l'espace de noms `soctalk-system` + le Secret LLM.
4. `helm upgrade --install soctalk-system /opt/soctalk/charts/soctalk-system --values /etc/soctalk/values.yaml --wait --timeout 15m`.
5. Applique un correctif à la NetworkPolicy `kube-system → soctalk-system` pour que Traefik puisse atteindre les Services de soctalk-system.
6. Interroge `/api/auth/me` à travers Traefik (astuce de l'en-tête Host) pendant jusqu'à 10 minutes. Un 200 ou un 401 signifient tous deux « Traefik achemine » ; la boucle accepte l'un comme l'autre.
7. Se connecte en tant qu'administrateur d'amorçage, appelle `POST /api/mssp/tenants/onboard`.
8. Écrit `/var/lib/soctalk-firstboot.done`.

Suivez `/var/log/soctalk-firstboot.log` (ou `journalctl -u soctalk-firstboot -f`) pour observer le déroulement.

## Réinitialiser / relancer

Pour relancer l'assistant après une installation réussie :

```bash
sudo rm /var/lib/soctalk-firstboot.done /var/lib/soctalk-wizard.done /etc/soctalk/values.yaml
sudo systemctl restart soctalk-setup-wizard
```

C'est une opération destructive — la release helm existante possède toujours l'espace de noms `soctalk-system`. Pour une réinitialisation propre, faites d'abord `helm uninstall soctalk-system -n soctalk-system`.
