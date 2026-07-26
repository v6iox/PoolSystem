import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getRuntime } from "@/server/runtime";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const rows = getDb().prepare("SELECT * FROM circuit_meta").all() as Array<{
    circuit_id: number;
    display_name: string | null;
    icon: string | null;
    guest_visible: number;
    hidden: number;
  }>;
  return NextResponse.json({
    meta: rows.map((r) => ({
      circuitId: r.circuit_id,
      displayName: r.display_name,
      icon: r.icon,
      guestVisible: r.guest_visible === 1,
      hidden: r.hidden === 1,
    })),
  });
}

/** Owner: rename circuits, assign icons, set guest visibility, hide clutter. */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    circuitId?: number;
    displayName?: string | null;
    icon?: string | null;
    guestVisible?: boolean;
    hidden?: boolean;
    bodyId?: number;
    bodyName?: string | null;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const db = getDb();

  if (typeof body.bodyId === "number") {
    db.prepare(
      "INSERT INTO body_meta (body_id, display_name) VALUES (?, ?) ON CONFLICT(body_id) DO UPDATE SET display_name = excluded.display_name"
    ).run(body.bodyId, body.bodyName?.trim() || null);
    getRuntime().invalidateMeta();
    audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "renameBody", target: `body ${body.bodyId}`, newValue: body.bodyName ?? "" });
    return NextResponse.json({ ok: true });
  }

  if (typeof body.circuitId !== "number") return NextResponse.json({ error: "circuitId required" }, { status: 400 });
  const existing = db.prepare("SELECT * FROM circuit_meta WHERE circuit_id = ?").get(body.circuitId) as
    | { display_name: string | null; icon: string | null; guest_visible: number; hidden: number }
    | undefined;
  const next = {
    displayName: body.displayName !== undefined ? (body.displayName?.trim() || null) : (existing?.display_name ?? null),
    icon: body.icon !== undefined ? body.icon : (existing?.icon ?? null),
    guestVisible: body.guestVisible !== undefined ? body.guestVisible : existing?.guest_visible === 1,
    hidden: body.hidden !== undefined ? body.hidden : existing?.hidden === 1,
  };
  db.prepare(
    `INSERT INTO circuit_meta (circuit_id, display_name, icon, guest_visible, hidden) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(circuit_id) DO UPDATE SET display_name = excluded.display_name, icon = excluded.icon,
       guest_visible = excluded.guest_visible, hidden = excluded.hidden`
  ).run(body.circuitId, next.displayName, next.icon, next.guestVisible ? 1 : 0, next.hidden ? 1 : 0);
  getRuntime().invalidateMeta();
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: "updateCircuitMeta",
    target: `circuit ${body.circuitId}`,
    newValue: JSON.stringify(next),
  });
  return NextResponse.json({ ok: true });
}
