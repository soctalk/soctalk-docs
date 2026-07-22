# Exécuter sur Windows (WSL2)

SocTalk est nativement conçu pour Kubernetes. Sous Windows, il s'exécute en tant que **k3s (Kubernetes léger) à l'intérieur de WSL2**: installé et configuré pour vous par une seule commande PowerShell. Aucun Docker Desktop requis.

::: tip En phase d'évaluation ?
L'**[appliance VM](/fr-fr/downloads)** (Hyper-V `vhdx` ou [VirtualBox](/fr-fr/virtualbox)) est le moyen le plus simple et le plus robuste d'essayer SocTalk sous Windows, c'est une VM Linux autonome, rien à configurer. Le parcours WSL2 décrit sur cette page est l'option pratique de cluster local pour les développeurs qui préfèrent ne pas faire tourner une VM complète.
:::

::: warning Architecture
Les images SocTalk sont **uniquement amd64**, donc cela fonctionne sur **Windows x64**. Sous Windows sur ARM, le jeu d'images nécessiterait une émulation.
:::

## Prérequis

- **Windows 10 2004 (build 19041) ou version ultérieure, ou Windows 11**: x64
- PowerShell en tant qu'**administrateur** (l'installateur active des fonctionnalités Windows et configure WSL2)
- **Virtualisation CPU activée** dans le firmware (WSL2 en a besoin ; dans une VM, activez la virtualisation imbriquée)

Vous n'avez **pas** besoin de préinstaller WSL2, Ubuntu ou Docker, l'installateur s'occupe de tout.

## Installation en un clic

Ouvrez **PowerShell en tant qu'administrateur** et exécutez :

```powershell
irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1 | iex
```

Ce qui se passe :

1. **Active WSL2** (un redémarrage, reconnectez-vous et l'installation **reprend automatiquement** à votre prochaine ouverture de session ; WSL2 ne peut pas s'exécuter sous le compte SYSTEM, donc la reprise s'effectue dans votre session).
2. **Importe une** distribution **Ubuntu** et y active systemd.
3. **Installe k3s** en tant que service systemd à l'intérieur de WSL2, puis déploie SocTalk et intègre un **tenant `demo`**.
4. **Expose l'interface à Windows** à l'adresse **`https://localhost/`** (un `netsh portproxy` redirige vers le cluster à l'intérieur de WSL2 ; une tâche d'ouverture de session la rafraîchit après les redémarrages).

Une fois terminé, il affiche l'URL et les identifiants de démonstration. Ouvrez **`https://localhost/`** dans votre navigateur, acceptez le certificat auto-signé et connectez-vous.

Pour une installation **réelle (hors démo)**, passez `-Real` pour être invité à saisir le nom du MSSP, l'e-mail/mot de passe administrateur et la clé LLM (ou définissez les variables d'environnement `SOCTALK_*`) :

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1))) -Real
```

## Ce qu'il fait (sous le capot)

L'installateur PowerShell amorce WSL2, puis exécute le **même `install.sh`** que l'appliance Linux, avec k3s comme runtime :

```bash
# inside the WSL2 Ubuntu distro, as root:
curl -sfL https://get.k3s.io | sh -          # k3s as a systemd service
helm upgrade --install soctalk-system \
  oci://ghcr.io/soctalk/charts/soctalk-system --version 0.2.0 \
  --namespace soctalk-system --create-namespace -f values.yaml
```

L'hôte d'ingress est `localhost`, et un `netsh portproxy` Windows (`localhost:443` → l'IP de WSL2) le rend accessible depuis votre navigateur.

## Mises en garde

- **Un redémarrage** est requis pour terminer l'activation de WSL2 ; reconnectez-vous ensuite et l'installation se poursuit d'elle-même.
- **Gardez la distribution WSL du cluster en cours d'exécution**: k3s y réside. L'installateur définit `vmIdleTimeout=-1` pour que WSL2 ne se mette pas en veille, et une tâche d'ouverture de session redémarre WSL + rafraîchit la redirection `localhost` après un redémarrage de Windows.
- Le parcours WSL2 est l'option **pratique de cluster local**. Pour une installation toujours active / de type production sous Windows, préférez l'**[appliance VM](/fr-fr/downloads)** (Hyper-V/VirtualBox), une seule VM Linux sans les rouages réseau de WSL2.
- Images amd64 → **x64** uniquement sous Windows.

## Désinstallation

```powershell
# remove the host forward + logon tasks
netsh interface portproxy reset
Get-ScheduledTask SocTalk* | Unregister-ScheduledTask -Confirm:$false

# remove the cluster (inside WSL) and/or the whole distro
wsl -d Ubuntu -u root -- /usr/local/bin/k3s-uninstall.sh
wsl --unregister Ubuntu      # optional: remove the distro entirely
```

## Dépannage

| Symptôme | Vérification |
|---|---|
| L'installation n'a pas continué après le redémarrage | reconnectez-vous en tant que **même utilisateur**: la reprise s'effectue à votre ouverture de session. Relancer `install.ps1` est sans risque (les étapes terminées sont ignorées). |
| `https://localhost/` ne se charge pas | l'IP de WSL2 a peut-être changé ; la tâche planifiée `SocTalkExpose` rafraîchit la redirection, exécutez-la (`Start-ScheduledTask SocTalkExpose`) ou relancez, puis réessayez. |
| `503` depuis `https://localhost/` | la redirection fonctionne mais les pods ne sont pas encore prêts, `wsl -d Ubuntu -u root -- k3s kubectl -n soctalk-system get pods` et attendez l'état `Running`. |
| WSL2 ne démarre pas | activez la virtualisation CPU (VT-x/AMD-V) dans le firmware ; dans une VM, activez la virtualisation imbriquée. |
| Tout ce qui suit l'assistant | comme sur toutes les plateformes, consultez le [tableau de dépannage du Quickstart](/fr-fr/quickstart-vm#troubleshooting). |
