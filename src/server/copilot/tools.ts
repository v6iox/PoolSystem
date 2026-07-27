import type { AutomationTrigger, HeatModeInput, PoolAction } from "@/types/actions";
import type { BodyState, CircuitState, LightThemeDef, PoolStateSnapshot } from "@/types/pool";
import type { Role } from "@/types/auth";
import { roleAtLeast } from "@/types/auth";
import { validateTriggerShape } from "@/server/validate";
import { formatClock, formatDays, formatMinutes } from "@/lib/utils";

/**
 * The copilot tool vocabulary. The language model (or the deterministic mock
 * parser) may ONLY emit these structured calls — never free-form actions.
 * Every call is bounds-checked, name-resolved against the live snapshot and
 * role-gated here before anything reaches the control layer, which validates
 * again. This module is intentionally pure (no DB / runtime imports) so it can
 * be exercised directly in tests with an injected context.
 */

export type StatusScope = "temps" | "circuits" | "chemistry" | "equipment" | "all";

export interface ChemReadings {
  ph?: number;
  orp?: number;
  fc?: number;
  ta?: number;
  cya?: number;
  ch?: number;
  salt?: number;
}

export type ToolCall =
  | { tool: "get_status"; args: { scope?: StatusScope } }
  | { tool: "set_circuit"; args: { circuitId: number; state: boolean } }
  | { tool: "set_heat"; args: { body: "pool" | "spa"; mode?: HeatModeInput; setpoint?: number } }
  | { tool: "run_scene"; args: { sceneId: number } }
  | { tool: "set_light_theme"; args: { theme: string } }
  | { tool: "set_chlorinator"; args: { outputPct: number } }
  | { tool: "super_chlorinate"; args: { on: boolean; hours: number } }
  | { tool: "all_off"; args: Record<string, never> }
  | { tool: "schedule_once"; args: { actions: ToolCall[]; at: string } }
  | { tool: "create_schedule"; args: { circuitId: number; start: string; end: string; days: number[] } }
  | { tool: "list_schedules"; args: Record<string, never> }
  | { tool: "delete_schedule"; args: { id: number } }
  | { tool: "create_automation"; args: { name: string; trigger: AutomationTrigger; actions: ToolCall[] } }
  | { tool: "list_automations"; args: Record<string, never> }
  | { tool: "pause_automation"; args: { id: number } }
  | { tool: "resume_automation"; args: { id: number } }
  | { tool: "delete_automation"; args: { id: number } }
  | { tool: "log_chemistry"; args: { readings: ChemReadings } }
  | { tool: "cancel_pending"; args: Record<string, never> };

export type ToolName = ToolCall["tool"];

/** Everything the parser/validator needs, injected so tests skip DB + runtime. */
export interface SceneLite {
  id: number;
  name: string;
  guestVisible: boolean;
}

export interface AutomationLite {
  id: number;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
}

export interface PendingPlanRef {
  messageId: number;
  summary: string[];
}

export interface CopilotContext {
  snapshot: PoolStateSnapshot;
  scenes: SceneLite[];
  automations: AutomationLite[];
  pendingPlan: PendingPlanRef | null;
  role: Role;
  /** circuit_meta rows with guest_visible = 1, straight from the DB. */
  guestVisibleCircuitIds: ReadonlySet<number>;
}

/* ── JSON Schemas (drive Ollama structured output + shape validation) ───── */

export type JsonSchema = Record<string, unknown>;

const CHEM_FIELDS = ["ph", "orp", "fc", "ta", "cya", "ch", "salt"] as const;

export const CHEM_BOUNDS: Record<(typeof CHEM_FIELDS)[number], [number, number]> = {
  ph: [5, 10],
  orp: [200, 1000],
  fc: [0, 30],
  ta: [0, 400],
  cya: [0, 300],
  ch: [0, 1500],
  salt: [0, 10000],
};

const TRIGGER_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    type: { type: "string", enum: ["cron", "time", "sun", "tempThreshold", "saltLow", "freezeProtect", "event"] },
    expression: { type: "string" },
    at: { type: "string", description: "HH:MM 24h" },
    days: { type: "array", items: { type: "number" }, description: "0=Sun..6=Sat, empty = every day" },
    event: { type: "string" },
    offsetMinutes: { type: "number" },
    sensor: { type: "string" },
    direction: { type: "string", enum: ["above", "below"] },
    value: { type: "number" },
    chlorId: { type: "number" },
    belowPpm: { type: "number" },
  },
  required: ["type"],
};

export interface ToolDef {
  name: ToolName;
  description: string;
  argsSchema: JsonSchema;
}

function objSchema(properties: Record<string, unknown>, required: string[] = []): JsonSchema {
  return { type: "object", properties, required, additionalProperties: false };
}

/** Tools that map directly to pool actions (allowed inside schedules/automations). */
export const EXECUTABLE_TOOLS: ReadonlySet<ToolName> = new Set([
  "set_circuit",
  "set_heat",
  "run_scene",
  "set_light_theme",
  "set_chlorinator",
  "super_chlorinate",
  "all_off",
]);

export const READ_ONLY_TOOLS: ReadonlySet<ToolName> = new Set(["get_status", "list_automations", "list_schedules"]);

export function isReadOnlyTool(tool: ToolName): boolean {
  return READ_ONLY_TOOLS.has(tool);
}

const EXEC_CALL_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    tool: { type: "string", enum: [...EXECUTABLE_TOOLS] },
    args: { type: "object" },
  },
  required: ["tool", "args"],
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: "get_status",
    description: "Answer questions about the pool. scope: temps|circuits|chemistry|equipment|all",
    argsSchema: objSchema({ scope: { type: "string", enum: ["temps", "circuits", "chemistry", "equipment", "all"] } }),
  },
  {
    name: "set_circuit",
    description: "Turn a circuit/feature on or off by its numeric id from the state summary",
    argsSchema: objSchema({ circuitId: { type: "number" }, state: { type: "boolean" } }, ["circuitId", "state"]),
  },
  {
    name: "set_heat",
    description: "Change heat mode and/or setpoint (60-104°) for the pool or spa",
    argsSchema: objSchema(
      {
        body: { type: "string", enum: ["pool", "spa"] },
        mode: { type: "string", enum: ["off", "heater", "solar", "solarpref"] },
        setpoint: { type: "number" },
      },
      ["body"]
    ),
  },
  {
    name: "run_scene",
    description: "Run a saved scene by its numeric id",
    argsSchema: objSchema({ sceneId: { type: "number" } }, ["sceneId"]),
  },
  {
    name: "set_light_theme",
    description: "Set all pool lights to a named color/show theme (matched against available themes)",
    argsSchema: objSchema({ theme: { type: "string" } }, ["theme"]),
  },
  {
    name: "set_chlorinator",
    description: "Set chlorinator pool output percentage 0-100",
    argsSchema: objSchema({ outputPct: { type: "number" } }, ["outputPct"]),
  },
  {
    name: "super_chlorinate",
    description: "Start (on=true) or stop super-chlorination, hours 1-72 (default 24)",
    argsSchema: objSchema({ on: { type: "boolean" }, hours: { type: "number" } }),
  },
  { name: "all_off", description: "Turn every circuit off", argsSchema: objSchema({}) },
  {
    name: "schedule_once",
    description: 'Run actions later, once. at: ISO datetime or "HH:MM" (next occurrence, tonight semantics)',
    argsSchema: objSchema({ actions: { type: "array", items: EXEC_CALL_SCHEMA }, at: { type: "string" } }, ["actions", "at"]),
  },
  {
    name: "create_automation",
    description: "Create a recurring automation with a trigger (time/sun/cron/temp) and actions",
    argsSchema: objSchema(
      { name: { type: "string" }, trigger: TRIGGER_SCHEMA, actions: { type: "array", items: EXEC_CALL_SCHEMA } },
      ["name", "trigger", "actions"]
    ),
  },
  {
    name: "create_schedule",
    description:
      'Create a PANEL schedule: a recurring daily/weekly ON window for one circuit (runs in the Pentair panel itself). start/end "HH:MM" 24h; days 0=Sun..6=Sat, [] = every day',
    argsSchema: objSchema(
      {
        circuitId: { type: "number" },
        start: { type: "string" },
        end: { type: "string" },
        days: { type: "array", items: { type: "number" } },
      },
      ["circuitId", "start", "end"]
    ),
  },
  { name: "list_schedules", description: "List the panel schedules", argsSchema: objSchema({}) },
  { name: "delete_schedule", description: "Delete a panel schedule by id", argsSchema: objSchema({ id: { type: "number" } }, ["id"]) },
  { name: "list_automations", description: "List the saved automations", argsSchema: objSchema({}) },
  { name: "pause_automation", description: "Pause an automation by id", argsSchema: objSchema({ id: { type: "number" } }, ["id"]) },
  { name: "resume_automation", description: "Resume a paused automation by id", argsSchema: objSchema({ id: { type: "number" } }, ["id"]) },
  { name: "delete_automation", description: "Delete an automation by id", argsSchema: objSchema({ id: { type: "number" } }, ["id"]) },
  {
    name: "log_chemistry",
    description: "Log a manual water test reading (ph, orp, fc, ta, cya, ch, salt)",
    argsSchema: objSchema(
      {
        readings: objSchema(Object.fromEntries(CHEM_FIELDS.map((f) => [f, { type: "number" }]))),
      },
      ["readings"]
    ),
  },
  { name: "cancel_pending", description: "Cancel the user's pending (unconfirmed) plan", argsSchema: objSchema({}) },
];

/** Response contract forced onto the LLM so malformed output is impossible. */
export const RESPONSE_JSON_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    tool_calls: {
      type: "array",
      items: {
        anyOf: TOOL_DEFS.map((def) => ({
          type: "object",
          properties: { tool: { const: def.name }, args: def.argsSchema },
          required: ["tool", "args"],
          additionalProperties: false,
        })),
      },
    },
    needs_confirmation_note: { type: "string" },
    /** Conversational reply, used ONLY when tool_calls is empty (greetings,
     *  small talk). Facts and action results always come from templates. */
    reply: { type: "string" },
  },
  required: ["tool_calls"],
  additionalProperties: false,
};

/* ── name → id resolution against the live snapshot ─────────────────────── */

export function allCircuits(snapshot: PoolStateSnapshot): CircuitState[] {
  return [...snapshot.circuits, ...snapshot.features];
}

export function findCircuit(ctx: CopilotContext, ref: number | string): CircuitState | undefined {
  const circuits = allCircuits(ctx.snapshot);
  if (typeof ref === "number") return circuits.find((c) => c.id === ref);
  const name = ref.trim().toLowerCase();
  if (!name) return undefined;
  return (
    circuits.find((c) => c.name.toLowerCase() === name) ??
    circuits.find((c) => c.name.toLowerCase().includes(name))
  );
}

export function findBody(ctx: CopilotContext, kind: string): BodyState | undefined {
  const k = kind.trim().toLowerCase();
  return (
    ctx.snapshot.bodies.find((b) => b.kind === k) ??
    ctx.snapshot.bodies.find((b) => b.name.toLowerCase() === k) ??
    ctx.snapshot.bodies.find((b) => b.name.toLowerCase().includes(k))
  );
}

export function resolveLightTheme(ctx: CopilotContext, theme: string | number): LightThemeDef | undefined {
  if (typeof theme === "number") return ctx.snapshot.lightThemes.find((t) => t.val === theme);
  const name = theme.trim().toLowerCase();
  if (!name) return undefined;
  return (
    ctx.snapshot.lightThemes.find((t) => t.name.toLowerCase() === name) ??
    ctx.snapshot.lightThemes.find((t) => t.name.toLowerCase().includes(name))
  );
}

export function lightTargets(ctx: CopilotContext): { groups: PoolStateSnapshot["lightGroups"]; lights: CircuitState[] } {
  return {
    groups: ctx.snapshot.lightGroups,
    lights: allCircuits(ctx.snapshot).filter((c) => c.isLight),
  };
}

/** "HH:MM" (24h) → minutes from midnight, or null. */
export function parseHHMM(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Resolve a schedule "at" ("HH:MM" tonight-semantics, or ISO) to epoch ms. */
export function resolveAt(at: string, nowMs: number = Date.now()): number | null {
  const hm = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (hm && hm[1] !== undefined && hm[2] !== undefined) {
    const hour = Number(hm[1]);
    const minute = Number(hm[2]);
    if (hour > 23 || minute > 59) return null;
    const d = new Date(nowMs);
    d.setHours(hour, minute, 0, 0);
    if (d.getTime() <= nowMs + 30_000) d.setDate(d.getDate() + 1); // already passed today → tonight/tomorrow
    return d.getTime();
  }
  const parsed = Date.parse(at);
  return Number.isFinite(parsed) ? parsed : null;
}

/* ── validation ─────────────────────────────────────────────────────────── */

export type ValidationResult = { ok: true; call: ToolCall } | { ok: false; error: string };

const GUEST_TOOLS: ReadonlySet<ToolName> = new Set(["get_status", "set_circuit", "set_light_theme", "run_scene", "cancel_pending"]);

const GUEST_DENIED =
  "Guests can check status, use circuits and lights shared with guests, and run shared scenes — ask the owner for a family account to do more.";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function fail(error: string): ValidationResult {
  return { ok: false, error };
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Validate one raw call (from the LLM, mock parser or a stored plan) against
 * the live context. Returns a normalized, safe-to-store ToolCall or a
 * friendly, template-ready error.
 */
export function validateToolCall(raw: unknown, ctx: CopilotContext): ValidationResult {
  const obj = asRecord(raw);
  if (!obj || typeof obj.tool !== "string") return fail("That request didn't translate into a pool command.");
  const tool = obj.tool as ToolName;
  if (!TOOL_DEFS.some((d) => d.name === tool)) return fail(`I don't have a "${obj.tool}" ability.`);
  const args = asRecord(obj.args) ?? {};
  const isGuest = !roleAtLeast(ctx.role, "family");
  if (isGuest && !GUEST_TOOLS.has(tool)) return fail(GUEST_DENIED);

  switch (tool) {
    case "get_status": {
      const scope = typeof args.scope === "string" ? args.scope : undefined;
      const scopes: StatusScope[] = ["temps", "circuits", "chemistry", "equipment", "all"];
      return {
        ok: true,
        call: { tool, args: { scope: scopes.includes(scope as StatusScope) ? (scope as StatusScope) : "all" } },
      };
    }

    case "set_circuit": {
      const ref = num(args.circuitId) ?? (typeof args.name === "string" ? args.name : typeof args.circuit === "string" ? args.circuit : undefined);
      if (ref === undefined) return fail("Which circuit should I switch? I couldn't tell.");
      const circuit = findCircuit(ctx, ref);
      if (!circuit) return fail(`I can't find a circuit called "${String(ref)}" on this system.`);
      if (typeof args.state !== "boolean") return fail(`Should ${circuit.name} be on or off? I couldn't tell.`);
      if (isGuest && !ctx.guestVisibleCircuitIds.has(circuit.id)) {
        return fail(`"${circuit.name}" isn't shared with guest accounts.`);
      }
      return { ok: true, call: { tool, args: { circuitId: circuit.id, state: args.state } } };
    }

    case "set_heat": {
      const bodyRef = typeof args.body === "string" ? args.body : "";
      const body = findBody(ctx, bodyRef || "spa");
      if (!body) return fail(bodyRef ? `There's no ${bodyRef} on this system.` : "There's no body of water to heat.");
      const mode = typeof args.mode === "string" ? (args.mode as HeatModeInput) : undefined;
      if (mode !== undefined) {
        if (!["off", "heater", "solar", "solarpref"].includes(mode)) return fail(`"${String(args.mode)}" isn't a heat mode I know.`);
        if (!body.supportedHeatModes.includes(mode)) return fail(`${body.name} doesn't support ${mode} heating.`);
      }
      let setpoint = num(args.setpoint);
      if (setpoint !== undefined) {
        setpoint = Math.round(setpoint);
        const lo = Math.max(60, body.minSetPoint);
        const hi = Math.min(104, body.maxSetPoint);
        if (setpoint < lo || setpoint > hi) {
          return fail(`${body.name} setpoint needs to be between ${lo}° and ${hi}°${ctx.snapshot.units}.`);
        }
      }
      if (mode === undefined && setpoint === undefined) return fail(`What should I do with the ${body.name.toLowerCase()} heat — a mode or a temperature?`);
      const call: ToolCall = { tool, args: { body: body.kind } };
      if (mode !== undefined) call.args.mode = mode;
      if (setpoint !== undefined) call.args.setpoint = setpoint;
      return { ok: true, call };
    }

    case "run_scene": {
      const ref = num(args.sceneId) ?? (typeof args.name === "string" ? args.name : undefined);
      const scene =
        typeof ref === "number"
          ? ctx.scenes.find((s) => s.id === ref)
          : typeof ref === "string"
            ? ctx.scenes.find((s) => s.name.toLowerCase() === ref.toLowerCase()) ??
              ctx.scenes.find((s) => s.name.toLowerCase().includes(ref.toLowerCase()))
            : undefined;
      if (!scene) return fail("I couldn't find that scene.");
      if (isGuest && !scene.guestVisible) return fail(`The "${scene.name}" scene isn't shared with guests.`);
      return { ok: true, call: { tool, args: { sceneId: scene.id } } };
    }

    case "set_light_theme": {
      const themeRef = typeof args.theme === "string" ? args.theme : num(args.theme);
      if (themeRef === undefined || themeRef === "") return fail("Which light color or show did you want?");
      const theme = resolveLightTheme(ctx, themeRef);
      if (!theme) {
        const available = ctx.snapshot.lightThemes.slice(0, 8).map((t) => t.name).join(", ");
        return fail(`I don't see a "${String(themeRef)}" light theme.${available ? ` Available: ${available}…` : ""}`);
      }
      const { groups, lights } = lightTargets(ctx);
      const targets = groups.length > 0 ? groups.length : lights.length;
      if (targets === 0) return fail(isGuest ? "No lights are shared with guest accounts." : "This system doesn't report any lights.");
      if (isGuest && groups.length === 0 && !lights.some((l) => ctx.guestVisibleCircuitIds.has(l.id))) {
        return fail("No lights are shared with guest accounts.");
      }
      return { ok: true, call: { tool, args: { theme: theme.name } } };
    }

    case "set_chlorinator": {
      const chlor = ctx.snapshot.chlorinators[0];
      if (!chlor) return fail("This system doesn't report a chlorinator.");
      const pct = num(args.outputPct);
      if (pct === undefined || pct < 0 || pct > 100) return fail("Chlorinator output needs to be 0–100%.");
      return { ok: true, call: { tool, args: { outputPct: Math.round(pct) } } };
    }

    case "super_chlorinate": {
      const chlor = ctx.snapshot.chlorinators[0];
      if (!chlor) return fail("This system doesn't report a chlorinator.");
      const on = typeof args.on === "boolean" ? args.on : true;
      const hours = Math.round(num(args.hours) ?? 24);
      if (hours < 1 || hours > 72) return fail("Super-chlorinate runs for 1–72 hours.");
      return { ok: true, call: { tool, args: { on, hours } } };
    }

    case "all_off":
      return { ok: true, call: { tool, args: {} } };

    case "schedule_once": {
      if (typeof args.at !== "string") return fail("When should that happen? I couldn't work out the time.");
      const fireAt = resolveAt(args.at);
      if (fireAt === null) return fail(`I couldn't understand the time "${args.at}".`);
      if (fireAt <= Date.now()) return fail("That time is already in the past.");
      if (!Array.isArray(args.actions) || args.actions.length === 0) return fail("There was nothing to schedule.");
      if (args.actions.length > 10) return fail("That's too many steps for one schedule (max 10).");
      const inner: ToolCall[] = [];
      for (const rawInner of args.actions) {
        const v = validateToolCall(rawInner, ctx);
        if (!v.ok) return v;
        if (!EXECUTABLE_TOOLS.has(v.call.tool)) return fail("Only direct pool actions can be scheduled.");
        inner.push(v.call);
      }
      return { ok: true, call: { tool, args: { actions: inner, at: args.at } } };
    }

    case "create_automation": {
      const name = typeof args.name === "string" ? args.name.trim().slice(0, 60) : "";
      if (!name) return fail("The automation needs a name.");
      const triggerErr = validateTriggerShape(args.trigger);
      if (triggerErr) return fail(`That trigger doesn't work: ${triggerErr}.`);
      if (!Array.isArray(args.actions) || args.actions.length === 0) return fail("The automation needs at least one action.");
      if (args.actions.length > 10) return fail("That's too many steps for one automation (max 10).");
      const inner: ToolCall[] = [];
      for (const rawInner of args.actions) {
        const v = validateToolCall(rawInner, ctx);
        if (!v.ok) return v;
        if (!EXECUTABLE_TOOLS.has(v.call.tool)) return fail("Automations can only contain direct pool actions.");
        inner.push(v.call);
      }
      return { ok: true, call: { tool, args: { name, trigger: args.trigger as AutomationTrigger, actions: inner } } };
    }

    case "create_schedule": {
      if (isGuest) return fail(GUEST_DENIED);
      const ref = num(args.circuitId) ?? (typeof args.circuit === "string" ? args.circuit : typeof args.name === "string" ? args.name : undefined);
      if (ref === undefined) return fail("Which circuit should the schedule run? I couldn't tell.");
      const circuit = findCircuit(ctx, ref);
      if (!circuit) return fail(`I can't find a circuit called "${String(ref)}" on this system.`);
      const start = parseHHMM(args.start);
      const end = parseHHMM(args.end);
      if (start === null || end === null) return fail('Schedule times need to be like "09:00" and "17:30" (24h).');
      if (start === end) return fail("The schedule's start and end are the same time.");
      const days = Array.isArray(args.days) ? args.days.map((d) => num(d)).filter((d): d is number => d !== undefined && d >= 0 && d <= 6) : [];
      return { ok: true, call: { tool, args: { circuitId: circuit.id, start: args.start as string, end: args.end as string, days } } };
    }

    case "list_schedules":
      if (isGuest) return fail(GUEST_DENIED);
      return { ok: true, call: { tool, args: {} } };

    case "delete_schedule": {
      if (isGuest) return fail(GUEST_DENIED);
      const id = num(args.id);
      const schedule = ctx.snapshot.schedules.find((s) => s.id === id);
      if (!schedule) return fail(`There's no panel schedule with id ${String(args.id)} — ask me to list the schedules first.`);
      return { ok: true, call: { tool, args: { id: schedule.id } } };
    }

    case "list_automations":
      return { ok: true, call: { tool, args: {} } };

    case "pause_automation":
    case "resume_automation":
    case "delete_automation": {
      const ref = num(args.id) ?? (typeof args.name === "string" ? args.name : undefined);
      const automation =
        typeof ref === "number"
          ? ctx.automations.find((a) => a.id === ref)
          : typeof ref === "string"
            ? ctx.automations.find((a) => a.name.toLowerCase() === ref.toLowerCase()) ??
              ctx.automations.find((a) => a.name.toLowerCase().includes(ref.toLowerCase()))
            : undefined;
      if (!automation) return fail("I couldn't find that automation — say “list automations” to see them.");
      return { ok: true, call: { tool, args: { id: automation.id } } };
    }

    case "log_chemistry": {
      const readingsRaw = asRecord(args.readings) ?? args;
      const readings: ChemReadings = {};
      let count = 0;
      for (const field of CHEM_FIELDS) {
        const v = num(readingsRaw[field]);
        if (v === undefined) continue;
        const bounds = CHEM_BOUNDS[field];
        if (v < bounds[0] || v > bounds[1]) {
          return fail(`${field.toUpperCase()} of ${v} looks out of range (${bounds[0]}–${bounds[1]}) — double-check the reading.`);
        }
        readings[field] = v;
        count += 1;
      }
      if (count === 0) return fail("I couldn't find any readings to log.");
      return { ok: true, call: { tool, args: { readings } } };
    }

    case "cancel_pending":
      return { ok: true, call: { tool, args: {} } };
  }
}

/* ── ToolCall → PoolAction[] (for the shared control layer) ─────────────── */

export function toolCallToActions(call: ToolCall, ctx: CopilotContext): PoolAction[] {
  switch (call.tool) {
    case "set_circuit":
      return [{ type: "setCircuit", circuitId: call.args.circuitId, state: call.args.state }];
    case "set_heat": {
      const body = findBody(ctx, call.args.body);
      if (!body) return [];
      const action: Extract<PoolAction, { type: "setHeat" }> = { type: "setHeat", bodyId: body.id };
      if (call.args.mode !== undefined) action.mode = call.args.mode;
      if (call.args.setpoint !== undefined) action.setPoint = call.args.setpoint;
      return [action];
    }
    case "run_scene":
      return [{ type: "runScene", sceneId: call.args.sceneId }];
    case "set_light_theme": {
      const theme = resolveLightTheme(ctx, call.args.theme);
      if (!theme) return [];
      const { groups, lights } = lightTargets(ctx);
      if (groups.length > 0) return groups.map((g) => ({ type: "setLightGroupTheme", groupId: g.id, theme: theme.val }));
      return lights.map((l) => ({ type: "setLightTheme", circuitId: l.id, theme: theme.val }));
    }
    case "set_chlorinator": {
      const chlor = ctx.snapshot.chlorinators[0];
      if (!chlor) return [];
      return [{ type: "setChlorinator", chlorId: chlor.id, poolSetpoint: call.args.outputPct }];
    }
    case "super_chlorinate": {
      const chlor = ctx.snapshot.chlorinators[0];
      if (!chlor) return [];
      return [{ type: "superChlorinate", chlorId: chlor.id, hours: call.args.hours, on: call.args.on }];
    }
    case "all_off":
      return [{ type: "allOff" }];
    default:
      return [];
  }
}

/* ── template descriptions (used for plan cards + audit labels) ─────────── */

export function describeTrigger(trigger: AutomationTrigger): string {
  switch (trigger.type) {
    case "time": {
      const [h, m] = trigger.at.split(":").map(Number);
      const label = formatMinutes((h ?? 0) * 60 + (m ?? 0));
      return `${trigger.days.length === 0 || trigger.days.length === 7 ? "every day" : formatDays(trigger.days)} at ${label}`;
    }
    case "sun": {
      const offset =
        trigger.offsetMinutes === 0
          ? ""
          : ` ${Math.abs(trigger.offsetMinutes)}m ${trigger.offsetMinutes < 0 ? "before" : "after"}`;
      const days = trigger.days.length === 0 || trigger.days.length === 7 ? "every day" : formatDays(trigger.days);
      return `${days} at ${trigger.event}${offset}`;
    }
    case "cron":
      return `on schedule (${trigger.expression})`;
    case "tempThreshold":
      return `when ${trigger.sensor === "air" ? "air temp" : "water temp"} goes ${trigger.direction} ${trigger.value}°`;
    case "saltLow":
      return `when salt drops below ${trigger.belowPpm} ppm`;
    case "freezeProtect":
      return "when freeze protection activates";
    case "event":
      return `on ${trigger.event}`;
  }
}

export function describeToolCall(call: ToolCall, ctx: CopilotContext): string {
  const deg = `°${ctx.snapshot.units}`;
  switch (call.tool) {
    case "get_status":
      return "Check status";
    case "set_circuit": {
      const c = findCircuit(ctx, call.args.circuitId);
      return `${c?.name ?? `Circuit ${call.args.circuitId}`} → ${call.args.state ? "ON" : "OFF"}`;
    }
    case "set_heat": {
      const body = findBody(ctx, call.args.body);
      const name = body?.name ?? (call.args.body === "spa" ? "Spa" : "Pool");
      const parts: string[] = [];
      if (call.args.mode !== undefined) parts.push(call.args.mode === "off" ? "heat OFF" : `${call.args.mode} ON`);
      if (call.args.setpoint !== undefined) parts.push(`set to ${call.args.setpoint}${deg}`);
      return `${name} — ${parts.join(", ")}`;
    }
    case "run_scene": {
      const scene = ctx.scenes.find((s) => s.id === call.args.sceneId);
      return `Run scene “${scene?.name ?? call.args.sceneId}”`;
    }
    case "set_light_theme": {
      const theme = resolveLightTheme(ctx, call.args.theme);
      return `All lights → ${theme?.name ?? call.args.theme}`;
    }
    case "set_chlorinator":
      return `Chlorinator pool output → ${call.args.outputPct}%`;
    case "super_chlorinate":
      return call.args.on ? `Super-chlorinate for ${call.args.hours}h` : "Super-chlorinate OFF";
    case "all_off": {
      const on = allCircuits(ctx.snapshot).filter((c) => c.isOn).length;
      return on > 0 ? `Everything OFF (${on} circuit${on === 1 ? "" : "s"} on now)` : "Everything OFF";
    }
    case "schedule_once": {
      const fireAt = resolveAt(call.args.at);
      const when = fireAt !== null ? formatClock(fireAt) : call.args.at;
      const inner = call.args.actions.map((a) => describeToolCall(a, ctx)).join("; ");
      return `At ${when}: ${inner}`;
    }
    case "create_automation": {
      const inner = call.args.actions.map((a) => describeToolCall(a, ctx)).join("; ");
      return `New automation “${call.args.name}” — ${describeTrigger(call.args.trigger)}: ${inner}`;
    }
    case "create_schedule": {
      const circuit = allCircuits(ctx.snapshot).find((c) => c.id === call.args.circuitId);
      const start = parseHHMM(call.args.start);
      const end = parseHHMM(call.args.end);
      const window = `${start !== null ? formatMinutes(start) : call.args.start}–${end !== null ? formatMinutes(end) : call.args.end}`;
      return `Panel schedule: ${circuit?.name ?? `circuit ${call.args.circuitId}`} ${window} · ${formatDays(call.args.days.length > 0 ? call.args.days : [0, 1, 2, 3, 4, 5, 6])}`;
    }
    case "list_schedules":
      return "List panel schedules";
    case "delete_schedule": {
      const schedule = ctx.snapshot.schedules.find((s) => s.id === call.args.id);
      return `Delete panel schedule — ${schedule ? `${schedule.circuitName} ${formatMinutes(schedule.startTime)}–${formatMinutes(schedule.endTime)}` : `id ${call.args.id}`}`;
    }
    case "list_automations":
      return "List automations";
    case "pause_automation":
    case "resume_automation":
    case "delete_automation": {
      const a = ctx.automations.find((x) => x.id === call.args.id);
      const verb = call.tool === "pause_automation" ? "Pause" : call.tool === "resume_automation" ? "Resume" : "Delete";
      return `${verb} automation “${a?.name ?? call.args.id}”`;
    }
    case "log_chemistry": {
      const pairs = Object.entries(call.args.readings)
        .map(([k, v]) => `${k === "ph" ? "pH" : k.toUpperCase()} ${v}`)
        .join(" · ");
      return `Log water test — ${pairs}`;
    }
    case "cancel_pending":
      return "Cancel pending plan";
  }
}
