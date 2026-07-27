## Moonpool v1.0.3 🌙

Maintenance release — if you're on v1.0.2 with auto-update enabled, this one
installs itself.

### Fixed

- **`npm install` on current Node / fresh Macs** — upgraded `better-sqlite3`
  to v12; v11 failed to compile against Node 26's V8. (Docker installs on the
  Pi were never affected.)
- **Copilot model picker** — the Model field in Settings → Voice & AI now
  applies to the local Ollama brain too, so swapping models is a live
  settings change (any pulled Ollama tag works).
- The floating Next.js dev-tools badge no longer overlays the sidebar during
  `npm run dev`.

### Added

- `scripts/dev-mac.sh` — one-command native test environment (simulator by
  default, `--pi <ip>` for real equipment over the LAN, `--reset` to wipe the
  dev database).
- `COPILOT_FORCE_LLM=true` dev flag — run a real local LLM against the
  MOCK_MODE simulator (the deterministic parser remains the default).

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
