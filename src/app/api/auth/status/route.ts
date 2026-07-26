import { NextResponse } from "next/server";
import { getUserCount } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/** Public: tells the client whether first-run setup is needed. */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ needsSetup: getUserCount() === 0 });
}
