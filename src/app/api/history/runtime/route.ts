import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";
import { getAppSettings } from "@/server/settings";

export const dynamic = "force-dynamic";

/** Equipment runtime + energy per day, with estimated cost at the configured rate. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const days = Math.min(Number(request.nextUrl.searchParams.get("days") ?? 30), 365);
  const rows = getDb()
    .prepare("SELECT day, key, seconds, wh FROM equipment_runtime WHERE day >= date('now', 'localtime', ?) ORDER BY day")
    .all(`-${days} days`) as Array<{ day: string; key: string; seconds: number; wh: number }>;
  const costPerKwh = getAppSettings().costPerKwh;
  return NextResponse.json({
    costPerKwh,
    rows: rows.map((r) => ({
      day: r.day,
      key: r.key,
      hours: Math.round((r.seconds / 3600) * 100) / 100,
      kwh: Math.round((r.wh / 1000) * 1000) / 1000,
      cost: Math.round((r.wh / 1000) * costPerKwh * 100) / 100,
    })),
  });
}
