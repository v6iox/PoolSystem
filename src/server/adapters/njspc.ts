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
import {
  AdapterError,
  type AdvancedCircuitConfig,
  type AdvancedHeater,
  type AdvancedLightGroup,
  type AdvancedOptions,
  type AdvancedPump,
  type AdvancedValve,
  type CircuitConfigInput,
  type CircuitFunctionDef,
  type PoolAdapter,
  type TempCalibration,
  type TempCalibrationInput,
} from "./types";

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

  /**
   * Apply a theme val to a circuit/group id. njsPC routes vary by version:
   * newer builds accept the numeric val on /state/circuit/setTheme, some want
   * the theme NAME, and light-specific builds use /state/light/setTheme.
   * Try in order; first success wins.
   */
  private async putTheme(id: number, theme: number): Promise<void> {
    const name = this.lightThemes.find((t) => t.val === theme)?.name.toLowerCase();
    const attempts: Array<[string, Json]> = [
      ["/state/circuit/setTheme", { id, theme }],
      ...(name ? ([["/state/circuit/setTheme", { id, theme: name }]] as Array<[string, Json]>) : []),
      ["/state/light/setTheme", { id, theme }],
    ];
    let lastErr: unknown = null;
    for (const [path, payload] of attempts) {
      try {
        await this.put(path, payload);
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new AdapterError("Light theme change failed", 502);
  }

  async setLightTheme(circuitId: number, theme: number): Promise<void> {
    await this.putTheme(circuitId, theme);
  }

  async setLightGroupTheme(groupId: number, theme: number): Promise<void> {
    await this.putTheme(groupId, theme);
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
      // Panel-native sun anchoring: 0 = manual, 1 = sunrise, 2 = sunset —
      // the panel recomputes the actual time daily, no server involved.
      startTimeType: input.startTimeType === "sunrise" ? 1 : input.startTimeType === "sunset" ? 2 : 0,
      endTimeType: input.endTimeType === "sunrise" ? 1 : input.endTimeType === "sunset" ? 2 : 0,
    };
    if (input.id !== undefined) payload.id = input.id;
    await this.put("/config/schedule", payload);
  }

  async deleteSchedule(scheduleId: number): Promise<void> {
    await this.request("DELETE", "/config/schedule", { id: scheduleId });
  }

  async getTempCalibration(): Promise<TempCalibration> {
    // dashPanel reads these from /config/options/general; older builds keep
    // them under equipment.tempSensors in /config/all. Try both.
    let temps: Record<string, unknown> = {};
    try {
      const opts = asObj(await this.get("/config/options/general"));
      temps = asObj(opts.temps);
    } catch {
      // fall through to /config/all
    }
    if (Object.keys(temps).length === 0) {
      const config = asObj(await this.get("/config/all"));
      temps = asObj(asObj(config.equipment).tempSensors);
    }
    const val = (key: string): number | null => {
      const v = temps[key];
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    };
    return {
      water1: val("waterTempAdj1") ?? 0,
      water2: val("waterTempAdj2"),
      air: val("airTempAdj"),
      solar1: val("solarTempAdj1"),
      solar2: val("solarTempAdj2"),
      min: -10,
      max: 10,
    };
  }

  async setTempCalibration(input: TempCalibrationInput): Promise<void> {
    const payload: Json = {};
    if (input.water1 !== undefined) payload.waterTempAdj1 = input.water1;
    if (input.water2 !== undefined) payload.waterTempAdj2 = input.water2;
    if (input.air !== undefined) payload.airTempAdj = input.air;
    if (input.solar1 !== undefined) payload.solarTempAdj1 = input.solar1;
    if (input.solar2 !== undefined) payload.solarTempAdj2 = input.solar2;
    if (Object.keys(payload).length === 0) return;
    await this.put("/config/tempSensors", payload);
    this.scheduleRefresh();
  }

  // ── advanced panel configuration ─────────────────────────────────

  async getAdvancedOptions(): Promise<AdvancedOptions> {
    // Each area comes from its own njsPC options endpoint; any one failing
    // (older builds, odd equipment) just leaves that area empty.
    const opt = async (path: string): Promise<Json> => asObj(await this.get(path).catch(() => ({})));
    const [circuitsOpt, pumpsOpt, lightsOpt, heatersOpt, valvesOpt, generalOpt, stateAll, rs485Opt, restoreOpt, chemOpt, doserOpt, coversOpt, remotesOpt] =
      await Promise.all([
        opt("/config/options/circuits"),
        opt("/config/options/pumps"),
        opt("/config/options/lightGroups"),
        opt("/config/options/heaters"),
        opt("/config/options/valves"),
        opt("/config/options/general"),
        opt("/state/all"),
        opt("/config/options/rs485"),
        opt("/app/config/options/restore"),
        opt("/config/options/chemControllers"),
        opt("/config/options/chemDosers"),
        opt("/config/options/covers"),
        opt("/config/options/remotes"),
      ]);

    const circuitName = (id: number): string =>
      [...this.snapshot.circuits, ...this.snapshot.features].find((c) => c.id === id)?.name ?? `Circuit ${id}`;

    const circuits: AdvancedCircuitConfig[] = asArr(circuitsOpt.circuits).map((c) => ({
      id: num(c.id),
      name: str(c.name, `Circuit ${num(c.id)}`),
      typeVal: numOrNull(asObj(c.type).val ?? c.type),
      typeName: str(c.type, "generic"),
      eggTimer: numOrNull(c.eggTimer),
      freeze: bool(c.freeze),
      showInFeatures: c.showInFeatures === undefined ? true : bool(c.showInFeatures),
    }));

    const circuitFunctions: CircuitFunctionDef[] = asArr(circuitsOpt.functions).map((f) => {
      const name = str(f.desc, str(f.name, `Function ${num(f.val)}`));
      const key = str(f.name).toLowerCase().replace(/[^a-z]/g, "");
      return { val: num(f.val), name, isLight: LIGHT_TYPES.has(key) || bool(f.isLight) };
    });

    const pumps: AdvancedPump[] = asArr(pumpsOpt.pumps).map((p) => {
      const type = asObj(p.type);
      return {
        id: num(p.id),
        name: str(p.name, `Pump ${num(p.id)}`),
        typeName: str(p.type, "pump"),
        minSpeed: num(type.minSpeed, 450),
        maxSpeed: num(type.maxSpeed, 3450),
        circuits: asArr(p.circuits).map((pc) => {
          const cid = num(asObj(pc.circuit).id ?? pc.circuit);
          const unitsName = str(asObj(pc.units).name ?? pc.units).toLowerCase();
          return {
            circuitId: cid,
            circuitName: str(asObj(pc.circuit).name, circuitName(cid)),
            speed: num(pc.flow !== undefined && unitsName.includes("gpm") ? pc.flow : pc.speed),
            units: unitsName.includes("gpm") ? ("gpm" as const) : ("rpm" as const),
          };
        }),
      };
    });

    const lightGroups: AdvancedLightGroup[] = asArr(lightsOpt.lightGroups ?? lightsOpt.groups).map((g) => ({
      id: num(g.id),
      name: str(g.name, `Group ${num(g.id)}`),
      circuitIds: asArr(g.circuits).map((gc) => num(asObj(gc.circuit).id ?? gc.circuit)),
    }));

    const lightCircuitIds = [...this.snapshot.circuits, ...this.snapshot.features]
      .filter((c) => c.isLight)
      .map((c) => c.id);

    const heaters: AdvancedHeater[] = asArr(heatersOpt.heaters).map((h) => ({
      id: num(h.id),
      name: str(h.name, `Heater ${num(h.id)}`),
      typeName: str(h.type, "heater"),
      bodyDesc: str(asObj(h.body).desc ?? h.body, ""),
      coolingEnabled: typeof h.coolingEnabled === "boolean" ? h.coolingEnabled : null,
    }));

    const valves: AdvancedValve[] = asArr(valvesOpt.valves).map((v) => {
      const cid = numOrNull(asObj(v.circuit).id ?? v.circuit);
      return {
        id: num(v.id),
        name: str(v.name, `Valve ${num(v.id)}`),
        typeName: str(v.type, "valve"),
        circuitId: cid,
        circuitName: cid !== null ? circuitName(cid) : "",
      };
    });

    const clockMode = num(asObj(generalOpt.clockMode).val ?? generalOpt.clockMode, 0);
    // njsPC reports the panel's own clock in /state/all as `time` — an ISO-ish
    // local string on current builds. Pass it through raw; the UI computes
    // drift against serverTime.
    const rawPanelTime = stateAll.time;
    const panelTime =
      typeof rawPanelTime === "string" && rawPanelTime.length > 0
        ? rawPanelTime
        : typeof asObj(rawPanelTime).ISO === "string"
          ? String(asObj(rawPanelTime).ISO)
          : null;
    // RS-485 bus health: njsPC nests counters differently across versions.
    const rs485 = asArr(rs485Opt.ports ?? rs485Opt.comms ?? rs485Opt.commPorts).map((p) => {
      const stats = asObj(p.stats ?? p.counter ?? p);
      return {
        port: str(p.rs485Port ?? p.port ?? p.name, "RS-485"),
        status: str(p.status, bool(p.isOpen ?? p.enabled) ? "open" : "unknown"),
        sent: num(stats.msgSent ?? stats.bytesSent ?? stats.sent),
        received: num(stats.msgReceived ?? stats.bytesReceived ?? stats.received),
        collisions: num(stats.collisions),
        failed: num(stats.msgFailed ?? stats.failed ?? stats.writeFailures),
      };
    });

    const backups = asArr(restoreOpt.backupFiles ?? restoreOpt.files).map((f) => {
      const name = str(f.name ?? f.filePath ?? f, typeof f === "string" ? f : "backup");
      const parsedTime = Date.parse(str(f.timestamp ?? f.date, ""));
      return {
        name,
        at: Number.isFinite(parsedTime) ? parsedTime : null,
        sizeKb: numOrNull(f.size) !== null ? Math.round((numOrNull(f.size) as number) / 1024) : null,
      };
    });

    const chemControllers = asArr(chemOpt.controllers ?? chemOpt.chemControllers).map((c) => ({
      id: num(c.id),
      name: str(c.name, `Chem controller ${num(c.id)}`),
      typeName: str(c.type, "intellichem"),
      bodyDesc: str(asObj(c.body).desc ?? c.body, ""),
      phSetpoint: numOrNull(asObj(c.ph).setpoint ?? c.phSetpoint),
      orpSetpoint: numOrNull(asObj(c.orp).setpoint ?? c.orpSetpoint),
      phTankLevel: numOrNull(asObj(asObj(c.ph).tank).level ?? c.phTankLevel),
      orpTankLevel: numOrNull(asObj(asObj(c.orp).tank).level ?? c.orpTankLevel),
    }));

    const chemDosers = asArr(doserOpt.dosers ?? doserOpt.chemDosers).map((d) => ({
      id: num(d.id),
      name: str(d.name, `Doser ${num(d.id)}`),
      typeName: str(d.type, "doser"),
      bodyDesc: str(asObj(d.body).desc ?? d.body, ""),
    }));

    const covers = asArr(coversOpt.covers).map((c) => ({
      id: num(c.id),
      name: str(c.name, `Cover ${num(c.id)}`),
      bodyDesc: str(asObj(c.body).desc ?? c.body, ""),
      normallyOn: bool(c.normallyOn),
    }));

    const remotes = asArr(remotesOpt.remotes).map((r) => ({
      id: num(r.id),
      name: str(r.name, `Remote ${num(r.id)}`),
      typeName: str(r.type, "remote"),
      buttons: asArr(r.circuits ?? r.buttons).map((b, i) => {
        const cid = numOrNull(asObj(b.circuit).id ?? b.circuit);
        return { slot: num(b.id, i + 1), circuitId: cid, circuitName: cid !== null ? circuitName(cid) : "—" };
      }),
    }));

    const virtualEquipment: AdvancedOptions["virtualEquipment"] = [];
    for (const [kind, list] of [
      ["pump", pumpsOpt.pumps],
      ["chlorinator", asObj(await this.get("/config/options/chlorinators").catch(() => ({}))).chlorinators],
    ] as const) {
      for (const item of asArr(list)) {
        if (str(asObj(item.master).name ?? item.master).toLowerCase().includes("njspc") || bool(item.isVirtual)) {
          virtualEquipment.push({ kind, address: num(item.address, num(item.id)), name: str(item.name, `virtual ${kind}`) });
        }
      }
    }

    return {
      circuits,
      circuitFunctions,
      pumps,
      lightGroups,
      lightCircuitIds,
      heaters,
      valves,
      clock: {
        source: str(generalOpt.clockSource, "manual") || "manual",
        mode: clockMode === 24 ? "24h" : clockMode === 12 ? "12h" : "unknown",
        serverTime: new Date().toISOString(),
        panelTime,
      },
      rs485,
      backups,
      chemControllers,
      chemDosers,
      covers,
      remotes,
      virtualEquipment,
    };
  }

  async runLightCommand(targetId: number, command: string, isGroup: boolean): Promise<void> {
    // Dedicated per-command routes exist for some commands; runCommand covers
    // all of them. Try the group route first for groups, then the light route.
    const attempts = isGroup
      ? [
          ["/state/lightGroup/runCommand", { id: targetId, command }],
          ["/state/light/runCommand", { id: targetId, command }],
        ]
      : [["/state/light/runCommand", { id: targetId, command }]];
    let lastErr: unknown = null;
    for (const [path, payload] of attempts as Array<[string, Json]>) {
      try {
        await this.put(path, payload);
        this.scheduleRefresh();
        return;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new AdapterError("Light command failed", 502);
  }

  async createNjspcBackup(): Promise<void> {
    await this.put("/app/config/createBackup", { name: `moonpool-${new Date().toISOString().slice(0, 10)}` });
  }

  async setRemoteButtons(id: number, buttons: Array<{ slot: number; circuitId: number }>): Promise<void> {
    await this.put("/config/remote", {
      id,
      circuits: buttons.map((b) => ({ id: b.slot, circuit: b.circuitId })),
    });
  }

  async chemFeed(controllerId: number, kind: "ph" | "orp", seconds: number): Promise<void> {
    await this.put("/config/chemController/feed", { id: controllerId, type: kind, time: seconds, quantity: seconds });
  }

  async startPacketCapture(): Promise<void> {
    await this.get("/app/config/startPacketCapture");
  }

  async stopPacketCapture(): Promise<{ filename: string; content: string }> {
    const res = await fetch(`${this.baseUrl}/app/config/stopPacketCapture`);
    if (!res.ok) throw new AdapterError(`stopPacketCapture returned ${res.status}`, 502);
    const content = await res.text();
    return { filename: `njspc-capture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`, content };
  }

  async getDiagnostics(): Promise<unknown> {
    return this.get("/app/diagnostics/snapshot");
  }

  async setCircuitConfig(input: CircuitConfigInput): Promise<void> {
    const payload: Json = { id: input.id };
    if (input.name !== undefined) payload.name = input.name;
    if (input.type !== undefined) payload.type = input.type;
    if (input.eggTimer !== undefined) payload.eggTimer = input.eggTimer;
    if (input.freeze !== undefined) payload.freeze = input.freeze;
    if (input.showInFeatures !== undefined) payload.showInFeatures = input.showInFeatures;
    await this.put("/config/circuit", payload);
    this.scheduleRefresh();
  }

  async setPumpCircuitSpeed(pumpId: number, circuitId: number, speed: number): Promise<void> {
    await this.put("/config/pumpCircuit", { pumpId, circuitId, speed });
    this.scheduleRefresh();
  }

  async setLightGroup(id: number, patch: { name?: string; circuitIds?: number[] }): Promise<void> {
    const payload: Json = { id };
    if (patch.name !== undefined) payload.name = patch.name;
    if (patch.circuitIds !== undefined) {
      payload.circuits = patch.circuitIds.map((cid, i) => ({ id: i + 1, circuit: cid }));
    }
    await this.put("/config/lightGroup", payload);
    this.scheduleRefresh();
  }

  async setValveName(id: number, name: string): Promise<void> {
    await this.put("/config/valve", { id, name });
  }

  async syncPanelClock(): Promise<void> {
    // EasyTouch/IntelliTouch dateTime payload; dow is the panel's day bitmask
    // (Sunday=1 … Saturday=64). The year MUST be two-digit: the protocol field
    // is one byte, and njsPC only normalizes the year when it defaults from
    // panel state — a request-supplied 2026 goes onto the bus raw and the
    // panel rejects the whole message ("Invalid payload detected").
    const d = new Date();
    await this.put("/config/dateTime", {
      hour: d.getHours(),
      min: d.getMinutes(),
      date: d.getDate(),
      month: d.getMonth() + 1,
      year: d.getFullYear() % 100,
      dow: 1 << d.getDay(),
    });
  }

  async cancelDelay(): Promise<void> {
    await this.put("/state/cancelDelay", {});
    this.scheduleRefresh();
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
      if (this.lightThemes.length === 0) await this.loadThemes(state);
      await this.loadHeatModes();
      this.connected = true;
      this.pushSnapshot(this.normalize(state));
    } catch {
      this.connected = false;
      this.pushSnapshot({ ...this.snapshot, connected: false, lastUpdate: Date.now() });
    }
  }

  private themeFromJson(t: Json): LightThemeDef {
    const name = str(t.name, str(t.desc, `Theme ${num(t.val)}`));
    const keyName = name.toLowerCase().replace(/[^a-z]/g, "");
    const type: LightThemeDef["type"] = keyName.startsWith("color")
      ? "command"
      : THEME_SWATCHES[keyName]?.startsWith("linear")
        ? "show"
        : "color";
    return { val: num(t.val), name: str(t.desc, name), type, swatch: THEME_SWATCHES[keyName] ?? "#64748b" };
  }

  /**
   * njsPC has no global theme list — themes are per circuit type. Union the
   * themes of every light circuit via /config/circuit/:id/lightThemes, then
   * fall back to /config/intellibrite/themes for older builds.
   */
  private async loadThemes(state: Json): Promise<void> {
    const lightIds = [...asArr(state.circuits), ...asArr(state.features)]
      .filter((c) => {
        const typeName = str(c.type).toLowerCase().replace(/[^a-z]/g, "");
        return LIGHT_TYPES.has(typeName) || "lightingTheme" in c;
      })
      .map((c) => num(c.id));

    const byVal = new Map<number, LightThemeDef>();
    for (const id of lightIds) {
      try {
        for (const t of asArr(await this.get(`/config/circuit/${id}/lightThemes`))) {
          const def = this.themeFromJson(t);
          if (!byVal.has(def.val)) byVal.set(def.val, def);
        }
      } catch {
        // circuit has no theme list — not a light with themes
      }
    }
    if (byVal.size === 0) {
      try {
        for (const t of asArr(await this.get("/config/intellibrite/themes"))) {
          const def = this.themeFromJson(t);
          if (!byVal.has(def.val)) byVal.set(def.val, def);
        }
      } catch {
        // endpoint not present either — leave empty and retry next refresh
      }
    }
    // Drop non-themes njsPC mixes into the list (off/on aren't colors).
    for (const [val, def] of byVal) {
      const key = def.name.toLowerCase().replace(/[^a-z]/g, "");
      if (key === "off" || key === "on" || key === "unknown") byVal.delete(val);
    }
    if (byVal.size > 0) this.lightThemes = [...byVal.values()];
  }

  /** Body ids whose heat modes were positively discovered (not guessed). */
  private heatModesKnown = new Set<number>();

  private async loadHeatModes(): Promise<void> {
    // Authoritative source: /config/body/:id/heatModes — exactly the modes the
    // panel offers for that body, so a solar-less system never shows solar.
    try {
      const config = asObj(await this.get("/config/all"));
      for (const body of asArr(asObj(config.temps).bodies)) {
        const id = num(body.id);
        if (this.heatModesKnown.has(id)) continue;
        let modes = asArr(await this.get(`/config/body/${id}/heatModes`).catch(() => null));
        if (modes.length === 0) modes = asArr(body.heatModes ?? asObj(config).heatModes);
        for (const m of modes) {
          this.heatModeVals.set(`${id}:${heatModeFromName(str(m.name, str(m.desc)))}`, num(m.val));
        }
        if (modes.length > 0) this.heatModesKnown.add(id);
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
        // When discovery failed entirely, fall back to the SAFE minimum plus
        // solar only if a solar sensor actually reports — never invent solar.
        supportedHeatModes:
          discovered.length >= 2
            ? [...discovered]
            : numOrNull(temps.solar) !== null
              ? ["off", "heater", "solar", "solarpref"]
              : ["off", "heater"],
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
      const anchor = (raw: unknown): "manual" | "sunrise" | "sunset" => {
        const name = str(raw).toLowerCase();
        if (name.includes("sunrise") || num(asObj(raw).val ?? raw, 0) === 1) return "sunrise";
        if (name.includes("sunset") || num(asObj(raw).val ?? raw, 0) === 2) return "sunset";
        return "manual";
      };
      return {
        id: num(s.id),
        circuitId: num(asObj(s.circuit).id ?? s.circuit),
        circuitName: str(asObj(s.circuit).name, `Circuit ${num(asObj(s.circuit).id ?? s.circuit)}`),
        startTime: num(s.startTime),
        endTime: num(s.endTime),
        days,
        scheduleType: typeName.includes("once") ? "runonce" : "repeat",
        isEggTimer: typeName.includes("egg"),
        startTimeType: anchor(s.startTimeType),
        endTimeType: anchor(s.endTimeType),
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
      // Which delays, not just "a delay": panel-level desc + per-circuit flags.
      delays: (() => {
        const out: string[] = [];
        const panelDelay = str(state.delay).toLowerCase();
        if (panelDelay && panelDelay !== "nodelay" && panelDelay !== "no delay") out.push(str(state.delay));
        for (const c of [...asArr(state.circuits), ...asArr(state.features)]) {
          if (bool(c.startDelay)) out.push(`${str(c.name, `circuit ${num(c.id)}`)} start delay`);
          if (bool(c.stopDelay)) out.push(`${str(c.name, `circuit ${num(c.id)}`)} stop delay`);
        }
        return out;
      })(),
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
