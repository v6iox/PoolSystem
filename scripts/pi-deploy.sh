#!/usr/bin/env bash
#
# Push this working tree to the Pi and provision it.
#
#   scripts/pi-deploy.sh [ssh-host]        # default host: moonpool
#
# Use this instead of install.sh when you want the code you have locally
# rather than the latest published release.
set -euo pipefail

HOST="${1:-moonpool}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '\n\033[38;5;37m◆\033[0m \033[1m%s\033[0m\n' "$*"; }

say "Copying working tree to $HOST:~/moonpool"
ssh "$HOST" 'mkdir -p ~/moonpool'
rsync -az --delete \
  --exclude node_modules --exclude .next --exclude .git --exclude data \
  --exclude '*.log' --exclude '.moonpool-dev.*' --exclude .env.local \
  --exclude .DS_Store --exclude tsconfig.tsbuildinfo \
  "$HERE/" "$HOST:~/moonpool/"

say "Writing .env if absent"
if ssh "$HOST" 'test -f ~/moonpool/.env'; then
  echo "  .env already exists — leaving it alone"
else
  # Composed locally and copied over: a heredoc nested inside a quoted ssh
  # command does not survive the outer shell's parsing.
  SECRET=$(openssl rand -hex 32)
  TZ_PI=$(ssh "$HOST" 'cat /etc/timezone 2>/dev/null || echo America/Chicago')
  TMP=$(mktemp)
  cat > "$TMP" <<EOF
# Set MOCK_MODE=true to run against the built-in simulator instead of a panel.
MOCK_MODE=false
NJSPC_URL=http://njspc:4200
DATABASE_PATH=/data/moonpool.db
AUTH_SECRET=$SECRET

# Copilot brain. COPILOT_FORCE_MOCK is the switch that matters: it selects the
# deterministic parser — instant, no model, no memory cost. MOCK_MODE only
# controls the POOL adapter, so without this the copilot would still try to
# reach an LLM that isn't running here and every request would error.
COPILOT_FORCE_MOCK=true
COPILOT_FORCE_LLM=false
# Unused while COPILOT_FORCE_MOCK=true. To switch to a real model, set
# COPILOT_FORCE_MOCK=false and point this at a machine that can run one
# (a 2 GB Pi cannot — see docs/SETUP.md "Running on 2 GB").
COPILOT_BASE_URL=http://ollama:11434/v1
COPILOT_MODEL=qwen3:1.7b
COPILOT_CONTEXT_TOKENS=4096

# Schedules resolve in local time — this must match the Pi timezone.
TZ=$TZ_PI
# Drives sunrise/sunset automations, freeze warnings and the water estimate.
POOL_LATITUDE=${POOL_LATITUDE:-39.74}
POOL_LONGITUDE=${POOL_LONGITUDE:--104.99}
TEMPEST_UDP=false
TUNNEL_TOKEN=
EOF
  scp -q "$TMP" "$HOST:~/moonpool/.env"
  rm -f "$TMP"
  echo "  wrote ~/moonpool/.env (TZ=$TZ_PI)"
fi

say "Provisioning"
ssh "$HOST" 'bash ~/moonpool/scripts/pi-setup.sh'
