import { type NextRequest } from "next/server";
import { rateLimit } from "@/server/auth/guard";
import { runVoiceUtterance, verifyToken } from "@/server/integrations";

export const dynamic = "force-dynamic";

/**
 * Siri Shortcuts endpoint. A Shortcut does "Get contents of URL":
 *   GET /api/integrations/siri?token=mp_…&q=warm%20the%20spa
 * and speaks the plain-text response. Works with "Hey Siri, <shortcut name>"
 * including dictated input via the Shortcuts "Dictate text" action.
 */

function plain(text: string, status = 200): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

async function handle(request: NextRequest, token: string, q: string): Promise<Response> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  if (!rateLimit(`voice:${ip}`, 30, 60_000)) return plain("Too many requests.", 429);
  const user = verifyToken(token);
  if (!user) return plain("Invalid token.", 401);
  if (!q) return plain("Ask me something about the pool.");
  return plain(await runVoiceUtterance(user, q, "Siri"));
}

export async function GET(request: NextRequest): Promise<Response> {
  const params = request.nextUrl.searchParams;
  return handle(request, params.get("token") ?? "", (params.get("q") ?? params.get("text") ?? "").trim());
}

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { token?: string; q?: string; text?: string } | null;
  const params = request.nextUrl.searchParams;
  const token = body?.token ?? params.get("token") ?? "";
  const q = (body?.q ?? body?.text ?? params.get("q") ?? "").trim();
  return handle(request, token, q);
}
