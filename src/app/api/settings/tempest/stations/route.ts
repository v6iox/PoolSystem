import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getTempestSettings, listTempestStations } from "@/server/tempest";

export const dynamic = "force-dynamic";

/**
 * Station picker: list the stations a WeatherFlow token can see. Accepts a
 * token in the body (so the picker works before saving) or falls back to the
 * configured one. Owner-only.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as { token?: unknown };
  const token =
    typeof body.token === "string" && body.token.trim().length > 0
      ? body.token.trim()
      : getTempestSettings().effective.token;
  if (!token) return NextResponse.json({ error: "No token — paste your WeatherFlow token first" }, { status: 400 });
  try {
    return NextResponse.json({ stations: await listTempestStations(token) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Couldn't reach WeatherFlow" }, { status: 502 });
  }
}
