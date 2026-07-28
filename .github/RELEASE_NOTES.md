## Moonpool v1.0.7 🌙

Patch release. If you're on v1.0.6 with auto-update enabled, this one
installs itself.

### Fixed

- **Panel clock sync** — "Sync now" failed on real hardware because the
  date/time message carried a four-digit year into a one-byte protocol
  field, and the panel rejected the whole frame. The year is now sent
  two-digit, matching what EasyTouch/IntelliTouch expect on the bus.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
