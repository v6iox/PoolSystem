import type { PoolAction, AutomationTrigger } from "@/types/actions";

/**
 * Structural validation for action/trigger JSON arriving from clients,
 * the copilot, or stored rows. Semantic checks (does the circuit exist,
 * is the setpoint in range, may this role do it) happen in the control layer.
 */

const HEAT_MODES = new Set(["off", "heater", "solar", "solarpref"]);

export function validateActionShape(value: unknown): string | null {
  const a = value as Partial<PoolAction> | null;
  if (!a || typeof a !== "object" || typeof a.type !== "string") return "Action must have a type";
  switch (a.type) {
    case "setCircuit": {
      const x = a as { circuitId?: unknown; state?: unknown };
      if (typeof x.circuitId !== "number") return "setCircuit.circuitId must be a number";
      if (typeof x.state !== "boolean") return "setCircuit.state must be a boolean";
      return null;
    }
    case "setHeat": {
      const x = a as { bodyId?: unknown; mode?: unknown; setPoint?: unknown };
      if (typeof x.bodyId !== "number") return "setHeat.bodyId must be a number";
      if (x.mode !== undefined && (typeof x.mode !== "string" || !HEAT_MODES.has(x.mode))) {
        return "setHeat.mode must be off|heater|solar|solarpref";
      }
      if (x.setPoint !== undefined && typeof x.setPoint !== "number") return "setHeat.setPoint must be a number";
      if (x.mode === undefined && x.setPoint === undefined) return "setHeat needs mode or setPoint";
      return null;
    }
    case "setPumpSpeed": {
      const x = a as { pumpId?: unknown; rpm?: unknown };
      if (typeof x.pumpId !== "number" || typeof x.rpm !== "number") return "setPumpSpeed needs pumpId + rpm";
      return null;
    }
    case "setChlorinator": {
      const x = a as { chlorId?: unknown; poolSetpoint?: unknown; spaSetpoint?: unknown };
      if (typeof x.chlorId !== "number") return "setChlorinator.chlorId must be a number";
      if (x.poolSetpoint === undefined && x.spaSetpoint === undefined) return "setChlorinator needs a setpoint";
      if (x.poolSetpoint !== undefined && typeof x.poolSetpoint !== "number") return "poolSetpoint must be a number";
      if (x.spaSetpoint !== undefined && typeof x.spaSetpoint !== "number") return "spaSetpoint must be a number";
      return null;
    }
    case "superChlorinate": {
      const x = a as { chlorId?: unknown; hours?: unknown; on?: unknown };
      if (typeof x.chlorId !== "number" || typeof x.hours !== "number" || typeof x.on !== "boolean") {
        return "superChlorinate needs chlorId, hours, on";
      }
      return null;
    }
    case "setLightTheme": {
      const x = a as { circuitId?: unknown; theme?: unknown };
      if (typeof x.circuitId !== "number" || typeof x.theme !== "number") return "setLightTheme needs circuitId + theme";
      return null;
    }
    case "setLightGroupTheme": {
      const x = a as { groupId?: unknown; theme?: unknown };
      if (typeof x.groupId !== "number" || typeof x.theme !== "number") return "setLightGroupTheme needs groupId + theme";
      return null;
    }
    case "runScene": {
      const x = a as { sceneId?: unknown };
      if (typeof x.sceneId !== "number") return "runScene.sceneId must be a number";
      return null;
    }
    case "allOff":
      return null;
    default:
      return `Unknown action type "${String((a as { type?: unknown }).type)}"`;
  }
}

export function validateActionsShape(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return "actions must be a non-empty array";
  if (value.length > 25) return "Too many actions (max 25)";
  for (const action of value) {
    const err = validateActionShape(action);
    if (err) return err;
  }
  return null;
}

export function validateTriggerShape(value: unknown): string | null {
  const t = value as Partial<AutomationTrigger> | null;
  if (!t || typeof t !== "object" || typeof t.type !== "string") return "Trigger must have a type";
  switch (t.type) {
    case "cron": {
      const x = t as { expression?: unknown };
      if (typeof x.expression !== "string" || x.expression.trim().length === 0) return "cron.expression required";
      return null;
    }
    case "time": {
      const x = t as { at?: unknown; days?: unknown };
      if (typeof x.at !== "string" || !/^\d{1,2}:\d{2}$/.test(x.at)) return "time.at must be HH:MM";
      if (!Array.isArray(x.days) || x.days.some((d) => typeof d !== "number" || d < 0 || d > 6)) {
        return "time.days must be an array of 0–6";
      }
      return null;
    }
    case "sun": {
      const x = t as { event?: unknown; offsetMinutes?: unknown; days?: unknown };
      if (x.event !== "sunrise" && x.event !== "sunset") return "sun.event must be sunrise|sunset";
      if (typeof x.offsetMinutes !== "number" || Math.abs(x.offsetMinutes) > 360) {
        return "sun.offsetMinutes must be within ±360";
      }
      if (!Array.isArray(x.days) || x.days.some((d) => typeof d !== "number" || d < 0 || d > 6)) {
        return "sun.days must be an array of 0–6";
      }
      return null;
    }
    case "tempThreshold": {
      const x = t as { sensor?: unknown; direction?: unknown; value?: unknown };
      if (typeof x.sensor !== "string" || !(x.sensor === "air" || /^body:\d+$/.test(x.sensor))) {
        return "tempThreshold.sensor must be air or body:<id>";
      }
      if (x.direction !== "above" && x.direction !== "below") return "direction must be above|below";
      if (typeof x.value !== "number") return "tempThreshold.value must be a number";
      return null;
    }
    case "saltLow": {
      const x = t as { chlorId?: unknown; belowPpm?: unknown };
      if (typeof x.chlorId !== "number" || typeof x.belowPpm !== "number") return "saltLow needs chlorId + belowPpm";
      return null;
    }
    case "freezeProtect":
      return null;
    case "event": {
      const x = t as { event?: unknown };
      const events = new Set(["njspcOffline", "njspcOnline", "bodyAtSetpoint", "equipmentFault", "delayStart", "delayEnd"]);
      if (typeof x.event !== "string" || !events.has(x.event)) return "Unknown event kind";
      return null;
    }
    default:
      return `Unknown trigger type "${String((t as { type?: unknown }).type)}"`;
  }
}
