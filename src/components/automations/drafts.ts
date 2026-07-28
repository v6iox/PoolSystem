import type { AutomationTrigger, HeatModeInput, PoolAction, PoolEventKind } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";

/**
 * Editable draft shapes for the builder dialog. Numeric fields are kept as
 * strings while the user types (so an empty input isn't coerced to 0) and are
 * only converted to the strict `AutomationTrigger` / `PoolAction` unions when
 * the draft actually parses. `null` from a converter means "not valid yet".
 */

/* ── Triggers ─────────────────────────────────────────────────── */

export type TriggerDraft =
  | { type: "time"; at: string; days: number[] }
  | { type: "cron"; expression: string }
  | { type: "sun"; event: "sunrise" | "sunset"; offsetMinutes: number; days: number[] }
  | { type: "tempThreshold"; sensor: string; direction: "above" | "below"; value: string }
  | { type: "saltLow"; chlorId: string; belowPpm: string }
  | { type: "freezeProtect" }
  | { type: "event"; event: PoolEventKind };

export type TriggerType = TriggerDraft["type"];

export function defaultTriggerDraft(type: TriggerType, snapshot: PoolStateSnapshot): TriggerDraft {
  switch (type) {
    case "time":
      return { type: "time", at: "20:00", days: [] };
    case "cron":
      return { type: "cron", expression: "0 20 * * *" };
    case "sun":
      return { type: "sun", event: "sunset", offsetMinutes: 0, days: [] };
    case "tempThreshold":
      return { type: "tempThreshold", sensor: "air", direction: "above", value: "90" };
    case "saltLow":
      return {
        type: "saltLow",
        chlorId: snapshot.chlorinators[0] ? String(snapshot.chlorinators[0].id) : "",
        belowPpm: "2800",
      };
    case "freezeProtect":
      return { type: "freezeProtect" };
    case "event":
      return { type: "event", event: "njspcOffline" };
  }
}

export function triggerToDraft(trigger: AutomationTrigger): TriggerDraft {
  switch (trigger.type) {
    case "time":
      return { type: "time", at: trigger.at.padStart(5, "0"), days: [...trigger.days] };
    case "cron":
      return { type: "cron", expression: trigger.expression };
    case "sun":
      return { type: "sun", event: trigger.event, offsetMinutes: trigger.offsetMinutes, days: [...trigger.days] };
    case "tempThreshold":
      return { type: "tempThreshold", sensor: trigger.sensor, direction: trigger.direction, value: String(trigger.value) };
    case "saltLow":
      return { type: "saltLow", chlorId: String(trigger.chlorId), belowPpm: String(trigger.belowPpm) };
    case "freezeProtect":
      return { type: "freezeProtect" };
    case "event":
      return { type: "event", event: trigger.event };
  }
}

/** Basic structural check for a 5-field cron line; returns a problem string or null. */
export function cronProblem(expression: string): string | null {
  const parts = expression.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Expression required";
  if (parts.length !== 5) return "Needs 5 fields: minute hour day-of-month month day-of-week";
  if (parts.some((p) => !/^[0-9*,/-]+$/.test(p))) return "Fields may only use numbers, * , - /";
  return null;
}

export function draftToTrigger(draft: TriggerDraft): AutomationTrigger | null {
  switch (draft.type) {
    case "time": {
      if (!/^\d{1,2}:\d{2}$/.test(draft.at)) return null;
      return { type: "time", at: draft.at, days: [...draft.days].sort((a, b) => a - b) };
    }
    case "cron":
      return cronProblem(draft.expression) === null
        ? { type: "cron", expression: draft.expression.trim() }
        : null;
    case "sun":
      return {
        type: "sun",
        event: draft.event,
        offsetMinutes: draft.offsetMinutes,
        days: [...draft.days].sort((a, b) => a - b),
      };
    case "tempThreshold": {
      const value = Number(draft.value);
      if (draft.value.trim() === "" || !Number.isFinite(value)) return null;
      if (draft.sensor === "air") {
        return { type: "tempThreshold", sensor: "air", direction: draft.direction, value };
      }
      if (!/^body:\d+$/.test(draft.sensor)) return null;
      return {
        type: "tempThreshold",
        sensor: draft.sensor as `body:${number}`,
        direction: draft.direction,
        value,
      };
    }
    case "saltLow": {
      const chlorId = Number(draft.chlorId);
      const belowPpm = Number(draft.belowPpm);
      if (draft.chlorId === "" || !Number.isFinite(chlorId)) return null;
      if (draft.belowPpm.trim() === "" || !Number.isFinite(belowPpm) || belowPpm <= 0) return null;
      return { type: "saltLow", chlorId, belowPpm: Math.round(belowPpm) };
    }
    case "freezeProtect":
      return { type: "freezeProtect" };
    case "event":
      return { type: "event", event: draft.event };
  }
}

/* ── Actions ──────────────────────────────────────────────────── */

export type ActionDraft =
  | { kind: "setCircuit"; circuitId: string; state: boolean }
  | { kind: "setHeat"; bodyId: string; mode: HeatModeInput | "keep"; setPoint: string }
  | { kind: "setPumpSpeed"; pumpId: string; rpm: number }
  | { kind: "setChlorinator"; chlorId: string; poolSetpoint: string; spaSetpoint: string }
  | { kind: "superChlorinate"; chlorId: string; hours: string; on: boolean }
  | { kind: "lightTheme"; target: string; theme: string } // target "c:<circuitId>" | "g:<groupId>"
  | { kind: "runScene"; sceneId: string }
  | { kind: "allOff" };

export type ActionKind = ActionDraft["kind"];

export function defaultActionDraft(kind: ActionKind, snapshot: PoolStateSnapshot): ActionDraft {
  switch (kind) {
    case "setCircuit": {
      const first = [...snapshot.circuits, ...snapshot.features][0];
      return { kind: "setCircuit", circuitId: first ? String(first.id) : "", state: true };
    }
    case "setHeat":
      return {
        kind: "setHeat",
        bodyId: snapshot.bodies[0] ? String(snapshot.bodies[0].id) : "",
        mode: "heater",
        setPoint: "",
      };
    case "setPumpSpeed": {
      const pump = snapshot.pumps[0];
      return {
        kind: "setPumpSpeed",
        pumpId: pump ? String(pump.id) : "",
        rpm: pump ? Math.round((pump.minSpeed + pump.maxSpeed) / 2 / 10) * 10 : 2000,
      };
    }
    case "setChlorinator":
      return {
        kind: "setChlorinator",
        chlorId: snapshot.chlorinators[0] ? String(snapshot.chlorinators[0].id) : "",
        poolSetpoint: snapshot.chlorinators[0] ? String(snapshot.chlorinators[0].poolSetpoint) : "50",
        spaSetpoint: "",
      };
    case "superChlorinate":
      return {
        kind: "superChlorinate",
        chlorId: snapshot.chlorinators[0] ? String(snapshot.chlorinators[0].id) : "",
        hours: "24",
        on: true,
      };
    case "lightTheme": {
      const group = snapshot.lightGroups[0];
      const light = snapshot.circuits.find((c) => c.isLight);
      const target = group ? `g:${group.id}` : light ? `c:${light.id}` : "";
      const theme = snapshot.lightThemes[0];
      return { kind: "lightTheme", target, theme: theme ? String(theme.val) : "" };
    }
    case "runScene":
      return { kind: "runScene", sceneId: "" };
    case "allOff":
      return { kind: "allOff" };
  }
}

export function actionToDraft(action: PoolAction): ActionDraft {
  switch (action.type) {
    case "setCircuit":
      return { kind: "setCircuit", circuitId: String(action.circuitId), state: action.state };
    case "setHeat":
      return {
        kind: "setHeat",
        bodyId: String(action.bodyId),
        mode: action.mode ?? "keep",
        setPoint: action.setPoint !== undefined ? String(action.setPoint) : "",
      };
    case "setPumpSpeed":
      return { kind: "setPumpSpeed", pumpId: String(action.pumpId), rpm: action.rpm };
    case "setChlorinator":
      return {
        kind: "setChlorinator",
        chlorId: String(action.chlorId),
        poolSetpoint: action.poolSetpoint !== undefined ? String(action.poolSetpoint) : "",
        spaSetpoint: action.spaSetpoint !== undefined ? String(action.spaSetpoint) : "",
      };
    case "superChlorinate":
      return { kind: "superChlorinate", chlorId: String(action.chlorId), hours: String(action.hours), on: action.on };
    case "setLightTheme":
      return { kind: "lightTheme", target: `c:${action.circuitId}`, theme: String(action.theme) };
    case "setLightGroupTheme":
      return { kind: "lightTheme", target: `g:${action.groupId}`, theme: String(action.theme) };
    case "runScene":
      return { kind: "runScene", sceneId: String(action.sceneId) };
    // Light commands can't be authored by this editor and never appear in
    // stored automations today; degrade to a harmless theme draft on the same
    // target rather than crashing the edit dialog.
    case "lightCommand":
      return { kind: "lightTheme", target: `${action.isGroup ? "g" : "c"}:${action.targetId}`, theme: "" };
    case "allOff":
      return { kind: "allOff" };
  }
}

function toId(value: string): number | null {
  const n = Number(value);
  return value !== "" && Number.isFinite(n) ? n : null;
}

function toPercent(value: string): number | null | undefined {
  if (value.trim() === "") return undefined; // "leave unchanged"
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null; // invalid
  return Math.round(n);
}

export function draftToAction(draft: ActionDraft): PoolAction | null {
  switch (draft.kind) {
    case "setCircuit": {
      const circuitId = toId(draft.circuitId);
      return circuitId === null ? null : { type: "setCircuit", circuitId, state: draft.state };
    }
    case "setHeat": {
      const bodyId = toId(draft.bodyId);
      if (bodyId === null) return null;
      const setPoint = draft.setPoint.trim() === "" ? undefined : Number(draft.setPoint);
      if (setPoint !== undefined && (!Number.isFinite(setPoint) || setPoint < 40 || setPoint > 110)) return null;
      if (draft.mode === "keep" && setPoint === undefined) return null;
      return {
        type: "setHeat",
        bodyId,
        ...(draft.mode !== "keep" ? { mode: draft.mode } : {}),
        ...(setPoint !== undefined ? { setPoint: Math.round(setPoint) } : {}),
      };
    }
    case "setPumpSpeed": {
      const pumpId = toId(draft.pumpId);
      return pumpId === null ? null : { type: "setPumpSpeed", pumpId, rpm: Math.round(draft.rpm) };
    }
    case "setChlorinator": {
      const chlorId = toId(draft.chlorId);
      if (chlorId === null) return null;
      const pool = toPercent(draft.poolSetpoint);
      const spa = toPercent(draft.spaSetpoint);
      if (pool === null || spa === null) return null;
      if (pool === undefined && spa === undefined) return null;
      return {
        type: "setChlorinator",
        chlorId,
        ...(pool !== undefined ? { poolSetpoint: pool } : {}),
        ...(spa !== undefined ? { spaSetpoint: spa } : {}),
      };
    }
    case "superChlorinate": {
      const chlorId = toId(draft.chlorId);
      const hours = Number(draft.hours);
      if (chlorId === null) return null;
      if (draft.hours.trim() === "" || !Number.isFinite(hours) || hours < 1 || hours > 96) return null;
      return { type: "superChlorinate", chlorId, hours: Math.round(hours), on: draft.on };
    }
    case "lightTheme": {
      const theme = toId(draft.theme);
      const id = toId(draft.target.slice(2));
      if (theme === null || id === null) return null;
      if (draft.target.startsWith("c:")) return { type: "setLightTheme", circuitId: id, theme };
      if (draft.target.startsWith("g:")) return { type: "setLightGroupTheme", groupId: id, theme };
      return null;
    }
    case "runScene": {
      const sceneId = toId(draft.sceneId);
      return sceneId === null ? null : { type: "runScene", sceneId };
    }
    case "allOff":
      return { type: "allOff" };
  }
}
