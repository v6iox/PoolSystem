import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { cancelPlanMessage } from "@/server/copilot/engine";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Cancel a pending copilot plan without executing it. */
export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("guest");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  const result = await cancelPlanMessage(auth.user, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ message: result.message });
}
