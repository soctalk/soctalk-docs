# Downloads

Pre-built SocTalk demo VM images, published as GitHub Release artifacts on every `v*` tag of the [`soctalk/soctalk`](https://github.com/soctalk/soctalk) repository.

All images are the same Ubuntu 24.04 + K3s + setup wizard build, just converted to different virtual-disk formats. Pick the format your hypervisor consumes natively. **There is no per-format functional difference.**

## Latest release

Current version: **v0.2.0**: [release page](https://github.com/soctalk/soctalk/releases/tag/v0.2.0) · [all releases](https://github.com/soctalk/soctalk/releases)

The release includes:

- [`soctalk-demo-0.2.0.qcow2.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz), KVM, QEMU, libvirt, Proxmox
- [`soctalk-demo-0.2.0.vmdk.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vmdk.xz), VMware ESXi, Workstation, Fusion, VirtualBox
- [`soctalk-demo-0.2.0.vhdx.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhdx.xz), Microsoft Hyper-V (Generation 1)
- [`soctalk-demo-0.2.0.vhd.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.vhd.xz), Microsoft Azure (fixed-size, 1 MiB aligned)
- [`soctalk-demo-0.2.0.raw.xz`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.raw.xz), generic cloud import (GCP, OpenStack), `dd` to physical disk
- [`SHA256SUMS.txt`](https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt), checksums for all of the above

All artifacts are compressed with `xz -9`. Decompress with `xz -d <file>.xz`.

## Format chooser

| Your platform | Download |
|---|---|
| **Proxmox VE** | qcow2, `qm disk import`. See [Run on Proxmox](/proxmox) |
| **libvirt / virt-manager / QEMU CLI** | qcow2 |
| **KVM (RHEL/CentOS/Alma)** | qcow2 |
| **VMware ESXi** | vmdk, see [Run on VMware ESXi](/vmware) |
| **VMware Workstation / Fusion** | vmdk |
| **VirtualBox** | vmdk, convert to VDI, then attach. See [Run on VirtualBox](/virtualbox) |
| **Microsoft Hyper-V** | vhdx, Generation 1 VM (validated; the image boots via BIOS firmware, Gen 2 / UEFI is untested) |
| **Microsoft Azure** | vhd, direct upload to a Managed Disk → Image → VM. See [Run on Azure](/azure) |
| **Google Cloud** | raw, `tar czf disk.tar.gz disk.raw && gcloud compute images create` |
| **OpenStack** | raw, `openstack image create --disk-format raw` |
| **AWS** | vmdk, import as an AMI with VM Import, or build a native AMI with Packer. See [Run on AWS](/aws) |
| **Bare metal** | raw, `dd if=disk.raw of=/dev/sdX bs=4M` |

## Verify the download

```bash
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/SHA256SUMS.txt
curl -L -O https://github.com/soctalk/soctalk/releases/download/v0.2.0/soctalk-demo-0.2.0.qcow2.xz
sha256sum -c SHA256SUMS.txt --ignore-missing
```

## Disk size

All images have:

- **Compressed size**: ~600 MB to 1.5 GB depending on format
- **Decompressed apparent size**: 60 GB
- **Actual on-disk size after first boot**: ~3 GB (qcow2/vhdx are sparse; raw and vhd are fixed-size but most of the 60 GB is zeros and compresses to nothing)

## Build it yourself

The Packer harness lives in [`infra/packer/`](https://github.com/soctalk/soctalk/tree/main/infra/packer). With KVM and Packer 1.11+ on a Linux host:

```bash
git clone https://github.com/soctalk/soctalk.git
cd soctalk/infra/packer
packer init .
packer build -only="soctalk-demo.qemu.soctalk_demo" .
```

Builds in ~1 minute on a modern host with KVM acceleration. Outputs land in `build/dist/`: one file per format. See the [Packer README](https://github.com/soctalk/soctalk/blob/main/infra/packer/README.md) for cloud-init seed configuration and the AWS AMI source.

## CI workflow

`build-packer-images.yml` is `workflow_dispatch`-only; Packer builds aren't fired on every push because they're slow and consume runner minutes. Fire intentionally for a new release:

```bash
gh workflow run build-packer-images.yml -f version=0.2.0
```

The workflow runs:

1. **build-wizard**: Go build of the setup wizard binary.
2. **build-qcow2**: Packer build producing all five formats; xz-compresses; uploads each as a separate workflow artifact; attaches to the GitHub Release on `v*` tags.
3. **boot-test**: Boots the qcow2 in a fresh KVM VM, waits for `soctalk-firstboot` to complete, runs a Playwright validator. Fails the workflow if the image is broken so a bad release never gets attached to a tag.
