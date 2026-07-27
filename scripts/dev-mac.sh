#!/usr/bin/env bash
#
# Moonpool dev/test environment for a Mac (or any machine with Node 22+).
# No Docker, no hardware — runs the full app against the built-in simulator.
#
#   ./scripts/dev-mac.sh              # simulated pool at http://localhost:3000
#   ./scripts/dev-mac.sh --pi <ip>    # real equipment: talk to njsPC on your Pi over the LAN
#   ./scripts/dev-mac.sh --reset      # wipe the local dev database first
#
set -euo pipefail
cd "$(dirname "$0")/.."

PI_IP=""
RESET=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pi) shift; PI_IP="${1:?--pi needs the Pi IP address}" ;;
    --reset) RESET=1 ;;
    *) echo "unknown flag: $1 (use --pi <ip> or --reset)"; exit 1 ;;
  esac
  shift
done

# Node check
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. On a Mac: brew install node  (or https://nodejs.org)"
  exit 1
fi
major="$(node -p 'process.versions.node.split(".")[0]')"
if (( major < 20 )); then
  echo "Node $major is too old — install Node 20+ (brew install node)."
  exit 1
fi

# Dependencies
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies (first run only)…"
  npm install --no-audit --no-fund
fi

# Local env
if [[ ! -f .env.local ]]; then
  cp .env.example .env.local
  # Random dev secret so sessions survive restarts.
  secret="$(openssl rand -hex 32 2>/dev/null || echo dev-secret-$RANDOM$RANDOM)"
  printf 'AUTH_SECRET=%s\n' "$secret" >> .env.local
fi

# Mode: simulator (default) or real Pi over LAN
if [[ -n $PI_IP ]]; then
  sed -i.bak 's/^MOCK_MODE=.*/MOCK_MODE=false/' .env.local && rm -f .env.local.bak
  if grep -q '^NJSPC_URL=' .env.local; then
    sed -i.bak "s|^NJSPC_URL=.*|NJSPC_URL=http://${PI_IP}:4200|" .env.local && rm -f .env.local.bak
  else
    printf 'NJSPC_URL=http://%s:4200\n' "$PI_IP" >> .env.local
  fi
  echo "⚠  REAL EQUIPMENT MODE — controls will operate your actual pool via ${PI_IP}."
else
  sed -i.bak 's/^MOCK_MODE=.*/MOCK_MODE=true/' .env.local && rm -f .env.local.bak
  echo "Simulator mode — pool + spa, 10 circuits, drifting temps. Zero hardware touched."
fi

if [[ $RESET -eq 1 ]]; then
  rm -rf data
  echo "Dev database wiped — you'll get the first-run owner setup again."
fi

# Open the browser once the server answers, then hand over to next dev.
( for _ in $(seq 1 60); do
    if curl -s -o /dev/null http://localhost:3000/login 2>/dev/null; then
      command -v open >/dev/null && open http://localhost:3000
      break
    fi
    sleep 1
  done ) &

echo
echo "→ http://localhost:3000  (Ctrl-C to stop)"
echo "  Tip: the copilot uses a deterministic parser in simulator mode. For a real"
echo "  local LLM on your Mac: brew install ollama && ollama pull qwen3:1.7b, then"
echo "  in .env.local set COPILOT_BASE_URL=http://localhost:11434/v1 — or just sign"
echo "  into OpenAI/ChatGPT in Settings → Voice & AI (works in simulator mode too)."
echo
exec npm run dev
