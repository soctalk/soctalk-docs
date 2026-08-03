#!/usr/bin/env bash
# Deploy Proxmox VE as a nested QEMU VM on the NUC, unattended, then configure
# it to satisfy the launchpad `proxmox-nuc` host profile and snapshot a clean
# baseline for per-take resets. Idempotent-ish; safe to re-run (skips cached
# downloads). Runs ON the NUC.
set -euo pipefail

WORK="$HOME/proxmox-film"
ISO_URL="http://download.proxmox.com/iso/proxmox-ve_8.4-1.iso"
ISO="$WORK/proxmox-ve_8.4-1.iso"
AUTOISO="$WORK/proxmox-ve-auto.iso"
DISK="$WORK/pve.qcow2"
PIDF="$WORK/pve.pid"
LOG="$WORK/pve-serial.log"
NOBLE_URL="https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
NOBLE="$WORK/noble.img"
ROOTPW="${PVE_ROOTPW:?set PVE_ROOTPW (see video/.env)}"   # throwaway lab pw, kept out of git
RAM=24576                        # 24G — hosts MSSP(8G)+tenant(8G)+overhead
CPUS=10
mkdir -p "$WORK"
cd "$WORK"

log(){ echo "[$(date +%H:%M:%S)] $*"; }

# --- 1. auto-install-assistant (scrape the .deb from the pve repo) ----------
if ! command -v proxmox-auto-install-assistant >/dev/null; then
  log "installing proxmox-auto-install-assistant"
  base="http://download.proxmox.com/debian/pve/dists/bookworm/pve-no-subscription/binary-amd64"
  deb=$(curl -s "$base/" | grep -oE 'proxmox-auto-install-assistant_[^"]+_amd64\.deb' | sort -u | tail -1)
  curl -fsSL -o /tmp/paia.deb "$base/$deb"
  sudo apt-get install -y /tmp/paia.deb || sudo dpkg -i /tmp/paia.deb
fi

# --- 2. Proxmox ISO --------------------------------------------------------
[ -f "$ISO" ] || { log "downloading Proxmox ISO"; curl -fSL -o "$ISO" "$ISO_URL"; }

# --- 3. answer file + auto-install ISO -------------------------------------
cat > "$WORK/answer.toml" <<EOF
[global]
keyboard = "en-us"
country = "us"
fqdn = "pve.film.lan"
mailto = "root@film.lan"
timezone = "UTC"
root_password = "$ROOTPW"

[network]
source = "from-dhcp"

[disk-setup]
filesystem = "ext4"
disk_list = ["sda"]
EOF
log "baking auto-install ISO"
proxmox-auto-install-assistant prepare-iso "$ISO" \
  --fetch-from iso --answer-file "$WORK/answer.toml" --output "$AUTOISO"

# --- 4. fresh disk + unattended install boot ------------------------------
[ -f "$DISK" ] && { log "removing old disk"; rm -f "$DISK"; }
qemu-img create -f qcow2 "$DISK" 250G
log "booting installer (unattended, ~10-15 min)"
qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -m "$RAM" -smp "$CPUS" \
  -device ich9-ahci,id=ahci \
  -drive file="$DISK",if=none,id=hd0,format=qcow2 -device ide-hd,drive=hd0,bus=ahci.0 \
  -drive file="$AUTOISO",if=none,id=cd0,media=cdrom -device ide-cd,drive=cd0,bus=ahci.1 \
  -boot once=d \
  -netdev user,id=n0,hostfwd=tcp:0.0.0.0:8006-:8006,hostfwd=tcp:0.0.0.0:2223-:22 \
  -device virtio-net-pci,netdev=n0 \
  -display none -serial file:"$LOG" -daemonize -pidfile "$PIDF"

# --- 5. wait for install → reboot → API up --------------------------------
log "waiting for Proxmox API on :8006 (installer runs then reboots)"
for i in $(seq 1 80); do
  sleep 20
  if curl -ks -o /dev/null -m 5 https://127.0.0.1:8006 ; then log "API up after ~$((i*20))s"; break; fi
  [ $i -eq 80 ] && { log "TIMEOUT waiting for API — check $LOG"; exit 1; }
done
# the installer's post-install reboot boots from disk; give sshd a moment
SSH="ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=8 -p 2223 root@127.0.0.1"
for i in $(seq 1 30); do sshpass -p "$ROOTPW" $SSH true 2>/dev/null && break; sleep 10; done

# --- 6. post-install config over ssh --------------------------------------
log "configuring Proxmox (snippets, cloud-init template 9000)"
sshpass -p "$ROOTPW" $SSH bash -s <<'REMOTE'
set -e
mkdir -p /var/lib/vz/snippets
pvesm set local --content backup,iso,vztmpl,snippets 2>/dev/null || true
# cloud-init template VM 9000 from Ubuntu Noble
if ! qm status 9000 >/dev/null 2>&1; then
  curl -fSL -o /tmp/noble.img https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
  qm create 9000 --name noble-cloudinit --memory 2048 --cores 2 --net0 virtio,bridge=vmbr0 --cpu host --scsihw virtio-scsi-pci
  qm importdisk 9000 /tmp/noble.img local-lvm
  qm set 9000 --scsi0 local-lvm:vm-9000-disk-0
  qm set 9000 --ide2 local-lvm:cloudinit --boot order=scsi0 --serial0 socket --vga serial0 --agent enabled=1
  qm template 9000
fi
pvesh get /version
REMOTE

# --- 7. shut down clean + snapshot baseline -------------------------------
log "snapshotting clean baseline"
sshpass -p "$ROOTPW" $SSH 'poweroff' 2>/dev/null || true
for i in $(seq 1 20); do [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null || break; sleep 3; done
qemu-img snapshot -c clean "$DISK"
log "DONE. 'clean' snapshot saved. Boot with: video/infra/proxmox-run.sh"
