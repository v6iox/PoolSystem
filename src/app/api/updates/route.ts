import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import {
  CURRENT_VERSION,
  getUpdateConfig,
  getUpdateState,
  getUpdaterStatus,
  installKind,
  isNewer,
  saveUpdateConfig,
} from "@/server/updates";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const state = getUpdateState();
  const updater = await getUpdaterStatus();
  return NextResponse.json({
    currentVersion: CURRENT_VERSION,
    updateAvailable: state.latestVersion !== null && isNewer(state.latestVersion, CURRENT_VERSION),
    state,
    config: getUpdateConfig(),
    updater,
    installKind: installKind(),
  });
}

/** Update the schedule/auto settings. */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { auto?: boolean; hour?: number } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const patch: { auto?: boolean; hour?: number } = {};
  if (typeof body.auto === "boolean") patch.auto = body.auto;
  if (typeof body.hour === "number" && body.hour >= 0 && body.hour <= 23) patch.hour = body.hour;
  const config = saveUpdateConfig(patch);
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: "updateSettings",
    target: "auto-update",
    newValue: JSON.stringify(config),
  });
  return NextResponse.json({ config });
}
