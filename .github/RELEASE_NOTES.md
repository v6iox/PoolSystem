## Moonpool v1.0.9 🌙

Bugfix release for a highly visible false alarm on real EasyTouch panels. If
you're on v1.0.8 with auto-update enabled, this one installs itself.

### Fixed

- **Phantom permanent "panel is in a delay" banner** — EasyTouch reports its
  delay status byte as 32 + flags, and **32 alone is the panel's normal
  "no delay" state**. Moonpool read any nonzero value as an active delay, so
  healthy panels showed the delay banner forever, and *Skip delay* only won
  for a second or two before the panel's next status packet brought it back.
  The parser now trusts njsPC's own naming (anything but "nodelay" is real)
  and knows 0 and 32 both mean idle.
- **Heater watchdog un-muzzled** — stopped-mid-heat alerts are suppressed
  during a genuine delay (a heater cool-down legitimately pauses heating),
  so the stuck flag was silently disabling that protection on real panels.
  Fixed as a direct consequence of the above.

### Changed

- **Real delays now say what they are** — when a delay actually is active,
  the banner names it ("Heater Cooldown Delay", "Valve Delay", "Freeze
  Delay") instead of generic text, and per-body heater cool-down /
  start / stop delay flags from njsPC are surfaced too.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
