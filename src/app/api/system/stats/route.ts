import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getSystemStats } from "@/server/sysinfo";

export const dynamic = "force-dynamic";

/** Live host health (CPU, memory, disk, temperature) for the System page. */
export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ stats: getSystemStats() });
}
