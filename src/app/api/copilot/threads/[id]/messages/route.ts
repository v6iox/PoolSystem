import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getThreadForUser, listMessages, processMessage } from "@/server/copilot/engine";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("guest");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
  const thread = getThreadForUser(id, auth.user.id);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  return NextResponse.json({ thread, messages: listMessages(id) });
}

/** Send a message: persists the user turn, plans/answers, returns the new rows. */
export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  const auth = await requireUser("guest");
  if (!auth.ok) return auth.response;
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid thread id" }, { status: 400 });
  const thread = getThreadForUser(id, auth.user.id);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "Say something first" }, { status: 400 });
  if (text.length > 2000) return NextResponse.json({ error: "That message is too long (max 2000 characters)" }, { status: 400 });
  const result = await processMessage(auth.user, id, text);
  return NextResponse.json(result);
}
