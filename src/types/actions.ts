/**
 * The single action vocabulary shared by scenes, automations, scheduled jobs
 * and the copilot. Everything that can change pool state is expressed as one
 * of these, and executed through one validated, audited control layer.
 */

/** IntelliBrite/panel light bus commands beyond plain themes. */
export type LightCommand = "colorsync" | "colorswim" | "colorset" | "colorhold" | "colorrecall";

export const LIGHT_COMMAND_LABELS: Record<LightCommand, string> = {
  colorsync: "Sync colors",
  colorswim: "Color swim",
  colorset: "Color set",
  colorhold: "Hold colors",
  colorrecall: "Recall colors",
};

export type PoolAction =
  | { type: "setCircuit"; circuitId: number; state: boolean }
  | { type: "setHeat"; bodyId: number; mode?: HeatModeInput; setPoint?: number }
  | { type: "setPumpSpeed"; pumpId: number; rpm: number }
  | { type: "setChlorinator"; chlorId: number; poolSetpoint?: number; spaSetpoint?: number }
  | { type: "superChlorinate"; chlorId: number; hours: number; on: boolean }
  | { type: "setLightTheme"; circuitId: number; theme: number }
  | { type: "setLightGroupTheme"; groupId: number; theme: number }
  | { type: "lightCommand"; targetId: number; command: LightCommand; isGroup: boolean }
  | { type: "runScene"; sceneId: number }
  | { type: "allOff" };

export type HeatModeInput = "off" | "heater" | "solar" | "solarpref";

export type ActionSource = "ui" | "copilot" | "automation" | "scene" | "schedule" | "system";

export interface ActionResult {
  ok: boolean;
  action: PoolAction;
  /** Human-readable outcome, e.g. "Spa setpoint → 102°F". */
  summary: string;
  error?: string;
}

/** Automation trigger definitions (stored as JSON in SQLite). */
export type AutomationTrigger =
  | { type: "cron"; expression: string }
  | { type: "time"; at: string; days: number[] } // "HH:MM" 24h, days 0=Sun..6=Sat, empty = every day
  | { type: "sun"; event: "sunrise" | "sunset"; offsetMinutes: number; days: number[] }
  | { type: "tempThreshold"; sensor: "air" | `body:${number}`; direction: "above" | "below"; value: number }
  | { type: "saltLow"; chlorId: number; belowPpm: number }
  | { type: "freezeProtect" } // fires when freeze protection activates
  | { type: "event"; event: PoolEventKind }; // njsPC / simulator event edges

export type PoolEventKind =
  | "njspcOffline"
  | "njspcOnline"
  | "bodyAtSetpoint" // any body reaches its setpoint while heating
  | "equipmentFault"
  | "delayStart"
  | "delayEnd";

export interface AutomationDef {
  id: number;
  name: string;
  trigger: AutomationTrigger;
  actions: PoolAction[];
  enabled: boolean;
  createdBy: number | null;
  createdByName: string;
  createdVia: "ui" | "copilot";
  lastRunAt: number | null;
  lastResult: string | null;
}

export interface ScheduledJob {
  id: number;
  label: string;
  actions: PoolAction[];
  fireAt: number; // epoch ms
  createdBy: number | null;
  source: ActionSource;
  status: "pending" | "done" | "error" | "cancelled";
}

export interface SceneDef {
  id: number;
  name: string;
  icon: string;
  description: string;
  actions: PoolAction[];
  guestVisible: boolean;
  position: number;
  createdBy: number | null;
}
