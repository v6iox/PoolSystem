import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { CURRENT_VERSION, checkForUpdate, isNewer } from "@/server/updates";

export const dynamic = "force-dynamic";

/** Manual "Check for updates". */
export async function POST(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const state = await checkForUpdate();
  return NextResponse.json({
    currentVersion: CURRENT_VERSION,
    updateAvailable: state.latestVersion !== null && isNewer(state.latestVersion, CURRENT_VERSION),
    state,
  });
}
