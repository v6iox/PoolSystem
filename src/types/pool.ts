/**
 * Normalized pool domain model.
 *
 * njsPC's wire format (and the mock simulator) are translated into this shape
 * by an adapter, so every other layer — UI, automations, copilot, history —
 * works against one typed model regardless of what hardware is present.
 * Nothing here is hardcoded to a particular panel: adapters emit whatever
 * bodies/circuits/pumps the system actually reports.
 */

export type TempUnits = "F" | "C";

export type HeatMode = "off" | "heater" | "solar" | "solarpref";
export type HeatStatus = "off" | "heater" | "solar" | "cooling" | "dual";

export type BodyKind = "pool" | "spa";

export interface BodyState {
  id: number;
  name: string;
  kind: BodyKind;
  isOn: boolean;
  /** Current water temp; null when sensor unavailable / body off with no reading. */
  temp: number | null;
  setPoint: number;
  /** Bounds reported by the panel; used to clamp every setpoint write. */
  minSetPoint: number;
  maxSetPoint: number;
  heatMode: HeatMode;
  /** Modes this body actually supports, as reported by the system. */
  supportedHeatModes: HeatMode[];
  heatStatus: HeatStatus;
  /** Circuit that turns this body on (e.g. Pool = 6, Spa = 1 on EasyTouch). */
  circuitId: number;
  /** When the temp READING last changed (runtime-stamped) — staleness signal. */
  tempChangedAt?: number | null;
}

export interface CircuitState {
  id: number;
  name: string;
  /** njsPC circuit function, e.g. "generic", "pool", "spa", "intellibrite", "mastercleaner". */
  type: string;
  isOn: boolean;
  isLight: boolean;
  /** True when this entry came from the features collection rather than circuits. */
  isFeature: boolean;
  /** Current light theme value when isLight. */
  lightTheme: number | null;
  /** Whether the panel exposes this on the feature panel (njsPC showInFeatures). */
  showInFeatures: boolean;
}

export interface PumpState {
  id: number;
  name: string;
  /** e.g. "vs", "vsf", "vf", "ss" */
  type: string;
  isRunning: boolean;
  rpm: number;
  watts: number;
  /** GPM when the pump reports flow; null otherwise. */
  flow: number | null;
  minSpeed: number;
  maxSpeed: number;
  /** Speed presets (circuit → speed) reported by config, if any. */
  circuits: PumpCircuitSetting[];
}

export interface PumpCircuitSetting {
  circuitId: number;
  circuitName: string;
  speed: number;
  units: "rpm" | "gpm";
}

export interface ChlorinatorState {
  id: number;
  name: string;
  isActive: boolean;
  /** Output currently being applied, %. */
  currentOutput: number;
  poolSetpoint: number;
  spaSetpoint: number;
  saltLevel: number;
  /** ppm considered "low" for status display. */
  saltTarget: number;
  saltRequired: boolean;
  superChlor: boolean;
  superChlorHours: number;
  status: string;
}

export interface LightThemeDef {
  /** Value understood by the controller. */
  val: number;
  name: string;
  /** Whether this is a color, a show, or a command-style theme. */
  type: "color" | "show" | "command";
  /** Representative CSS color for UI swatches. */
  swatch: string;
}

export interface LightGroupState {
  id: number;
  name: string;
  circuitIds: number[];
  isOn: boolean;
  theme: number | null;
}

/** Minutes from midnight, local panel time. */
export type MinutesOfDay = number;

export interface ScheduleState {
  id: number;
  circuitId: number;
  circuitName: string;
  startTime: MinutesOfDay;
  endTime: MinutesOfDay;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  scheduleType: "repeat" | "runonce";
  /** Egg timer style schedules report no fixed start. */
  isEggTimer: boolean;
  heatSetpoint: number | null;
  heatSource: string | null;
  disabled: boolean;
  isActive: boolean;
}

export interface ChemControllerState {
  id: number;
  name: string;
  bodyId: number;
  ph: number | null;
  orp: number | null;
  phSetpoint: number | null;
  orpSetpoint: number | null;
  phDosing: string;
  orpDosing: string;
  alarms: string[];
}

export interface EquipmentInfo {
  model: string;
  controllerType: string;
  softwareVersion: string;
}

export type PanelMode = "auto" | "service" | "timeout" | "unknown";

export interface PoolStateSnapshot {
  /** False when njsPC (or the simulated backend) is unreachable. */
  connected: boolean;
  mock: boolean;
  /** Epoch ms of the last state update received. */
  lastUpdate: number;
  units: TempUnits;
  airTemp: number | null;
  /** When the air reading last changed (runtime-stamped). */
  airTempChangedAt?: number | null;
  solarTemp: number | null;
  freezeProtect: boolean;
  /** Heater/valve delay currently active. */
  delay: boolean;
  panelMode: PanelMode;
  bodies: BodyState[];
  circuits: CircuitState[];
  features: CircuitState[];
  pumps: PumpState[];
  chlorinators: ChlorinatorState[];
  lightGroups: LightGroupState[];
  /** Themes the installed light hardware supports, as reported. */
  lightThemes: LightThemeDef[];
  schedules: ScheduleState[];
  chem: ChemControllerState[];
  equipment: EquipmentInfo;
}

/** Everything a client is allowed to change, used by control APIs + copilot + automations. */
export interface ScheduleInput {
  id?: number;
  circuitId: number;
  startTime: MinutesOfDay;
  endTime: MinutesOfDay;
  days: number[];
  scheduleType: "repeat" | "runonce";
  heatSetpoint?: number | null;
  heatSource?: string | null;
}

export const EMPTY_SNAPSHOT: PoolStateSnapshot = {
  connected: false,
  mock: false,
  lastUpdate: 0,
  units: "F",
  airTemp: null,
  solarTemp: null,
  freezeProtect: false,
  delay: false,
  panelMode: "unknown",
  bodies: [],
  circuits: [],
  features: [],
  pumps: [],
  chlorinators: [],
  lightGroups: [],
  lightThemes: [],
  schedules: [],
  chem: [],
  equipment: { model: "", controllerType: "", softwareVersion: "" },
};
