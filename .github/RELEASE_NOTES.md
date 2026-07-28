## Moonpool v1.0.8 🌙

Quality-of-life release. If you're on v1.0.7 with auto-update enabled, this
one installs itself.

### Added

- **Update progress bar** — updates now show a phase-labeled progress bar
  ("Building the new image — the long part…") with a live percentage that
  tracks the Docker build, instead of a log crawl on a seemingly frozen
  page.

### Changed

- **Stay signed in on devices you use** — sessions now renew themselves on
  every use, on both the server and the cookie, so the phone app never logs
  you out as long as you open it occasionally. Default window is 90 days
  (`SESSION_DAYS` to change); only a device untouched that long expires.
  Pairs perfectly with Tailscale VPN-on-demand or a Cloudflare tunnel for a
  tap-the-icon-anywhere experience.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
