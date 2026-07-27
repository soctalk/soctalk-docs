# Install from an OS package (rpm / deb)

Every SocTalk release ships native OS packages alongside the VM images, attached
to the same GitHub Release as the version tag, for the two systemd-based Linux
families:

| File | Package manager | Verified on | Also expected to work |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Both are verified end to end: install the package, run `soctalk install`, reach
the web app and log in. The "also expected" column is the same package family
but has not been tested on those distributions specifically.

**Alpine is not supported** and no `.apk` is published: `soctalk install`
requires systemd, and Alpine uses OpenRC. See [Alpine and other non-systemd
hosts](#alpine-and-other-non-systemd-hosts) below. **openSUSE / zypper** and
**RHEL 10** are untested; the RHEL/Fedora notes may not fully apply. **amd64
only**: there is no arm64 package.

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

The only dependencies are `curl` and `tar`; the installer fetches K3s and Helm
itself. This is the right path when you are installing onto a Linux host you
manage directly and want SocTalk registered in the system package database (so
`dnf`/`apt` track and upgrade it). If you just want to try SocTalk, the
[demo VM image](/quickstart-vm) is faster.

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

Throwaway demo (random admin password, auto-onboards a demo tenant):

```bash
sudo soctalk install --demo
```

`--demo` still pauses once for a consent prompt. For a fully unattended run (no
terminal attached, for example from a provisioning script) add `--yes`:
`sudo soctalk install --demo --yes`.

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

Removing the OS package (`dnf remove soctalk` or `apt remove soctalk`) deletes
the CLI and installer but does not touch a running cluster. Run
`soctalk uninstall` first if you want the SOC stack gone.

## OS-specific notes

### RHEL, Fedora, AlmaLinux, Rocky

Verified on Rocky Linux 9 with SELinux in **Enforcing** mode. No manual SELinux
work is needed to get running: the K3s installer pulls in the `k3s-selinux` and
`container-selinux` policy packages automatically during `soctalk install`, so
the cluster comes up under Enforcing. Note this means "runs correctly under the
targeted policy," not that SELinux is confining the workload as a hardening
layer; enabling K3s's own SELinux enforcement (`--selinux` / `K3S_SELINUX=true`)
was not tested here. RHEL 10 also needs the `kernel-modules-extra` package for
K3s, which was not tested.

If **firewalld** is active (common on a full RHEL server install, though not on
the minimal cloud images), it can block cluster traffic, which shows up as pods
stuck `ContainerCreating` or the web app being unreachable. Trust the K3s pod
and service networks, and open the ingress ports you actually reach the UI on:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

The `10.42.0.0/16` and `10.43.0.0/16` values are the K3s defaults; if you set a
custom cluster or service CIDR, use those instead. A multi-node cluster needs
more ports open between nodes (see the K3s networking requirements).

### Alpine and other non-systemd hosts {#alpine-and-other-non-systemd-hosts}

**SocTalk's installer requires systemd.** It brings K3s up as a systemd service
and waits on the systemd-written kubeconfig, so it does not work on Alpine
(OpenRC) or any other non-systemd init. On such a host `soctalk install` stops
early with a clear message telling you so. For that reason no `.apk` is
published.

To run SocTalk where you were considering Alpine, use a systemd distribution
(the `.deb` or `.rpm` path above) or the prebuilt
[demo VM image](/quickstart-vm).

## Which path should I use?

- **OS package (this page)**: a Linux host you manage, tracked by the system
  package manager. Good for repeatable, config-managed installs.
- **[One-command install](/install)**: `curl … | install.sh | bash` on a bare
  Ubuntu VM, same installer without the package wrapper.
- **[Demo VM image](/quickstart-vm)**: prebuilt appliance with a browser setup
  wizard, the fastest way to a running system for evaluation.

All three land on the same `soctalk-system` chart and the same running SOC.
