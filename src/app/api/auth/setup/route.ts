import { NextResponse, type NextRequest } from "next/server";
import { getDb, now } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { createSession, getUserCount, setSessionCookie } from "@/server/auth/session";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

/** First-run only: creates the Owner account, then signs them in. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (getUserCount() > 0) {
    return NextResponse.json({ error: "Setup is already complete" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { email?: string; name?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const name = body?.name?.trim() ?? "";
  const password = body?.password ?? "";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
  }
  if (name.length < 1) return NextResponse.json({ error: "Enter your name" }, { status: 400 });
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }
  const res = getDb()
    .prepare("INSERT INTO users (email, name, role, password_hash, disabled, created_at) VALUES (?, ?, 'owner', ?, 0, ?)")
    .run(email, name, hashPassword(password), now());
  const userId = Number(res.lastInsertRowid);
  audit({ userId, userName: name, source: "system", action: "setup", target: "owner account", newValue: email });
  const { token, expiresAt } = createSession(userId);
  await setSessionCookie(token, expiresAt);
  return NextResponse.json({ ok: true });
}
