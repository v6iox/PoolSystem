# Moonpool — Complete Setup Guide

From an empty SD card to controlling your pool from your phone anywhere in the
world. No prior Raspberry Pi or Docker experience assumed. Budget a weekend the
first time; most of it is waiting for downloads.

> **Safety first.** Moonpool drives real equipment — heaters, pumps, valves.
> Keep the Pentair panel's own safeties (high-limit switches, freeze protect)
> in place, run in parallel with your existing setup until you trust it, and
> never treat any software as a substitute for physical safety devices.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Try it with zero hardware](#2-try-it-with-zero-hardware)
3. [Prepare the Raspberry Pi](#3-prepare-the-raspberry-pi)
4. [Wire the RS-485 adapter](#4-wire-the-rs-485-adapter)
5. [Install Moonpool](#5-install-moonpool)
6. [First bring-up](#6-first-bring-up)
7. [Accounts & roles](#7-accounts--roles)
8. [Put it on your phone (PWA)](#8-put-it-on-your-phone-pwa)
9. [Remote access — no VPN app needed](#9-remote-access--no-vpn-app-needed)
10. [Push notifications](#10-push-notifications)
11. [The Copilot (local AI, OpenAI, or ChatGPT)](#11-the-copilot)
12. [Voice: Siri & Alexa](#12-voice-siri--alexa)
13. [Tempest weather station (optional)](#13-tempest-weather-station-optional)
14. [Make it yours](#14-make-it-yours)
15. [Backups & updates](#15-backups--updates)
16. [Living with ScreenLogic during the transition](#16-living-with-screenlogic-during-the-transition)
17. [Troubleshooting](#17-troubleshooting)

---

## 1. What you need

| Item | Notes | Rough cost |
| --- | --- | --- |
| Pentair EasyTouch or IntelliTouch panel | The outdoor control panel you already have | — |
| Raspberry Pi 4 or 5 (4 GB+ RAM, 8 GB recommended for the local copilot) | Pi 5 8 GB is the sweet spot | ~$80 |
| microSD card, 32 GB+ (A2 class) or NVMe hat | Endurance cards last longer with history logging | ~$15 |
| USB RS-485 adapter | FTDI or CH340-based, screw terminals are easiest | ~$10–15 |
| A pair of wires to the panel's RS-485 bus | Or tap the indoor transceiver of Pentair's wireless link kit if you have one | — |
| Pi power supply + case | Official PSU recommended | ~$20 |

Software is all free: Raspberry Pi OS, Docker,
[nodejs-poolController](https://github.com/tagyoureit/nodejs-poolController)
(the brilliant open-source project that actually speaks Pentair's protocol —
Moonpool sits on top of it), and Moonpool itself.

## 2. Try it with zero hardware

Before buying anything, run the whole app against the built-in simulator on
any computer with Node 22+:

```bash
git clone <this repo> moonpool && cd moonpool
npm install
cp .env.example .env.local      # MOCK_MODE=true is the default
npm run dev
```

Open http://localhost:3000, create the owner account, and explore: pool + spa
with drifting temperatures, 10 circuits, a variable-speed pump, chlorinator,
color lights, schedules, weather advisories, the water-level estimator, and a
fully working copilot (a deterministic parser stands in for the AI in mock
mode). Everything you'll use for real works here first.

## 3. Prepare the Raspberry Pi

1. Install [Raspberry Pi Imager](https://www.raspberrypi.com/software/) on
   your computer.
2. Choose **Raspberry Pi OS Lite (64-bit)** (no desktop needed).
3. Click the gear (⚙️ / "Edit settings") before writing:
   - hostname: `moonpool`
   - enable SSH (password or key)
   - set username + password
   - configure Wi-Fi *only if* you can't run Ethernet — wired is more reliable
     next to pool equipment.
4. Write the card, boot the Pi, then from your computer:

```bash
ssh <your-user>@moonpool.local
sudo apt update && sudo apt full-upgrade -y
```

5. Install Docker:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker
```

## 4. Wire the RS-485 adapter

The Pentair panel exposes an RS-485 bus (the same pair the indoor wireless
transceiver or ScreenLogic adapter uses). RS-485 is **multi-drop**: multiple
listeners coexist happily, so you don't need to remove anything that's
already connected.

1. Power off the panel at the breaker.
2. Find the COM port screw terminals (green connector on most EasyTouch /
   IntelliTouch boards — check your panel manual).
3. Run two conductors to your Pi location (or to wherever the indoor
   transceiver lives and tap there).
4. Connect to the USB adapter: panel **DATA+ → adapter A/+**, panel
   **DATA− → adapter B/−**. If nothing shows up later, swap them — reversed
   polarity is harmless and is the #1 first-try mistake.
5. Plug the adapter into the Pi, power the panel back on, and confirm:

```bash
ls -l /dev/ttyUSB*     # expect /dev/ttyUSB0
```

If yours enumerates differently (e.g. `/dev/ttyUSB1`), note it — you'll adjust
`docker-compose.yml` accordingly.

## 5. Install Moonpool

```bash
git clone <this repo> moonpool && cd moonpool
cp .env.example .env
nano .env
```

Set at minimum:

| Variable | Set it to |
| --- | --- |
| `MOCK_MODE` | `false` |
| `AUTH_SECRET` | output of `openssl rand -hex 32` |
| `TZ` | your timezone, e.g. `America/Phoenix` |
| `POOL_LATITUDE` / `POOL_LONGITUDE` | your location (for weather, sunrise/sunset automations, evaporation) |

Then:

```bash
docker compose up -d --build     # first build takes a while on a Pi — coffee time
```

This starts three containers: `njspc` (talks to the panel), `web` (Moonpool),
and `ollama` (local AI). Only Moonpool (`:3000`) is exposed; njsPC has no
authentication by design, so it's reachable only inside the compose network.

Pull the copilot model once:

```bash
docker compose exec ollama ollama pull qwen3:1.7b
```

## 6. First bring-up

1. Check njsPC found your panel: `docker compose logs njspc | tail -50` —
   you want to see your panel type detected and packets flowing. If it can't
   open `/dev/ttyUSB0`, fix the `devices:` mapping in `docker-compose.yml`.
2. Open `http://moonpool.local:3000` on the same network.
3. Create the **Owner** account (first-run screen appears automatically).
4. The dashboard should show your actual bodies, temps and circuits within a
   few seconds. Every circuit name comes from the panel — whatever you named
   things at the panel is what you'll see (rename them prettier later in
   **Settings → Equipment**). Check **Settings → System → Detected
   equipment** for the full scan: Moonpool automatically hides pages and
   widgets for gear you don't have (no chlorinator → no chlorinator page),
   and they appear on their own if you add equipment later.
5. Flip something harmless (a light) from the Controls page and listen for the
   relay in the panel. That click is the whole stack working.

## 7. Accounts & roles

**Settings → Users** (Owner only). Accounts are fully local — you create them
and set their passwords; nothing is emailed anywhere.

| Role | Can do |
| --- | --- |
| **Owner** | Everything: settings, users, equipment renames, audit log, integrations |
| **Family** | All day-to-day control: circuits, heat, pump, chlorinator, lights, schedules, scenes, automations, chemistry, history |
| **Guest** | Only circuits & scenes you've explicitly shared (Settings → Equipment / scene builder), read-only temps |

Everything anyone (or anything — copilot, automations, voice) changes is in
**Settings → Audit log** with old → new values.

## 8. Put it on your phone (PWA)

Moonpool is an installable web app — no app store:

- **iPhone**: open Moonpool in Safari → Share → **Add to Home Screen**.
- **Android**: Chrome → ⋮ → **Add to home screen** (or the install banner).

You get a full-screen app with the night-swim UI, and an offline shell that
shows last-known temperatures when you're out of coverage. For install +
push notifications to work away from home you'll want HTTPS — next section.

## 9. Remote access — no VPN app needed

Two good options; both end with a real HTTPS URL your phone can use anywhere,
with no VPN client installed.

### Option A: Cloudflare Tunnel (recommended, needs a domain on Cloudflare)

1. Add your domain to Cloudflare (free plan is fine).
2. Zero Trust → Networks → Tunnels → **Create tunnel** → Docker → copy the token.
3. On the Pi: add `TUNNEL_TOKEN=eyJ…` to `.env`, then
   `docker compose --profile remote up -d`.
4. In the tunnel's **Public hostname** tab: `pool.yourdomain.com` →
   `http://web:3000`.
5. Open `https://pool.yourdomain.com` on your phone → Add to Home Screen.

The tunnel is outbound-only: no port forwarding, no exposed home IP. Moonpool's
login + rate limiting front everything; add a Cloudflare Access policy on top
if you want a second gate.

### Option B: Tailscale Funnel (no domain needed)

```bash
sudo apt install tailscale && sudo tailscale up
sudo tailscale funnel --bg 3000
```

You get `https://moonpool.<your-tailnet>.ts.net`, publicly reachable — and
only the **Pi** runs Tailscale; phones need nothing installed. (If you'd
rather keep it private to your own devices, use `tailscale serve` instead and
install the Tailscale app on your phone — that's the one VPN-ish variant.)

## 10. Push notifications

**Settings → Notifications** on each device (requires the HTTPS URL from
step 9): tap **Enable on this device**, accept the browser prompt, then pick
which alerts you care about — equipment faults, freeze protection, salt low,
chemistry out of range, spa-ready, controller offline, estimated water level
low, and lightning (with a Tempest). Keys are generated on your Pi; no
third-party push accounts.

## 11. The Copilot

The chat tab (and the ask bar on the dashboard) turns plain English into pool
actions: *"warm the spa a bit"*, *"lights blue at sunset every Friday"*,
*"everything off at midnight"*. Whatever brain you pick, the model only
parses intent — Moonpool validates every argument, checks roles, shows a
confirm card before changing anything, and audits it all.

Pick the brain in **Settings → Voice & AI** (Owner):

1. **Local (Ollama)** — default, private, free. Needs the one-time
   `ollama pull qwen3:1.7b` from step 5. Fine for common commands; a small
   model on a Pi is deliberately modest.
2. **OpenAI API key** — paste a key from platform.openai.com. Uses
   `gpt-4o-mini` by default (pennies per question, much better at nuance).
   The key is stored only in the Pi's database.
3. **Sign in with ChatGPT** — if you have ChatGPT Plus/Pro: click *Sign in
   with ChatGPT*, log in on the OpenAI page that opens, and you'll land on a
   `localhost:1455` page that fails to load — **that's normal**. Copy that
   page's URL from the address bar and paste it back into Moonpool. Your
   subscription now powers the copilot (`gpt-5` by default). This mirrors the
   Codex CLI / OpenClaw flow; it's unofficial, so if OpenAI ever changes it,
   switch to an API key.

## 12. Voice: Siri & Alexa

Both run through the same copilot with the same validation and auditing.
Because you can't tap "Confirm" mid-sentence, voice commands auto-execute and
any weather advisory is spoken back ("Heads up: rain is forecast tomorrow…").
Both need your public HTTPS URL (step 9). Setup lives in **Settings →
Voice & AI**.

### Siri (5 minutes, no developer account)

1. Create a **voice token** (copy it immediately — it's shown once).
2. iPhone → Shortcuts → **+**:
   - Add **Dictate text**
   - Add **Get contents of URL**: `https://<your-url>/api/integrations/siri?token=<TOKEN>&q=` and insert the *Dictated Text* variable after `q=`
   - Add **Speak text** with *Contents of URL*
3. Name it "Pool". Now: **"Hey Siri, Pool"** → *"warm the spa to 102"*.
4. Bonus: make fixed shortcuts ("Spa Time") that hard-code `q=spa+on+and+102`.

### Alexa (~20 minutes, free Amazon developer account)

1. developer.amazon.com → Alexa Skills Kit → **Create Skill** → Custom →
   "Provision your own" (the skill stays private to your Amazon account).
2. Interaction model → JSON editor → paste the JSON from Moonpool's
   settings page (invocation name **"moonpool"**) → Save & Build.
3. Endpoint → **HTTPS** → `https://<your-url>/api/integrations/alexa` →
   select "trusted certificate" → Save.
4. Copy the **Skill ID** (`amzn1.ask.skill.…`) into Moonpool's settings and save.
5. Test tab or any Echo on your account: *"Alexa, ask moonpool what the spa
   temperature is"* / *"Alexa, ask moonpool to turn on the waterfall"*.

Moonpool verifies Amazon's request signature, your skill ID, and timestamps.

## 13. Tempest weather station (optional)

If a WeatherFlow Tempest is on your LAN, Moonpool listens for its UDP
broadcasts automatically (`TEMPEST_UDP=true`, default): measured rain feeds
the water-level estimator, on-site wind feeds advisories, and lightning
strikes trigger "out of the pool" pushes. If observations never arrive
(Docker bridge networks often can't see LAN broadcasts), either set the REST
fallback — `TEMPEST_TOKEN` + `TEMPEST_STATION_ID` from tempestwx.com →
Settings → Data Authorizations — or run the `web` service with
`network_mode: host` (then `NJSPC_URL=http://localhost:4200`).

Without a Tempest, weather still works via Open-Meteo (no API key).

## 14. Make it yours

- **Settings → Equipment**: rename circuits ("AUX 7" → "Bubbler"), pick
  icons, hide clutter, and mark what guests may touch.
- **Settings → Appearance**: dark/light/auto, OLED black, six accent presets
  or a fully custom color, ambient water animation toggle.
- **Settings (owner)**: pool volume (for dosing math), **surface area** (for
  the water-level estimator), $/kWh (energy costs), °F/°C, 12/24 h.
- **Dashboard → Customize**: drag, resize, hide widgets — per user.
- **Scenes**: build one-tap macros ("Spa Night" = spa on + 102° + lights
  purple + waterfall off). Scenes can be guest-visible and schedulable.
- **Automations**: triggers = time, cron, sunrise/sunset ± offset, temperature
  thresholds, salt low, freeze protect, controller events. The copilot can
  create these too ("lights blue at sunset every Friday") — they all show up
  in the same list, pausable and editable.
- **Chemistry**: log test-strip readings; get dosing suggestions sized to
  your pool volume; trends over time.

## 15. Backups & updates

Everything lives in **one SQLite file**. Back it up:

```bash
docker compose exec web node -e "require('better-sqlite3')('/data/moonpool.db').backup('/data/backup.db')" \
  && docker cp $(docker compose ps -q web):/data/backup.db ./moonpool-backup-$(date +%F).db
```

Update Moonpool:

```bash
git pull
docker compose up -d --build
```

The database schema migrates itself on boot. History samples are pruned at 90
days; daily rollups are kept forever and stay tiny.

## 16. Living with ScreenLogic during the transition

First, a fact that makes this much less scary than it sounds:
**ScreenLogic doesn't own anything.** Your schedules, egg timers, freeze
protection and heat settings all live **inside the EasyTouch/IntelliTouch
panel itself**. ScreenLogic is just a window into the panel — and so are
njsPC and Moonpool. When you open Moonpool's Schedules page you're looking at
(and editing) *the same panel schedules* ScreenLogic showed you.

What that means in practice:

- **Nothing to disable, nothing to migrate.** Your existing panel schedules
  appear in Moonpool automatically on first connect. Edits made in either app
  show up in the other, because there's only one copy — the panel's.
- **The ScreenLogic adapter can stay wired.** RS-485 is a multi-drop bus;
  njsPC and ScreenLogic coexist without interfering. Run both for weeks.
- **When you're ready**, just unplug the ScreenLogic adapter (or leave it as
  a break-glass spare). There is no off switch to find and no cloud account
  that fights back — with the adapter unplugged, the ScreenLogic app simply
  can't connect anymore.
- **Keep time-of-day equipment runs as *panel schedules*** (Moonpool's
  Schedules page), not as Moonpool automations. Panel schedules execute in
  the panel itself, so your pump still runs on schedule even if the Pi is
  off, rebooting, or dead. Use Moonpool **automations** for the things the
  panel can't do: sunset offsets, temperature thresholds, salt-low reactions,
  weather-aware behavior, copilot-created routines.
- **One caution:** don't create a Moonpool automation that duplicates an
  existing panel schedule (e.g. both turning the pump on at 8 AM) — nothing
  breaks, but you'll chase confusing on/off behavior. The Schedules page
  shows everything the panel will do on its own; check it before adding
  time-based automations.

## 17. Troubleshooting

| Symptom | Fix |
| --- | --- |
| Red "controller unreachable" banner | `docker compose logs njspc`. Usually the USB adapter re-enumerated (`ttyUSB1`) or A/B wires are swapped. Moonpool reconnects automatically once njsPC is back. |
| njsPC runs but no data / gibberish | A/B polarity swapped, or wrong panel type in njsPC config. |
| Copilot: "backend unreachable" | Local: `docker compose exec ollama ollama list` (model pulled? first response after idle takes a moment). OpenAI: check the key/plan in Settings → Voice & AI. |
| ChatGPT sign-in stopped working | The unofficial Codex route changed — switch the brain to an API key. |
| Push notifications silent | Needs HTTPS + granted permission. Re-enable in Settings → Notifications. iOS requires the app installed to the Home Screen. |
| Siri shortcut says "Invalid token" | Token was revoked or mistyped — mint a new one. |
| Alexa says the skill isn't responding | Endpoint URL wrong, tunnel down, or Skill ID mismatch in settings. |
| `no space left on device` | `docker system prune`; consider a bigger SD card. |
| Forgot the owner password | On the Pi: `docker compose exec web node -e "require('better-sqlite3')('/data/moonpool.db').prepare('DELETE FROM users').run()"` then reload — first-run setup reappears (accounts only; history/scenes/automations survive). |

---

Questions, bugs, ideas → open an issue. Enjoy the night swims. 🌙
