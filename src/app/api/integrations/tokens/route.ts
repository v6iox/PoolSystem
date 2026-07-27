import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth/guard";
import { listTokens, mintToken, revokeToken } from "@/server/integrations";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  return NextResponse.json({ tokens: listTokens() });
}

/** Mint a voice token — plaintext is returned exactly once. */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { label?: string } | null;
  const { id, token } = mintToken(auth.user.id, body?.label ?? "Voice");
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "mintIntegrationToken", target: body?.label ?? "Voice" });
  return NextResponse.json({ id, token });
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const auth = await requireUser("owner");
  if (!auth.ok) return auth.response;
  const id = Number(request.nextUrl.searchParams.get("id"));
  if (!Number.isInteger(id)) return NextResponse.json({ error: "id required" }, { status: 400 });
  if (!revokeToken(id)) return NextResponse.json({ error: "Token not found" }, { status: 404 });
  audit({ userId: auth.user.id, userName: auth.user.name, source: "ui", action: "revokeIntegrationToken", target: `token ${id}` });
  return NextResponse.json({ ok: true });
}
