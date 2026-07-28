## Moonpool v1.0.5 🌙

Correctness release, proven on real hardware — a Raspberry Pi 4 driving a
Pentair EasyTouch over RS-485. If you're on v1.0.4 with auto-update enabled,
this one installs itself.

### The copilot stops guessing

- **Grounded against your own words** — which body, which circuit, and when
  are now settled deterministically from the sentence you typed, overriding
  whatever the model returns. "Turn on the hot tub at 9 pm" can no longer
  become "pool heater, right now" — with any brain, including the tiny ones.
- **Scheduled times are pinned when you ask** — a 9 PM plan confirmed at 9:01
  no longer slides a day; date handling and past-time refusals tightened.
- **No more double-fire** — an action meant for later can't also run now.
- **"Stop the shock" stops it** (it used to start one), a missing body is
  asked about instead of assumed, and a setpoint with the heater off now
  turns the heater on instead of reporting success while doing nothing.
- **Small-context safety** — chat history is trimmed to fit the model's
  context window instead of silently truncating the system prompt.

### Commands are verified, not assumed

Every control command now re-reads the panel state to confirm it actually
landed, retries once if it looks dropped, and raises an alert if the panel
never took it. A change made by a person at the physical panel is reported,
never fought.

Scheduled one-shots are crash-safe (a job can no longer be lost by a restart
mid-run), stale jobs missed overnight don't fire at breakfast, and failures
are surfaced instead of buried.

### Real-deployment fixes

- **Login over the LAN** — the session cookie no longer demands HTTPS, so
  signing in at `http://<pi>:3000` works.
- **Compose that actually starts** — njsPC is built from pinned upstream
  source (no unofficial images), the container gets serial-port permissions
  on Raspberry Pi OS, and a Cloudflare tunnel token is optional again.
- **Pi provisioning scripts** — `scripts/pi-setup.sh` and `pi-deploy.sh`
  take a fresh Pi to a running install.
- **Hardware guidance** — measured numbers for Pi-class machines are in
  `.env.example`; short version: run the deterministic parser on the Pi
  (`COPILOT_FORCE_MOCK=true`) or point `COPILOT_BASE_URL` at a bigger box.

### Testing

The copilot test corpus now asserts the exact arguments that decide what
equipment moves and when, runs every case through the real pipeline, and
grew from 60 to 153 passing tests.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
