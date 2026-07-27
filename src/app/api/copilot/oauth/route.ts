import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { startOauthFlow, completeOauthFlow, disconnectOauth, getOauthStatus } from "@/server/copilot/openai-oauth";
import { saveProviderConfig } from "@/server/copilot/provider";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

/**
 * "Sign in with ChatGPT" flow (owner only):
 *  POST {action:"start"}                → {authUrl} to open in a new tab
 *  POST {action:"complete", pasted:"…"} → exchanges the pasted redirect URL/code
 *  DELETE                               → disconnect + forget tokens
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { action?: string; pasted?: string } | null;

  if (body?.action === "start") {
    return NextResponse.json(startOauthFlow());
  }
  if (body?.action === "complete") {
    const result = await completeOauthFlow(body.pasted ?? "");
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
    // Connecting implies wanting to use it.
    saveProviderConfig({ provider: "chatgpt-oauth" });
    audit({
      userId: auth.user.id,
      userName: auth.user.name,
      source: "ui",
      action: "connectChatgpt",
      target: "copilot brain",
      newValue: result.email || "connected",
    });
    return NextResponse.json({ ok: true, oauth: getOauthStatus() });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  disconnectOauth();
  saveProviderConfig({ provider: "env" });
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "disconnectChatgpt", target: "copilot brain" });
  return NextResponse.json({ ok: true });
}
