# Moonpool — feature-page implementation brief

You are building one feature area of **Moonpool**, a self-hosted Pentair pool controller UI
(Next.js 15 App Router, TypeScript **strict — `any` is forbidden**, Tailwind v4, motion
(Framer Motion), TanStack Query, Radix primitives). The foundation is already built, boots, and
is committed. **Only create/modify files inside the paths you were assigned.** Import freely from
the modules below — do not re-implement them, do not edit them.

## Run/verify
- `npx tsc --noEmit` must pass for your files before you finish. Fix your own type errors.
- Dev server may already be running on :3000 (MOCK_MODE). Do not kill or restart it.

## Core client modules (READ THESE FILES BEFORE WRITING CODE)

### `@/lib/client/pool-state` — live state + control
```ts
const { snapshot, connection, backendConnected, hasLoaded, user, sendAction, sendActions } = usePool();
```
- `snapshot: PoolStateSnapshot` (see `@/types/pool`) — live via SSE, updates ~1s.
- `hasLoaded` false until first SSE frame → show `<Skeleton>` loading states.
- `backendConnected` false ⇒ njsPC unreachable ⇒ **disable all controls** (a global banner already exists).
- `sendAction(action, optimisticPatch?)` → POST /api/control with rollback + error toast built in.
  Optimistic helpers exported: `patchCircuit(id, on)`, `patchSetpoint(bodyId, v)`, `patchHeatMode(bodyId, m)`.
  For other optimistic updates write your own `(snap) => snap` patch inline.
- `user: { id, email, name, role }` role ∈ owner|family|guest. Gate UI with `roleAtLeast(user.role, "family")` from `@/types/auth`.

### `@/types/pool` — the full domain model (bodies, circuits, pumps, chlorinators, lightThemes, lightGroups, schedules, chem).
### `@/types/actions` — `PoolAction` union (setCircuit, setHeat, setPumpSpeed, setChlorinator, superChlorinate, setLightTheme, setLightGroupTheme, runScene, allOff), `AutomationTrigger`, `AutomationDef`, `SceneDef`, `ScheduledJob`.

### `@/lib/client/api` — `apiGet<T>(url)`, `apiSend<T>(method, url, body?)`; throws `ApiError` with server message.
### `@/stores/toast` — `toast("success" | "error" | "info", title, detail?)`.

## Server API routes (already implemented — call these, don't create duplicates)
- `POST /api/control` `{action}` or `{actions}`; optional `followUp: {actions, at, label}` schedules a one-shot job. 422 on failure with per-action results.
- `GET/POST/DELETE /api/schedules` — POST body `ScheduleInput` `{id?, circuitId, startTime, endTime, days[0-6], scheduleType:"repeat"|"runonce", heatSetpoint?, heatSource?}` (minutes from midnight). DELETE `?id=`.
- `GET/POST /api/scenes`, `PUT/DELETE /api/scenes/[id]` — SceneDef fields `{name, icon, description, actions, guestVisible, position}`.
- `GET/POST /api/automations`, `PUT/DELETE /api/automations/[id]` — GET returns `{automations: AutomationDef[], pendingJobs}`; PUT accepts partial `{name?, trigger?, actions?, enabled?}` (enabled=pause/resume).
- `DELETE /api/jobs/[id]` — cancel pending one-shot job.
- `GET/POST/DELETE /api/chemistry` — POST `{ph?, orp?, fc?, ta?, cya?, ch?, salt?, bodyId?, notes?, at?}`.
- `GET /api/history?metrics=temp:body:1,pump:1:watts&from=&to=` → `{series: {metric: [{at, value}]}, rollups: {metric: [{day,min,max,avg}]}}`. Raw series for ranges ≤3 days, rollups beyond. Metric keys: `temp:air`, `temp:body:<id>`, `setpoint:body:<id>`, `pump:<id>:watts`, `pump:<id>:rpm`, `chlor:<id>:salt`, `chlor:<id>:output`, `chem:<id>:ph`, `chem:<id>:orp`.
- `GET /api/history/runtime?days=30` → `{costPerKwh, rows: [{day, key, hours, kwh, cost}]}` keys like `pump:1`, `heater:body:2`, `circuit:3`.
- `GET /api/audit?limit=&before=&source=` (owner) → `{entries}`.
- `GET/PUT /api/settings/app` (GET family+, PUT owner) — `AppSettings` see `@/server/settings`.
- `GET/PUT /api/settings/prefs` — per-user JSON blob (theme, dashboard, notifications: Record<AlertKind, boolean>).
- `GET/PUT /api/settings/circuit-meta` (owner) — `{circuitId, displayName?, icon?, guestVisible?, hidden?}` or `{bodyId, bodyName}`.
- `GET/POST/PUT/DELETE /api/users`, `/api/users/[id]` (owner) — create `{email,name,password,role}`, update `{name?, role?, disabled?, password?}`.
- `GET /api/push/key`, `POST/DELETE /api/push/subscribe`.
- `GET /api/weather` → `{weather: WeatherData | null}` (`@/types/weather`).

## UI kit (`@/components/ui/*`) — use these, style variations via className
- `Button` variants: primary | glass | ghost | danger | heat; sizes sm/md/lg/icon/iconSm. Has built-in water-ripple press.
- `Panel` (glass card, `bright` prop), `PageHeader {title, subtitle, action}`, `EmptyState {icon,title,detail,action}`, `Skeleton`.
- `Switch {checked, onCheckedChange, disabled}` (spring + glow), `Slider {value,onValueChange,onValueCommit,min,max,step,accent:"accent"|"heat"}`.
- `Dialog, DialogTrigger, DialogClose` + `DialogContent {title, description?, wide?}`.
- `Select {value,onValueChange,options:[{value,label}]}`, `Input`, `Label`, `Field {label, hint?}`.
- `NumberTicker {value, decimals?}` — animated numerals.
- `TempDial` (`@/components/pool/temp-dial`) — the signature liquid dial: `{label, temp, setPoint, min, max, heating, heatSource?, units, disabled?, size?, onSetPoint?}`.
- `CircuitIcon {icon?, type, isLight, size?}` + `CIRCUIT_ICONS` map (`@/lib/icons`).
- Utils (`@/lib/utils`): `cn`, `formatMinutes(min, clock?)`, `formatClock(ms)`, `formatRelative(ms)`, `formatDays(days[])`, `DAY_LABELS`.

## Design language — match it exactly
- Tailwind color tokens: `bg-abyss, bg-deep, text-ink, text-ink-dim, text-ink-faint, border-line, border-line-bright, bg-accent, text-accent, bg-accent-soft, text-heat, bg-heat-soft, text-ok, text-warn, text-danger`. Fonts: `font-display` (headers/numerals), default body font. Radius: `rounded-panel` for cards, `rounded-xl` for controls. Glass: `Panel` or class `glass`/`glass-bright`.
- Big numbers use `temp-display` class + `NumberTicker`. Active equipment gets `pulse-active` (accent) or `pulse-heat`.
- Motion: use `motion/react` (`motion.div`, `AnimatePresence`), springs `{type:"spring", stiffness≈300-500, damping≈26-38}`, stagger page items by ~0.05s. Transform/opacity only. Everything must look right with reduced motion (CSS handles most).
- Mobile-first: big touch targets (≥44px), single column on phones, grids at `sm:`/`lg:`. The shell adds bottom padding for the nav.
- Icons: lucide-react only.
- NO stock-shadcn look, no purple gradients. Deep teal-navy night-swim aesthetic is already in the tokens — just use them.

## Every page must handle
1. Loading (`!hasLoaded` → Skeletons), 2. Empty (equipment absent → EmptyState explaining), 3. Error (ApiError → toast, keep UI consistent), 4. Offline (`!backendConnected` → controls disabled), 5. Mock (works fully in MOCK_MODE — the sim reports pool+spa, 8 circuits incl. 3 lights, IntelliFlo pump id 1, IntelliChlor id 1, light group id 192, 3 schedules, **no IntelliChem** → chem pages must show the manual-logging experience).
6. Guests: pages a guest can open must filter to guest-visible content (the server already filters snapshot + scenes for guests; just handle empty results gracefully).

## Page conventions
- Files: `src/app/(shell)/<area>/page.tsx` (+ components under `src/components/<area>/`). All pages are client components (`"use client"`).
- Start each page with `<PageHeader title subtitle action?>`.
- Keep components in separate files when >150 lines.
- TS strict: annotate return types `React.JSX.Element`, no `any`, no non-null `!` unless provably safe.
