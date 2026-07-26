import { getDb, now } from "@/server/db";
import type { ActionSource } from "@/types/actions";

export interface AuditEntry {
  userId: number | null;
  userName: string;
  source: ActionSource;
  action: string;
  target: string;
  oldValue?: string | null;
  newValue?: string | null;
  ok?: boolean;
  detail?: string | null;
}

export function audit(entry: AuditEntry): void {
  getDb()
    .prepare(
      `INSERT INTO audit_log (at, user_id, user_name, source, action, target, old_value, new_value, ok, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      now(),
      entry.userId,
      entry.userName,
      entry.source,
      entry.action,
      entry.target,
      entry.oldValue ?? null,
      entry.newValue ?? null,
      entry.ok === false ? 0 : 1,
      entry.detail ?? null
    );
}

export interface AuditRow {
  id: number;
  at: number;
  user_id: number | null;
  user_name: string;
  source: string;
  action: string;
  target: string;
  old_value: string | null;
  new_value: string | null;
  ok: number;
  detail: string | null;
}

export function queryAudit(opts: { limit?: number; before?: number; source?: string }): AuditRow[] {
  const limit = Math.min(opts.limit ?? 100, 500);
  const before = opts.before ?? Number.MAX_SAFE_INTEGER;
  if (opts.source) {
    return getDb()
      .prepare("SELECT * FROM audit_log WHERE at < ? AND source = ? ORDER BY at DESC LIMIT ?")
      .all(before, opts.source, limit) as AuditRow[];
  }
  return getDb()
    .prepare("SELECT * FROM audit_log WHERE at < ? ORDER BY at DESC LIMIT ?")
    .all(before, limit) as AuditRow[];
}
