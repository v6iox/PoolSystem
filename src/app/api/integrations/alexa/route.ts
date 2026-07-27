import { NextResponse, type NextRequest } from "next/server";
import { createVerify, X509Certificate } from "node:crypto";
import { getSetting } from "@/server/settings";
import { getDb } from "@/server/db";
import { runVoiceUtterance } from "@/server/integrations";
import type { Role, SessionUser } from "@/types/auth";

export const dynamic = "force-dynamic";

/**
 * Alexa custom-skill endpoint (Alexa Skills Kit JSON in/out).
 *
 * Security, per Amazon's hosting requirements:
 *  1. SignatureCertChainUrl must be a valid echo-api.amazon.com S3 URL
 *  2. the cert chain must be fresh and issued to echo-api.amazon.com
 *  3. the SHA1-RSA signature must verify over the exact raw body
 *  4. the request's applicationId must match the skill ID saved in Settings
 *  5. the request timestamp must be within 150 s
 * Commands run as the owner who configured the skill (saved alongside the
 * skill ID), through the same validated + audited copilot path as everything
 * else.
 */

interface AlexaConfig {
  skillId: string;
  userId: number;
}

interface AlexaRequestBody {
  version?: string;
  session?: { application?: { applicationId?: string } };
  context?: { System?: { application?: { applicationId?: string } } };
  request?: {
    type?: string;
    timestamp?: string;
    intent?: { name?: string; slots?: Record<string, { value?: string }> };
  };
}

const certCache = new Map<string, { cert: X509Certificate; at: number }>();

function speak(text: string, endSession = true): NextResponse {
  return NextResponse.json({
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text },
      shouldEndSession: endSession,
    },
  });
}

function validCertUrl(raw: string | null): URL | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.hostname.toLowerCase() !== "s3.amazonaws.com") return null;
    if ((url.port && url.port !== "443") || !url.pathname.startsWith("/echo.api/")) return null;
    return url;
  } catch {
    return null;
  }
}

async function verifySignature(request: NextRequest, rawBody: string): Promise<boolean> {
  // MOCK_MODE skips crypto so the endpoint is testable offline.
  if (process.env.MOCK_MODE === "true") return true;
  const certUrl = validCertUrl(request.headers.get("signaturecertchainurl"));
  const signature = request.headers.get("signature-256") ?? request.headers.get("signature");
  if (!certUrl || !signature) return false;
  try {
    let entry = certCache.get(certUrl.href);
    if (!entry || Date.now() - entry.at > 3600_000) {
      const res = await fetch(certUrl, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return false;
      const pem = await res.text();
      entry = { cert: new X509Certificate(pem), at: Date.now() };
      certCache.set(certUrl.href, entry);
    }
    const cert = entry.cert;
    const nowMs = Date.now();
    if (nowMs < new Date(cert.validFrom).getTime() || nowMs > new Date(cert.validTo).getTime()) return false;
    if (!(cert.subjectAltName ?? "").includes("echo-api.amazon.com")) return false;
    const algorithm = request.headers.get("signature-256") ? "RSA-SHA256" : "RSA-SHA1";
    const verifier = createVerify(algorithm);
    verifier.update(rawBody, "utf8");
    return verifier.verify(cert.publicKey, signature, "base64");
  } catch {
    return false;
  }
}

function configuredSkill(): AlexaConfig | null {
  const config = getSetting<AlexaConfig | null>("alexa", null);
  return config && config.skillId ? config : null;
}

function actingUser(config: AlexaConfig): SessionUser | null {
  const row = getDb()
    .prepare("SELECT id, email, name, role, disabled FROM users WHERE id = ?")
    .get(config.userId) as { id: number; email: string; name: string; role: Role; disabled: number } | undefined;
  if (!row || row.disabled) return null;
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = configuredSkill();
  if (!config) return NextResponse.json({ error: "Alexa skill not configured" }, { status: 403 });

  const rawBody = await request.text();
  if (!(await verifySignature(request, rawBody))) {
    return NextResponse.json({ error: "Signature verification failed" }, { status: 400 });
  }

  let body: AlexaRequestBody;
  try {
    body = JSON.parse(rawBody) as AlexaRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const appId = body.session?.application?.applicationId ?? body.context?.System?.application?.applicationId;
  if (appId !== config.skillId) return NextResponse.json({ error: "Wrong application" }, { status: 403 });

  const timestamp = body.request?.timestamp ? new Date(body.request.timestamp).getTime() : 0;
  if (!timestamp || Math.abs(Date.now() - timestamp) > 150_000) {
    return NextResponse.json({ error: "Stale request" }, { status: 400 });
  }

  const user = actingUser(config);
  if (!user) return speak("The account linked to this skill is disabled.");

  const type = body.request?.type ?? "";
  if (type === "LaunchRequest") {
    return speak("Moonpool here. What should the pool do?", false);
  }
  if (type === "SessionEndedRequest") {
    return NextResponse.json({ version: "1.0", response: {} });
  }
  if (type === "IntentRequest") {
    const intent = body.request?.intent?.name ?? "";
    if (intent === "AMAZON.StopIntent" || intent === "AMAZON.CancelIntent") return speak("Okay.");
    if (intent === "AMAZON.HelpIntent") {
      return speak(
        "Ask me anything about the pool — like, what's the spa temperature, warm the spa to one hundred two, or turn on the waterfall.",
        false
      );
    }
    if (intent === "AskPoolIntent") {
      const query = body.request?.intent?.slots?.query?.value?.trim();
      if (!query) return speak("What should the pool do?", false);
      return speak(await runVoiceUtterance(user, query, "Alexa"));
    }
  }
  return speak("Sorry, I didn't catch that. Ask me anything about the pool.", false);
}
