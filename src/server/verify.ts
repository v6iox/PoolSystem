import type { PoolAction } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";

/**
 * Command verification — the "did it actually happen?" heartbeat.
 *
 * Sending a command to njsPC is fire-and-forget: an HTTP 200 means the request
 * was accepted, not that anything moved. RS-485 writes get dropped, a panel in
 * service mode ignores them, and equipment can refuse a mode it advertises. Up
 * to now every one of those cases reported a cheerful "Done".
 *
 * So after each state-changing action we re-read the snapshot and check that
 * the value we commanded is really there. If it is unchanged from before the
 * command, the command was almost certainly lost and we re-send it once. If it
 * still hasn't taken, we stop guessing and tell the user.
 *
 * The assessment half is pure and snapshot-driven so it can be unit-tested
 * without a panel, a DB or timers — same shape as the heater watchdog.
 */

/** How long to give the panel to reflect a change before checking. */
export const VERIFY_DELAY_MS = 6_000;
/** Extra time after a re-send before the final check. */
export const RETRY_DELAY_MS = 8_000;

export interface Expectation {
  /** Human label for the thing being checked ("Spa heat mode"). */
  label: string;
  /** The value the command should have produced. */
  want: string;
  /** Pull the current value out of a snapshot, or null if it isn't reported. */
  read: (snap: PoolStateSnapshot) => string | null;
}

export type Verdict =
  /** The commanded value is present. */
  | { state: "confirmed" }
  /** Unchanged from before the command — it looks like it never landed. */
  | { state: "dropped"; got: string | null }
  /** Changed, but to something else — someone or something else moved it. */
  | { state: "overridden"; got: string | null }
  /** The panel doesn't report this value; nothing to check. */
  | { state: "unknown" };

const bool = (v: boolean): string => (v ? "on" : "off");

/**
 * What a snapshot should look like once `action` has taken effect.
 *
 * Deliberately narrow: only values njsPC reports back promptly and exactly.
 * Pump RPM is left out on purpose — variable-speed pumps ramp over tens of
 * seconds and are driven by circuit programs, so checking it would produce
 * false alarms, which are worse than no check at all.
 */
export function expectationsFor(action: PoolAction): Expectation[] {
  switch (action.type) {
    case "setCircuit":
      return [
        {
          label: `circuit ${action.circuitId}`,
          want: bool(action.state),
          read: (s) => {
            const c = s.circuits.find((x) => x.id === action.circuitId) ?? s.features.find((x) => x.id === action.circuitId);
            return c ? bool(c.isOn) : null;
          },
        },
      ];
    case "setHeat": {
      const out: Expectation[] = [];
      if (action.mode !== undefined) {
        out.push({
          label: `body ${action.bodyId} heat mode`,
          want: action.mode,
          read: (s) => s.bodies.find((b) => b.id === action.bodyId)?.heatMode ?? null,
        });
      }
      if (action.setPoint !== undefined) {
        out.push({
          label: `body ${action.bodyId} setpoint`,
          want: String(action.setPoint),
          read: (s) => {
            const b = s.bodies.find((x) => x.id === action.bodyId);
            return b ? String(b.setPoint) : null;
          },
        });
      }
      return out;
    }
    case "setChlorinator": {
      const out: Expectation[] = [];
      if (action.poolSetpoint !== undefined) {
        out.push({
          label: "chlorinator pool output",
          want: String(action.poolSetpoint),
          read: (s) => {
            const c = s.chlorinators.find((x) => x.id === action.chlorId);
            return c ? String(c.poolSetpoint) : null;
          },
        });
      }
      if (action.spaSetpoint !== undefined) {
        out.push({
          label: "chlorinator spa output",
          want: String(action.spaSetpoint),
          read: (s) => {
            const c = s.chlorinators.find((x) => x.id === action.chlorId);
            return c ? String(c.spaSetpoint) : null;
          },
        });
      }
      return out;
    }
    case "superChlorinate":
      return [
        {
          label: "super-chlorinate",
          want: bool(action.on),
          read: (s) => {
            const c = s.chlorinators.find((x) => x.id === action.chlorId);
            return c ? bool(c.superChlor) : null;
          },
        },
      ];
    case "setLightTheme":
      return [
        {
          label: `light ${action.circuitId} theme`,
          want: String(action.theme),
          read: (s) => {
            const c = s.circuits.find((x) => x.id === action.circuitId);
            return c && c.lightTheme !== null ? String(c.lightTheme) : null;
          },
        },
      ];
    case "setLightGroupTheme":
      return [
        {
          label: `light group ${action.groupId} theme`,
          want: String(action.theme),
          read: (s) => {
            const g = s.lightGroups.find((x) => x.id === action.groupId);
            return g && g.theme !== null && g.theme !== undefined ? String(g.theme) : null;
          },
        },
      ];
    case "allOff":
      return [
        {
          label: "all circuits",
          want: "0 on",
          read: (s) => `${[...s.circuits, ...s.features].filter((c) => c.isOn).length} on`,
        },
      ];
    // Scenes verify through the individual actions they expand into; pump speed
    // is intentionally unverified (see the note above). Light commands
    // (sync/swim/hold…) have no observable state to check.
    case "runScene":
    case "setPumpSpeed":
    case "lightCommand":
      return [];
  }
}

/**
 * Compare what the panel reports now against what was commanded, given what it
 * reported beforehand. `before === null` means we had no reading to compare
 * with, so an unmet expectation can't be attributed and is treated as dropped.
 */
export function assess(expectation: Expectation, before: string | null, after: string | null): Verdict {
  if (after === null) return { state: "unknown" };
  if (after === expectation.want) return { state: "confirmed" };
  if (before !== null && after === before) return { state: "dropped", got: after };
  return { state: "overridden", got: after };
}

export interface VerificationOutcome {
  action: PoolAction;
  label: string;
  want: string;
  got: string | null;
  state: Verdict["state"];
  retried: boolean;
}

/** Everything the runner needs, injected so this stays testable without a runtime. */
export interface VerifyDeps {
  snapshot: () => PoolStateSnapshot;
  /** Re-send the command (used once, only when the value looks dropped). */
  resend: () => Promise<void>;
  wait: (ms: number) => Promise<void>;
  onResult: (outcome: VerificationOutcome) => void;
}

/**
 * Watch one action through to a verdict. Resolves once every expectation has
 * been decided; only failures are reported to `onResult`.
 */
export async function verifyAction(action: PoolAction, before: PoolStateSnapshot, deps: VerifyDeps): Promise<void> {
  const expectations = expectationsFor(action);
  if (expectations.length === 0) return;
  const priors = expectations.map((e) => e.read(before));

  await deps.wait(VERIFY_DELAY_MS);
  let snap = deps.snapshot();
  let verdicts = expectations.map((e, i) => assess(e, priors[i] ?? null, e.read(snap)));

  // A dropped command is the one case worth re-sending: the panel still shows
  // exactly what it showed before, so we aren't fighting a human at the panel.
  const retried = verdicts.some((v) => v.state === "dropped");
  if (retried) {
    try {
      await deps.resend();
    } catch {
      // The re-send failing is itself a failure to confirm — fall through and
      // report against the final reading.
    }
    await deps.wait(RETRY_DELAY_MS);
    snap = deps.snapshot();
    verdicts = expectations.map((e, i) => assess(e, priors[i] ?? null, e.read(snap)));
  }

  expectations.forEach((e, i) => {
    const verdict = verdicts[i];
    if (!verdict || verdict.state === "confirmed" || verdict.state === "unknown") return;
    deps.onResult({
      action,
      label: e.label,
      want: e.want,
      got: "got" in verdict ? verdict.got : null,
      state: verdict.state,
      retried,
    });
  });
}
