import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { audit } from "@/server/audit";
import {
  getTempestSettings,
  getTempestStatus,
  pollTempestNow,
  restartTempest,
  saveTempestSettings,
} from "@/server/tempest";

export const dynamic = "force-dynamic";

/**
 * Tempest weather station setup. Owner-only. The token is a WeatherFlow
 * credential — it never round-trips to the browser; the client sees only
 * whether one is set and its last 4 characters.
 */

function payload(): Record<string, unknown> {
  const { effective, storedKeys } = getTempestSettings();
  return {
    settings: {
      udp: effective.udp,
      tokenSet: effective.token.length > 0,
      tokenTail: effective.token.slice(-4),
      stationId: effective.stationId,
      storedKeys,
    },
    status: getTempestStatus(),
  };
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  return NextResponse.json(payload());
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: { udp?: boolean | null; token?: string | null; stationId?: string | null } = {};
  const described: string[] = [];
  if (body.udp !== undefined) {
    if (body.udp !== null && typeof body.udp !== "boolean") {
      return NextResponse.json({ error: "udp must be a boolean" }, { status: 400 });
    }
    patch.udp = body.udp as boolean | null;
    described.push(`udp=${body.udp === null ? "(.env)" : String(body.udp)}`);
  }
  if (body.token !== undefined) {
    if (body.token !== null && typeof body.token !== "string") {
      return NextResponse.json({ error: "token must be a string" }, { status: 400 });
    }
    patch.token = body.token === null ? null : (body.token as string).trim();
    described.push(`token=${body.token === null ? "(.env)" : "set"}`);
  }
  if (body.stationId !== undefined) {
    if (body.stationId !== null && typeof body.stationId !== "string" && typeof body.stationId !== "number") {
      return NextResponse.json({ error: "stationId must be a string" }, { status: 400 });
    }
    patch.stationId = body.stationId === null ? null : String(body.stationId).trim();
    described.push(`station=${body.stationId === null ? "(.env)" : String(body.stationId)}`);
  }

  if (Object.keys(patch).length > 0) saveTempestSettings(patch);
  restartTempest();
  // Immediate poll so the status below reflects reality, not "wait 5 minutes".
  await pollTempestNow().catch(() => undefined);

  if (described.length > 0) {
    audit({
      userId: auth.user.id,
      userName: auth.user.name,
      source: "ui",
      action: "setTempestConfig",
      target: "Tempest weather station",
      newValue: described.join(", "),
    });
  }
  return NextResponse.json(payload());
}
