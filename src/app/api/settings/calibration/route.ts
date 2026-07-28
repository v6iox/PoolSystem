import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getRuntime } from "@/server/runtime";
import { audit } from "@/server/audit";
import type { TempCalibrationInput } from "@/server/adapters/types";

export const dynamic = "force-dynamic";

/**
 * Panel temperature-sensor calibration (the water/air/solar offsets
 * ScreenLogic exposes). Owner-only: a bad offset silently skews heating.
 */
export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  try {
    return NextResponse.json({ calibration: await getRuntime().adapter.getTempCalibration() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't read calibration from the controller" },
      { status: 502 }
    );
  }
}

const FIELDS = ["water1", "water2", "air", "solar1", "solar2"] as const;

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const input: TempCalibrationInput = {};
  const described: string[] = [];
  for (const field of FIELDS) {
    const v = body[field];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      return NextResponse.json({ error: `${field} must be a number` }, { status: 400 });
    }
    const clamped = Math.max(-10, Math.min(10, Math.round(v)));
    input[field] = clamped;
    described.push(`${field} ${clamped >= 0 ? "+" : ""}${clamped}°`);
  }
  if (described.length === 0) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  try {
    await getRuntime().adapter.setTempCalibration(input);
    audit({
      userId: auth.user.id,
      userName: auth.user.name,
      source: "ui",
      action: "setTempCalibration",
      target: "temperature sensors",
      newValue: described.join(", "),
    });
    return NextResponse.json({ calibration: await getRuntime().adapter.getTempCalibration() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "The controller rejected the calibration change" },
      { status: 502 }
    );
  }
}
