import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { getSetting, setSetting } from "@/server/settings";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

interface AlexaConfig {
  skillId: string;
  userId: number;
}

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const config = getSetting<AlexaConfig | null>("alexa", null);
  return NextResponse.json({ skillId: config?.skillId ?? "" });
}

/** Save (or clear) the Alexa skill ID; commands will run as the saving owner. */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { skillId?: string } | null;
  const skillId = body?.skillId?.trim() ?? "";
  if (skillId && !/^amzn1\.ask\.skill\.[a-zA-Z0-9-]+$/.test(skillId)) {
    return NextResponse.json({ error: "That doesn't look like a skill ID (amzn1.ask.skill.…)" }, { status: 400 });
  }
  setSetting("alexa", skillId ? { skillId, userId: auth.user.id } : null);
  audit({
    userId: auth.user.id,
    userName: auth.user.name,
    source: "ui",
    action: skillId ? "configureAlexa" : "clearAlexa",
    target: "Alexa skill",
    newValue: skillId || "removed",
  });
  return NextResponse.json({ ok: true });
}
