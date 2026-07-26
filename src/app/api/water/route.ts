import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { estimateWaterLevel, recordRefill } from "@/server/water";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ water: await estimateWaterLevel() });
}

/** "I topped it off" — resets the balance baseline. */
export async function POST(): Promise<NextResponse> {
  const auth = await requireUser("family");
  if (!auth.ok) return auth.response;
  recordRefill();
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: "waterRefill",
    target: "water level",
    newValue: "baseline reset",
  });
  return NextResponse.json({ water: await estimateWaterLevel() });
}
