import { createHash, randomBytes, randomUUID } from "node:crypto";
import { getSetting, setSetting } from "@/server/settings";

/**
 * "Sign in with ChatGPT" — the same authorization-code + PKCE flow the Codex
 * CLI and OpenClaw use, against OpenAI's public Codex client. Lets the
 * copilot run on a ChatGPT Plus/Pro subscription instead of API billing.
 *
 * The registered redirect URI for this client is a localhost URL, which a
 * phone/browser can't serve — so we use paste-back: the user signs in, lands
 * on an unreachable localhost URL, and pastes that URL (or just the code)
 * back into Moonpool. Tokens live only in the local SQLite on the Pi.
 *
 * This is NOT an official OpenAI integration surface; if OpenAI changes the
 * flow it may stop working (the API-key provider is the supported fallback).
 */

const AUTH_BASE = "https://auth.openai.com";
const CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const REDIRECT_URI = "http://localhost:1455/auth/callback";
const SCOPE = "openid profile email offline_access";

interface OauthTokens {
  accessToken: string;
  refreshToken: string;
  idToken: string;
  accountId: string;
  email: string;
  plan: string;
  /** Epoch ms when accessToken should be refreshed. */
  expiresAt: number;
}

interface PendingFlow {
  verifier: string;
  state: string;
  startedAt: number;
}

function b64url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

function decodeJwtPayload(token: string): Record<string, unknown> {
  try {
    const payload = token.split(".")[1];
    if (!payload) return {};
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function startOauthFlow(): { authUrl: string } {
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const state = randomUUID();
  setSetting<PendingFlow>("copilotOauthPending", { verifier, state, startedAt: Date.now() });
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
  });
  return { authUrl: `${AUTH_BASE}/oauth/authorize?${params.toString()}` };
}

function extractCode(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Full pasted redirect URL…
  try {
    const url = new URL(trimmed);
    const code = url.searchParams.get("code");
    if (code) return code;
  } catch {
    // …or a bare authorization code.
  }
  if (/^[\w.~-]{10,}$/.test(trimmed)) return trimmed;
  return null;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

function storeTokens(data: TokenResponse, previous?: OauthTokens): OauthTokens | null {
  const accessToken = data.access_token;
  if (!accessToken) return null;
  const accessClaims = decodeJwtPayload(accessToken);
  const auth = (accessClaims["https://api.openai.com/auth"] ?? {}) as Record<string, unknown>;
  const idClaims = data.id_token ? decodeJwtPayload(data.id_token) : {};
  const tokens: OauthTokens = {
    accessToken,
    refreshToken: data.refresh_token ?? previous?.refreshToken ?? "",
    idToken: data.id_token ?? previous?.idToken ?? "",
    accountId: String(auth.chatgpt_account_id ?? previous?.accountId ?? ""),
    email: String(idClaims.email ?? previous?.email ?? ""),
    plan: String(auth.chatgpt_plan_type ?? previous?.plan ?? ""),
    expiresAt: Date.now() + Math.max(60, (data.expires_in ?? 3600) - 300) * 1000,
  };
  setSetting("copilotOauth", tokens);
  return tokens;
}

export async function completeOauthFlow(pastedInput: string): Promise<{ ok: true; email: string; plan: string } | { ok: false; error: string }> {
  const pending = getSetting<PendingFlow | null>("copilotOauthPending", null);
  if (!pending || Date.now() - pending.startedAt > 15 * 60_000) {
    return { ok: false, error: "Sign-in session expired — hit Connect again and retry." };
  }
  const code = extractCode(pastedInput);
  if (!code) return { ok: false, error: "Couldn't find an authorization code in what you pasted." };

  let res: Response;
  try {
    res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: pending.verifier,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, error: "Couldn't reach auth.openai.com — check the Pi's internet connection." };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `OpenAI rejected the code (${res.status}${text ? `: ${text.slice(0, 120)}` : ""}).` };
  }
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  const tokens = storeTokens(data);
  if (!tokens) return { ok: false, error: "OpenAI's response was missing tokens." };
  setSetting("copilotOauthPending", null);
  return { ok: true, email: tokens.email, plan: tokens.plan };
}

export function getOauthStatus(): { connected: boolean; email: string; plan: string } {
  const tokens = getSetting<OauthTokens | null>("copilotOauth", null);
  if (!tokens?.accessToken || !tokens.accountId) return { connected: false, email: "", plan: "" };
  return { connected: true, email: tokens.email, plan: tokens.plan };
}

export function disconnectOauth(): void {
  setSetting("copilotOauth", null);
  setSetting("copilotOauthPending", null);
}

/** Fresh access credentials for the Codex backend, refreshing when stale. */
export async function getOauthCredentials(): Promise<{ accessToken: string; accountId: string } | null> {
  const tokens = getSetting<OauthTokens | null>("copilotOauth", null);
  if (!tokens?.accessToken) return null;
  if (Date.now() < tokens.expiresAt) {
    return { accessToken: tokens.accessToken, accountId: tokens.accountId };
  }
  if (!tokens.refreshToken) return null;
  try {
    const res = await fetch(`${AUTH_BASE}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: tokens.refreshToken,
        client_id: CLIENT_ID,
        scope: "openid profile email",
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as TokenResponse;
    const updated = storeTokens(data, tokens);
    return updated ? { accessToken: updated.accessToken, accountId: updated.accountId } : null;
  } catch {
    return null;
  }
}
