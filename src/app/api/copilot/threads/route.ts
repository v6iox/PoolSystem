import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { createThread, listThreads } from "@/server/copilot/engine";

export const dynamic = "force-dynamic";

/** Copilot chat threads — every role gets its own private threads. */
export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("guest");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ threads: listThreads(auth.user.id) });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("guest");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { title?: string } | null;
  const thread = createThread(auth.user.id, typeof body?.title === "string" ? body.title : undefined);
  return NextResponse.json({ thread });
}
