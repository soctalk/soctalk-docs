# Install from an OS package (rpm / deb / apk)

Every SocTalk release ships native OS packages alongside the VM images, attached
to the same GitHub Release as the version tag. One package per format covers the
major Linux families:

| File | Package manager | Distributions | `soctalk install` supported |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum / zypper | RHEL, Fedora, AlmaLinux, Rocky, openSUSE | Yes |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Debian, Ubuntu | Yes |
| `soctalk_<ver>_x86_64.apk` | apk | Alpine | No, see [Alpine](#alpine-cli-only) |

The `.rpm` and `.deb` paths are verified end to end (install the package, run
`soctalk install`, reach the web app). On Alpine the package installs and the
CLI runs, but `soctalk install` does not work because SocTalk's installer
requires systemd; see the Alpine note below.

They are published on the [`soctalk/soctalk`](https://github.com/soctalk/soctalk/releases)
releases page. The current release is **v0.2.0**:
[release page](https://github.com/soctalk/soctalk/releases/tag/v0.2.0). The
repository is public, so no authentication is needed to download them.

## What the package installs

The package is small on purpose. SocTalk runs on Kubernetes (K3s), so the
package does not contain the SOC stack itself. It installs a thin management CLI
and the installer, then you run one command to bring the stack up:

- `/usr/bin/soctalk`, the management CLI (`install`, `upgrade`, `status`,
  `logs`, `uninstall`, `version`).
- `/usr/libexec/soctalk/install.sh`, the same installer the [demo VM](/quickstart-vm)
  and the [one-command install](/install) use. It bootstraps K3s and Helm if
  they are missing, then Helm-installs the `soctalk-system` chart from GHCR.
- `/etc/soctalk/soctalk.env.example`, a template for unattended installs.

The only dependencies are `curl` and `tar` (plus `bash` on Alpine); the installer
fetches K3s and Helm itself. This is the right path when you are installing onto
a Linux host you manage directly and want SocTalk registered in the system
package database (so `dnf`/`apt`/`apk` track and upgrade it). If you just want to
try SocTalk, the [demo VM image](/quickstart-vm) is faster.

## Install the package

Pick the block for your distribution. Replace `0.2.0` with the current version
if you are on a newer release.

### RHEL, Fedora, AlmaLinux, Rocky

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-0.2.0-1.x86_64.rpm
sudo dnf install ./soctalk-0.2.0-1.x86_64.rpm
```

`dnf` pulls in `curl` and `tar` if they are missing. On older hosts use
`sudo yum install ./soctalk-0.2.0-1.x86_64.rpm`.

### Debian, Ubuntu

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_amd64.deb
sudo apt install ./soctalk_0.2.0_amd64.deb
```

`apt install ./file.deb` resolves the `curl` and `tar` dependencies from your
configured repositories. On a minimal image without `apt` you can use
`sudo dpkg -i soctalk_0.2.0_amd64.deb && sudo apt-get -f install`.

### Alpine

The Alpine package installs the CLI but cannot run `soctalk install` (see
[Alpine](#alpine-cli-only) below). Install it only to manage an existing cluster.

```bash
wget https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk_0.2.0_x86_64.apk
sudo apk add --allow-untrusted ./soctalk_0.2.0_x86_64.apk
```

`--allow-untrusted` is required because the package is not signed with an Alpine
repository key. Verify the checksum below instead.

## Verify the download

Every release includes `SHA256SUMS.txt` covering all artifacts, including the
packages.

```bash
curl -fsSLO https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

`--ignore-missing` checks only the files you actually downloaded. Each line
should report `OK`.

## Bring up the SOC stack

Installing the package does not start SocTalk. After the package is installed,
run the installer through the CLI. This installs K3s and Helm if needed, then
Helm-installs `soctalk-system` on this host.

Interactive (prompts for MSSP name, admin, and LLM provider):

```bash
sudo soctalk install
```

Throwaway demo (random admin password, auto-onboards a demo tenant, no input
required):

```bash
sudo soctalk install --demo
```

Unattended, driven by environment variables (copy the shipped template):

```bash
sudo cp /etc/soctalk/soctalk.env.example /etc/soctalk/soctalk.env
sudoedit /etc/soctalk/soctalk.env      # set MSSP name, admin, LLM provider + key
set -a; . /etc/soctalk/soctalk.env; set +a
sudo -E soctalk install
```

When `SOCTALK_MSSP_NAME`, `SOCTALK_ADMIN_EMAIL`, and `SOCTALK_ADMIN_PASSWORD` are
all set, the installer skips its consent prompt, so this runs without any
interaction. Any argument after `install` passes through to the installer, for
example `soctalk install --chart-version 0.2.0` to pin a chart or
`soctalk install --values-file /etc/soctalk/values.yaml` for an air-gapped
install. See [Production install](/install) for the full flag reference and the
Cilium-based cluster path.

## Manage the install

The CLI wraps the common cluster operations so you do not need to remember the
`KUBECONFIG` path or Helm release name.

```bash
soctalk status              # pods and their readiness in the soctalk namespace
soctalk logs api            # tail a component's logs (api, orchestrator, adapter, app-ui)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk upgrade` is a `helm upgrade --install`, so it is safe to re-run and is
how you move to a newer chart after installing a newer package.

## Uninstall

```bash
sudo soctalk uninstall          # remove the soctalk-system release, keep K3s
sudo soctalk uninstall --purge  # also run k3s-uninstall.sh and tear down the cluster
```

Removing the OS package (`dnf remove soctalk`, `apt remove soctalk`,
`apk del soctalk`) deletes the CLI and installer but does not touch a running
cluster. Run `soctalk uninstall` first if you want the SOC stack gone.

## OS-specific notes

### RHEL, Fedora, AlmaLinux, Rocky

Verified end to end on Rocky Linux 9 with SELinux in **Enforcing** mode. No
manual SELinux work is needed: the K3s installer pulls in the `k3s-selinux` and
`container-selinux` policy packages automatically during `soctalk install`, so
the cluster comes up under Enforcing.

If **firewalld** is active (common on a full RHEL server install, though not on
the minimal cloud images), it can block the K3s pod and service networks, which
shows up as pods stuck `ContainerCreating` or the web app being unreachable. K3s
manages its own iptables rules; the simplest fix is to let it, by trusting the
cluster networks:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --reload
```

### Alpine (CLI only) {#alpine-cli-only}

The `.apk` installs cleanly and the `soctalk` CLI runs, but **`soctalk install`
does not work on Alpine**. Two Alpine characteristics block it:

- SocTalk's installer brings K3s up as a **systemd** service. Alpine uses
  OpenRC, so the `systemctl` calls have nothing to talk to.
- The installer's preflight uses GNU `coreutils` `df` options that Alpine's
  BusyBox `df` does not accept, so it aborts during the disk check before it
  even reaches K3s.

Use the `.apk` only to get the `soctalk` CLI onto an Alpine box that already has
a working cluster reachable via `kubectl`. To stand up SocTalk from scratch, use
a systemd-based host (the `.deb` or `.rpm` path) or the prebuilt
[demo VM image](/quickstart-vm).

## Which path should I use?

- **OS package (this page)**: a Linux host you manage, tracked by the system
  package manager. Good for repeatable, config-managed installs.
- **[One-command install](/install)**: `curl … | install.sh | bash` on a bare
  Ubuntu VM, same installer without the package wrapper.
- **[Demo VM image](/quickstart-vm)**: prebuilt appliance with a browser setup
  wizard, the fastest way to a running system for evaluation.

All three land on the same `soctalk-system` chart and the same running SOC.
