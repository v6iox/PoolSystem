## Moonpool v1.0.12 🌙

Copilot un-broken for ChatGPT sign-in, Tempest setup that lives in the app,
and a new no-VPN remote-access option. If you're on v1.0.11 with auto-update
enabled, this installs itself.

### Fixed

- **Copilot with "Sign in with ChatGPT" works again** — OpenAI's backend
  started rejecting the model Moonpool requested ("The 'gpt-5' model is not
  supported…"), which failed every message. Moonpool now auto-discovers a
  model the backend accepts, remembers it, and re-heals when OpenAI retires
  model names in the future. A manually-set model in Settings is always used
  as-is.
- **Tempest live wind never updated** — the rapid-wind packets were read
  from the wrong field; real-time wind now flows between full observations.

### Added

- **Tempest setup in the app** — Settings → Tempest weather station: live
  status (receiving or not, LAN broadcast vs cloud, data freshness, and the
  reason the last cloud poll failed), a UDP toggle, WeatherFlow token entry
  with a station picker that finds your station for you, and a test button.
  Changes apply instantly — no restart, no .env editing (though .env still
  works and the UI shows which source is active). The token never leaves
  the Pi.
- **Direct port-forward remote access** — a new `expose` Docker profile puts
  a Caddy proxy with automatic Let's Encrypt HTTPS in front of Moonpool:
  point a domain at your home IP, forward ports 80 + 443, set
  `MOONPOOL_DOMAIN`, and use the app from anywhere with no VPN and no
  tunnel. The setup guide compares all three remote-access options — and
  explains why you should never forward plain-HTTP port 3000.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
