import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getRuntime } from "@/server/runtime";
import { audit } from "@/server/audit";
import { AdapterError } from "@/server/adapters/types";
import type { ScheduleInput } from "@/types/pool";

export const dynamic = "force-dynamic";

function validateInput(body: unknown): ScheduleInput | string {
  const b = body as Partial<ScheduleInput> | null;
  if (!b || typeof b !== "object") return "Invalid body";
  if (typeof b.circuitId !== "number") return "circuitId required";
  if (typeof b.startTime !== "number" || b.startTime < 0 || b.startTime >= 1440) return "startTime must be 0–1439";
  if (typeof b.endTime !== "number" || b.endTime < 0 || b.endTime >= 1440) return "endTime must be 0–1439";
  if (!Array.isArray(b.days) || b.days.some((d) => typeof d !== "number" || d < 0 || d > 6)) return "days must be 0–6";
  const scheduleType = b.scheduleType === "runonce" ? "runonce" : "repeat";
  if (scheduleType === "repeat" && b.days.length === 0) return "Pick at least one day";
  if (b.heatSetpoint !== undefined && b.heatSetpoint !== null) {
    if (typeof b.heatSetpoint !== "number" || b.heatSetpoint < 60 || b.heatSetpoint > 104) {
      return "heatSetpoint must be 60–104";
    }
  }
  return {
    id: typeof b.id === "number" ? b.id : undefined,
    circuitId: b.circuitId,
    startTime: b.startTime,
    endTime: b.endTime,
    days: b.days,
    scheduleType,
    heatSetpoint: b.heatSetpoint ?? null,
    heatSource: typeof b.heatSource === "string" ? b.heatSource : null,
  };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const parsed = validateInput(await request.json().catch(() => null));
  if (typeof parsed === "string") return NextResponse.json({ error: parsed }, { status: 400 });
  try {
    await getRuntime().adapter.upsertSchedule(parsed);
    audit({
      userId: auth.user.id,
      userName: auth.user.name,
      source: "ui",
      action: parsed.id === undefined ? "createSchedule" : "updateSchedule",
      target: `circuit ${parsed.circuitId}`,
      newValue: `${parsed.startTime}–${parsed.endTime} days ${parsed.days.join(",")}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof AdapterError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await getRuntime().adapter.deleteSchedule(id);
    audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "deleteSchedule", target: `schedule ${id}` });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const status = err instanceof AdapterError ? err.status : 502;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status });
  }
}
