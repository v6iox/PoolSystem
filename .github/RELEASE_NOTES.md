## Moonpool v1.0.2 🌙

**New since v1.0.0: built-in auto-updates.** Settings → System → Software
updates shows your version vs. the latest release, with a **Check for
updates** button and one-tap **Update now**; enable **Update automatically**
and Moonpool checks nightly (time configurable, midnight by default) and
installs new releases on its own — applied safely by a token-gated updater
sidecar, the only container with Docker access. Everything below describes
the full app.

---

Self-hosted pool control for Pentair EasyTouch/IntelliTouch panels, built on
[nodejs-poolController](https://github.com/tagyoureit/nodejs-poolController).
Everything lives on your Raspberry Pi — no cloud accounts, no external
database.

### Install

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

The interactive installer walks you through everything with arrow-key menus:
real pool vs. demo simulator, RS-485 adapter auto-detection, timezone &
location, the copilot's AI brain, and optional remote access — then builds
and starts the Docker stack and hands you the URL. Re-run it any time to
reconfigure, `install.sh --update` to upgrade.

No hardware yet? Pick **Demo** — the full app runs against a built-in
simulated pool.

### Highlights

- **Night-swim UI** — glassy panels over animated water caustics, liquid-fill
  temperature dials, installable PWA with offline last-known state
- **The full ScreenLogic replacement** — circuits, heat, variable-speed pump,
  chlorinator, IntelliBrite themes, schedules with a visual week view (your
  existing panel schedules appear automatically — nothing to migrate)
- **System scan** — equipment is discovered live; pages and widgets for gear
  you don't have simply don't appear
- **Roles & audit** — Owner / Family / Guest, per-circuit guest sharing,
  every change logged with old → new values
- **Automations** — time, cron, sunrise/sunset offsets, temperature
  thresholds, salt low, freeze protect, controller events; plus one-tap scenes
- **Pool Copilot** — natural-language control with confirm-first plan cards.
  Three switchable brains: local Ollama (private), OpenAI API key, or Sign in
  with ChatGPT (uses your subscription)
- **Weather-aware** — "Heat the pool? Rain is forecast tomorrow 3–4 PM",
  evaporation-based water-level estimates, freeze alerts; optional WeatherFlow
  Tempest integration (measured rain, lightning "out of the pool" pushes)
- **Voice** — Siri Shortcuts (no dev account) and a private Alexa skill
- **History & insight** — temps, pump watts, salt, chemistry with dosing math,
  runtime & energy cost

### Docs

- [Complete setup guide](https://github.com/v6iox/poolsystem/blob/HEAD/docs/SETUP.md) — hardware list, wiring, remote access, voice, everything
- [README](https://github.com/v6iox/poolsystem#readme) — architecture & security model

### Safety

Moonpool drives real equipment. Keep your panel's physical safeties in place,
run alongside your existing setup until you trust it, and read the
disclaimer. Not affiliated with Pentair.
