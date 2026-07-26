import {
  Braces,
  Clock,
  Droplets,
  Snowflake,
  Sunrise,
  Sunset,
  Thermometer,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AutomationDef, AutomationTrigger, PoolAction, PoolEventKind, SceneDef } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";
import { formatDays, formatMinutes } from "@/lib/utils";

/** One pending one-shot job as returned by GET /api/automations. */
export interface PendingJob {
  id: number;
  label: string;
  actions: PoolAction[];
  fireAt: number;
  source: string;
}

export interface AutomationsResponse {
  automations: AutomationDef[];
  pendingJobs: PendingJob[];
}

/** Empty day list means "every day" for automation triggers. */
export function describeTriggerDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return "Every day";
  return formatDays(days);
}

export const EVENT_OPTIONS: Array<{ value: PoolEventKind; label: string }> = [
  { value: "njspcOffline", label: "Controller goes offline" },
  { value: "njspcOnline", label: "Controller comes back online" },
  { value: "bodyAtSetpoint", label: "A body reaches its setpoint" },
  { value: "equipmentFault", label: "Equipment reports a fault" },
  { value: "delayStart", label: "A delay starts" },
  { value: "delayEnd", label: "A delay ends" },
];

const EVENT_DESC: Record<PoolEventKind, string> = {
  njspcOffline: "when the controller goes offline",
  njspcOnline: "when the controller comes back online",
  bodyAtSetpoint: "when a body reaches its heat setpoint",
  equipmentFault: "when equipment reports a fault",
  delayStart: "when a heater/valve delay starts",
  delayEnd: "when a heater/valve delay ends",
};

export function describeSunOffset(offsetMinutes: number, event: "sunrise" | "sunset"): string {
  if (offsetMinutes === 0) return `at ${event}`;
  const abs = Math.abs(offsetMinutes);
  const span =
    abs >= 60 ? (abs % 60 === 0 ? `${abs / 60}h` : `${Math.floor(abs / 60)}h ${abs % 60}m`) : `${abs}m`;
  return `${span} ${offsetMinutes > 0 ? "after" : "before"} ${event}`;
}

function timeToMinutes(at: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return h * 60 + m;
}

function bodyName(snapshot: PoolStateSnapshot, id: number): string {
  return snapshot.bodies.find((b) => b.id === id)?.name ?? `Body ${id}`;
}

function chlorName(snapshot: PoolStateSnapshot, id: number): string {
  return snapshot.chlorinators.find((c) => c.id === id)?.name ?? `Chlorinator ${id}`;
}

function circuitName(snapshot: PoolStateSnapshot, id: number): string {
  const hit = [...snapshot.circuits, ...snapshot.features].find((c) => c.id === id);
  if (hit) return hit.name;
  const body = snapshot.bodies.find((b) => b.circuitId === id);
  return body ? body.name : `Circuit ${id}`;
}

/** Human-readable one-liner for any trigger, e.g. "at 8:00 PM · Weekdays". */
export function describeTrigger(trigger: AutomationTrigger, snapshot: PoolStateSnapshot): string {
  switch (trigger.type) {
    case "cron":
      return `on cron ${trigger.expression}`;
    case "time": {
      const min = timeToMinutes(trigger.at);
      return `at ${min !== null ? formatMinutes(min) : trigger.at} · ${describeTriggerDays(trigger.days)}`;
    }
    case "sun":
      return `${describeSunOffset(trigger.offsetMinutes, trigger.event)} · ${describeTriggerDays(trigger.days)}`;
    case "tempThreshold": {
      const sensor =
        trigger.sensor === "air"
          ? "air"
          : bodyName(snapshot, Number(trigger.sensor.slice("body:".length)));
      return `when ${sensor} ${trigger.direction === "above" ? ">" : "<"} ${trigger.value}°`;
    }
    case "saltLow": {
      const name = snapshot.chlorinators.length > 1 ? `${chlorName(snapshot, trigger.chlorId)} salt` : "salt";
      return `when ${name} < ${trigger.belowPpm} ppm`;
    }
    case "freezeProtect":
      return "when freeze protection activates";
    case "event":
      return EVENT_DESC[trigger.event];
  }
}

export function triggerIcon(trigger: AutomationTrigger): LucideIcon {
  switch (trigger.type) {
    case "cron":
      return Braces;
    case "time":
      return Clock;
    case "sun":
      return trigger.event === "sunrise" ? Sunrise : Sunset;
    case "tempThreshold":
      return Thermometer;
    case "saltLow":
      return Droplets;
    case "freezeProtect":
      return Snowflake;
    case "event":
      return Zap;
  }
}

const HEAT_MODE_LABEL: Record<string, string> = {
  off: "off",
  heater: "heater",
  solar: "solar",
  solarpref: "solar preferred",
};

/** Human-readable one-liner for any PoolAction, names resolved from the snapshot. */
export function describeAction(
  action: PoolAction,
  snapshot: PoolStateSnapshot,
  scenes?: SceneDef[]
): string {
  switch (action.type) {
    case "setCircuit":
      return `${action.state ? "Turn on" : "Turn off"} ${circuitName(snapshot, action.circuitId)}`;
    case "setHeat": {
      const parts: string[] = [];
      if (action.mode !== undefined) parts.push(`heat ${HEAT_MODE_LABEL[action.mode] ?? action.mode}`);
      if (action.setPoint !== undefined) parts.push(`${action.setPoint}°`);
      return `${bodyName(snapshot, action.bodyId)} → ${parts.join(", ")}`;
    }
    case "setPumpSpeed": {
      const pump = snapshot.pumps.find((p) => p.id === action.pumpId);
      return `${pump?.name ?? `Pump ${action.pumpId}`} → ${action.rpm.toLocaleString()} RPM`;
    }
    case "setChlorinator": {
      const parts: string[] = [];
      if (action.poolSetpoint !== undefined) parts.push(`pool ${action.poolSetpoint}%`);
      if (action.spaSetpoint !== undefined) parts.push(`spa ${action.spaSetpoint}%`);
      return `${chlorName(snapshot, action.chlorId)} → ${parts.join(" · ")}`;
    }
    case "superChlorinate":
      return action.on
        ? `Super-chlorinate ${chlorName(snapshot, action.chlorId)} for ${action.hours}h`
        : `Stop super-chlorinating ${chlorName(snapshot, action.chlorId)}`;
    case "setLightTheme": {
      const theme = snapshot.lightThemes.find((t) => t.val === action.theme);
      return `${circuitName(snapshot, action.circuitId)} → ${theme?.name ?? `theme ${action.theme}`}`;
    }
    case "setLightGroupTheme": {
      const group = snapshot.lightGroups.find((g) => g.id === action.groupId);
      const theme = snapshot.lightThemes.find((t) => t.val === action.theme);
      return `${group?.name ?? `Light group ${action.groupId}`} → ${theme?.name ?? `theme ${action.theme}`}`;
    }
    case "runScene": {
      const scene = scenes?.find((s) => s.id === action.sceneId);
      return `Run scene “${scene?.name ?? `#${action.sceneId}`}”`;
    }
    case "allOff":
      return "Turn everything off";
  }
}
