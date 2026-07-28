import type { PoolStateSnapshot, ScheduleInput, HeatMode } from "@/types/pool";

/**
 * The contract both backends implement:
 *  - MockAdapter: in-process simulator (MOCK_MODE=true, zero hardware)
 *  - NjspcAdapter: nodejs-poolController over REST + Socket.IO
 *
 * All mutations resolve once the backend acknowledges; adapters then emit a
 * fresh snapshot via the "state" event. The runtime layer fans snapshots out
 * to authenticated SSE clients.
 */
/**
 * Panel temperature-sensor calibration offsets (what ScreenLogic calls the
 * water/air/solar temperature offsets). null = that sensor isn't reported.
 */
export interface TempCalibration {
  water1: number;
  water2: number | null;
  air: number | null;
  solar1: number | null;
  solar2: number | null;
  /** Offset bounds in panel units. */
  min: number;
  max: number;
}

export interface TempCalibrationInput {
  water1?: number;
  water2?: number;
  air?: number;
  solar1?: number;
  solar2?: number;
}

/* ── advanced panel configuration (the "everything else" njsPC exposes) ── */

export interface AdvancedCircuitConfig {
  id: number;
  name: string;
  typeVal: number | null;
  typeName: string;
  /** Egg timer minutes; null = none configured. */
  eggTimer: number | null;
  freeze: boolean;
  showInFeatures: boolean;
}

export interface CircuitFunctionDef {
  val: number;
  name: string;
  isLight: boolean;
}

export interface AdvancedPumpCircuit {
  circuitId: number;
  circuitName: string;
  speed: number;
  units: "rpm" | "gpm";
}

export interface AdvancedPump {
  id: number;
  name: string;
  typeName: string;
  minSpeed: number;
  maxSpeed: number;
  circuits: AdvancedPumpCircuit[];
}

export interface AdvancedLightGroup {
  id: number;
  name: string;
  circuitIds: number[];
}

export interface AdvancedHeater {
  id: number;
  name: string;
  typeName: string;
  bodyDesc: string;
  coolingEnabled: boolean | null;
}

export interface AdvancedValve {
  id: number;
  name: string;
  typeName: string;
  circuitId: number | null;
  circuitName: string;
}

export interface PanelClock {
  /** e.g. "manual" | "server" | "internet" — whatever the panel reports. */
  source: string;
  mode: "12h" | "24h" | "unknown";
  serverTime: string;
  /** What the PANEL currently thinks the time is (null when it doesn't say). */
  panelTime: string | null;
}

export interface AdvancedOptions {
  circuits: AdvancedCircuitConfig[];
  circuitFunctions: CircuitFunctionDef[];
  pumps: AdvancedPump[];
  lightGroups: AdvancedLightGroup[];
  lightCircuitIds: number[];
  heaters: AdvancedHeater[];
  valves: AdvancedValve[];
  clock: PanelClock;
}

export interface CircuitConfigInput {
  id: number;
  name?: string;
  type?: number;
  eggTimer?: number;
  freeze?: boolean;
  showInFeatures?: boolean;
}

export interface PoolAdapter {
  readonly kind: "mock" | "njspc";
  start(): Promise<void>;
  stop(): void;
  /** Latest normalized snapshot (synchronously available after start). */
  getSnapshot(): PoolStateSnapshot;
  onState(cb: (snap: PoolStateSnapshot) => void): () => void;

  setCircuit(circuitId: number, state: boolean): Promise<void>;
  setHeatMode(bodyId: number, mode: HeatMode): Promise<void>;
  setSetPoint(bodyId: number, setPoint: number): Promise<void>;
  setPumpSpeed(pumpId: number, rpm: number): Promise<void>;
  setChlorinator(chlorId: number, poolSetpoint?: number, spaSetpoint?: number): Promise<void>;
  setSuperChlor(chlorId: number, on: boolean, hours: number): Promise<void>;
  setLightTheme(circuitId: number, theme: number): Promise<void>;
  setLightGroupTheme(groupId: number, theme: number): Promise<void>;
  upsertSchedule(input: ScheduleInput): Promise<void>;
  deleteSchedule(scheduleId: number): Promise<void>;
  getTempCalibration(): Promise<TempCalibration>;
  setTempCalibration(input: TempCalibrationInput): Promise<void>;
  getAdvancedOptions(): Promise<AdvancedOptions>;
  setCircuitConfig(input: CircuitConfigInput): Promise<void>;
  setPumpCircuitSpeed(pumpId: number, circuitId: number, speed: number): Promise<void>;
  setLightGroup(id: number, patch: { name?: string; circuitIds?: number[] }): Promise<void>;
  setValveName(id: number, name: string): Promise<void>;
  syncPanelClock(): Promise<void>;
  cancelDelay(): Promise<void>;
}

export class AdapterError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502
  ) {
    super(message);
    this.name = "AdapterError";
  }
}
