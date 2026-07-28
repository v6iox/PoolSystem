## Moonpool v1.0.6 🌙

The whole panel, on the wire. Every digital feature the Pentair link exposes
now has a home in Moonpool — each one capability-gated, so your install only
shows the hardware you actually have. If you're on v1.0.5 with auto-update
enabled, this one installs itself.

### New panel powers

- **Sunrise/sunset schedules, panel-native** — anchor a schedule's start or
  end to sunrise or sunset and the panel recomputes the time daily by
  itself. Works even if the Moonpool server is off.
- **IntelliBrite color commands** — sync, swim, set, hold and recall on the
  Lights page, alongside the themes.
- **Wall remotes** — remap iS4 / QuickTouch buttons to any circuit from
  Settings → System.
- **IntelliChem** — setpoints and tank levels at a glance, plus bounded,
  audited manual acid/chlorine dosing on the Chemistry page. Chem dosers
  and pool covers are surfaced too.
- **Named delays** — the dashboard banner now says *what's* delaying
  (heater cool-down, circuit start/stop), with the one-tap skip.
- **Panel clock drift** — see what time the panel thinks it is and how far
  it has drifted, next to the Sync-now button.

### For reliability & support

- **RS-485 bus health** — per-port traffic, collision and failure counters
  with a "check wiring" warning. Cable trouble shows up here first.
- **Panel-config backups** — list njsPC's own configuration backups and
  create one with a tap.
- **Diagnostics toolkit** — record raw RS-485 bus traffic and download it,
  or grab a full config + state snapshot for bug reports.

### Safety fixes

- **`.env` stays in charge until you say otherwise** — saving any setting
  used to silently freeze env-derived values (like your coordinates) into
  the database forever. Now only the settings you explicitly change are
  stored, the Location panel shows which source is live, and there's a
  one-tap "use .env again".
- **Updates can't destroy hand-edits** — the updater refuses to run over
  locally modified files and lists them, with an explicit "update anyway"
  or "keep my edits" choice. Nightly auto-updates always fail safe.

### Simulator

The simulator emulates all of it — demo IntelliChem, an iS4 remote, bus
statistics, backups — so every feature can be demoed and tested with zero
hardware. 157 tests.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
