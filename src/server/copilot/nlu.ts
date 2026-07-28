import type { CopilotContext } from "./tools";
import { allCircuits } from "./tools";

/**
 * Deterministic natural-language understanding shared by the mock parser and
 * the LLM grounding layer.
 *
 * Everything here is pure regex over the user's own words — no model, no
 * context beyond the injected snapshot. The point is that the parts of a
 * request a regex can decide *reliably* (WHEN it should happen, WHICH body of
 * water, WHICH circuit) never have to depend on a 0.6B model getting them
 * right. See grounding.ts for how these are applied on top of LLM output.
 */

/* ── text ───────────────────────────────────────────────────────────────── */

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[!,;]+/g, " ")
    .replace(/\.(?!\d)/g, " ") // strip periods except decimal points ("ph 7.8")
    .replace(/\s+/g, " ")
    .trim();
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ── time ───────────────────────────────────────────────────────────────── */

/** "midnight" | "noon" | "8" | "8:30" | "6am" | "11pm" → "HH:MM" (bare hours read as tonight). */
export function parseTimeToken(token: string): string | null {
  const t = token.trim().toLowerCase();
  if (t.startsWith("midnight")) return "00:00";
  if (t.startsWith("noon")) return "12:00";
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.?\s?m\.?|p\.?\s?m\.?)?/.exec(t);
  if (!m || m[1] === undefined) return null;
  let hour = Number(m[1]);
  const minute = m[2] !== undefined ? Number(m[2]) : 0;
  if (hour > 23 || minute > 59) return null;
  const meridian = m[3]?.replace(/[\s.]/g, "");
  if (meridian === "pm" && hour < 12) hour += 12;
  else if (meridian === "am" && hour === 12) hour = 0;
  else if (meridian === undefined && hour >= 1 && hour <= 11) hour += 12; // "at 8" tonight semantics
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * Meridians survive normalize()'s period-stripping as "a m"/"p m", and users
 * write "6 a.m." — accept both so "at 6 a.m." isn't read as 18:00.
 */
const CLOCK = String.raw`midnight|noon|\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?)?`;
const TIME_PHRASE = new RegExp(String.raw`\b(?:at|around|by)\s+(${CLOCK})\b`);

/** Pull an "at 8pm"-style phrase out of a segment. */
export function extractTimePhrase(segment: string): { at: string | null; rest: string } {
  const m = TIME_PHRASE.exec(segment);
  if (!m || m[1] === undefined) return { at: null, rest: segment };
  const at = parseTimeToken(m[1]);
  const rest = segment.replace(m[0], " ").replace(/\s+/g, " ").trim();
  return { at, rest };
}

const REL_WORDY: Array<[RegExp, number]> = [
  [/\bin (?:about |around |roughly )?an? hour and a half\b/, 90],
  [/\bin (?:about |around |roughly )?half an? hour\b/, 30],
  [/\bin (?:about |around |roughly )?an? hour\b/, 60],
  [/\bin (?:about |around |roughly )?a couple(?: of)? hours\b/, 120],
  [/\bin (?:about |around |roughly )?a few hours\b/, 180],
  [/\bin (?:about |around |roughly )?a minute\b/, 1],
];

const REL_NUMERIC = /\bin (?:about |around |roughly )?(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|min|m)\b/;

/** Pull an "in 2 hours"-style phrase out of a segment → minutes from now. */
export function extractRelativePhrase(segment: string): { inMinutes: number | null; rest: string } {
  for (const [re, mins] of REL_WORDY) {
    const m = re.exec(segment);
    if (m) return { inMinutes: mins, rest: segment.replace(m[0], " ").replace(/\s+/g, " ").trim() };
  }
  const m = REL_NUMERIC.exec(segment);
  if (m && m[1] !== undefined && m[2] !== undefined) {
    const n = Number(m[1]);
    const mins = Math.round(m[2].startsWith("h") ? n * 60 : n);
    if (mins >= 1) return { inMinutes: mins, rest: segment.replace(m[0], " ").replace(/\s+/g, " ").trim() };
  }
  return { inMinutes: null, rest: segment };
}

const DAY_NAMES: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};

export function parseDays(t: string): number[] {
  if (/\bweekdays?\b/.test(t)) return [1, 2, 3, 4, 5];
  if (/\bweekends?\b/.test(t)) return [0, 6];
  if (/\bevery (day|night|morning|evening)\b|\bdaily\b|\bnightly\b/.test(t)) return [];
  const days = new Set<number>();
  for (const [name, idx] of Object.entries(DAY_NAMES)) {
    if (new RegExp(`\\b${name}s?\\b`).test(t)) days.add(idx);
  }
  return [...days].sort((a, b) => a - b);
}

export function stripRecurrence(t: string): string {
  return t
    .replace(/\b(?:every|on|each)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday)s?\b/g, " ")
    .replace(/\bevery (day|night|morning|evening|week)\b|\bdaily\b|\bnightly\b|\bweekdays?\b|\bweekends?\b/g, " ")
    .replace(/\bevery\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ── time intent (grounding) ────────────────────────────────────────────── */

export type TimeIntent =
  | { kind: "relative"; inMinutes: number }
  | { kind: "absolute"; at: string; dayOffset: 0 | 1 }
  | { kind: "none" };

/** Anything that even hints the user wants this later rather than now. */
const TEMPORAL_CUE =
  /\b(at|around|by|in|after|before|tonight|tomorrow|later|then|morning|afternoon|evening|night|midnight|noon|am|pm|a m|p m|minutes?|mins?|hours?|hrs?|every|daily|nightly|weekdays?|weekends?|sunrise|sunset|dusk|dawn|schedule[ds]?|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/;

/** Recurrence words — these mean an automation/panel schedule, never a one-shot. */
const RECURRENCE_CUE = /\b(every|each|daily|nightly|weekdays?|weekends?|always|recurring|from now on)\b/;

export function hasTemporalCue(t: string): boolean {
  return TEMPORAL_CUE.test(t);
}

export function isRecurring(t: string): boolean {
  return RECURRENCE_CUE.test(t);
}

/**
 * What the user actually said about WHEN. Relative wins over absolute because
 * "in 2 hours" is unambiguous while a stray "at" can appear anywhere.
 *
 * `dayOffset` carries an explicit "tomorrow" so the caller can resolve past a
 * plain HH:MM's tonight-semantics.
 */
export function detectTimeIntent(text: string): TimeIntent {
  const t = normalize(text);
  const rel = extractRelativePhrase(t);
  if (rel.inMinutes !== null) return { kind: "relative", inMinutes: rel.inMinutes };

  const dayOffset: 0 | 1 = /\btomorrow\b/.test(t) ? 1 : 0;

  const { at } = extractTimePhrase(t);
  if (at !== null) return { kind: "absolute", at, dayOffset };

  // Bare "midnight"/"noon" and "9pm"/"9 pm" with no preposition ("heat the spa
  // 9pm", "midnight everything off").
  const bare = new RegExp(String.raw`\b(midnight|noon|\d{1,2}(?::\d{2})?\s*(?:a\.?\s?m\.?|p\.?\s?m\.?))\b`).exec(t);
  if (bare?.[1] !== undefined) {
    const parsed = parseTimeToken(bare[1]);
    if (parsed !== null) return { kind: "absolute", at: parsed, dayOffset };
  }
  return { kind: "none" };
}

/* ── entities ───────────────────────────────────────────────────────────── */

const SPA_WORDS = /\b(spa|hot ?tub|jacuzzi|whirlpool)\b/;
const POOL_WORDS = /\bpool\b/;

/**
 * Which body of water the user named, or null when they named both/neither.
 * "pool lights" and "pool controller" don't count as naming the pool body.
 */
export function mentionedBodyKind(text: string, ctx: CopilotContext): "pool" | "spa" | null {
  const t = normalize(text);
  const hasSpaBody = ctx.snapshot.bodies.some((b) => b.kind === "spa");
  const hasPoolBody = ctx.snapshot.bodies.some((b) => b.kind === "pool");
  const spa = SPA_WORDS.test(t) && hasSpaBody;
  // "the pool lights" / "pool light" name a circuit, not the body.
  const pool = POOL_WORDS.test(t) && !/\bpool (lights?|light)\b/.test(t) && hasPoolBody;
  if (spa && !pool) return "spa";
  if (pool && !spa) return "pool";
  return null;
}

export interface CircuitMention {
  id: number;
  name: string;
}

/**
 * Circuits whose names appear verbatim in the utterance, longest name first so
 * "Pool Lights" wins over "Pool". Spa synonyms resolve to the spa body's
 * circuit, which is how "turn on the hot tub" finds circuit "Spa".
 */
export function mentionedCircuits(text: string, ctx: CopilotContext): CircuitMention[] {
  let t = normalize(text);
  const found = new Map<number, string>();
  const circuits = [...allCircuits(ctx.snapshot)].sort((a, b) => b.name.length - a.name.length);
  for (const c of circuits) {
    const name = normalize(c.name);
    if (!name) continue;
    const re = new RegExp(`\\b${escapeRegExp(name)}\\b`);
    if (!re.test(t)) continue;
    found.set(c.id, c.name);
    // Blank the span so a shorter name nested inside it ("Pool" within "Pool
    // Lights") doesn't count as a second, competing mention.
    t = t.replace(re, " ".repeat(name.length));
  }
  if (SPA_WORDS.test(t)) {
    const spaBody = ctx.snapshot.bodies.find((b) => b.kind === "spa");
    const spaCircuit = spaBody
      ? allCircuits(ctx.snapshot).find((c) => c.id === spaBody.circuitId)
      : allCircuits(ctx.snapshot).find((c) => SPA_WORDS.test(normalize(c.name)));
    if (spaCircuit) found.set(spaCircuit.id, spaCircuit.name);
  }
  return [...found].map(([id, name]) => ({ id, name }));
}

/** Did the user ask for a specific temperature, or a nudge? */
export function mentionsTemperature(text: string): boolean {
  const t = normalize(text);
  return (
    /\b\d{2,3}\s*(?:°|degrees?|deg)?\b/.test(t) ||
    /\b(warmer|cooler|hotter|colder|a bit|a little|slightly|a touch|a tad|degrees?|setpoint|temp\w*)\b/.test(t)
  );
}
