import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { audit } from "@/server/audit";
import { validateActionsShape } from "@/server/validate";
import type { PoolAction, SceneDef } from "@/types/actions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const db = getDb();
  const existing = db.prepare("SELECT id, name FROM scenes WHERE id = ?").get(id) as { id: number; name: string } | undefined;
  if (!existing) return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as Partial<SceneDef> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  if (body.actions !== undefined) {
    const err = validateActionsShape(body.actions);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  const updates: string[] = [];
  const values: Array<string | number> = [];
  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (typeof body.icon === "string") {
    updates.push("icon = ?");
    values.push(body.icon);
  }
  if (typeof body.description === "string") {
    updates.push("description = ?");
    values.push(body.description);
  }
  if (body.actions !== undefined) {
    updates.push("actions = ?");
    values.push(JSON.stringify(body.actions as PoolAction[]));
  }
  if (typeof body.guestVisible === "boolean") {
    updates.push("guest_visible = ?");
    values.push(body.guestVisible ? 1 : 0);
  }
  if (typeof body.position === "number") {
    updates.push("position = ?");
    values.push(body.position);
  }
  if (updates.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  db.prepare(`UPDATE scenes SET ${updates.join(", ")} WHERE id = ?`).run(...values, id);
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "updateScene", target: existing.name });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const existing = getDb().prepare("SELECT name FROM scenes WHERE id = ?").get(id) as { name: string } | undefined;
  if (!existing) return NextResponse.json({ error: "Scene not found" }, { status: 404 });
  getDb().prepare("DELETE FROM scenes WHERE id = ?").run(id);
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "deleteScene", target: existing.name });
  return NextResponse.json({ ok: true });
}
