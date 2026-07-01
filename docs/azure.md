# Run the demo VM on Azure

Import the published `soctalk-demo-<ver>.vhd` image into Azure as a managed disk, turn it into a VM image, and boot it. Azure VMs run on Hyper-V, so this is also the quickest way to validate the image on a Hyper-V hypervisor without standing up a Windows Server host.

This path is for **evaluators and demos** — for a production install on your own cluster see [Install](/install).

## Why the `.vhd` (and why Generation 1)

- Azure only accepts **fixed-size, 1 MiB-aligned VHD** disks (not VHDX, not dynamic VHD). The published `soctalk-demo-<ver>.vhd` is emitted by the release pipeline exactly that way (`qemu-img convert -O vpc -o subformat=fixed,force_size`), so it imports as-is — no local conversion step.
- The image is built and boot-tested under BIOS firmware, which maps to Azure **Generation 1** VMs. Create the disk and image with `--hyper-v-generation V1`.
- A fixed 60 GB VHD sounds heavy, but it is almost entirely zeros. `azcopy` uploads to a page blob and **skips zero pages**, so the actual transfer is roughly the ~3 GB of real data.

## Prerequisites

- An Azure subscription (`az account list` must show one — tenant-level directory access is not enough).
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) (`az`) and [AzCopy](https://learn.microsoft.com/azure/storage/common/storage-use-azcopy-v10) (`azcopy`). On macOS: `brew install azure-cli azcopy`.
- ~61 GB free local disk for the decompressed VHD.
- An SSH key pair (`~/.ssh/id_ed25519.pub` in the examples below).

Log in and select the subscription:

```bash
az login
az account set --subscription "<subscription-name-or-id>"
```

## 1. Download and decompress the VHD

```bash
VER=<ver>   # e.g. 0.1.3
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/soctalk-demo-$VER.vhd.xz
curl -L -O https://github.com/soctalk/soctalk/releases/latest/download/SHA256SUMS.txt
sha256sum -c SHA256SUMS.txt --ignore-missing
xz -d soctalk-demo-$VER.vhd.xz   # decompresses to a 60 GB fixed VHD
```

## 2. Create a resource group

Everything in this guide lives in one resource group, so teardown is a single command at the end.

```bash
RG=soctalk-demo
LOC=westus2
az group create -n $RG -l $LOC
```

## 3. Upload the VHD straight to a managed disk

No storage account needed — Azure supports direct upload to a managed disk. Create an empty disk sized to the VHD file's exact byte count, grab a short-lived write SAS, upload with `azcopy`, then revoke the SAS:

```bash
VHD=soctalk-demo-$VER.vhd
SIZE=$(stat -f %z "$VHD" 2>/dev/null || stat -c %s "$VHD")   # macOS || Linux

az disk create -g $RG -n soctalk-demo \
  --for-upload --upload-size-bytes $SIZE \
  --sku standard_lrs --os-type Linux --hyper-v-generation V1

SAS=$(az disk grant-access -g $RG -n soctalk-demo \
  --access-level Write --duration-in-seconds 86400 \
  --query accessSAS -o tsv)

azcopy copy "$VHD" "$SAS" --blob-type PageBlob

az disk revoke-access -g $RG -n soctalk-demo
```

The `azcopy` step is the only long one; with zero-page skipping it moves only the real data (~3 GB).

## 4. Create an image from the disk

```bash
DISK_ID=$(az disk show -g $RG -n soctalk-demo --query id -o tsv)

az image create -g $RG -n soctalk-demo-image \
  --source $DISK_ID --os-type Linux --hyper-v-generation V1
```

## 5. Boot a VM

Scope the network security group to your own IP — the box exposes SSH (22), the SocTalk UI (443), and the setup wizard (8443), none of which should be open to the internet:

```bash
MYIP=$(curl -s https://ifconfig.me)

az network nsg create -g $RG -n soctalk-nsg
i=100
for port in 22 443 8443; do
  az network nsg rule create -g $RG --nsg-name soctalk-nsg \
    -n allow-$port --priority $i --access Allow --protocol Tcp \
    --direction Inbound --source-address-prefixes $MYIP/32 \
    --destination-port-ranges $port
  i=$((i+10))
done

az vm create -g $RG -n soctalk-demo-vm \
  --image soctalk-demo-image \
  --size Standard_D4s_v3 \
  --admin-username ops \
  --ssh-key-values ~/.ssh/id_ed25519.pub \
  --nsg soctalk-nsg \
  --public-ip-sku Standard

IP=$(az vm show -g $RG -n soctalk-demo-vm -d --query publicIps -o tsv)
echo "VM is at $IP"
```

`Standard_D4s_v3` (4 vCPU / 16 GiB) comfortably covers the [minimum sizing](/reference/sizing) of 4 vCPU / 8 GB. Anything smaller will struggle once the demo tenant's Wazuh stack starts.

::: tip No seed ISO needed
On hypervisors you attach a NoCloud `seed.iso` to inject an SSH key ([Quickstart](/quickstart-vm#optional-cloud-init-seed)). On Azure that step disappears: the image's cloud-init picks up the Azure datasource and provisions `--admin-username` / `--ssh-key-values` automatically.
:::

## 6. Get the setup token and run the wizard

Same flow as any other hypervisor from here. Give the VM ~2 minutes after boot for the wizard service to come up, then:

```bash
ssh ops@$IP sudo cat /var/log/soctalk-setup-token
```

Browse to `https://<IP>:8443/`, accept the self-signed certificate, paste the token, and fill in the wizard — MSSP name, admin credentials, LLM provider + API key. See [Setup wizard](/setup-wizard) for the field reference.

After submit, the first-boot installer runs `helm install` and onboards the `demo` tenant — about 2 minutes for the `soctalk-system` pods, then another few minutes for the demo tenant's Wazuh stack. You can watch from SSH:

```bash
ssh ops@$IP
journalctl -u soctalk-firstboot -f
sudo kubectl --kubeconfig /etc/rancher/k3s/k3s.yaml get pods -A
```

## 7. Sign in

Browse to `https://<IP>/` (port 443, not 8443) and sign in with the admin credentials from the wizard. If you left the hostname blank in the wizard, map `soctalk.local` to the VM IP in `/etc/hosts` and use `https://soctalk.local/`. Continue with the [MSSP UI Tour](/mssp-ui).

## 8. Tear down

Everything was created inside the resource group, so:

```bash
az group delete -n $RG --yes --no-wait
```

This removes the VM, NIC, public IP, NSG, managed disk, and image in one shot. Nothing else is left billing.

## Troubleshooting

| Symptom | Check |
|---|---|
| `az disk create --for-upload` rejected | `--upload-size-bytes` must be the **exact** file size in bytes of the decompressed `.vhd`, footer included — re-run the `stat` command |
| `azcopy` fails with 403 | The write SAS expired (24 h in the example) or was already revoked — re-run `az disk grant-access` |
| VM never gets the SSH key | Confirm the image and disk were created with `--hyper-v-generation V1`; a V2 image from this VHD will not boot, and a failed boot never reaches cloud-init |
| Wizard URL never loads | NSG rule for 8443 missing or your public IP changed (`curl ifconfig.me` and compare); then `systemctl status soctalk-setup-wizard` over SSH |
| Anything past the wizard | Same as every platform — see the [Quickstart troubleshooting table](/quickstart-vm#troubleshooting) |
