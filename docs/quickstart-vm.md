# Quickstart: SocTalk demo VM

The fastest way to try SocTalk end-to-end: download a pre-built VM image, boot it, open the setup wizard in your browser, click through. Five minutes to a running multi-tenant install with a demo tenant onboarded.

This path is for **evaluators and demos** — for a production install on your own cluster see [Install](/install).

## What's inside the image

- Ubuntu 24.04 LTS, cloud-init enabled
- K3s with bundled Traefik ingress
- Helm + a pre-pulled `soctalk-system` chart
- A first-boot setup wizard on `:8443`
- A first-boot installer (`soctalk-firstboot.service`) that runs after the wizard collects config
- The image is the same regardless of format (qcow2 / vmdk / vhdx / vhd / raw); pick whichever your hypervisor consumes natively. See [Downloads](/downloads).

## 1. Download

Pick the format for your hypervisor on the [Downloads](/downloads) page. Examples:

```bash
# KVM / Proxmox / libvirt
curl -L -o soctalk-demo.qcow2.xz \
  https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-<ver>.qcow2.xz
xz -d soctalk-demo.qcow2.xz
```

Verify the checksum:

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## 2. Boot the image

### KVM / libvirt (CLI)

```bash
qemu-system-x86_64 \
  -m 8G -smp 4 -enable-kvm -cpu host \
  -drive file=soctalk-demo.qcow2,format=qcow2,if=virtio \
  -netdev user,id=net0,hostfwd=tcp::18022-:22,hostfwd=tcp::18443-:8443 \
  -device virtio-net,netdev=net0 \
  -nographic
```

### Proxmox VE

`qm importdisk <vmid> soctalk-demo.qcow2 <storage>`, then attach as virtio-scsi.

### VMware

Import `soctalk-demo.vmdk` as an existing disk on a new VM (Linux, Ubuntu 64-bit).

### Hyper-V

Use `soctalk-demo.vhdx` as the OS disk on a Generation 2 VM.

### AWS

Build a native AMI with Packer, or import `soctalk-demo.vmdk` as an AMI with VM Import. Full walkthrough: [Run on AWS](/aws).

### Azure

Upload `soctalk-demo.vhd` (fixed-size) directly to a Managed Disk, then create a Generation 1 image and VM from it. Full walkthrough: [Run on Azure](/azure).

### Raw / dd

`soctalk-demo.raw` is bit-for-bit what's on disk. Suitable for generic cloud image import (GCP, OpenStack) or for writing to a physical disk with `dd`.

**Minimum sizing**: 4 vCPU, 8 GB RAM, 60 GB disk. See [Sizing](/reference/sizing).

## 3. Get the setup token

The wizard binds `:8443` with TLS (self-signed). It refuses connections without the per-boot setup token. SSH to the box and read it:

```bash
ssh ops@<vm-ip>
sudo cat /var/log/soctalk-setup-token
```

Default SSH user is `ops`. **SSH access requires a cloud-init seed with your public key** (see [Optional: cloud-init seed](#optional-cloud-init-seed) below) — the image ships with no baked-in credentials. If you boot without a seed, use the hypervisor's console to read the token instead.

## 4. Open the wizard

Browse to `https://<vm-ip>:8443/`. Accept the self-signed cert. You'll land on the token-entry page:

![Setup wizard — token entry](/screenshots/setup-wizard-token.png)

Paste the token, then fill in:

- MSSP / organization name
- Hostname (optional — leave blank to use the box IP)
- Admin email + password (min 12 chars)
- LLM provider + API key

See [Setup wizard](/setup-wizard) for the full field reference.

Submit. The wizard writes `values.yaml`, the LLM Secret, and an onboarding env-file, then exits. The first-boot installer takes over:

1. Starts k3s
2. Creates `soctalk-system` namespace + LLM Secret
3. `helm install soctalk-system`
4. Logs in as the bootstrap admin and onboards a `demo` tenant via `POST /api/mssp/tenants/onboard`

Total wall-clock from submit: about 2 minutes for `soctalk-system` pods Ready, then another 1–3 minutes for the demo tenant's Wazuh stack to reach Ready.

## 5. Sign in

Browse to `https://<vm-ip>/` (note: port 443, not 8443 — the wizard binds 8443 specifically to avoid conflicting with Traefik). The MSSP dashboard expects a DNS name; if you used a blank hostname add a `/etc/hosts` entry pointing `soctalk.local` at the VM IP and browse to `https://soctalk.local/`.

Sign in with the admin email + password you set in the wizard. You'll land on the MSSP dashboard. Continue with the [MSSP UI Tour](/mssp-ui).

## Optional: cloud-init seed

If you want to inject an SSH key (or skip the wizard entirely by supplying values.yaml directly), pass cloud-init user-data via NoCloud:

```bash
cat > user-data <<EOF
#cloud-config
users:
  - name: ops
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
      - ssh-ed25519 AAAA...your-key
EOF
echo "instance-id: $(uuidgen)" > meta-data
cloud-localds seed.iso user-data meta-data

# attach seed.iso as a second drive on first boot.
```

To skip the wizard, drop `/etc/soctalk/values.yaml` + `/etc/soctalk/llm.key` via cloud-init `write_files`; the wizard's systemd condition (`ConditionPathExists=!/etc/soctalk/values.yaml`) will short-circuit and the installer goes straight to `helm install`.

## Troubleshooting

| Symptom | Check |
|---|---|
| Wizard URL never loads | `systemctl status soctalk-setup-wizard` on the VM. If `inactive`, look at `journalctl -u soctalk-setup-wizard` |
| Wizard says "invalid token" | Token is in `/var/log/soctalk-setup-token`, **owned by root**. Use `sudo cat`. Each boot regenerates the token |
| Wizard says "rate-limited" | The wizard locks the IP after 10 failed token attempts. Wait 1 h or `systemctl restart soctalk-setup-wizard` (this rotates the token too) |
| `helm install` stalls | `kubectl get pods -A` from the box; `journalctl -u soctalk-firstboot -f` |
| Demo tenant's adapter / runs-worker pods stuck in ImagePullBackOff | Known: the controller defaults to an unpublished image tag. See [Troubleshooting](/troubleshooting) |

For a clean reset: delete `/var/lib/soctalk-firstboot.done`, `/var/lib/soctalk-wizard.done`, `/etc/soctalk/values.yaml`, then `systemctl restart soctalk-setup-wizard`.
