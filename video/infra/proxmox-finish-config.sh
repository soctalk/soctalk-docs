#!/usr/bin/env bash
# Finish Proxmox config after a successful base install: rebuild the cloud-init
# template on local-lvm (VM disks can't live on `local`), enable snippets, then
# power off and snapshot a clean baseline. Runs ON the NUC; talks to the guest
# over the 2223 forward. Idempotent.
set -uo pipefail
WORK="$HOME/proxmox-film"; DISK="$WORK/pve.qcow2"
ROOTPW="${PVE_ROOTPW:?set PVE_ROOTPW (see video/.env)}"
GSSH="sshpass -p $ROOTPW ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -p 2223 root@127.0.0.1"
log(){ echo "[$(date +%H:%M:%S)] $*"; }

pkill -f deploy-proxmox-nuc 2>/dev/null || true
log "waiting for guest ssh"
for i in $(seq 1 30); do $GSSH true 2>/dev/null && break; sleep 5; done

log "rebuilding template 9000 on local-lvm + snippets"
$GSSH bash -s <<'REMOTE'
set -e
pvesm set local --content iso,vztmpl,backup,snippets
mkdir -p /var/lib/vz/snippets
qm stop 9000 2>/dev/null || true
qm destroy 9000 --purge 2>/dev/null || true
[ -f /tmp/noble.img ] || curl -fSL -o /tmp/noble.img https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
qm create 9000 --name noble-cloudinit --memory 2048 --cores 2 --net0 virtio,bridge=vmbr0 --cpu host --scsihw virtio-scsi-pci
qm importdisk 9000 /tmp/noble.img local-lvm
qm set 9000 --scsi0 local-lvm:vm-9000-disk-0 --ide2 local-lvm:cloudinit --boot order=scsi0 --serial0 socket --vga serial0 --agent enabled=1
qm template 9000
echo "=== template built ==="; qm config 9000 | grep -E "scsi0|ide2|template"
pvesm status | awk '{print $1,$2,$3}'
REMOTE
rc=$?
[ $rc -ne 0 ] && { log "guest config FAILED rc=$rc"; exit 1; }

log "powering off guest for snapshot"
$GSSH 'poweroff' 2>/dev/null || true
for i in $(seq 1 30); do pgrep -f "qemu.*pve.qcow2" >/dev/null || break; sleep 3; done
sudo pkill -f "qemu.*pve.qcow2" 2>/dev/null || true; sleep 3
qemu-img snapshot -c clean "$DISK"
log "DONE — clean snapshot:"; qemu-img snapshot -l "$DISK"
