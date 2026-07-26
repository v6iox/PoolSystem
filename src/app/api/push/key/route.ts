import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getVapidKeys } from "@/server/push";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ publicKey: getVapidKeys().publicKey });
}
