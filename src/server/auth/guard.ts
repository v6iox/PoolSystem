import { NextResponse } from "next/server";
import { getSessionUser, refreshSessionCookie } from "@/server/auth/session";
import { roleAtLeast, type Role, type SessionUser } from "@/types/auth";

/**
 * Route-handler guard. Every API route that touches pool state or stored data
 * goes through this — the browser never talks to njsPC directly.
 */
export async function requireUser(minRole: Role = "guest"): Promise<
  { ok: true; user: SessionUser } | { ok: false; response: NextResponse }
> {
  const user = await getSessionUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  if (!roleAtLeast(user.role, minRole)) {
    return { ok: false, response: NextResponse.json({ error: "Insufficient permissions" }, { status: 403 }) };
  }
  // Keep the cookie's expiry in step with the sliding DB session, so a device
  // that uses the app stays signed in indefinitely.
  await refreshSessionCookie();
  return { ok: true, user };
}

/** Simple fixed-window rate limiter for internet-facing endpoints (login). */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const nowMs = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < nowMs) {
    buckets.set(key, { count: 1, resetAt: nowMs + windowMs });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= max;
}
