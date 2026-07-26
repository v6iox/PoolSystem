import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { audit } from "@/server/audit";
import { validateActionsShape, validateTriggerShape } from "@/server/validate";
import { reloadAutomations } from "@/server/automations/worker";
import type { AutomationTrigger, PoolAction } from "@/types/actions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const db = getDb();
  const existing = db.prepare("SELECT id, name FROM automations WHERE id = ?").get(id) as
    | { id: number; name: string }
    | undefined;
  if (!existing) return NextResponse.json({ error: "Automation not found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    name?: string;
    trigger?: AutomationTrigger;
    actions?: PoolAction[];
    enabled?: boolean;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const updates: string[] = [];
  const values: Array<string | number> = [];
  if (typeof body.name === "string" && body.name.trim()) {
    updates.push("name = ?");
    values.push(body.name.trim());
  }
  if (body.trigger !== undefined) {
    const err = validateTriggerShape(body.trigger);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    updates.push("trigger = ?");
    values.push(JSON.stringify(body.trigger));
  }
  if (body.actions !== undefined) {
    const err = validateActionsShape(body.actions);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
    updates.push("actions = ?");
    values.push(JSON.stringify(body.actions));
  }
  if (typeof body.enabled === "boolean") {
    updates.push("enabled = ?");
    values.push(body.enabled ? 1 : 0);
  }
  if (updates.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  db.prepare(`UPDATE automations SET ${updates.join(", ")} WHERE id = ?`).run(...values, id);
  reloadAutomations();
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: typeof body.enabled === "boolean" && updates.length === 1 ? (body.enabled ? "resumeAutomation" : "pauseAutomation") : "updateAutomation",
    target: existing.name,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  const existing = getDb().prepare("SELECT name FROM automations WHERE id = ?").get(id) as { name: string } | undefined;
  if (!existing) return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  getDb().prepare("DELETE FROM automations WHERE id = ?").run(id);
  reloadAutomations();
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "deleteAutomation", target: existing.name });
  return NextResponse.json({ ok: true });
}
