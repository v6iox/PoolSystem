import type { CopilotContext } from "./tools";
import { EXECUTABLE_TOOLS } from "./tools";
import { detectTimeIntent, hasTemporalCue, isRecurring, mentionedBodyKind, mentionedCircuits, mentionsTemperature, normalize } from "./nlu";

/**
 * Deterministic grounding of LLM output against the user's own words.
 *
 * A small local model is good at picking a tool and bad at the details that
 * decide which physical thing moves and when: it reads "hot tub" as the pool,
 * does clock arithmetic instead of passing the clock time through, fires an
 * action immediately *and* schedules it, and invents setpoints nobody asked
 * for. All four are things a regex can settle from the utterance alone, so we
 * settle them here rather than hoping a 0.6B model behaves.
 *
 * Every rule is conservative: it only rewrites when the user's phrasing is
 * unambiguous, and it never invents an action the model didn't propose. The
 * corrections are returned so they can be logged and asserted in tests.
 */

export interface Correction {
  rule: "body" | "circuit" | "setpoint" | "timing" | "wrap" | "unwrap" | "duplicate" | "heat-mode" | "polarity" | "automation";
  detail: string;
}

const MANAGE_TOOLS = new Set(["pause_automation", "resume_automation", "delete_automation"]);

const HEAT_VERB = /\b(heat|heats|heating|warm|warms|warming|fire up|crank|get .{0,12}(hot|warm))\b/;
const OFF_WORD = /\b(off|stop|stops|stopping|end|ends|cancel|cancels|halt|quit|kill|don'?t|no longer)\b/;

interface RawCall {
  tool?: unknown;
  args?: unknown;
}

type ArgsRecord = Record<string, unknown>;

function asCall(value: unknown): { tool: string; args: ArgsRecord } | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as RawCall;
  if (typeof raw.tool !== "string") return null;
  const args = raw.args !== null && typeof raw.args === "object" && !Array.isArray(raw.args) ? (raw.args as ArgsRecord) : {};
  return { tool: raw.tool, args };
}

/** Identity of the thing an action moves — used to spot the same action twice. */
function actionKey(call: { tool: string; args: ArgsRecord }): string {
  switch (call.tool) {
    case "set_circuit":
      return `set_circuit:${String(call.args.circuitId)}`;
    case "set_heat":
      return `set_heat:${String(call.args.body)}`;
    case "run_scene":
      return `run_scene:${String(call.args.sceneId)}`;
    case "set_light_theme":
      return `set_light_theme:${String(call.args.circuit ?? "*")}`;
    default:
      return call.tool;
  }
}

/** Apply `fn` to every executable action, including those nested in a schedule/automation/scene. */
function mapActions(calls: unknown[], fn: (call: { tool: string; args: ArgsRecord }) => void): void {
  for (const raw of calls) {
    const call = asCall(raw);
    if (!call) continue;
    if (EXECUTABLE_TOOLS.has(call.tool as never)) fn(call);
    if (Array.isArray(call.args.actions)) mapActions(call.args.actions, fn);
  }
}

/** Utterances that split into independent clauses — "X at 8 but Y" — where a
 *  single time phrase can't be assumed to cover every action. */
const SEGMENTED = /\s+but\s+|\s+and then\s+|\s*;\s*|,\s*then\s+/;

export interface GroundedPlan {
  calls: unknown[];
  corrections: Correction[];
}

export function groundPlan(text: string, rawCalls: unknown[], ctx: CopilotContext): GroundedPlan {
  const t = normalize(text);
  const corrections: Correction[] = [];
  // Deep clone so a rewrite never mutates the caller's objects.
  let calls: unknown[] = JSON.parse(JSON.stringify(rawCalls)) as unknown[];

  /* ── 1. body: "turn on the hot tub" is never the pool ─────────────────── */
  const body = mentionedBodyKind(t, ctx);
  if (body !== null) {
    mapActions(calls, (call) => {
      if (call.tool !== "set_heat") return;
      const got = call.args.body;
      if (typeof got === "string" && got !== body) {
        corrections.push({ rule: "body", detail: `set_heat body ${got} → ${body} (you said "${body === "spa" ? "spa/hot tub" : "pool"}")` });
        call.args.body = body;
      } else if (got === undefined) {
        // tools.ts defaults a missing body to the spa; make it explicit.
        corrections.push({ rule: "body", detail: `set_heat body was missing → ${body}` });
        call.args.body = body;
      }
    });
  }

  /* ── 2. circuit: only rewrite when the user named exactly one ─────────── */
  const mentioned = mentionedCircuits(t, ctx);
  if (mentioned.length === 1) {
    const only = mentioned[0] as { id: number; name: string };
    mapActions(calls, (call) => {
      if (call.tool !== "set_circuit") return;
      const got = call.args.circuitId;
      if (typeof got === "number" && got !== only.id) {
        corrections.push({ rule: "circuit", detail: `set_circuit ${got} → ${only.id} ("${only.name}" is the only circuit you named)` });
        call.args.circuitId = only.id;
      }
    });
  }

  /* ── 3. setpoint: don't move a target the user never mentioned ────────── */
  if (!mentionsTemperature(t)) {
    mapActions(calls, (call) => {
      if (call.tool !== "set_heat") return;
      if (call.args.setpoint === undefined) return;
      // Dropping the setpoint would leave an empty call; keep it only if a mode remains.
      if (call.args.mode === undefined) return;
      corrections.push({ rule: "setpoint", detail: `dropped invented setpoint ${String(call.args.setpoint)} (no temperature in the request)` });
      delete call.args.setpoint;
    });
  }

  /* ── 2b. a panel schedule needs a circuit the user already named ──────── */
  if (mentioned.length === 1) {
    const only = mentioned[0] as { id: number; name: string };
    for (const raw of calls) {
      const call = asCall(raw);
      if (call?.tool !== "create_schedule") continue;
      const got = call.args.circuitId;
      if (typeof got === "number" && got === only.id) continue;
      corrections.push({
        rule: "circuit",
        detail: `panel schedule targets "${only.name}"${typeof got === "number" ? ` (was ${got})` : " (was unset)"}`,
      });
      call.args.circuitId = only.id;
    }
  }

  /* ── 2c. automation management by name → the id the tool needs ────────── */
  for (const raw of calls) {
    const call = asCall(raw);
    if (!call || !MANAGE_TOOLS.has(call.tool)) continue;
    if (typeof call.args.id === "number") continue;
    // The model often echoes the automation's name where an id belongs.
    const named = typeof call.args.id === "string" ? call.args.id : typeof call.args.name === "string" ? call.args.name : t;
    const match = ctx.automations.find((a) => a.name && normalize(named).includes(normalize(a.name)));
    if (!match) continue;
    corrections.push({ rule: "automation", detail: `resolved “${match.name}” to automation ${match.id}` });
    call.args.id = match.id;
  }

  /* ── 3b. a setpoint with the heater off never heats anything ──────────── */
  if (HEAT_VERB.test(t) && !OFF_WORD.test(t)) {
    mapActions(calls, (call) => {
      if (call.tool !== "set_heat") return;
      if (call.args.mode !== undefined || call.args.setpoint === undefined) return;
      const kind = typeof call.args.body === "string" ? call.args.body : body;
      const target = ctx.snapshot.bodies.find((b) => b.kind === kind);
      if (!target || target.heatMode !== "off" || !target.supportedHeatModes.includes("heater")) return;
      corrections.push({ rule: "heat-mode", detail: `turned the ${target.name.toLowerCase()} heater on — a target alone won't heat while heat is off` });
      call.args.mode = "heater";
    });
  }

  /* ── 3c. "stop the shock" must not start one ──────────────────────────── */
  if (OFF_WORD.test(t)) {
    mapActions(calls, (call) => {
      if (call.tool !== "super_chlorinate") return;
      if (call.args.on === false) return;
      corrections.push({ rule: "polarity", detail: "super-chlorinate OFF — the request was to stop it" });
      call.args.on = false;
    });
  }

  /* ── 4. timing ────────────────────────────────────────────────────────── */
  if (!isRecurring(t)) {
    const intent = detectTimeIntent(t);
    const schedules = calls.filter((c) => asCall(c)?.tool === "schedule_once");

    if (intent.kind !== "none") {
      // 4a. Make every schedule_once say what the user said.
      for (const raw of schedules) {
        const call = asCall(raw);
        if (!call) continue;
        if (intent.kind === "absolute") {
          const want = intent.dayOffset === 1 ? isoTomorrow(intent.at) : intent.at;
          if (call.args.at !== want || call.args.inMinutes !== undefined) {
            corrections.push({
              rule: "timing",
              detail: `schedule fires at ${want}${call.args.inMinutes !== undefined ? ` (was inMinutes ${String(call.args.inMinutes)})` : ""}`,
            });
          }
          call.args.at = want;
          delete call.args.inMinutes;
        } else {
          if (call.args.inMinutes !== intent.inMinutes || call.args.at !== undefined) {
            corrections.push({
              rule: "timing",
              detail: `schedule fires in ${intent.inMinutes} min${call.args.at !== undefined ? ` (was at ${String(call.args.at)})` : ""}`,
            });
          }
          call.args.inMinutes = intent.inMinutes;
          delete call.args.at;
        }
      }

      // 4b. Drop an immediate action that the schedule already covers — the
      //     model emitting both is why "heat the spa at 9" heated it at once.
      if (schedules.length > 0) {
        const scheduled = new Set<string>();
        for (const raw of schedules) {
          const call = asCall(raw);
          const inner = call && Array.isArray(call.args.actions) ? call.args.actions : [];
          for (const a of inner) {
            const ac = asCall(a);
            if (ac) scheduled.add(actionKey(ac));
          }
        }
        const kept = calls.filter((raw) => {
          const call = asCall(raw);
          if (!call || call.tool === "schedule_once") return true;
          if (!EXECUTABLE_TOOLS.has(call.tool as never)) return true;
          if (!scheduled.has(actionKey(call))) return true;
          corrections.push({ rule: "duplicate", detail: `dropped immediate ${call.tool} — it's already in the schedule` });
          return false;
        });
        calls = kept;
      }

      // 4c. The user gave a time and the model ignored it — wrap the actions.
      //     Skipped for multi-clause requests, where one time phrase may not
      //     cover every action.
      if (schedules.length === 0 && !SEGMENTED.test(t)) {
        const actions = calls.filter((raw) => {
          const call = asCall(raw);
          return call !== null && EXECUTABLE_TOOLS.has(call.tool as never);
        });
        if (actions.length > 0) {
          const rest = calls.filter((raw) => !actions.includes(raw));
          const timing =
            intent.kind === "absolute"
              ? { at: intent.dayOffset === 1 ? isoTomorrow(intent.at) : intent.at }
              : { inMinutes: intent.inMinutes };
          corrections.push({
            rule: "wrap",
            detail: `scheduled ${actions.length} action${actions.length === 1 ? "" : "s"} for ${
              intent.kind === "absolute" ? intent.at : `+${intent.inMinutes} min`
            } instead of running ${actions.length === 1 ? "it" : "them"} now`,
          });
          calls = [...rest, { tool: "schedule_once", args: { ...timing, actions } }];
        }
      }
    } else if (schedules.length > 0 && !hasTemporalCue(t)) {
      // 4d. No time anywhere in the request, yet the model scheduled it.
      const flattened: unknown[] = [];
      for (const raw of calls) {
        const call = asCall(raw);
        if (call?.tool === "schedule_once" && Array.isArray(call.args.actions)) {
          corrections.push({ rule: "unwrap", detail: "ran the actions now — nothing in the request asked for a later time" });
          flattened.push(...call.args.actions);
        } else {
          flattened.push(raw);
        }
      }
      calls = flattened;
    }
  }

  return { calls, corrections };
}

/**
 * "HH:MM" tomorrow as a local ISO datetime. resolveAt's plain-"HH:MM" branch
 * always means "next occurrence", which would land today for a tomorrow-morning
 * request; spelling out the date removes the ambiguity.
 */
function isoTomorrow(hhmm: string): string {
  const [h = "0", m = "0"] = hhmm.split(":");
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}
