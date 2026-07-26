import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb, now } from "@/server/db";
import { audit } from "@/server/audit";
import { getAppSettings } from "@/server/settings";
import { sendAlert } from "@/server/push";

export const dynamic = "force-dynamic";

interface ChemistryReadingRow {
  id: number;
  at: number;
  body_id: number;
  ph: number | null;
  orp: number | null;
  fc: number | null;
  ta: number | null;
  cya: number | null;
  ch: number | null;
  salt: number | null;
  notes: string;
  user_id: number | null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? 200), 1000);
  const rows = getDb()
    .prepare("SELECT * FROM chemistry_readings ORDER BY at DESC LIMIT ?")
    .all(limit) as ChemistryReadingRow[];
  return NextResponse.json({ readings: rows });
}

const FIELDS = ["ph", "orp", "fc", "ta", "cya", "ch", "salt"] as const;
type ChemField = (typeof FIELDS)[number];

const BOUNDS: Record<ChemField, [number, number]> = {
  ph: [5, 10],
  orp: [200, 1000],
  fc: [0, 30],
  ta: [0, 400],
  cya: [0, 300],
  ch: [0, 1500],
  salt: [0, 10000],
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as
    | (Partial<Record<ChemField, number | null>> & { bodyId?: number; notes?: string; at?: number })
    | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const values: Partial<Record<ChemField, number | null>> = {};
  let hasAny = false;
  for (const field of FIELDS) {
    const v = body[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) return NextResponse.json({ error: `${field} must be a number` }, { status: 400 });
    const [lo, hi] = BOUNDS[field];
    if (v < lo || v > hi) return NextResponse.json({ error: `${field} out of plausible range (${lo}–${hi})` }, { status: 400 });
    values[field] = v;
    hasAny = true;
  }
  if (!hasAny) return NextResponse.json({ error: "Log at least one reading" }, { status: 400 });

  const at = typeof body.at === "number" && body.at > 0 && body.at <= Date.now() + 60_000 ? body.at : now();
  const res = getDb()
    .prepare(
      `INSERT INTO chemistry_readings (at, body_id, ph, orp, fc, ta, cya, ch, salt, notes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      at,
      typeof body.bodyId === "number" ? body.bodyId : 1,
      values.ph ?? null,
      values.orp ?? null,
      values.fc ?? null,
      values.ta ?? null,
      values.cya ?? null,
      values.ch ?? null,
      values.salt ?? null,
      typeof body.notes === "string" ? body.notes.slice(0, 2000) : "",
      auth.user.id
    );
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: "logChemistry",
    target: "water test",
    newValue: JSON.stringify(values),
  });

  // Out-of-range push alert on manual readings.
  const ranges = getAppSettings().idealRanges;
  const outOfRange = FIELDS.filter((f) => {
    const v = values[f];
    const range = ranges[f as keyof typeof ranges];
    return v !== undefined && v !== null && range !== undefined && (v < range[0] || v > range[1]);
  });
  if (outOfRange.length > 0) {
    void sendAlert(
      "chemistryOutOfRange",
      "Chemistry out of range",
      outOfRange.map((f) => `${f.toUpperCase()}: ${values[f]}`).join(", ")
    );
  }
  return NextResponse.json({ ok: true, id: Number(res.lastInsertRowid), outOfRange });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  const res = getDb().prepare("DELETE FROM chemistry_readings WHERE id = ?").run(id);
  if (res.changes === 0) return NextResponse.json({ error: "Reading not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
