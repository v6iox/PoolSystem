import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getDb, now } from "@/server/db";
import { processMessage } from "@/server/copilot/engine";

export const dynamic = "force-dynamic";

const QUICK_TITLE = "Quick asks";

/**
 * The ask-bar endpoint: one-shot questions/commands from anywhere in the app.
 * Rides the exact same copilot engine + thread history (a per-user "Quick
 * asks" thread), so plans still confirm through the normal endpoints and
 * everything shows up in the Copilot tab.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { text?: string } | null;
  const text = body?.text?.trim();
  if (!text) return NextResponse.json({ error: "Ask something first" }, { status: 400 });
  if (text.length > 500) return NextResponse.json({ error: "Keep quick asks under 500 characters" }, { status: 400 });

  const db = getDb();
  let thread = db
    .prepare("SELECT id FROM copilot_threads WHERE user_id = ? AND title = ? ORDER BY id DESC LIMIT 1")
    .get(auth.user.id, QUICK_TITLE) as { id: number } | undefined;
  if (!thread) {
    const res = db
      .prepare("INSERT INTO copilot_threads (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(auth.user.id, QUICK_TITLE, now(), now());
    thread = { id: Number(res.lastInsertRowid) };
  }

  const { messages } = await processMessage(auth.user, thread.id, text);
  const assistant = messages.filter((m) => m.role === "assistant").at(-1) ?? null;
  return NextResponse.json({ threadId: thread.id, assistant });
}
