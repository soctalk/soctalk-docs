# Run on Windows (WSL2)

SocTalk is Kubernetes-native. On Windows it runs as **k3s (lightweight Kubernetes) inside WSL2** — installed and wired up for you by a single PowerShell command. No Docker Desktop required.

::: tip Just evaluating?
The **[VM appliance](/downloads)** (Hyper-V `vhdx` or [VirtualBox](/virtualbox)) is the simplest and most robust way to try SocTalk on Windows — it's a self-contained Linux VM, nothing to configure. The WSL2 path on this page is the local-cluster convenience option for developers who'd rather not run a full VM.
:::

::: warning Architecture
SocTalk images are **amd64-only**, so this works on **Windows x64**. On Windows on ARM the image set would need emulation.
:::

## Prerequisites

- **Windows 10 2004 (build 19041) or newer, or Windows 11** — x64
- **Administrator** PowerShell (the installer enables Windows features and configures WSL2)
- **CPU virtualization enabled** in firmware (WSL2 needs it; in a VM, enable nested virtualization)

You do **not** need to pre-install WSL2, Ubuntu, or Docker — the installer handles all of it.

## One-click install

Open **PowerShell as Administrator** and run:

```powershell
irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1 | iex
```

What happens:

1. **Enables WSL2** (one reboot — log back in and the install **resumes automatically** at your next logon; WSL2 can't run as the SYSTEM account, so the resume runs in your session).
2. **Imports an Ubuntu** distro and enables systemd inside it.
3. **Installs k3s** as a systemd service inside WSL2, then deploys SocTalk and onboards a **`demo` tenant**.
4. **Exposes the UI to Windows** at **`https://localhost/`** (a `netsh portproxy` forwards to the cluster inside WSL2; a logon task refreshes it after reboots).

When it finishes it prints the URL and demo credentials. Open **`https://localhost/`** in your browser, accept the self-signed certificate, and sign in.

For a **real (non-demo)** install, pass `-Real` to be prompted for the MSSP name, admin email/password, and LLM key (or set the `SOCTALK_*` env vars):

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/soctalk/soctalk/main/install.ps1))) -Real
```

## What it does (under the hood)

The PowerShell installer bootstraps WSL2, then runs the **same `install.sh`** the Linux appliance uses, with k3s as the runtime:

```bash
# inside the WSL2 Ubuntu distro, as root:
curl -sfL https://get.k3s.io | sh -          # k3s as a systemd service
helm upgrade --install soctalk-system \
  oci://ghcr.io/soctalk/charts/soctalk-system --version 0.2.0 \
  --namespace soctalk-system --create-namespace -f values.yaml
```

The ingress host is `localhost`, and a Windows `netsh portproxy` (`localhost:443` → the WSL2 IP) makes it reachable from your browser.

## Caveats

- **One reboot** is required to finish enabling WSL2; log back in afterward and the install continues on its own.
- **Keep the cluster's WSL distro running** — k3s lives inside it. The installer sets `vmIdleTimeout=-1` so WSL2 doesn't idle out, and a logon task re-boots WSL + refreshes the `localhost` forward after a Windows restart.
- The WSL2 path is the **local-cluster convenience** option. For an always-on / production-style install on Windows, prefer the **[VM appliance](/downloads)** (Hyper-V/VirtualBox) — a single Linux VM with no WSL2 networking moving parts.
- amd64 images → Windows **x64** only.

## Tear down

```powershell
# remove the host forward + logon tasks
netsh interface portproxy reset
Get-ScheduledTask SocTalk* | Unregister-ScheduledTask -Confirm:$false

# remove the cluster (inside WSL) and/or the whole distro
wsl -d Ubuntu -u root -- /usr/local/bin/k3s-uninstall.sh
wsl --unregister Ubuntu      # optional: remove the distro entirely
```

## Troubleshooting

| Symptom | Check |
|---|---|
| Install didn't continue after the reboot | log back in as the **same user** — the resume runs at your logon. Re-running `install.ps1` is safe (completed steps are skipped). |
| `https://localhost/` not loading | the WSL2 IP may have changed; the `SocTalkExpose` scheduled task refreshes the forward — run it (`Start-ScheduledTask SocTalkExpose`) or re-run, then retry. |
| `503` from `https://localhost/` | the forward works but pods aren't ready yet — `wsl -d Ubuntu -u root -- k3s kubectl -n soctalk-system get pods` and wait for `Running`. |
| WSL2 fails to start | enable CPU virtualization (VT-x/AMD-V) in firmware; in a VM, enable nested virtualization. |
| Anything past the wizard | same as every platform — see the [Quickstart troubleshooting table](/quickstart-vm#troubleshooting). |
