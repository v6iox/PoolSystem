import { createHash, randomBytes } from "node:crypto";
import { getDb, now } from "@/server/db";
import { processMessage, confirmPlanMessage } from "@/server/copilot/engine";
import type { SessionUser, Role } from "@/types/auth";

/**
 * Voice-assistant plumbing shared by the Siri Shortcuts and Alexa endpoints.
 *
 * Auth: long-lived integration tokens minted by the Owner in Settings →
 * Integrations. Only the SHA-256 of a token is stored; the plaintext is shown
 * once. Each token is bound to the user who created it, so voice commands
 * carry that user's role and audit identity.
 *
 * Execution: voice flows can't click a Confirm button, so plans returned by
 * the copilot engine are auto-confirmed — same validation, same role rules,
 * same audit trail (source: copilot). Weather advisories are read back as
 * part of the spoken reply instead of shown as a card.
 */

export interface IntegrationTokenRow {
  id: number;
  label: string;
  userId: number;
  createdAt: number;
  lastUsedAt: number | null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(userId: number, label: string): { id: number; token: string } {
  const token = `mp_${randomBytes(24).toString("base64url")}`;
  const res = getDb()
    .prepare("INSERT INTO integration_tokens (label, token_hash, user_id, created_at) VALUES (?, ?, ?, ?)")
    .run(label.trim() || "Voice", hashToken(token), userId, now());
  return { id: Number(res.lastInsertRowid), token };
}

export function listTokens(): IntegrationTokenRow[] {
  const rows = getDb()
    .prepare("SELECT id, label, user_id, created_at, last_used_at FROM integration_tokens ORDER BY id DESC")
    .all() as Array<{ id: number; label: string; user_id: number; created_at: number; last_used_at: number | null }>;
  return rows.map((r) => ({ id: r.id, label: r.label, userId: r.user_id, createdAt: r.created_at, lastUsedAt: r.last_used_at }));
}

export function revokeToken(id: number): boolean {
  return getDb().prepare("DELETE FROM integration_tokens WHERE id = ?").run(id).changes > 0;
}

export function verifyToken(token: string): SessionUser | null {
  if (!token || token.length < 20) return null;
  const row = getDb()
    .prepare(
      `SELECT t.id AS token_id, u.id, u.email, u.name, u.role, u.disabled
       FROM integration_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = ?`
    )
    .get(hashToken(token)) as
    | { token_id: number; id: number; email: string; name: string; role: Role; disabled: number }
    | undefined;
  if (!row || row.disabled) return null;
  getDb().prepare("UPDATE integration_tokens SET last_used_at = ? WHERE id = ?").run(now(), row.token_id);
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

function voiceThreadId(userId: number, source: string): number {
  const db = getDb();
  const title = `Voice · ${source}`;
  const existing = db
    .prepare("SELECT id FROM copilot_threads WHERE user_id = ? AND title = ? ORDER BY id DESC LIMIT 1")
    .get(userId, title) as { id: number } | undefined;
  if (existing) return existing.id;
  const res = db
    .prepare("INSERT INTO copilot_threads (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(userId, title, now(), now());
  return Number(res.lastInsertRowid);
}

/** One utterance in → one spoken sentence out. */
export async function runVoiceUtterance(user: SessionUser, text: string, source: "Siri" | "Alexa"): Promise<string> {
  const threadId = voiceThreadId(user.id, source);
  const { messages } = await processMessage(user, threadId, text);
  const assistant = messages.filter((m) => m.role === "assistant").at(-1);
  if (!assistant) return "Sorry, I didn't catch that.";

  // Read-only answers and refusals come back as plain content.
  if (!assistant.plan || assistant.planState !== "pending") {
    return flattenForSpeech(assistant.content);
  }

  // Auto-confirm the plan; prepend any weather advisory to the spoken reply.
  const advisories = assistant.plan.advisories ?? [];
  const confirmed = await confirmPlanMessage(user, assistant.id);
  if (!confirmed.ok) return `I couldn't do that: ${confirmed.error}`;
  const lines =
    confirmed.message.plan?.results && confirmed.message.plan.results.length > 0
      ? confirmed.message.plan.results
      : (confirmed.message.plan?.summary ?? []);
  const done = lines.join(". ");
  const heads = advisories.length > 0 ? `Heads up: ${advisories.join(" ")} ` : "";
  return flattenForSpeech(`${heads}${done || "Done."}`);
}

function flattenForSpeech(text: string): string {
  return text
    .replace(/[•\n]+/g, ". ")
    .replace(/\s{2,}/g, " ")
    .replace(/°F/g, " degrees")
    .replace(/°C/g, " degrees celsius")
    .replace(/°/g, " degrees")
    .trim()
    .slice(0, 600);
}
