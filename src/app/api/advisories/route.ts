import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { heatAdvisories } from "@/server/weather";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

/**
 * Weather-aware confirmation support: given an intended action, returns
 * advisories worth showing before executing ("Rain is forecast tomorrow
 * 3–4 PM"). Empty list = just do it, no prompt.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const params = request.nextUrl.searchParams;
  const context = params.get("context");
  if (context !== "heat") return NextResponse.json({ advisories: [] });
  const bodyId = Number(params.get("bodyId"));
  const setPoint = params.get("setPoint") ? Number(params.get("setPoint")) : undefined;
  const body = getRuntime()
    .getSnapshot()
    .bodies.find((b) => b.id === bodyId);
  const advisories = await heatAdvisories(body?.kind ?? "pool", setPoint);
  return NextResponse.json({ advisories });
}
