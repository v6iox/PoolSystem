import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getRuntime } from "@/server/runtime";

export const dynamic = "force-dynamic";

/** Advanced panel configuration snapshot (owner-only). */
export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ advanced: await getRuntime().adapter.getAdvancedOptions() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't read panel configuration" },
      { status: 502 }
    );
  }
}
