import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb, now } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const rows = getDb()
    .prepare("SELECT id, email, name, role, disabled, created_at FROM users ORDER BY id")
    .all() as Array<{ id: number; email: string; name: string; role: string; disabled: number; created_at: number }>;
  return NextResponse.json({
    users: rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      disabled: r.disabled === 1,
      createdAt: r.created_at,
    })),
  });
}

/** Owner creates accounts directly — fully local, no invite emails needed. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    name?: string;
    password?: string;
    role?: string;
  } | null;
  const email = body?.email?.trim().toLowerCase() ?? "";
  const name = body?.name?.trim() ?? "";
  const password = body?.password ?? "";
  const role = body?.role ?? "family";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  if (!["owner", "family", "guest"].includes(role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  const db = getDb();
  const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (exists) return NextResponse.json({ error: "That email already has an account" }, { status: 409 });
  const res = db
    .prepare("INSERT INTO users (email, name, role, password_hash, disabled, created_at) VALUES (?, ?, ?, ?, 0, ?)")
    .run(email, name, role, hashPassword(password), now());
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "createUser", target: email, newValue: role });
  return NextResponse.json({ ok: true, id: Number(res.lastInsertRowid) });
}
