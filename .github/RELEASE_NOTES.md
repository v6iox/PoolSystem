## Moonpool v1.0.11 🌙

One fix, but an important one if you use sensor calibration. If you're on
v1.0.10 with auto-update enabled, this installs itself.

### Fixed

- **"Heat to 100" now means a true 100 with calibration set** — the panel's
  thermostat runs on its own uncorrected sensor, so a Moonpool offset used
  to fix what you *saw* but not where heating *stopped*: with a −4 offset
  (sensor reads 4° high), asking for 100 heated the water to a true 96.
  Setpoints are now compensated end-to-end — asking for 100 tells the panel
  104, so its high-reading sensor says 104 exactly when the water is truly
  100, and everything Moonpool displays agrees with what you asked for.
- **Scald limit stays the panel's** — a positive offset never unlocks true
  temperatures above the panel's own ceiling (104°F spa): the compensated
  range is capped so miscalibration can't be used to overshoot it.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
