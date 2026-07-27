import { io, type Socket } from "socket.io-client";
import { EMPTY_SNAPSHOT } from "@/types/pool";
import type {
  BodyState,
  ChlorinatorState,
  CircuitState,
  HeatMode,
  LightGroupState,
  LightThemeDef,
  PanelMode,
  PoolStateSnapshot,
  PumpState,
  ScheduleInput,
  ScheduleState,
} from "@/types/pool";
import { AdapterError, type PoolAdapter } from "./types";

/**
 * Adapter for nodejs-poolController (njsPC). REST for reads/writes, Socket.IO
 * for change notifications. njsPC's wire format differs subtly across panel
 * types, so parsing is defensive throughout: any value-object may be a bare
 * number/string or a {val,name,desc} triple, and any collection may be absent.
 * On every relevant socket event we debounce a full /state/all refetch —
 * partial-merge logic is where bridges rot, a LAN refetch is cheap.
 */

// ── tolerant extractors ────────────────────────────────────────────

type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return typeof v === "object" && v !== null ? (v as Json) : {};
}
function asArr(v: unknown): Json[] {
  return Array.isArray(v) ? v.filter((x): x is Json => typeof x === "object" && x !== null) : [];
}
function num(v: unknown, fallback = 0): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && v !== null && "val" in v) return num((v as Json).val, fallback);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  const n = num(v, Number.NaN);
  return Number.isFinite(n) ? n : null;
}
function str(v: unknown, fallback = ""): string {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const o = v as Json;
    if (typeof o.name === "string") return o.name;
    if (typeof o.desc === "string") return o.desc;
  }
  return fallback;
}
function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "object" && v !== null && "val" in v) return bool((v as Json).val);
  return false;
}

function heatModeFromName(name: string): HeatMode {
  const n = name.toLowerCase().replace(/[^a-z]/g, "");
  if (n.includes("solarpref") || n.includes("solarpreferred")) return "solarpref";
  if (n.includes("solar")) return "solar";
  if (n === "off" || n.includes("nochange") || n === "") return "off";
  return "heater";
}

const THEME_SWATCHES: Record<string, string> = {
  white: "#f4f6f0",
  green: "#22c55e",
  blue: "#3b82f6",
  magenta: "#d946ef",
  red: "#ef4444",
  sam: "linear-gradient(90deg,#22c55e,#3b82f6,#d946ef)",
  party: "linear-gradient(90deg,#ef4444,#f59e0b,#22c55e,#3b82f6)",
  romance: "linear-gradient(90deg,#d946ef,#f472b6)",
  caribbean: "linear-gradient(90deg,#06b6d4,#3b82f6)",
  american: "linear-gradient(90deg,#ef4444,#f4f6f0,#3b82f6)",
  sunset: "linear-gradient(90deg,#f97316,#ef4444,#d946ef)",
  royal: "linear-gradient(90deg,#6366f1,#8b5cf6)",
  colorsync: "#818cf8",
  colorswim: "#38bdf8",
  colorset: "#a78bfa",
};

// EasyTouch/IntelliTouch schedule day bitmask as normalized by njsPC.
const DAY_BITS = [1, 2, 4, 8, 16, 32, 64]; // Sun..Sat

const LIGHT_TYPES = new Set(["intellibrite", "colorlogic", "light", "magicstream", "globrite", "colorcascade", "dimmer"]);

export class NjspcAdapter implements PoolAdapter {
  readonly kind = "njspc" as const;

  private baseUrl: string;
  private socket: Socket | null = null;
  private snapshot: PoolStateSnapshot = { ...EMPTY_SNAPSHOT };
  private listeners = new Set<(snap: PoolStateSnapshot) => void>();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lightThemes: LightThemeDef[] = [];
  private connected = false;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async start(): Promise<void> {
    this.socket = io(this.baseUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      timeout: 10_000,
    });
    this.socket.on("connect", () => {
      this.connected = true;
      void this.refreshNow();
    });
    this.socket.on("disconnect", () => {
      this.connected = false;
      this.pushSnapshot({ ...this.snapshot, connected: false, lastUpdate: Date.now() });
    });
    // Any state-ish event → debounced full refresh.
    for (const ev of ["circuit", "body", "temps", "chlorinator", "pump", "schedule", "feature", "lightGroup", "equipment", "controller", "chemController", "delay", "freeze"]) {
      this.socket.on(ev, () => this.scheduleRefresh());
    }
    // Safety net poll in case socket events are missed.
    this.pollTimer = setInterval(() => void this.refreshNow().catch(() => undefined), 60_000);
    await this.refreshNow().catch(() => undefined);
  }

  stop(): void {
    this.socket?.disconnect();
    this.socket = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  getSnapshot(): PoolStateSnapshot {
    return this.snapshot;
  }

  onState(cb: (snap: PoolStateSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── mutations (REST) ─────────────────────────────────────────────

  async setCircuit(circuitId: number, state: boolean): Promise<void> {
    await this.put("/state/circuit/setState", { id: circuitId, state });
  }

  async setHeatMode(bodyId: number, mode: HeatMode): Promise<void> {
    const body = this.snapshot.bodies.find((b) => b.id === bodyId);
    const modeVal = this.heatModeVals.get(`${bodyId}:${mode}`) ?? this.heatModeVals.get(`*:${mode}`);
    if (modeVal !== undefined) {
      await this.put("/state/body/heatMode", { id: bodyId, mode: modeVal });
    } else {
      // Fall back to the name — recent njsPC accepts names too.
      await this.put("/state/body/heatMode", { id: bodyId, mode });
    }
    void body;
  }

  async setSetPoint(bodyId: number, setPoint: number): Promise<void> {
    await this.put("/state/body/setPoint", { id: bodyId, setPoint });
  }

  async setPumpSpeed(pumpId: number, rpm: number): Promise<void> {
    // njsPC programs speeds per pump circuit. Adjust the speed of the circuit
    // slot that is currently driving the pump (or the first slot as fallback).
    const config = await this.get("/config/all");
    const pumps = asArr(asObj(config).pumps);
    const pump = pumps.find((p) => num(p.id) === pumpId);
    if (!pump) throw new AdapterError(`Pump ${pumpId} not found in njsPC config`, 404);
    const circuits = asArr(pump.circuits);
    if (circuits.length === 0) throw new AdapterError(`Pump ${pumpId} has no programmed circuits`, 400);
    const active = this.snapshot.circuits.filter((c) => c.isOn).map((c) => c.id);
    const target =
      circuits.find((pc) => active.includes(num(asObj(pc.circuit).id ?? pc.circuit))) ?? circuits[0];
    if (!target) throw new AdapterError(`Pump ${pumpId} has no adjustable circuit`, 400);
    await this.put("/config/pump", {
      id: pumpId,
      circuits: [{ id: num(target.id, 1), circuit: num(asObj(target.circuit).id ?? target.circuit), speed: rpm, units: 0 }],
    });
  }

  async setChlorinator(chlorId: number, poolSetpoint?: number, spaSetpoint?: number): Promise<void> {
    const payload: Json = { id: chlorId };
    if (poolSetpoint !== undefined) payload.poolSetpoint = poolSetpoint;
    if (spaSetpoint !== undefined) payload.spaSetpoint = spaSetpoint;
    await this.put("/state/chlorinator/setChlor", payload);
  }

  async setSuperChlor(chlorId: number, on: boolean, hours: number): Promise<void> {
    await this.put("/state/chlorinator/setChlor", {
      id: chlorId,
      superChlorinate: on,
      superChlorHours: hours,
    });
  }

  async setLightTheme(circuitId: number, theme: number): Promise<void> {
    await this.put("/state/circuit/setTheme", { id: circuitId, theme });
  }

  async setLightGroupTheme(groupId: number, theme: number): Promise<void> {
    await this.put("/state/circuit/setTheme", { id: groupId, theme });
  }

  async upsertSchedule(input: ScheduleInput): Promise<void> {
    const scheduleDays = input.days.reduce((mask, d) => mask | (DAY_BITS[d] ?? 0), 0);
    const payload: Json = {
      circuit: input.circuitId,
      startTime: input.startTime,
      endTime: input.endTime,
      scheduleDays,
      scheduleType: input.scheduleType === "runonce" ? 26 : 0,
      heatSetpoint: input.heatSetpoint ?? undefined,
      heatSource: input.heatSource ?? undefined,
      startTimeType: 0,
      endTimeType: 0,
    };
    if (input.id !== undefined) payload.id = input.id;
    await this.put("/config/schedule", payload);
  }

  async deleteSchedule(scheduleId: number): Promise<void> {
    await this.request("DELETE", "/config/schedule", { id: scheduleId });
  }

  // ── fetch/normalize ──────────────────────────────────────────────

  /** heat mode value lookup discovered from config: "bodyId:mode" → panel val */
  private heatModeVals = new Map<string, number>();

  private scheduleRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      void this.refreshNow().catch(() => undefined);
    }, 250);
  }

  private async refreshNow(): Promise<void> {
    try {
      const state = asObj(await this.get("/state/all"));
      if (this.lightThemes.length === 0) await this.loadThemes();
      await this.loadHeatModes();
      this.connected = true;
      this.pushSnapshot(this.normalize(state));
    } catch {
      this.connected = false;
      this.pushSnapshot({ ...this.snapshot, connected: false, lastUpdate: Date.now() });
    }
  }

  private async loadThemes(): Promise<void> {
    // Prefer per-installation themes; fall back to a broad IntelliBrite set.
    try {
      const raw = await this.get("/config/lightThemes");
      const arr = asArr(raw);
      if (arr.length > 0) {
        this.lightThemes = arr.map((t) => {
          const name = str(t.name, str(t.desc, `Theme ${num(t.val)}`));
          const keyName = name.toLowerCase().replace(/[^a-z]/g, "");
          const type: LightThemeDef["type"] = keyName.startsWith("color") ? "command" : THEME_SWATCHES[keyName]?.startsWith("linear") ? "show" : "color";
          return { val: num(t.val), name, type, swatch: THEME_SWATCHES[keyName] ?? "#64748b" };
        });
      }
    } catch {
      // endpoint not present on this njsPC version — leave empty, UI falls back
    }
  }

  private async loadHeatModes(): Promise<void> {
    try {
      const config = asObj(await this.get("/config/all"));
      for (const body of asArr(asObj(config.temps).bodies)) {
        const id = num(body.id);
        for (const m of asArr(body.heatModes ?? asObj(config).heatModes)) {
          this.heatModeVals.set(`${id}:${heatModeFromName(str(m.name, str(m.desc)))}`, num(m.val));
        }
      }
    } catch {
      // keep name-based fallback
    }
  }

  private normalize(state: Json): PoolStateSnapshot {
    const temps = asObj(state.temps);
    const units: "F" | "C" = str(temps.units).toUpperCase().includes("C") ? "C" : "F";

    const bodies: BodyState[] = asArr(temps.bodies).map((b): BodyState => {
      const heatModeName = str(b.heatMode);
      const heatStatusName = str(b.heatStatus).toLowerCase();
      const kind: BodyState["kind"] = str(b.type).toLowerCase().includes("spa") || str(b.name).toLowerCase().includes("spa") ? "spa" : "pool";
      const bodyId = num(b.id);
      // Heat modes this body actually supports, discovered from config —
      // a system without solar simply never offers solar modes.
      const discovered = (["off", "heater", "solar", "solarpref"] as const).filter((mode) =>
        this.heatModeVals.has(`${bodyId}:${mode}`)
      );
      return {
        id: bodyId,
        name: str(b.name, kind === "spa" ? "Spa" : "Pool"),
        kind,
        isOn: bool(b.isOn),
        temp: numOrNull(b.temp),
        setPoint: num(b.setPoint, 78),
        minSetPoint: num(b.minSetPoint ?? asObj(b).setPointMin, 60),
        maxSetPoint: num(b.maxSetPoint ?? asObj(b).setPointMax, kind === "spa" ? 104 : 95),
        heatMode: heatModeFromName(heatModeName),
        supportedHeatModes: discovered.length >= 2 ? [...discovered] : ["off", "heater", "solar", "solarpref"],
        heatStatus: heatStatusName.includes("solar")
          ? "solar"
          : heatStatusName.includes("cool")
            ? "cooling"
            : heatStatusName.includes("heat") || heatStatusName.includes("dual")
              ? "heater"
              : "off",
        circuitId: num(b.circuit, kind === "spa" ? 1 : 6),
      };
    });

    const mapCircuit = (c: Json, isFeature: boolean): CircuitState => {
      const typeName = str(c.type).toLowerCase().replace(/[^a-z]/g, "");
      const isLight = LIGHT_TYPES.has(typeName) || "lightingTheme" in c;
      return {
        id: num(c.id),
        name: str(c.name, `Circuit ${num(c.id)}`),
        type: typeName || "generic",
        isOn: bool(c.isOn),
        isLight,
        isFeature,
        lightTheme: isLight ? numOrNull(c.lightingTheme) : null,
        showInFeatures: c.showInFeatures === undefined ? true : bool(c.showInFeatures),
      };
    };

    const circuits = asArr(state.circuits).map((c) => mapCircuit(c, false));
    const features = asArr(state.features).map((c) => mapCircuit(c, true));

    const pumps: PumpState[] = asArr(state.pumps).map((p): PumpState => {
      const rpm = num(p.rpm);
      return {
        id: num(p.id),
        name: str(p.name, `Pump ${num(p.id)}`),
        type: str(p.type, "pump").toLowerCase(),
        isRunning: rpm > 0 || num(p.watts) > 0,
        rpm,
        watts: num(p.watts),
        flow: numOrNull(p.flow),
        minSpeed: num(p.minSpeed, 450),
        maxSpeed: num(p.maxSpeed, 3450),
        circuits: asArr(p.circuits).map((pc) => ({
          circuitId: num(asObj(pc.circuit).id ?? pc.circuit),
          circuitName: str(asObj(pc.circuit).name, `Circuit ${num(asObj(pc.circuit).id ?? pc.circuit)}`),
          speed: num(pc.speed ?? pc.flow, 0),
          units: str(pc.units).toLowerCase().includes("gpm") ? "gpm" : "rpm",
        })),
      };
    });

    const chlorinators: ChlorinatorState[] = asArr(state.chlorinators).map((c): ChlorinatorState => ({
      id: num(c.id),
      name: str(c.name, "Chlorinator"),
      isActive: bool(c.currentOutput) || bool(c.isActive ?? c.active),
      currentOutput: num(c.currentOutput),
      poolSetpoint: num(c.poolSetpoint),
      spaSetpoint: num(c.spaSetpoint),
      saltLevel: num(c.saltLevel),
      saltTarget: num(c.saltTarget, 3400),
      saltRequired: bool(c.saltRequired),
      superChlor: bool(c.superChlor),
      superChlorHours: num(c.superChlorHours, 24),
      status: str(c.status, "ok"),
    }));

    const lightGroups: LightGroupState[] = asArr(state.lightGroups).map((g): LightGroupState => ({
      id: num(g.id),
      name: str(g.name, "Light Group"),
      circuitIds: asArr(g.circuits).map((gc) => num(asObj(gc.circuit).id ?? gc.circuit)),
      isOn: bool(g.isOn),
      theme: numOrNull(g.lightingTheme),
    }));

    const schedules: ScheduleState[] = asArr(state.schedules).map((s): ScheduleState => {
      const daysObj = asObj(s.scheduleDays);
      let days: number[] = [];
      const dayList = asArr(daysObj.days);
      if (dayList.length > 0) {
        days = dayList
          .map((d) => {
            const name = str(d.name, str(d.desc)).toLowerCase();
            return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].findIndex((prefix) => name.startsWith(prefix));
          })
          .filter((d) => d >= 0);
      } else {
        const mask = num(daysObj.val ?? s.scheduleDays);
        days = DAY_BITS.flatMap((bit, i) => ((mask & bit) !== 0 ? [i] : []));
      }
      const typeName = str(s.scheduleType).toLowerCase();
      return {
        id: num(s.id),
        circuitId: num(asObj(s.circuit).id ?? s.circuit),
        circuitName: str(asObj(s.circuit).name, `Circuit ${num(asObj(s.circuit).id ?? s.circuit)}`),
        startTime: num(s.startTime),
        endTime: num(s.endTime),
        days,
        scheduleType: typeName.includes("once") ? "runonce" : "repeat",
        isEggTimer: typeName.includes("egg"),
        heatSetpoint: numOrNull(s.heatSetpoint),
        heatSource: s.heatSource === undefined ? null : str(s.heatSource) || null,
        disabled: bool(s.disabled),
        isActive: bool(s.isActive ?? s.isOn),
      };
    });

    const chem = asArr(state.chemControllers).map((c) => {
      const ph = asObj(c.ph);
      const orp = asObj(c.orp);
      return {
        id: num(c.id),
        name: str(c.name, "IntelliChem"),
        bodyId: num(asObj(c.body).id ?? c.body, 1),
        ph: numOrNull(asObj(ph.probe).level ?? ph.level),
        orp: numOrNull(asObj(orp.probe).level ?? orp.level),
        phSetpoint: numOrNull(ph.setpoint),
        orpSetpoint: numOrNull(orp.setpoint),
        phDosing: str(ph.dosingStatus, "monitoring"),
        orpDosing: str(orp.dosingStatus, "monitoring"),
        alarms: Object.entries(asObj(c.alarms))
          .filter(([, v]) => bool(v) && num(v) !== 0)
          .map(([k]) => k),
      };
    });

    const modeName = str(state.mode).toLowerCase();
    const panelMode: PanelMode = modeName.includes("service")
      ? "service"
      : modeName.includes("timeout")
        ? "timeout"
        : modeName.includes("auto") || modeName === ""
          ? "auto"
          : "unknown";

    const equipmentObj = asObj(state.equipment);
    return {
      connected: this.connected,
      mock: false,
      lastUpdate: Date.now(),
      units,
      airTemp: numOrNull(temps.air),
      solarTemp: numOrNull(temps.solar),
      freezeProtect: bool(state.freeze),
      delay: bool(state.delay) || num(asObj(state.delay).val) > 0,
      panelMode,
      bodies,
      circuits,
      features,
      pumps,
      chlorinators,
      lightGroups,
      lightThemes: this.lightThemes,
      schedules,
      chem,
      equipment: {
        model: str(equipmentObj.model, "Pentair"),
        controllerType: str(equipmentObj.controllerType, "unknown"),
        softwareVersion: str(asObj(equipmentObj.controllerFirmware).version ?? equipmentObj.softwareVersion, ""),
      },
    };
  }

  private pushSnapshot(snap: PoolStateSnapshot): void {
    this.snapshot = snap;
    for (const cb of this.listeners) cb(snap);
  }

  // ── HTTP plumbing ────────────────────────────────────────────────

  private async get(path: string): Promise<unknown> {
    return this.request("GET", path);
  }

  private async put(path: string, body: Json): Promise<unknown> {
    return this.request("PUT", path, body);
  }

  private async request(method: string, path: string, body?: Json): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw new AdapterError(`njsPC unreachable: ${err instanceof Error ? err.message : "network error"}`, 503);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new AdapterError(`njsPC ${method} ${path} → ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`, 502);
    }
    return res.json().catch(() => ({}));
  }
}
