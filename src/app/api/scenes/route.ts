import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb, now } from "@/server/db";
import { audit } from "@/server/audit";
import type { PoolAction, SceneDef } from "@/types/actions";
import { validateActionShape } from "@/server/validate";

export const dynamic = "force-dynamic";

interface SceneRow {
  id: number;
  name: string;
  icon: string;
  description: string;
  actions: string;
  guest_visible: number;
  position: number;
  created_by: number | null;
}

function toDef(row: SceneRow): SceneDef {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    description: row.description,
    actions: JSON.parse(row.actions) as PoolAction[],
    guestVisible: row.guest_visible === 1,
    position: row.position,
    createdBy: row.created_by,
  };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const rows = getDb().prepare("SELECT * FROM scenes ORDER BY position, id").all() as SceneRow[];
  const scenes = rows.map(toDef).filter((s) => auth.user.role !== "guest" || s.guestVisible);
  return NextResponse.json({ scenes });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Partial<SceneDef> | null;
  if (!body || typeof body.name !== "string" || body.name.trim().length === 0) {
    return NextResponse.json({ error: "Scene name required" }, { status: 400 });
  }
  if (!Array.isArray(body.actions) || body.actions.length === 0) {
    return NextResponse.json({ error: "At least one action required" }, { status: 400 });
  }
  for (const action of body.actions) {
    const err = validateActionShape(action);
    if (err) return NextResponse.json({ error: err }, { status: 400 });
  }
  const db = getDb();
  const maxPos = (db.prepare("SELECT COALESCE(MAX(position), 0) AS p FROM scenes").get() as { p: number }).p;
  const res = db
    .prepare(
      "INSERT INTO scenes (name, icon, description, actions, guest_visible, position, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(
      body.name.trim(),
      typeof body.icon === "string" ? body.icon : "sparkles",
      typeof body.description === "string" ? body.description : "",
      JSON.stringify(body.actions),
      body.guestVisible === true ? 1 : 0,
      maxPos + 1,
      auth.user.id,
      now()
    );
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "createScene", target: body.name.trim() });
  return NextResponse.json({ ok: true, id: Number(res.lastInsertRowid) });
}
