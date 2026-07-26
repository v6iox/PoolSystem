import webpush from "web-push";
import { getDb, now } from "@/server/db";
import { getSetting, setSetting } from "@/server/settings";

/**
 * Self-hosted web push. VAPID keys are generated once at first boot and kept
 * in SQLite — no external push provider account needed. (Delivery still rides
 * the browser vendors' push services, which is inherent to Web Push.)
 */

export type AlertKind =
  | "equipmentFault"
  | "freezeProtect"
  | "saltLow"
  | "chemistryOutOfRange"
  | "spaAtTemp"
  | "njspcOffline";

export const ALERT_LABELS: Record<AlertKind, string> = {
  equipmentFault: "Equipment fault",
  freezeProtect: "Freeze protection active",
  saltLow: "Salt low",
  chemistryOutOfRange: "Chemistry out of range",
  spaAtTemp: "Spa reached temperature",
  njspcOffline: "Pool controller offline",
};

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let configured = false;

export function getVapidKeys(): VapidKeys {
  let keys = getSetting<VapidKeys | null>("vapid", null);
  if (!keys) {
    const generated = webpush.generateVAPIDKeys();
    keys = { publicKey: generated.publicKey, privateKey: generated.privateKey };
    setSetting("vapid", keys);
  }
  if (!configured) {
    webpush.setVapidDetails("mailto:owner@moonpool.local", keys.publicKey, keys.privateKey);
    configured = true;
  }
  return keys;
}

interface SubRow {
  id: number;
  user_id: number;
  endpoint: string;
  keys: string;
}

function userWantsAlert(userId: number, kind: AlertKind): boolean {
  const row = getDb().prepare("SELECT prefs FROM user_prefs WHERE user_id = ?").get(userId) as
    | { prefs: string }
    | undefined;
  if (!row) return true; // default: all alerts on
  try {
    const prefs = JSON.parse(row.prefs) as { notifications?: Partial<Record<AlertKind, boolean>> };
    return prefs.notifications?.[kind] !== false;
  } catch {
    return true;
  }
}

export async function sendAlert(kind: AlertKind, title: string, body: string): Promise<void> {
  getVapidKeys();
  const db = getDb();
  const subs = db.prepare("SELECT * FROM push_subscriptions").all() as SubRow[];
  await Promise.all(
    subs.map(async (sub) => {
      if (!userWantsAlert(sub.user_id, kind)) return;
      try {
        const parsedKeys = JSON.parse(sub.keys) as { p256dh: string; auth: string };
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: parsedKeys },
          JSON.stringify({ kind, title, body, at: now() })
        );
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(sub.id);
        }
      }
    })
  );
}
