import { EMPTY_SNAPSHOT } from "@/types/pool";
import type {
  BodyState,
  ChlorinatorState,
  CircuitState,
  HeatMode,
  LightGroupState,
  LightThemeDef,
  PoolStateSnapshot,
  PumpState,
  ScheduleInput,
  ScheduleState,
} from "@/types/pool";
import {
  AdapterError,
  type AdvancedOptions,
  type CircuitConfigInput,
  type PoolAdapter,
  type TempCalibration,
  type TempCalibrationInput,
} from "./types";

/**
 * Full pool simulator for MOCK_MODE. Models a realistic EasyTouch system:
 * pool + spa, 10 circuits, IntelliFlo VS pump, IntelliChlor IC40, IntelliBrite
 * lights (+ a light group), schedules, and temperatures that drift toward
 * ambient and rise while heating. Runs entirely in-process — zero hardware.
 */

const INTELLIBRITE_THEMES: LightThemeDef[] = [
  { val: 0, name: "White", type: "color", swatch: "#f4f6f0" },
  { val: 1, name: "Green", type: "color", swatch: "#22c55e" },
  { val: 2, name: "Blue", type: "color", swatch: "#3b82f6" },
  { val: 3, name: "Magenta", type: "color", swatch: "#d946ef" },
  { val: 4, name: "Red", type: "color", swatch: "#ef4444" },
  { val: 5, name: "SAm", type: "show", swatch: "linear-gradient(90deg,#22c55e,#3b82f6,#d946ef)" },
  { val: 6, name: "Party", type: "show", swatch: "linear-gradient(90deg,#ef4444,#f59e0b,#22c55e,#3b82f6)" },
  { val: 7, name: "Romance", type: "show", swatch: "linear-gradient(90deg,#d946ef,#f472b6)" },
  { val: 8, name: "Caribbean", type: "show", swatch: "linear-gradient(90deg,#06b6d4,#3b82f6)" },
  { val: 9, name: "American", type: "show", swatch: "linear-gradient(90deg,#ef4444,#f4f6f0,#3b82f6)" },
  { val: 10, name: "Sunset", type: "show", swatch: "linear-gradient(90deg,#f97316,#ef4444,#d946ef)" },
  { val: 11, name: "Royal", type: "show", swatch: "linear-gradient(90deg,#6366f1,#8b5cf6)" },
  { val: 128, name: "Color Sync", type: "command", swatch: "#818cf8" },
  { val: 144, name: "Color Swim", type: "command", swatch: "#38bdf8" },
];

interface SimBody {
  id: number;
  name: string;
  kind: "pool" | "spa";
  circuitId: number;
  temp: number;
  setPoint: number;
  heatMode: HeatMode;
  heaterFiring: boolean;
}

interface SimCircuit {
  id: number;
  name: string;
  type: string;
  isOn: boolean;
  isLight: boolean;
  lightTheme: number | null;
  showInFeatures: boolean;
}

interface SimSchedule {
  id: number;
  circuitId: number;
  startTime: number;
  endTime: number;
  days: number[];
  scheduleType: "repeat" | "runonce";
  heatSetpoint: number | null;
  heatSource: string | null;
  disabled: boolean;
}

const TICK_MS = 3000;

export class MockAdapter implements PoolAdapter {
  readonly kind = "mock" as const;

  private listeners = new Set<(snap: PoolStateSnapshot) => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private superChlorUntil = 0;
  private scheduleSeq = 100;

  private bodies: SimBody[] = [
    { id: 1, name: "Pool", kind: "pool", circuitId: 6, temp: 78.4, setPoint: 90, heatMode: "off", heaterFiring: false },
    { id: 2, name: "Spa", kind: "spa", circuitId: 1, temp: 84.1, setPoint: 102, heatMode: "heater", heaterFiring: false },
  ];

  // Circuit roster mirrors a real EasyTouch install (spa, cleaner, spillway,
  // waterfall, jets, air blower, lights) so the mock demos feel true to life.
  private circuits: SimCircuit[] = [
    { id: 1, name: "Spa", type: "spa", isOn: false, isLight: false, lightTheme: null, showInFeatures: true },
    { id: 2, name: "Waterfall", type: "generic", isOn: false, isLight: false, lightTheme: null, showInFeatures: true },
    { id: 3, name: "Pool Lights", type: "intellibrite", isOn: false, isLight: true, lightTheme: 2, showInFeatures: true },
    { id: 4, name: "Spa Light", type: "intellibrite", isOn: false, isLight: true, lightTheme: 2, showInFeatures: true },
    { id: 5, name: "Cleaner", type: "mastercleaner", isOn: false, isLight: false, lightTheme: null, showInFeatures: true },
    { id: 6, name: "Pool", type: "pool", isOn: true, isLight: false, lightTheme: null, showInFeatures: true },
    { id: 7, name: "Jets", type: "generic", isOn: false, isLight: false, lightTheme: null, showInFeatures: true },
    { id: 8, name: "Landscape Lights", type: "light", isOn: false, isLight: true, lightTheme: null, showInFeatures: true },
    { id: 9, name: "Spillway", type: "generic", isOn: false, isLight: false, lightTheme: null, showInFeatures: true },
    { id: 10, name: "Air Blower", type: "generic", isOn: false, isLight: false, lightTheme: null, showInFeatures: true },
  ];

  private schedules: SimSchedule[] = [
    { id: 1, circuitId: 6, startTime: 8 * 60, endTime: 18 * 60, days: [0, 1, 2, 3, 4, 5, 6], scheduleType: "repeat", heatSetpoint: null, heatSource: null, disabled: false },
    { id: 2, circuitId: 5, startTime: 9 * 60, endTime: 11 * 60, days: [1, 3, 5], scheduleType: "repeat", heatSetpoint: null, heatSource: null, disabled: false },
    { id: 3, circuitId: 3, startTime: 20 * 60 + 30, endTime: 23 * 60, days: [5, 6], scheduleType: "repeat", heatSetpoint: null, heatSource: null, disabled: false },
  ];

  private lightGroup: LightGroupState = { id: 192, name: "Pool & Spa Lights", circuitIds: [3, 4], isOn: false, theme: 2 };

  private pump = {
    id: 1,
    name: "IntelliFlo VS",
    rpm: 2350,
    targetRpm: 2350,
    watts: 0,
    minSpeed: 450,
    maxSpeed: 3450,
  };

  private chlor = {
    id: 1,
    name: "IntelliChlor IC40",
    poolSetpoint: 50,
    spaSetpoint: 10,
    saltLevel: 3243,
    superChlorHours: 24,
  };

  private airTemp = 74;
  private solarTemp = 88;
  private freezeProtect = false;
  /** Sensor calibration offsets, applied to every reported reading. */
  private calib = { water1: 0, air: 0, solar1: 0 };

  /** Advanced panel-config emulation so the UI is fully testable in mock. */
  private circuitAdv = new Map<number, { eggTimer: number | null; freeze: boolean }>([
    [5, { eggTimer: 120, freeze: false }],
    [6, { eggTimer: null, freeze: true }],
  ]);
  private pumpPrograms = new Map<number, number>([
    [6, 2600],
    [1, 2200],
    [5, 3000],
    [2, 2400],
  ]);
  private valves = [
    { id: 1, name: "Intake", typeName: "standard", circuitId: 1 as number | null },
    { id: 2, name: "Return", typeName: "standard", circuitId: 1 as number | null },
  ];

  async start(): Promise<void> {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.emit();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onState(cb: (snap: PoolStateSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  getSnapshot(): PoolStateSnapshot {
    const filtration = this.circuitById(6);
    const spaCircuit = this.circuitById(1);
    const pumpRunning = Boolean(filtration?.isOn || spaCircuit?.isOn || this.circuitById(2)?.isOn || this.circuitById(5)?.isOn);
    const superChlorActive = this.superChlorUntil > Date.now();

    const bodies: BodyState[] = this.bodies.map((b) => ({
      id: b.id,
      name: b.name,
      kind: b.kind,
      isOn: this.circuitById(b.circuitId)?.isOn ?? false,
      temp: Math.round((b.temp + this.calib.water1) * 10) / 10,
      setPoint: b.setPoint,
      minSetPoint: 60,
      maxSetPoint: b.kind === "spa" ? 104 : 95,
      heatMode: b.heatMode,
      supportedHeatModes: ["off", "heater", "solar", "solarpref"],
      heatStatus: b.heaterFiring ? (b.heatMode === "solar" ? "solar" : "heater") : "off",
      circuitId: b.circuitId,
    }));

    const circuits: CircuitState[] = this.circuits.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      isOn: c.isOn,
      isLight: c.isLight,
      isFeature: false,
      lightTheme: c.lightTheme,
      showInFeatures: c.showInFeatures,
    }));

    const pumps: PumpState[] = [
      {
        id: this.pump.id,
        name: this.pump.name,
        type: "vs",
        isRunning: pumpRunning,
        rpm: pumpRunning ? this.pump.rpm : 0,
        watts: pumpRunning ? this.pump.watts : 0,
        flow: pumpRunning ? Math.round((this.pump.rpm / 3450) * 110) : 0,
        minSpeed: this.pump.minSpeed,
        maxSpeed: this.pump.maxSpeed,
        circuits: [
          { circuitId: 6, circuitName: this.circuitById(6)?.name ?? "Pool", speed: 2350, units: "rpm" },
          { circuitId: 1, circuitName: this.circuitById(1)?.name ?? "Spa", speed: 3100, units: "rpm" },
          { circuitId: 2, circuitName: this.circuitById(2)?.name ?? "Waterfall", speed: 2800, units: "rpm" },
          { circuitId: 5, circuitName: this.circuitById(5)?.name ?? "Cleaner", speed: 2600, units: "rpm" },
        ],
      },
    ];

    const spaOn = spaCircuit?.isOn ?? false;
    const chlorinators: ChlorinatorState[] = [
      {
        id: this.chlor.id,
        name: this.chlor.name,
        isActive: pumpRunning,
        currentOutput: !pumpRunning ? 0 : superChlorActive ? 100 : spaOn ? this.chlor.spaSetpoint : this.chlor.poolSetpoint,
        poolSetpoint: this.chlor.poolSetpoint,
        spaSetpoint: this.chlor.spaSetpoint,
        saltLevel: Math.round(this.chlor.saltLevel),
        saltTarget: 3400,
        saltRequired: this.chlor.saltLevel < 2800,
        superChlor: superChlorActive,
        superChlorHours: this.chlor.superChlorHours,
        status: pumpRunning ? "ok" : "standby",
      },
    ];

    const schedules: ScheduleState[] = this.schedules.map((s) => ({
      id: s.id,
      circuitId: s.circuitId,
      circuitName: this.circuitById(s.circuitId)?.name ?? `Circuit ${s.circuitId}`,
      startTime: s.startTime,
      endTime: s.endTime,
      days: s.days,
      scheduleType: s.scheduleType,
      isEggTimer: false,
      heatSetpoint: s.heatSetpoint,
      heatSource: s.heatSource,
      disabled: s.disabled,
      isActive: !s.disabled && this.scheduleActiveNow(s),
    }));

    return {
      ...EMPTY_SNAPSHOT,
      connected: true,
      mock: true,
      lastUpdate: Date.now(),
      units: "F",
      airTemp: Math.round((this.airTemp + this.calib.air) * 10) / 10,
      solarTemp: Math.round(this.solarTemp * 10) / 10,
      freezeProtect: this.freezeProtect,
      delay: false,
      panelMode: "auto",
      bodies,
      circuits,
      features: [],
      pumps,
      chlorinators,
      lightGroups: [{ ...this.lightGroup, isOn: this.lightGroup.circuitIds.some((id) => this.circuitById(id)?.isOn) }],
      lightThemes: INTELLIBRITE_THEMES,
      schedules,
      chem: [],
      equipment: { model: "EasyTouch2 8", controllerType: "easytouch", softwareVersion: "2.180 (simulated)" },
    };
  }

  // ── mutations ────────────────────────────────────────────────────

  async setCircuit(circuitId: number, state: boolean): Promise<void> {
    const c = this.circuitById(circuitId);
    if (!c) throw new AdapterError(`Unknown circuit ${circuitId}`, 404);
    c.isOn = state;
    // Body interlock: spa and pool circuits are mutually exclusive on a shared pump.
    if (state && c.type === "spa") {
      const pool = this.circuitById(6);
      if (pool) pool.isOn = false;
    }
    if (state && c.type === "pool") {
      const spa = this.circuitById(1);
      if (spa) spa.isOn = false;
    }
    this.emit();
  }

  async setHeatMode(bodyId: number, mode: HeatMode): Promise<void> {
    const b = this.bodyById(bodyId);
    if (!b) throw new AdapterError(`Unknown body ${bodyId}`, 404);
    b.heatMode = mode;
    this.emit();
  }

  async setSetPoint(bodyId: number, setPoint: number): Promise<void> {
    const b = this.bodyById(bodyId);
    if (!b) throw new AdapterError(`Unknown body ${bodyId}`, 404);
    const max = b.kind === "spa" ? 104 : 95;
    if (setPoint < 60 || setPoint > max) throw new AdapterError(`Setpoint ${setPoint} out of range 60–${max}`, 400);
    b.setPoint = setPoint;
    this.emit();
  }

  async setPumpSpeed(pumpId: number, rpm: number): Promise<void> {
    if (pumpId !== this.pump.id) throw new AdapterError(`Unknown pump ${pumpId}`, 404);
    if (rpm < this.pump.minSpeed || rpm > this.pump.maxSpeed) {
      throw new AdapterError(`RPM ${rpm} out of range ${this.pump.minSpeed}–${this.pump.maxSpeed}`, 400);
    }
    this.pump.targetRpm = rpm;
    this.emit();
  }

  async setChlorinator(chlorId: number, poolSetpoint?: number, spaSetpoint?: number): Promise<void> {
    if (chlorId !== this.chlor.id) throw new AdapterError(`Unknown chlorinator ${chlorId}`, 404);
    if (poolSetpoint !== undefined) this.chlor.poolSetpoint = clampPct(poolSetpoint);
    if (spaSetpoint !== undefined) this.chlor.spaSetpoint = clampPct(spaSetpoint);
    this.emit();
  }

  async setSuperChlor(chlorId: number, on: boolean, hours: number): Promise<void> {
    if (chlorId !== this.chlor.id) throw new AdapterError(`Unknown chlorinator ${chlorId}`, 404);
    this.chlor.superChlorHours = Math.max(1, Math.min(72, Math.round(hours)));
    this.superChlorUntil = on ? Date.now() + this.chlor.superChlorHours * 3600_000 : 0;
    this.emit();
  }

  async setLightTheme(circuitId: number, theme: number): Promise<void> {
    const c = this.circuitById(circuitId);
    if (!c || !c.isLight) throw new AdapterError(`Circuit ${circuitId} is not a light`, 400);
    c.lightTheme = theme;
    c.isOn = true;
    this.emit();
  }

  async setLightGroupTheme(groupId: number, theme: number): Promise<void> {
    if (groupId !== this.lightGroup.id) throw new AdapterError(`Unknown light group ${groupId}`, 404);
    this.lightGroup.theme = theme;
    for (const id of this.lightGroup.circuitIds) {
      const c = this.circuitById(id);
      if (c) {
        c.lightTheme = theme;
        c.isOn = true;
      }
    }
    this.emit();
  }

  async upsertSchedule(input: ScheduleInput): Promise<void> {
    if (!this.circuitById(input.circuitId)) throw new AdapterError(`Unknown circuit ${input.circuitId}`, 404);
    if (input.id !== undefined) {
      const existing = this.schedules.find((s) => s.id === input.id);
      if (!existing) throw new AdapterError(`Unknown schedule ${input.id}`, 404);
      existing.circuitId = input.circuitId;
      existing.startTime = input.startTime;
      existing.endTime = input.endTime;
      existing.days = input.days;
      existing.scheduleType = input.scheduleType;
      existing.heatSetpoint = input.heatSetpoint ?? null;
      existing.heatSource = input.heatSource ?? null;
    } else {
      this.schedules.push({
        id: this.scheduleSeq++,
        circuitId: input.circuitId,
        startTime: input.startTime,
        endTime: input.endTime,
        days: input.days,
        scheduleType: input.scheduleType,
        heatSetpoint: input.heatSetpoint ?? null,
        heatSource: input.heatSource ?? null,
        disabled: false,
      });
    }
    this.emit();
  }

  async getTempCalibration(): Promise<TempCalibration> {
    return {
      water1: this.calib.water1,
      water2: null,
      air: this.calib.air,
      solar1: this.calib.solar1,
      solar2: null,
      min: -10,
      max: 10,
    };
  }

  async setTempCalibration(input: TempCalibrationInput): Promise<void> {
    const clamp = (v: number): number => Math.max(-10, Math.min(10, Math.round(v)));
    if (input.water1 !== undefined) this.calib.water1 = clamp(input.water1);
    if (input.air !== undefined) this.calib.air = clamp(input.air);
    if (input.solar1 !== undefined) this.calib.solar1 = clamp(input.solar1);
    this.emit();
  }

  // ── advanced panel configuration (simulated) ─────────────────────

  async getAdvancedOptions(): Promise<AdvancedOptions> {
    const name = (id: number): string => this.circuitById(id)?.name ?? `Circuit ${id}`;
    return {
      circuits: this.circuits.map((c) => ({
        id: c.id,
        name: c.name,
        typeVal: null,
        typeName: c.type,
        eggTimer: this.circuitAdv.get(c.id)?.eggTimer ?? null,
        freeze: this.circuitAdv.get(c.id)?.freeze ?? false,
        showInFeatures: c.showInFeatures,
      })),
      circuitFunctions: [
        { val: 0, name: "Generic", isLight: false },
        { val: 5, name: "Master Cleaner", isLight: false },
        { val: 7, name: "Light", isLight: true },
        { val: 16, name: "IntelliBrite", isLight: true },
        { val: 12, name: "Pool", isLight: false },
        { val: 1, name: "Spa", isLight: false },
      ],
      pumps: [
        {
          id: this.pump.id,
          name: this.pump.name,
          typeName: "vs",
          minSpeed: this.pump.minSpeed,
          maxSpeed: this.pump.maxSpeed,
          circuits: [...this.pumpPrograms.entries()].map(([circuitId, speed]) => ({
            circuitId,
            circuitName: name(circuitId),
            speed,
            units: "rpm" as const,
          })),
        },
      ],
      lightGroups: [{ id: this.lightGroup.id, name: this.lightGroup.name, circuitIds: [...this.lightGroup.circuitIds] }],
      lightCircuitIds: this.circuits.filter((c) => c.isLight).map((c) => c.id),
      heaters: [{ id: 1, name: "Gas Heater", typeName: "gas", bodyDesc: "Pool & Spa", coolingEnabled: null }],
      valves: this.valves.map((v) => ({ ...v, circuitName: v.circuitId !== null ? name(v.circuitId) : "" })),
      clock: { source: "server", mode: "12h", serverTime: new Date().toISOString(), panelTime: new Date().toISOString() },
    };
  }

  async setCircuitConfig(input: CircuitConfigInput): Promise<void> {
    const circuit = this.circuitById(input.id);
    if (!circuit) throw new AdapterError(`Circuit ${input.id} not found`, 404);
    if (input.name !== undefined && input.name.trim()) circuit.name = input.name.trim().slice(0, 24);
    if (input.showInFeatures !== undefined) circuit.showInFeatures = input.showInFeatures;
    const adv = this.circuitAdv.get(input.id) ?? { eggTimer: null, freeze: false };
    if (input.eggTimer !== undefined) adv.eggTimer = input.eggTimer > 0 ? Math.round(input.eggTimer) : null;
    if (input.freeze !== undefined) adv.freeze = input.freeze;
    this.circuitAdv.set(input.id, adv);
    this.emit();
  }

  async setPumpCircuitSpeed(pumpId: number, circuitId: number, speed: number): Promise<void> {
    if (pumpId !== this.pump.id) throw new AdapterError(`Pump ${pumpId} not found`, 404);
    if (speed < this.pump.minSpeed || speed > this.pump.maxSpeed) {
      throw new AdapterError(`Speed must be ${this.pump.minSpeed}–${this.pump.maxSpeed} RPM`, 400);
    }
    this.pumpPrograms.set(circuitId, Math.round(speed));
    if (this.circuitById(circuitId)?.isOn) this.pump.targetRpm = Math.round(speed);
    this.emit();
  }

  async setLightGroup(id: number, patch: { name?: string; circuitIds?: number[] }): Promise<void> {
    if (id !== this.lightGroup.id) throw new AdapterError(`Light group ${id} not found`, 404);
    if (patch.name !== undefined && patch.name.trim()) this.lightGroup.name = patch.name.trim().slice(0, 24);
    if (patch.circuitIds !== undefined) {
      this.lightGroup.circuitIds = patch.circuitIds.filter((cid) => this.circuitById(cid)?.isLight);
    }
    this.emit();
  }

  async setValveName(id: number, name: string): Promise<void> {
    const valve = this.valves.find((v) => v.id === id);
    if (!valve) throw new AdapterError(`Valve ${id} not found`, 404);
    if (name.trim()) valve.name = name.trim().slice(0, 24);
    this.emit();
  }

  async syncPanelClock(): Promise<void> {
    // The simulator's clock is the server clock — nothing to do.
  }

  async cancelDelay(): Promise<void> {
    // The simulator never delays; treat as success.
  }

  async deleteSchedule(scheduleId: number): Promise<void> {
    const idx = this.schedules.findIndex((s) => s.id === scheduleId);
    if (idx === -1) throw new AdapterError(`Unknown schedule ${scheduleId}`, 404);
    this.schedules.splice(idx, 1);
    this.emit();
  }

  // ── simulation ───────────────────────────────────────────────────

  private tick(): void {
    const dtHours = TICK_MS / 3600_000;
    const hour = new Date().getHours() + new Date().getMinutes() / 60;

    // Ambient: sinusoidal day cycle + noise. Coldest ~5am, warmest ~4pm.
    const dayTarget = 70 + 14 * Math.sin(((hour - 10) / 24) * Math.PI * 2);
    this.airTemp += (dayTarget - this.airTemp) * 0.02 + (Math.random() - 0.5) * 0.08;
    this.solarTemp = this.airTemp + (hour > 8 && hour < 18 ? 16 : 2) + (Math.random() - 0.5);

    for (const b of this.bodies) {
      const on = this.circuitById(b.circuitId)?.isOn ?? false;
      const wantsHeat = on && b.heatMode !== "off" && b.temp < b.setPoint - 0.15;
      b.heaterFiring = wantsHeat;
      if (b.heaterFiring) {
        // Spa heats fast (~15°F/hr), pool slowly (~1.5°F/hr) — accelerated ~6x in mock so demos are watchable.
        const rate = b.kind === "spa" ? 90 : 9;
        b.temp += rate * dtHours;
        if (b.temp >= b.setPoint) {
          b.temp = b.setPoint;
          b.heaterFiring = false;
        }
      } else {
        // Drift toward ambient.
        b.temp += (this.airTemp - b.temp) * 0.0015 + (Math.random() - 0.5) * 0.02;
      }
    }

    // Pump ramps toward target and wattage follows a cubic-ish affinity curve.
    this.pump.rpm += Math.sign(this.pump.targetRpm - this.pump.rpm) * Math.min(150, Math.abs(this.pump.targetRpm - this.pump.rpm));
    const frac = this.pump.rpm / this.pump.maxSpeed;
    this.pump.watts = Math.round(1650 * frac ** 2.6 + (Math.random() - 0.5) * 12);

    // Salt drifts down very slowly while chlorinating.
    const pumpRunning = Boolean(this.circuitById(6)?.isOn || this.circuitById(1)?.isOn);
    if (pumpRunning) this.chlor.saltLevel -= 0.02 + Math.random() * 0.02;

    this.freezeProtect = this.airTemp <= 35;
    this.emit();
  }

  private scheduleActiveNow(s: SimSchedule): boolean {
    const d = new Date();
    const minutes = d.getHours() * 60 + d.getMinutes();
    return s.days.includes(d.getDay()) && minutes >= s.startTime && minutes < s.endTime;
  }

  private circuitById(id: number): SimCircuit | undefined {
    return this.circuits.find((c) => c.id === id);
  }

  private bodyById(id: number): SimBody | undefined {
    return this.bodies.find((b) => b.id === id);
  }

  private emit(): void {
    const snap = this.getSnapshot();
    for (const cb of this.listeners) cb(snap);
  }
}

function clampPct(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}
