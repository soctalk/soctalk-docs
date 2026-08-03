#!/usr/bin/env bash
# Boot the deployed Proxmox VM (disk only, SATA bus matching the install).
# `reset` reverts to the clean snapshot first — undoes a whole onboarding.
set -euo pipefail
WORK="$HOME/proxmox-film"; DISK="$WORK/pve.qcow2"; PIDF="$WORK/pve.pid"
[ "${1:-}" = "reset" ] && { echo "reverting to clean snapshot"; qemu-img snapshot -a clean "$DISK"; }
qemu-system-x86_64 -enable-kvm -machine q35 -cpu host -m 24576 -smp 10 \
  -device ich9-ahci,id=ahci \
  -drive file="$DISK",if=none,id=hd0,format=qcow2 -device ide-hd,drive=hd0,bus=ahci.0 \
  -netdev user,id=n0,hostfwd=tcp:0.0.0.0:8006-:8006,hostfwd=tcp:0.0.0.0:2223-:22 \
  -device virtio-net-pci,netdev=n0 \
  -display none -serial file:"$WORK/pve-serial-boot.log" -daemonize -pidfile "$PIDF"
echo "Proxmox booting (disk) — API :8006, ssh -p 2223 root@<nuc>"
