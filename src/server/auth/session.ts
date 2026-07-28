import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { getDb, now } from "@/server/db";
import type { Role, SessionUser } from "@/types/auth";

const SESSION_COOKIE = "mp_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days, sliding

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string;
  disabled: number;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSession(userId: number): { token: string; expiresAt: number } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = now() + SESSION_TTL_MS;
  getDb()
    .prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .run(hashToken(token), userId, expiresAt, now());
  return { token, expiresAt };
}

export function destroySession(token: string): void {
  getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
}

export function getUserByToken(token: string): SessionUser | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role, u.disabled, s.expires_at, s.id AS session_id
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(hashToken(token)) as
    | { id: number; email: string; name: string; role: Role; disabled: number; expires_at: number; session_id: number }
    | undefined;
  if (!row) return null;
  if (row.disabled) return null;
  if (row.expires_at < now()) {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(row.session_id);
    return null;
  }
  // Sliding expiry: refresh when past half-life.
  if (row.expires_at - now() < SESSION_TTL_MS / 2) {
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(now() + SESSION_TTL_MS, row.session_id);
  }
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return getUserByToken(token);
}

/**
 * Whether to mark the session cookie `Secure`.
 *
 * This must follow the REQUEST, not NODE_ENV. The production image always sets
 * NODE_ENV=production, but the normal way to run Moonpool is plain HTTP on the
 * LAN (http://moonpool.local:3000) — and a browser silently discards a
 * `Secure` cookie on a non-HTTPS origin. The login POST then succeeds, the
 * session row is written, the cookie evaporates, and the app bounces straight
 * back to the login screen with no error to show for it.
 *
 * So: Secure only when the request actually arrived over TLS. Behind the
 * Cloudflare tunnel that's x-forwarded-proto; direct TLS sets neither header
 * and can be forced with SESSION_COOKIE_SECURE=true.
 */
export function decideCookieSecure(
  headerLookup: (name: string) => string | null,
  override: string | undefined = process.env.SESSION_COOKIE_SECURE
): boolean {
  if (override === "true") return true;
  if (override === "false") return false;
  const proto = headerLookup("x-forwarded-proto") ?? headerLookup("x-forwarded-protocol");
  // May be a comma-separated chain — the client-facing hop is first.
  if (proto) return proto.split(",")[0]?.trim().toLowerCase() === "https";
  return (headerLookup("origin") ?? headerLookup("referer") ?? "").startsWith("https://");
}

async function cookieIsSecure(): Promise<boolean> {
  try {
    const h = await headers();
    return decideCookieSecure((name) => h.get(name));
  } catch {
    return false;
  }
}

export async function setSessionCookie(token: string, expiresAt: number): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await cookieIsSecure(),
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  store.delete(SESSION_COOKIE);
}

export function getUserCount(): number {
  const row = getDb().prepare("SELECT COUNT(*) AS c FROM users").get() as { c: number };
  return row.c;
}

export function findUserByEmail(email: string): (SessionUser & { passwordHash: string; disabled: boolean }) | null {
  const row = getDb().prepare("SELECT * FROM users WHERE email = ?").get(email.trim()) as UserRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    passwordHash: row.password_hash,
    disabled: row.disabled === 1,
  };
}

export { SESSION_COOKIE };
