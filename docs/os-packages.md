# Install from an OS package (rpm / deb)

Every SocTalk release ships native OS packages alongside the VM images, attached
to the same GitHub Release as the version tag, for the two systemd-based Linux
families:

| File | Package manager | Verified on | Also expected to work |
|---|---|---|---|
| `soctalk-<ver>-1.x86_64.rpm` | dnf / yum | Rocky Linux 9.8 | RHEL, Fedora, AlmaLinux |
| `soctalk_<ver>_amd64.deb` | apt / dpkg | Ubuntu 24.04 | Debian |

Both are verified end to end: install the package, run `soctalk install`, reach
the web app and log in. The "also expected" column is the same package family
but has not been tested on those distributions specifically.

On Rocky Linux 9.8 the verification covered both shapes the product ships, on
fresh VMs with SELinux in Enforcing mode. The control-plane-only install brought
up `api`, `app-ui` and `postgres`, and the bootstrap admin could log in. The
full install additionally onboarded a `poc` tenant that stood up its own Wazuh
manager, indexer and dashboard and reached `active`. That second run was done
with firewalld enabled, which needs the rules in
[the RHEL notes](#rhel-fedora-almalinux-rocky) below before the cluster will
work. Those notes cover what SELinux and firewalld each do and do not require
of you.

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

Some RHEL 9 images carry `curl-minimal` in place of the full `curl`, which can
conflict with packages that require `curl` by name. It does not conflict here.
On the Rocky Linux 9.8 host used for verification, with `curl` removed and only
`curl-minimal` installed, the rpm installed unchanged: `curl-minimal` carries
`Provides: curl`, so the dependency resolves with no swap and no
`--allowerasing`.

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
soctalk status              # pods and their readiness in soctalk-system
soctalk logs api            # tail a component's logs (api, app-ui, postgres)
sudo soctalk upgrade        # re-run the installer against the current chart (idempotent)
soctalk version             # CLI version (matches the package version)
```

`soctalk logs` covers the control plane in `soctalk-system`. Per-tenant
workloads such as the adapter and the runs-worker live in `tenant-<slug>`
namespaces, so reach those with `kubectl` against that namespace instead.

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

#### SELinux

Verified on Rocky Linux 9.8 with SELinux in **Enforcing** mode, for both the
control-plane-only install and the full install with a Wazuh-backed tenant. No
manual SELinux work is needed. During `soctalk install` the K3s installer pulled
in `k3s-selinux` 1.6 and `container-selinux` itself, and the cluster came up
without anyone touching a boolean, a label or a custom module. Neither run
recorded an AVC denial.

Note what that claim is. It means SocTalk runs correctly under the targeted
policy, not that SELinux is confining the workload as a hardening layer.
Enabling K3s's own SELinux enforcement (`--selinux` / `K3S_SELINUX=true`) was
not tested. RHEL 10 also needs the `kernel-modules-extra` package for K3s,
which was not tested.

#### firewalld

The Rocky Linux 9.8 GenericCloud image used for verification does not include
firewalld at all, so a cloud VM often has nothing to do here. A full server
install does have it, enabled. With firewalld running under its default policy,
the install stalled until the K3s pod and service networks were trusted, so on
such a host this step is a prerequisite rather than hardening advice.

The failure is worth recognising because it does not look like a firewall
problem. K3s installs cleanly, the node goes `Ready`, images pull, and every
pod schedules. What breaks is pod-to-pod and pod-to-Service traffic on the
flannel bridge, so the API's `db-init` init container cannot reach Postgres and
loops on `No route to host` while Postgres itself sits there `1/1 Running`.
The install then spends its entire Helm `--wait` window before failing on a
timeout, with the real cause buried in an init container's log.

Trust the K3s pod and service networks, and open the ingress ports you reach
the UI on:

```bash
sudo firewall-cmd --permanent --zone=trusted --add-source=10.42.0.0/16   # pods
sudo firewall-cmd --permanent --zone=trusted --add-source=10.43.0.0/16   # services
sudo firewall-cmd --permanent --add-port=80/tcp --add-port=443/tcp       # web UI ingress
sudo firewall-cmd --reload
```

These are the K3s defaults; if you set a custom cluster or service CIDR, use
those instead. A multi-node cluster needs more ports open between nodes (see the
K3s networking requirements).

If the install is still waiting when you apply the rules, it recovers on the
next retry and completes; you do not have to start over. If Helm has already
timed out, apply the rules and rerun `sudo soctalk install`. After v0.2.0 the
installer's preflight checks for this and prints these commands before it
touches the host ([soctalk#118](https://github.com/soctalk/soctalk/issues/118)).

SocTalk does not change firewalld rules for you. That is your security boundary
to open.

#### sudo and /usr/local/bin

K3s and Helm install their binaries, and the `kubectl` symlink, into
`/usr/local/bin`. RHEL-family distros leave that directory off sudo's
`secure_path` (`Defaults secure_path = /sbin:/bin:/usr/sbin:/usr/bin`), so a
bare `sudo k3s ...`, `sudo kubectl ...` or `sudo helm ...` answers
`command not found` even though the binary is right there and the install
succeeded.

The `soctalk` CLI resolves these paths itself, so `sudo soctalk install`,
`soctalk status` and `soctalk logs` all work as written. When you need `kubectl`
directly, either give the full path or add the directory to your own `PATH`:

```bash
sudo /usr/local/bin/k3s kubectl -n soctalk-system get pods
```

Documentation elsewhere on this site sometimes writes this as
`sudo k3s kubectl ...`, which is correct on Debian and Ubuntu but needs the
full path on RHEL-family hosts.

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
