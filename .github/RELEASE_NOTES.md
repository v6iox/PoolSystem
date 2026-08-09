## Moonpool v1.0.13 🌙

Copilot fixed for OpenAI's model retirements, a new OpenRouter brain, and a
round of review hardening for v1.0.12's features. If you're on v1.0.12 with
auto-update enabled, this installs itself.

### Fixed

- **ChatGPT sign-in copilot works with OpenAI's current models** — OpenAI
  retired the entire model lineup Moonpool knew, so every request failed.
  The auto-picker now leads with the current GPT-5.6 family (terra/sol/luna)
  and, as before, remembers what works and re-heals on the next retirement.
- **Tempest: replacing a saved token actually saves** — on accounts with
  several stations, "Find my station" now stores the pasted token the moment
  WeatherFlow validates it (the station picker used to be the only save
  path, and re-picking your current station saved nothing).
- **Tempest cloud polling no longer slows down after the hub goes quiet** —
  a stale "UDP is flowing" heuristic halved the poll rate and made the
  status card flap between receiving/not receiving.
- **`expose` profile: a missing MOONPOOL_DOMAIN now says so** instead of
  crash-looping Caddy with an unrelated parse error.
- Smaller ones: stale WeatherFlow errors no longer outlive a removed token;
  a station with no recent observations now reads "is the hub online?";
  settings saves can't be overwritten by a background refresh; the token
  field refuses password-manager autofill; an oversized copilot prompt no
  longer retries across every model.

### Added

- **OpenRouter as a copilot brain** — one `sk-or-` key from openrouter.ai
  unlocks Claude, Gemini, Llama, DeepSeek and hundreds more. Pick it in
  Settings → Voice & AI, set any OpenRouter model slug (default
  `openai/gpt-4o-mini`). Key stored only on the Pi; same grounding,
  validation and confirmation pipeline as every other brain.

### Install / update

New install:

```bash
curl -fsSL https://github.com/v6iox/poolsystem/releases/latest/download/install.sh | bash
```

Existing installs update from **Settings → System → Software updates** (or
automatically overnight if enabled), or `install.sh --update`.
