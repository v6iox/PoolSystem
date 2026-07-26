import { NextResponse, type NextRequest } from "next/server";
import { verifyPassword } from "@/server/auth/password";
import { createSession, findUserByEmail, setSessionCookie } from "@/server/auth/session";
import { rateLimit } from "@/server/auth/guard";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`login:${ip}`, 10, 15 * 60_000)) {
    return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
  }
  const body = (await request.json().catch(() => null)) as { email?: string; password?: string } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const password = body?.password ?? "";
  const user = findUserByEmail(email);
  if (!user || user.disabled || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }
  const { token, expiresAt } = createSession(user.id);
  await setSessionCookie(token, expiresAt);
  audit({ userId: user.id, userName: user.name, source: "system", action: "login", target: "session" });
  return NextResponse.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
}
