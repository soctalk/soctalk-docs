#!/usr/bin/env bash
# Re-bake the `clean` snapshot of the nested Proxmox as the pre-onboarding
# film baseline: expects the guest already cleaned (no lp VMs). Powers the
# guest off, replaces the snapshot, boots it back up. Runs ON the NUC.
set -uo pipefail
WORK="$HOME/proxmox-film"; DISK="$WORK/pve.qcow2"
log(){ echo "[$(date +%H:%M:%S)] $*"; }

log "powering off guest"
sshpass -p "${PVE_ROOTPW:?set PVE_ROOTPW (see video/.env)}" ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=10 -p 2223 root@127.0.0.1 'poweroff' 2>/dev/null || true
for i in $(seq 1 40); do pgrep -f "qemu.*pve.qcow2" >/dev/null || break; sleep 3; done
pkill -9 -f "qemu.*pve.qcow2" 2>/dev/null || true; sleep 2

log "replacing clean snapshot"
qemu-img snapshot -d clean "$DISK" 2>/dev/null || true
qemu-img snapshot -c clean "$DISK"
qemu-img snapshot -l "$DISK"

log "booting guest back up"
bash "$HOME/proxmox-run.sh"
log "DONE-REBAKE"
