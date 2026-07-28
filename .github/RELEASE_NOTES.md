## Moonpool v1.0.10 🌙

Three fixes straight from real-hardware feedback. If you're on v1.0.9 with
auto-update enabled, this one installs itself.

### Fixed

- **Temperature calibration actually works** — on EasyTouch/IntelliTouch/
  IntelliCenter panels, njsPC only *stores* sensor offsets without ever
  applying them (and Pentair's protocol has no remote-calibration command),
  so the offsets in Settings changed nothing. Moonpool now applies them
  itself: set +2 on water and every dial, chart, automation, alert and
  copilot answer shifts by +2 within a second. Standalone/Nixie controllers
  keep true write-through, where njsPC-side calibration genuinely works.
- **Idle bodies no longer show a remembered temp as live** — with the pump
  off the sensor isn't in the water flow, so the panel just repeats its last
  reading. Those now show **—** with a "no live reading — pump off (last
  N°)" note instead, the copilot says so too, and history charts skip the
  stale samples instead of drawing fake flat lines.
- **The update progress bar moves for real** — build output was collected
  only when the build *finished*, so the bar sat still and then jumped to
  done. The updater now streams the build log live and paces the bar through
  the whole build, trickling forward even during the long npm/Next steps.

### Changed

- **Calibration explains itself** — the Settings section now states who
  applies the offsets, that the panel's own screen can only be calibrated at
  the panel, and warns against setting the same correction in both places.
- **The updater keeps itself up to date** — after each successful update the
  sidecar rebuilds its own image and recreates itself when it changed, so
  updater improvements reach existing installs automatically.

### One-time step for existing installs

The currently-running updater sidecar predates its self-refresh, so run this
once on the Pi after updating (or just re-run the installer):

```bash
docker compose build updater && docker compose up -d updater
```

Every update after that keeps the sidecar current automatically.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
