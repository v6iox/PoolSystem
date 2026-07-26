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
