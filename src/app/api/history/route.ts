import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb } from "@/server/db";

export const dynamic = "force-dynamic";

interface SeriesPoint {
  at: number;
  value: number;
}

/**
 * Time-series query. For ranges ≤ 3 days, raw samples (optionally bucketed);
 * for longer ranges, daily rollups (min/max/avg) merged with today's raw data.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const params = request.nextUrl.searchParams;
  const metrics = (params.get("metrics") ?? "").split(",").map((m) => m.trim()).filter(Boolean).slice(0, 12);
  if (metrics.length === 0) return NextResponse.json({ error: "metrics required" }, { status: 400 });
  const to = Number(params.get("to") ?? Date.now());
  const from = Number(params.get("from") ?? to - 86400_000);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
    return NextResponse.json({ error: "Invalid range" }, { status: 400 });
  }

  const db = getDb();
  const rangeMs = to - from;
  const series: Record<string, SeriesPoint[]> = {};
  const rollups: Record<string, Array<{ day: string; min: number; max: number; avg: number }>> = {};

  if (rangeMs <= 3 * 86400_000) {
    // Bucket raw samples so the payload stays bounded (~400 points/metric).
    const bucketMs = Math.max(60_000, Math.floor(rangeMs / 400));
    const stmt = db.prepare(
      `SELECT (at / ?) * ? AS bucket, AVG(value) AS value FROM history_samples
       WHERE metric = ? AND at >= ? AND at <= ? GROUP BY bucket ORDER BY bucket`
    );
    for (const metric of metrics) {
      const rows = stmt.all(bucketMs, bucketMs, metric, from, to) as Array<{ bucket: number; value: number }>;
      series[metric] = rows.map((r) => ({ at: r.bucket, value: Math.round(r.value * 100) / 100 }));
    }
  } else {
    const rollupStmt = db.prepare(
      `SELECT day, min, max, avg FROM history_rollups
       WHERE metric = ? AND day >= date(? / 1000, 'unixepoch', 'localtime') AND day <= date(? / 1000, 'unixepoch', 'localtime')
       ORDER BY day`
    );
    const todayStmt = db.prepare(
      `SELECT date(at / 1000, 'unixepoch', 'localtime') AS day, MIN(value) AS min, MAX(value) AS max, AVG(value) AS avg
       FROM history_samples WHERE metric = ? AND at >= ? AND at <= ?
       GROUP BY day ORDER BY day`
    );
    for (const metric of metrics) {
      const rolled = rollupStmt.all(metric, from, to) as Array<{ day: string; min: number; max: number; avg: number }>;
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);
      const fresh = todayStmt.all(metric, Math.max(from, startOfToday.getTime()), to) as Array<{
        day: string;
        min: number;
        max: number;
        avg: number;
      }>;
      const byDay = new Map(rolled.map((r) => [r.day, r]));
      for (const f of fresh) if (!byDay.has(f.day)) byDay.set(f.day, f);
      rollups[metric] = [...byDay.values()]
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((r) => ({ day: r.day, min: Math.round(r.min * 100) / 100, max: Math.round(r.max * 100) / 100, avg: Math.round(r.avg * 100) / 100 }));
    }
  }

  return NextResponse.json({ series, rollups, from, to });
}
