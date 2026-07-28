import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getAppSettings, saveAppSettings, storedAppKeys, type AppSettings, type AppSettingsPatch } from "@/server/settings";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  // storedKeys = values saved in the UI, which override env/defaults.
  return NextResponse.json({ settings: getAppSettings(), storedKeys: storedAppKeys() });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const patch: AppSettingsPatch = {};
  if (typeof body.poolVolumeGallons === "number" && body.poolVolumeGallons > 0 && body.poolVolumeGallons < 1_000_000) {
    patch.poolVolumeGallons = Math.round(body.poolVolumeGallons);
  }
  if (typeof body.costPerKwh === "number" && body.costPerKwh >= 0 && body.costPerKwh < 10) {
    patch.costPerKwh = body.costPerKwh;
  }
  // null = forget the saved value; .env / defaults become authoritative again.
  if (typeof body.latitude === "number" && Math.abs(body.latitude) <= 90) patch.latitude = body.latitude;
  else if (body.latitude === null) patch.latitude = null;
  if (typeof body.longitude === "number" && Math.abs(body.longitude) <= 180) patch.longitude = body.longitude;
  else if (body.longitude === null) patch.longitude = null;
  if (body.units === "F" || body.units === "C") patch.units = body.units;
  if (body.clock === "12" || body.clock === "24") patch.clock = body.clock;
  if (typeof body.saltLowPpm === "number" && body.saltLowPpm > 0) patch.saltLowPpm = body.saltLowPpm;
  if (body.idealRanges && typeof body.idealRanges === "object") {
    patch.idealRanges = { ...getAppSettings().idealRanges, ...(body.idealRanges as Partial<AppSettings["idealRanges"]>) };
  }
  const settings = saveAppSettings(patch);
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "updateSettings", target: "app settings", newValue: JSON.stringify(patch) });
  return NextResponse.json({ settings, storedKeys: storedAppKeys() });
}
