import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { hashPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const db = getDb();
  const target = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(id) as
    | { id: number; email: string; role: string }
    | undefined;
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    role?: string;
    disabled?: boolean;
    password?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  // Never let the last active owner lock everyone out.
  const demotingOwner = target.role === "owner" && ((body.role !== undefined && body.role !== "owner") || body.disabled === true);
  if (demotingOwner) {
    const owners = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND disabled = 0").get() as { c: number }).c;
    if (owners <= 1) return NextResponse.json({ error: "There must always be at least one active owner" }, { status: 409 });
  }

  const updates: string[] = [];
  const values: Array<string | number> = [];
  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (typeof body.role === "string") {
    if (!["owner", "family", "guest"].includes(body.role)) return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    updates.push("role = ?");
    values.push(body.role);
  }
  if (typeof body.disabled === "boolean") {
    updates.push("disabled = ?");
    values.push(body.disabled ? 1 : 0);
  }
  if (typeof body.password === "string") {
    if (body.password.length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    updates.push("password_hash = ?");
    values.push(hashPassword(body.password));
  }
  if (updates.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...values, id);
  if (body.disabled === true) {
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  }
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: "updateUser",
    target: target.email,
    newValue: JSON.stringify({ role: body.role, disabled: body.disabled, passwordChanged: body.password !== undefined }),
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (id === auth.user.id) return NextResponse.json({ error: "You can't delete your own account" }, { status: 409 });
  const db = getDb();
  const target = db.prepare("SELECT email, role FROM users WHERE id = ?").get(id) as
    | { email: string; role: string }
    | undefined;
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.role === "owner") {
    const owners = (db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'owner' AND disabled = 0").get() as { c: number }).c;
    if (owners <= 1) return NextResponse.json({ error: "There must always be at least one active owner" }, { status: 409 });
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "deleteUser", target: target.email });
  return NextResponse.json({ ok: true });
}
