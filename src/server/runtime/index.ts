import { getDb, localDay, now } from "@/server/db";
import type { PoolAdapter } from "@/server/adapters/types";
import { MockAdapter } from "@/server/adapters/mock";
import { NjspcAdapter } from "@/server/adapters/njspc";
import type { PoolStateSnapshot } from "@/types/pool";
import type { Role } from "@/types/auth";

/**
 * Server-side bridge. One instance per Node process:
 *  - owns the single connection to njsPC (or the in-process simulator)
 *  - decorates snapshots with owner customizations (renames, icons, guest flags)
 *  - fans state out to authenticated SSE clients, filtered by role
 *  - samples history + equipment runtime/energy into SQLite
 *  - runs the alert engine and the automations worker
 */

const SAMPLE_INTERVAL_MS = 60_000;
const RETENTION_DAYS = 90;

export interface CircuitMeta {
  circuitId: number;
  displayName: string | null;
  icon: string | null;
  guestVisible: boolean;
  hidden: boolean;
}

type SnapshotListener = (snap: PoolStateSnapshot) => void;

export class Runtime {
  readonly adapter: PoolAdapter;
  readonly mock: boolean;
  private listeners = new Set<SnapshotListener>();
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private housekeepTimer: ReturnType<typeof setInterval> | null = null;
  private lastSampleAt = 0;
  private metaCache: Map<number, CircuitMeta> | null = null;
  private bodyMetaCache: Map<number, string> | null = null;
  private started = false;

  constructor() {
    this.mock = process.env.MOCK_MODE === "true";
    this.adapter = this.mock
      ? new MockAdapter()
      : new NjspcAdapter(process.env.NJSPC_URL ?? "http://localhost:4200");
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.adapter.onState((snap) => {
      const decorated = this.decorate(snap);
      for (const cb of this.listeners) cb(decorated);
    });

    await this.adapter.start();

    this.sampleTimer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.housekeepTimer = setInterval(() => this.housekeep(), 3600_000);
    this.sample();

    // Lazy imports break the runtime → worker → control → runtime cycle.
    const [{ startAutomationWorker }, { startAlertEngine }, { startTempest }, { startUpdateScheduler }] =
      await Promise.all([
        import("@/server/automations/worker"),
        import("@/server/alerts/engine"),
        import("@/server/tempest"),
        import("@/server/updates"),
      ]);
    startAutomationWorker(this);
    startAlertEngine(this);
    startTempest();
    startUpdateScheduler();
    console.log(`[moonpool] runtime started (${this.mock ? "MOCK_MODE simulator" : `njsPC @ ${process.env.NJSPC_URL ?? "http://localhost:4200"}`})`);
  }

  stop(): void {
    this.adapter.stop();
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.housekeepTimer) clearInterval(this.housekeepTimer);
  }

  /** Latest snapshot with owner customizations applied. */
  getSnapshot(): PoolStateSnapshot {
    return this.decorate(this.adapter.getSnapshot());
  }

  /** Snapshot filtered for what a role may see. */
  getSnapshotForRole(role: Role): PoolStateSnapshot {
    const snap = this.getSnapshot();
    if (role !== "guest") return snap;
    const meta = this.circuitMeta();
    const visible = (id: number): boolean => meta.get(id)?.guestVisible === true;
    return {
      ...snap,
      circuits: snap.circuits.filter((c) => visible(c.id)),
      features: snap.features.filter((c) => visible(c.id)),
      lightGroups: snap.lightGroups.filter((g) => g.circuitIds.every(visible)),
      pumps: [],
      chlorinators: [],
      schedules: [],
      chem: [],
    };
  }

  onSnapshot(cb: SnapshotListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── customization metadata ───────────────────────────────────────

  circuitMeta(): Map<number, CircuitMeta> {
    if (!this.metaCache) {
      const rows = getDb().prepare("SELECT * FROM circuit_meta").all() as Array<{
        circuit_id: number;
        display_name: string | null;
        icon: string | null;
        guest_visible: number;
        hidden: number;
      }>;
      this.metaCache = new Map(
        rows.map((r) => [
          r.circuit_id,
          {
            circuitId: r.circuit_id,
            displayName: r.display_name,
            icon: r.icon,
            guestVisible: r.guest_visible === 1,
            hidden: r.hidden === 1,
          },
        ])
      );
    }
    return this.metaCache;
  }

  private bodyMeta(): Map<number, string> {
    if (!this.bodyMetaCache) {
      const rows = getDb().prepare("SELECT * FROM body_meta").all() as Array<{ body_id: number; display_name: string | null }>;
      this.bodyMetaCache = new Map(rows.filter((r) => r.display_name).map((r) => [r.body_id, r.display_name as string]));
    }
    return this.bodyMetaCache;
  }

  /** Call after circuit_meta/body_meta writes so renames propagate immediately. */
  invalidateMeta(): void {
    this.metaCache = null;
    this.bodyMetaCache = null;
    const decorated = this.getSnapshot();
    for (const cb of this.listeners) cb(decorated);
  }

  /** value+timestamp per sensor, so "reading changed Xm ago" survives quiet periods */
  private tempSeen = new Map<string, { value: number; at: number }>();

  /** Stamp each temp reading with when its VALUE last changed (staleness signal). */
  private stampTempFreshness(snap: PoolStateSnapshot): PoolStateSnapshot {
    const stamp = (key: string, value: number | null): number | null => {
      if (value === null) return null;
      const prev = this.tempSeen.get(key);
      if (prev && prev.value === value) return prev.at;
      const at = now();
      this.tempSeen.set(key, { value, at });
      return at;
    };
    return {
      ...snap,
      airTempChangedAt: stamp("air", snap.airTemp),
      bodies: snap.bodies.map((b) => ({ ...b, tempChangedAt: stamp(`body:${b.id}`, b.temp) })),
    };
  }

  private decorate(rawSnap: PoolStateSnapshot): PoolStateSnapshot {
    const snap = this.stampTempFreshness(rawSnap);
    const meta = this.circuitMeta();
    const bodyMeta = this.bodyMeta();
    if (meta.size === 0 && bodyMeta.size === 0) return snap;
    const rename = <T extends { id: number; name: string }>(c: T): T => {
      const m = meta.get(c.id);
      return m?.displayName ? { ...c, name: m.displayName } : c;
    };
    return {
      ...snap,
      circuits: snap.circuits.filter((c) => !meta.get(c.id)?.hidden).map(rename),
      features: snap.features.filter((c) => !meta.get(c.id)?.hidden).map(rename),
      bodies: snap.bodies.map((b) => (bodyMeta.has(b.id) ? { ...b, name: bodyMeta.get(b.id) as string } : b)),
      schedules: snap.schedules.map((s) => {
        const m = meta.get(s.circuitId);
        return m?.displayName ? { ...s, circuitName: m.displayName } : s;
      }),
    };
  }

  // ── history sampling ─────────────────────────────────────────────

  private sample(): void {
    const snap = this.adapter.getSnapshot();
    if (!snap.connected) return;
    const at = now();
    const db = getDb();
    const day = localDay(at);
    const elapsedSec = this.lastSampleAt > 0 ? Math.min((at - this.lastSampleAt) / 1000, 300) : 0;
    this.lastSampleAt = at;

    const insert = db.prepare("INSERT OR REPLACE INTO history_samples (at, metric, value) VALUES (?, ?, ?)");
    const bumpRuntime = db.prepare(
      `INSERT INTO equipment_runtime (day, key, seconds, wh) VALUES (?, ?, ?, ?)
       ON CONFLICT(day, key) DO UPDATE SET seconds = seconds + excluded.seconds, wh = wh + excluded.wh`
    );

    const tx = db.transaction(() => {
      if (snap.airTemp !== null) insert.run(at, "temp:air", snap.airTemp);
      for (const b of snap.bodies) {
        // Stale = pump off, panel repeating its last reading — logging it
        // would draw fake flat lines through the temperature history.
        if (b.temp !== null && b.tempStale !== true) insert.run(at, `temp:body:${b.id}`, b.temp);
        insert.run(at, `setpoint:body:${b.id}`, b.setPoint);
        if (elapsedSec > 0 && b.heatStatus !== "off") {
          bumpRuntime.run(day, `heater:body:${b.id}`, Math.round(elapsedSec), 0);
        }
      }
      for (const p of snap.pumps) {
        insert.run(at, `pump:${p.id}:watts`, p.watts);
        insert.run(at, `pump:${p.id}:rpm`, p.rpm);
        if (elapsedSec > 0 && p.isRunning) {
          bumpRuntime.run(day, `pump:${p.id}`, Math.round(elapsedSec), (p.watts * elapsedSec) / 3600);
        }
      }
      for (const c of snap.chlorinators) {
        insert.run(at, `chlor:${c.id}:salt`, c.saltLevel);
        insert.run(at, `chlor:${c.id}:output`, c.currentOutput);
      }
      for (const c of snap.chem) {
        if (c.ph !== null) insert.run(at, `chem:${c.id}:ph`, c.ph);
        if (c.orp !== null) insert.run(at, `chem:${c.id}:orp`, c.orp);
      }
      if (elapsedSec > 0) {
        for (const c of [...snap.circuits, ...snap.features]) {
          if (c.isOn) bumpRuntime.run(day, `circuit:${c.id}`, Math.round(elapsedSec), 0);
        }
      }
    });
    try {
      tx();
    } catch (err) {
      console.error("[moonpool] history sample failed", err);
    }
  }

  private housekeep(): void {
    const db = getDb();
    const cutoff = now() - RETENTION_DAYS * 86400_000;
    try {
      // Roll up days older than yesterday that have no rollup rows yet.
      const pending = db
        .prepare(
          `SELECT DISTINCT date(at / 1000, 'unixepoch', 'localtime') AS day FROM history_samples
           WHERE at < strftime('%s', date('now', 'localtime')) * 1000
             AND date(at / 1000, 'unixepoch', 'localtime') NOT IN (SELECT DISTINCT day FROM history_rollups)`
        )
        .all() as Array<{ day: string }>;
      for (const { day } of pending) {
        db.prepare(
          `INSERT OR REPLACE INTO history_rollups (day, metric, min, max, avg, count)
           SELECT date(at / 1000, 'unixepoch', 'localtime'), metric, MIN(value), MAX(value), AVG(value), COUNT(*)
           FROM history_samples WHERE date(at / 1000, 'unixepoch', 'localtime') = ? GROUP BY metric`
        ).run(day);
      }
      db.prepare("DELETE FROM history_samples WHERE at < ?").run(cutoff);
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now());
    } catch (err) {
      console.error("[moonpool] housekeeping failed", err);
    }
  }
}

const globalForRuntime = globalThis as unknown as { __moonpoolRuntime?: Runtime };

export function getRuntime(): Runtime {
  if (!globalForRuntime.__moonpoolRuntime) {
    globalForRuntime.__moonpoolRuntime = new Runtime();
    void globalForRuntime.__moonpoolRuntime.start();
  }
  return globalForRuntime.__moonpoolRuntime;
}
