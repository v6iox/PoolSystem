#!/usr/bin/env bash
#
# Moonpool installer — self-hosted pool control.
#
#   curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
#
# Interactive (arrow-key menus) when a terminal is available; sensible
# defaults otherwise. Re-run any time — it's idempotent. Also:
#
#   install.sh --update      pull latest + rebuild
#   install.sh --uninstall   stop containers (data volumes are kept)
#   install.sh --help
#
set -euo pipefail

REPO_URL="${MOONPOOL_REPO:-https://github.com/v6iox/poolsystem}"
INSTALL_DIR="${MOONPOOL_DIR:-$HOME/moonpool}"

# ── pretty ────────────────────────────────────────────────────────
if [[ -t 2 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; CYAN=$'\033[38;5;80m'; TEAL=$'\033[38;5;37m'
  GREEN=$'\033[38;5;114m'; YELLOW=$'\033[38;5;179m'; RED=$'\033[38;5;174m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; CYAN=""; TEAL=""; GREEN=""; YELLOW=""; RED=""; RESET=""
fi

say()  { printf '%b\n' "$*" >&2; }
step() { say "\n${TEAL}◆${RESET} ${BOLD}$*${RESET}"; }
ok()   { say "  ${GREEN}✓${RESET} $*"; }
warn() { say "  ${YELLOW}!${RESET} $*"; }
die()  { say "\n${RED}✗ $*${RESET}"; exit 1; }

banner() {
  say ""
  say "${CYAN}       ○${RESET}"
  say "${CYAN}   ~~~~~~~~~~   ${BOLD}moonpool${RESET}"
  say "${CYAN}  ~~~~~~~~~~~~${RESET}  ${DIM}self-hosted pool control — night swim edition${RESET}"
  say ""
}

# ── input plumbing (works under `curl | bash` by reading /dev/tty) ─
TTY=/dev/tty
INTERACTIVE=1
if [[ ! -r $TTY || ! -w $TTY ]]; then
  INTERACTIVE=0
fi

ask() { # ask "prompt" "default" -> REPLY_VALUE
  local prompt="$1" default="${2-}"
  if [[ $INTERACTIVE -eq 0 ]]; then REPLY_VALUE="$default"; return; fi
  local suffix=""
  [[ -n "$default" ]] && suffix=" ${DIM}[$default]${RESET}"
  printf '  %b%s%b%b: ' "$BOLD" "$prompt" "$RESET" "$suffix" >"$TTY"
  IFS= read -r REPLY_VALUE <"$TTY" || REPLY_VALUE=""
  [[ -z "$REPLY_VALUE" ]] && REPLY_VALUE="$default"
}

confirm() { # confirm "prompt" [default_yes]
  local prompt="$1" default="${2:-y}" answer
  if [[ $INTERACTIVE -eq 0 ]]; then [[ $default == y ]]; return; fi
  local hint="[Y/n]"; [[ $default == n ]] && hint="[y/N]"
  printf '  %b%s%b %s ' "$BOLD" "$prompt" "$RESET" "$hint" >"$TTY"
  IFS= read -r answer <"$TTY" || answer=""
  answer="${answer:-$default}"
  [[ "$answer" =~ ^[Yy] ]]
}

CHOICE=0
CHOICE_TEXT=""
choose() { # choose "prompt" opt1 opt2 …  → CHOICE (0-based) + CHOICE_TEXT
  local prompt="$1"; shift
  local opts=("$@") idx=0 count=$# key rest
  if [[ $INTERACTIVE -eq 0 ]]; then CHOICE=0; CHOICE_TEXT="${opts[0]}"; return; fi
  printf '\n  %b%s%b %b(↑/↓ + enter, or 1-%d)%b\n' "$BOLD" "$prompt" "$RESET" "$DIM" "$count" "$RESET" >"$TTY"
  draw() {
    local i
    for i in "${!opts[@]}"; do
      if [[ $i -eq $idx ]]; then
        printf '   %b❯ %s%b\n' "$CYAN" "${opts[$i]}" "$RESET" >"$TTY"
      else
        printf '     %b%s%b\n' "$DIM" "${opts[$i]}" "$RESET" >"$TTY"
      fi
    done
  }
  draw
  while true; do
    IFS= read -rsn1 key <"$TTY" || key=""
    if [[ $key == $'\x1b' ]]; then
      IFS= read -rsn2 -t 0.1 rest <"$TTY" || rest=""
      key="$rest"
    fi
    case "$key" in
      '[A'|k) (( idx > 0 )) && (( idx-- )) || true ;;
      '[B'|j) (( idx < count - 1 )) && (( idx++ )) || true ;;
      "") break ;;
      [1-9]) if (( key >= 1 && key <= count )); then idx=$((key - 1)); break; fi ;;
      q) die "cancelled" ;;
      *) continue ;;
    esac
    printf '\033[%dA' "$count" >"$TTY"
    draw
  done
  CHOICE=$idx
  CHOICE_TEXT="${opts[$idx]}"
  printf '   %b→ %s%b\n' "$GREEN" "$CHOICE_TEXT" "$RESET" >"$TTY"
}

# ── helpers ───────────────────────────────────────────────────────
have() { command -v "$1" >/dev/null 2>&1; }

compose() {
  if docker compose version >/dev/null 2>&1; then docker compose "$@"; else docker-compose "$@"; fi
}

gen_secret() {
  if have openssl; then openssl rand -hex 32
  else head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

detect_tz() {
  if [[ -f /etc/timezone ]]; then cat /etc/timezone
  elif have timedatectl; then timedatectl show -p Timezone --value 2>/dev/null || true
  elif [[ -L /etc/localtime ]]; then readlink /etc/localtime | sed 's|.*/zoneinfo/||'
  fi
}

set_env() { # set_env KEY VALUE  (idempotent edit of .env)
  local key="$1" value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$key" "$value" >>.env
  fi
}

usage() {
  banner
  say "Usage: install.sh [--update | --uninstall | --mock | --dir <path> | --help]"
  say ""
  say "  (no flags)    interactive install / reconfigure"
  say "  --update      git pull + rebuild containers"
  say "  --uninstall   stop and remove containers (data volumes kept)"
  say "  --mock        non-interactive demo install (simulated pool)"
  say "  --dir <path>  install location (default ~/moonpool, or \$MOONPOOL_DIR)"
  exit 0
}

# ── flags ─────────────────────────────────────────────────────────
MODE_FLAG=""
ACTION="install"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --update) ACTION="update" ;;
    --uninstall) ACTION="uninstall" ;;
    --mock) MODE_FLAG="mock"; INTERACTIVE=0 ;;
    --dir) shift; INSTALL_DIR="${1:?--dir needs a path}" ;;
    --help|-h) usage ;;
    *) die "unknown flag: $1 (try --help)" ;;
  esac
  shift
done

banner

# ── update / uninstall shortcuts ──────────────────────────────────
if [[ $ACTION == "update" ]]; then
  [[ -d $INSTALL_DIR/.git ]] || die "no install found at $INSTALL_DIR (set MOONPOOL_DIR?)"
  cd "$INSTALL_DIR"
  step "Updating Moonpool in $INSTALL_DIR"
  git pull --ff-only
  step "Rebuilding containers"
  compose up -d --build
  ok "Updated. The database migrates itself on boot."
  exit 0
fi
if [[ $ACTION == "uninstall" ]]; then
  [[ -d $INSTALL_DIR ]] || die "no install found at $INSTALL_DIR"
  cd "$INSTALL_DIR"
  step "Stopping Moonpool"
  compose down
  ok "Containers removed. Your data volumes are untouched."
  say "  ${DIM}Full wipe (deletes ALL data): cd $INSTALL_DIR && docker compose down -v${RESET}"
  exit 0
fi

# ── preflight ─────────────────────────────────────────────────────
step "Checking prerequisites"
OS="$(uname -s)"
ARCH="$(uname -m)"
ok "Platform: $OS/$ARCH"
[[ $OS == "Darwin" ]] && warn "macOS detected — great for the demo, but real RS-485 control needs a Linux box (Docker Desktop can't pass USB serial through)."

have git || die "git is required. Install it (e.g. sudo apt install git) and re-run."

if ! have docker; then
  warn "Docker is not installed."
  if [[ $OS == "Linux" ]] && confirm "Install Docker now via get.docker.com?"; then
    curl -fsSL https://get.docker.com | sh
    if [[ $EUID -ne 0 ]] && have sudo; then
      sudo usermod -aG docker "$USER" || true
      warn "Added $USER to the docker group — if the next steps fail with permission errors, log out/in and re-run this installer."
    fi
  else
    die "Install Docker first (https://docs.docker.com/engine/install/), then re-run."
  fi
fi
docker info >/dev/null 2>&1 || die "Docker is installed but not running/accessible. Start it (or log out/in for group changes) and re-run."
ok "Docker is ready"

# ── fetch source ──────────────────────────────────────────────────
step "Fetching Moonpool → $INSTALL_DIR"
if [[ -d $INSTALL_DIR/.git ]]; then
  git -C "$INSTALL_DIR" pull --ff-only || warn "couldn't fast-forward; continuing with the existing checkout"
  ok "Existing install updated"
else
  git clone "$REPO_URL" "$INSTALL_DIR"
  ok "Cloned"
fi
cd "$INSTALL_DIR"
[[ -f .env ]] || cp .env.example .env

# ── configuration ────────────────────────────────────────────────
step "Configuration"

if [[ -n $MODE_FLAG ]]; then
  CHOICE=1
else
  choose "How should Moonpool run?" \
    "Real pool — RS-485 adapter connected to a Pentair panel" \
    "Demo — built-in simulated pool (no hardware, try everything)"
fi

if [[ $CHOICE -eq 1 ]]; then
  set_env MOCK_MODE true
  ok "Demo mode: full simulator, zero hardware"
else
  set_env MOCK_MODE false

  # Serial adapter picker (portable — no mapfile, works on old bash too)
  options=()
  paths=()
  for s in /dev/serial/by-id/*; do
    [[ -e $s ]] || continue
    real="$(readlink -f "$s")"
    label="$(basename "$s")"
    options+=("$real  ${label:0:56}")
    paths+=("$real")
  done
  if [[ ${#paths[@]} -eq 0 ]]; then
    for s in /dev/ttyUSB* /dev/ttyACM*; do
      [[ -e $s ]] || continue
      options+=("$s")
      paths+=("$s")
    done
  fi
  options+=("Enter a device path manually" "Not plugged in yet — assume /dev/ttyUSB0")
  choose "Which serial device is the RS-485 adapter?" "${options[@]}"
  n=${#paths[@]}
  if [[ $CHOICE -lt $n ]]; then
    SERIAL="${paths[$CHOICE]}"
  elif [[ $CHOICE -eq $n ]]; then
    ask "Device path" "/dev/ttyUSB0"; SERIAL="$REPLY_VALUE"
  else
    SERIAL="/dev/ttyUSB0"
  fi
  if [[ $SERIAL != "/dev/ttyUSB0" ]]; then
    cat >docker-compose.override.yml <<EOF
# Written by install.sh — maps your RS-485 adapter into the njsPC container.
services:
  njspc:
    devices:
      - "${SERIAL}:/dev/ttyUSB0"
EOF
    ok "Adapter $SERIAL mapped into njsPC"
  else
    rm -f docker-compose.override.yml
    ok "Using /dev/ttyUSB0"
  fi
fi

# Secret
if grep -q "^AUTH_SECRET=change-me" .env || ! grep -q "^AUTH_SECRET=..*" .env; then
  set_env AUTH_SECRET "$(gen_secret)"
  ok "Generated session secret"
fi

# Timezone
tz_default="$(detect_tz)"
ask "Timezone (schedules & rollups)" "${tz_default:-America/Denver}"
set_env TZ "$REPLY_VALUE"

# Location
say "  ${DIM}Location powers weather advisories, sunrise/sunset automations and the water-level estimator.${RESET}"
lat_current="$(sed -n 's/^POOL_LATITUDE=//p' .env | head -1)"
lon_current="$(sed -n 's/^POOL_LONGITUDE=//p' .env | head -1)"
ask "Latitude" "${lat_current:-39.74}"
set_env POOL_LATITUDE "$REPLY_VALUE"
ask "Longitude" "${lon_current:--104.99}"
set_env POOL_LONGITUDE "$REPLY_VALUE"

# Copilot brain
choose "Pool Copilot (AI) — how should it think?" \
  "Local model on this machine (Ollama, ~1.4 GB download, private)" \
  "Skip for now — pick OpenAI / ChatGPT later in Settings → Voice & AI"
PULL_MODEL=$(( CHOICE == 0 ? 1 : 0 ))

# Remote access
choose "Remote access (use it away from home, no VPN app)?" \
  "Later — home network only for now" \
  "Cloudflare Tunnel — I have a tunnel token ready" \
  "Tailscale Funnel — show me the commands after install"
REMOTE=$CHOICE
PROFILE_ARGS=()
if [[ $REMOTE -eq 1 ]]; then
  ask "Cloudflare tunnel token" ""
  [[ -n $REPLY_VALUE ]] && { set_env TUNNEL_TOKEN "$REPLY_VALUE"; PROFILE_ARGS=(--profile remote); ok "Tunnel configured"; } \
    || warn "No token entered — skipping the tunnel (re-run the installer to add it)"
fi

# ── build & launch ────────────────────────────────────────────────
step "Building & starting (first build on a Pi takes a while — coffee time)"
compose "${PROFILE_ARGS[@]}" up -d --build

if [[ $PULL_MODEL -eq 1 ]]; then
  step "Downloading the copilot model (qwen3:1.7b)"
  compose exec ollama ollama pull qwen3:1.7b || warn "Model pull failed — run later: docker compose exec ollama ollama pull qwen3:1.7b"
fi

# Put the `moonpool` command on PATH (start/stop/status/logs/update).
"$INSTALL_DIR/scripts/moonpool" link >/dev/null 2>&1 || true

step "Waiting for Moonpool to come up"
up=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/login 2>/dev/null || true)"
  if [[ $code == "200" ]]; then up=1; break; fi
  sleep 2
done
[[ $up -eq 1 ]] || warn "Not responding yet — check: docker compose logs web"

# ── done ──────────────────────────────────────────────────────────
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
HOST="$(hostname 2>/dev/null || echo moonpool)"
say ""
say "${GREEN}${BOLD}  ── Moonpool is in the water ──${RESET}"
say ""
say "  Open:        ${CYAN}http://${HOST}.local:3000${RESET}${IP:+  ${DIM}or${RESET}  ${CYAN}http://${IP}:3000${RESET}}"
say "  First visit creates the ${BOLD}Owner${RESET} account. Then:"
say "   ${DIM}·${RESET} Settings → System → ${BOLD}Detected equipment${RESET} — see what was found"
say "   ${DIM}·${RESET} Settings → Users — add family & guests"
say "   ${DIM}·${RESET} On phones: Share → ${BOLD}Add to Home Screen${RESET}"
if [[ $REMOTE -eq 2 ]]; then
  say ""
  say "  Tailscale Funnel (public HTTPS URL, phone needs nothing):"
  say "   ${CYAN}sudo apt install tailscale && sudo tailscale up && sudo tailscale funnel --bg 3000${RESET}"
fi
say ""
say "  Guide:       ${DIM}$INSTALL_DIR/docs/SETUP.md${RESET}"
say "  Logs:        ${DIM}cd $INSTALL_DIR && docker compose logs -f web njspc${RESET}"
say "  Update:      ${DIM}install.sh --update${RESET}   Reconfigure: ${DIM}re-run install.sh${RESET}"
say ""
