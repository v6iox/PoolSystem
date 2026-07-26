import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { queryAudit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const params = request.nextUrl.searchParams;
  const rows = queryAudit({
    limit: Number(params.get("limit") ?? 100),
    before: params.get("before") ? Number(params.get("before")) : undefined,
    source: params.get("source") ?? undefined,
  });
  return NextResponse.json({ entries: rows });
}
