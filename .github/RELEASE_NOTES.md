## Moonpool v1.0.4 🌙

The copilot grows up, the panel opens up. Biggest release since launch — if
you're on v1.0.3 with auto-update enabled, this one installs itself.

### Copilot — talk to it like a person

- **Do anything by asking** — pump RPM, pool/spa chlorinator output,
  a color for one specific light, create/edit/delete panel schedules, save
  and delete scenes, log water top-offs, ask "do we need water?" — the full
  app surface, all confirm-first.
- **It knows what time it is** — "in 2 hours, heat the hot tub" and
  "tomorrow at 3pm" now schedule correctly (new relative one-off scheduling,
  1 minute to 7 days out).
- **Conversation memory** — follow-ups like "actually make it 3 hours" or
  "same for the pool" resolve against what you just said.
- **A voice, not a form letter** — friendly conversational replies (never
  over the top), while every fact still comes from live data.
- **Local models actually work now** — fixed a constrained-decoding
  bottleneck that made multi-step requests time out on Ollama, raised the
  local timeout to 60s (`COPILOT_TIMEOUT_MS` to tune), and skipped Qwen3's
  slow thinking phase. Fresh installs offer to set up Ollama automatically.
- **Never acts unprompted** — a deterministic guard drops any tool call a
  small model hallucinates onto a greeting.

### New protections

- **Heater watchdog** — push alert when a heater says it's heating but the
  water isn't warming (spa 15 min / pool 45 min windows), or when it quits
  well short of the setpoint with heat mode still on. Smart about normal
  cycling, panel delays, and re-paging.
- **"Reading updated Xm ago"** under every temperature — a frozen sensor is
  visible at a glance.

### Panel superpowers (Advanced menus, owner-only)

- **Circuits** — panel names, circuit functions, egg timers, per-circuit
  freeze protection, show-in-features.
- **Pump** — the per-circuit speed program table.
- **Lights** — light group rename + membership.
- **Settings → System** — panel clock "Sync now" + valve renames.
- **Dashboard** — skip an active heater/valve delay with one tap.
- **Sensor calibration** — the water/air/solar temperature offsets, written
  to the panel itself.

### Fixed

- **Light colors on real systems** — theme discovery used an endpoint njsPC
  doesn't have, so real installs showed no color options at all. Now
  discovered per light circuit (IntelliBrite fallback included).
- **Phantom solar** — systems without solar no longer show solar heat modes.
- **OpenAI API-key brain** — a strict-schema incompatibility that could 400
  every request.

### Also new

- **Schedules page shows everything** — copilot one-shots (with countdowns
  and cancel) and automations (with pause/resume) now appear alongside panel
  schedules.
- **Customizable quick controls** — pick which circuits live on the
  dashboard widget (up to 8, per user).
- **Verified by Tempest** — a badge on the weather widget whenever the
  reading comes from your own station; hover for the last report time.
- **Server health** — live CPU, memory, disk, Pi temperature and uptime in
  Settings → System.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
