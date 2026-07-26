import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb, now } from "@/server/db";
import { audit } from "@/server/audit";
import { validateActionsShape, validateTriggerShape } from "@/server/validate";
import { reloadAutomations } from "@/server/automations/worker";
import { rowToDef, type AutomationRow } from "@/server/automations/store";
import type { AutomationTrigger, PoolAction } from "@/types/actions";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const rows = getDb()
    .prepare("SELECT a.*, u.name AS creator_name FROM automations a LEFT JOIN users u ON u.id = a.created_by ORDER BY a.id DESC")
    .all() as AutomationRow[];
  const jobs = getDb()
    .prepare("SELECT * FROM scheduled_jobs WHERE status = 'pending' ORDER BY fire_at")
    .all() as Array<{ id: number; label: string; actions: string; fire_at: number; source: string }>;
  return NextResponse.json({
    automations: rows.map(rowToDef),
    pendingJobs: jobs.map((j) => ({
      id: j.id,
      label: j.label,
      actions: JSON.parse(j.actions) as PoolAction[],
      fireAt: j.fire_at,
      source: j.source,
    })),
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    name?: string;
    trigger?: AutomationTrigger;
    actions?: PoolAction[];
    enabled?: boolean;
    via?: "ui" | "copilot";
  } | null;
  if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "Name required" }, { status: 400 });
  }
  const triggerErr = validateTriggerShape(body.trigger);
  if (triggerErr) return NextResponse.json({ error: triggerErr }, { status: 400 });
  const actionsErr = validateActionsShape(body.actions);
  if (actionsErr) return NextResponse.json({ error: actionsErr }, { status: 400 });

  const res = getDb()
    .prepare(
      "INSERT INTO automations (name, trigger, actions, enabled, created_by, created_via, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      body.name.trim(),
      JSON.stringify(body.trigger),
      JSON.stringify(body.actions),
      body.enabled === false ? 0 : 1,
      auth.user.id,
      body.via === "copilot" ? "copilot" : "ui",
      now()
    );
  reloadAutomations();
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: body.via === "copilot" ? "copilot" : "ui",
    action: "createAutomation",
    target: body.name.trim(),
  });
  return NextResponse.json({ ok: true, id: Number(res.lastInsertRowid) });
}
