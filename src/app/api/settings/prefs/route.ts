import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

/**
 * Per-user preferences blob: theme, accent, units override, clock, widget
 * layout, notification prefs. Owned by the signed-in user, no role gate.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const row = getDb().prepare("SELECT prefs FROM user_prefs WHERE user_id = ?").get(auth.user.id) as
    | { prefs: string }
    | undefined;
  let prefs: Record<string, unknown> = {};
  if (row) {
    try {
      prefs = JSON.parse(row.prefs) as Record<string, unknown>;
    } catch {
      prefs = {};
    }
  }
  return NextResponse.json({ prefs });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const db = getDb();
  const row = db.prepare("SELECT prefs FROM user_prefs WHERE user_id = ?").get(auth.user.id) as
    | { prefs: string }
    | undefined;
  let current: Record<string, unknown> = {};
  if (row) {
    try {
      current = JSON.parse(row.prefs) as Record<string, unknown>;
    } catch {
      current = {};
    }
  }
  const merged = { ...current, ...body };
  const serialized = JSON.stringify(merged);
  if (serialized.length > 100_000) return NextResponse.json({ error: "Preferences too large" }, { status: 413 });
  db.prepare(
    "INSERT INTO user_prefs (user_id, prefs) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs"
  ).run(auth.user.id, serialized);
  return NextResponse.json({ prefs: merged });
}
