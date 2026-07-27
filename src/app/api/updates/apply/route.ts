import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { CURRENT_VERSION, applyUpdate, getUpdateState, isNewer } from "@/server/updates";

export const dynamic = "force-dynamic";

/**
 * "Update now" — hands the release tag to the updater sidecar. The web
 * container gets rebuilt underneath us, so the client should expect the
 * connection to drop and poll until Moonpool returns.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { tag?: string } | null;
  const state = getUpdateState();
  const tag = body?.tag ?? state.latestTag;
  if (!tag) return NextResponse.json({ error: "No release tag known — check for updates first" }, { status: 400 });
  if (state.latestVersion && tag === state.latestTag && !isNewer(state.latestVersion, CURRENT_VERSION)) {
    return NextResponse.json({ error: `Already on ${tag}` }, { status: 409 });
  }
  const result = await applyUpdate(tag, auth.user.name);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ok: true, tag });
}
