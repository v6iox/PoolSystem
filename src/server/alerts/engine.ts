import { getDb, now } from "@/server/db";
import { getAppSettings } from "@/server/settings";
import { sendAlert, type AlertKind } from "@/server/push";
import { assessHeaters } from "@/server/alerts/heater-watchdog";
import { estimateWaterLevel } from "@/server/water";
import type { Runtime } from "@/server/runtime";
import type { PoolStateSnapshot } from "@/types/pool";

/**
 * Edge-triggered alerting. Conditions are evaluated on every snapshot; a push
 * goes out only on the transition into the condition (tracked in alert_state
 * so restarts don't re-notify), with a cooldown per alert key.
 */

const COOLDOWN_MS = 30 * 60_000;
const OFFLINE_GRACE_MS = 60_000;

let offlineSince: number | null = null;

function edge(key: string, active: boolean): boolean {
  const db = getDb();
  const row = db.prepare("SELECT active, last_notified FROM alert_state WHERE key = ?").get(key) as
    | { active: number; last_notified: number | null }
    | undefined;
  const wasActive = row?.active === 1;
  if (active !== wasActive) {
    db.prepare(
      `INSERT INTO alert_state (key, active, since, last_notified) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET active = excluded.active, since = excluded.since,
         last_notified = CASE WHEN excluded.active = 1 THEN excluded.last_notified ELSE alert_state.last_notified END`
    ).run(key, active ? 1 : 0, now(), active ? now() : (row?.last_notified ?? null));
  }
  if (!active || wasActive) return false;
  const lastNotified = row?.last_notified ?? 0;
  return now() - lastNotified > COOLDOWN_MS;
}

function fire(kind: AlertKind, key: string, active: boolean, title: string, body: string): void {
  if (edge(key, active)) {
    void sendAlert(kind, title, body);
  }
}

function evaluate(snap: PoolStateSnapshot): void {
  const settings = getAppSettings();
  const deg = `°${snap.units}`;

  // njsPC offline (with grace so a socket blip doesn't page anyone).
  if (!snap.connected) {
    offlineSince = offlineSince ?? now();
  } else {
    offlineSince = null;
  }
  fire(
    "njspcOffline",
    "njspc:offline",
    offlineSince !== null && now() - offlineSince > OFFLINE_GRACE_MS,
    "Pool controller offline",
    "Moonpool lost its connection to nodejs-poolController. Controls are disabled until it reconnects."
  );

  if (!snap.connected) return;

  fire(
    "freezeProtect",
    "freeze",
    snap.freezeProtect,
    "Freeze protection active",
    `Air temperature is ${snap.airTemp ?? "?"}${deg}. Freeze protection is circulating water.`
  );

  for (const c of snap.chlorinators) {
    fire(
      "saltLow",
      `salt:${c.id}`,
      c.saltLevel > 0 && c.saltLevel < settings.saltLowPpm,
      "Salt is low",
      `${c.name} reports ${c.saltLevel} ppm (low threshold ${settings.saltLowPpm} ppm). Add salt soon.`
    );
    fire(
      "equipmentFault",
      `chlorfault:${c.id}`,
      /fault|error|fail/i.test(c.status),
      "Chlorinator fault",
      `${c.name} status: ${c.status}`
    );
  }

  for (const b of snap.bodies) {
    if (b.kind === "spa") {
      fire(
        "spaAtTemp",
        `attemp:${b.id}`,
        b.isOn && b.temp !== null && b.heatMode !== "off" && b.temp >= b.setPoint,
        `${b.name} is ready`,
        `${b.name} reached ${b.setPoint}${deg}. Enjoy!`
      );
    }
  }

  // Heater watchdog: "heating" but the water isn't warming, or the heater
  // dropped out well short of the setpoint with heat mode still on.
  for (const cond of assessHeaters(snap)) {
    fire("heaterStall", cond.key, cond.active, cond.title, cond.body);
  }

  for (const chem of snap.chem) {
    const [phLo, phHi] = settings.idealRanges.ph;
    fire(
      "chemistryOutOfRange",
      `chem:ph:${chem.id}`,
      chem.ph !== null && (chem.ph < phLo - 0.2 || chem.ph > phHi + 0.2),
      "pH out of range",
      `${chem.name} reports pH ${chem.ph}.`
    );
    fire(
      "equipmentFault",
      `chem:alarm:${chem.id}`,
      chem.alarms.length > 0,
      "IntelliChem alarm",
      `${chem.name}: ${chem.alarms.join(", ")}`
    );
  }

  fire(
    "equipmentFault",
    "panel:service",
    snap.panelMode === "service",
    "Panel in service mode",
    "The pool panel is in service mode — schedules and remote control are suspended."
  );
}

/** Water balance is weather-driven, not snapshot-driven — check every 6h. */
let lastWaterCheck = 0;

async function checkWaterLevel(): Promise<void> {
  const estimate = await estimateWaterLevel();
  if (!estimate.available) return;
  fire("waterLow", "water:low", estimate.low, "Pool water is likely low", estimate.message);
}

export function startAlertEngine(runtime: Runtime): void {
  runtime.onSnapshot((snap) => {
    try {
      evaluate(snap);
    } catch (err) {
      console.error("[moonpool] alert engine error", err);
    }
    if (now() - lastWaterCheck > 6 * 3600_000) {
      lastWaterCheck = now();
      void checkWaterLevel().catch(() => undefined);
    }
  });
}
