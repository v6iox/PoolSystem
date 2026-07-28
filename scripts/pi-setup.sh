#!/usr/bin/env bash
#
# Provision a Raspberry Pi for Moonpool, from a fresh Raspberry Pi OS image.
#
#   scp scripts/pi-setup.sh moonpool:/tmp/ && ssh moonpool 'bash /tmp/pi-setup.sh'
#
# Idempotent — safe to re-run. Assumes the working tree has already been
# rsync'd to ~/moonpool (see scripts/pi-deploy.sh).
#
# Two things this deliberately does NOT do, both learned the hard way on a
# 2 GB Pi 4:
#
#   1. It keeps a MODEST permanent swapfile (2 GB) rather than creating a big
#      one for the build and deleting it. Deleting it was the wrong lesson:
#      `next build` needs more than 2 GB of RAM, so any later rebuild on a
#      swapless Pi takes the whole machine down — which is exactly what
#      happened. Runtime thrash was only ever dangerous because Ollama was
#      resident; with no model, 2 GB of swap is cheap insurance that makes
#      rebuilds survivable. Keep it modest so the kernel OOM-kills a runaway
#      process instead of thrashing the SD card to death.
#   2. It does not start Ollama. A 2 GB Pi cannot run the local model and the
#      pool controller together: the model is 798 MB resident and a single
#      request took ~46 s before the box ran out of memory entirely. The
#      copilot runs on the deterministic parser instead — instant, no model.
#      Set COPILOT_FORCE_LLM=true and point COPILOT_BASE_URL at a real machine
#      if you want the LLM.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
export PATH=$PATH:/usr/sbin:/sbin

DIR="${MOONPOOL_DIR:-$HOME/moonpool}"
SWAPFILE=/swapfile

say() { printf '\n\033[38;5;37m◆\033[0m \033[1m%s\033[0m\n' "$*"; }

say "Docker"
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
sudo docker --version

say "Serial adapter"
if [ -e /dev/ttyUSB0 ]; then
  GID=$(stat -c %g /dev/ttyUSB0)
  echo "  /dev/ttyUSB0 present, group id $GID"
  grep -q "^SERIAL_GROUP_ID=" "$DIR/.env" 2>/dev/null || echo "SERIAL_GROUP_ID=$GID" >> "$DIR/.env"
else
  echo "  no /dev/ttyUSB0 — plug in the RS-485 adapter, or run with MOCK_MODE=true"
fi

say "Swap (2 GB, permanent — a rebuild without it takes the whole Pi down)"
if [ ! -f "$SWAPFILE" ]; then
  sudo fallocate -l 2G "$SWAPFILE"
  sudo chmod 600 "$SWAPFILE"
  sudo mkswap "$SWAPFILE" >/dev/null
fi
sudo swapon "$SWAPFILE" 2>/dev/null || true
grep -q "^$SWAPFILE " /etc/fstab || echo "$SWAPFILE none swap sw,pri=10 0 0" | sudo tee -a /etc/fstab >/dev/null
free -h | head -2

say "Building images (several minutes on a Pi)"
cd "$DIR"
sudo docker compose build njspc web

say "Starting pool control (njsPC + Moonpool — no Ollama)"
sudo docker compose up -d njspc web
sleep 15
sudo docker compose ps --format "table {{.Service}}\t{{.Status}}"

say "Panel"
sudo docker compose logs njspc 2>&1 | grep -iE "detected|controller type|error opening" | tail -5 || true

cat <<EOF

  Moonpool is at  http://$(hostname).local:3000  (or http://$(hostname -I | awk '{print $1}'):3000)
  Open it to create the owner account.

  Logs:  cd $DIR && sudo docker compose logs -f web njspc
EOF
