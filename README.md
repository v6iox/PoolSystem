# Moonpool

**Self-hosted pool control. Everything on your Pi. Nothing in anyone's cloud.**

Moonpool is a full replacement for Pentair ScreenLogic: a fast, beautiful, phone-first
web app that fronts [nodejs-poolController](https://github.com/tagyoureit/nodejs-poolController)
(njsPC) with authentication, roles, automations, history, alerts and a local AI copilot.
State, users, history, chat threads — all of it lives in a single SQLite file on the
Raspberry Pi. The only external calls are keyless weather (Open-Meteo) and, optionally,
a cloud LLM if you swap the copilot backend.

- **Night-swim UI** — deep teal-navy darks, glassy panels, water-caustics shimmer, a
  liquid-fill temperature dial that ripples while the heater runs.
- **Real-time & optimistic** — server-side Socket.IO bridge to njsPC, SSE to every
  signed-in browser, optimistic controls with automatic rollback.
- **Safe by construction** — the browser never talks to njsPC (which has no auth).
  Every write goes through one validated, role-checked, audited control layer.
- **Roles** — Owner / Family / Guest, with per-circuit and per-scene guest visibility.
- **Automations** — time, cron, sunrise/sunset offsets, temperature thresholds, salt-low,
  freeze protect, controller events. Schedules, scenes, one-shot jobs and the copilot all
  ride the same engine.
- **Pool Copilot** — natural-language control through a small local LLM (Ollama on the
  Pi). The model only emits structured tool calls; the app validates, asks you to
  confirm, executes through the audited control layer, and templates the reply.
- **PWA** — install to your phone's home screen, get push alerts, see last-known state
  offline.
- **MOCK_MODE** — the entire app runs against a built-in pool simulator. Zero hardware.

---

## Contents

1. [Architecture](#architecture)
2. [Quick start (no hardware)](#quick-start-no-hardware)
3. [Hardware & wiring](#hardware--wiring)
4. [Deploying on the Raspberry Pi](#deploying-on-the-raspberry-pi)
5. [Remote access from anywhere — no VPN](#remote-access-from-anywhere--no-vpn)
6. [The Pool Copilot](#the-pool-copilot)
7. [Environment reference](#environment-reference)
8. [Storage & backups](#storage--backups)
9. [Integration testing against the real Pi](#integration-testing-against-the-real-pi)
10. [Decommissioning ScreenLogic](#decommissioning-screenlogic)
11. [Troubleshooting](#troubleshooting)

---

## Architecture

```
                    ┌─────────────────────────── Raspberry Pi 5 ───────────────────────────┐
                    │                                                                      │
 Pentair panel ──RS-485──▶ USB adapter ──▶ njsPC (no auth, internal only)                  │
                    │                          ▲ REST + Socket.IO                          │
                    │                          │                                           │
  Phone / laptop ◀──HTTPS──▶ Moonpool (Next.js)│                                           │
        ▲           │        ├─ session auth (scrypt + SQLite sessions)                    │
        │           │        ├─ validated control layer ─ audit log                        │
   Cloudflare       │        ├─ SSE state bridge (role-filtered)                           │
   Tunnel /         │        ├─ automations worker (cron·sun·thresholds·events)            │
   Tailscale        │        ├─ history sampler + rollups   ┌────────────┐                 │
   Funnel           │        ├─ web-push alerts             │ SQLite     │  ◀── everything │
                    │        └─ copilot engine ──▶ Ollama   │ moonpool.db│      lives here │
                    │                             (local)   └────────────┘                 │
                    └──────────────────────────────────────────────────────────────────────┘
```

Design decisions worth knowing:

- **No external database.** Supabase/Postgres was deliberately dropped in favor of
  SQLite (`better-sqlite3`, WAL mode) so the whole system is one file on the Pi.
  The schema (`src/server/db/schema.sql`) is idempotent and applied at boot — that
  file *is* the migration.
- **Browser realtime is SSE, not a client Socket.IO connection.** The server holds the
  single Socket.IO connection to njsPC and fans role-filtered snapshots out over SSE.
  Same UX, simpler and safer surface.
- **One action vocabulary.** Scenes, automations, schedules, the copilot and every
  button in the UI produce the same typed `PoolAction`s, executed by the same
  validation + audit code path (`src/server/control.ts`).
- **Equipment is discovered, never hardcoded.** The UI renders whatever bodies,
  circuits, pumps, chlorinators, light groups and chem controllers njsPC reports.

## Quick start (no hardware)

Requires Node 22+.

```bash
npm install
cp .env.example .env.local        # defaults are fine: MOCK_MODE=true
npm run dev
```

Open http://localhost:3000 — you'll be walked through creating the Owner account.
The simulator gives you a pool + spa, 8 circuits, an IntelliFlo VS pump, an
IntelliChlor, IntelliBrite lights, schedules, and temperatures that drift and heat
realistically (accelerated so demos are watchable). The copilot works too, via a
deterministic parser — no Ollama needed in mock mode.

```bash
npm run typecheck   # strict TS, no `any`
npm test            # includes the 30-utterance copilot eval
```

## Hardware & wiring

- Pentair EasyTouch/IntelliTouch panel outdoors; its RS-485 bus is carried inside by
  Pentair's wireless link kit. The indoor transceiver sits on your network shelf.
- A Raspberry Pi 5 (8 GB) taps the bus with a USB RS-485 adapter (typically shows up
  as `/dev/ttyUSB0`).
- njsPC on the Pi speaks the Pentair protocol. Moonpool talks only to njsPC.

Confirm the adapter on the Pi: `ls -l /dev/ttyUSB*`. If yours enumerates differently,
adjust the `devices:` mapping in `docker-compose.yml`.

## Deploying on the Raspberry Pi

### 1. Flash the Pi

1. Use [Raspberry Pi Imager](https://www.raspberrypi.com/software/): **Raspberry Pi OS
   Lite (64-bit)**.
2. In the Imager's gear menu set hostname (`moonpool.local`), enable SSH, set a user,
   and configure Wi-Fi if you're not wiring Ethernet (wired is better on a network shelf).
3. Boot, then `ssh pi@moonpool.local`.

### 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker
```

### 3. Bring up Moonpool

```bash
git clone <this-repo> moonpool && cd moonpool
cp .env.example .env
nano .env      # set AUTH_SECRET (openssl rand -hex 32), TZ, POOL_LATITUDE/LONGITUDE,
               # and MOCK_MODE=false
docker compose up -d --build
docker compose exec ollama ollama pull qwen3:1.7b   # one-time copilot model download
```

First boot of njsPC: open its config (`docker compose logs njspc`) and confirm it found
`/dev/ttyUSB0` and your panel type. Then open `http://moonpool.local:3000`, create the
Owner account, and invite the family from **Settings → Users** (accounts are local —
you set their passwords, no invite emails).

njsPC and Ollama are intentionally **not** published on any host port — only Moonpool
(`:3000`) is reachable, and it authenticates every request.

## Remote access from anywhere — no VPN

You asked for the app to work away from home without VPNing in. Two good options —
both give you a real HTTPS URL, which is also what makes **push notifications and PWA
install** work.

### Option A (recommended): Cloudflare Tunnel

Outbound-only tunnel from the Pi. No port forwarding, no exposed home IP, free.

1. Add your domain to Cloudflare (free plan), then in **Zero Trust → Networks →
   Tunnels** create a tunnel, choose Docker, and copy the token.
2. On the Pi: add `TUNNEL_TOKEN=...` to `.env`, then
   `docker compose --profile remote up -d`.
3. In the tunnel's **Public hostname** tab route `pool.yourdomain.com` →
   `http://web:3000`.
4. Install the PWA from that URL on your phone (Share → Add to Home Screen). Done —
   works on any network, no VPN app.

Moonpool's own login + rate limiting front everything; for belt-and-braces you can add
a Cloudflare Access policy (e.g. email OTP) in front of the hostname.

### Option B: Tailscale Funnel (no domain needed)

```bash
sudo apt install tailscale && sudo tailscale up
sudo tailscale funnel --bg 3000
```

You get `https://moonpool.<tailnet>.ts.net` reachable from the public internet —
**only the Pi runs Tailscale; your phone doesn't need the app or a VPN profile.**
(Plain `tailscale serve` restricts it to devices in your tailnet instead, if you ever
want the tighter posture.)

## Tempest weather station

Have a WeatherFlow Tempest? Moonpool uses it, local-first:

- The hub broadcasts observations on **UDP :50222** on your LAN — Moonpool just
  listens (`TEMPEST_UDP=true`, the default). No API key, no cloud, nothing leaves
  the house.
- **Measured rainfall** replaces Open-Meteo's modeled precip in the water-level
  estimator — "did it actually rain into the pool" becomes ground truth.
- **Real wind/gusts, humidity, UV** feed the weather widget and the heat
  advisories ("It's blowing 24 mph at the pool — the spa will lose heat fast").
- **Lightning alerts**: a detected strike within ~15 mi sends a push —
  *"Time to get out of the pool"* — with a 30-minute cooldown.

Docker note: LAN UDP broadcasts often don't cross Docker's bridge network. The
compose file maps `50222/udp`, but if observations never arrive you have two
easy fixes: set the REST fallback (`TEMPEST_TOKEN` + `TEMPEST_STATION_ID`, token
from tempestwx.com → Settings → Data Authorizations — polls every 5 min), or run
the `web` service with `network_mode: host` (then set
`NJSPC_URL=http://localhost:4200`). Forecasts (rain windows, ET₀ for
evaporation) still come from Open-Meteo either way — the Tempest supplies
ground truth for *now*, Open-Meteo supplies *later*.

## The Pool Copilot

A chat tab where anyone types things like:

> "start heating and turn off around midnight" · "what's the salt at?" ·
> "lights blue at sunset every Friday" · "spa night at 8 but kill the waterfall"

How it stays safe and fast on a Pi:

1. The server sends your message + a compact live pool-state summary + tool schemas to
   the model (`COPILOT_BASE_URL`, OpenAI-compatible; default `qwen3:1.7b` via Ollama).
2. Structured outputs (JSON schema) mean the model **can only** return tool calls —
   malformed output is impossible.
3. Every argument is validated: setpoints bounds-checked (60–104 °F), circuits
   whitelisted against the live system, role-checked (Guests only get guest-permitted
   tools). Execution goes through the same audited control layer as the UI.
4. **Confirmation-first**: state-changing plans render as a card ("Heater ON now →
   OFF at 12:00 AM") with Confirm/Cancel. Read-only questions answer instantly.
5. Replies are template-generated from executed results — the model only parses
   intent, so responses are instant even at ~5–10 tok/s.
6. Everything lands in the audit log as `copilot`.

### Choosing the copilot's brain

**Settings → Voice & AI** (Owner) switches between three backends live — no env
changes, no restart:

1. **Local (Ollama)** — default. Private, free, runs on the Pi.
2. **OpenAI API key** — the official API (`gpt-4o-mini` by default) with strict
   structured outputs. The key is stored only in the Pi's SQLite.
3. **Sign in with ChatGPT** — OpenClaw/Codex-style OAuth (PKCE against
   `auth.openai.com`) that runs the copilot on your ChatGPT Plus/Pro
   subscription instead of API billing. Click *Sign in with ChatGPT*, finish
   the login, then paste back the `localhost:1455` URL you land on (that page
   can't load — Moonpool just needs the code in it). Tokens stay on the Pi and
   refresh automatically. ⚠ This rides an unofficial backend; if OpenAI
   changes it, flip to an API key.

Whichever brain is active, nothing changes about safety: the model only parses
intent into tool calls, every argument is validated and role-checked, plans
confirm before touching equipment, and it all lands in the audit log.

You can also stay env-only (e.g. Claude via an OpenAI-compatible gateway): set
`COPILOT_BASE_URL`, `COPILOT_MODEL`, `COPILOT_API_KEY`. In `MOCK_MODE` a
deterministic parser stands in for the LLM so chat is fully testable offline —
that's also what CI runs (`tests/copilot-eval.test.ts`, 30 utterances → expected
tool calls; set `COPILOT_LIVE=true` to run the same table against live Ollama).

## Voice: Siri & Alexa

Both assistants ride the same copilot engine — same validation, same role
rules, same audit trail (`source: copilot`). Voice flows can't tap a Confirm
button, so plans are auto-confirmed and weather advisories are *spoken back*
("Heads up: rain is forecast tomorrow 3 to 4 PM…"). Set up lives in
**Settings → Voice · Siri & Alexa** (Owner only).

**Siri (no developer account needed)** — mint a voice token, then build a
Shortcut: *Dictate text* → *Get contents of URL*
(`https://<your-url>/api/integrations/siri?token=…&q=<dictated>`) → *Speak
text*. Name it "Pool" and say "Hey Siri, Pool — warm the spa". Single-purpose
shortcuts ("Spa Time") can hard-code the `q` parameter.

**Alexa (free developer console skill)** — create a Custom skill, paste the
interaction model JSON from the settings page (invocation "moonpool"), point
the endpoint at `https://<your-url>/api/integrations/alexa`, and save the
Skill ID in Moonpool. Requests are authenticated with Amazon's certificate
signature + your skill ID + timestamp checks. Then: *"Alexa, ask moonpool
what the spa temperature is."*

Both need the public HTTPS URL from [Remote access](#remote-access-from-anywhere--no-vpn).

## Environment reference

| Variable | Default | Purpose |
| --- | --- | --- |
| `NJSPC_URL` | `http://njspc:4200` | nodejs-poolController base URL (LAN IP when developing against the real Pi) |
| `MOCK_MODE` | `true` in `.env.example` | Run the built-in simulator instead of njsPC |
| `DATABASE_PATH` | `./data/moonpool.db` (`/data/moonpool.db` in Docker) | The one SQLite file everything lives in |
| `AUTH_SECRET` | — | Session cookie signing secret (`openssl rand -hex 32`) |
| `COPILOT_BASE_URL` | `http://ollama:11434/v1` | OpenAI-compatible LLM endpoint |
| `COPILOT_MODEL` | `qwen3:1.7b` | Copilot model |
| `COPILOT_API_KEY` | empty | Only for cloud backends |
| `POOL_LATITUDE` / `POOL_LONGITUDE` | Denver | Weather + sunrise/sunset automations |
| `TZ` | `America/Denver` | Schedules, rollups, cron |

## Storage & backups

Everything is one file. Back it up like one:

```bash
docker compose exec web sh -c 'sqlite3 /data/moonpool.db ".backup /data/backup.db"' \
  && docker cp $(docker compose ps -q web):/data/backup.db ./moonpool-backup-$(date +%F).db
```

(Or just stop the stack and copy the `moonpool-data` volume.) History samples are
pruned at 90 days; daily rollups are kept forever and stay tiny.

## Integration testing against the real Pi

Develop on your Mac, point at real hardware:

```bash
MOCK_MODE=false NJSPC_URL=http://<pi-ip>:4200 npm run dev
```

You get real equipment discovery and real control (careful — those are your actual
valves and heater). Everything else (auth, history, automations) still uses your local
dev SQLite.

## Decommissioning ScreenLogic

RS-485 is a multi-drop bus: the old ScreenLogic adapter can stay wired during the
transition — njsPC and ScreenLogic coexist fine on the bus. Run Moonpool in parallel
until you trust it, then simply unplug the ScreenLogic adapter (or leave it as a
break-glass spare). No panel reprogramming needed.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Red "controller unreachable" banner | `docker compose logs njspc` — usually the USB adapter moved (`/dev/ttyUSB1`) or the panel link is down. Moonpool reconnects automatically with backoff. |
| Copilot says backend unreachable | `docker compose exec ollama ollama list` — pull the model; first request after idle loads the model (keep-alive is set to 24 h). |
| Push notifications do nothing | They require HTTPS (see Remote access) and a granted browser permission. Re-enable in Settings → Notifications. |
| `EACCES /dev/ttyUSB0` in njsPC | `sudo usermod -aG dialout $USER` on the host, or keep the compose `devices:` mapping (preferred). |
| Forgot the owner password | `docker compose exec web node -e "..."` is not needed — delete the row: `sqlite3 /data/moonpool.db "DELETE FROM users"` then reload to re-run first-time setup (this wipes accounts only, not history). |

---

**Stack**: Next.js 15 (App Router, strict TS) · Tailwind v4 · Motion · dnd-kit ·
Recharts · TanStack Query · Zustand · better-sqlite3 · socket.io-client · node-cron ·
suncalc · web-push · Ollama. Design direction: *night swim*.
