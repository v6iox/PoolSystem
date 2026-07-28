import { getDb, now } from "@/server/db";
import { audit } from "@/server/audit";
import { getRuntime } from "@/server/runtime";
import { AdapterError } from "@/server/adapters/types";
import { sendAlert } from "@/server/push";
import { verifyAction } from "@/server/verify";
import type { PoolStateSnapshot } from "@/types/pool";
import type { ActionResult, ActionSource, PoolAction } from "@/types/actions";
import type { SceneDef } from "@/types/actions";
import type { Role } from "@/types/auth";
import { roleAtLeast } from "@/types/auth";

/**
 * The one validated, audited path for changing pool state. UI routes, the
 * automations worker, scenes, scheduled jobs and the copilot all execute
 * through here — never through the adapter directly.
 */

export interface ActionContext {
  userId: number | null;
  userName: string;
  role: Role;
  source: ActionSource;
}

export const SYSTEM_CTX: ActionContext = { userId: null, userName: "system", role: "owner", source: "system" };

export function automationCtx(name: string): ActionContext {
  return { userId: null, userName: `automation: ${name}`, role: "owner", source: "automation" };
}

interface CircuitMetaRow {
  circuit_id: number;
  guest_visible: number;
  hidden: number;
}

function guestCanTouchCircuit(circuitId: number): boolean {
  const row = getDb().prepare("SELECT guest_visible FROM circuit_meta WHERE circuit_id = ?").get(circuitId) as
    | CircuitMetaRow
    | undefined;
  return row?.guest_visible === 1;
}

function guestCanRunScene(sceneId: number): boolean {
  const row = getDb().prepare("SELECT guest_visible FROM scenes WHERE id = ?").get(sceneId) as
    | { guest_visible: number }
    | undefined;
  return row?.guest_visible === 1;
}

export function getScene(sceneId: number): SceneDef | null {
  const row = getDb().prepare("SELECT * FROM scenes WHERE id = ?").get(sceneId) as
    | { id: number; name: string; icon: string; description: string; actions: string; guest_visible: number; position: number; created_by: number | null }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    actions: JSON.parse(row.actions) as PoolAction[],
    guestVisible: row.guest_visible === 1,
    position: row.position,
    createdBy: row.created_by,
  };
}

/** Validate an action against the live snapshot + role. Throws AdapterError on rejection. */
function validate(action: PoolAction, ctx: ActionContext): void {
  const snap = getRuntime().getSnapshot();
  const isGuest = !roleAtLeast(ctx.role, "family");

  switch (action.type) {
    case "setCircuit": {
      const circuit =
        snap.circuits.find((c) => c.id === action.circuitId) ?? snap.features.find((c) => c.id === action.circuitId);
      if (!circuit) throw new AdapterError(`Unknown circuit ${action.circuitId}`, 404);
      if (isGuest && !guestCanTouchCircuit(action.circuitId)) {
        throw new AdapterError("Guests can only control circuits shared with guests", 403);
      }
      return;
    }
    case "setHeat": {
      if (isGuest) throw new AdapterError("Guests cannot change heat settings", 403);
      const body = snap.bodies.find((b) => b.id === action.bodyId);
      if (!body) throw new AdapterError(`Unknown body ${action.bodyId}`, 404);
      if (action.setPoint !== undefined) {
        const min = Math.max(60, body.minSetPoint);
        const max = Math.min(104, body.maxSetPoint);
        if (!Number.isFinite(action.setPoint) || action.setPoint < min || action.setPoint > max) {
          throw new AdapterError(`Setpoint must be between ${min} and ${max}°${snap.units}`, 400);
        }
      }
      if (action.mode !== undefined && !body.supportedHeatModes.includes(action.mode)) {
        throw new AdapterError(`Heat mode "${action.mode}" not supported on ${body.name}`, 400);
      }
      if (action.mode === undefined && action.setPoint === undefined) {
        throw new AdapterError("setHeat needs a mode or a setpoint", 400);
      }
      return;
    }
    case "setPumpSpeed": {
      if (isGuest) throw new AdapterError("Guests cannot control the pump", 403);
      const pump = snap.pumps.find((p) => p.id === action.pumpId);
      if (!pump) throw new AdapterError(`Unknown pump ${action.pumpId}`, 404);
      if (!Number.isFinite(action.rpm) || action.rpm < pump.minSpeed || action.rpm > pump.maxSpeed) {
        throw new AdapterError(`RPM must be between ${pump.minSpeed} and ${pump.maxSpeed}`, 400);
      }
      return;
    }
    case "setChlorinator": {
      if (isGuest) throw new AdapterError("Guests cannot control the chlorinator", 403);
      if (!snap.chlorinators.some((c) => c.id === action.chlorId)) {
        throw new AdapterError(`Unknown chlorinator ${action.chlorId}`, 404);
      }
      for (const v of [action.poolSetpoint, action.spaSetpoint]) {
        if (v !== undefined && (!Number.isFinite(v) || v < 0 || v > 100)) {
          throw new AdapterError("Chlorinator output must be 0–100%", 400);
        }
      }
      return;
    }
    case "superChlorinate": {
      if (isGuest) throw new AdapterError("Guests cannot control the chlorinator", 403);
      if (!snap.chlorinators.some((c) => c.id === action.chlorId)) {
        throw new AdapterError(`Unknown chlorinator ${action.chlorId}`, 404);
      }
      if (!Number.isFinite(action.hours) || action.hours < 1 || action.hours > 72) {
        throw new AdapterError("Super-chlorinate duration must be 1–72 hours", 400);
      }
      return;
    }
    case "setLightTheme": {
      const circuit =
        snap.circuits.find((c) => c.id === action.circuitId) ?? snap.features.find((c) => c.id === action.circuitId);
      if (!circuit) throw new AdapterError(`Unknown circuit ${action.circuitId}`, 404);
      if (!circuit.isLight) throw new AdapterError(`${circuit.name} is not a light`, 400);
      if (isGuest && !guestCanTouchCircuit(action.circuitId)) {
        throw new AdapterError("Guests can only control lights shared with guests", 403);
      }
      return;
    }
    case "setLightGroupTheme": {
      if (isGuest) throw new AdapterError("Guests cannot control light groups", 403);
      if (!snap.lightGroups.some((g) => g.id === action.groupId)) {
        throw new AdapterError(`Unknown light group ${action.groupId}`, 404);
      }
      return;
    }
    case "runScene": {
      const scene = getScene(action.sceneId);
      if (!scene) throw new AdapterError(`Unknown scene ${action.sceneId}`, 404);
      if (isGuest && !guestCanRunScene(action.sceneId)) {
        throw new AdapterError("This scene isn't shared with guests", 403);
      }
      return;
    }
    case "allOff": {
      if (isGuest) throw new AdapterError("Guests cannot use All Off", 403);
      return;
    }
  }
}

function describeTarget(action: PoolAction): string {
  const snap = getRuntime().getSnapshot();
  switch (action.type) {
    case "setCircuit":
    case "setLightTheme": {
      const c = snap.circuits.find((x) => x.id === action.circuitId) ?? snap.features.find((x) => x.id === action.circuitId);
      return c ? c.name : `circuit ${action.circuitId}`;
    }
    case "setHeat": {
      const b = snap.bodies.find((x) => x.id === action.bodyId);
      return b ? b.name : `body ${action.bodyId}`;
    }
    case "setPumpSpeed": {
      const p = snap.pumps.find((x) => x.id === action.pumpId);
      return p ? p.name : `pump ${action.pumpId}`;
    }
    case "setChlorinator":
    case "superChlorinate": {
      const c = snap.chlorinators.find((x) => x.id === action.chlorId);
      return c ? c.name : `chlorinator ${action.chlorId}`;
    }
    case "setLightGroupTheme": {
      const g = snap.lightGroups.find((x) => x.id === action.groupId);
      return g ? g.name : `light group ${action.groupId}`;
    }
    case "runScene": {
      const s = getScene(action.sceneId);
      return s ? `scene "${s.name}"` : `scene ${action.sceneId}`;
    }
    case "allOff":
      return "all equipment";
  }
}

function themeName(theme: number): string {
  const t = getRuntime().getSnapshot().lightThemes.find((x) => x.val === theme);
  return t ? t.name : `theme ${theme}`;
}

/* ── verification ───────────────────────────────────────────────────────── */

/**
 * Re-issue only the adapter calls for an action, with no auditing or summary.
 * Used by the verifier when a command appears to have been dropped on the way
 * to the panel. Mirrors the action types verify.ts knows how to check.
 */
async function resendAction(action: PoolAction): Promise<void> {
  const adapter = getRuntime().adapter;
  switch (action.type) {
    case "setCircuit":
      await adapter.setCircuit(action.circuitId, action.state);
      return;
    case "setHeat":
      if (action.mode !== undefined) await adapter.setHeatMode(action.bodyId, action.mode);
      if (action.setPoint !== undefined) await adapter.setSetPoint(action.bodyId, action.setPoint);
      return;
    case "setChlorinator":
      await adapter.setChlorinator(action.chlorId, action.poolSetpoint, action.spaSetpoint);
      return;
    case "superChlorinate":
      await adapter.setSuperChlor(action.chlorId, action.on, action.hours);
      return;
    case "setLightTheme":
      await adapter.setLightTheme(action.circuitId, action.theme);
      return;
    case "setLightGroupTheme":
      await adapter.setLightGroupTheme(action.groupId, action.theme);
      return;
    case "allOff": {
      const snap = getRuntime().getSnapshot();
      for (const c of [...snap.circuits, ...snap.features].filter((x) => x.isOn)) {
        await adapter.setCircuit(c.id, false);
      }
      return;
    }
    case "runScene":
    case "setPumpSpeed":
      return;
  }
}

/**
 * Confirm in the background that a command actually landed on the panel, and
 * say so plainly when it didn't. Deliberately fire-and-forget: verification
 * must never delay or fail the user's request.
 */
function startVerification(action: PoolAction, before: PoolStateSnapshot, ctx: ActionContext): void {
  const runtime = getRuntime();
  if (!before.connected) return; // nothing to verify against
  void verifyAction(action, before, {
    snapshot: () => runtime.getSnapshot(),
    resend: () => resendAction(action),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    onResult: (outcome) => {
      const detail =
        outcome.state === "overridden"
          ? `${outcome.label} is ${outcome.got ?? "?"}, not the ${outcome.want} that was commanded — something else changed it`
          : `${outcome.label} never reached ${outcome.want} (still ${outcome.got ?? "?"})${outcome.retried ? " after a retry" : ""}`;
      console.warn(`[moonpool] unconfirmed command: ${detail}`);
      audit({
        userId: ctx.userId,
        userName: ctx.userName,
        source: ctx.source,
        action: action.type,
        target: describeTarget(action),
        ok: false,
        detail: `unconfirmed — ${detail}`,
      });
      // Only a dropped command means the panel ignored us; an override is a
      // conflict, not a fault, so it's audited but not pushed.
      if (outcome.state === "dropped") {
        void sendAlert(
          "commandUnconfirmed",
          "Command didn't take effect",
          `${describeTarget(action)}: ${detail}.`
        ).catch(() => undefined);
      }
    },
  }).catch((err: unknown) => {
    console.error("[moonpool] verification failed to run", err);
  });
}

/** Execute one action. Never throws — failures come back in the result. */
export async function executeAction(action: PoolAction, ctx: ActionContext): Promise<ActionResult> {
  const runtime = getRuntime();
  const adapter = runtime.adapter;
  const snap = runtime.getSnapshot();
  const target = describeTarget(action);
  const deg = `°${snap.units}`;

  try {
    validate(action, ctx);
    let summary = "";
    let oldValue: string | null = null;
    let newValue: string | null = null;

    switch (action.type) {
      case "setCircuit": {
        const c = snap.circuits.find((x) => x.id === action.circuitId) ?? snap.features.find((x) => x.id === action.circuitId);
        oldValue = c ? (c.isOn ? "on" : "off") : null;
        newValue = action.state ? "on" : "off";
        await adapter.setCircuit(action.circuitId, action.state);
        summary = `${target} → ${newValue.toUpperCase()}`;
        break;
      }
      case "setHeat": {
        const b = snap.bodies.find((x) => x.id === action.bodyId);
        const parts: string[] = [];
        if (action.mode !== undefined) {
          oldValue = b?.heatMode ?? null;
          await adapter.setHeatMode(action.bodyId, action.mode);
          parts.push(`mode → ${action.mode}`);
        }
        if (action.setPoint !== undefined) {
          oldValue = oldValue ?? (b ? `${b.setPoint}${deg}` : null);
          await adapter.setSetPoint(action.bodyId, action.setPoint);
          parts.push(`setpoint → ${action.setPoint}${deg}`);
        }
        newValue = parts.join(", ");
        summary = `${target} ${parts.join(", ")}`;
        break;
      }
      case "setPumpSpeed": {
        const p = snap.pumps.find((x) => x.id === action.pumpId);
        oldValue = p ? `${p.rpm} rpm` : null;
        newValue = `${action.rpm} rpm`;
        await adapter.setPumpSpeed(action.pumpId, action.rpm);
        summary = `${target} → ${action.rpm} RPM`;
        break;
      }
      case "setChlorinator": {
        const c = snap.chlorinators.find((x) => x.id === action.chlorId);
        oldValue = c ? `pool ${c.poolSetpoint}% / spa ${c.spaSetpoint}%` : null;
        const parts: string[] = [];
        if (action.poolSetpoint !== undefined) parts.push(`pool ${action.poolSetpoint}%`);
        if (action.spaSetpoint !== undefined) parts.push(`spa ${action.spaSetpoint}%`);
        newValue = parts.join(" / ");
        await adapter.setChlorinator(action.chlorId, action.poolSetpoint, action.spaSetpoint);
        summary = `${target} output → ${newValue}`;
        break;
      }
      case "superChlorinate": {
        oldValue = snap.chlorinators.find((x) => x.id === action.chlorId)?.superChlor ? "on" : "off";
        newValue = action.on ? `on for ${action.hours}h` : "off";
        await adapter.setSuperChlor(action.chlorId, action.on, action.hours);
        summary = action.on ? `Super-chlorinate ${target} for ${action.hours}h` : `Super-chlorinate off on ${target}`;
        break;
      }
      case "setLightTheme": {
        const c = snap.circuits.find((x) => x.id === action.circuitId);
        oldValue = c?.lightTheme !== null && c?.lightTheme !== undefined ? themeName(c.lightTheme) : null;
        newValue = themeName(action.theme);
        await adapter.setLightTheme(action.circuitId, action.theme);
        summary = `${target} → ${newValue}`;
        break;
      }
      case "setLightGroupTheme": {
        const g = snap.lightGroups.find((x) => x.id === action.groupId);
        oldValue = g?.theme !== null && g?.theme !== undefined ? themeName(g.theme) : null;
        newValue = themeName(action.theme);
        await adapter.setLightGroupTheme(action.groupId, action.theme);
        summary = `${target} → ${newValue}`;
        break;
      }
      case "runScene": {
        const scene = getScene(action.sceneId);
        if (!scene) throw new AdapterError(`Unknown scene ${action.sceneId}`, 404);
        const results: ActionResult[] = [];
        for (const a of scene.actions) {
          // Scene actions run with the caller's audit identity but scene source.
          results.push(await executeAction(a, { ...ctx, source: ctx.source === "ui" ? "scene" : ctx.source }));
        }
        const failed = results.filter((r) => !r.ok);
        newValue = `${results.length - failed.length}/${results.length} actions ok`;
        summary =
          failed.length === 0
            ? `Scene "${scene.name}" run (${results.length} actions)`
            : `Scene "${scene.name}": ${failed.length} of ${results.length} actions failed`;
        if (failed.length > 0) {
          audit({ userId: ctx.userId, userName: ctx.userName, source: ctx.source, action: action.type, target, oldValue, newValue, ok: false, detail: failed.map((f) => f.error).join("; ") });
          return { ok: false, action, summary, error: failed.map((f) => f.error).join("; ") };
        }
        break;
      }
      case "allOff": {
        const onCircuits = [...snap.circuits, ...snap.features].filter((c) => c.isOn);
        for (const c of onCircuits) {
          await adapter.setCircuit(c.id, false);
        }
        oldValue = `${onCircuits.length} circuits on`;
        newValue = "all off";
        summary = `Everything off (${onCircuits.length} circuits)`;
        break;
      }
    }

    audit({ userId: ctx.userId, userName: ctx.userName, source: ctx.source, action: action.type, target, oldValue, newValue });
    // The adapter resolving only means the request was accepted. Confirm out of
    // band that the panel actually moved, and alert if it never does.
    startVerification(action, snap, ctx);
    return { ok: true, action, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    audit({ userId: ctx.userId, userName: ctx.userName, source: ctx.source, action: action.type, target, ok: false, detail: message });
    return { ok: false, action, summary: `${target}: failed`, error: message };
  }
}

export async function executeActions(actions: PoolAction[], ctx: ActionContext): Promise<ActionResult[]> {
  const results: ActionResult[] = [];
  for (const action of actions) {
    results.push(await executeAction(action, ctx));
  }
  return results;
}

/** Create a one-shot scheduled job (used by UI, copilot "…until midnight", automations). */
export function createScheduledJob(opts: {
  label: string;
  actions: PoolAction[];
  fireAt: number;
  ctx: ActionContext;
}): number {
  const res = getDb()
    .prepare(
      `INSERT INTO scheduled_jobs (label, actions, fire_at, created_by, source, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`
    )
    .run(opts.label, JSON.stringify(opts.actions), opts.fireAt, opts.ctx.userId, opts.ctx.source, now());
  audit({
    userId: opts.ctx.userId,
    userName: opts.ctx.userName,
    source: opts.ctx.source,
    action: "scheduleOnce",
    target: opts.label || "one-shot job",
    newValue: new Date(opts.fireAt).toISOString(),
  });
  return Number(res.lastInsertRowid);
}
