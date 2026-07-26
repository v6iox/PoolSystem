"use client";

import { apiGet, apiSend } from "@/lib/client/api";
import { toast } from "@/stores/toast";

/**
 * Web-push subscription helpers. Self-hosted VAPID keys come from the app
 * server; delivery rides the browser vendor push service (inherent to the
 * Web Push standard). Everything degrades gracefully: in dev the service
 * worker may not be registered, and iOS only exposes push once the app is
 * installed to the home screen — both paths surface a friendly info toast
 * instead of an error.
 */

export type PushStatus = "unsupported" | "subscribed" | "unsubscribed";

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const output = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

async function getRegistration(): Promise<ServiceWorkerRegistration | null> {
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** Current subscription on this device, or null. */
export async function getPushSubscription(): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null;
  const registration = await getRegistration();
  if (!registration) return null;
  try {
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

/** What the notifications UI should show for this device right now. */
export async function getPushStatus(): Promise<PushStatus> {
  if (!isPushSupported()) return "unsupported";
  const sub = await getPushSubscription();
  return sub ? "subscribed" : "unsubscribed";
}

/**
 * Full subscribe flow: permission → service worker → VAPID key → subscribe →
 * register with the server. Returns true when the device ends up subscribed.
 * All failure modes toast for themselves (info for environmental limits,
 * error for real failures) — callers only need to toast on success.
 */
export async function subscribeToPush(): Promise<boolean> {
  if (!isPushSupported()) {
    toast(
      "info",
      "Push not supported here",
      "This browser doesn't expose web push. On iPhone/iPad, add Moonpool to your home screen first."
    );
    return false;
  }

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    permission = Notification.permission;
  }
  if (permission !== "granted") {
    toast(
      "info",
      "Notifications blocked",
      "Allow notifications for Moonpool in your browser's site settings, then try again."
    );
    return false;
  }

  // The worker registers itself in production; in dev it may not exist yet.
  let registration = await getRegistration();
  if (!registration) {
    try {
      registration = await navigator.serviceWorker.register("/sw.js");
    } catch {
      toast(
        "info",
        "Service worker unavailable",
        "Couldn't register the background worker (common in dev). Push alerts need the production app."
      );
      return false;
    }
  }

  try {
    const { publicKey } = await apiGet<{ publicKey: string }>("/api/push/key");
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    const json = subscription.toJSON();
    const p256dh = json.keys?.p256dh;
    const authKey = json.keys?.auth;
    if (!json.endpoint || !p256dh || !authKey) {
      toast("error", "Couldn't enable alerts", "The browser returned an incomplete push subscription.");
      return false;
    }
    await apiSend<{ ok: boolean }>("POST", "/api/push/subscribe", {
      endpoint: json.endpoint,
      keys: { p256dh, auth: authKey },
    });
    return true;
  } catch (err) {
    toast("error", "Couldn't enable alerts", err instanceof Error ? err.message : "Push subscription failed.");
    return false;
  }
}

/**
 * Remove this device's subscription (server row first, then the browser's).
 * Returns true when the device ends up unsubscribed.
 */
export async function unsubscribeFromPush(): Promise<boolean> {
  const subscription = await getPushSubscription();
  if (!subscription) return true;
  try {
    await apiSend<{ ok: boolean }>("DELETE", "/api/push/subscribe", { endpoint: subscription.endpoint });
  } catch {
    // Server row may already be gone (e.g. pruned after a failed delivery) —
    // still release the browser-side subscription below.
  }
  try {
    await subscription.unsubscribe();
    return true;
  } catch (err) {
    toast("error", "Couldn't disable alerts", err instanceof Error ? err.message : "Unsubscribe failed.");
    return false;
  }
}
