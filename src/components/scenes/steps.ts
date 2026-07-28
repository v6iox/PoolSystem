import type { HeatModeInput, PoolAction, SceneDef } from "@/types/actions";
import { LIGHT_COMMAND_LABELS } from "@/types/actions";
import type { CircuitState, PoolStateSnapshot } from "@/types/pool";

/**
 * Editable draft model for the scene action builder. Every PoolAction a scene
 * can hold maps to one StepDraft (string-backed fields so partially-typed
 * numbers don't fight the inputs), and converts back with validation on save.
 */

export type StepKind =
  | "circuit"
  | "heat"
  | "light"
  | "chlorinator"
  | "pump"
  | "scene"
  | "allOff"
  /** Action kinds the builder has no dedicated editor for (e.g. superChlorinate) — kept verbatim. */
  | "raw";

export interface StepDraft {
  /** Stable list key for reorder animations. */
  key: number;
  kind: StepKind;
  // circuit
  circuitId: string;
  on: boolean;
  // heat
  bodyId: string;
  /** "keep" = leave the heat mode alone. */
  heatMode: string;
  /** "" = no setpoint change. */
  setPoint: string;
  // light — "c:<circuitId>" or "g:<groupId>"
  lightTarget: string;
  theme: string;
  // chlorinator
  chlorId: string;
  poolPct: string;
  spaPct: string;
  // pump
  pumpId: string;
  rpm: string;
  // nested scene
  sceneId: string;
  /** Original action for kind === "raw". */
  raw?: PoolAction;
}

let stepSeq = 1;

function blankStep(kind: StepKind): StepDraft {
  return {
    key: stepSeq++,
    kind,
    circuitId: "",
    on: true,
    bodyId: "",
    heatMode: "keep",
    setPoint: "",
    lightTarget: "",
    theme: "",
    chlorId: "",
    poolPct: "",
    spaPct: "",
    pumpId: "",
    rpm: "",
    sceneId: "",
  };
}

/** Circuits + features, deduped by id (both are valid setCircuit targets). */
export function allCircuits(snapshot: PoolStateSnapshot): CircuitState[] {
  const seen = new Set<number>();
  return [...snapshot.circuits, ...snapshot.features].filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });
}

const HEAT_MODE_VALUES: ReadonlySet<string> = new Set(["off", "heater", "solar", "solarpref"]);

function isHeatMode(value: string): value is HeatModeInput {
  return HEAT_MODE_VALUES.has(value);
}

export function heatModeLabel(mode: string): string {
  switch (mode) {
    case "off":
      return "Off";
    case "heater":
      return "Heater";
    case "solar":
      return "Solar";
    case "solarpref":
      return "Solar preferred";
    default:
      return mode;
  }
}

/** A fresh step of the given kind, pre-filled from whatever equipment exists. */
export function newStep(kind: StepKind, snapshot: PoolStateSnapshot, otherScenes: SceneDef[]): StepDraft {
  const step = blankStep(kind);
  const circuits = allCircuits(snapshot);
  switch (kind) {
    case "circuit": {
      const first = circuits[0];
      step.circuitId = first ? String(first.id) : "";
      break;
    }
    case "heat": {
      const body = snapshot.bodies[0];
      step.bodyId = body ? String(body.id) : "";
      break;
    }
    case "light": {
      const light = circuits.find((c) => c.isLight);
      const group = snapshot.lightGroups[0];
      step.lightTarget = light ? `c:${light.id}` : group ? `g:${group.id}` : "";
      const theme = snapshot.lightThemes[0];
      step.theme = theme ? String(theme.val) : "";
      break;
    }
    case "chlorinator": {
      const chlor = snapshot.chlorinators[0];
      if (chlor) {
        step.chlorId = String(chlor.id);
        step.poolPct = String(chlor.poolSetpoint);
        step.spaPct = String(chlor.spaSetpoint);
      }
      break;
    }
    case "pump": {
      const pump = snapshot.pumps[0];
      if (pump) {
        step.pumpId = String(pump.id);
        step.rpm = String(
          pump.isRunning && pump.rpm > 0 ? pump.rpm : Math.round((pump.minSpeed + pump.maxSpeed) / 2)
        );
      }
      break;
    }
    case "scene": {
      const first = otherScenes[0];
      step.sceneId = first ? String(first.id) : "";
      break;
    }
    case "allOff":
    case "raw":
      break;
  }
  return step;
}

/** Rehydrate a stored action into an editable draft (for scene editing). */
export function stepFromAction(action: PoolAction): StepDraft {
  switch (action.type) {
    case "setCircuit": {
      const s = blankStep("circuit");
      s.circuitId = String(action.circuitId);
      s.on = action.state;
      return s;
    }
    case "setHeat": {
      const s = blankStep("heat");
      s.bodyId = String(action.bodyId);
      s.heatMode = action.mode ?? "keep";
      s.setPoint = action.setPoint !== undefined ? String(action.setPoint) : "";
      return s;
    }
    case "setLightTheme": {
      const s = blankStep("light");
      s.lightTarget = `c:${action.circuitId}`;
      s.theme = String(action.theme);
      return s;
    }
    case "setLightGroupTheme": {
      const s = blankStep("light");
      s.lightTarget = `g:${action.groupId}`;
      s.theme = String(action.theme);
      return s;
    }
    case "setChlorinator": {
      const s = blankStep("chlorinator");
      s.chlorId = String(action.chlorId);
      s.poolPct = action.poolSetpoint !== undefined ? String(action.poolSetpoint) : "";
      s.spaPct = action.spaSetpoint !== undefined ? String(action.spaSetpoint) : "";
      return s;
    }
    case "setPumpSpeed": {
      const s = blankStep("pump");
      s.pumpId = String(action.pumpId);
      s.rpm = String(action.rpm);
      return s;
    }
    case "runScene": {
      const s = blankStep("scene");
      s.sceneId = String(action.sceneId);
      return s;
    }
    case "allOff":
      return blankStep("allOff");
    case "superChlorinate":
    case "lightCommand": {
      const s = blankStep("raw");
      s.raw = action;
      return s;
    }
  }
}

export type StepResult = { ok: true; action: PoolAction } | { ok: false; error: string };

function num(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Convert a draft back into a PoolAction, or explain what's missing. */
export function stepToAction(step: StepDraft, snapshot: PoolStateSnapshot): StepResult {
  switch (step.kind) {
    case "circuit": {
      const id = num(step.circuitId);
      if (id === null) return { ok: false, error: "Pick a circuit." };
      return { ok: true, action: { type: "setCircuit", circuitId: id, state: step.on } };
    }
    case "heat": {
      const bodyId = num(step.bodyId);
      if (bodyId === null) return { ok: false, error: "Pick a body of water." };
      const hasMode = step.heatMode !== "keep";
      const sp = num(step.setPoint);
      if (step.setPoint.trim() !== "" && sp === null) return { ok: false, error: "Setpoint must be a number." };
      if (sp !== null && (sp < 60 || sp > 104)) return { ok: false, error: "Setpoint must be 60–104." };
      if (!hasMode && sp === null) return { ok: false, error: "Pick a heat mode or a setpoint." };
      if (hasMode && !isHeatMode(step.heatMode)) return { ok: false, error: "Unknown heat mode." };
      const action: Extract<PoolAction, { type: "setHeat" }> = { type: "setHeat", bodyId };
      if (hasMode && isHeatMode(step.heatMode)) action.mode = step.heatMode;
      if (sp !== null) action.setPoint = Math.round(sp);
      return { ok: true, action };
    }
    case "light": {
      const theme = num(step.theme);
      if (theme === null) return { ok: false, error: "Pick a theme." };
      if (step.lightTarget.startsWith("c:")) {
        const id = num(step.lightTarget.slice(2));
        if (id === null) return { ok: false, error: "Pick a light." };
        return { ok: true, action: { type: "setLightTheme", circuitId: id, theme } };
      }
      if (step.lightTarget.startsWith("g:")) {
        const id = num(step.lightTarget.slice(2));
        if (id === null) return { ok: false, error: "Pick a light group." };
        return { ok: true, action: { type: "setLightGroupTheme", groupId: id, theme } };
      }
      return { ok: false, error: "Pick a light or light group." };
    }
    case "chlorinator": {
      const chlorId = num(step.chlorId);
      if (chlorId === null) return { ok: false, error: "Pick a chlorinator." };
      const pool = num(step.poolPct);
      const spa = num(step.spaPct);
      if (step.poolPct.trim() === "" && step.spaPct.trim() === "") {
        return { ok: false, error: "Set a pool or spa output %." };
      }
      for (const v of [pool, spa]) {
        if (v !== null && (v < 0 || v > 100)) return { ok: false, error: "Output must be 0–100%." };
      }
      const action: Extract<PoolAction, { type: "setChlorinator" }> = { type: "setChlorinator", chlorId };
      if (pool !== null) action.poolSetpoint = Math.round(pool);
      if (spa !== null) action.spaSetpoint = Math.round(spa);
      if (action.poolSetpoint === undefined && action.spaSetpoint === undefined) {
        return { ok: false, error: "Output must be a number." };
      }
      return { ok: true, action };
    }
    case "pump": {
      const pumpId = num(step.pumpId);
      if (pumpId === null) return { ok: false, error: "Pick a pump." };
      const rpm = num(step.rpm);
      if (rpm === null) return { ok: false, error: "Enter an RPM." };
      const pump = snapshot.pumps.find((p) => p.id === pumpId);
      if (pump && (rpm < pump.minSpeed || rpm > pump.maxSpeed)) {
        return { ok: false, error: `RPM must be ${pump.minSpeed}–${pump.maxSpeed}.` };
      }
      return { ok: true, action: { type: "setPumpSpeed", pumpId, rpm: Math.round(rpm) } };
    }
    case "scene": {
      const sceneId = num(step.sceneId);
      if (sceneId === null) return { ok: false, error: "Pick a scene to run." };
      return { ok: true, action: { type: "runScene", sceneId } };
    }
    case "allOff":
      return { ok: true, action: { type: "allOff" } };
    case "raw": {
      if (!step.raw) return { ok: false, error: "Empty step." };
      return { ok: true, action: step.raw };
    }
  }
}

/** One-line human summary of an action, for step headers and previews. */
export function describeAction(action: PoolAction, snapshot: PoolStateSnapshot, scenes: SceneDef[]): string {
  const circuitName = (id: number): string => allCircuits(snapshot).find((c) => c.id === id)?.name ?? `Circuit ${id}`;
  switch (action.type) {
    case "setCircuit":
      return `${circuitName(action.circuitId)} ${action.state ? "on" : "off"}`;
    case "setHeat": {
      const body = snapshot.bodies.find((b) => b.id === action.bodyId);
      const parts: string[] = [];
      if (action.mode !== undefined) parts.push(heatModeLabel(action.mode).toLowerCase());
      if (action.setPoint !== undefined) parts.push(`${action.setPoint}°`);
      return `${body?.name ?? `Body ${action.bodyId}`} heat → ${parts.join(" · ")}`;
    }
    case "setLightTheme": {
      const theme = snapshot.lightThemes.find((t) => t.val === action.theme);
      return `${circuitName(action.circuitId)} → ${theme?.name ?? `theme ${action.theme}`}`;
    }
    case "setLightGroupTheme": {
      const group = snapshot.lightGroups.find((g) => g.id === action.groupId);
      const theme = snapshot.lightThemes.find((t) => t.val === action.theme);
      return `${group?.name ?? `Group ${action.groupId}`} → ${theme?.name ?? `theme ${action.theme}`}`;
    }
    case "setChlorinator": {
      const chlor = snapshot.chlorinators.find((c) => c.id === action.chlorId);
      const parts: string[] = [];
      if (action.poolSetpoint !== undefined) parts.push(`pool ${action.poolSetpoint}%`);
      if (action.spaSetpoint !== undefined) parts.push(`spa ${action.spaSetpoint}%`);
      return `${chlor?.name ?? "Chlorinator"} → ${parts.join(" / ")}`;
    }
    case "superChlorinate": {
      const chlor = snapshot.chlorinators.find((c) => c.id === action.chlorId);
      return action.on
        ? `Super-chlorinate ${chlor?.name ?? "chlorinator"} for ${action.hours}h`
        : `Super-chlorinate off (${chlor?.name ?? "chlorinator"})`;
    }
    case "setPumpSpeed": {
      const pump = snapshot.pumps.find((p) => p.id === action.pumpId);
      return `${pump?.name ?? `Pump ${action.pumpId}`} → ${action.rpm} RPM`;
    }
    case "runScene": {
      const scene = scenes.find((s) => s.id === action.sceneId);
      return `Run scene "${scene?.name ?? action.sceneId}"`;
    }
    case "lightCommand": {
      const target = action.isGroup
        ? snapshot.lightGroups.find((g) => g.id === action.targetId)?.name ?? `Group ${action.targetId}`
        : circuitName(action.targetId);
      return `${target} → ${LIGHT_COMMAND_LABELS[action.command] ?? action.command}`;
    }
    case "allOff":
      return "Everything off";
  }
}
