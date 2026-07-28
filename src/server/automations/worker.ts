import cron, { type ScheduledTask } from "node-cron";
import SunCalc from "suncalc";
import { getDb, now } from "@/server/db";
import { sendAlert } from "@/server/push";
import { getAppSettings } from "@/server/settings";
import { executeActions, automationCtx } from "@/server/control";
import type { Runtime } from "@/server/runtime";
import type { AutomationDef, AutomationTrigger, PoolAction, PoolEventKind } from "@/types/actions";
import type { PoolStateSnapshot } from "@/types/pool";

/**
 * The automations engine. Schedules, scenes and the copilot all sit on this:
 *  - cron / time-of-day triggers via node-cron
 *  - sunrise/sunset offsets computed daily with suncalc (no network needed)
 *  - temp/salt/freeze/event triggers evaluated edge-wise on every snapshot
 *  - one-shot scheduled_jobs polled every 15s
 * Actions execute through the same validated control layer as the UI.
 */

interface WorkerState {
  runtime: Runtime;
  cronTasks: Map<number, ScheduledTask>;
  sunTimers: Map<number, ReturnType<typeof setTimeout>>;
  conditionMet: Map<number, boolean>;
  prevSnapshot: PoolStateSnapshot | null;
  jobTimer: ReturnType<typeof setInterval> | null;
  dailyTimer: ReturnType<typeof setInterval> | null;
}

const globalForWorker = globalThis as unknown as { __moonpoolWorker?: WorkerState };

function rows(): AutomationDef[] {
  const raw = getDb().prepare("SELECT a.*, u.name AS creator_name FROM automations a LEFT JOIN users u ON u.id = a.created_by").all() as Array<{
    id: number;
    name: string;
    trigger: string;
    actions: string;
    enabled: number;
    created_by: number | null;
    created_via: "ui" | "copilot";
    last_run_at: number | null;
    last_result: string | null;
    creator_name: string | null;
  }>;
  return raw.map((r) => ({
    id: r.id,
    name: r.name,
    trigger: JSON.parse(r.trigger) as AutomationTrigger,
    actions: JSON.parse(r.actions) as PoolAction[],
    enabled: r.enabled === 1,
    createdBy: r.created_by,
    createdByName: r.creator_name ?? "system",
    createdVia: r.created_via,
    lastRunAt: r.last_run_at,
    lastResult: r.last_result,
  }));
}

async function run(automation: AutomationDef): Promise<void> {
  const results = await executeActions(automation.actions, automationCtx(automation.name));
  const failed = results.filter((r) => !r.ok);
  const summary =
    failed.length === 0
      ? results.map((r) => r.summary).join("; ")
      : `${failed.length}/${results.length} failed: ${failed.map((r) => r.error).join("; ")}`;
  getDb()
    .prepare("UPDATE automations SET last_run_at = ?, last_result = ? WHERE id = ?")
    .run(now(), summary.slice(0, 500), automation.id);
}

function timeTriggerToCron(at: string, days: number[]): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(at);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const dow = days.length === 0 || days.length === 7 ? "*" : days.join(",");
  return `${minute} ${hour} * * ${dow}`;
}

function scheduleSunTrigger(state: WorkerState, automation: AutomationDef): void {
  const trigger = automation.trigger;
  if (trigger.type !== "sun") return;
  const settings = getAppSettings();
  const schedule = (): void => {
    const times = SunCalc.getTimes(new Date(), settings.latitude, settings.longitude);
    const base = trigger.event === "sunrise" ? times.sunrise : times.sunset;
    const fireAt = base.getTime() + trigger.offsetMinutes * 60_000;
    const delay = fireAt - Date.now();
    if (delay <= 0 || delay > 36 * 3600_000) return; // today's time already passed; daily re-arm catches tomorrow
    const dow = new Date(fireAt).getDay();
    if (trigger.days.length > 0 && !trigger.days.includes(dow)) return;
    const timer = setTimeout(() => {
      void run(automation);
    }, delay);
    state.sunTimers.set(automation.id, timer);
  };
  schedule();
}

/** (Re)load all trigger schedules from the DB. Called at boot and after any CRUD. */
export function reloadAutomations(): void {
  const state = globalForWorker.__moonpoolWorker;
  if (!state) return;
  for (const task of state.cronTasks.values()) task.stop();
  state.cronTasks.clear();
  for (const timer of state.sunTimers.values()) clearTimeout(timer);
  state.sunTimers.clear();
  // conditionMet is intentionally preserved: clearing it would re-fire
  // edge-triggered automations whose condition is still met.

  for (const automation of rows()) {
    if (!automation.enabled) continue;
    const trigger = automation.trigger;
    if (trigger.type === "cron") {
      if (cron.validate(trigger.expression)) {
        state.cronTasks.set(
          automation.id,
          cron.schedule(trigger.expression, () => void run(automation))
        );
      }
    } else if (trigger.type === "time") {
      const expression = timeTriggerToCron(trigger.at, trigger.days);
      if (expression && cron.validate(expression)) {
        state.cronTasks.set(
          automation.id,
          cron.schedule(expression, () => void run(automation))
        );
      }
    } else if (trigger.type === "sun") {
      scheduleSunTrigger(state, automation);
    }
    // snapshot-driven triggers are evaluated in onSnapshot below
  }
}

function detectEvents(prev: PoolStateSnapshot | null, next: PoolStateSnapshot): Set<PoolEventKind> {
  const events = new Set<PoolEventKind>();
  if (!prev) return events;
  if (prev.connected && !next.connected) events.add("njspcOffline");
  if (!prev.connected && next.connected) events.add("njspcOnline");
  if (!prev.delay && next.delay) events.add("delayStart");
  if (prev.delay && !next.delay) events.add("delayEnd");
  if (prev.panelMode !== "service" && next.panelMode === "service") events.add("equipmentFault");
  for (const body of next.bodies) {
    const before = prev.bodies.find((b) => b.id === body.id);
    if (
      before &&
      before.heatStatus !== "off" &&
      body.heatStatus === "off" &&
      body.isOn &&
      body.temp !== null &&
      body.temp >= body.setPoint - 0.5
    ) {
      events.add("bodyAtSetpoint");
    }
  }
  return events;
}

function evaluateSnapshotTriggers(state: WorkerState, snap: PoolStateSnapshot): void {
  const events = detectEvents(state.prevSnapshot, snap);
  state.prevSnapshot = snap;

  for (const automation of rows()) {
    if (!automation.enabled) continue;
    const trigger = automation.trigger;
    let met: boolean | null = null;

    if (trigger.type === "tempThreshold") {
      const value =
        trigger.sensor === "air"
          ? snap.airTemp
          : (snap.bodies.find((b) => `body:${b.id}` === trigger.sensor)?.temp ?? null);
      if (value !== null) met = trigger.direction === "above" ? value > trigger.value : value < trigger.value;
    } else if (trigger.type === "saltLow") {
      const chlor = snap.chlorinators.find((c) => c.id === trigger.chlorId);
      if (chlor) met = chlor.saltLevel > 0 && chlor.saltLevel < trigger.belowPpm;
    } else if (trigger.type === "freezeProtect") {
      met = snap.freezeProtect;
    } else if (trigger.type === "event") {
      if (events.has(trigger.event)) void run(automation);
      continue;
    } else {
      continue;
    }

    if (met === null) continue;
    const was = state.conditionMet.get(automation.id) ?? false;
    state.conditionMet.set(automation.id, met);
    if (met && !was) void run(automation); // edge-triggered
  }
}

/**
 * How late a one-shot may run and still be worth running. Without a floor, a
 * Pi that was off overnight comes back and fires last night's "heat the spa"
 * at breakfast. Override with SCHEDULE_GRACE_MINUTES.
 */
const GRACE_MS = (Number(process.env.SCHEDULE_GRACE_MINUTES ?? "") || 30) * 60_000;

/**
 * Whether a due job is still worth running, or so late that firing it would
 * surprise the user more than skipping it would.
 */
export function isTooLate(fireAt: number, at: number, graceMs: number = GRACE_MS): boolean {
  return at - fireAt > graceMs;
}

/**
 * Jobs are claimed by stamping executed_at, which doubles as the crash marker:
 * a row still 'pending' with executed_at set means the process died mid-run.
 * (executed_at rather than a new status only because the existing CHECK
 * constraint on status can't be widened without rebuilding the table on
 * someone's live Pi.)
 */
export function sweepInterruptedJobs(): void {
  const db = getDb();
  const stuck = db
    .prepare("UPDATE scheduled_jobs SET status = 'error', result = ? WHERE status = 'pending' AND executed_at IS NOT NULL")
    .run("interrupted by a restart — not run");
  if (stuck.changes > 0) {
    console.warn(`[moonpool] ${stuck.changes} scheduled job(s) were interrupted by a restart`);
  }
}

async function pollScheduledJobs(): Promise<void> {
  const db = getDb();
  const at = now();
  const due = db
    .prepare("SELECT * FROM scheduled_jobs WHERE status = 'pending' AND executed_at IS NULL AND fire_at <= ? ORDER BY fire_at")
    .all(at) as Array<{ id: number; label: string; actions: string; source: string; fire_at: number }>;

  for (const job of due) {
    // Claim it. The WHERE guard makes this atomic against a second poll tick
    // (or a second Node process on the same file) picking up the same row.
    const claimed = db
      .prepare("UPDATE scheduled_jobs SET executed_at = ? WHERE id = ? AND status = 'pending' AND executed_at IS NULL")
      .run(at, job.id);
    if (claimed.changes === 0) continue;

    const lateBy = at - job.fire_at;
    if (isTooLate(job.fire_at, at)) {
      const mins = Math.round(lateBy / 60_000);
      db.prepare("UPDATE scheduled_jobs SET status = 'error', result = ? WHERE id = ?").run(
        `missed — was due ${mins} min ago, past the ${Math.round(GRACE_MS / 60_000)} min grace window`,
        job.id
      );
      console.warn(`[moonpool] skipped stale scheduled job ${job.id} (${mins} min late): ${job.label}`);
      void sendAlert(
        "scheduleMissed",
        "Scheduled action missed",
        `“${job.label || "one-shot job"}” was due ${mins} minutes ago and was skipped — Moonpool was not running at the time.`
      ).catch(() => undefined);
      continue;
    }

    try {
      const actions = JSON.parse(job.actions) as PoolAction[];
      const results = await executeActions(actions, {
        userId: null,
        userName: job.label ? `scheduled: ${job.label}` : "scheduled job",
        role: "owner",
        source: "schedule",
      });
      const failed = results.filter((r) => !r.ok);
      db.prepare("UPDATE scheduled_jobs SET status = ?, result = ? WHERE id = ?").run(
        failed.length > 0 ? "error" : "done",
        results.map((r) => (r.ok ? r.summary : `FAILED: ${r.error}`)).join("; ").slice(0, 500),
        job.id
      );
      if (failed.length > 0) {
        void sendAlert(
          "scheduleMissed",
          "Scheduled action failed",
          `“${job.label || "one-shot job"}”: ${failed.map((f) => f.error).join("; ")}`
        ).catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "unknown error";
      db.prepare("UPDATE scheduled_jobs SET status = 'error', result = ? WHERE id = ?").run(message, job.id);
      void sendAlert("scheduleMissed", "Scheduled action failed", `“${job.label || "one-shot job"}”: ${message}`).catch(
        () => undefined
      );
    }
  }
}

export function startAutomationWorker(runtime: Runtime): void {
  if (globalForWorker.__moonpoolWorker) return;
  const state: WorkerState = {
    runtime,
    cronTasks: new Map(),
    sunTimers: new Map(),
    conditionMet: new Map(),
    prevSnapshot: null,
    jobTimer: null,
    dailyTimer: null,
  };
  globalForWorker.__moonpoolWorker = state;

  sweepInterruptedJobs();
  reloadAutomations();
  runtime.onSnapshot((snap) => {
    try {
      evaluateSnapshotTriggers(state, snap);
    } catch (err) {
      console.error("[moonpool] automation trigger evaluation failed", err);
    }
  });
  state.jobTimer = setInterval(() => void pollScheduledJobs(), 15_000);
  // Re-arm sun triggers shortly after midnight (and safety-net once an hour).
  state.dailyTimer = setInterval(() => {
    const d = new Date();
    if (d.getMinutes() < 2) reloadAutomations();
  }, 3600_000 / 30);
  void pollScheduledJobs();
}
