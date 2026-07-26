/**
 * Pure dosing math for manual pool water balancing.
 *
 * Given the pool volume and current vs. ideal chemistry, computes chemical
 * dose suggestions using the standard residential factors (all of which
 * scale linearly with volume and ppm delta):
 *
 * - Raise FC   → liquid chlorine 12.5%: 1 gal raises 10,000 gal by ~12.5 ppm,
 *                or cal-hypo 67%: lbs = ppmΔ × gal × 8.34 / 1e6 / 0.67
 * - Lower pH   → muriatic acid 31.45%: ~26 fl oz per 10,000 gal lowers pH ~0.2
 *                (at TA ≈ 100 ppm — buffering means more acid at higher TA)
 * - Raise TA   → baking soda: 1.5 lb per 10,000 gal raises TA ~10 ppm
 * - Raise CH   → calcium chloride 77%: 1.25 lb per 10,000 gal raises CH ~10 ppm
 * - Raise CYA  → stabilizer: 0.8 lb per 10,000 gal raises CYA ~10 ppm
 * - Raise salt → pool salt: lbs = gal × 8.34 × ppmΔ / 1e6 (exact mass balance)
 *
 * Doses aim for the midpoint of the ideal band, are rounded to sensible
 * increments, and are capped at a safe single addition (add → circulate →
 * retest → repeat). Metrics that can only be lowered by dilution (CYA, CH,
 * salt) or by waiting (FC) return advisory-only suggestions with no dose.
 *
 * Everything here is pure and deterministic — no I/O, no Date, no globals.
 */

export type DoseMetric = "ph" | "fc" | "ta" | "cya" | "ch" | "salt";

/** Latest known reading per metric; null/undefined = never measured. */
export interface CurrentLevels {
  ph?: number | null;
  fc?: number | null;
  ta?: number | null;
  cya?: number | null;
  ch?: number | null;
  salt?: number | null;
}

/** [low, high] ideal band per metric — matches `AppSettings.idealRanges`. */
export type TargetRanges = Record<DoseMetric, [number, number]>;

export type DoseUnit = "gal" | "fl oz" | "lbs";

export interface DoseOption {
  /** Product incl. concentration, e.g. "liquid chlorine (12.5%)". */
  chemical: string;
  /** Rounded amount in `unit`. */
  amount: number;
  unit: DoseUnit;
  /** True when the raw dose exceeded the single-dose cap and was clamped. */
  capped: boolean;
  /** Ready-to-render text, e.g. "1.2 gal liquid chlorine (12.5%)". */
  label: string;
}

export interface DoseSuggestion {
  metric: DoseMetric;
  /** Full name, e.g. "Total alkalinity". */
  metricLabel: string;
  direction: "raise" | "lower";
  current: number;
  /** Midpoint of the ideal band we dose toward. */
  target: number;
  /** |current − target| in ppm (pH units for pH). */
  delta: number;
  /** Alternative chemicals that achieve the change; empty = advisory only. */
  options: DoseOption[];
  note?: string;
  /** When to test again after dosing. */
  retestAfter: string;
  /** e.g. "Raise TA 80 → 100". */
  summary: string;
}

export const DOSE_METRIC_LABELS: Record<DoseMetric, string> = {
  ph: "pH",
  fc: "Free chlorine",
  ta: "Total alkalinity",
  cya: "Stabilizer (CYA)",
  ch: "Calcium hardness",
  salt: "Salt",
};

/** Round + trim float noise for display: 1.8000000003 → "1.8", 3300 → "3300". */
export function formatChemNumber(value: number, maxDecimals = 2): string {
  return String(Number(value.toFixed(maxDecimals)));
}

const clean = (v: number): number => Number(v.toFixed(3));

const roundTo = (value: number, step: number): number => clean(Math.round(value / step) * step);

function buildOption(chemical: string, rawAmount: number, unit: DoseUnit, step: number, cap: number): DoseOption {
  const capped = rawAmount > cap;
  const clamped = capped ? cap : rawAmount;
  const amount = Math.max(step, roundTo(clamped, step));
  return { chemical, amount, unit, capped, label: `${formatChemNumber(amount)} ${unit} ${chemical}` };
}

const CAP_NOTE = "Dose capped at a safe single addition — add, circulate, retest, then repeat if needed.";

function withCapNote(suggestion: DoseSuggestion): DoseSuggestion {
  if (!suggestion.options.some((o) => o.capped)) return suggestion;
  return { ...suggestion, note: suggestion.note ? `${suggestion.note} ${CAP_NOTE}` : CAP_NOTE };
}

interface PpmSpec {
  metric: Exclude<DoseMetric, "ph">;
  short: string;
  /** Rounding increment for the ppm delta itself. */
  deltaStep: number;
  raiseOptions: Array<{
    chemical: string;
    unit: DoseUnit;
    /** Rounding increment for the dose amount. */
    step: number;
    /** Single-dose cap in `unit`. */
    cap: number;
    amount: (deltaPpm: number, gallons: number) => number;
  }>;
  raiseNote?: string;
  retestAfter: string;
  /** Advisory shown when the metric is above range (no chemical lowers it). */
  lowerNote: string;
}

const PPM_SPECS: PpmSpec[] = [
  {
    metric: "fc",
    short: "FC",
    deltaStep: 0.1,
    raiseOptions: [
      {
        chemical: "liquid chlorine (12.5%)",
        unit: "gal",
        step: 0.1,
        cap: 5,
        amount: (d, g) => (g / 10_000) * (d / 12.5),
      },
      {
        chemical: "cal-hypo (67%)",
        unit: "lbs",
        step: 0.1,
        cap: 6,
        amount: (d, g) => (d * g * 8.34) / 1e6 / 0.67,
      },
    ],
    raiseNote: "Pick one chemical, not both. Add near a return with the pump running.",
    retestAfter: "Retest FC in 2–4 hours with the pump running.",
    lowerNote: "FC drifts down on its own — sunlight burns it off. Hold off on chlorine and retest tomorrow.",
  },
  {
    metric: "ta",
    short: "TA",
    deltaStep: 1,
    raiseOptions: [
      {
        chemical: "baking soda",
        unit: "lbs",
        step: 0.1,
        cap: 12,
        amount: (d, g) => 1.5 * (g / 10_000) * (d / 10),
      },
    ],
    raiseNote: "Broadcast over the deep end with the pump running.",
    retestAfter: "Retest TA after 6+ hours of circulation.",
    lowerNote: "Lower TA gradually: dose muriatic acid down to pH 7.0–7.2, aerate the pH back up, repeat.",
  },
  {
    metric: "cya",
    short: "CYA",
    deltaStep: 1,
    raiseOptions: [
      {
        chemical: "stabilizer (cyanuric acid)",
        unit: "lbs",
        step: 0.1,
        cap: 8,
        amount: (d, g) => 0.8 * (g / 10_000) * (d / 10),
      },
    ],
    raiseNote: "Add via a sock hung in front of a return or in the skimmer — it dissolves slowly.",
    retestAfter: "Retest CYA in 2–3 days once fully dissolved.",
    lowerNote: "Only dilution lowers stabilizer — drain and refill a portion of the pool.",
  },
  {
    metric: "ch",
    short: "CH",
    deltaStep: 1,
    raiseOptions: [
      {
        chemical: "calcium chloride (77%)",
        unit: "lbs",
        step: 0.1,
        cap: 12,
        amount: (d, g) => 1.25 * (g / 10_000) * (d / 10),
      },
    ],
    raiseNote: "Pre-dissolve in a bucket of cool water and pour slowly — it gets hot as it dissolves.",
    retestAfter: "Retest CH after 4–6 hours of circulation.",
    lowerNote: "Only dilution lowers hardness — drain and refill a portion of the pool.",
  },
  {
    metric: "salt",
    short: "Salt",
    deltaStep: 10,
    raiseOptions: [
      {
        chemical: "pool salt",
        unit: "lbs",
        step: 1,
        cap: 240,
        amount: (d, g) => (g * 8.34 * d) / 1e6,
      },
    ],
    raiseNote: "Broadcast into the shallow end and brush until dissolved before judging the reading.",
    retestAfter: "Retest salt after 24 hours of full circulation.",
    lowerNote: "Only dilution lowers salt — drain and refill a portion of the pool.",
  },
];

/**
 * Compute dose suggestions for every metric that sits outside its ideal band.
 * Returns an empty array when the volume is invalid or everything is in range.
 */
export function doseSuggestions(current: CurrentLevels, targets: TargetRanges, gallons: number): DoseSuggestion[] {
  if (!Number.isFinite(gallons) || gallons <= 0) return [];
  const out: DoseSuggestion[] = [];

  // pH — the only metric we dose *down* (muriatic acid); raising is advisory.
  const ph = current.ph;
  if (typeof ph === "number" && Number.isFinite(ph)) {
    const [lo, hi] = targets.ph;
    const mid = clean((lo + hi) / 2);
    if (ph > hi) {
      const delta = clean(ph - mid);
      const rawFlOz = 26 * (gallons / 10_000) * (delta / 0.2);
      out.push(
        withCapNote({
          metric: "ph",
          metricLabel: DOSE_METRIC_LABELS.ph,
          direction: "lower",
          current: ph,
          target: mid,
          delta,
          options: [buildOption("muriatic acid (31.45%)", rawFlOz, "fl oz", 1, 64)],
          note: "Assumes TA near 100 ppm — higher alkalinity buffers pH and takes more acid; lower TA takes less. Pour slowly into the deep end with the pump running.",
          retestAfter: "Retest pH after 4–6 hours of circulation.",
          summary: `Lower pH ${formatChemNumber(ph)} → ${formatChemNumber(mid)}`,
        })
      );
    } else if (ph < lo) {
      out.push({
        metric: "ph",
        metricLabel: DOSE_METRIC_LABELS.ph,
        direction: "raise",
        current: ph,
        target: mid,
        delta: clean(mid - ph),
        options: [],
        note: "Raise pH with aeration (run water features and jets) or small additions of soda ash — it climbs quickly, so go slow.",
        retestAfter: "Retest pH after a few hours of aeration.",
        summary: `Raise pH ${formatChemNumber(ph)} → ${formatChemNumber(mid)}`,
      });
    }
  }

  for (const spec of PPM_SPECS) {
    const value = current[spec.metric];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    const [lo, hi] = targets[spec.metric];
    const mid = clean((lo + hi) / 2);
    if (value < lo) {
      const delta = roundTo(mid - value, spec.deltaStep);
      if (delta <= 0) continue;
      out.push(
        withCapNote({
          metric: spec.metric,
          metricLabel: DOSE_METRIC_LABELS[spec.metric],
          direction: "raise",
          current: value,
          target: mid,
          delta,
          options: spec.raiseOptions.map((o) => buildOption(o.chemical, o.amount(delta, gallons), o.unit, o.step, o.cap)),
          note: spec.raiseNote,
          retestAfter: spec.retestAfter,
          summary: `Raise ${spec.short} ${formatChemNumber(value)} → ${formatChemNumber(mid)}`,
        })
      );
    } else if (value > hi) {
      out.push({
        metric: spec.metric,
        metricLabel: DOSE_METRIC_LABELS[spec.metric],
        direction: "lower",
        current: value,
        target: mid,
        delta: roundTo(value - mid, spec.deltaStep),
        options: [],
        note: spec.lowerNote,
        retestAfter: spec.retestAfter,
        summary: `Lower ${spec.short} ${formatChemNumber(value)} → ${formatChemNumber(mid)}`,
      });
    }
  }

  return out;
}
