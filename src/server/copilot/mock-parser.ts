import type { ChemReadings, CopilotContext, StatusScope, ToolCall } from "./tools";
import { allCircuits, resolveAt } from "./tools";
import {
  escapeRegExp,
  extractRelativePhrase,
  extractTimePhrase,
  normalize,
  parseDays,
  parseTimeToken,
  stripRecurrence,
} from "./nlu";

/**
 * Deterministic intent parser used when MOCK_MODE=true and in CI. Pure
 * regex/keyword matching over the injected context — no DB, no runtime, no
 * network — so the whole copilot pipeline stays testable and demoable without
 * an LLM. The live LLM path produces the exact same ToolCall vocabulary.
 *
 * The time/entity primitives live in nlu.ts because the LLM path needs the
 * same knowledge to ground what the model returns (see grounding.ts).
 */

export interface MockParseResult {
  calls: ToolCall[];
  note?: string;
}

const none: MockParseResult = { calls: [] };

/* ── sub-parsers ────────────────────────────────────────────────────────── */

export function isGreeting(t: string): boolean {
  return /^(hi|hey|hello|yo|howdy|sup|good (morning|afternoon|evening|night)|thanks|thank you)( there| copilot| moonpool)?\s*\??$/.test(
    t
  );
}

function isQuestion(t: string): boolean {
  return (
    /\?$/.test(t) ||
    /^(what|whats|what's|how|is |are |am |does |do |did |when|where|which|why|who|tell me|show me|give me)/.test(t) ||
    /\b(status|report|update)\b/.test(t)
  );
}

function statusScope(t: string): StatusScope {
  if (/\b(salt|chlorin\w*|ph|orp|chem\w*|alkalinity|cya|fc|ta)\b/.test(t)) return "chemistry";
  if (/\b(warm|cold|hot|freez\w*|temp\w*|degrees?|heat\w*)\b/.test(t)) return "temps";
  if (/\b(pump|rpm|watts?|energy|filter\w*|heater|panel|equipment|system|version|model)\b/.test(t)) return "equipment";
  if (/\b(on|off|running|circuits?|lights?|features?)\b/.test(t)) return "circuits";
  return "all";
}

const MGMT_STOPWORDS = new Set([
  "the", "a", "an", "my", "that", "this", "please", "automation", "automations", "routine", "routines",
  "delete", "remove", "drop", "pause", "resume", "unpause", "enable", "disable", "suspend", "stop",
  "turn", "switch", "off", "on", "back", "get", "rid", "of", "list", "show",
]);

/** Full automation name appears verbatim in the text. */
function findAutomationVerbatim(t: string, ctx: CopilotContext): number | null {
  const sorted = [...ctx.automations].sort((a, b) => b.name.length - a.name.length);
  for (const a of sorted) {
    if (a.name && t.includes(a.name.toLowerCase())) return a.id;
  }
  return null;
}

/**
 * Loose resolution (word overlap or index/id number). Only used when the text
 * explicitly says "automation", so circuit commands never get hijacked.
 */
function findAutomationLoose(t: string, ctx: CopilotContext): number | null {
  const words = t.split(" ").filter((w) => w.length >= 2 && !MGMT_STOPWORDS.has(w));
  if (words.length > 0) {
    let bestId: number | null = null;
    let bestScore = 0;
    let tie = false;
    for (const a of ctx.automations) {
      const nameWords = new Set(a.name.toLowerCase().split(/\s+/));
      const score = words.filter((w) => nameWords.has(w)).length;
      if (score > bestScore) {
        bestScore = score;
        bestId = a.id;
        tie = false;
      } else if (score === bestScore && score > 0) {
        tie = true;
      }
    }
    if (bestId !== null && bestScore > 0 && !tie) return bestId;
  }
  // 3. A number: automation id, else 1-based position in the list.
  const numMatch = /\b(\d+)\b/.exec(t);
  if (numMatch && numMatch[1] !== undefined) {
    const n = Number(numMatch[1]);
    if (ctx.automations.some((a) => a.id === n)) return n;
    const byIndex = ctx.automations[n - 1];
    if (byIndex) return byIndex.id;
  }
  return null;
}

function parseAutomationMgmt(t: string, ctx: CopilotContext): MockParseResult | null {
  const mentionsAutomation = /\bautomations?\b|\broutines?\b/.test(t);
  const verbatimId = findAutomationVerbatim(t, ctx);
  if (!mentionsAutomation && verbatimId === null) return null;

  let verb: "pause" | "resume" | "delete" | null = null;
  if (/\b(delete|remove|drop|get rid of)\b/.test(t)) verb = "delete";
  else if (/\b(resume|unpause|re-?enable|enable|turn (back )?on|switch on)\b/.test(t)) verb = "resume";
  else if (/\b(pause|disable|suspend|turn off|switch off|stop)\b/.test(t)) verb = "pause";

  if (verb === null) {
    if (!mentionsAutomation) return null;
    return { calls: [{ tool: "list_automations", args: {} }] };
  }
  const id = verbatimId ?? (mentionsAutomation ? findAutomationLoose(t, ctx) : null);
  if (id === null) {
    return { calls: [], note: "I couldn't tell which automation you meant — say “list automations” to see them." };
  }
  const tool = verb === "pause" ? "pause_automation" : verb === "resume" ? "resume_automation" : "delete_automation";
  return { calls: [{ tool, args: { id } }] };
}

function detectBodyKind(t: string, ctx: CopilotContext): "pool" | "spa" {
  if (/\bspa\b|\bhot ?tub\b|\bjacuzzi\b/.test(t) && ctx.snapshot.bodies.some((b) => b.kind === "spa")) return "spa";
  if (/\bpool\b/.test(t) && ctx.snapshot.bodies.some((b) => b.kind === "pool")) return "pool";
  return ctx.snapshot.bodies.some((b) => b.kind === "spa") ? "spa" : "pool";
}

function parseHeatCommand(s: string, ctx: CopilotContext): ToolCall | null {
  // Absolute: "set spa to 102", "heat the pool to 85 degrees"
  const abs = /\b(pool|spa|hot ?tub)\b[a-z\s]{0,24}\b(?:to|at)\s+(\d{2,3})\b/.exec(s);
  if (abs && abs[1] !== undefined && abs[2] !== undefined) {
    const n = Number(abs[2]);
    if (n >= 50 && n <= 110) {
      return { tool: "set_heat", args: { body: abs[1].startsWith("pool") ? "pool" : "spa", setpoint: n } };
    }
  }

  const mentionsHeat = /\bheat\w*\b|\bwarm\w*\b|\bcool\w*\b|\btemp\w*\b|°|\bdegrees?\b|\bsetpoint\b/.test(s);
  if (!mentionsHeat) return null;

  const body = detectBodyKind(s, ctx);
  const bodyState = ctx.snapshot.bodies.find((b) => b.kind === body);

  // Relative nudges: "warm the spa a bit" → +2°, "cool it down a little" → −2°
  const nudge = /\b(a bit|a little|slightly|a touch|a tad|a couple)\b/.test(s);
  if (nudge && /\b(warm\w*|bump|raise|crank|heat)\b/.test(s)) {
    const cur = bodyState?.setPoint ?? 100;
    const hi = Math.min(104, bodyState?.maxSetPoint ?? 104);
    return { tool: "set_heat", args: { body, setpoint: Math.min(hi, cur + 2) } };
  }
  if (nudge && /\b(cool\w*|lower|drop)\b/.test(s)) {
    const cur = bodyState?.setPoint ?? 100;
    const lo = Math.max(60, bodyState?.minSetPoint ?? 60);
    return { tool: "set_heat", args: { body, setpoint: Math.max(lo, cur - 2) } };
  }

  // "set the temp to 95" (body implied)
  const generic = /\b(?:to|at)\s+(\d{2,3})\b/.exec(s);
  if (generic && generic[1] !== undefined) {
    const n = Number(generic[1]);
    if (n >= 50 && n <= 110) return { tool: "set_heat", args: { body, setpoint: n } };
  }

  if (/\boff\b|\bstop\b|\bkill\b/.test(s)) return { tool: "set_heat", args: { body, mode: "off" } };
  if (/\bsolar\b/.test(s)) return { tool: "set_heat", args: { body, mode: "solar" } };
  if (/\b(on|start|begin|fire|up)\b/.test(s) || /^heat\b/.test(s)) return { tool: "set_heat", args: { body, mode: "heater" } };
  return null;
}

function findScene(s: string, ctx: CopilotContext): { id: number } | null {
  const sorted = [...ctx.scenes].sort((a, b) => b.name.length - a.name.length);
  for (const scene of sorted) {
    const name = scene.name.trim().toLowerCase();
    if (name && s.includes(name)) return { id: scene.id };
  }
  return null;
}

function parseLightTheme(s: string, ctx: CopilotContext): ToolCall | null {
  if (!/\blights?\b/.test(s)) return null;
  const sorted = [...ctx.snapshot.lightThemes].sort((a, b) => b.name.length - a.name.length);
  for (const theme of sorted) {
    const name = theme.name.trim().toLowerCase();
    if (name && new RegExp(`\\b${escapeRegExp(name)}\\b`).test(s)) {
      return { tool: "set_light_theme", args: { theme: theme.name } };
    }
  }
  return null;
}

function parseCircuitToggles(s: string, ctx: CopilotContext): ToolCall[] {
  const sorted = allCircuits(ctx.snapshot).slice().sort((a, b) => b.name.length - a.name.length);
  let remaining = s;
  const matched: number[] = [];
  for (const circuit of sorted) {
    const name = circuit.name.trim().toLowerCase();
    if (!name) continue;
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    if (re.test(remaining)) {
      matched.push(circuit.id);
      remaining = remaining.replace(re, " ");
    }
  }
  if (matched.length === 0) return [];
  const off = /\b(off|kill|stop|shut|close|disable)\b/.test(s);
  const on = /\b(on|start|open|enable|run|fire)\b/.test(s);
  if (!off && !on) return [];
  return matched.map((circuitId) => ({ tool: "set_circuit", args: { circuitId, state: !off } }));
}

function parseChemReadings(s: string): ChemReadings | null {
  const readings: ChemReadings = {};
  let found = false;
  for (const m of s.matchAll(/\b(ph|orp|fc|ta|cya|ch|salt)\b\s*(?:is|at|=|:)?\s*(\d+(?:\.\d+)?)/g)) {
    const key = m[1] as keyof ChemReadings | undefined;
    const value = m[2] !== undefined ? Number(m[2]) : NaN;
    if (key !== undefined && Number.isFinite(value)) {
      readings[key] = value;
      found = true;
    }
  }
  return found ? readings : null;
}

/** Parse one command segment (already stripped of time phrases) into calls. */
function parseCommandSegment(segment: string, ctx: CopilotContext): ToolCall[] {
  const s = segment.trim();
  if (!s) return [];

  // "everything off" / "all off" / "shut it all down" — but not "all the lights off"
  if (/\b(everything|it all)\b[a-z\s]*\b(off|down)\b|\ball off\b|\bshut (it |everything )?down\b/.test(s)) {
    return [{ tool: "all_off", args: {} }];
  }

  // super-chlorination
  if (/\bsuper[- ]?chlor\w*|\bshock\b/.test(s)) {
    const hours = /(\d{1,2})\s*(?:h|hr|hrs|hours?)\b/.exec(s);
    const on = !/\b(off|stop|cancel)\b/.test(s);
    return [{ tool: "super_chlorinate", args: { on, hours: hours && hours[1] !== undefined ? Number(hours[1]) : 24 } }];
  }

  // chlorinator output %
  if (/\bchlor\w*\b/.test(s)) {
    const pct = /(\d{1,3})\s*(?:%|percent)?/.exec(s);
    if (pct && pct[1] !== undefined) return [{ tool: "set_chlorinator", args: { outputPct: Number(pct[1]) } }];
  }

  // heat (before circuit matching so "spa heater" ≠ spa circuit)
  const heat = parseHeatCommand(s, ctx);
  if (heat) return [heat];

  // scenes by name
  const scene = findScene(s, ctx);
  if (scene) return [{ tool: "run_scene", args: { sceneId: scene.id } }];

  // light themes by name
  const theme = parseLightTheme(s, ctx);
  if (theme) return [theme];

  // circuits by name
  const circuits = parseCircuitToggles(s, ctx);
  if (circuits.length > 0) return circuits;

  // generic "lights on/off" — all lights
  if (/\blights?\b/.test(s)) {
    const off = /\b(off|out|kill)\b/.test(s);
    const on = /\bon\b/.test(s);
    if (off || on) {
      const lights = allCircuits(ctx.snapshot).filter((c) => c.isLight);
      if (lights.length > 0) return lights.map((c) => ({ tool: "set_circuit", args: { circuitId: c.id, state: !off } }));
    }
  }

  // bare chemistry readings ("ph 7.8 ta 90")
  const chem = parseChemReadings(s);
  if (chem) return [{ tool: "log_chemistry", args: { readings: chem } }];

  return [];
}

/* ── main entry ─────────────────────────────────────────────────────────── */

export function parseUtterance(text: string, ctx: CopilotContext): MockParseResult {
  let t = normalize(text);
  if (!t) return none;

  // "cancel that" / "never mind"
  if (/^(cancel( that| it| this| the last( one)?)?|never ?mind|scratch that|undo that|forget it)\s*\??$/.test(t)) {
    return { calls: [{ tool: "cancel_pending", args: {} }] };
  }

  // pure greetings before prefix stripping ("hey there")
  if (isGreeting(t)) return { calls: [{ tool: "get_status", args: { scope: "all" } }] };

  // strip polite / address prefixes: "hey copilot can you please …"
  t = t
    .replace(/^(hey|hi|hello|ok|okay)[ ,]+/g, "")
    .replace(/^(copilot|moonpool)[ ,]+/g, "")
    .replace(/^(can|could|would|will) you\s+/g, "")
    .replace(/^please\s+/g, "")
    .trim();
  if (!t) return none;

  // automation management (before question detection: "what automations…?")
  const mgmt = parseAutomationMgmt(t, ctx);
  if (mgmt) return mgmt;

  // status questions
  if (isQuestion(t)) return { calls: [{ tool: "get_status", args: { scope: statusScope(t) } }] };

  // "start heating and turn off around midnight"
  const heatOnOff =
    /\b(?:start|begin|turn on|fire up|kick on)\b[a-z\s]{0,24}\bheat\w*\b.*\b(?:and|then|but)\b.*\b(?:off|down)\b.*?\b(?:at|around|by)\s+(.+)$/.exec(t);
  if (heatOnOff && heatOnOff[1] !== undefined) {
    const at = parseTimeToken(heatOnOff[1]);
    if (at) {
      const body = detectBodyKind(t, ctx);
      return {
        calls: [
          { tool: "set_heat", args: { body, mode: "heater" } },
          { tool: "schedule_once", args: { at, fireAt: resolveAt(at) ?? 0, actions: [{ tool: "set_heat", args: { body, mode: "off" } }] } },
        ],
      };
    }
  }

  // sun-based automations: "lights blue at sunset every friday"
  const sun = /\b(sunset|sunrise)\b/.exec(t);
  if (sun && sun[1] !== undefined) {
    const event = sun[1] as "sunrise" | "sunset";
    const days = parseDays(t);
    const offsetMatch = /(\d{1,3})\s*min\w*\s*(before|after)/.exec(t);
    const offsetMinutes =
      offsetMatch && offsetMatch[1] !== undefined ? Number(offsetMatch[1]) * (offsetMatch[2] === "before" ? -1 : 1) : 0;
    const rest = stripRecurrence(t.replace(/\b(?:at|around|by)?\s*(sunset|sunrise)\b/g, " "));
    const actions = parseCommandSegment(rest, ctx);
    if (actions.length > 0) {
      const name = (text.trim().charAt(0).toUpperCase() + text.trim().slice(1)).replace(/[?!.]+$/, "").slice(0, 60);
      return {
        calls: [
          { tool: "create_automation", args: { name, trigger: { type: "sun", event, offsetMinutes, days }, actions } },
        ],
      };
    }
  }

  // clock-based recurring automations: "run the cleaner every monday at 9am"
  const recurring =
    /\bevery (day|night|morning|evening|week)\b|\bdaily\b|\bnightly\b|\bweekdays?\b|\bweekends?\b/.test(t) ||
    parseDays(t).length > 0;
  if (recurring) {
    const { at, rest } = extractTimePhrase(t);
    if (at !== null) {
      const actions = parseCommandSegment(stripRecurrence(rest), ctx);
      if (actions.length > 0) {
        const name = (text.trim().charAt(0).toUpperCase() + text.trim().slice(1)).replace(/[?!.]+$/, "").slice(0, 60);
        return {
          calls: [{ tool: "create_automation", args: { name, trigger: { type: "time", at, days: parseDays(t) }, actions } }],
        };
      }
    }
  }

  // segments: "spa night at 8 but kill the waterfall"
  const segments = t.split(/\s+but\s+|\s+and then\s+|\s*;\s*|,\s*then\s+/);
  const calls: ToolCall[] = [];
  for (const segment of segments) {
    if (!segment.trim()) continue;
    // relative first: "heat the hot tub in 2 hours" / "in 45 min turn off the jets"
    const rel = extractRelativePhrase(segment);
    if (rel.inMinutes !== null) {
      const relCalls = parseCommandSegment(rel.rest, ctx);
      if (relCalls.length > 0) {
        calls.push({ tool: "schedule_once", args: { inMinutes: rel.inMinutes, fireAt: Date.now() + rel.inMinutes * 60_000, actions: relCalls } });
        continue;
      }
    }
    const { at, rest } = extractTimePhrase(segment);
    const segmentCalls = parseCommandSegment(at !== null ? rest : segment, ctx);
    if (segmentCalls.length === 0) continue;
    if (at !== null) calls.push({ tool: "schedule_once", args: { at, fireAt: resolveAt(at) ?? 0, actions: segmentCalls } });
    else calls.push(...segmentCalls);
  }
  if (calls.length > 0) return { calls };

  return none;
}
