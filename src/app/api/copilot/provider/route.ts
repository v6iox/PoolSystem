import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getProviderConfig, saveProviderConfig, defaultModelFor, type CopilotProviderKind } from "@/server/copilot/provider";
import { getOauthStatus } from "@/server/copilot/openai-oauth";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

const KINDS: CopilotProviderKind[] = ["env", "openai-key", "openrouter", "chatgpt-oauth"];

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const config = getProviderConfig();
  return NextResponse.json({
    provider: config.provider,
    model: config.model,
    defaultModel: defaultModelFor(config.provider),
    hasApiKey: config.apiKey.length > 0,
    hasOpenrouterKey: config.openrouterApiKey.length > 0,
    oauth: getOauthStatus(),
    envBackend: process.env.MOCK_MODE === "true" ? "mock parser (MOCK_MODE)" : (process.env.COPILOT_BASE_URL ?? "http://localhost:11434/v1"),
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as {
    provider?: string;
    model?: string;
    apiKey?: string;
    openrouterApiKey?: string;
  } | null;
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const patch: { provider?: CopilotProviderKind; model?: string; apiKey?: string; openrouterApiKey?: string } = {};
  if (body.provider !== undefined) {
    if (!KINDS.includes(body.provider as CopilotProviderKind)) {
      return NextResponse.json({ error: "Unknown provider" }, { status: 400 });
    }
    patch.provider = body.provider as CopilotProviderKind;
  }
  if (body.model !== undefined) patch.model = body.model.trim().slice(0, 80);
  if (body.apiKey !== undefined) {
    const key = body.apiKey.trim();
    if (key && !key.startsWith("sk-")) {
      return NextResponse.json({ error: "That doesn't look like an OpenAI API key (sk-…)" }, { status: 400 });
    }
    patch.apiKey = key;
  }
  if (body.openrouterApiKey !== undefined) {
    const key = body.openrouterApiKey.trim();
    if (key && !key.startsWith("sk-or-")) {
      return NextResponse.json({ error: "That doesn't look like an OpenRouter key (sk-or-…)" }, { status: 400 });
    }
    patch.openrouterApiKey = key;
  }
  const saved = saveProviderConfig(patch);
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: "updateCopilotProvider",
    target: "copilot brain",
    newValue: JSON.stringify({
      provider: saved.provider,
      model: saved.model || defaultModelFor(saved.provider),
      apiKey: saved.apiKey ? "set" : "none",
      openrouterApiKey: saved.openrouterApiKey ? "set" : "none",
    }),
  });
  return NextResponse.json({ ok: true });
}
